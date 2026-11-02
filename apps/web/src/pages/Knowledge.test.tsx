import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Knowledge } from './Knowledge';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

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
});
