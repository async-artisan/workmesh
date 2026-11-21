import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DocumentSummary } from '../api/documentSummaries';
import type { RevisionView } from '../api/resources';
import { envelope, mockFetch, pathOf, type StubReply } from '../test-utils';
import { RequirementPrdPanel } from './RequirementPrdPanel';

function revision(seq: number, documentId = 'doc-1', reviewRequestId?: string): RevisionView {
  return {
    id: `${documentId}-r${seq}`,
    documentId,
    seq,
    title: `修订 ${seq}`,
    digest: 'd'.repeat(64),
    state: seq === 2 ? 'PUBLISHED' : 'CANDIDATE',
    mimeType: 'text/markdown',
    byteLength: 20,
    createdBy: 'agent',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
    reviewRequestId,
  };
}

function summary(id = 'doc-1', requirementId = 'req-1', version = 17): DocumentSummary {
  return {
    document: {
      id,
      projectId: 'p1',
      requirementId,
      knowledgeBaseId: 'kb-1',
      kind: 'PRD',
      version,
      currentPublishedRevisionId: `${id}-r2`,
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00Z',
    knowledgeBase: { id: 'kb-1', name: '项目知识', kind: 'BUSINESS' },
    requirement: { id: requirementId, code: 'DEMO-001', title: '需求' },
    latestVisibleRevision: { ...revision(123, id), state: 'CANDIDATE' },
    publishedRevision: { ...revision(2, id), title: `发布 ${id}`, state: 'PUBLISHED' },
    visibleRevisionCount: 123,
    candidateRevisionCount: 122,
  };
}

function catalog(
  items = [summary()],
  nextCursor: string | null = null,
  total = items.length,
): StubReply {
  return { status: 200, body: envelope({ items, nextCursor, total }) };
}

function history(
  seqs: number[],
  nextCursor: string | null = null,
  options: { id?: string; version?: number; total?: number } = {},
): StubReply {
  return {
    status: 200,
    body: envelope({
      items: seqs.map((seq) => revision(seq, options.id, `review/${seq}`)),
      nextCursor,
      total: options.total ?? 123,
      documentVersion: options.version ?? 17,
    }),
  };
}

function failure(status: number, message = '请求暂不可用'): StubReply {
  return { status, body: { error: { code: 'READ_FAILED', message, requestId: 'req-failure' } } };
}

function deferred() {
  let resolve!: (value: StubReply) => void;
  const promise = new Promise<StubReply>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

const noop = () => undefined;

function renderPanel(
  options: {
    active?: boolean;
    requirementId?: string;
    onCountChange?: Parameters<typeof RequirementPrdPanel>[0]['onCountChange'];
  } = {},
) {
  const props = {
    projectId: 'p1',
    requirementId: options.requirementId ?? 'req-1',
    active: options.active ?? true,
    onCountChange: options.onCountChange ?? noop,
  };
  const view = render(
    <MemoryRouter>
      <LocationProbe />
      <RequirementPrdPanel {...props} />
    </MemoryRouter>,
  );
  return {
    ...view,
    update(next: Partial<typeof props>) {
      Object.assign(props, next);
      view.rerender(
        <MemoryRouter>
          <LocationProbe />
          <RequirementPrdPanel {...props} />
        </MemoryRouter>,
      );
    },
  };
}

async function expand(title = '发布 doc-1') {
  fireEvent.click(await screen.findByRole('button', { name: `查看修订 ${title}` }));
  return screen.findByRole('region', { name: 'PRD 修订历史' });
}

describe('RequirementPrdPanel', () => {
  it('未激活只取一页带真实需求过滤的概要，并回报服务端准确总数', async () => {
    const counts = vi.fn();
    const fetch = mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/projects/p1/document-summaries');
      expect(parsed.searchParams.get('kind')).toBe('PRD');
      expect(parsed.searchParams.get('requirementId')).toBe('req-1');
      expect(parsed.searchParams.get('limit')).toBe('50');
      return catalog(
        Array.from({ length: 50 }, (_, index) => summary(`doc-${index + 1}`)),
        'next',
        107,
      );
    });
    const view = renderPanel({ active: false, onCountChange: counts });
    await waitFor(() =>
      expect(counts).toHaveBeenLastCalledWith({
        projectId: 'p1',
        requirementId: 'req-1',
        total: 107,
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: '需求 PRD 文档' })).not.toBeInTheDocument();
    view.update({ active: true });
    expect(await screen.findAllByText('候选 122 个', { exact: true })).toHaveLength(50);
    expect(screen.getAllByText('可见修订 123 个', { exact: false })).toHaveLength(50);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('按需翻页可到第51和107份，上一页重新校验且通用入口携带项目', async () => {
    const cursors: Array<string | null> = [];
    const fetch = mockFetch((url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      cursors.push(cursor);
      if (cursor === 'last') return catalog([summary('doc-107')], null, 107);
      if (cursor === 'next') return catalog([summary('doc-51')], 'last', 107);
      return catalog([summary()], 'next', 107);
    });
    renderPanel();
    await screen.findByRole('article', { name: '发布 doc-1' });
    fireEvent.click(screen.getByRole('button', { name: '下一页 PRD' }));
    await screen.findByRole('article', { name: '发布 doc-51' });
    fireEvent.click(screen.getByRole('button', { name: '下一页 PRD' }));
    await screen.findByRole('article', { name: '发布 doc-107' });
    expect(screen.getByRole('region', { name: '需求 PRD 文档' })).toHaveTextContent(
      '共 107 份 PRD',
    );
    fireEvent.click(screen.getByRole('button', { name: '上一页 PRD' }));
    await screen.findByRole('article', { name: '发布 doc-51' });
    expect(cursors).toEqual([null, 'next', 'last', 'next']);
    expect(fetch).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('button', { name: '打开项目文档页' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/prd?projectId=p1');
  });

  it('目录首次失败不显示没有文档，临时刷新失败保留旧行且数量待确认', async () => {
    let reads = 0;
    const counts = vi.fn();
    mockFetch(() => (++reads === 2 ? catalog() : failure(503, '目录不可用')));
    renderPanel({ onCountChange: counts });
    await screen.findByText(/目录不可用/);
    expect(screen.queryByText('该需求还没有绑定 PRD 文档。')).not.toBeInTheDocument();
    expect(counts).toHaveBeenLastCalledWith({
      projectId: 'p1',
      requirementId: 'req-1',
      total: null,
    });
    fireEvent.click(screen.getByRole('button', { name: '重试读取 PRD 列表' }));
    await screen.findByRole('article', { name: '发布 doc-1' });
    fireEvent.click(screen.getByRole('button', { name: '刷新 PRD 列表' }));
    await screen.findByText(/数据可能已过期/);
    expect(screen.getByRole('article', { name: '发布 doc-1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看修订 发布 doc-1' })).toBeDisabled();
    expect(counts).toHaveBeenLastCalledWith({
      projectId: 'p1',
      requirementId: 'req-1',
      total: null,
    });
  });

  it('成功空列表回报零并显示空状态，失败不伪造相同结果', async () => {
    const counts = vi.fn();
    mockFetch(() => catalog([], null, 0));
    renderPanel({ onCountChange: counts });
    await screen.findByText('该需求还没有绑定 PRD 文档。');
    expect(counts).toHaveBeenLastCalledWith({ projectId: 'p1', requirementId: 'req-1', total: 0 });
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'PRD 修订历史' })).not.toBeInTheDocument();
  });

  it('目录权限失败清除旧行与读者', async () => {
    let denied = false;
    mockFetch((url) =>
      pathOf(url).endsWith('/history') ? history([123]) : denied ? failure(403) : catalog(),
    );
    renderPanel();
    await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    denied = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新 PRD 列表' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'PRD 修订历史' })).not.toBeInTheDocument();
    expect(screen.queryByText('该需求还没有绑定 PRD 文档。')).not.toBeInTheDocument();
  });

  it('展开后只读一份历史，按需续页保留123总数，关闭恢复触发焦点', async () => {
    const fetch = mockFetch((url) => {
      if (pathOf(url).endsWith('/history'))
        return new URL(url, 'http://localhost').searchParams.has('cursor')
          ? history([73, 72], null)
          : history(
              Array.from({ length: 50 }, (_, index) => 123 - index),
              'more',
            );
      return catalog([summary(), summary('doc-2')]);
    });
    renderPanel();
    const region = await expand();
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(50));
    expect(region).toHaveTextContent('已加载 50 / 123 条历史');
    expect(fetch.mock.calls.filter(([url]) => String(url).includes('/history?'))).toHaveLength(1);
    fireEvent.click(within(region).getByRole('button', { name: '加载更多 PRD 修订' }));
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(52));
    expect(region).toHaveTextContent('已加载 52 / 123 条历史');
    fireEvent.click(within(region).getByRole('button', { name: '关闭 PRD 修订历史' }));
    expect(screen.getByRole('button', { name: '查看修订 发布 doc-1' })).toHaveFocus();
    await expand('发布 doc-2');
    expect(screen.getAllByRole('region', { name: 'PRD 修订历史' })).toHaveLength(1);
  });

  it('首历史页外发布按真实ID解析metadata，缓存不增加历史且评审规范编码', async () => {
    const fetch = mockFetch((url) => {
      if (pathOf(url).endsWith('/metadata'))
        return { status: 200, body: envelope(revision(2, 'doc-1', 'review/a b')) };
      if (pathOf(url).endsWith('/history')) return history([123, 122], 'more');
      return catalog();
    });
    renderPanel();
    const region = await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    const published = within(screen.getByTestId('requirement-prd-published-revision'));
    expect(published.getByText('v2 · 发布 doc-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '评审当前发布修订' })).not.toBeInTheDocument();
    fireEvent.click(published.getByRole('button', { name: '查看当前发布修订信息' }));
    const review = await screen.findByRole('button', { name: '评审当前发布修订' });
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(
      '/api/v1/documents/doc-1/revisions/doc-1-r2/metadata',
    );
    expect(within(region).getAllByRole('listitem')).toHaveLength(2);
    expect(region).toHaveTextContent('已加载 2 / 123 条历史');
    fireEvent.click(review);
    expect(screen.getByTestId('location')).toHaveTextContent('/reviews/review%2Fa%20b');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/content'))).toBe(false);
  });

  it('历史首次503可显式刷新，准确发布metadata503按同一ID重试', async () => {
    let historyReads = 0;
    let metadataReads = 0;
    const fetch = mockFetch((url) => {
      if (pathOf(url).endsWith('/history')) {
        return ++historyReads === 1 ? failure(503, '历史不可用') : history([123]);
      }
      if (pathOf(url).endsWith('/metadata')) {
        return ++metadataReads === 1
          ? failure(503, '发布信息不可用')
          : {
              status: 200,
              body: envelope(revision(2, 'doc-1', 'exact-review')),
            };
      }
      return catalog();
    });
    renderPanel();
    const region = await expand();
    await screen.findByText(/历史不可用/);
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看当前发布修订信息' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '刷新 PRD 历史' }));
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布修订信息' }));
    await screen.findByText(/发布信息不可用/);
    expect(screen.queryByRole('button', { name: '评审当前发布修订' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布修订信息' }));
    await screen.findByRole('button', { name: '评审当前发布修订' });
    expect(
      fetch.mock.calls.filter(([url]) => String(url).endsWith('/doc-1-r2/metadata')),
    ).toHaveLength(2);
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
  });

  it.each([403, 404])('精确发布metadata %i清除历史和评审入口，不换成首项', async (status) => {
    mockFetch((url) =>
      pathOf(url).endsWith('/metadata')
        ? failure(status, '精确修订不可读')
        : pathOf(url).endsWith('/history')
          ? history([123], 'more')
          : catalog(),
    );
    renderPanel();
    const region = await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布修订信息' }));
    await screen.findByText(/已清除历史与评审入口/);
    expect(within(region).queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('requirement-prd-published-revision')).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /评审/ })).not.toBeInTheDocument();
  });

  it('续页503保留已读历史、禁评审且重试同一游标', async () => {
    let attempt = 0;
    const cursors: Array<string | null> = [];
    mockFetch((url) => {
      if (!pathOf(url).endsWith('/history')) return catalog();
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      cursors.push(cursor);
      return cursor ? (++attempt === 1 ? failure(503) : history([122])) : history([123], 'more');
    });
    renderPanel();
    const region = await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    fireEvent.click(screen.getByRole('button', { name: '加载更多 PRD 修订' }));
    await screen.findByText(/已加载的历史保留/);
    expect(within(region).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '评审修订 v123' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '加载更多 PRD 修订' }));
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(2));
    expect(cursors).toEqual([null, 'more', 'more']);
  });

  it.each(['409', 'total', 'version'])(
    '%s变化停止历史续页并要求刷新，不合并新旧快照',
    async (mode) => {
      mockFetch((url) => {
        if (!pathOf(url).endsWith('/history')) return catalog();
        if (!new URL(url, 'http://localhost').searchParams.has('cursor'))
          return history([123], 'more');
        return mode === '409'
          ? failure(409, 'HISTORY_REFRESH_REQUIRED')
          : history([122], null, {
              total: mode === 'total' ? 124 : 123,
              version: mode === 'version' ? 18 : 17,
            });
      });
      renderPanel();
      const region = await expand();
      await screen.findByRole('list', { name: '已加载 PRD 历史' });
      fireEvent.click(screen.getByRole('button', { name: '加载更多 PRD 修订' }));
      await screen.findByText('历史已变化，请刷新历史后继续。');
      expect(within(region).getAllByRole('listitem')).toHaveLength(1);
      expect(screen.queryByRole('button', { name: '加载更多 PRD 修订' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '刷新 PRD 历史' })).toBeEnabled();
    },
  );

  it('跨需求迟到概要不覆盖新scope计数和目录', async () => {
    const late = deferred();
    const counts = vi.fn();
    mockFetch((url) =>
      new URL(url, 'http://localhost').searchParams.get('requirementId') === 'req-1'
        ? late.promise
        : catalog([summary('doc-new', 'req-2')], null, 57),
    );
    const view = renderPanel({ onCountChange: counts });
    view.update({ requirementId: 'req-2' });
    await screen.findByRole('article', { name: '发布 doc-new' });
    await act(async () => late.resolve(catalog([summary('doc-old')], null, 107)));
    expect(screen.queryByRole('article', { name: '发布 doc-old' })).not.toBeInTheDocument();
    expect(counts).toHaveBeenLastCalledWith({ projectId: 'p1', requirementId: 'req-2', total: 57 });
  });

  it('切文档后旧history迟到不挂回旧修订和评审', async () => {
    const late = deferred();
    let oldSignal: AbortSignal | undefined;
    mockFetch((url, init) => {
      if (pathOf(url).endsWith('/history')) {
        if (url.includes('/doc-1/')) {
          oldSignal = init.signal ?? undefined;
          return late.promise;
        }
        return history([77], null, { id: 'doc-2' });
      }
      return catalog([summary(), summary('doc-2')]);
    });
    renderPanel();
    await expand();
    await expand('发布 doc-2');
    await screen.findByRole('button', { name: '评审修订 v77' });
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => late.resolve(history([123])));
    expect(screen.queryByRole('button', { name: '评审修订 v123' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'PRD 修订历史' })).toHaveTextContent('发布 doc-2');
  });

  it('切文档后旧metadata迟到不挂回旧评审，刷新目录关闭读者', async () => {
    const late = deferred();
    mockFetch((url) => {
      if (pathOf(url).endsWith('/metadata')) return late.promise;
      if (pathOf(url).endsWith('/history'))
        return history([123], null, { id: url.includes('doc-2') ? 'doc-2' : 'doc-1' });
      return catalog([summary(), summary('doc-2')]);
    });
    renderPanel();
    await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布修订信息' }));
    await expand('发布 doc-2');
    await act(async () =>
      late.resolve({ status: 200, body: envelope(revision(2, 'doc-1', 'old-review')) }),
    );
    expect(screen.queryByRole('button', { name: '评审当前发布修订' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'PRD 修订历史' })).toHaveTextContent('发布 doc-2');
    fireEvent.click(screen.getByRole('button', { name: '刷新 PRD 列表' }));
    expect(screen.queryByRole('region', { name: 'PRD 修订历史' })).not.toBeInTheDocument();
  });

  it('离开PRD页签取消metadata，返回仅重建历史而不复用迟到评审', async () => {
    const late = deferred();
    let metadataSignal: AbortSignal | undefined;
    mockFetch((url, init) => {
      if (pathOf(url).endsWith('/metadata')) {
        metadataSignal = init.signal ?? undefined;
        return late.promise;
      }
      if (pathOf(url).endsWith('/history')) return history([123]);
      return catalog();
    });
    const view = renderPanel();
    await expand();
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布修订信息' }));
    view.update({ active: false });
    expect(metadataSignal?.aborted).toBe(true);
    await act(async () =>
      late.resolve({ status: 200, body: envelope(revision(2, 'doc-1', 'late-review')) }),
    );
    expect(screen.queryByRole('region', { name: '需求 PRD 文档' })).not.toBeInTheDocument();
    view.update({ active: true });
    await screen.findByRole('list', { name: '已加载 PRD 历史' });
    expect(screen.queryByRole('button', { name: '评审当前发布修订' })).not.toBeInTheDocument();
  });
});
