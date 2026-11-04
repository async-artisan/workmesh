export type DiffLine = {
  kind: 'same' | 'add' | 'remove';
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
};

export type DiffBlock =
  | {
      kind: 'context';
      lines: DiffLine[];
      oldStart: number | null;
      oldEnd: number | null;
      newStart: number | null;
      newEnd: number | null;
    }
  | {
      kind: 'change';
      lines: DiffLine[];
      oldStart: number | null;
      newStart: number | null;
      added: number;
      removed: number;
      /** 1-based 修改块序号，供导航与可访问名称使用。 */
      index: number;
    };

export interface DiffSummary {
  added: number;
  removed: number;
  changeBlocks: number;
  hasChanges: boolean;
}

export interface DiffModel {
  lines: DiffLine[];
  blocks: DiffBlock[];
  summary: DiffSummary;
  oldLineCount: number;
  newLineCount: number;
}

/**
 * LCS 二维表的安全上限。PRD 正文通常远低于该规模；超过时抛 DiffTooLargeError，
 * 由 UI 明确显示“文档过长，差异需要分段加载”，绝不截断后伪造完整 diff。
 */
export const MAX_DIFF_CELLS = 2_500_000;

export class DiffTooLargeError extends Error {
  constructor(
    readonly oldLineCount: number,
    readonly newLineCount: number,
  ) {
    super(`文档过长：对照 ${oldLineCount} 行、当前 ${newLineCount} 行，超过差异计算安全上限。`);
    this.name = 'DiffTooLargeError';
  }
}

/** CRLF/CR/LF 归一化；末尾换行不算额外空行，避免同一文档因换行风格产生假差异。 */
export function splitDiffLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (normalized === '') return [];
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * 行级 LCS diff。按行号对齐的“假 diff”在插入一行时会把后面全部标成变更，
 * 评审页需要真实的新增/删除行，这里用最小编辑距离回溯。
 *
 * 先剥离公共前后缀，只对中间区域建表；大多数文档修改很少，这一步同时降低了
 * 矩阵规模。中间区域超过安全上限时抛 DiffTooLargeError。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = splitDiffLines(oldText);
  const after = splitDiffLines(newText);
  const oldTotal = before.length;
  const newTotal = after.length;

  let prefix = 0;
  while (prefix < oldTotal && prefix < newTotal && before[prefix] === after[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldTotal - prefix &&
    suffix < newTotal - prefix &&
    before[oldTotal - 1 - suffix] === after[newTotal - 1 - suffix]
  )
    suffix += 1;

  const oldMiddle = before.slice(prefix, oldTotal - suffix);
  const newMiddle = after.slice(prefix, newTotal - suffix);
  const rows = oldMiddle.length;
  const cols = newMiddle.length;

  if ((rows + 1) * (cols + 1) > MAX_DIFF_CELLS) throw new DiffTooLargeError(oldTotal, newTotal);

  const lines: DiffLine[] = [];
  for (let index = 0; index < prefix; index += 1) {
    lines.push({
      kind: 'same',
      text: before[index],
      oldNumber: index + 1,
      newNumber: index + 1,
    });
  }

  if (rows > 0 || cols > 0) {
    const table = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
    for (let i = 1; i <= rows; i += 1) {
      for (let j = 1; j <= cols; j += 1) {
        table[i][j] =
          oldMiddle[i - 1] === newMiddle[j - 1]
            ? table[i - 1][j - 1] + 1
            : Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }

    const reversed: DiffLine[] = [];
    let i = rows;
    let j = cols;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldMiddle[i - 1] === newMiddle[j - 1]) {
        reversed.push({
          kind: 'same',
          text: oldMiddle[i - 1],
          oldNumber: prefix + i,
          newNumber: prefix + j,
        });
        i -= 1;
        j -= 1;
      } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
        reversed.push({
          kind: 'add',
          text: newMiddle[j - 1],
          oldNumber: null,
          newNumber: prefix + j,
        });
        j -= 1;
      } else {
        reversed.push({
          kind: 'remove',
          text: oldMiddle[i - 1],
          oldNumber: prefix + i,
          newNumber: null,
        });
        i -= 1;
      }
    }
    lines.push(...reversed.reverse());
  }

  for (let index = 0; index < suffix; index += 1) {
    const oldNumber = oldTotal - suffix + index + 1;
    const newNumber = newTotal - suffix + index + 1;
    lines.push({
      kind: 'same',
      text: before[oldNumber - 1],
      oldNumber,
      newNumber,
    });
  }

  return lines;
}

export function countDiff(lines: readonly DiffLine[]): { added: number; removed: number } {
  return lines.reduce(
    (sum, line) => ({
      added: sum.added + (line.kind === 'add' ? 1 : 0),
      removed: sum.removed + (line.kind === 'remove' ? 1 : 0),
    }),
    { added: 0, removed: 0 },
  );
}

/** 修改块 = 连续的 add/remove 行；被 same 行分隔即视为多个修改块。 */
export function countChangeBlocks(lines: readonly DiffLine[]): number {
  let blocks = 0;
  let inChange = false;
  for (const line of lines) {
    if (line.kind === 'same') {
      inChange = false;
    } else if (!inChange) {
      blocks += 1;
      inChange = true;
    }
  }
  return blocks;
}

export function diffSummary(lines: readonly DiffLine[]): DiffSummary {
  const { added, removed } = countDiff(lines);
  const changeBlocks = countChangeBlocks(lines);
  return { added, removed, changeBlocks, hasChanges: added > 0 || removed > 0 };
}

/** 把原始行序列切成“未修改上下文块”和“修改块”，供所有页面统一渲染。 */
export function buildDiffBlocks(lines: readonly DiffLine[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let index = 0;
  let changeIndex = 0;

  const pushContext = (group: DiffLine[]) => {
    if (group.length === 0) return;
    const first = group[0];
    const last = group[group.length - 1];
    blocks.push({
      kind: 'context',
      lines: group,
      oldStart: first.oldNumber,
      oldEnd: last.oldNumber,
      newStart: first.newNumber,
      newEnd: last.newNumber,
    });
  };

  while (index < lines.length) {
    const line = lines[index];
    if (line.kind === 'same') {
      const group: DiffLine[] = [];
      while (index < lines.length && lines[index].kind === 'same') {
        group.push(lines[index]);
        index += 1;
      }
      pushContext(group);
      continue;
    }
    const group: DiffLine[] = [];
    while (index < lines.length && lines[index].kind !== 'same') {
      group.push(lines[index]);
      index += 1;
    }
    const added = group.filter((item) => item.kind === 'add').length;
    const removed = group.filter((item) => item.kind === 'remove').length;
    changeIndex += 1;
    blocks.push({
      kind: 'change',
      lines: group,
      oldStart: group.find((item) => item.oldNumber !== null)?.oldNumber ?? null,
      newStart: group.find((item) => item.newNumber !== null)?.newNumber ?? null,
      added,
      removed,
      index: changeIndex,
    });
  }

  return blocks;
}

export function buildDiffModel(oldText: string, newText: string): DiffModel {
  const lines = diffLines(oldText, newText);
  return {
    lines,
    blocks: buildDiffBlocks(lines),
    summary: diffSummary(lines),
    oldLineCount: splitDiffLines(oldText).length,
    newLineCount: splitDiffLines(newText).length,
  };
}
