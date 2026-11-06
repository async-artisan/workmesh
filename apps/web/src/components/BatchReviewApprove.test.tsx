import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchReviewApprove, type BatchReviewTarget } from './BatchReviewApprove';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const targets: BatchReviewTarget[] = [
  {
    reviewId: 'review-1',
    projectId: 'p1',
    slotId: 'slot-1',
    requiredRoleId: 'role-product',
    expectedVersion: 2,
    label: 'DEMO-1 · 登录页改版 · 产品 · v2',
  },
  {
    reviewId: 'review-2',
    projectId: 'p1',
    slotId: 'slot-2',
    requiredRoleId: null,
    expectedVersion: 3,
    label: 'DEMO-2 · 订单取消 · 未指定角色 · v3',
  },
];

function reviewOf(id: string, version: number, slotId: string) {
  return {
    id,
    projectId: 'p1',
    kind: 'TASK_ARTIFACT_SET',
    status: 'OPEN',
    version,
    subjectDigest: 'd'.repeat(64),
    documentRevisionId: null,
    artifactSetId: `artifact-${id}`,
    taskId: 'task-1',
    slots: [
      {
        id: slotId,
        slotKey: 'product',
        requiredUserId: 'u-1',
        requiredRoleId: id === 'review-1' ? 'role-product' : null,
        decided: false,
        viewerCanDecide: true,
      },
    ],
    decisions: [],
    subject: {},
  };
}

function handler() {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init ?? {});
    if (path === '/api/v1/review-requests/review-1' && method === 'GET')
      return { status: 200, body: envelope(reviewOf('review-1', 2, 'slot-1')) };
    if (path === '/api/v1/review-requests/review-2' && method === 'GET')
      return { status: 200, body: envelope(reviewOf('review-2', 3, 'slot-2')) };
    if (path === '/api/v1/auth/action-previews' && method === 'POST')
      return {
        status: 200,
        body: envelope({
          binding: bodyOf(init ?? {}),
          actionDigest: 'a'.repeat(64),
          display: {
            action: 'REVIEW_DECIDE',
            targetType: 'REVIEW_REQUEST',
            targetId: 'review-1',
            expectedVersion: 2,
            projectId: 'p1',
            roleSlot: null,
          },
        }),
      };
    if (path === '/api/v1/auth/confirmation-tickets' && method === 'POST') {
      const binding = bodyOf(init ?? {}) as { targetId?: string };
      return {
        status: 201,
        body: envelope({
          ticketId: `ticket-${binding.targetId}`,
          ticketSecret: `secret-${binding.targetId}`,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          actionDigest: 'a'.repeat(64),
        }),
      };
    }
    if (path === '/api/v1/review-requests/batch-decisions' && method === 'POST')
      return {
        status: 200,
        body: envelope({
          results: [
            { reviewId: 'review-1', status: 'APPLIED', decisionId: 'd-1' },
            { reviewId: 'review-2', status: 'VERSION_CONFLICT', message: '版本已变化' },
          ],
        }),
      };
    return undefined;
  };
}

describe('BatchReviewApprove（批量批准）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
  });

  afterEach(() => {
    setCsrfToken(null);
    vi.restoreAllMocks();
  });

  it('一次密码为每条评审签票，并按服务端结果汇总批准/失败', async () => {
    const mock = mockFetch(handler());
    const onCompleted = vi.fn();

    render(
      <BatchReviewApprove open targets={targets} onClose={() => {}} onCompleted={onCompleted} />,
    );

    expect(screen.getByText('DEMO-1 · 登录页改版 · 产品 · v2')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/登录密码/), { target: { value: 'Yff-Demo-2026!' } });
    fireEvent.change(screen.getByLabelText(/给交付方的说明/), { target: { value: '证据齐全' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并批量批准' }));

    expect(await screen.findByText(/已批准 1 条 · 失败 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/版本已变化/)).toBeInTheDocument();
    expect(onCompleted).toHaveBeenCalledWith({ approved: 1, failed: 1 });

    const batchCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/review-requests/batch-decisions' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(batchCall?.[1] ?? {}) as {
      decision: string;
      items: Array<{
        reviewId: string;
        slotId: string;
        expectedVersion: number;
        comment?: string;
        confirmation: { ticketId: string; ticketSecret: string };
      }>;
    };
    expect(body.decision).toBe('APPROVE');
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      reviewId: 'review-1',
      slotId: 'slot-1',
      expectedVersion: 2,
      comment: '证据齐全',
      confirmation: { ticketId: 'ticket-review-1', ticketSecret: 'secret-review-1' },
    });
    expect(body.items[1]).toMatchObject({
      reviewId: 'review-2',
      slotId: 'slot-2',
      expectedVersion: 3,
      confirmation: { ticketId: 'ticket-review-2', ticketSecret: 'secret-review-2' },
    });

    // 预览/签票都带上服务端要求的 payload（决定、subjectDigest、comment）。
    const ticketCalls = mock.mock.calls.filter(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/confirmation-tickets' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(ticketCalls).toHaveLength(2);
    const firstBinding = bodyOf(ticketCalls[0]?.[1] ?? {}) as {
      payload: { decision: string; subjectDigest: string; comment: string | null };
      expectedVersion: number;
    };
    expect(firstBinding.expectedVersion).toBe(2);
    expect(firstBinding.payload).toMatchObject({
      decision: 'APPROVE',
      subjectDigest: 'd'.repeat(64),
      comment: '证据齐全',
    });
  });

  it('密码为空时直接提示，不发起签票请求', async () => {
    const mock = mockFetch(handler());
    render(<BatchReviewApprove open targets={targets} onClose={() => {}} onCompleted={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: '验证密码并批量批准' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/请输入登录密码/);
    expect(
      mock.mock.calls.filter(([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews'),
    ).toHaveLength(0);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '验证密码并批量批准' })).toBeEnabled(),
    );
  });

  it('提交中显示加载状态并禁用批准按钮，避免重复提交', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inner = handler();
    mockFetch(async (url, init) => {
      // 卡住第一张票据的预览请求，模拟慢网络下的批量签票。
      if (pathOf(url) === '/api/v1/auth/action-previews') await gate;
      return inner(url, init);
    });

    render(<BatchReviewApprove open targets={targets} onClose={() => {}} onCompleted={() => {}} />);

    fireEvent.change(screen.getByLabelText(/登录密码/), { target: { value: 'Yff-Demo-2026!' } });
    fireEvent.click(screen.getByRole('button', { name: '验证密码并批量批准' }));

    expect(await screen.findByText(/正在逐条签票并提交（1\/2）…/)).toBeInTheDocument();
    const busyButton = screen.getByRole('button', { name: /签票中 1\/2…/ });
    expect(busyButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: '验证密码并批量批准' })).not.toBeInTheDocument();

    release();
    expect(await screen.findByText(/已批准 1 条 · 失败 1 条/)).toBeInTheDocument();
  });
});
