import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReviewDecision } from './ReviewDecision';
import { setCsrfToken } from '../api/client';
import { utf8ToBase64 } from '../api/resources';
import { useAuthStore } from '../store/auth';
import { envelope, mockFetch, pathOf } from '../test-utils';

const review = {
  id: 'review-1',
  projectId: 'p1',
  kind: 'PRD_PUBLICATION',
  status: 'OPEN',
  version: 3,
  subjectDigest: 'd'.repeat(64),
  documentRevisionId: 'rev-2',
  artifactSetId: null,
  taskId: null,
  slots: [
    {
      id: 'slot-1',
      slotKey: 'product',
      requiredRoleId: 'role-product',
      requiredUserId: 'u-2',
      sourceSlotBindingId: null,
      viewerCanDecide: true,
    },
  ],
  decisions: [],
  subject: {
    documentId: 'doc-1',
    knowledgeBaseId: 'kb-1',
    documentVersion: 2,
    currentPublishedRevisionId: 'rev-1',
    revisionId: 'rev-2',
    revisionDigest: 'e'.repeat(64),
  },
};

const revisions = [
  {
    id: 'rev-1',
    documentId: 'doc-1',
    seq: 1,
    title: 'PRD v1',
    mimeType: 'text/markdown',
    byteLength: 14,
    digest: 'a'.repeat(64),
    state: 'PUBLISHED',
    createdBy: 'u-1',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
  },
  {
    id: 'rev-2',
    documentId: 'doc-1',
    seq: 2,
    title: 'PRD v2',
    mimeType: 'text/markdown',
    byteLength: 20,
    digest: 'b'.repeat(64),
    state: 'CANDIDATE',
    createdBy: 'u-1',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: [{ key: 'a1', text: '登录失败 3 次锁定', verification: 'test' }],
  },
];

function contentOf(revisionId: string, text: string) {
  return {
    revisionId,
    mimeType: 'text/markdown',
    encoding: 'base64',
    bodyBase64: utf8ToBase64(text),
    byteLength: text.length,
    sha256: revisionId === 'rev-1' ? 'a'.repeat(64) : 'b'.repeat(64),
  };
}

describe('ReviewDecision（证据 + 一次确认 + 回执）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useAuthStore.getState().setSession({ id: 'u-1', email: 'alice@example.com' });
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('展示正文、差异、验收与历史，并在一次确认后给出回执', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = init?.method ?? 'GET';
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      if (path === '/api/v1/documents/doc-1' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            document: {
              id: 'doc-1',
              projectId: 'p1',
              knowledgeBaseId: 'kb-1',
              requirementId: null,
              kind: 'PRD',
              version: 2,
              currentPublishedRevisionId: 'rev-1',
              archivedAt: null,
            },
            revisions,
            publishedRevision: revisions[0],
          }),
        };
      if (path === '/api/v1/document-revisions/rev-2/content' && method === 'GET')
        return { status: 200, body: envelope(contentOf('rev-2', '# 登录页改版\n- 新增记住登录\n')) };
      if (path === '/api/v1/document-revisions/rev-1/content' && method === 'GET')
        return { status: 200, body: envelope(contentOf('rev-1', '# 登录页改版\n- 旧行为\n')) };
      if (path === '/api/v1/auth/action-previews' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            binding: {},
            actionDigest: 'digest-a',
            display: {
              action: 'REVIEW_DECIDE',
              targetType: 'REVIEW_REQUEST',
              targetId: 'review-1',
              expectedVersion: 3,
              projectId: 'p1',
              roleSlot: { roleId: 'role-product', approvalSlotId: 'slot-1' },
            },
          }),
        };
      if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            ticketId: 't1',
            ticketSecret: 's1',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            actionDigest: 'digest-a',
          }),
        };
      if (path === '/api/v1/review-requests/review-1/decisions' && method === 'POST')
        return {
          status: 201,
          body: envelope({
            review: {
              ...review,
              status: 'APPROVED',
              decisions: [
                {
                  id: 'dec-1',
                  approvalSlotId: 'slot-1',
                  decision: 'APPROVE',
                  subjectDigest: 'd'.repeat(64),
                  comment: null,
                  createdById: 'stamp-1',
                  createdAt: '2026-11-02T00:00:00.000Z',
                  actor: { id: 'u-1', email: 'alice@example.com' },
                },
              ],
            },
            decisionId: 'dec-1',
            published: true,
            publicationId: 'pub-1',
            documentVersion: 3,
            replayed: false,
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/reviews/review-1']}>
        <Routes>
          <Route path="/reviews/:reviewId" element={<ReviewDecision />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('PRD v2')).toBeInTheDocument();
    expect(screen.getAllByText(/新增记住登录/).length).toBeGreaterThan(0);
    expect(screen.getByText(/与已发布版本的差异/)).toBeInTheDocument();
    expect(screen.getByText(/登录失败 3 次锁定/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    fireEvent.click(screen.getByRole('button', { name: /下一步：预览并验证/ }));
    fireEvent.change(await screen.findByLabelText('确认密码'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交决定' }));

    expect(await screen.findByText(/批准 · product/)).toBeInTheDocument();
    expect(screen.getByText(/复制审计行/)).toBeInTheDocument();
    expect((await screen.findAllByText('alice@example.com')).length).toBeGreaterThan(0);
  });
});
