import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prds } from './Prds';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import { useProject } from '../test-utils';
import { bodyOf, envelope, methodOf, mockFetch, pathOf, type StubReply } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1, defaultKnowledgeBaseId: 'kb-1' };

const publishedRevision = {
  id: 'rev-pub',
  documentId: 'doc-1',
  seq: 1,
  title: 'Checkout',
  mimeType: 'text/markdown; charset=utf-8',
  byteLength: 12,
  digest: 'sha256-published',
  state: 'PUBLISHED',
  createdBy: 'user-1',
  basisUnderstandingRevisionId: null,
  deliveryScope: null,
  acceptance: null,
};

const candidateRevision = {
  id: 'rev-candidate',
  documentId: 'doc-1',
  seq: 2,
  title: 'Checkout v2',
  mimeType: 'text/markdown; charset=utf-8',
  byteLength: 18,
  digest: 'sha256-candidate',
  state: 'CANDIDATE',
  createdBy: 'agent-1',
  basisUnderstandingRevisionId: 'understanding-1',
  deliveryScope: {
    participatingRoleIds: ['role-product'],
    requiredOutputKinds: ['PRD', 'IMPL'],
    excludedRoles: [],
  },
  acceptance: [{ key: 'checkout-submit', text: '提交订单', verification: 'TEST' }],
  reviewRequestId: 'review-candidate',
};

const historicalRevision = {
  ...publishedRevision,
  id: 'rev-history',
  seq: 3,
  title: '历史归档标题',
  state: 'WITHDRAWN',
  digest: 'sha256-history',
};

const documentDetail = {
  document: {
    id: 'doc-1',
    projectId: 'p1',
    knowledgeBaseId: 'kb-1',
    requirementId: 'req-1',
    kind: 'PRD',
    version: 2,
    currentPublishedRevisionId: 'rev-pub',
    archivedAt: null,
  },
  revisions: [publishedRevision, candidateRevision],
  publishedRevision,
};

function prdDocumentFor(id: string, title: string, requirementId: string | null = null) {
  const rev = {
    ...publishedRevision,
    id: `rev-${id}`,
    documentId: id,
    title,
    digest: `sha256-${id}`,
  };
  return {
    document: { ...documentDetail.document, id, requirementId },
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

function raceDocument() {
  const base = { ...publishedRevision, id: 'rev-race-pub', title: '基线版本' };
  const a = {
    ...candidateRevision,
    id: 'rev-race-a',
    seq: 2,
    title: '候选 A',
    reviewRequestId: null,
  };
  const b = {
    ...candidateRevision,
    id: 'rev-race-b',
    seq: 3,
    title: '候选 B',
    reviewRequestId: null,
  };
  return {
    document: { ...documentDetail.document, id: 'doc-race' },
    revisions: [base, a, b],
    publishedRevision: base,
  };
}

function openRevision(title: string) {
  const row = screen.getByText(title).closest('tr');
  if (!row) throw new Error(`找不到修订行：${title}`);
  fireEvent.click(within(row).getByRole('button', { name: '查看内容' }));
}

function renderPrds() {
  return render(
    <MemoryRouter initialEntries={['/prd']}>
      <Routes>
        <Route path="/prd" element={<Prds />} />
        <Route path="/reviews" element={<div>评审页面</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function withPreview(init: RequestInit) {
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

describe('Prds（Agent 候选查看、差异与评审）', () => {
  let mock: ReturnType<typeof mockFetch>;

  function mockCallsFind(path: string, method: string) {
    return mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === path && methodOf(init ?? {}) === method,
    );
  }

  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('默认以查看为主，不提供手动新建或编辑 PRD 的入口', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      return undefined;
    });

    renderPrds();
    expect(await screen.findByText('版本与评审')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建 PRD 候选' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'PRD 正文' })).not.toBeInTheDocument();
    expect(screen.getByText(/本地 Product Agent 生成并提交候选/)).toBeInTheDocument();
  });

  it('查看候选内容时同时展示与已发布版本的差异', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      if (path === '/api/v1/document-revisions/rev-candidate/content' && method === 'GET') {
        return {
          status: 200,
          body: envelope({
            revisionId: 'rev-candidate',
            mimeType: 'text/markdown',
            encoding: 'base64',
            bodyBase64: utf8ToBase64('# Checkout v2\n- new'),
            byteLength: 18,
            sha256: 'sha256-candidate',
          }),
        };
      }
      if (path === '/api/v1/document-revisions/rev-pub/content' && method === 'GET') {
        return {
          status: 200,
          body: envelope({
            revisionId: 'rev-pub',
            mimeType: 'text/markdown',
            encoding: 'base64',
            bodyBase64: utf8ToBase64('# Checkout\n- old'),
            byteLength: 16,
            sha256: 'sha256-published',
          }),
        };
      }
      return undefined;
    });

    renderPrds();
    expect(await screen.findByText('Checkout v2')).toBeInTheDocument();
    const candidateRow = screen.getByText('Checkout v2').closest('tr');
    expect(candidateRow).not.toBeNull();
    fireEvent.click(within(candidateRow as HTMLElement).getByRole('button', { name: '查看内容' }));

    const diff = await screen.findByTestId('prd-diff');
    expect(screen.getByText(/已发布 v1 → 候选 v2/)).toBeInTheDocument();
    expect(within(diff).getByText(/共 1 处修改 · 新增 \+2 · 删除 -2/)).toBeInTheDocument();
    const lineTexts = (kind: 'add' | 'remove') =>
      Array.from(
        diff.querySelectorAll(`.wm-diff-line[data-kind="${kind}"] .wm-diff-line__text`),
        (element) => element.textContent,
      );
    expect(lineTexts('remove')).toEqual(
      expect.arrayContaining(['删除：# Checkout', '删除：- old']),
    );
    expect(lineTexts('add')).toEqual(
      expect.arrayContaining(['新增：# Checkout v2', '新增：- new']),
    );
  });

  it('搜索覆盖所有修订标题、版本号、版本状态，并读取全部分页需求', async () => {
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
    const searchableDocument = {
      ...documentDetail,
      document: { ...documentDetail.document, requirementId: 'req-2' },
      revisions: [publishedRevision, candidateRevision, historicalRevision],
    };

    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [searchableDocument], nextCursor: null }) };
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        if (!cursor)
          return { status: 200, body: envelope({ items: [requirementOne], nextCursor: '2' }) };
        if (cursor === '2')
          return { status: 200, body: envelope({ items: [requirementTwo], nextCursor: null }) };
      }
      return undefined;
    });

    renderPrds();
    expect((await screen.findAllByText('Checkout')).length).toBeGreaterThan(0);
    const search = screen.getByLabelText('搜索 PRD');

    // 候选版本标题只在 revisions 中出现；历史版本标题同样可搜。
    fireEvent.change(search, { target: { value: 'Checkout v2' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: '历史归档标题' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: 'v3' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: 'WITHDRAWN' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);

    // 第二页需求编号/标题可搜。
    fireEvent.change(search, { target: { value: 'DEMO-002' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);
    fireEvent.change(search, { target: { value: '第二页需求' } });
    expect(screen.getAllByText('Checkout').length).toBeGreaterThan(0);

    fireEvent.change(search, { target: { value: '完全不存在的关键词' } });
    expect(screen.getByText('没有匹配的 PRD，清空搜索或状态筛选。')).toBeInTheDocument();
  });

  it('文档列表聚合两页，第 51 个 PRD 可被搜索到', async () => {
    const documents = Array.from({ length: 51 }, (_, index) =>
      prdDocumentFor(`doc-${index + 1}`, `文档 ${index + 1}`),
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

    renderPrds();
    await screen.findAllByText('文档 1');
    fireEvent.change(await screen.findByLabelText('搜索 PRD'), { target: { value: '文档 51' } });
    expect(await screen.findByText('文档 51')).toBeInTheDocument();

    expect(mock.mock.calls.some(([url]) => String(url).includes('kind=PRD'))).toBe(true);
    expect(screen.queryByText(/文档列表可能未完整加载/)).not.toBeInTheDocument();
  });

  it('第 40 页正常结束视为完整文档列表', async () => {
    let documentCalls = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        documentCalls += 1;
        return pageReply(
          [prdDocumentFor(`doc-${documentCalls}`, `文档 ${documentCalls}`)],
          documentCalls < 40 ? String(documentCalls + 1) : null,
        );
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderPrds();
    fireEvent.change(await screen.findByLabelText('搜索 PRD'), { target: { value: '文档 40' } });
    expect(await screen.findByText('文档 40')).toBeInTheDocument();
    expect(documentCalls).toBe(40);
    expect(screen.queryByText(/文档列表可能未完整加载/)).not.toBeInTheDocument();
    expect(screen.queryByText(/文档列表读取失败/)).not.toBeInTheDocument();
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
          [prdDocumentFor(`doc-${documentCalls}`, `文档 ${documentCalls}`)],
          String(documentCalls + 1),
        );
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderPrds();
    expect(await screen.findByText(/文档列表可能未完整加载：已读取前 40 页/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新读取文档列表' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索 PRD'), { target: { value: '文档 40' } });
    expect(screen.getByText('文档 40')).toBeInTheDocument();
    expect(documentCalls).toBe(40);
  });

  it('文档列表游标重复时停止读取并保留已读文档', async () => {
    let documentCalls = 0;
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        documentCalls += 1;
        return pageReply([prdDocumentFor(`doc-${documentCalls}`, `文档 ${documentCalls}`)], '2');
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderPrds();
    expect(await screen.findByText(/服务端游标重复（已读取 2 页）/)).toBeInTheDocument();
    expect(screen.getByText('文档 2')).toBeInTheDocument();
    expect(documentCalls).toBe(2);
  });

  it('文档列表读取失败时显示真实错误和重试，不显示没有文档', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return {
          status: 503,
          body: {
            error: {
              code: 'DOCUMENTS_UNAVAILABLE',
              message: '文档服务不可用',
              requestId: 'req-docs',
            },
          },
        };
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      return undefined;
    });

    renderPrds();
    expect((await screen.findAllByText(/文档列表读取失败/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('alert')).toHaveTextContent('文档服务不可用');
    expect(screen.getByRole('button', { name: '重新读取文档列表' })).toBeInTheDocument();
    expect(
      screen.queryByText('该项目还没有 PRD 文档，等待 Product Agent 提交候选。'),
    ).not.toBeInTheDocument();
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
        if (documentCalls === 1) return pageReply([prdDocumentFor('doc-1', '保留的旧文档')], null);
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

    renderPrds();
    expect((await screen.findAllByText('保留的旧文档')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '刷新文档' }));
    expect((await screen.findAllByText(/文档列表读取失败/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('保留的旧文档').length).toBeGreaterThan(0);
    expect(screen.queryByText(/还没有 PRD 文档/)).not.toBeInTheDocument();
  });

  it('项目切换后不会残留旧项目文档', async () => {
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([prdDocumentFor('doc-p1', 'P1 文档')], null);
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([prdDocumentFor('doc-p2', 'P2 文档')], null);
      if (path.endsWith('/requirements') && method === 'GET') return pageReply([], null);
      return undefined;
    });

    renderPrds();
    expect((await screen.findAllByText('P1 文档')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 文档')).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText('P1 文档')).not.toBeInTheDocument());
  });

  it('A 慢 B 快时只显示 B 的正文，A 完成后不得覆盖', async () => {
    const a = deferred<StubReply>();
    const b = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument()], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-race-a/content') return a.promise;
      if (path === '/api/v1/document-revisions/rev-race-b/content') return b.promise;
      if (path === '/api/v1/document-revisions/rev-race-pub/content')
        return contentReply('rev-race-pub', '基线正文');
      return undefined;
    });

    renderPrds();
    await screen.findAllByText('候选 A');
    openRevision('候选 A');
    openRevision('候选 B');

    b.resolve(contentReply('rev-race-b', '候选 B 正文'));
    expect((await screen.findAllByText(/候选 B 正文/)).length).toBeGreaterThan(0);

    a.resolve(contentReply('rev-race-a', '候选 A 正文'));
    await waitFor(() => expect(screen.queryAllByText(/候选 A 正文/)).toHaveLength(0));
    expect(screen.getAllByText(/候选 B 正文/).length).toBeGreaterThan(0);
  });

  it('A 失败 B 成功时不能显示 A 的错误', async () => {
    const a = deferred<StubReply>();
    const b = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument()], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-race-a/content') return a.promise;
      if (path === '/api/v1/document-revisions/rev-race-b/content') return b.promise;
      if (path === '/api/v1/document-revisions/rev-race-pub/content')
        return contentReply('rev-race-pub', '基线正文');
      return undefined;
    });

    renderPrds();
    await screen.findAllByText('候选 A');
    openRevision('候选 A');
    openRevision('候选 B');
    b.resolve(contentReply('rev-race-b', '候选 B 正文'));
    expect((await screen.findAllByText(/候选 B 正文/)).length).toBeGreaterThan(0);

    a.resolve({
      status: 500,
      body: { error: { code: 'A_FAILED', message: 'A 读取失败', requestId: 'req-a' } },
    });
    await waitFor(() => expect(screen.queryByText(/A 读取失败/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/候选 B 正文/).length).toBeGreaterThan(0);
  });

  it('B 失败 A 成功时保留 B 的错误且不被 A 覆盖', async () => {
    const a = deferred<StubReply>();
    const b = deferred<StubReply>();
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument()], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-race-a/content') return a.promise;
      if (path === '/api/v1/document-revisions/rev-race-b/content') return b.promise;
      if (path === '/api/v1/document-revisions/rev-race-pub/content')
        return contentReply('rev-race-pub', '基线正文');
      return undefined;
    });

    renderPrds();
    await screen.findAllByText('候选 A');
    openRevision('候选 A');
    openRevision('候选 B');
    b.resolve({
      status: 500,
      body: { error: { code: 'B_FAILED', message: 'B 读取失败', requestId: 'req-b' } },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('B 读取失败');

    a.resolve(contentReply('rev-race-a', '候选 A 正文'));
    await waitFor(() => expect(screen.queryByText(/候选 A 正文/)).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('B 读取失败');
  });

  it('切换文档后旧正文请求完成不得恢复旧文档正文', async () => {
    const a = deferred<StubReply>();
    const second = prdDocumentFor('doc-2', '第二文档');
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument(), second], null);
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET')
        return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-race-a/content') return a.promise;
      if (path === '/api/v1/document-revisions/rev-race-pub/content')
        return contentReply('rev-race-pub', '基线正文');
      return undefined;
    });

    renderPrds();
    await screen.findAllByText('候选 A');
    openRevision('候选 A');
    const secondRow = screen.getByText('第二文档').closest('tr');
    fireEvent.click(within(secondRow as HTMLElement).getByRole('button', { name: '查看版本' }));

    a.resolve(contentReply('rev-race-a', '候选 A 正文'));
    await waitFor(() => expect(screen.queryByText(/候选 A 正文/)).not.toBeInTheDocument());
    expect(screen.getAllByText('第二文档').length).toBeGreaterThan(0);
  });

  it('项目切换后旧正文请求完成不得写入新项目页面', async () => {
    const a = deferred<StubReply>();
    const projectTwo = { ...project, id: 'p2', key: 'OPS', name: 'Ops' };
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project, projectTwo]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return pageReply([raceDocument()], null);
      if (path === '/api/v1/projects/p2/documents' && method === 'GET')
        return pageReply([prdDocumentFor('doc-p2', 'P2 文档')], null);
      if (path.endsWith('/requirements') && method === 'GET') return pageReply([], null);
      if (path === '/api/v1/document-revisions/rev-race-a/content') return a.promise;
      if (path === '/api/v1/document-revisions/rev-race-pub/content')
        return contentReply('rev-race-pub', '基线正文');
      return undefined;
    });

    renderPrds();
    await screen.findAllByText('候选 A');
    openRevision('候选 A');
    fireEvent.change(screen.getByLabelText('选择项目'), { target: { value: 'p2' } });
    expect((await screen.findAllByText('P2 文档')).length).toBeGreaterThan(0);

    a.resolve(contentReply('rev-race-a', '候选 A 正文'));
    await waitFor(() => expect(screen.queryByText(/候选 A 正文/)).not.toBeInTheDocument());
    expect(screen.getAllByText('P2 文档').length).toBeGreaterThan(0);
  });

  it('需求索引分页失败时保留文档列表并提示索引不可信', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      if (path === '/api/v1/projects/p1/requirements' && method === 'GET') {
        const cursor = new URL(String(url), 'http://localhost').searchParams.get('cursor');
        if (!cursor) return { status: 200, body: envelope({ items: [], nextCursor: '2' }) };
        return {
          status: 500,
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

    renderPrds();
    expect((await screen.findAllByText('Checkout')).length).toBeGreaterThan(0);
    expect(await screen.findByText(/关联需求索引读取失败/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新读取需求索引' })).toBeInTheDocument();
    expect(screen.getAllByText('关联需求暂时无法读取').length).toBeGreaterThan(0);
  });

  it('候选带评审请求 ID 时提供进入评审入口', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      return undefined;
    });

    renderPrds();
    expect(await screen.findByRole('button', { name: '进入评审' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '进入评审' }));
    expect(await screen.findByText('评审页面')).toBeInTheDocument();
  });

  it('撤销发布仍然需要确认票据，并把服务端冲突原样展示', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      if (path === '/api/v1/auth/action-previews') return withPreview(init);
      if (path === '/api/v1/auth/confirmation-tickets') {
        return {
          status: 201,
          body: envelope({
            ticketId: 'ticket-1',
            ticketSecret: 'secret-1',
            expiresAt: '2026-11-01T00:05:00.000Z',
            actionDigest: 'digest-withdraw',
          }),
        };
      }
      if (path === '/api/v1/documents/doc-1/withdraw' && method === 'POST') {
        return {
          status: 409,
          body: {
            error: {
              code: 'VERSION_CONFLICT',
              message: '文档版本已变化',
              details: { currentVersion: 3 },
              requestId: 'req-409',
            },
          },
        };
      }
      return undefined;
    });

    renderPrds();
    expect(await screen.findByRole('button', { name: '撤销发布' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销发布' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('撤销原因'), { target: { value: '内容有误' } });
    expect(await within(dialog).findByLabelText('确认密码')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('确认密码'), {
      target: { value: 'secret-pass' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
    expect(await within(dialog).findByText(/票据已签发/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '撤销发布' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 文档版本已变化 · requestId req-409',
    );
    expect(screen.queryByText(/发布已撤销/)).not.toBeInTheDocument();

    const withdrawCall = mockCallsFind('/api/v1/documents/doc-1/withdraw', 'POST');
    expect(bodyOf(withdrawCall?.[1] ?? {})).toEqual({
      expectedVersion: 2,
      reason: '内容有误',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
  });
});
