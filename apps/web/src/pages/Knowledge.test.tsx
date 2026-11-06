import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Knowledge } from './Knowledge';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import {
  bodyOf,
  envelope,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
  type StubReply,
} from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1, defaultKnowledgeBaseId: 'kb-1' };

const publishedRevision = {
  id: 'rev-1',
  documentId: 'doc-1',
  seq: 1,
  title: 'Release notes',
  mimeType: 'text/markdown; charset=utf-8',
  byteLength: 20,
  digest: 'sha256-release',
  state: 'PUBLISHED',
  createdBy: 'user-1',
  basisUnderstandingRevisionId: null,
  deliveryScope: null,
  acceptance: null,
};

const documentDetail = {
  document: {
    id: 'doc-1',
    projectId: 'p1',
    knowledgeBaseId: 'kb-1',
    requirementId: null,
    kind: 'KNOWLEDGE',
    version: 5,
    currentPublishedRevisionId: 'rev-1',
    archivedAt: null,
  },
  revisions: [publishedRevision],
  publishedRevision,
};

const candidateRevision = {
  ...publishedRevision,
  id: 'rev-candidate',
  seq: 2,
  title: '候选独有标题',
  digest: 'sha256-candidate',
  state: 'CANDIDATE',
};

const historicalRevision = {
  ...publishedRevision,
  id: 'rev-history',
  seq: 3,
  title: '历史独有标题',
  digest: 'sha256-history',
  state: 'WITHDRAWN',
};

const decisionRevision = {
  ...publishedRevision,
  id: 'rev-decision',
  documentId: 'doc-2',
  title: 'Decision record',
  digest: 'sha256-decision',
};

const searchableKnowledgeDocument = {
  ...documentDetail,
  document: { ...documentDetail.document, requirementId: 'req-2' },
  revisions: [publishedRevision, candidateRevision, historicalRevision],
};

const decisionDocument = {
  document: {
    id: 'doc-2',
    projectId: 'p1',
    knowledgeBaseId: 'kb-1',
    requirementId: null,
    kind: 'DECISION',
    version: 1,
    currentPublishedRevisionId: 'rev-decision',
    archivedAt: null,
  },
  revisions: [decisionRevision],
  publishedRevision: decisionRevision,
};

function renderKnowledge() {
  return render(
    <MemoryRouter>
      <Knowledge />
    </MemoryRouter>,
  );
}

function knowledgeDocumentFor(
  id: string,
  title: string,
  kind: 'KNOWLEDGE' | 'DECISION' = 'KNOWLEDGE',
  requirementId: string | null = null,
) {
  const rev = {
    ...publishedRevision,
    id: `rev-${id}`,
    documentId: id,
    title,
    digest: `sha256-${id}`,
  };
  return {
    document: { ...documentDetail.document, id, kind, requirementId },
    revisions: [rev],
    publishedRevision: rev,
  };
}

function pageReply(items: unknown[], nextCursor: string | null) {
  return { status: 200, body: envelope({ items, nextCursor }) };
}

function requirementView(id: string, code: string, title: string) {
  return {
    id,
    projectId: 'p1',
    seq: 1,
    code,
    title,
    description: null,
    version: 1,
    generation: 1,
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function contentReply(revisionId: string, text: string) {
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

const searchKnowledgeBase = {
  id: 'kb-search',
  projectId: 'p1',
  key: 'search-key',
  name: '搜索知识库',
  kind: 'BUSINESS',
  visibility: 'PROJECT',
  version: 1,
  authzVersion: 1,
  publicationApproverUserId: 'user-1',
  publicationApproverRoleId: null,
  archivedAt: null,
};

function searchResult(
  documentId: string,
  revisionId: string,
  title: string,
  status: 'PUBLISHED' | 'CANDIDATE' | 'WITHDRAWN' = 'PUBLISHED',
) {
  return {
    knowledgeBaseId: searchKnowledgeBase.id,
    knowledgeBaseName: searchKnowledgeBase.name,
    knowledgeBaseKind: searchKnowledgeBase.kind,
    revisionId,
    documentId,
    documentKind: 'KNOWLEDGE',
    status,
    title,
    excerpt: `${title} 摘要`,
    sha256: `sha256-${documentId}`,
  };
}

function openKnowledgeRevision(title: string) {
  openKnowledgeGovernance();
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`找不到修订行：${title}`);
  fireEvent.click(within(row).getByRole('button', { name: '查看正文' }));
}

function openKnowledgeGovernance() {
  const panel = document.querySelector<HTMLDetailsElement>('details.knowledge-governance-panel');
  if (panel && !panel.open) {
    const summary = panel.querySelector('summary');
    if (summary) fireEvent.click(summary);
  }
}

describe('Knowledge（撤销发布必须带版本与票据）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('票据过期（410）原样展示，且撤销请求携带 expectedVersion 与 confirmation', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      if (path === '/api/v1/auth/action-previews') {
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
      if (path === '/api/v1/auth/confirmation-tickets')
        return {
          status: 201,
          body: envelope({
            ticketId: 'ticket-1',
            ticketSecret: 'secret-1',
            expiresAt: '2026-11-01T00:05:00.000Z',
            actionDigest: 'digest-withdraw',
          }),
        };
      if (path === '/api/v1/documents/doc-1/withdraw' && method === 'POST')
        return {
          status: 410,
          body: {
            error: {
              code: 'CONFIRMATION_EXPIRED',
              message: '票据已过期，请重新验证密码',
              requestId: 'req-410',
            },
          },
        };
      return undefined;
    });

    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '知识库' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建候选文档' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '追加候选修订' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('文档正文')).not.toBeInTheDocument();

    expect(await screen.findByRole('button', { name: '撤销发布' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销发布' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('撤销原因'), { target: { value: '内容过期' } });
    expect(await within(dialog).findByLabelText('确认密码')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('确认密码'), {
      target: { value: 'secret-pass' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
    expect(await within(dialog).findByText(/票据已签发/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '撤销发布' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '[CONFIRMATION_EXPIRED] 票据已过期，请重新验证密码 · requestId req-410',
    );
    expect(screen.queryByText(/发布已撤销/)).not.toBeInTheDocument();

    const withdrawCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/documents/doc-1/withdraw' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(withdrawCall?.[1] ?? {})).toEqual({
      expectedVersion: 5,
      reason: '内容过期',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
    expect(bodyOf(withdrawCall?.[1] ?? {})).not.toHaveProperty('revisionId');
  });

  it('搜索覆盖所有修订标题、版本号、版本状态与文档类型', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [searchableKnowledgeDocument, decisionDocument],
            nextCursor: null,
          }),
        };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('Release notes')).length).toBeGreaterThan(0);
    const search = screen.getByLabelText('搜索文档');

    fireEvent.change(search, { target: { value: '候选独有标题' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Decision record')).toHaveLength(0);

    fireEvent.change(search, { target: { value: '历史独有标题' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: 'v3' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: 'WITHDRAWN' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);

    // 文档类型（决策）与中文类型标签都可作为搜索词。
    fireEvent.change(search, { target: { value: '决策' } });
    expect(screen.getAllByText('Decision record').length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: '完全不存在的关键词' } });
    expect(screen.getByText('没有匹配的文档，清空搜索或类型筛选。')).toBeInTheDocument();
  });

  it('需求索引读取全部分页后才能用第二页需求编号/标题搜索', async () => {
    const requirementOne = {
      id: 'req-1',
      projectId: 'p1',
      seq: 1,
      code: 'DEMO-001',
      title: '第一页需求',
      description: null,
      version: 1,
      generation: 1,
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    const requirementTwo = {
      ...requirementOne,
      id: 'req-2',
      seq: 2,
      code: 'DEMO-002',
      title: '第二页需求',
    };

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return {
          status: 200,
          body: envelope({ items: [searchableKnowledgeDocument], nextCursor: null }),
        };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        if (!cursor)
          return { status: 200, body: envelope({ items: [requirementOne], nextCursor: '2' }) };
        if (cursor === '2')
          return { status: 200, body: envelope({ items: [requirementTwo], nextCursor: null }) };
      }
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('Release notes')).length).toBeGreaterThan(0);
    const search = screen.getByLabelText('搜索文档');
    fireEvent.change(search, { target: { value: 'DEMO-002' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: '第二页需求' } });
    expect(screen.getAllByText('Release notes').length).toBeGreaterThan(0);
  });

  it('需求索引分页失败时保留文档并提示关联需求暂时无法读取', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return {
          status: 200,
          body: envelope({ items: [searchableKnowledgeDocument], nextCursor: null }),
        };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        if (!cursor) return { status: 200, body: envelope({ items: [], nextCursor: '2' }) };
        return {
          status: 503,
          body: {
            error: {
              code: 'REQUIREMENTS_UNAVAILABLE',
              message: '需求索引不可用',
              requestId: 'req-idx',
            },
          },
        };
      }
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('Release notes')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/关联需求索引读取失败/)).toBeInTheDocument();
    expect(screen.getAllByText('关联需求暂时无法读取').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '重新读取需求索引' })).toBeInTheDocument();
  });

  it('文档列表聚合两页，覆盖所有类型且第 51 个文档可搜索', async () => {
    const documents = Array.from({ length: 51 }, (_, index) =>
      knowledgeDocumentFor(
        `doc-${index + 1}`,
        `文档 ${index + 1}`,
        index % 2 === 0 ? 'KNOWLEDGE' : 'DECISION',
      ),
    );
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        if (!cursor) return pageReply(documents.slice(0, 50), 'next-2');
        if (cursor === 'next-2') return pageReply([documents[50]], null);
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderKnowledge();
    await screen.findAllByText('文档 1');
    fireEvent.change(await screen.findByLabelText('搜索文档'), {
      target: { value: '文档 51' },
    });
    expect(await screen.findByText('文档 51')).toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url]) =>
          pathOf(String(url)) === '/api/v1/projects/p1/documents' &&
          !new URL(String(url), 'http://localhost').searchParams.has('kind'),
      ),
    ).toBe(true);
    expect(screen.queryByText(/文档列表可能未完整加载/)).not.toBeInTheDocument();
  });

  it('第 40 页仍有下一页时提示文档列表可能不完整', async () => {
    let documentCalls = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        documentCalls += 1;
        return pageReply(
          [knowledgeDocumentFor(`doc-${documentCalls}`, `文档 ${documentCalls}`)],
          String(documentCalls + 1),
        );
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderKnowledge();
    expect(await screen.findByText(/文档列表可能未完整加载：已读取前 40 页/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新读取文档列表' })).toBeInTheDocument();
    expect(documentCalls).toBe(40);
  });

  it('已有旧文档后刷新失败保留旧数据并显示错误', async () => {
    let documentCalls = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        documentCalls += 1;
        if (documentCalls === 1)
          return pageReply([knowledgeDocumentFor('doc-1', '保留的知识文档')], null);
        return {
          status: 500,
          body: {
            error: { code: 'DOCUMENTS_UNAVAILABLE', message: '刷新失败', requestId: 'req-docs' },
          },
        };
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('保留的知识文档')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    expect((await screen.findAllByText(/文档列表读取失败/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('保留的知识文档').length).toBeGreaterThan(0);
    expect(screen.queryByText(/该项目还没有文档/)).not.toBeInTheDocument();
  });

  it('A 慢 B 快时知识库只显示 B 的正文，A 完成后不得覆盖', async () => {
    const base = { ...publishedRevision, id: 'rev-kbase', title: '知识基线' };
    const a = {
      ...candidateRevision,
      id: 'rev-ka',
      seq: 2,
      title: '知识候选 A',
      documentId: 'doc-krace',
      reviewRequestId: null,
    };
    const b = {
      ...candidateRevision,
      id: 'rev-kb',
      seq: 3,
      title: '知识候选 B',
      documentId: 'doc-krace',
      reviewRequestId: null,
    };
    const raceDocument = {
      document: { ...documentDetail.document, id: 'doc-krace' },
      revisions: [base, a, b],
      publishedRevision: base,
    };
    const aReply = deferred<StubReply>();
    const bReply = deferred<StubReply>();

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-ka/content') return aReply.promise;
      if (path === '/api/v1/document-revisions/rev-kb/content') return bReply.promise;
      if (path === '/api/v1/document-revisions/rev-kbase/content')
        return contentReply('rev-kbase', '知识基线正文');
      return undefined;
    });

    renderKnowledge();
    await screen.findAllByText('知识候选 A');
    openKnowledgeRevision('知识候选 A');
    openKnowledgeRevision('知识候选 B');

    bReply.resolve(contentReply('rev-kb', '知识候选 B 正文'));
    expect((await screen.findAllByText(/知识候选 B 正文/)).length).toBeGreaterThan(0);

    aReply.resolve(contentReply('rev-ka', '知识候选 A 正文'));
    await waitFor(() => expect(screen.queryAllByText(/知识候选 A 正文/)).toHaveLength(0));
    expect(screen.getAllByText(/知识候选 B 正文/).length).toBeGreaterThan(0);
  });

  it('项目切换后不会残留旧项目文档', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([knowledgeDocumentFor('doc-p1', 'P1 知识文档')], null);
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([knowledgeDocumentFor('doc-p2', 'P2 知识文档')], null);
      if (path.endsWith('/requirements') && method === 'GET') return pageReply([], null);
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('P1 知识文档')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 知识文档')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('P1 知识文档')).not.toBeInTheDocument());
  });

  it('双版本选择器显示真实元数据、阻止同版本并支持仅看修改', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([searchableKnowledgeDocument], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path.endsWith('/rev-candidate/content'))
        return contentReply('rev-candidate', '# 候选版本\n- 新内容');
      if (path.endsWith('/rev-history/content'))
        return contentReply('rev-history', '# 历史版本\n- 旧内容');
      if (path.endsWith('/rev-1/content')) return contentReply('rev-1', '# 已发布版本');
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('Release notes')).length).toBeGreaterThan(0);
    openKnowledgeGovernance();
    const oldVersion = await screen.findByRole('combobox', { name: '对比旧版本' });
    const newVersion = screen.getByRole('combobox', { name: '对比新版本' });
    expect(
      within(oldVersion).getByRole('option', { name: /v1 · Release notes · 已发布/ }),
    ).toBeInTheDocument();
    expect(
      within(oldVersion).getByRole('option', { name: /v2 · 候选独有标题 · 候选/ }),
    ).toBeInTheDocument();
    expect(
      within(newVersion).getByRole('option', { name: /v3 · 历史独有标题 · 已撤回/ }),
    ).toBeInTheDocument();

    fireEvent.change(oldVersion, { target: { value: 'rev-candidate' } });
    fireEvent.change(newVersion, { target: { value: 'rev-candidate' } });
    const compareButton = screen.getByRole('button', { name: '对比所选版本' });
    expect(compareButton).toBeDisabled();
    expect(screen.getByText('请选择两个不同的版本再对比。')).toBeInTheDocument();
    expect(mock.mock.calls.filter(([url]) => pathOf(String(url)).includes('/content')).length).toBe(
      0,
    );

    fireEvent.change(newVersion, { target: { value: 'rev-history' } });
    fireEvent.click(compareButton);
    const diff = await screen.findByTestId('knowledge-diff');
    expect(diff).toHaveTextContent('新增：# 历史版本');
    expect(diff).toHaveTextContent('删除：# 候选版本');
    expect(diff).toHaveTextContent('旧版本 v2 · 候选独有标题 → 新版本 v3 · 历史独有标题');
    expect(
      mock.mock.calls.some(([url]) => pathOf(String(url)).endsWith('/rev-candidate/content')),
    ).toBe(true);
    expect(
      mock.mock.calls.some(([url]) => pathOf(String(url)).endsWith('/rev-history/content')),
    ).toBe(true);

    const onlyChanges = within(diff).getByRole('button', { name: '仅看修改' });
    fireEvent.click(onlyChanges);
    expect(within(diff).getByRole('button', { name: '显示完整上下文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('手动对比失败清空旧 diff，重试成功且旧正文迟到不会覆盖新选择', async () => {
    const race = {
      document: { ...documentDetail.document, id: 'doc-kb-race' },
      revisions: [
        { ...publishedRevision, id: 'rev-kb-base', documentId: 'doc-kb-race', title: '知识基线' },
        { ...candidateRevision, id: 'rev-kb-a', documentId: 'doc-kb-race', title: '知识候选 A' },
        { ...historicalRevision, id: 'rev-kb-b', documentId: 'doc-kb-race', title: '知识候选 B' },
      ],
      publishedRevision: {
        ...publishedRevision,
        id: 'rev-kb-base',
        documentId: 'doc-kb-race',
        title: '知识基线',
      },
    };
    const oldSlow = deferred<StubReply>();
    let failNew = true;
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([race], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path.endsWith('/rev-kb-a/content')) return oldSlow.promise;
      if (path.endsWith('/rev-kb-b/content')) {
        if (failNew)
          return {
            status: 503,
            body: {
              error: {
                code: 'CONTENT_UNAVAILABLE',
                message: 'B 正文暂时不可用',
                requestId: 'req-b',
              },
            },
          };
        return contentReply('rev-kb-b', '# 新版本 B');
      }
      if (path.endsWith('/rev-kb-base/content')) return contentReply('rev-kb-base', '# 基线');
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('知识候选 A')).length).toBeGreaterThan(0);
    openKnowledgeGovernance();
    const oldVersion = await screen.findByRole('combobox', { name: '对比旧版本' });
    const newVersion = screen.getByRole('combobox', { name: '对比新版本' });
    fireEvent.change(oldVersion, { target: { value: 'rev-kb-a' } });
    fireEvent.change(newVersion, { target: { value: 'rev-kb-b' } });
    const compareButton = screen.getByRole('button', { name: '对比所选版本' });
    fireEvent.click(compareButton);
    expect(await screen.findByRole('alert')).toHaveTextContent('B 正文暂时不可用');
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();

    // Retry the same pair after the new-version read recovers.
    failNew = false;
    oldSlow.resolve(contentReply('rev-kb-a', '# 旧版本 A'));
    fireEvent.click(compareButton);
    const diff = await screen.findByTestId('knowledge-diff');
    expect(diff).toHaveTextContent('新增：# 新版本 B');
    expect(diff).toHaveTextContent('删除：# 旧版本 A');
    expect(
      mock.mock.calls.filter(([url]) => pathOf(String(url)).endsWith('/rev-kb-a/content')).length,
    ).toBeGreaterThan(0);
  });

  it('项目切换后清空手动对比并忽略旧项目正文', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    const oldProject = {
      document: { ...documentDetail.document, id: 'doc-k-p1' },
      revisions: [
        { ...publishedRevision, id: 'rev-k-p1-old', documentId: 'doc-k-p1', title: 'P1 旧版' },
        { ...candidateRevision, id: 'rev-k-p1-new', documentId: 'doc-k-p1', title: 'P1 新版' },
      ],
      publishedRevision: {
        ...publishedRevision,
        id: 'rev-k-p1-old',
        documentId: 'doc-k-p1',
        title: 'P1 旧版',
      },
    };
    const newProject = knowledgeDocumentFor('doc-k-p2', 'P2 知识文档');
    const oldBody = deferred<StubReply>();
    const newBody = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([oldProject], null);
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([newProject], null);
      if (path.endsWith('/requirements') && method === 'GET') return pageReply([], null);
      if (path.endsWith('/rev-k-p1-old/content')) return oldBody.promise;
      if (path.endsWith('/rev-k-p1-new/content')) return newBody.promise;
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('P1 新版')).length).toBeGreaterThan(0);
    openKnowledgeGovernance();
    fireEvent.change(screen.getByLabelText('对比旧版本'), { target: { value: 'rev-k-p1-old' } });
    fireEvent.change(screen.getByLabelText('对比新版本'), { target: { value: 'rev-k-p1-new' } });
    fireEvent.click(screen.getByRole('button', { name: '对比所选版本' }));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 知识文档')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('knowledge-diff')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '对比旧版本' })).not.toBeInTheDocument();

    oldBody.resolve(contentReply('rev-k-p1-old', '# 迟到 P1 旧版'));
    newBody.resolve(contentReply('rev-k-p1-new', '# 迟到 P1 新版'));
    await waitFor(() => expect(screen.queryByText('# 迟到 P1 旧版')).not.toBeInTheDocument());
    expect(screen.queryByText('# 迟到 P1 新版')).not.toBeInTheDocument();
  });

  it('切换文档后清空旧正文与版本选择，旧文档迟到响应不能恢复', async () => {
    const firstDocument = {
      document: { ...documentDetail.document, id: 'doc-k-first' },
      revisions: [
        { ...publishedRevision, id: 'rev-k-first', documentId: 'doc-k-first', title: '第一篇知识' },
        {
          ...candidateRevision,
          id: 'rev-k-first-candidate',
          documentId: 'doc-k-first',
          title: '第一篇候选',
        },
      ],
      publishedRevision: {
        ...publishedRevision,
        id: 'rev-k-first',
        documentId: 'doc-k-first',
        title: '第一篇知识',
      },
    };
    const secondDocument = knowledgeDocumentFor('doc-k-second', '第二篇知识');
    const delayed = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([firstDocument, secondDocument], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path.endsWith('/rev-k-first-candidate/content')) return delayed.promise;
      if (path.endsWith('/rev-doc-k-second/content'))
        return contentReply('rev-doc-k-second', '# 第二篇已发布正文');
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('第一篇候选')).length).toBeGreaterThan(0);
    openKnowledgeRevision('第一篇候选');
    expect(await screen.findByText('正在读取文档正文…')).toBeInTheDocument();

    const secondRow = screen.getByText('第二篇知识').closest('tr');
    expect(secondRow).not.toBeNull();
    fireEvent.click(within(secondRow!).getByRole('button', { name: '阅读当前版本' }));
    expect((await screen.findAllByText('第二篇知识')).length).toBeGreaterThan(0);
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: '第二篇已发布正文',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('正在读取文档正文…')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: '对比旧版本' })).not.toBeInTheDocument();

    delayed.resolve(contentReply('rev-k-first-candidate', '# 迟到第一篇'));
    await waitFor(() => expect(screen.queryByText('# 迟到第一篇')).not.toBeInTheDocument());
  });

  it('P1 文档列表请求延迟到 P2 加载后才返回，也不能覆盖 P2', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    const p1Documents = deferred<StubReply>();
    let p1Started = false;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        p1Started = true;
        return p1Documents.promise;
      }
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([knowledgeDocumentFor('doc-p2', 'P2 知识文档')], null);
      if (path.endsWith('/requirements') && method === 'GET') return pageReply([], null);
      return undefined;
    });

    renderKnowledge();
    await waitFor(() => expect(p1Started).toBe(true));
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 知识文档')).length).toBeGreaterThan(0);

    p1Documents.resolve(pageReply([knowledgeDocumentFor('doc-p1', '迟到的 P1 知识文档')], null));
    await waitFor(() => expect(screen.queryByText('迟到的 P1 知识文档')).not.toBeInTheDocument());
    expect(screen.getAllByText('P2 知识文档').length).toBeGreaterThan(0);
    expect(screen.queryByText(/文档列表读取失败/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新文档' })).toBeInTheDocument();
  });

  it('P1 手动重读需求索引成功结果不会覆盖 P2 的关联需求', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    const p1Refresh = deferred<StubReply>();
    let p1RequirementCalls = 0;
    let p1RefreshStarted = false;
    const p1Requirement = requirementView('req-p1', 'P1-REQ', 'P1 需求');
    const p2Requirement = { ...requirementView('req-p2', 'P2-REQ', 'P2 需求'), projectId: 'p2' };

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply(
          [knowledgeDocumentFor('doc-p1', 'P1 知识文档', 'KNOWLEDGE', 'req-p1')],
          null,
        );
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply(
          [knowledgeDocumentFor('doc-p2', 'P2 知识文档', 'KNOWLEDGE', 'req-p2')],
          null,
        );
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        p1RequirementCalls += 1;
        if (p1RequirementCalls === 1)
          return {
            status: 500,
            body: {
              error: { code: 'P1_INDEX_FAILED', message: 'P1 索引失败', requestId: 'req-p1' },
            },
          };
        p1RefreshStarted = true;
        return p1Refresh.promise;
      }
      if (path === '/api/v1/projects/p2/requirements' && method === 'GET')
        return pageReply([p2Requirement], null);
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('P1 知识文档')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/关联需求索引读取失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取需求索引' }));
    await waitFor(() => expect(p1RefreshStarted).toBe(true));

    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    await waitFor(() => expect(screen.getAllByText(/P2-REQ · P2 需求/).length).toBeGreaterThan(0));

    p1Refresh.resolve(pageReply([p1Requirement], null));
    await waitFor(() => expect(screen.queryByText(/P1-REQ/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/P2-REQ · P2 需求/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/关联需求索引读取失败/)).not.toBeInTheDocument();
    expect(screen.queryByText('读取中…')).not.toBeInTheDocument();
  });

  it('P1 手动重读需求索引失败结果不会污染 P2', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    const p1Refresh = deferred<StubReply>();
    let p1RequirementCalls = 0;
    let p1RefreshStarted = false;
    const p2Requirement = { ...requirementView('req-p2', 'P2-REQ', 'P2 需求'), projectId: 'p2' };

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply(
          [knowledgeDocumentFor('doc-p1', 'P1 知识文档', 'KNOWLEDGE', 'req-p1')],
          null,
        );
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply(
          [knowledgeDocumentFor('doc-p2', 'P2 知识文档', 'KNOWLEDGE', 'req-p2')],
          null,
        );
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        p1RequirementCalls += 1;
        if (p1RequirementCalls === 1)
          return {
            status: 500,
            body: {
              error: { code: 'P1_INDEX_FAILED', message: 'P1 索引失败', requestId: 'req-p1' },
            },
          };
        p1RefreshStarted = true;
        return p1Refresh.promise;
      }
      if (path === '/api/v1/projects/p2/requirements' && method === 'GET')
        return pageReply([p2Requirement], null);
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('P1 知识文档')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/关联需求索引读取失败/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取需求索引' }));
    await waitFor(() => expect(p1RefreshStarted).toBe(true));

    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    await waitFor(() => expect(screen.getAllByText(/P2-REQ · P2 需求/).length).toBeGreaterThan(0));

    p1Refresh.resolve({
      status: 500,
      body: {
        error: { code: 'P1_LATE_FAILED', message: 'P1 迟到失败', requestId: 'req-p1-late' },
      },
    });
    await waitFor(() => expect(screen.queryByText(/P1 迟到失败/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/P2-REQ · P2 需求/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/关联需求索引读取失败/)).not.toBeInTheDocument();
    expect(screen.queryByText('读取中…')).not.toBeInTheDocument();
  });

  it('刷新文档接管需求索引 loading，旧手动重读完成后不能覆盖', async () => {
    const manualRefresh = deferred<StubReply>();
    let requirementCalls = 0;
    let manualStarted = false;
    let documentCalls = 0;

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        documentCalls += 1;
        return pageReply(
          [
            knowledgeDocumentFor(
              'doc-p1',
              documentCalls === 1 ? '刷新前知识文档' : '刷新后的知识文档',
              'KNOWLEDGE',
              'req-p1',
            ),
          ],
          null,
        );
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        requirementCalls += 1;
        if (requirementCalls === 1)
          return {
            status: 500,
            body: {
              error: { code: 'INDEX_FAILED', message: '初始索引失败', requestId: 'req-idx-1' },
            },
          };
        if (requirementCalls === 2) {
          manualStarted = true;
          return manualRefresh.promise;
        }
        return {
          status: 500,
          body: {
            error: { code: 'INDEX_FAILED', message: '刷新后索引失败', requestId: 'req-idx-2' },
          },
        };
      }
      return undefined;
    });

    renderKnowledge();
    expect((await screen.findAllByText('刷新前知识文档')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/关联需求索引读取失败/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重新读取需求索引' }));
    await waitFor(() => expect(manualStarted).toBe(true));
    expect(screen.getByRole('button', { name: '读取中…' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    expect((await screen.findAllByText('刷新后的知识文档')).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新读取需求索引' })).toBeEnabled(),
    );
    expect(screen.queryByText('读取中…')).not.toBeInTheDocument();
    expect(screen.getByText(/刷新后索引失败/)).toBeInTheDocument();

    manualRefresh.resolve(pageReply([requirementView('req-p1', 'P1-REQ', 'P1 需求')], null));
    await waitFor(() => expect(screen.queryByText(/P1-REQ/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '重新读取需求索引' })).toBeEnabled();
    expect(screen.getByText(/刷新后索引失败/)).toBeInTheDocument();
    expect(screen.queryByText('读取中…')).not.toBeInTheDocument();
    expect((await screen.findAllByText('刷新后的知识文档')).length).toBeGreaterThan(0);
  });

  it('知识库空态给出角色、可开工任务、CLI 命令和任务流程引导', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      if (path === '/api/v1/projects/p1/roles' && method === 'GET')
        return {
          status: 200,
          body: envelope([
            { id: 'role-1', projectId: 'p1', key: 'backend', title: '后端', version: 1 },
          ]),
        };
      if (path === '/api/v1/workbench' && method === 'GET')
        return {
          status: 200,
          body: envelope({
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
          }),
        };
      return undefined;
    });
    renderKnowledge();

    expect(await screen.findByTestId('knowledge-agent-guide')).toBeInTheDocument();
    expect(screen.getByText(/当前项目可用角色/)).toBeInTheDocument();
    expect(await screen.findByText(/后端（backend）/)).toBeInTheDocument();
    expect(screen.getByText(/1 项可开工任务/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看可开工任务' })).toBeInTheDocument();
    expect(screen.getByText('workmesh auth login')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制初始化命令' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /创建文档/ })).not.toBeInTheDocument();
  });

  it('文档列表仍在读取时显示骨架与 role=status，不渲染空态或 0 / 0 计数', async () => {
    const documents = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return documents.promise;
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderKnowledge();

    const indicator = await screen.findByText('正在加载文档…');
    expect(indicator.closest('[role="status"]')).not.toBeNull();
    expect(indicator.closest('[aria-busy="true"]')).not.toBeNull();
    expect(document.querySelectorAll('.wm-skeleton-row').length).toBeGreaterThan(0);
    expect(
      screen.queryByText('该项目还没有文档，等待本地 Agent 提交候选。'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('0 / 0')).not.toBeInTheDocument();

    documents.resolve(pageReply([knowledgeDocumentFor('doc-load', '加载完成的知识文档')], null));
    expect((await screen.findAllByText('加载完成的知识文档')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('正在加载文档…')).not.toBeInTheDocument());
  });

  it('按服务端类别展示三库门户，跨库搜索并从已发布结果打开正文', async () => {
    const bases = [
      {
        id: 'kb-business',
        projectId: 'p1',
        key: 'system-key',
        name: '业务规则库',
        kind: 'BUSINESS',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'user-1',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
      {
        id: 'kb-system',
        projectId: 'p1',
        key: 'practice-key',
        name: '系统说明库',
        kind: 'SYSTEM',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'user-1',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
      {
        id: 'kb-practice',
        projectId: 'p1',
        key: 'business-key',
        name: '操作实践库',
        kind: 'PRACTICE',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'user-1',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
    ];
    const document = {
      ...searchableKnowledgeDocument,
      document: { ...searchableKnowledgeDocument.document, knowledgeBaseId: 'kb-business' },
    };
    const searchedBases: string[] = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([document], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply(bases, null);
      if (path.startsWith('/api/v1/knowledge-bases/') && path.endsWith('/search')) {
        const baseId = path.split('/')[4];
        searchedBases.push(baseId);
        const titleByBase: Record<string, string> = {
          'kb-business': '业务规则搜索结果',
          'kb-system': '系统接口搜索结果',
          'kb-practice': '操作手册搜索结果',
        };
        return {
          status: 200,
          body: envelope({
            items: [
              {
                knowledgeBaseId: baseId,
                knowledgeBaseName: bases.find((base) => base.id === baseId)?.name ?? '',
                knowledgeBaseKind: bases.find((base) => base.id === baseId)?.kind ?? '',
                revisionId: 'rev-1',
                documentId: baseId === 'kb-business' ? 'doc-1' : `doc-${baseId}`,
                documentKind: 'KNOWLEDGE',
                status: 'PUBLISHED',
                title: titleByBase[baseId],
                excerpt: `${titleByBase[baseId]}的摘要`,
                sha256: 'sha256-result',
              },
            ],
            nextCursor: null,
            hasMore: false,
            truncated: false,
          }),
        };
      }
      if (path === '/api/v1/document-revisions/rev-1/content' && method === 'GET')
        return contentReply('rev-1', '当前正式发布的正文内容');
      return undefined;
    });

    renderKnowledge();

    const businessCard = await screen.findByRole('button', { name: /业务事实库/ });
    const systemCard = screen.getByRole('button', { name: /系统事实库/ });
    const practiceCard = screen.getByRole('button', { name: /角色实践库/ });
    const businessArticle = businessCard.closest('article');
    if (!businessArticle) throw new Error('业务事实库卡片缺少 article 容器');
    expect(await within(businessArticle).findByText('Release notes')).toBeInTheDocument();
    expect(within(businessArticle).getByText(/当前生效 · v1/)).toBeInTheDocument();
    expect(within(systemCard).getByText('0 篇可浏览文档')).toBeInTheDocument();
    expect(within(practiceCard).getByText('0 篇可浏览文档')).toBeInTheDocument();

    fireEvent.click(
      within(businessArticle).getByRole('button', { name: /Release notes.*当前生效.*阅读/ }),
    );
    expect(await screen.findByText('当前正式发布的正文内容')).toBeInTheDocument();
    expect(screen.getAllByText(/当前生效 · v1/).length).toBeGreaterThanOrEqual(2);
    fireEvent.click(screen.getByRole('button', { name: '版本与评审（当前）' }));
    fireEvent.click(await screen.findByText('来源与适用信息'));
    const sourcePanel = screen.getByText('来源与适用信息').closest('details');
    if (!sourcePanel) throw new Error('来源面板缺少 details 容器');
    expect(within(sourcePanel).getByText('所属知识库')).toBeInTheDocument();
    expect(within(sourcePanel).getByText('业务规则库')).toBeInTheDocument();
    expect(within(sourcePanel).getByText('知识')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '发布规则' },
    });
    expect(await screen.findByText('系统接口搜索结果的摘要')).toBeInTheDocument();
    expect(screen.getByText('操作手册搜索结果的摘要')).toBeInTheDocument();
    expect(screen.getByText('业务规则搜索结果的摘要')).toBeInTheDocument();
    await waitFor(() =>
      expect(searchedBases.sort()).toEqual(['kb-business', 'kb-practice', 'kb-system']),
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: /业务事实库 · 知识 · 当前生效.*业务规则搜索结果/,
      }),
    );
    expect(await screen.findByText('当前正式发布的正文内容')).toBeInTheDocument();
    expect(screen.getAllByText(/当前生效 · v1/).length).toBeGreaterThanOrEqual(2);
  });

  it('搜索空状态提供真实的知识类别入口，未命中时说明搜索范围', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply([searchKnowledgeBase], null);
      if (path === '/api/v1/knowledge-bases/kb-search/search' && method === 'GET')
        return {
          status: 200,
          body: envelope({ items: [], nextCursor: null, hasMore: false, truncated: false }),
        };
      return undefined;
    });

    renderKnowledge();

    const browseSystem = await screen.findByRole('button', {
      name: '按问题浏览：系统由什么组成、如何运行？',
    });
    expect(screen.getByText('不确定关键词？按知识类别浏览')).toBeInTheDocument();
    fireEvent.click(browseSystem);
    expect(browseSystem).toHaveAttribute('aria-pressed', 'true');

    fireEvent.change(screen.getByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '不存在的内容' },
    });
    expect(await screen.findByText('没有找到匹配的已发布知识')).toBeInTheDocument();
    expect(screen.getByText('搜索范围：业务事实库 · 系统事实库 · 角色实践库')).toBeInTheDocument();
    expect(screen.getByText(/清除搜索后按知识类别浏览/)).toBeInTheDocument();
  });

  it('选择知识库后显示集合上下文，并可返回全部知识', async () => {
    const bases = [
      {
        id: 'kb-business-context',
        projectId: 'p1',
        key: 'business-context',
        name: '业务事实资料',
        kind: 'BUSINESS',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'user-1',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
    ];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply(bases, null);
      return undefined;
    });

    renderKnowledge();
    fireEvent.click(await screen.findByRole('button', { name: /业务事实库/ }));

    const context = await screen.findByTestId('knowledge-collection-context');
    expect(within(context).getByRole('heading', { name: '业务事实库' })).toBeInTheDocument();
    expect(within(context).getByText('规则为什么这样定？')).toBeInTheDocument();
    expect(within(context).getByText('业务事实资料')).toBeInTheDocument();
    expect(within(context).getByText('0 篇符合当前筛选')).toBeInTheDocument();

    fireEvent.click(within(context).getByRole('button', { name: '查看全部知识' }));
    expect(screen.queryByTestId('knowledge-collection-context')).not.toBeInTheDocument();
  });

  it('搜索结果按服务端状态显示候选和历史语义', async () => {
    const results = [
      searchResult('doc-candidate', 'rev-candidate', '候选搜索结果', 'CANDIDATE'),
      searchResult('doc-history', 'rev-history', '历史搜索结果', 'WITHDRAWN'),
    ];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply([searchKnowledgeBase], null);
      if (path === '/api/v1/knowledge-bases/kb-search/search' && method === 'GET')
        return {
          status: 200,
          body: envelope({ items: results, nextCursor: null, hasMore: false, truncated: false }),
        };
      return undefined;
    });

    renderKnowledge();
    fireEvent.change(await screen.findByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '版本' },
    });
    expect(await screen.findByText('候选搜索结果')).toBeInTheDocument();
    expect(screen.getByText('历史搜索结果')).toBeInTheDocument();
    expect(screen.getByText(/候选 · 尚未生效/)).toBeInTheDocument();
    expect(screen.getByText(/历史版本 · 已撤回/)).toBeInTheDocument();
  });

  it('搜索结果详情迟到时切换项目不会追加旧文档或打开正文', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    const p1Document = knowledgeDocumentFor('doc-search-p1', 'P1 旧搜索文档');
    const p2Document = knowledgeDocumentFor('doc-search-p2', 'P2 文档');
    const delayed = deferred<StubReply>();
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([p2Document], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p2/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply([searchKnowledgeBase], null);
      if (path === '/api/v1/projects/p2/knowledge-bases' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/knowledge-bases/kb-search/search' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [searchResult('doc-search-p1', 'rev-doc-search-p1', 'P1 搜索结果')],
            nextCursor: null,
            hasMore: false,
            truncated: false,
          }),
        };
      if (path === '/api/v1/documents/doc-search-p1' && method === 'GET') return delayed.promise;
      return undefined;
    });

    renderKnowledge();
    fireEvent.change(await screen.findByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '搜索' },
    });
    expect(await screen.findByText('P1 搜索结果 摘要')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /P1 搜索结果/ }));

    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 文档')).length).toBeGreaterThan(0);

    delayed.resolve({ status: 200, body: envelope(p1Document) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('P1 旧搜索文档')).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url]) => pathOf(String(url)) === '/api/v1/document-revisions/rev-doc-search-p1/content',
      ),
    ).toBe(false);
  });

  it('新搜索结果会使迟到的旧详情失效', async () => {
    const documentA = knowledgeDocumentFor('doc-search-a', '打开 A 文档');
    const documentB = knowledgeDocumentFor('doc-search-b', '打开 B 文档');
    const delayedA = deferred<StubReply>();
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply([searchKnowledgeBase], null);
      if (path === '/api/v1/knowledge-bases/kb-search/search' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [
              searchResult('doc-search-a', 'rev-doc-search-a', '搜索结果 A'),
              searchResult('doc-search-b', 'rev-doc-search-b', '搜索结果 B'),
            ],
            nextCursor: null,
            hasMore: false,
            truncated: false,
          }),
        };
      if (path === '/api/v1/documents/doc-search-a' && method === 'GET') return delayedA.promise;
      if (path === '/api/v1/documents/doc-search-b' && method === 'GET')
        return { status: 200, body: envelope(documentB) };
      if (path === '/api/v1/document-revisions/rev-doc-search-b/content' && method === 'GET')
        return contentReply('rev-doc-search-b', '# B 正文');
      return undefined;
    });

    renderKnowledge();
    fireEvent.change(await screen.findByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '搜索结果' },
    });
    expect(await screen.findByText('搜索结果 A 摘要')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /搜索结果 A/ }));
    fireEvent.click(screen.getByRole('button', { name: /搜索结果 B/ }));

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'B 正文',
      }),
    ).toBeInTheDocument();
    delayedA.resolve({ status: 200, body: envelope(documentA) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText('打开 A 文档')).not.toBeInTheDocument();
    expect(screen.queryByText('# A 正文')).not.toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url]) => pathOf(String(url)) === '/api/v1/document-revisions/rev-doc-search-a/content',
      ),
    ).toBe(false);
  });

  it('卸载后迟到的搜索详情不会继续读取旧正文', async () => {
    const documentA = knowledgeDocumentFor('doc-search-unmount', '卸载后的旧文档');
    const delayed = deferred<StubReply>();
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply([searchKnowledgeBase], null);
      if (path === '/api/v1/knowledge-bases/kb-search/search' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [searchResult('doc-search-unmount', 'rev-doc-search-unmount', '卸载搜索结果')],
            nextCursor: null,
            hasMore: false,
            truncated: false,
          }),
        };
      if (path === '/api/v1/documents/doc-search-unmount' && method === 'GET')
        return delayed.promise;
      return undefined;
    });

    const view = renderKnowledge();
    fireEvent.change(await screen.findByRole('textbox', { name: '搜索项目知识' }), {
      target: { value: '卸载' },
    });
    expect(await screen.findByText('卸载搜索结果 摘要')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /卸载搜索结果/ }));
    view.unmount();

    delayed.resolve({ status: 200, body: envelope(documentA) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      mock.mock.calls.some(
        ([url]) =>
          pathOf(String(url)) === '/api/v1/document-revisions/rev-doc-search-unmount/content',
      ),
    ).toBe(false);
  });

  it('系统上下游关系只在系统事实库视图中显示', async () => {
    const bases = [
      {
        id: 'kb-system',
        projectId: 'p1',
        key: 'anything',
        name: '架构资料',
        kind: 'SYSTEM',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'user-1',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
    ];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/projects/p1/knowledge-bases' && method === 'GET')
        return pageReply(bases, null);
      if (path === '/api/v1/projects/p1/units' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/unit-dependencies' && method === 'GET')
        return { status: 200, body: envelope([]) };
      return undefined;
    });

    renderKnowledge();
    expect(screen.queryByTestId('knowledge-system-relations')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /系统事实库/ }));
    expect(await screen.findByTestId('knowledge-system-relations')).toBeInTheDocument();
    expect(await screen.findByText('当前项目还没有已声明的系统上下游关系。')).toBeInTheDocument();
  });
});
