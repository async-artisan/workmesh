import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';

type LowercasePlan = {
  finalSigmaPattern: string;
  expansions: Array<{ from: string; to: string }>;
  from: string;
  to: string;
};
let cachedPlan: LowercasePlan | undefined;

function bracket(points: number[]): string {
  const escaped = (point: number) => {
    const character = String.fromCodePoint(point);
    return ['\\', ']', '[', '^', '-'].includes(character) ? `\\${character}` : character;
  };
  const ranges: string[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const start = points[index]!;
    let end = start;
    while (points[index + 1] === end + 1) {
      index += 1;
      end += 1;
    }
    ranges.push(start === end ? escaped(start) : `${escaped(start)}-${escaped(end)}`);
  }
  return `[${ranges.join('')}]`;
}

/**
 * Build once, lazily for nonempty searches, from this Node runtime's Unicode tables.
 * Default lowercase has scalar mappings plus the language-neutral Final_Sigma context;
 * locale-specific Turkish/Lithuanian rules do not belong to String.toLowerCase().
 * Context is evaluated on the original text before scalar mappings or expansions.
 */
function lowercasePlan(): LowercasePlan {
  if (cachedPlan) return cachedPlan;
  const cased = /\p{Cased}/u;
  const caseIgnorable = /\p{Case_Ignorable}/u;
  const casedPoints: number[] = [];
  const ignorablePoints: number[] = [];
  const from: string[] = [];
  const to: string[] = [];
  const expansions: LowercasePlan['expansions'] = [];
  for (let point = 1; point <= 0x10ffff; point += 1) {
    if (point >= 0xd800 && point <= 0xdfff) continue;
    const character = String.fromCodePoint(point);
    const ignorable = caseIgnorable.test(character);
    if (ignorable) ignorablePoints.push(point);
    else if (cased.test(character)) casedPoints.push(point);
    const lower = character.toLowerCase();
    if (lower === character) continue;
    if ([...lower].length === 1) {
      from.push(character);
      to.push(lower);
    } else expansions.push({ from: character, to: lower });
  }
  const significantCased = bracket(casedPoints);
  const ignorable = bracket(ignorablePoints);
  cachedPlan = {
    finalSigmaPattern: `(${significantCased}${ignorable}*)Σ(?!${ignorable}*${significantCased})`,
    expansions,
    from: from.join(''),
    to: to.join(''),
  };
  return cachedPlan;
}

/**
 * Parameterized default JavaScript lowercase, independent of database LC_CTYPE/ICU.
 * C collation makes the explicit Unicode code-point ranges deterministic; no locale
 * character classes, case-insensitive regex or PostgreSQL lower() are used.
 */
export function javascriptLowercaseSql(source: Prisma.Sql): Prisma.Sql {
  const plan = lowercasePlan();
  let lowered = Prisma.sql`regexp_replace((${source}) COLLATE "C", ${plan.finalSigmaPattern}, ${'\\1ς'}, 'g')`;
  for (const expansion of plan.expansions)
    lowered = Prisma.sql`replace(${lowered}, ${expansion.from}, ${expansion.to})`;
  return Prisma.sql`translate(${lowered}, ${plan.from}, ${plan.to})`;
}

/** Short independent field, delimited by ASCII spaces in the joined search text. */
export function javascriptLowercaseFieldSql(source: Prisma.Sql): Prisma.Sql {
  // In UTF-8, equal byte/character lengths identify ASCII without a locale or regex.
  // Most revision titles need only this small mapping; retain the exact Unicode
  // plan for other fields rather than scanning the large map for every ASCII byte.
  return Prisma.sql`CASE WHEN getdatabaseencoding() = 'UTF8' AND octet_length(${source}) = length(${source})
    THEN translate(${source}, ${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'}, ${'abcdefghijklmnopqrstuvwxyz'})
    ELSE ${javascriptLowercaseSql(source)} END`;
}
