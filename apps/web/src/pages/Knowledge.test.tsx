import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Knowledge } from './Knowledge';
import { setCsrfToken } from '../api/client';
import type { DocumentCatalogOverview } from '../api/documentCatalog';
import type { DocumentSummary } from '../api/documentSummaries';
import { utf8ToBase64, type KnowledgeBaseKind, type RevisionView } from '../api/resources';
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
    title: `修订 ${documentId} v${seq}`,
    mimeType: 'text/markdown',
    byteLength: 20,
    digest: `sha256-${documentId}-${seq}`,
    state: seq === 2 ? 'PUBLISHED' : 'CANDIDATE',
    createdBy: 'agent-1',
    basisUnderstandingRevisionId: seq === 3 ? 'understanding-other-document' : null,
    deliveryScope: null,
    acceptance: [{ key: 'order-submit', text: '提交订单', verification: 'TEST' }],
    reviewRequestId: seq === 3 ? 'review-candidate' : null,
  };
}
function summaryFor(
  documentId = 'doc-1',
  projectId = 'p1',
  count = 3,
  kind: KnowledgeBaseKind = 'BUSINESS',
): DocumentSummary {
  return {
    document: {
      id: documentId,
      projectId,
      knowledgeBaseId: `kb-${kind}`,
      requirementId: 'req-1',
      kind: 'KNOWLEDGE',
      version: 17,
      currentPublishedRevisionId: `${documentId}-rev-2`,
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00.000Z',
    knowledgeBase: { id: `kb-${kind}`, name: `${kind} 知识库`, kind },
    requirement: { id: 'req-1', code: 'REQ-001', title: '订单需求' },
    latestVisibleRevision: { ...revision(count, documentId), state: 'CANDIDATE' },
    publishedRevision: { ...revision(2, documentId), state: 'PUBLISHED' },
    visibleRevisionCount: count,
    candidateRevisionCount: count - 1,
  };
}
const summary = summaryFor();
const revisions = [revision(3), revision(2), revision(1)];
const kinds: KnowledgeBaseKind[] = ['BUSINESS', 'SYSTEM', 'PRACTICE'];
function overviewFor(items: DocumentSummary[] = [summary]): DocumentCatalogOverview {
  return {
    total: items.length,
    totalsByDocumentKind: { KNOWLEDGE: items.length, UNDERSTANDING: 0, DECISION: 0, PRD: 0 },
    collections: kinds.map((kind) => ({
      knowledgeBaseKind: kind,
      knowledgeBaseCount: 1,
      documentCount: items.filter((item) => item.knowledgeBase.kind === kind).length,
      recentItems: items.filter((item) => item.knowledgeBase.kind === kind).slice(0, 2),
    })),
  };
}
function knowledgeBase(kind: KnowledgeBaseKind) {
  return {
    id: `kb-${kind}`,
    projectId: 'p1',
    key: kind.toLowerCase(),
    name: `${kind} 知识库`,
    kind,
    visibility: 'PROJECT',
    version: 1,
    authzVersion: 1,
    publicationApproverUserId: 'user-1',
    publicationApproverRoleId: null,
    archivedAt: null,
  };
}
function searchResult(
  documentId = 'doc-1',
  seq = 2,
  kind: KnowledgeBaseKind = 'BUSINESS',
  status = 'PUBLISHED',
) {
  return {
    knowledgeBaseId: `kb-${kind}`,
    knowledgeBaseName: `${kind} 知识库`,
    knowledgeBaseKind: kind,
    documentId,
    revisionId: `${documentId}-rev-${seq}`,
    documentKind: 'KNOWLEDGE',
    status,
    title: `搜索命中 ${documentId} v${seq}`,
    excerpt: '正文中的业务规则摘要',
    sha256: `sha-${documentId}`,
  };
}
function reply(data: unknown): StubReply {
  return { status: 200, body: envelope(data) };
}
function pageReply(
  items: unknown[],
  nextCursor: string | null = null,
  total = items.length,
): StubReply {
  return reply({ items, nextCursor, total });
}
function historyReply(
  items = revisions,
  nextCursor: string | null = null,
  total = items.length,
  documentVersion = 17,
): StubReply {
  return reply({ items, nextCursor, total, documentVersion });
}
function searchReply(
  items: unknown[],
  nextCursor: string | null = null,
  truncated = false,
): StubReply {
  return reply({ items, nextCursor, hasMore: nextCursor !== null, truncated });
}
function contentReply(revisionId: string, text = `正文 ${revisionId}`): StubReply {
  return reply({
    revisionId,
    mimeType: 'text/markdown',
    encoding: 'base64',
    bodyBase64: utf8ToBase64(text),
    byteLength: text.length,
    sha256: `sha256-${revisionId}`,
  });
}
function failure(status: number, code = 'UNAVAILABLE', message = '服务暂不可用'): StubReply {
  return { status, body: { error: { code, message, requestId: 'test-failure' } } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
function queryOf(url: string) {
  return new URL(url, 'http://localhost').searchParams;
}
async function settle(
  pending: { promise: Promise<StubReply>; resolve: (value: StubReply) => void },
  value: StubReply,
) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}
let mock: ReturnType<typeof mockFetch>;
function install(handler?: StubHandler) {
  mock = mockFetch(async (url, init) => {
    const path = pathOf(url);
    if (
      (/\/projects\/[^/]+\/(documents|requirements)$/.test(path) ||
        /^\/api\/v1\/documents\/[^/]+$/.test(path)) &&
      methodOf(init) === 'GET'
    )
      throw new Error(`Knowledge 禁止全量详情或需求索引：${path}`);
    const custom = await handler?.(url, init);
    if (custom) return custom;
    if (path === '/api/v1/projects') return reply([project, secondProject]);
    if (path === '/api/v1/projects/p1/document-summaries') return pageReply([summary]);
    if (path === '/api/v1/projects/p2/document-summaries')
      return pageReply([summaryFor('doc-p2', 'p2')]);
    if (path.endsWith('/document-summary-overview'))
      return reply(overviewFor(path.includes('/p2/') ? [summaryFor('doc-p2', 'p2')] : [summary]));
    if (path.endsWith('/knowledge-bases'))
      return reply({ items: kinds.map(knowledgeBase), nextCursor: null, hasMore: false });
    if (/\/knowledge-bases\/[^/]+\/search$/.test(path)) return searchReply([]);
    if (path.endsWith('/roles'))
      return reply([{ id: 'role-1', projectId: 'p1', key: 'backend', title: '后端', version: 1 }]);
    if (path === '/api/v1/workbench')
      return reply({
        counts: { reviews: 0, changes: 0, readyTasks: 1, total: 1 },
        reviews: [],
        changes: [],
        readyTasks: [
          {
            taskId: 'task-1',
            projectId: 'p1',
            projectKey: 'DEMO',
            projectName: 'Demo',
            requirement: null,
            role: { key: 'backend', title: '后端' },
            stepKey: 'impl',
            executionStatus: 'READY',
            workStatus: 'ACTIVE',
            ageSeconds: 10,
          },
        ],
        warnings: [],
      });
    if (path.endsWith('/units') || path.endsWith('/unit-dependencies')) return reply([]);
    const metadata = path.match(/^\/api\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/metadata$/);
    if (metadata) return reply(revision(Number(metadata[2].split('-').at(-1)), metadata[1]));
    const history = path.match(/^\/api\/v1\/documents\/([^/]+)\/history$/);
    if (history) return historyReply(revisions.map((item) => revision(item.seq, history[1])));
    const exact = path.match(/^\/api\/v1\/documents\/([^/]+)\/summary$/);
    if (exact) return reply(summaryFor(exact[1], exact[1] === 'doc-p2' ? 'p2' : 'p1'));
    const content = path.match(/^\/api\/v1\/document-revisions\/([^/]+)\/content$/);
    if (content) return contentReply(content[1]);
    if (path === '/api/v1/auth/action-previews') {
      const binding = bodyOf(init);
      return reply({
        binding,
        actionDigest: 'withdraw-digest',
        display: {
          action: binding.action,
          targetType: binding.targetType,
          targetId: binding.targetId,
          expectedVersion: binding.expectedVersion,
          projectId: binding.projectId,
          roleSlot: binding.roleSlot,
        },
      });
    }
    if (path === '/api/v1/auth/confirmation-tickets')
      return {
        status: 201,
        body: envelope({
          ticketId: 'ticket-1',
          ticketSecret: 'secret-1',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          actionDigest: 'withdraw-digest',
        }),
      };
    return undefined;
  });
  return mock;
}
function callsMatching(expression: RegExp) {
  return mock.mock.calls.filter(([url]) => expression.test(String(url)));
}
function ReviewTarget() {
  return <p>评审页面 {useParams().reviewId}</p>;
}
function renderKnowledge() {
  return render(
    <MemoryRouter initialEntries={['/knowledge']}>
      <Routes>
        <Route path="/knowledge" element={<Knowledge />} />
        <Route path="/reviews/:reviewId" element={<ReviewTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}
function itemFor(documentId = 'doc-1'): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('.collection-document-item')].find(
    (element) => element.textContent?.includes(`修订 ${documentId} `),
  );
  if (!item) throw new Error(`找不到文档 ${documentId}`);
  return item;
}
async function openGovernance(documentId = 'doc-1') {
  await screen.findByText(/当前页 .*共 .* 篇/);
  fireEvent.click(
    within(itemFor(documentId)).getByRole('button', { name: /查看版本|版本与评审（当前）/ }),
  );
  await screen.findByText(/已加载 .* 条历史/);
}
function rowFor(seq: number, documentId = 'doc-1'): HTMLElement {
  const row = screen
    .getAllByText(`修订 ${documentId} v${seq}`)
    .map((node) => node.closest('tr'))
    .find(Boolean);
  if (!row) throw new Error(`找不到修订 ${seq}`);
  return row;
}
async function search(text = '业务规则') {
  fireEvent.change(screen.getByLabelText('搜索项目知识'), { target: { value: text } });
  await waitFor(() => expect(callsMatching(/\/search\?/).length).toBeGreaterThan(0));
}
async function switchToSecondProject() {
  await screen.findByRole('option', { name: 'Ops（OPS）' });
  await waitFor(() => expect(screen.getByLabelText('选择项目')).toBeEnabled());
  fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
  await waitFor(() => expect(screen.getByLabelText('选择项目')).toHaveValue('p2'));
}
async function confirmWithdrawal() {
  fireEvent.click(await screen.findByRole('button', { name: '撤销发布' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('撤销原因'), {
    target: { value: '业务规则错误' },
  });
  fireEvent.change(await within(dialog).findByLabelText('确认密码'), {
    target: { value: 'secret-pass' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
  await within(dialog).findByText(/票据已签发/);
  fireEvent.click(within(dialog).getByRole('button', { name: '撤销发布' }));
  return dialog;
}

describe('Knowledge 概要目录、门户、分页历史与准确正文', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });
  afterEach(() => {
    expect(callsMatching(/\/projects\/[^/]+\/(documents|requirements)(\?|$)/)).toHaveLength(0);
    expect(
      callsMatching(/\/documents\/[^/?]+$/).filter(([, init]) => methodOf(init ?? {}) === 'GET'),
    ).toHaveLength(0);
    setCsrfToken(null);
    localStorage.clear();
  });

  it('首屏仅请求一页目录与独立门户，不自动选择或预读历史', async () => {
    install();
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    expect(await screen.findByText('项目共 1 篇可浏览文档')).toBeInTheDocument();
    expect(callsMatching(/document-summaries\?/)).toHaveLength(1);
    expect(callsMatching(/document-summary-overview/)).toHaveLength(1);
    expect(callsMatching(/\/history\?|\/metadata$|\/content$/)).toHaveLength(0);
    const params = queryOf(String(callsMatching(/document-summaries\?/)[0][0]));
    expect(params.get('limit')).toBe('50');
    expect(params.get('searchProfile')).toBe('knowledge');
  });

  it('关联需求与候选数量直接来自概要，跨文档基线保留未加载引用', async () => {
    install();
    renderKnowledge();
    await openGovernance();
    expect(screen.getByText(/2 个候选待处理 · REQ-001 · 订单需求/)).toBeInTheDocument();
    expect(screen.getByText('未加载（understanding-other-document）')).toBeInTheDocument();
    expect(callsMatching(/understanding-other-document/)).toHaveLength(0);
  });

  it('绑定需求不可读时明确显示，不误报未关联', async () => {
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? pageReply([{ ...summary, requirement: null }])
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    expect(screen.getAllByText(/关联需求暂不可读（req-1）/).length).toBeGreaterThan(0);
  });

  it('目录搜索和类型筛选交给服务端，未加载历史命中不做客户端二次过滤', async () => {
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && queryOf(url).get('q')
        ? pageReply([summaryFor('doc-hit')])
        : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    fireEvent.change(screen.getByLabelText('搜索文档'), {
      target: { value: '历史独有标题 v7 候选 REQ-001' },
    });
    fireEvent.change(screen.getByLabelText('文档类型筛选'), { target: { value: 'KNOWLEDGE' } });
    await screen.findByText('修订 doc-hit v2');
    const params = queryOf(String(callsMatching(/document-summaries\?/).at(-1)?.[0]));
    expect(params.get('q')).toBe('历史独有标题 v7 候选 REQ-001');
    expect(params.get('kind')).toBe('KNOWLEDGE');
    expect(callsMatching(/\/history\?/)).toHaveLength(0);
  });

  it('目录100字符限制明确报错而正文搜索接受500字符', async () => {
    install();
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    const before = callsMatching(/document-summaries\?/).length;
    fireEvent.change(screen.getByLabelText('搜索文档'), { target: { value: '界'.repeat(101) } });
    expect(await screen.findByText(/搜索词最多 100 个字符/)).toBeInTheDocument();
    expect(callsMatching(/document-summaries\?/)).toHaveLength(before);
    await search('界'.repeat(500));
    expect(queryOf(String(callsMatching(/\/search\?/)[0][0])).get('q')).toHaveLength(500);
    const count = callsMatching(/\/search\?/).length;
    fireEvent.change(screen.getByLabelText('搜索项目知识'), {
      target: { value: '界'.repeat(501) },
    });
    await screen.findByText(/正文搜索最多支持 500 个字符/);
    expect(callsMatching(/\/search\?/)).toHaveLength(count);
  });

  it('107篇目录只按需读取50/50/7，上一页重新取数且选中文档独立保留', async () => {
    const items = Array.from({ length: 107 }, (_, index) => summaryFor(`doc-${index + 1}`));
    install((url) => {
      if (!pathOf(url).endsWith('/document-summaries')) return undefined;
      const cursor = queryOf(url).get('cursor');
      return cursor === 'catalog-3'
        ? pageReply(items.slice(100), null, 107)
        : cursor === 'catalog-2'
          ? pageReply(items.slice(50, 100), 'catalog-3', 107)
          : pageReply(items.slice(0, 50), 'catalog-2', 107);
    });
    renderKnowledge();
    await openGovernance();
    expect(callsMatching(/document-summaries\?/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('修订 doc-51 v2');
    expect(screen.getByText(/不在当前结果页/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByText('当前页 7 / 共 107 篇');
    fireEvent.click(screen.getByRole('button', { name: '上一页' }));
    await screen.findByText('当前页 50 / 共 107 篇');
    expect(callsMatching(/document-summaries\?/)).toHaveLength(4);
    expect(callsMatching(/\/history\?/)).toHaveLength(1);
  });

  it('目录重复游标停止续页，不自动扫完所有文档', async () => {
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? pageReply([summary], 'same-cursor', 107)
        : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 107 篇');
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
    expect(callsMatching(/document-summaries\?/)).toHaveLength(2);
  });

  it('目录503刷新保留过期快照，门户与正文搜索仍独立可用', async () => {
    let fail = false;
    install((url) =>
      pathOf(url).endsWith('/document-summaries') && fail ? failure(503) : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    await screen.findByText(/当前仍显示上次成功读取的目录页/);
    expect(screen.getByText('当前页 1 / 共 1 篇')).toBeInTheDocument();
    await search();
    expect(callsMatching(/\/search\?/)).toHaveLength(3);
  });

  it('门户准确统计107篇和三类知识库，最近更新独立于目录当前页', async () => {
    const data = overviewFor([
      summaryFor('outside'),
      summaryFor('sys', 'p1', 3, 'SYSTEM'),
      summaryFor('practice', 'p1', 3, 'PRACTICE'),
    ]);
    data.total = 107;
    data.collections[0].documentCount = 105;
    data.collections[0].knowledgeBaseCount = 2;
    install((url) =>
      pathOf(url).endsWith('/document-summary-overview') ? reply(data) : undefined,
    );
    renderKnowledge();
    await screen.findByText('项目共 107 篇可浏览文档');
    const portal = screen.getByTestId('knowledge-overview');
    expect(within(portal).getByText(/105 篇可浏览文档/)).toHaveTextContent('2 个知识库');
    expect(within(portal).getByText('修订 outside v2')).toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(0);
  });

  it('门户首次失败与目录无关，重读失败保留统计并明确过期', async () => {
    let fail = true;
    install((url) =>
      pathOf(url).endsWith('/document-summary-overview') && fail ? failure(503) : undefined,
    );
    renderKnowledge();
    await screen.findByText(/门户统计读取失败/);
    expect(screen.getByText('当前页 1 / 共 1 篇')).toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-agent-guide')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '重新读取门户' }));
    await screen.findByText('项目共 1 篇可浏览文档');
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '重新读取门户' }));
    await screen.findByText(/统计可能已过期，当前保留上次成功结果/);
    expect(screen.getByText(/项目共 1 篇可浏览文档/)).toBeInTheDocument();
  });

  it('筛选零结果不能触发项目空态；成功项目total=0才显示Agent角色任务与CLI引导', async () => {
    let empty = false;
    install((url) => {
      if (pathOf(url).endsWith('/document-summaries')) return pageReply([], null, 0);
      if (pathOf(url).endsWith('/document-summary-overview') && empty)
        return reply(overviewFor([]));
      return undefined;
    });
    renderKnowledge();
    await screen.findByText('当前页 0 / 共 0 篇');
    expect(screen.queryByTestId('knowledge-agent-guide')).not.toBeInTheDocument();
    empty = true;
    fireEvent.click(screen.getByRole('button', { name: '重新读取门户' }));
    await screen.findByTestId('knowledge-agent-guide');
    expect(await screen.findByText('后端（backend）')).toBeInTheDocument();
    expect(screen.getByText(/1 项前置已完成的团队任务/)).toBeInTheDocument();
    expect(screen.getByText('workmesh auth login')).toBeInTheDocument();
    expect(screen.getByText(/workmesh claim --task/)).toBeInTheDocument();
  });

  it('初次目录和门户读取期间显示骨架，不显示未知的0计数与空项目引导', async () => {
    const catalog = deferred<StubReply>();
    const overview = deferred<StubReply>();
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? catalog.promise
        : pathOf(url).endsWith('/document-summary-overview')
          ? overview.promise
          : undefined,
    );
    renderKnowledge();
    expect((await screen.findByText('正在加载文档…')).closest('[role="status"]')).not.toBeNull();
    expect(
      document.querySelectorAll('.collection-document-loading .skeleton-line').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/共 0 篇/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-agent-guide')).not.toBeInTheDocument();
    catalog.resolve(pageReply([summary]));
    overview.resolve(reply(overviewFor()));
    await screen.findByText('当前页 1 / 共 1 篇');
  });
  it('首50条历史之外的当前发布按准确metadata读取，计数不冒充多加载历史', async () => {
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? pageReply([summaryFor('doc-1', 'p1', 123)])
        : pathOf(url).endsWith('/history')
          ? historyReply(
              Array.from({ length: 50 }, (_, index) => revision(123 - index)),
              'h2',
              123,
            )
          : undefined,
    );
    renderKnowledge();
    await openGovernance();
    expect(screen.getByText('已加载 50 / 123 条历史')).toBeInTheDocument();
    expect(screen.getByText(/122 个候选待处理/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布' }));
    await screen.findByText('正文 doc-1-rev-2');
    expect(callsMatching(/\/doc-1\/revisions\/doc-1-rev-2\/metadata$/)).toHaveLength(1);
    expect(screen.getByText('已加载 50 / 123 条历史')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^查看正文/ })).toHaveLength(50);
  });

  it('历史按50/50/23主动续页并保留比较选择', async () => {
    install((url) => {
      if (!pathOf(url).endsWith('/history')) return undefined;
      const cursor = queryOf(url).get('cursor');
      const top = cursor === 'h3' ? 23 : cursor === 'h2' ? 73 : 123;
      return historyReply(
        Array.from({ length: cursor === 'h3' ? 23 : 50 }, (_, index) => revision(top - index)),
        cursor === 'h3' ? null : cursor === 'h2' ? 'h3' : 'h2',
        123,
      );
    });
    renderKnowledge();
    await openGovernance();
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: 'doc-1-rev-2' } });
    fireEvent.change(screen.getByLabelText('对比新版本'), { target: { value: 'doc-1-rev-123' } });
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('已加载 100 / 123 条历史');
    expect(screen.getByLabelText('对比旧版本')).toHaveValue('doc-1-rev-2');
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('已加载 123 / 123 条历史');
    expect(screen.queryByRole('button', { name: '加载更多历史' })).not.toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(3);
  });

  it('历史503续页保留已读行并可重试同一游标', async () => {
    let fail = true;
    install((url) =>
      pathOf(url).endsWith('/history')
        ? queryOf(url).get('cursor')
          ? fail
            ? failure(503)
            : historyReply([revision(1)], null, 3)
          : historyReply([revision(3), revision(2)], 'h2', 3)
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByRole('alert');
    expect(screen.getByText('已加载 2 / 3 条历史')).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('已加载 3 / 3 条历史');
    expect(callsMatching(/\/history\?.*cursor=h2/)).toHaveLength(2);
  });

  it.each(['409', 'total', 'version', 'cursor'])('历史%s变化停止续页并要求刷新', async (mode) => {
    install((url) =>
      pathOf(url).endsWith('/history')
        ? queryOf(url).get('cursor')
          ? mode === '409'
            ? failure(409, 'HISTORY_CHANGED')
            : historyReply(
                [revision(1)],
                mode === 'cursor' ? 'h2' : null,
                mode === 'total' ? 4 : 3,
                mode === 'version' ? 18 : 17,
              )
          : historyReply([revision(3), revision(2)], 'h2', 3)
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText('历史已变化，请刷新历史后继续读取。');
    expect(screen.getByRole('button', { name: '查看当前发布' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '刷新历史' })).toBeEnabled();
  });

  it.each([401, 403, 404])('历史续页%s清除历史、准确缓存、正文和写操作', async (status) => {
    install((url) =>
      pathOf(url).endsWith('/history')
        ? queryOf(url).get('cursor')
          ? failure(status)
          : historyReply([revision(3)], 'h2', 3)
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布' }));
    await screen.findByText('正文 doc-1-rev-2');
    fireEvent.click(screen.getByRole('button', { name: '加载更多历史' }));
    await screen.findByText(/当前文档已不可读取/);
    expect(screen.queryByText('正文 doc-1-rev-2')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销发布' })).not.toBeInTheDocument();
    expect(screen.queryByText('修订 doc-1 v3')).not.toBeInTheDocument();
  });

  it('精确比较页外seq2/seq7仅取metadata，确认比较后取两正文并提供可读差异', async () => {
    install((url) =>
      pathOf(url).endsWith('/history') ? historyReply([revision(123)], 'h2', 123) : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.change(screen.getByLabelText('比较旧修订 ID'), { target: { value: 'doc-1-rev-2' } });
    fireEvent.change(screen.getByLabelText('比较新修订 ID'), { target: { value: 'doc-1-rev-7' } });
    fireEvent.click(screen.getByRole('button', { name: '读取比较版本' }));
    await waitFor(() => expect(screen.getByLabelText('对比新版本')).toHaveValue('doc-1-rev-7'));
    expect(callsMatching(/\/content$/)).toHaveLength(0);
    expect(screen.getByText('已加载 1 / 123 条历史')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '对比所选版本' }));
    const diff = await screen.findByTestId('knowledge-diff');
    expect(within(diff).getByText('已发布 v2 → 候选 v7')).toBeInTheDocument();
    expect(within(diff).getByText('正文 doc-1-rev-2')).toBeInTheDocument();
    expect(within(diff).getByText('正文 doc-1-rev-7')).toBeInTheDocument();
    expect(within(diff).getByRole('button', { name: '仅看修改' })).toBeInTheDocument();
    expect(
      callsMatching(/\/metadata$/)
        .map(([url]) => pathOf(String(url)))
        .sort(),
    ).toEqual([
      '/api/v1/documents/doc-1/revisions/doc-1-rev-2/metadata',
      '/api/v1/documents/doc-1/revisions/doc-1-rev-7/metadata',
    ]);
    expect(
      callsMatching(/\/content$/)
        .map(([url]) => pathOf(String(url)))
        .sort(),
    ).toEqual([
      '/api/v1/document-revisions/doc-1-rev-2/content',
      '/api/v1/document-revisions/doc-1-rev-7/content',
    ]);
  });

  it('相同版本禁用比较，选新配对立即清除旧正文与差异', async () => {
    install();
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: '查看正文' }));
    await screen.findByTestId('knowledge-diff');
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: 'doc-1-rev-3' } });
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比所选版本' })).toBeDisabled();
    expect(screen.getByText('请选择两个不同的版本再对比。')).toBeInTheDocument();
  });

  it('手动比较失败清除旧差异，重试按准确修订读取', async () => {
    let fail = false;
    install((url) =>
      pathOf(url).endsWith('/doc-1-rev-1/content') && fail
        ? failure(503, 'BODY_FAILED', '比较失败')
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: '查看正文' }));
    await screen.findByTestId('knowledge-diff');
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: 'doc-1-rev-1' } });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: '对比所选版本' }));
    await screen.findByText(/比较失败/);
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '对比所选版本' }));
    await screen.findByTestId('knowledge-diff');
  });

  it('慢旧正文不能覆盖随后选择的新修订', async () => {
    const slow = deferred<StubReply>();
    install((url) => (pathOf(url).endsWith('/doc-1-rev-1/content') ? slow.promise : undefined));
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(1)).getByRole('button', { name: '查看正文' }));
    await waitFor(() => expect(callsMatching(/doc-1-rev-1\/content$/)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: '查看当前发布' }));
    await screen.findByText('正文 doc-1-rev-2');
    await settle(slow, contentReply('doc-1-rev-1', '过期正文'));
    await waitFor(() => expect(screen.queryByText('过期正文')).not.toBeInTheDocument());
  });

  it('切换文档和返回知识库时迟到正文不能复活旧选择', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url).endsWith('/document-summaries')
        ? pageReply([summary, summaryFor('doc-2')])
        : pathOf(url).endsWith('/doc-1-rev-1/content')
          ? slow.promise
          : undefined,
    );
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(1)).getByRole('button', { name: '查看正文' }));
    await waitFor(() => expect(callsMatching(/doc-1-rev-1\/content$/)).toHaveLength(1));
    fireEvent.click(within(itemFor('doc-2')).getByRole('button', { name: '阅读当前版本' }));
    await screen.findByText('正文 doc-2-rev-2');
    await settle(slow, contentReply('doc-1-rev-1', '过期旧文档'));
    fireEvent.click(screen.getByRole('button', { name: '← 返回知识库' }));
    expect(screen.queryByText('过期旧文档')).not.toBeInTheDocument();
    expect(screen.getByLabelText('文档列表')).toBeInTheDocument();
  });
  it('项目切换清除旧目录，旧项目目录迟到不覆盖新项目', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/projects/p1/document-summaries' ? slow.promise : undefined,
    );
    renderKnowledge();
    await waitFor(() =>
      expect(callsMatching(/\/projects\/p1\/document-summaries\?/)).toHaveLength(1),
    );
    await switchToSecondProject();
    await within(await screen.findByLabelText('文档列表')).findByText('修订 doc-p2 v2');
    await settle(slow, pageReply([summary]));
    await waitFor(() => expect(screen.queryByText('修订 doc-1 v2')).not.toBeInTheDocument());
    expect(
      within(screen.getByLabelText('文档列表')).getByText('修订 doc-p2 v2'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();
    expect(callsMatching(/\/history\?/)).toHaveLength(0);
  });

  it('旧项目门户成功迟到不覆盖新项目统计', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/projects/p1/document-summary-overview' ? slow.promise : undefined,
    );
    renderKnowledge();
    await waitFor(() =>
      expect(callsMatching(/\/projects\/p1\/document-summary-overview$/)).toHaveLength(1),
    );
    await switchToSecondProject();
    await screen.findByText('项目共 1 篇可浏览文档');
    const data = overviewFor();
    data.total = 999;
    await settle(slow, reply(data));
    await waitFor(() => expect(screen.queryByText(/项目共 999/)).not.toBeInTheDocument());
    expect(screen.getByText('项目共 1 篇可浏览文档')).toBeInTheDocument();
    expect(callsMatching(/\/projects\/p2\/document-summary-overview$/)).toHaveLength(1);
  });

  it('旧项目门户失败迟到不能污染新项目错误和loading', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/projects/p1/document-summary-overview' ? slow.promise : undefined,
    );
    renderKnowledge();
    await waitFor(() =>
      expect(callsMatching(/\/projects\/p1\/document-summary-overview$/)).toHaveLength(1),
    );
    await switchToSecondProject();
    await screen.findByText('项目共 1 篇可浏览文档');
    await settle(slow, failure(503, 'OLD_PROJECT', '旧项目失败'));
    await waitFor(() => expect(screen.queryByText(/旧项目失败/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重新读取门户' })).toBeEnabled();
    expect(screen.getByText('项目共 1 篇可浏览文档')).toBeInTheDocument();
    expect(callsMatching(/\/projects\/p2\/document-summary-overview$/)).toHaveLength(1);
  });

  it('正文搜索按三库独立请求并显示摘要，集合范围只查询所选类别', async () => {
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-SYSTEM/search'
        ? searchReply([searchResult('sys', 2, 'SYSTEM')])
        : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    expect(await screen.findByText('搜索命中 sys v2')).toBeInTheDocument();
    expect(screen.getByText('正文中的业务规则摘要')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('知识搜索范围'), { target: { value: 'PRACTICE' } });
    await screen.findByText('没有找到匹配的已发布知识');
    expect(String(callsMatching(/\/search\?/).at(-1)?.[0])).toContain('kb-PRACTICE');
  });

  it('正文搜索保留逐库游标、部分失败和truncated，不把结果数当全项目总量', async () => {
    let fail = true;
    install((url) => {
      if (!pathOf(url).includes('/search')) return undefined;
      if (pathOf(url).includes('kb-SYSTEM')) return failure(503);
      if (pathOf(url).includes('kb-PRACTICE')) return searchReply([]);
      if (queryOf(url).get('cursor'))
        return fail ? failure(503) : searchReply([searchResult('second')]);
      return searchReply([searchResult('first')], 'body-2', true);
    });
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    await screen.findByText('搜索命中 first v2');
    expect(screen.getByText(/达到扫描范围/)).toBeInTheDocument();
    expect(screen.getByText(/搜索暂时失败，当前结果可能不完整/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }));
    await screen.findByText(/部分知识库搜索暂时失败/);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }));
    await screen.findByText('搜索命中 second v2');
    expect(callsMatching(/cursor=body-2/)).toHaveLength(2);
    expect(screen.getByText('项目共 1 篇可浏览文档')).toBeInTheDocument();
  });

  it('页外正文命中走singleton概要和准确修订，绝不追加目录或回退当前发布', async () => {
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
        ? searchReply([searchResult('outside', 7)])
        : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    fireEvent.click(await screen.findByRole('button', { name: /搜索命中 outside v7/ }));
    await within(await screen.findByLabelText('文档正文')).findByText('正文 outside-rev-7');
    expect(callsMatching(/\/outside\/summary$/)).toHaveLength(1);
    expect(callsMatching(/\/outside\/revisions\/outside-rev-7\/metadata$/)).toHaveLength(1);
    expect(screen.getByText(/不在当前结果页/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '← 返回业务事实库' }));
    expect(screen.getByText('当前页 1 / 共 1 篇')).toBeInTheDocument();
  });

  it.each(['CANDIDATE', 'WITHDRAWN'])(
    '正文搜索防御性保留%s标签而不冒称当前生效',
    async (status) => {
      install((url) =>
        pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
          ? searchReply([searchResult('legacy', 1, 'BUSINESS', status)])
          : undefined,
      );
      renderKnowledge();
      await screen.findByText('当前页 1 / 共 1 篇');
      await search();
      const result = (await screen.findByText('搜索命中 legacy v1')).closest(
        '.knowledge-search-result',
      );
      expect(result).toHaveTextContent(
        status === 'CANDIDATE' ? '候选 · 尚未生效' : '历史版本 · 已撤回',
      );
    },
  );

  it('正文命中的准确metadata不可读时显示可见错误并禁止回退当前发布', async () => {
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
        ? searchReply([searchResult('outside', 7)])
        : pathOf(url).endsWith('/outside-rev-7/metadata')
          ? failure(404, 'REVISION_UNREADABLE', '准确修订不可读取')
          : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    fireEvent.click(await screen.findByRole('button', { name: /搜索命中 outside v7/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('准确修订不可读取');
    expect(alert).toHaveTextContent('当前文档已不可读取');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(alert).getByText(/REVISION_UNREADABLE/)).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: '刷新历史' })).toBeEnabled();
    expect(screen.queryByTestId('knowledge-current-publication')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销发布' })).not.toBeInTheDocument();
    expect(callsMatching(/\/content$/)).toHaveLength(0);
  });

  it('新搜索命中使旧singleton概要失效，迟到旧结果不读取正文', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
        ? searchReply([searchResult('slow'), searchResult('fast')])
        : pathOf(url).endsWith('/slow/summary')
          ? slow.promise
          : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    fireEvent.click(await screen.findByRole('button', { name: /搜索命中 slow v2/ }));
    fireEvent.click(screen.getByRole('button', { name: /搜索命中 fast v2/ }));
    await screen.findByText('正文 fast-rev-2');
    await settle(slow, reply(summaryFor('slow')));
    await waitFor(() =>
      expect(callsMatching(/\/slow\/history\?|slow-rev-.*\/(metadata|content)$/)).toHaveLength(0),
    );
  });

  it('搜索命中概要pending时切项目，旧结果不能再请求metadata和正文', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
        ? searchReply([searchResult('slow')])
        : pathOf(url).endsWith('/slow/summary')
          ? slow.promise
          : undefined,
    );
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    fireEvent.click(await screen.findByRole('button', { name: /搜索命中 slow v2/ }));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    await within(await screen.findByLabelText('文档列表')).findByText('修订 doc-p2 v2');
    await settle(slow, reply(summaryFor('slow')));
    await waitFor(() => expect(callsMatching(/slow-rev-.*\/(metadata|content)$/)).toHaveLength(0));
  });

  it('卸载后搜索命中概要迟到不能继续读取metadata和正文', async () => {
    const slow = deferred<StubReply>();
    install((url) =>
      pathOf(url) === '/api/v1/knowledge-bases/kb-BUSINESS/search'
        ? searchReply([searchResult('slow')])
        : pathOf(url).endsWith('/slow/summary')
          ? slow.promise
          : undefined,
    );
    const view = renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    await search();
    fireEvent.click(await screen.findByRole('button', { name: /搜索命中 slow v2/ }));
    view.unmount();
    await settle(slow, reply(summaryFor('slow')));
    await waitFor(() => expect(callsMatching(/slow-rev-.*\/(metadata|content)$/)).toHaveLength(0));
  });

  it('集合上下文和返回全部保留，系统关系只在SYSTEM集合按需读取', async () => {
    install();
    renderKnowledge();
    await screen.findByText('当前页 1 / 共 1 篇');
    expect(screen.queryByText('查看系统关系')).not.toBeInTheDocument();
    const system = [...document.querySelectorAll<HTMLElement>('.knowledge-collection-card')][1];
    fireEvent.click(within(system).getByRole('button'));
    expect(await screen.findByTestId('knowledge-collection-context')).toHaveTextContent(
      '系统事实库',
    );
    expect(screen.getByText('查看系统关系')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        queryOf(String(callsMatching(/document-summaries\?/).at(-1)?.[0])).get('knowledgeBaseKind'),
      ).toBe('SYSTEM'),
    );
    fireEvent.click(screen.getByText('查看系统关系'));
    await screen.findByTestId('knowledge-system-relations');
    fireEvent.click(screen.getByRole('button', { name: '查看全部知识' }));
    await screen.findByTestId('knowledge-overview');
    expect(screen.queryByText('查看系统关系')).not.toBeInTheDocument();
  });

  it('候选评审使用canonical准确ID路由', async () => {
    install();
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: '进入评审' }));
    expect(await screen.findByText('评审页面 review-candidate')).toBeInTheDocument();
  });

  it('票据410原样保留，撤销只带锁定版本、原因和confirmation', async () => {
    install((url) =>
      pathOf(url).endsWith('/doc-1/withdraw')
        ? failure(410, 'TICKET_EXPIRED', '票据已过期')
        : undefined,
    );
    renderKnowledge();
    await openGovernance();
    const dialog = await confirmWithdrawal();
    expect(await within(dialog).findByText(/\[TICKET_EXPIRED\] 票据已过期/)).toBeInTheDocument();
    const call = callsMatching(/\/doc-1\/withdraw$/)[0];
    expect(bodyOf(call[1] ?? {})).toEqual({
      expectedVersion: 17,
      reason: '业务规则错误',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
    expect(bodyOf(call[1] ?? {})).not.toHaveProperty('revisionId');
  });

  it('撤销409关闭旧窗口、刷新版本并要求重新确认', async () => {
    let conflict = false;
    install((url) => {
      if (pathOf(url).endsWith('/doc-1/withdraw')) {
        conflict = true;
        return failure(409, 'VERSION_CONFLICT', '文档版本已变化');
      }
      if (pathOf(url).endsWith('/doc-1/summary') && conflict)
        return reply({ ...summary, document: { ...summary.document, version: 18 } });
      if (pathOf(url).endsWith('/document-summaries') && conflict)
        return pageReply([{ ...summary, document: { ...summary.document, version: 18 } }]);
      if (pathOf(url).endsWith('/history') && conflict) return historyReply(revisions, null, 3, 18);
      return undefined;
    });
    renderKnowledge();
    await openGovernance();
    await confirmWithdrawal();
    await screen.findByText('文档已变化，请重新核对当前发布并确认撤销。');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销发布' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('文档版本 18');
  });

  it('撤销成功刷新目录门户历史概要并清除正文差异', async () => {
    let withdrawn = false;
    const after = {
      ...summary,
      publishedRevision: null,
      document: { ...summary.document, version: 18, currentPublishedRevisionId: null },
    };
    install((url) => {
      if (pathOf(url).endsWith('/doc-1/withdraw')) {
        withdrawn = true;
        return reply(after);
      }
      if (withdrawn && pathOf(url).endsWith('/document-summaries')) return pageReply([after]);
      if (withdrawn && pathOf(url).endsWith('/doc-1/summary')) return reply(after);
      if (withdrawn && pathOf(url).endsWith('/history'))
        return historyReply(revisions, null, 3, 18);
      return undefined;
    });
    renderKnowledge();
    await openGovernance();
    fireEvent.click(within(rowFor(3)).getByRole('button', { name: '查看正文' }));
    await screen.findByTestId('knowledge-diff');
    await confirmWithdrawal();
    await screen.findByText(/发布已撤销；历史修订仍保留/);
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();
    expect(screen.queryByTestId('knowledge-current-publication')).not.toBeInTheDocument();
    expect(callsMatching(/document-summary-overview/)).toHaveLength(2);
    expect(callsMatching(/\/history\?/)).toHaveLength(2);
  });
});
