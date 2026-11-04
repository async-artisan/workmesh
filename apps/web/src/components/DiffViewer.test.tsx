import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiffViewer } from './DiffViewer';

function textWithLines(count: number, prefix = 'line') {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`).join('\n');
}

describe('DiffViewer（统一差异阅读）', () => {
  it('顶部插入只显示新增行与原行对齐，统计来自同一份 diff', () => {
    const { container } = render(
      <DiffViewer
        oldText={'第一行\n第二行\n第三行'}
        newText={'新增说明\n第一行\n第二行\n第三行'}
        testId="diff"
      />,
    );

    expect(screen.getByText(/共 1 处修改 · 新增 \+1 · 删除 -0/)).toBeInTheDocument();
    expect(container.querySelectorAll('.wm-diff-line[data-kind="add"]')).toHaveLength(1);
    expect(container.querySelectorAll('.wm-diff-line[data-kind="same"]')).toHaveLength(3);
    expect(
      screen.getByRole('region', { name: '第 1 处修改：新增 1 行，删除 0 行' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('diff')).toBeInTheDocument();
  });

  it('长上下文默认折叠，展开后保持真实行号且不改变统计', () => {
    const oldText = Array.from({ length: 20 }, (_, index) =>
      index === 9 ? 'old changed' : `line-${index + 1}`,
    ).join('\n');
    const newText = Array.from({ length: 20 }, (_, index) =>
      index === 9 ? 'new changed' : `line-${index + 1}`,
    ).join('\n');
    const { container } = render(<DiffViewer oldText={oldText} newText={newText} />);

    const before = screen.getByRole('button', { name: /显示第 1–9 行 · 共 9 行未修改/ });
    expect(before).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.getByRole('button', { name: /显示第 11–20 行 · 共 10 行未修改/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/共 1 处修改 · 新增 \+1 · 删除 -1/)).toBeInTheDocument();
    expect(container.querySelectorAll('.wm-diff-line[data-kind="same"]')).toHaveLength(0);

    fireEvent.click(before);
    expect(screen.getByRole('button', { name: '收起未修改行' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(container).getByText('line-1')).toBeInTheDocument();
    expect(screen.getByText(/共 1 处修改 · 新增 \+1 · 删除 -1/)).toBeInTheDocument();
  });

  it('多个上下文块可分别展开', () => {
    const oldLines = textWithLines(40).split('\n');
    const newLines = [...oldLines];
    newLines[9] = 'changed-10';
    newLines[29] = 'changed-30';
    render(<DiffViewer oldText={oldLines.join('\n')} newText={newLines.join('\n')} />);

    const toggles = screen.getAllByRole('button', { name: /显示第 \d+–\d+ 行 · 共 \d+ 行未修改/ });
    expect(toggles).toHaveLength(3);
    fireEvent.click(toggles[0]);
    expect(screen.getAllByRole('button', { name: '收起未修改行' })).toHaveLength(1);
    expect(
      screen.getAllByRole('button', { name: /显示第 \d+–\d+ 行 · 共 \d+ 行未修改/ }),
    ).toHaveLength(2);
  });

  it('上/下一处导航滚动并聚焦修改块，到达末尾后循环', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(
      <DiffViewer
        oldText={'A\nB\nC\nD\nE\nF'}
        newText={'A\nB2\nC\nD\nE2\nF'}
        baseLabel="已发布 v1"
        currentLabel="候选 v2"
      />,
    );

    expect(screen.getByText('第 1 / 2 处修改')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: '下一处修改' });
    fireEvent.click(next);

    await waitFor(() => expect(screen.getByText('第 2 / 2 处修改')).toBeInTheDocument());
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      '第 2 处修改：新增 1 行，删除 1 行',
    );
    expect(scrollIntoView).toHaveBeenCalled();

    fireEvent.click(next);
    expect(screen.getByText('第 1 / 2 处修改')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '上一处修改' }));
    expect(screen.getByText('第 2 / 2 处修改')).toBeInTheDocument();
  });

  it('只有一个修改块时上一处/下一处也会重新滚动并聚焦', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<DiffViewer oldText={'A\nB'} newText={'A\nB2'} />);
    const block = screen.getByRole('region', { name: '第 1 处修改：新增 1 行，删除 1 行' });
    expect(screen.getByText('第 1 / 1 处修改')).toBeInTheDocument();

    const next = screen.getByRole('button', { name: '下一处修改' });
    fireEvent.click(next);
    await waitFor(() => expect(block).toHaveFocus());
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // 焦点先回到按钮，再点“上一处”；即使 activeChange 仍是 0 也必须重新聚焦。
    const prev = screen.getByRole('button', { name: '上一处修改' });
    prev.focus();
    fireEvent.click(prev);
    await waitFor(() => expect(block).toHaveFocus());
    expect(scrollIntoView.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('无差异时显示明确空态，不显示导航按钮', () => {
    render(<DiffViewer oldText="A\nB" newText="A\nB" />);
    expect(screen.getByText('与对照版本内容相同')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一处修改' })).not.toBeInTheDocument();
    expect(screen.getByText('共 0 处修改 · 新增 +0 · 删除 -0')).toBeInTheDocument();
  });

  it('读取失败与读取中不渲染旧 diff 导航', () => {
    const { rerender } = render(
      <DiffViewer oldText="A" newText="B" error="正文读取失败：INTERNAL_ERROR" />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('差异读取失败：正文读取失败');
    expect(screen.queryByRole('button', { name: '下一处修改' })).not.toBeInTheDocument();

    rerender(<DiffViewer oldText="A" newText="B" loading />);
    expect(screen.getByRole('status')).toHaveTextContent('正在读取差异');
    expect(screen.queryByText(/共 \d+ 处修改/)).not.toBeInTheDocument();
  });

  it('切换版本/正文后重置导航位置和上下文展开', async () => {
    const baseLines = textWithLines(20).split('\n');
    const revisedLines = [...baseLines];
    revisedLines[2] = 'changed-3';
    revisedLines[15] = 'changed-16';
    const { rerender } = render(
      <DiffViewer
        oldText={baseLines.join('\n')}
        newText={revisedLines.join('\n')}
        baseLabel="v1"
        currentLabel="v2"
      />,
    );

    const expand = screen.getByRole('button', { name: /显示第 \d+–\d+ 行 · 共 \d+ 行未修改/ });
    fireEvent.click(expand);
    fireEvent.click(screen.getByRole('button', { name: '下一处修改' }));
    await waitFor(() => expect(screen.getByText('第 2 / 2 处修改')).toBeInTheDocument());

    rerender(<DiffViewer oldText="A\nB\nC" newText="A\nB2\nC" baseLabel="v3" currentLabel="v4" />);
    expect(screen.getByText('第 1 / 1 处修改')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起未修改行' })).not.toBeInTheDocument();
  });

  it('超长文档显示可见降级原因，不输出伪造统计或导航', () => {
    const oldLines = Array.from({ length: 1600 }, (_, index) => `old-${index}`);
    const newLines = Array.from({ length: 1600 }, (_, index) => `new-${index}`);
    render(<DiffViewer oldText={oldLines.join('\n')} newText={newLines.join('\n')} />);

    expect(screen.getByText('文档过长，差异需要分段加载')).toBeInTheDocument();
    expect(screen.getByText(/对照版本 1600 行、当前版本 1600 行/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一处修改' })).not.toBeInTheDocument();
    expect(screen.queryByText(/共 \d+ 处修改/)).not.toBeInTheDocument();
  });

  it('新增/删除行提供隐藏文本，不只依赖颜色', () => {
    const { container } = render(<DiffViewer oldText="A" newText="B" />);
    const remove = container.querySelector('.wm-diff-line[data-kind="remove"]');
    const add = container.querySelector('.wm-diff-line[data-kind="add"]');
    expect(remove?.textContent).toContain('删除：A');
    expect(add?.textContent).toContain('新增：B');
    expect(remove?.querySelector('.wm-diff-sr-only')).toHaveTextContent('删除');
    expect(add?.querySelector('.wm-diff-sr-only')).toHaveTextContent('新增');
  });
});
