import { describe, expect, it } from 'vitest';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  javascriptLowercaseFieldSql,
  javascriptLowercaseSql,
} from './v1-document-summary.case-fold';

/** Interpret only regexp_replace/replace/translate's scalar plan; PostgreSQL is tested separately. */
function plannedLowercase(input: string): string {
  const sql = javascriptLowercaseSql(Prisma.sql`${input}`);
  const values = sql.values as string[];
  const [source, pattern] = values;
  let value = source!.replace(new RegExp(pattern!, 'gu'), '$1ς');
  for (let index = 3; index < values.length - 2; index += 2)
    value = value.split(values[index]!).join(values[index + 1]!);
  const from = [...values[values.length - 2]!];
  const to = [...values[values.length - 1]!];
  const replacements = new Map(from.map((character, index) => [character, to[index]!]));
  return [...value].map((character) => replacements.get(character) ?? character).join('');
}

describe('locale-independent JavaScript lowercase search plan', () => {
  it.each([
    'ÉCLAIR ÀÉÖ é',
    'İSTANBUL I ı i',
    'ΟΣ ΟΣΑ ΟΣΣ ΟΣ ΟΣ',
    'Σ Ο\u0345Σ Σ\u0345 ΟΣ\u0345Α ΟΣ\u0345',
    'AΣ\u0301 BΣ\u0301C A\u0301Σ',
    'Σ.Σ AΣ.Σ AΣ:AΣ',
    'PRD prd 理解 候选 v10',
    '𐐀𐐁𞤀𐒰',
    'K Å ẞ ﬃ',
    "a%_Quote' 空格 字段",
  ])('matches native default lowercase for %s', (input) => {
    expect(plannedLowercase(input)).toBe(input.toLowerCase());
  });

  it('covers scalar case mappings across every Unicode code point', () => {
    const characters: string[] = [];
    for (let point = 1; point <= 0x10ffff; point += 1) {
      if (point >= 0xd800 && point <= 0xdfff) continue;
      const character = String.fromCodePoint(point);
      if (character !== character.toLowerCase()) characters.push(character);
    }
    const input = characters.join(' ');
    expect(plannedLowercase(input)).toBe(input.toLowerCase());
  });

  it('binds all mapping/regex bytes as parameters and requires only the built-in C collation', () => {
    const sql = javascriptLowercaseSql(Prisma.sql`d."text"`);
    expect(sql.text).toContain('COLLATE "C"');
    expect(sql.text).toContain('translate(replace(regexp_replace(');
    expect(sql.text).not.toMatch(/\blower\(|\b(?:LIKE|ILIKE)\b|É|Σ|İ|icu|CREATE/i);
    expect(sql.values).toContain('\\1ς');
  });

  it('uses a small ASCII mapping only for fields whose UTF-8 byte and character lengths agree', () => {
    const sql = javascriptLowercaseFieldSql(Prisma.sql`r."title"`);
    expect(sql.text).toContain("CASE WHEN getdatabaseencoding() = 'UTF8'");
    expect(sql.text).toContain('octet_length(r."title") = length(r."title")');
    expect(sql.values).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(sql.values).toContain('abcdefghijklmnopqrstuvwxyz');
    expect(sql.text).toContain('ELSE translate(replace(regexp_replace(');
    expect(sql.text).toContain('COLLATE "C"');
    expect(sql.text).not.toMatch(/\blower\(|\b(?:LIKE|ILIKE)\b/);
  });

  it('preserves Final_Sigma and expansion behavior across ASCII-space field boundaries', () => {
    const fields = ['ΟΣ\u0345', '\u0345Σ', 'AΣ.Σ', 'İSTANBUL', '𐐀', 'PRD prd', 'candidate 候选'];
    for (const left of fields)
      for (const right of fields)
        expect(`${plannedLowercase(left)} ${plannedLowercase(right)}`).toBe(
          `${left} ${right}`.toLowerCase(),
        );
  });
});
