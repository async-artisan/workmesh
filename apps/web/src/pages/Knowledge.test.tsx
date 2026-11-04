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

function openKnowledgeRevision(title: string) {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`找不到修订行：${title}`);
  fireEvent.click(within(row).getByRole('button', { name: '查看正文' }));
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
});
