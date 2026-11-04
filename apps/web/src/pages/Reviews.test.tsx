import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Reviews } from './Reviews';
import { setCsrfToken } from '../api/client';
import {
  bodyOf,
  envelope,
  headersOf,
  methodOf,
  mockFetch,
  pathOf,
  useProject,
} from '../test-utils';

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

function renderReviewInbox() {
  return render(
    <MemoryRouter initialEntries={['/reviews']}>
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
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('展示服务端槽位、摘要与版本；槽位未分配时即使按钮可点也被服务端 403 拒绝', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return {
          status: 200,
          body: envelope([{ id: 'p1', key: 'DEMO', name: 'Demo', version: 1 }]),
        };
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

    const previewCall = mock.mock.calls.find(
      ([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews',
    );
    expect(bodyOf(previewCall?.[1] ?? {})).toMatchObject({
      action: 'REVIEW_DECIDE',
      targetType: 'REVIEW_REQUEST',
      targetId: 'review-1',
      expectedVersion: 4,
      roleSlot: null,
      payload: {
        slotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: 'sha256-subject',
        comment: null,
      },
    });

    await reachTicket();
    fireEvent.click(screen.getByRole('button', { name: '提交决定' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[REVIEW_SLOT_NOT_ASSIGNED] 该槽位未分配审批人 · requestId req-slot',
    );
    expect(screen.getByRole('button', { name: '作出决定' })).toBeEnabled();
    expect(screen.queryByText(/决定已记录/)).not.toBeInTheDocument();

    const decisionCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/review-requests/review-1/decisions' &&
        methodOf(init ?? {}) === 'POST',
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
      if (path === '/api/v1/projects' && method === 'GET')
        return {
          status: 200,
          body: envelope([{ id: 'p1', key: 'DEMO', name: 'Demo', version: 1 }]),
        };
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
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/review-requests/review-1/decisions' &&
        methodOf(init ?? {}) === 'POST',
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
      if (path === '/api/v1/projects' && method === 'GET')
        return {
          status: 200,
          body: envelope([{ id: 'p1', key: 'DEMO', name: 'Demo', version: 1 }]),
        };
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
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/review-decisions/decision-1/revoke' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(revokeCall?.[1] ?? {})).toEqual({
      expectedVersion: 4,
      reason: '发现遗漏',
      confirmation: { ticketId: 'ticket-1', ticketSecret: 'secret-1' },
    });
  });

  it('无深链 ID 时默认加载当前项目的待评审收件箱，并可打开详情', async () => {
    useProject('p1');
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return {
          status: 200,
          body: envelope([{ id: 'p1', key: 'demo', name: 'Demo', version: 1 }]),
        };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET')
        return {
          status: 200,
          body: envelope({ items: [review], nextCursor: null, hasMore: false }),
        };
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      return undefined;
    });

    renderReviewInbox();

    expect(await screen.findByText('待评审收件箱')).toBeInTheDocument();
    expect(screen.getByText('review-1')).toBeInTheDocument();
    const listCall = mock.mock.calls.find(
      ([url]) => pathOf(String(url)) === '/api/v1/projects/p1/review-requests',
    );
    expect(String(listCall?.[0])).toContain('assignedToMe=true');
    expect(String(listCall?.[0])).toContain('status=OPEN');

    fireEvent.click(screen.getByRole('button', { name: '打开评审' }));
    expect(await screen.findByTestId('review-subject-digest')).toHaveTextContent('sha256-subject');
  });

  it('要求修改或驳回时，说明为空不能进入确认流程', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(review) };
      return undefined;
    });

    renderReviews();
    fireEvent.click(await screen.findByRole('button', { name: '作出决定' }));
    fireEvent.change(screen.getByLabelText('评审决定'), { target: { value: 'CHANGES_REQUESTED' } });
    expect(screen.getByText('说明（必填）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步：预览并验证密码' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('评审说明'), { target: { value: '请补充验收证据' } });
    expect(screen.getByRole('button', { name: '下一步：预览并验证密码' })).toBeEnabled();
    expect(
      mock.mock.calls.some(([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews'),
    ).toBe(false);
  });
});

const PROJECTS = [
  { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 },
  { id: 'p2', key: 'OPS', name: 'Ops', version: 1 },
];

/** 收件箱分页用例只关心 id 与排序，其余字段沿用同一份评审快照。 */
function reviewWith(id: string, overrides: Record<string, unknown> = {}) {
  return { ...review, id, ...overrides };
}

function inboxPage(items: unknown[], nextCursor: string | null, hasMore?: boolean) {
  return hasMore === undefined ? { items, nextCursor } : { items, nextCursor, hasMore };
}

describe('Reviews（收件箱分页）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('加载更多追加下一页并按 id 去重，最后一页显示已加载全部，第二次请求带 cursor', async () => {
    const listCalls: string[] = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope(PROJECTS) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET') {
        listCalls.push(String(url));
        if (listCalls.length === 1)
          return {
            status: 200,
            body: envelope(
              inboxPage([reviewWith('review-a'), reviewWith('review-b')], 'cursor-2', true),
            ),
          };
        // 服务端分页边界处重复返回 review-b，页面必须按 id 去重。
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-b'), reviewWith('review-c')], null, false)),
        };
      }
      return undefined;
    });

    renderReviewInbox();

    expect(await screen.findByText('review-a')).toBeInTheDocument();
    expect(screen.getByText('review-b')).toBeInTheDocument();
    expect(screen.getByText('已显示 2 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加载更多' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByText('已显示 3 条')).toBeInTheDocument();
    expect(screen.getByText('review-c')).toBeInTheDocument();
    expect(screen.getAllByText('review-b')).toHaveLength(1);
    expect(screen.getByText('已加载全部')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();

    expect(listCalls).toHaveLength(2);
    expect(listCalls[0]).not.toContain('cursor=');
    expect(listCalls[1]).toContain('cursor=cursor-2');
    expect(pathOf(listCalls[1] ?? '')).toBe('/api/v1/projects/p1/review-requests');
  });

  it('加载更多失败时保留已有列表并展示可读错误，重试成功后继续追加', async () => {
    const listCalls: string[] = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope(PROJECTS) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET') {
        listCalls.push(String(url));
        if (listCalls.length === 1)
          return {
            status: 200,
            body: envelope(inboxPage([reviewWith('review-a')], 'cursor-2', true)),
          };
        if (listCalls.length === 2)
          return {
            status: 500,
            body: {
              error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用', requestId: 'req-500' },
            },
          };
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-b')], null, false)),
        };
      }
      return undefined;
    });

    renderReviewInbox();
    expect(await screen.findByText('review-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[INTERNAL_ERROR] 服务暂时不可用 · requestId req-500',
    );
    // 失败不清空列表，也不丢游标：已显示的列表仍在，便于原地重试。
    expect(screen.getByText('review-a')).toBeInTheDocument();
    expect(screen.getByText('已显示 1 条')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByText('review-b')).toBeInTheDocument();
    expect(screen.getByText('已显示 2 条')).toBeInTheDocument();
    expect(screen.getByText('已加载全部')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(listCalls[2]).toContain('cursor=cursor-2');
  });

  it('第一页就没有下一页时显示已加载全部，不渲染加载更多', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope(PROJECTS) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET')
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-a')], null, false)),
        };
      return undefined;
    });

    renderReviewInbox();

    expect(await screen.findByText('review-a')).toBeInTheDocument();
    expect(screen.getByText('已显示 1 条')).toBeInTheDocument();
    expect(screen.getByText('已加载全部')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument();
  });

  it('刷新按钮从第一页重新加载并重置游标与列表', async () => {
    const listCalls: string[] = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope(PROJECTS) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET') {
        listCalls.push(String(url));
        if (String(url).includes('cursor=cursor-2'))
          return {
            status: 200,
            body: envelope(inboxPage([reviewWith('review-b')], null, false)),
          };
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-a')], 'cursor-2', true)),
        };
      }
      return undefined;
    });

    renderReviewInbox();
    expect(await screen.findByText('review-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('review-b')).toBeInTheDocument();
    expect(screen.getByText('已显示 2 条')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));

    expect(await screen.findByText('已显示 1 条')).toBeInTheDocument();
    expect(screen.getByText('review-a')).toBeInTheDocument();
    expect(screen.queryByText('review-b')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加载更多' })).toBeEnabled();
    const lastCall = listCalls[listCalls.length - 1];
    expect(lastCall).not.toContain('cursor=');
  });

  it('切换项目重置游标与列表，并重新从第一页加载', async () => {
    const listCalls: string[] = [];
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope(PROJECTS) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET') {
        listCalls.push(String(url));
        if (String(url).includes('cursor=cursor-2'))
          return {
            status: 200,
            body: envelope(inboxPage([reviewWith('review-b')], null, false)),
          };
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-a')], 'cursor-2', true)),
        };
      }
      if (path === '/api/v1/projects/p2/review-requests' && method === 'GET') {
        listCalls.push(String(url));
        return {
          status: 200,
          body: envelope(inboxPage([reviewWith('review-z')], null, false)),
        };
      }
      return undefined;
    });

    renderReviewInbox();
    expect(await screen.findByText('review-a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    expect(await screen.findByText('review-b')).toBeInTheDocument();
    expect(screen.getByText('已显示 2 条')).toBeInTheDocument();

    const select = await screen.findByLabelText('选择项目');
    await waitFor(() => expect(select).toBeEnabled());
    fireEvent.change(select, { target: { value: 'p2' } });

    expect(await screen.findByText('review-z')).toBeInTheDocument();
    expect(screen.queryByText('review-a')).not.toBeInTheDocument();
    expect(screen.queryByText('review-b')).not.toBeInTheDocument();
    expect(screen.getByText('已显示 1 条')).toBeInTheDocument();
    expect(screen.getByText('已加载全部')).toBeInTheDocument();

    const p2Call = listCalls.find((url) => url.includes('/projects/p2/review-requests'));
    expect(p2Call).toBeDefined();
    expect(p2Call).not.toContain('cursor=');

    // 切回 p1 也必须从第一页重新开始，不能复用切换前的游标。
    fireEvent.change(select, { target: { value: 'p1' } });
    expect(await screen.findByText('review-a')).toBeInTheDocument();
    expect(screen.queryByText('review-b')).not.toBeInTheDocument();
    expect(screen.getByText('已显示 1 条')).toBeInTheDocument();
    const p1Calls = listCalls.filter((url) => url.includes('/projects/p1/review-requests'));
    expect(p1Calls[p1Calls.length - 1]).not.toContain('cursor=');
  });
});

describe('Reviews（决定确认摘要）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('确认前展示业务摘要，并反映用户最新修改的决定与说明', async () => {
    const summaryReview = {
      ...review,
      kind: 'TASK_ACCEPTANCE',
      requirement: { id: 'req-1', code: 'DEMO-REQ-1', title: '登录页改版' },
      role: { id: 'role-1', key: 'product', title: '产品角色' },
    };

    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/review-requests/review-1' && method === 'GET')
        return { status: 200, body: envelope(summaryReview) };
      if (path === '/api/v1/auth/action-previews') return previewReply(init);
      return undefined;
    });

    renderReviews();
    expect(await screen.findByTestId('review-subject-digest')).toHaveTextContent('sha256-subject');
    fireEvent.click(screen.getByRole('button', { name: '作出决定' }));
    // 先在表单里改决定与说明，确认页必须反映改后的最新值。
    fireEvent.change(screen.getByLabelText('评审决定'), {
      target: { value: 'CHANGES_REQUESTED' },
    });
    fireEvent.change(screen.getByLabelText('评审说明'), { target: { value: '请补充验收证据' } });
    fireEvent.click(screen.getByRole('button', { name: '下一步：预览并验证密码' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('即将提交的决定')).toBeInTheDocument();
    expect(within(dialog).getByText('DEMO-REQ-1 · 登录页改版')).toBeInTheDocument();
    expect(within(dialog).getByText('任务验收')).toBeInTheDocument();
    expect(within(dialog).getByText('owner · 产品角色')).toBeInTheDocument();
    expect(within(dialog).getByText('v4（与提交版本一致）')).toBeInTheDocument();
    expect(within(dialog).getByText('证据详情')).toBeInTheDocument();
    expect(within(dialog).getByText(/请在评审决定页核对完整证据/)).toBeInTheDocument();
    expect(within(dialog).getByText('请补充验收证据')).toBeInTheDocument();
    expect(within(dialog).getAllByText('要求修改').length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/评审退回交付方修改/)).toBeInTheDocument();

    const previewCall = mock.mock.calls.find(
      ([url]) => pathOf(String(url)) === '/api/v1/auth/action-previews',
    );
    const previewBinding = bodyOf(previewCall?.[1] ?? {});
    // 摘要里的版本/对象/说明必须与真正提交的绑定一致。
    expect(previewBinding).toMatchObject({
      action: 'REVIEW_DECIDE',
      targetId: 'review-1',
      expectedVersion: 4,
      payload: { slotId: 'slot-1', decision: 'CHANGES_REQUESTED', comment: '请补充验收证据' },
    });
  });
});
