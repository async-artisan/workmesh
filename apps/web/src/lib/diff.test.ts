import { describe, expect, it } from 'vitest';
import {
  DiffTooLargeError,
  MAX_DIFF_CELLS,
  buildDiffModel,
  countChangeBlocks,
  countDiff,
  diffLines,
  diffSummary,
  splitDiffLines,
} from './diff';

function kinds(oldText: string, newText: string) {
  return diffLines(oldText, newText).map((line) => line.kind);
}

describe('diffLines（LCS 行级差异，而不是同索引比较）', () => {
  it('顶部插入后原有行仍保持 same', () => {
    const lines = diffLines('第一行\n第二行\n第三行', '新增说明\n第一行\n第二行\n第三行');
    expect(lines.map((line) => line.kind)).toEqual(['add', 'same', 'same', 'same']);
    expect(lines[0]).toMatchObject({ text: '新增说明', oldNumber: null, newNumber: 1 });
    expect(lines[1]).toMatchObject({ text: '第一行', oldNumber: 1, newNumber: 2 });
    expect(lines[3]).toMatchObject({ text: '第三行', oldNumber: 3, newNumber: 4 });
  });

  it('中间删除不会把后续内容全部标记为修改', () => {
    const lines = diffLines('A\nB\nC\nD', 'A\nC\nD');
    expect(lines.map((line) => line.kind)).toEqual(['same', 'remove', 'same', 'same']);
    expect(lines[1]).toMatchObject({ text: 'B', oldNumber: 2, newNumber: null });
    expect(lines[2]).toMatchObject({ text: 'C', oldNumber: 3, newNumber: 2 });
    expect(lines[3]).toMatchObject({ text: 'D', oldNumber: 4, newNumber: 3 });
  });

  it('正确处理连续新增和连续删除', () => {
    expect(kinds('A\nD', 'A\nB\nC\nD')).toEqual(['same', 'add', 'add', 'same']);
    expect(kinds('A\nB\nC\nD', 'A\nD')).toEqual(['same', 'remove', 'remove', 'same']);
  });

  it('修改表现为相邻的删除与新增，而不是丢失原始行', () => {
    const lines = diffLines('# Checkout\n- old', '# Checkout v2\n- new');
    const summary = diffSummary(lines);
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(2);
    expect(lines.some((line) => line.kind === 'remove' && line.text === '# Checkout')).toBe(true);
    expect(lines.some((line) => line.kind === 'add' && line.text === '# Checkout v2')).toBe(true);
  });

  it('空文档、完全相同文档与末尾换行', () => {
    expect(diffLines('', '')).toEqual([]);
    expect(kinds('', 'A')).toEqual(['add']);
    expect(kinds('A', '')).toEqual(['remove']);

    const same = diffLines('A\nB', 'A\nB');
    expect(same.every((line) => line.kind === 'same')).toBe(true);
    expect(diffSummary(same)).toEqual({
      added: 0,
      removed: 0,
      changeBlocks: 0,
      hasChanges: false,
    });

    // 末尾换行风格不是内容差异。
    expect(diffLines('A\nB\n', 'A\nB').every((line) => line.kind === 'same')).toBe(true);
    expect(diffLines('A\r\nB', 'A\nB').every((line) => line.kind === 'same')).toBe(true);
  });

  it('CRLF 与 LF 归一化，混合换行也不产生假差异', () => {
    expect(kinds('第一行\r\n第二行\r\n第三行', '第一行\n第二行\n第三行')).toEqual([
      'same',
      'same',
      'same',
    ]);
    expect(splitDiffLines('A\r\nB\rC\n')).toEqual(['A', 'B', 'C']);
  });

  it('中文文本与重复行仍然正确对齐', () => {
    const chinese = diffLines('需求\n验收\n上线', '需求\n验收标准\n上线');
    expect(chinese.map((line) => line.kind)).toEqual(['same', 'remove', 'add', 'same']);

    const duplicate = diffLines('A\nA\nB', 'A\nB\nB');
    const summary = diffSummary(duplicate);
    expect(summary.added).toBe(1);
    expect(summary.removed).toBe(1);
    expect(duplicate.filter((line) => line.kind === 'same')).toHaveLength(2);
  });

  it('增删统计和修改块数量来自同一份 diff 结果', () => {
    const lines = diffLines('A\nB\nC\nD\nE\nF', 'A\nB2\nC\nD\nE2\nF');
    const summary = diffSummary(lines);
    expect(summary.added).toBe(2);
    expect(summary.removed).toBe(2);
    expect(summary.changeBlocks).toBe(2);
    expect(summary.hasChanges).toBe(true);
    expect(countDiff(lines)).toEqual({ added: 2, removed: 2 });
    expect(countChangeBlocks(lines)).toBe(2);
  });

  it('修改块被未修改行分隔时计为多个块', () => {
    expect(countChangeBlocks(diffLines('A\nB\nC', 'A2\nB\nC'))).toBe(1);
    expect(countChangeBlocks(diffLines('A\nB\nC', 'A2\nB\nC2'))).toBe(2);
  });
});

describe('buildDiffBlocks / buildDiffModel（统一阅读模型）', () => {
  it('把未修改上下文与修改块分块，并保留块的行号范围与计数', () => {
    const model = buildDiffModel('A\nB\nC\nD\nE\nF', 'A\nB2\nC\nD\nE\nF2');
    expect(model.blocks.map((block) => block.kind)).toEqual([
      'context',
      'change',
      'context',
      'change',
    ]);
    const changes = model.blocks.filter((block) => block.kind === 'change');
    expect(changes.map((block) => block.index)).toEqual([1, 2]);
    const [first, second] = changes;
    if (first.kind !== 'change' || second.kind !== 'change') throw new Error('expected changes');
    expect(first).toMatchObject({ oldStart: 2, newStart: 2, added: 1, removed: 1 });
    expect(second).toMatchObject({ oldStart: 6, newStart: 6, added: 1, removed: 1 });

    const withContext = buildDiffModel('A\nB\nC\nD\nE\nF\nG\nH', 'A\nB\nC\nD2\nE\nF\nG\nH');
    expect(withContext.blocks.map((block) => block.kind)).toEqual(['context', 'change', 'context']);
    const [context] = withContext.blocks;
    if (context.kind !== 'context') throw new Error('expected context');
    expect(context.oldStart).toBe(1);
    expect(context.oldEnd).toBe(3);
    expect(context.lines).toHaveLength(3);
  });

  it('buildDiffModel 暴露行数、统计和块，无差异时 hasChanges=false', () => {
    const model = buildDiffModel('A\nB', 'A\nB');
    expect(model.oldLineCount).toBe(2);
    expect(model.newLineCount).toBe(2);
    expect(model.summary.hasChanges).toBe(false);
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0].kind).toBe('context');
  });
});

describe('长文档安全上限', () => {
  it('超过矩阵上限时抛出可解释的 DiffTooLargeError，不伪造 diff', () => {
    const oldLines = Array.from({ length: 1600 }, (_, index) => `old-${index}`);
    const newLines = Array.from({ length: 1600 }, (_, index) => `new-${index}`);
    expect(1600 * 1600).toBeGreaterThan(MAX_DIFF_CELLS);
    expect(() => diffLines(oldLines.join('\n'), newLines.join('\n'))).toThrow(DiffTooLargeError);
  });

  it('长但大部分相同的文档通过公共前后缀裁剪，不触发上限', () => {
    const base = Array.from({ length: 5000 }, (_, index) => `line-${index}`);
    const changed = [...base];
    changed[2500] = 'changed line';
    const lines = diffLines(base.join('\n'), changed.join('\n'));
    expect(lines.filter((line) => line.kind === 'same')).toHaveLength(4999);
    expect(lines.filter((line) => line.kind === 'remove')).toHaveLength(1);
    expect(lines.filter((line) => line.kind === 'add')).toHaveLength(1);
  });
});
