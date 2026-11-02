export type DiffLine = {
  kind: 'same' | 'add' | 'remove';
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
};

/**
 * 行级 LCS diff。按行号对齐的“假 diff”在插入一行时会把后面全部标成变更，
 * 评审页需要真实的新增/删除行，这里用最小编辑距离回溯。
 */
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split('\n');
  const after = newText.split('\n');
  const rows = before.length;
  const cols = after.length;
  const table = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));

  for (let i = 1; i <= rows; i += 1) {
    for (let j = 1; j <= cols; j += 1) {
      table[i][j] =
        before[i - 1] === after[j - 1]
          ? table[i - 1][j - 1] + 1
          : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }

  const reversed: DiffLine[] = [];
  let i = rows;
  let j = cols;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      reversed.push({ kind: 'same', text: before[i - 1], oldNumber: i, newNumber: j });
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      reversed.push({ kind: 'add', text: after[j - 1], oldNumber: null, newNumber: j });
      j -= 1;
    } else {
      reversed.push({ kind: 'remove', text: before[i - 1], oldNumber: i, newNumber: null });
      i -= 1;
    }
  }

  return reversed.reverse();
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
