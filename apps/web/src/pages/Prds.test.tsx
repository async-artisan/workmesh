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

const documentDetail = {
  document: {
    id: 'doc-1',
    projectId: 'p1',
    knowledgeBaseId: 'kb-1',
    requirementId: null,
    kind: 'PRD',
    version: 2,
    currentPublishedRevisionId: 'rev-pub',
    archivedAt: null,
  },
  revisions: [publishedRevision],
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

describe('Prds（候选修订 / 返修 / 撤销发布）', () => {
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

  it('创建 PRD 候选后使用服务端返回的 reviewRequestId 打开评审，不直接发布', async () => {
    const body = '# Checkout flow';
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      if (path === '/api/v1/projects/p1/documents' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            document: documentDetail.document,
            revision: publishedRevision,
            reviewRequestId: 'review-1',
            reviewKind: 'PRD',
            slots: [],
          }),
        };
      return undefined;
    });

    renderPrds();
    expect(await screen.findByRole('option', { name: 'Demo（DEMO）' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建 PRD 候选' }));
    fireEvent.change(screen.getByLabelText('PRD 标题'), { target: { value: 'Checkout' } });
    fireEvent.change(screen.getByLabelText('PRD 正文'), { target: { value: body } });
    fireEvent.click(screen.getByRole('button', { name: '创建候选' }));

    const createCall = await waitFor(() => {
      const call = mockCallsFind('/api/v1/projects/p1/documents', 'POST');
      expect(call).toBeTruthy();
      return call;
    });
    expect(bodyOf(createCall?.[1] ?? {})).toEqual({
      knowledgeBaseId: 'kb-1',
      kind: 'PRD',
      requirementId: null,
      title: 'Checkout',
      bodyBase64: utf8ToBase64(body),
      mimeType: 'text/markdown; charset=utf-8',
    });

    expect(await screen.findByText('评审请求已生成')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '打开评审' }));
    expect(await screen.findByText('评审页面')).toBeInTheDocument();
  });

  it('撤销发布提交 expectedVersion + 一次性票据；旧版本 409 原样展示且不显示成功', async () => {
    mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/documents' && method === 'GET')
        return { status: 200, body: envelope({ items: [documentDetail], nextCursor: null }) };
      if (path === '/api/v1/auth/action-previews') return withPreview(init);
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
      return undefined;
    });

    renderPrds();
    expect(await screen.findByRole('button', { name: '撤销发布' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '撤销发布' }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('撤销原因'), { target: { value: '内容有误' } });
    expect(await within(dialog).findByLabelText('确认密码')).toBeInTheDocument();

    const previewCalls = mock.mock.calls.filter(([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews');
    const lastPreview = bodyOf(previewCalls[previewCalls.length - 1]?.[1] ?? {});
    expect(lastPreview).toMatchObject({
      action: 'KNOWLEDGE_WITHDRAW',
      targetType: 'KNOWLEDGE_DOCUMENT',
      targetId: 'doc-1',
      expectedVersion: 2,
      roleSlot: null,
      payload: { reason: '内容有误' },
    });

    fireEvent.change(within(dialog).getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
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
