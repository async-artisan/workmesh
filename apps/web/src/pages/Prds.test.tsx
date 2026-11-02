import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Prds } from './Prds';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import { useProject } from '../test-utils';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

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
  deliveryScope: { participatingRoleIds: ['role-product'], requiredOutputKinds: ['PRD', 'IMPL'], excludedRoles: [] },
  acceptance: [{ key: 'checkout-submit', text: '提交订单', verification: 'TEST' }],
  reviewRequestId: 'review-candidate',
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
    return mock.mock.calls.find(([url, init]) => pathOf(String(url)) === path && methodOf(init ?? {}) === method);
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
      if (path === '/api/v1/projects' && method === 'GET') return { status: 200, body: envelope([project]) };
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
      if (path === '/api/v1/projects' && method === 'GET') return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      if (path === '/api/v1/document-revisions/rev-candidate/content' && method === 'GET') {
        return { status: 200, body: envelope({ revisionId: 'rev-candidate', mimeType: 'text/markdown', encoding: 'base64', bodyBase64: utf8ToBase64('# Checkout v2\n- new'), byteLength: 18, sha256: 'sha256-candidate' }) };
      }
      if (path === '/api/v1/document-revisions/rev-pub/content' && method === 'GET') {
        return { status: 200, body: envelope({ revisionId: 'rev-pub', mimeType: 'text/markdown', encoding: 'base64', bodyBase64: utf8ToBase64('# Checkout\n- old'), byteLength: 16, sha256: 'sha256-published' }) };
      }
      return undefined;
    });

    renderPrds();
    expect(await screen.findByText('Checkout v2')).toBeInTheDocument();
    const candidateRow = screen.getByText('Checkout v2').closest('tr');
    expect(candidateRow).not.toBeNull();
    fireEvent.click(within(candidateRow as HTMLElement).getByRole('button', { name: '查看内容' }));

    const diff = await screen.findByTestId('prd-diff');
    expect(diff).toHaveTextContent('- # Checkout');
    expect(diff).toHaveTextContent('+ # Checkout v2');
    expect(diff).toHaveTextContent('- - old');
    expect(diff).toHaveTextContent('+ - new');
  });

  it('候选带评审请求 ID 时提供进入评审入口', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET') return { status: 200, body: envelope([project]) };
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
      if (path === '/api/v1/projects' && method === 'GET') return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET') {
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      }
      if (path === '/api/v1/auth/action-previews') return withPreview(init);
      if (path === '/api/v1/auth/confirmation-tickets') {
        return {
          status: 201,
          body: envelope({ ticketId: 'ticket-1', ticketSecret: 'secret-1', expiresAt: '2026-11-01T00:05:00.000Z', actionDigest: 'digest-withdraw' }),
        };
      }
      if (path === '/api/v1/documents/doc-1/withdraw' && method === 'POST') {
        return {
          status: 409,
          body: { error: { code: 'VERSION_CONFLICT', message: '文档版本已变化', details: { currentVersion: 3 }, requestId: 'req-409' } },
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
    fireEvent.change(within(dialog).getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '验证密码并签发票据' }));
    expect(await within(dialog).findByText(/票据已签发/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '撤销发布' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('[VERSION_CONFLICT] 文档版本已变化 · requestId req-409');
    expect(screen.queryByText(/发布已撤销/)).not.toBeInTheDocument();

    const withdrawCall = mockCallsFind('/api/v1/documents/doc-1/withdraw', 'POST');
    expect(bodyOf(withdrawCall?.[1] ?? {})).toEqual({
      expectedVersion: 2,
      reason: '内容有误',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
  });
});
