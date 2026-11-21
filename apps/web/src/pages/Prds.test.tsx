import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prds } from './Prds';
import { setCsrfToken } from '../api/client';
import type { DocumentSummary } from '../api/documentSummaries';
import { utf8ToBase64, type RevisionView } from '../api/resources';
import {
  bodyOf,
  envelope,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
  type StubHandler,
  type StubReply,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1, defaultKnowledgeBaseId: 'kb-1' };
const secondProject = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };

function revision(seq: number, documentId = 'doc-1'): RevisionView {
  return {
    id: `${documentId}-rev-${seq}`,
    documentId,
    seq,
    title: `修订标题 ${seq}`,
    mimeType: 'text/markdown; charset=utf-8',
    byteLength: 12,
    digest: `sha256-${seq}`,
    state: seq === 2 ? 'PUBLISHED' : 'CANDIDATE',
    createdBy: 'agent-1',
    basisUnderstandingRevisionId: seq === 3 ? 'understanding-from-other-document' : null,
    deliveryScope: null,
    acceptance: [{ key: 'checkout-submit', text: '提交订单', verification: 'TEST' }],
    reviewRequestId: seq === 3 ? 'review-candidate' : null,
  };
}
const latest = revision(3);
const published = revision(2);
const oldest = revision(1);
const revisions = [latest, published, oldest];

function summaryFor(documentId = 'doc-1', projectId = 'p1', count = 3): DocumentSummary {
  return {
    document: {
      id: documentId,
      projectId,
      knowledgeBaseId: 'kb-1',
      requirementId: 'req-1',
      kind: 'PRD',
      version: 17,
      currentPublishedRevisionId: `${documentId}-rev-2`,
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00.000Z',
    knowledgeBase: { id: 'kb-1', name: '需求', kind: 'BUSINESS' },
    requirement: { id: 'req-1', code: 'REQ-001', title: '订单需求' },
    latestVisibleRevision: { ...revision(count, documentId), state: 'CANDIDATE' },
    publishedRevision: { ...revision(2, documentId), state: 'PUBLISHED' },
    visibleRevisionCount: count,
    candidateRevisionCount: count - 1,
  };
}
const summary = summaryFor();
function pageReply(
  items: unknown[],
  nextCursor: string | null = null,
  total = items.length,
): StubReply {
  return { status: 200, body: envelope({ items, nextCursor, total }) };
}
function historyReply(
  items = revisions,
  nextCursor: string | null = null,
  total = items.length,
  documentVersion = 17,
): StubReply {
  return { status: 200, body: envelope({ items, nextCursor, total, documentVersion }) };
}
function contentReply(revisionId: string, text = `正文 ${revisionId}`): StubReply {
  return {
    status: 200,
    body: envelope({
      revisionId,
      mimeType: 'text/markdown',
      encoding: 'base64',
      bodyBase64: utf8ToBase64(text),
      byteLength: text.length,
      sha256: `sha256-${revisionId}`,
    }),
  };
}
function failure(status: number, code: string, message: string): StubReply {
  return { status, body: { error: { code, message, requestId: 'req-failure' } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function ReviewTarget() {
  const { reviewId } = useParams<{ reviewId: string }>();
  return <div>评审页面 {reviewId}</div>;
}

function renderPrds() {
  return render(
    <MemoryRouter initialEntries={['/prd']}>
      <Routes>
        <Route path="/prd" element={<Prds />} />
        <Route path="/reviews/:reviewId" element={<ReviewTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}
function rowFor(title: string): HTMLElement {
  const row = screen
    .getAllByText(title)
    .map((element) => element.closest('tr'))
    .find((element) => element && within(element).queryByRole('button', { name: /^查看内容/ }));
  if (!row) throw new Error(`找不到行：${title}`);
  return row;
}
function openRevision(title: string) {
  fireEvent.click(within(rowFor(title)).getByRole('button', { name: /^查看内容/ }));
}
function queryOf(url: string) {
  return new URL(url, 'http://localhost').searchParams;
}
function preview(init: RequestInit): StubReply {
  const binding = bodyOf(init);
  return {
    status: 200,
    body: envelope({
      binding,
      actionDigest: 'digest-withdraw',
      display: {
        action: binding.action,
        targetType: binding.targetType,
        targetId: binding.targetId,
        expectedVersion: binding.expectedVersion,
        projectId: binding.projectId,
        roleSlot: binding.roleSlot,
      },
    }),
  };
}

// 所有默认响应均使用真实 summary/history/metadata 契约；旧全量读会立即暴露为失败。
let mock: ReturnType<typeof mockFetch>;
function install(handler?: StubHandler) {
  mock = mockFetch(async (url, init) => {
    const path = pathOf(url);
    if (/\/projects\/[^/]+\/(documents|requirements)$/.test(path) && methodOf(init) === 'GET')
      throw new Error(`PRD 页面禁止全量读：${path}`);
    const custom = await handler?.(url, init);
    if (custom) return custom;
    if (path === '/api/v1/projects')
      return { status: 200, body: envelope([project, secondProject]) };
    if (path === '/api/v1/projects/p1/document-summaries') return pageReply([summary]);
    if (path === '/api/v1/projects/p2/document-summaries')
      return pageReply([summaryFor('doc-p2', 'p2')]);
    const metadata = path.match(/^\/api\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/metadata$/);
    if (metadata) {
      const seq = Number(metadata[2].split('-').at(-1));
      return { status: 200, body: envelope(revision(seq, metadata[1])) };
    }
    const history = path.match(/^\/api\/v1\/documents\/([^/]+)\/history$/);
    if (history) return historyReply(revisions.map((item) => revision(item.seq, history[1])));
    const exactSummary = path.match(/^\/api\/v1\/documents\/([^/]+)\/summary$/);
    if (exactSummary)
      return {
        status: 200,
        body: envelope(summaryFor(exactSummary[1], exactSummary[1] === 'doc-p2' ? 'p2' : 'p1')),
      };
    const content = path.match(/^\/api\/v1\/document-revisions\/([^/]+)\/content$/);
    if (content) return contentReply(content[1]);
    if (path === '/api/v1/auth/action-previews') return preview(init);
    if (path === '/api/v1/auth/confirmation-tickets')
      return {
        status: 201,
        body: envelope({
          ticketId: 'ticket-1',
          ticketSecret: 'secret-1',
          expiresAt: '2026-11-10T12:05:00.000Z',
          actionDigest: 'digest-withdraw',
        }),
      };
    return undefined;
  });
  return mock;
}
function callsMatching(expression: RegExp) {
  return mock.mock.calls.filter(([url]) => expression.test(String(url)));
}
async function confirmWithdrawal() {
  fireEvent.click(await screen.findByRole('button', { name: '撤销发布' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('撤销原因'), { target: { value: '内容有误' } });
  fireEvent.change(await within(dialog).findByLabelText('确认密码'), {
    target: { value: 'secret-pass' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
  await within(dialog).findByText(/票据已签发/);
  fireEvent.click(within(dialog).getByRole('button', { name: '撤销发布' }));
  return dialog;
}

describe('Prds 概要目录、分页历史与准确修订', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });
  afterEach(() => {
    expect(callsMatching(/\/projects\/[^/]+\/(documents|requirements)(\?|$)/)).toHaveLength(0);
    setCsrfToken(null);
    localStorage.clear();
  });

  it('首屏只读概要一页与所选历史一页，关联需求与候选数来自概要', async () => {
    install();
    renderPrds();
    expect(await screen.findByText('已加载 3 / 3 条历史')).toBeInTheDocument();
    expect(screen.getAllByText('REQ-001 · 订单需求').length).toBeGreaterThan(0);
    expect(screen.getByText('2 个候选待处理')).toBeInTheDocument();
    expect(screen.getByText('本页 1 / 共 1 个文档')).toBeInTheDocument();
    const params = queryOf(String(callsMatching(/document-summaries\?/)[0][0]));
    expect(Object.fromEntries(params)).toMatchObject({
      kind: 'PRD',
      searchProfile: 'prd',
      status: 'all',
      limit: '50',
    });
    expect(callsMatching(/\/history\?/)).toHaveLength(1);
    expect(callsMatching(/\/metadata$/)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: '新建 PRD 候选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'PRD 正文' })).not.toBeInTheDocument();
    expect(screen.getByText(/本地 Product Agent 生成并提交候选/)).toBeInTheDocument();
    expect(screen.getByText('未加载（understanding-from-other-document）')).toBeInTheDocument();
  });

  it('搜索与状态筛选请求服务端，保留不在结果页中的阅读对象', async () => {
    install((url) => {
      if (pathOf(url).endsWith('/document-summaries') && queryOf(url).get('q'))
        return pageReply([], null, 0);
      return undefined;
    });
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    fireEvent.change(screen.getByLabelText('搜索 PRD'), {
      target: { value: '历史标题 v1 候选 REQ-001' },
    });
    fireEvent.change(screen.getByLabelText('PRD 状态筛选'), { target: { value: 'candidate' } });
    await waitFor(() => expect(screen.getByText('本页 0 / 共 0 个文档')).toBeInTheDocument());
    expect(screen.getByText(/当前查看的文档不在当前结果页中/)).toBeInTheDocument();
    expect(screen.getByTestId('prd-diff')).toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(1);
    const params = queryOf(String(callsMatching(/document-summaries\?/).at(-1)?.[0]));
    expect(params.get('q')).toBe('历史标题 v1 候选 REQ-001');
    expect(params.get('status')).toBe('candidate');
  });

  it('搜索超过 100 字符明确报错且不截断或发出无效请求', async () => {
    install();
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    const before = callsMatching(/document-summaries\?/).length;
    const text = '界'.repeat(101);
    fireEvent.change(screen.getByLabelText('搜索 PRD'), { target: { value: text } });
    expect(await screen.findByRole('alert')).toHaveTextContent('搜索词最多 100 个字符');
    expect(screen.getByLabelText('搜索 PRD')).toHaveValue(text);
    expect(callsMatching(/document-summaries\?/)).toHaveLength(before);
    expect(screen.getByText('版本与评审')).toBeInTheDocument();
  });

  it('未读历史中的标题命中由服务端返回，不再对概要做客户端二次过滤', async () => {
    const matched = summaryFor('doc-matched');
    matched.latestVisibleRevision = {
      ...matched.latestVisibleRevision!,
      title: '当前展示标题没有搜索词',
    };
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && queryOf(url).get('q')
        ? pageReply([matched])
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    fireEvent.change(screen.getByLabelText('搜索 PRD'), {
      target: { value: '归档税率条款' },
    });
    await screen.findByText('当前展示标题没有搜索词');
    expect(callsMatching(/\/doc-matched\/history\?/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '查看版本' }));
    await waitFor(() => expect(callsMatching(/\/doc-matched\/history\?/)).toHaveLength(1));
  });

  it('目录下一页按需读取，上一页重验权限且翻页不替换阅读对象', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) => summaryFor(`doc-${index + 1}`));
    const last = summaryFor('doc-51');
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? queryOf(url).get('cursor')
          ? pageReply([last], null, 51)
          : pageReply(firstPage, 'catalog-2', 51)
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    expect(callsMatching(/document-summaries\?/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('本页 1 / 共 51 个文档');
    expect(queryOf(String(callsMatching(/document-summaries\?/).at(-1)?.[0])).get('cursor')).toBe(
      'catalog-2',
    );
    expect(screen.getByText(/当前查看的文档不在当前结果页中/)).toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await screen.findByText('本页 50 / 共 51 个文档');
    expect(callsMatching(/document-summaries\?/)).toHaveLength(3);
  });

  it('目录读取中显示骨架，不把未知 total 显示成 0 或空结果', async () => {
    const pending = deferred<StubReply>();
    install((url) => (pathOf(url).endsWith('/document-summaries') ? pending.promise : undefined));
    renderPrds();
    expect((await screen.findByText('正在加载 PRD…')).closest('[role="status"]')).not.toBeNull();
    expect(document.querySelectorAll('.wm-skeleton-row').length).toBeGreaterThan(0);
    expect(screen.queryByText(/该项目还没有 PRD 文档/)).not.toBeInTheDocument();
    expect(screen.queryByText(/共 0 个文档/)).not.toBeInTheDocument();
    pending.resolve(pageReply([summary]));
    await screen.findByText('已加载 3 / 3 条历史');
  });

  it('首次目录失败展示真实错误和重试，不声称文档不存在', async () => {
    let fail = true;
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && fail
        ? failure(500, 'CATALOG_FAILED', '目录不可用')
        : undefined,
    );
    renderPrds();
    expect(await screen.findByRole('alert')).toHaveTextContent('[CATALOG_FAILED] 目录不可用');
    expect(screen.queryByText(/该项目还没有 PRD 文档/)).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新读取文档列表' }));
    await screen.findByText('已加载 3 / 3 条历史');
  });

  it('已有概要后刷新失败保留旧页并标记过期', async () => {
    let fail = false;
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && fail
        ? failure(500, 'CATALOG_FAILED', '刷新失败')
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    expect(await screen.findByText(/当前仍显示上次成功读取的目录页/)).toBeInTheDocument();
    expect(screen.getByText('本页 1 / 共 1 个文档')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '当前' })).toBeInTheDocument();
  });

  it('首历史页外发布有独立卡，准确 metadata 与正文读取不冒充已加载历史', async () => {
    const large = summaryFor('doc-1', 'p1', 123);
    const firstHistory = Array.from({ length: 50 }, (_, index) => revision(123 - index));
    install((url) => {
      if (pathOf(url).endsWith('/document-summaries')) return pageReply([large]);
      if (pathOf(url).endsWith('/history')) return historyReply(firstHistory, 'history-2', 123);
      return undefined;
    });
    renderPrds();
    await screen.findByText('已加载 50 / 123 条历史');
    expect(screen.getByText('122 个候选待处理')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('prd-published-revision')).getByText(/v2 · 修订标题 2/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^查看内容/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布' }));
    await screen.findByText('正文 doc-1-rev-2');
    expect(callsMatching(/\/doc-1\/revisions\/doc-1-rev-2\/metadata$/)).toHaveLength(1);
    expect(screen.getByText('已加载 50 / 123 条历史')).toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^查看内容/ })).toHaveLength(50);
    expect(screen.getByRole('button', { name: '撤销发布' })).toBeEnabled();
  });

  it('加载更多历史保留比较选择，精确 total 不用已加载行数推算', async () => {
    install((url) =>
      pathOf(url).endsWith('/history')
        ? queryOf(url).get('cursor')
          ? historyReply([oldest], null, 3)
          : historyReply([latest, published], 'history-2', 3)
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 2 / 3 条历史');
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: published.id } });
    fireEvent.change(screen.getByLabelText('对比新版本'), { target: { value: latest.id } });
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('已加载 3 / 3 条历史');
    expect(screen.getByLabelText('对比旧版本')).toHaveValue(published.id);
    expect(screen.getByLabelText('对比新版本')).toHaveValue(latest.id);
    expect(screen.queryByRole('button', { name: '加载更多历史' })).not.toBeInTheDocument();
  });

  it('续页失败保留已读历史且同一游标可重试', async () => {
    let fail = true;
    install((url) => {
      if (!pathOf(url).endsWith('/history')) return undefined;
      if (!queryOf(url).get('cursor')) return historyReply([latest, published], 'history-2', 3);
      return fail ? failure(500, 'HISTORY_FAILED', '续页不可用') : historyReply([oldest], null, 3);
    });
    renderPrds();
    await screen.findByText('已加载 2 / 3 条历史');
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('续页不可用');
    expect(screen.getByText('已加载 2 / 3 条历史')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('已加载 3 / 3 条历史');
    const cursorCalls = callsMatching(/\/history\?/).map(([url]) =>
      queryOf(String(url)).get('cursor'),
    );
    expect(cursorCalls).toEqual([null, 'history-2', 'history-2']);
  });

  it('历史 409 使正文和续页失效，显式刷新后恢复', async () => {
    install((url) =>
      pathOf(url).endsWith('/history')
        ? queryOf(url).get('cursor')
          ? failure(409, 'RESOURCE_CONFLICT', 'HISTORY_REFRESH_REQUIRED')
          : historyReply([latest, published], 'history-2', 3)
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 2 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('历史已变化，请刷新历史后继续读取。');
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多历史' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看当前发布' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '刷新历史' }));
    await waitFor(() =>
      expect(screen.queryByText('历史已变化，请刷新历史后继续读取。')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '加载更多历史' })).toBeEnabled();
  });

  it('准确旧版与新版先读 metadata，随后按真实 ID 对比，元数据不算历史行', async () => {
    install((url) =>
      pathOf(url).endsWith('/history') ? historyReply([latest], 'history-2', 123) : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 1 / 123 条历史');
    fireEvent.change(screen.getByLabelText('比较旧修订 ID'), { target: { value: 'doc-1-rev-1' } });
    fireEvent.change(screen.getByLabelText('比较新修订 ID'), {
      target: { value: 'doc-1-rev-120' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取比较版本' }));
    await waitFor(() => expect(screen.getByLabelText('对比新版本')).toHaveValue('doc-1-rev-120'));
    expect(callsMatching(/\/content$/)).toHaveLength(0);
    expect(screen.getByText('已加载 1 / 123 条历史')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '对比所选版本' }));
    const diff = await screen.findByTestId('prd-diff');
    expect(diff).toHaveTextContent('正文 doc-1-rev-1');
    expect(diff).toHaveTextContent('正文 doc-1-rev-120');
    expect(
      callsMatching(/\/content$/)
        .map(([url]) => pathOf(String(url)))
        .sort(),
    ).toEqual([
      '/api/v1/document-revisions/doc-1-rev-1/content',
      '/api/v1/document-revisions/doc-1-rev-120/content',
    ]);
  });

  it('准确目标 404 后清正文和可操作缓存，不替换成已发布版', async () => {
    install((url) =>
      pathOf(url).endsWith('/revisions/missing/metadata')
        ? failure(404, 'NOT_FOUND', '修订不可读取')
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    fireEvent.change(screen.getByLabelText('比较旧修订 ID'), { target: { value: 'missing' } });
    fireEvent.change(screen.getByLabelText('比较新修订 ID'), { target: { value: latest.id } });
    const before = callsMatching(/\/content$/).length;
    fireEvent.click(screen.getByRole('button', { name: '读取比较版本' }));
    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        alert.textContent?.includes('修订不可读取'),
      ),
    ).toBe(true);
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销发布' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('对比旧版本')).not.toBeInTheDocument();
    expect(callsMatching(/\/content$/)).toHaveLength(before);
  });

  it('相同版本不能比较，改选择会立即清旧 diff', async () => {
    install();
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: latest.id } });
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比所选版本' })).toBeDisabled();
    expect(screen.getByText('请选择两个不同的版本再对比。')).toBeInTheDocument();
  });

  it('候选查看仍与独立发布目标自动比较，评审入口保留准确请求 ID', async () => {
    install();
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    const diff = await screen.findByTestId('prd-diff');
    expect(diff).toHaveTextContent('已发布 v2');
    expect(diff).toHaveTextContent('候选 v3');
    fireEvent.click(screen.getByRole('button', { name: '进入评审' }));
    expect(await screen.findByText('评审页面 review-candidate')).toBeInTheDocument();
  });

  it('正文读取有独立 loading，失败后清旧正文并可重试准确目标', async () => {
    const pending = deferred<StubReply>();
    let retry = false;
    install((url) =>
      pathOf(url).endsWith(`/${latest.id}/content`) && !retry ? pending.promise : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    expect(await screen.findByTestId('prd-content-loading')).toHaveTextContent('正在读取文档正文');
    pending.resolve(failure(500, 'CONTENT_FAILED', '正文暂时不可用'));
    expect(await screen.findByRole('alert')).toHaveTextContent('正文暂时不可用');
    expect(screen.queryByTestId('prd-content-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    retry = true;
    openRevision(latest.title);
    expect(await screen.findByTestId('prd-diff')).toHaveTextContent(`正文 ${latest.id}`);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('撤销保留确认票据、准确文档版本及冲突信息', async () => {
    install((url, init) =>
      pathOf(url) === '/api/v1/documents/doc-1/withdraw' && methodOf(init) === 'POST'
        ? failure(409, 'VERSION_CONFLICT', '文档版本已变化')
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    const dialog = await confirmWithdrawal();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 文档版本已变化 · requestId req-failure',
    );
    const call = callsMatching(/\/doc-1\/withdraw$/)[0];
    expect(bodyOf(call[1] ?? {})).toEqual({
      expectedVersion: 17,
      reason: '内容有误',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
    const previewCall = callsMatching(/\/action-previews$/).at(-1);
    expect(bodyOf(previewCall?.[1] ?? {})).toMatchObject({
      targetId: 'doc-1',
      expectedVersion: 17,
      payload: { reason: '内容有误' },
    });
    expect(screen.queryByText(/发布已撤销/)).not.toBeInTheDocument();
  });

  it('撤销成功刷新概要、目录和历史，旧正文与发布指针清空', async () => {
    let withdrawn = false;
    const next = {
      ...summary,
      document: { ...summary.document, version: 18, currentPublishedRevisionId: null },
      publishedRevision: null,
    };
    install((url) => {
      const path = pathOf(url);
      if (path === '/api/v1/documents/doc-1/withdraw') {
        withdrawn = true;
        return { status: 200, body: envelope({}) };
      }
      if (withdrawn && path.endsWith('/document-summaries')) return pageReply([next]);
      if (withdrawn && path.endsWith('/doc-1/summary'))
        return { status: 200, body: envelope(next) };
      if (withdrawn && path.endsWith('/doc-1/history')) return historyReply(revisions, null, 3, 18);
      return undefined;
    });
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    await confirmWithdrawal();
    await screen.findByText(/发布已撤销/);
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prd-published-revision')).not.toBeInTheDocument();
    expect(callsMatching(/document-summaries\?/)).toHaveLength(2);
    expect(callsMatching(/\/doc-1\/summary$/)).toHaveLength(1);
    expect(callsMatching(/\/history\?/)).toHaveLength(2);
  });

  it.each(['success', 'failure'] as const)('旧正文迟到 %s 不覆盖新版本正文', async (completion) => {
    const delayed = deferred<StubReply>();
    install((url) => (pathOf(url).endsWith(`/${latest.id}/content`) ? delayed.promise : undefined));
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await waitFor(() =>
      expect(callsMatching(new RegExp(`/${latest.id}/content$`))).toHaveLength(1),
    );
    openRevision(oldest.title);
    await screen.findByTestId('prd-diff');
    delayed.resolve(
      completion === 'success'
        ? contentReply(latest.id, '迟到旧正文')
        : failure(500, 'OLD_FAILED', '迟到旧失败'),
    );
    await waitFor(() => expect(screen.queryByText(/迟到旧/)).not.toBeInTheDocument());
    expect(screen.getByTestId('prd-diff')).toHaveTextContent(`正文 ${oldest.id}`);
  });

  it('新请求失败后旧成功不会清掉新错误或恢复旧正文', async () => {
    const delayed = deferred<StubReply>();
    install((url) =>
      pathOf(url).endsWith(`/${latest.id}/content`)
        ? delayed.promise
        : pathOf(url).endsWith(`/${oldest.id}/content`)
          ? failure(500, 'NEW_FAILED', '新读取失败')
          : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await waitFor(() =>
      expect(callsMatching(new RegExp(`/${latest.id}/content$`))).toHaveLength(1),
    );
    openRevision(oldest.title);
    expect(await screen.findByRole('alert')).toHaveTextContent('新读取失败');
    delayed.resolve(contentReply(latest.id, '旧成功正文'));
    await waitFor(() => expect(screen.queryByText('旧成功正文')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('新读取失败');
  });

  it('切文档让在途正文失效，新文档按需取得历史', async () => {
    const delayed = deferred<StubReply>();
    const second = summaryFor('doc-second');
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? pageReply([summary, second])
        : pathOf(url).endsWith(`/${latest.id}/content`)
          ? delayed.promise
          : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await waitFor(() =>
      expect(callsMatching(new RegExp(`/${latest.id}/content$`))).toHaveLength(1),
    );
    fireEvent.click(screen.getByRole('button', { name: '查看版本' }));
    await waitFor(() => expect(callsMatching(/\/doc-second\/history\?/)).toHaveLength(1));
    delayed.resolve(contentReply(latest.id, '上一文档正文'));
    await waitFor(() => expect(screen.queryByText('上一文档正文')).not.toBeInTheDocument());
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
  });

  it('项目切换后旧目录与正文迟到不能污染新项目', async () => {
    const delayedCatalog = deferred<StubReply>();
    const delayedBody = deferred<StubReply>();
    let refreshed = false;
    install((url) => {
      if (pathOf(url) === '/api/v1/projects/p1/document-summaries' && refreshed)
        return delayedCatalog.promise;
      if (pathOf(url).endsWith(`/${latest.id}/content`)) return delayedBody.promise;
      return undefined;
    });
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await waitFor(() =>
      expect(callsMatching(new RegExp(`/${latest.id}/content$`))).toHaveLength(1),
    );
    refreshed = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    await waitFor(() => expect(callsMatching(/\/doc-p2\/history\?/)).toHaveLength(1));
    delayedCatalog.resolve(pageReply([summary]));
    delayedBody.resolve(contentReply(latest.id, '旧项目正文'));
    await waitFor(() => expect(screen.queryByText('旧项目正文')).not.toBeInTheDocument());
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(callsMatching(/\/doc-1\/history\?/)).toHaveLength(2);
  });

  it('目录权限失败清除独立阅读对象与操作，不降级旧读取', async () => {
    let denied = false;
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && denied
        ? failure(403, 'FORBIDDEN', '项目权限已撤销')
        : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    openRevision(latest.title);
    await screen.findByTestId('prd-diff');
    denied = true;
    fireEvent.change(screen.getByLabelText('搜索 PRD'), { target: { value: '权限重验' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('项目权限已撤销');
    expect(screen.queryByTestId('prd-diff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销发布' })).not.toBeInTheDocument();
    expect(screen.queryByText('版本与评审')).not.toBeInTheDocument();
  });

  it('改变比较输入后在途精确 metadata 不得恢复旧选择', async () => {
    const delayed = deferred<StubReply>();
    install((url) =>
      pathOf(url).endsWith('/revisions/doc-1-rev-120/metadata') ? delayed.promise : undefined,
    );
    renderPrds();
    await screen.findByText('已加载 3 / 3 条历史');
    fireEvent.change(screen.getByLabelText('比较旧修订 ID'), { target: { value: oldest.id } });
    fireEvent.change(screen.getByLabelText('比较新修订 ID'), {
      target: { value: 'doc-1-rev-120' },
    });
    fireEvent.click(screen.getByRole('button', { name: '读取比较版本' }));
    await waitFor(() => expect(callsMatching(/\/doc-1-rev-120\/metadata$/)).toHaveLength(1));
    fireEvent.change(screen.getByLabelText('比较新修订 ID'), { target: { value: latest.id } });
    delayed.resolve({ status: 200, body: envelope(revision(120)) });
    await waitFor(() => expect(screen.getByLabelText('对比新版本')).toHaveValue(''));
    expect(screen.getByRole('button', { name: '对比所选版本' })).toBeDisabled();
    expect(callsMatching(/\/content$/)).toHaveLength(0);
  });
});
