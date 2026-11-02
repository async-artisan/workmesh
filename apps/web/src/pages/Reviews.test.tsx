import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Reviews } from './Reviews';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf } from '../test-utils';

const review = {
  id: 'review-1',
  projectId: 'p1',
  kind: 'PRD',
  status: 'OPEN',
  version: 4,
  subjectDigest: 'sha256-subject',
  documentRevisionId: 'rev-1',
  artifactSetId: null,
  taskId: null,
  slots: [
    {
      id: 'slot-1',
      slotKey: 'owner',
      requiredRoleId: null,
      requiredUserId: 'user-1',
      sourceSlotBindingId: null,
    },
  ],
  decisions: [],
  subject: null,
};

function previewReply(init: RequestInit) {
  const binding = bodyOf(init);
  return {
    status: 200,
    body: envelope({
      binding,
      actionDigest: 'digest-action',
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

function ticketReply() {
  return {
    status: 201,
    body: envelope({
      ticketId: 'ticket-1',
      ticketSecret: 'secret-1',
      expiresAt: '2026-11-01T00:05:00.000Z',
      actionDigest: 'digest-action',
    }),
  };
}

function renderReviews() {
  return render(
    <MemoryRouter initialEntries={['/reviews?id=review-1']}>
      <Reviews />
    </MemoryRouter>,
  );
}

async function reachTicket() {
  expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-action');
  fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
  fireEvent.click(screen.getByRole('button', { name: '验证密码并签发票据' }));
  expect(await screen.findByText(/票据已签发/)).toBeInTheDocument();
}

describe('Reviews（槽位 / digest / 版本，权限由服务端拒绝）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
  });

  afterEach(() => {
    setCsrfToken(null);
  });

  it('展示服务端槽位、摘要与版本；槽位未分配时即使按钮可点也被服务端 403 拒绝', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      if (path === '/api/v1/auth/action-previews') return previewReply(init);
      if (path === '/api/v1/auth/confirmation-tickets') return ticketReply();
      if (path === '/api/v1/review-requests/review-1/decisions' && method === 'POST')
        return {
          status: 403,
          body: {
            error: {
              code: 'REVIEW_SLOT_NOT_ASSIGNED',
              message: '该槽位未分配审批人',
              requestId: 'req-slot',
            },
          },
        };
      return undefined;
    });

    renderReviews();

    expect(await screen.findByTestId('review-subject-digest')).toHaveTextContent('sha256-subject');
    expect(screen.getByText('v4')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('未决定')).toBeInTheDocument();

    const decideButton = screen.getByRole('button', { name: '作出决定' });
    expect(decideButton).toBeEnabled();
    fireEvent.click(decideButton);
    fireEvent.click(await screen.findByRole('button', { name: '下一步：预览并验证密码' }));
    expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-action');

    const previewCall = mock.mock.calls.find(([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews');
    expect(bodyOf(previewCall?.[1] ?? {})).toMatchObject({
      action: 'REVIEW_DECIDE',
      targetType: 'REVIEW_REQUEST',
      targetId: 'review-1',
      expectedVersion: 4,
      roleSlot: null,
      payload: { slotId: 'slot-1', decision: 'APPROVE', subjectDigest: 'sha256-subject', comment: null },
    });

    await reachTicket();
    fireEvent.click(screen.getByRole('button', { name: '提交决定' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[REVIEW_SLOT_NOT_ASSIGNED] 该槽位未分配审批人 · requestId req-slot',
    );
    expect(screen.getByRole('button', { name: '作出决定' })).toBeEnabled();
    expect(screen.queryByText(/决定已记录/)).not.toBeInTheDocument();

    const decisionCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/review-requests/review-1/decisions' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(decisionCall?.[1] ?? {})).toEqual({
      slotId: 'slot-1',
      decision: 'APPROVE',
      expectedVersion: 4,
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
    expect(headersOf(decisionCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });

  it('评审旧版本 409 原样展示，不显示成功提示', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      if (path === '/api/v1/auth/action-previews') return previewReply(init);
      if (path === '/api/v1/auth/confirmation-tickets') return ticketReply();
      if (path === '/api/v1/review-requests/review-1/decisions' && method === 'POST')
        return {
          status: 409,
          body: {
            error: {
              code: 'VERSION_CONFLICT',
              message: '评审版本已变化，请重新加载',
              details: { currentVersion: 5 },
              requestId: 'req-409',
            },
          },
        };
      return undefined;
    });

    renderReviews();
    expect(await screen.findByTestId('review-subject-digest')).toHaveTextContent('sha256-subject');
    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    fireEvent.click(await screen.findByRole('button', { name: '下一步：预览并验证密码' }));
    await reachTicket();
    fireEvent.click(screen.getByRole('button', { name: '提交决定' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 评审版本已变化，请重新加载 · requestId req-409',
    );
    expect(screen.queryByText(/决定已记录|服务端已发布/)).not.toBeInTheDocument();

    const decisionCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/review-requests/review-1/decisions' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(decisionCall?.[1] ?? {}).expectedVersion).toBe(4);
  });

  it('撤销批准绑定 REVIEW_DECISION、版本与摘要，被拒时展示 envelope', async () => {
    const withDecision = {
      ...review,
      decisions: [
        {
          id: 'decision-1',
          approvalSlotId: 'slot-1',
          decision: 'APPROVE',
          subjectDigest: 'sha256-subject',
          comment: null,
          createdById: 'user-1',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    };

    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(withDecision) };
      if (path === '/api/v1/auth/action-previews') return previewReply(init);
      if (path === '/api/v1/auth/confirmation-tickets') return ticketReply();
      if (path === '/api/v1/review-decisions/decision-1/revoke' && method === 'POST')
        return {
          status: 403,
          body: {
            error: {
              code: 'FORBIDDEN',
              message: '只有原审批人可以撤销',
              requestId: 'req-403',
            },
          },
        };
      return undefined;
    });

    renderReviews();
    expect((await screen.findAllByText('批准')).length).toBeGreaterThan(0);

    const revokeButton = screen.getByRole('button', { name: '撤销批准' });
    expect(revokeButton).toBeEnabled();
    fireEvent.click(revokeButton);
    fireEvent.change(await screen.findByLabelText('撤销原因'), { target: { value: '发现遗漏' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步：预览并验证密码' }));
    expect(await screen.findByTestId('action-digest')).toHaveTextContent('digest-action');

    const previewCalls = mock.mock.calls.filter(
      ([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews',
    );
    expect(bodyOf(previewCalls[previewCalls.length - 1]?.[1] ?? {})).toMatchObject({
      action: 'REVIEW_REVOKE',
      targetType: 'REVIEW_DECISION',
      targetId: 'decision-1',
      expectedVersion: 4,
      roleSlot: null,
      payload: { decisionId: 'decision-1', subjectDigest: 'sha256-subject', reason: '发现遗漏' },
    });

    await reachTicket();
    const confirmDialog = screen.getByRole('dialog');
    fireEvent.click(within(confirmDialog).getByRole('button', { name: '撤销批准' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[FORBIDDEN] 只有原审批人可以撤销 · requestId req-403',
    );

    const revokeCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/review-decisions/decision-1/revoke' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(revokeCall?.[1] ?? {})).toEqual({
      expectedVersion: 4,
      reason: '发现遗漏',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
  });
});
