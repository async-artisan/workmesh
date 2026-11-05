import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DelegationsPanel } from './DelegationsPanel';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';
import { useAuthStore } from '../store/auth';
import type { ApprovalSlotDelegationView } from '../api/resources';

const members = [
  { id: 'owner-1', email: 'owner@example.com', name: 'Owner', role: 'OWNER', version: 1 },
  { id: 'be-1', email: 'be@example.com', name: 'Backend', role: 'MEMBER', version: 1 },
];

const review = {
  id: 'review-1',
  projectId: 'p1',
  kind: 'TASK_ARTIFACT_SET',
  status: 'OPEN',
  version: 2,
  subjectDigest: 'd'.repeat(64),
  documentRevisionId: null,
  artifactSetId: 'artifact-1',
  taskId: 'task-1',
  slots: [
    {
      id: 'slot-1',
      slotKey: 'product',
      requiredRoleId: null,
      requiredUserId: 'be-1',
      sourceSlotBindingId: null,
      viewerCanDecide: true,
    },
  ],
  decisions: [],
  subject: null,
  requirement: { id: 'req-1', code: 'DEMO-1', title: '登录页改版' },
  subjectLabel: null,
  role: null,
};

function renderPanel() {
  return render(
    <MemoryRouter>
      <DelegationsPanel projectId="p1" />
    </MemoryRouter>,
  );
}

describe('DelegationsPanel（委托 / 超时）', () => {
  let delegations: ApprovalSlotDelegationView[];
  let overdue: Array<{
    id: string;
    slotKey: string;
    kind: string;
    reviewRequestId: string;
    requiredUserId: string;
    requiredRoleId: string | null;
    dueAt: string;
  }>;

  beforeEach(() => {
    setCsrfToken('csrf-1');
    useAuthStore.setState({
      user: { id: 'owner-1', email: 'owner@example.com' },
      status: 'authenticated',
    });
    delegations = [];
    overdue = [];
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.setState({ user: null, status: 'loading' });
  });

  function handler() {
    return (url: string, init: RequestInit) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects/p1/delegations' && method === 'GET')
        return { status: 200, body: envelope(delegations) };
      if (path === '/api/v1/projects/p1/delegations' && method === 'POST') {
        const body = bodyOf(init ?? {}) as {
          slotId: string;
          delegateUserId: string;
          expiresAt: string;
        };
        const created: ApprovalSlotDelegationView = {
          id: 'delegation-1',
          projectId: 'p1',
          slotId: body.slotId,
          delegatorUserId: 'be-1',
          delegateUserId: body.delegateUserId,
          expiresAt: body.expiresAt,
          revokedAt: null,
          createdAt: new Date().toISOString(),
        };
        delegations = [created];
        return { status: 201, body: envelope(created) };
      }
      if (path === '/api/v1/projects/p1/delegations/delegation-1' && method === 'DELETE') {
        delegations = delegations.map((item) => ({
          ...item,
          revokedAt: new Date().toISOString(),
        }));
        return { status: 200, body: envelope({ revoked: true }) };
      }
      if (path === '/api/v1/projects/p1/approvals/overdue' && method === 'GET')
        return { status: 200, body: envelope(overdue) };
      if (path === '/api/v1/projects/p1/approvals/escalate' && method === 'POST') {
        const count = overdue.length;
        overdue = [];
        return { status: 200, body: envelope({ escalated: count }) };
      }
      if (path === '/api/v1/projects/p1/members' && method === 'GET')
        return { status: 200, body: envelope(members) };
      if (path === '/api/v1/projects/p1/review-requests' && method === 'GET')
        return { status: 200, body: envelope({ items: [review], nextCursor: null }) };
      return undefined;
    };
  }

  it('OWNER 可创建、撤销委托，并标记逾期升级', async () => {
    overdue = [
      {
        id: 'slot-overdue',
        slotKey: 'task-acceptance',
        kind: 'TASK_ACCEPTANCE',
        reviewRequestId: 'review-9',
        requiredUserId: 'be-1',
        requiredRoleId: null,
        dueAt: '2026-11-01T00:00:00.000Z',
      },
    ];
    const mock = mockFetch(handler());
    renderPanel();

    // 创建委托：选择槽位与被委托人
    const slotSelect = await screen.findByLabelText('委托槽位');
    await waitFor(() => expect(within(slotSelect).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(slotSelect, { target: { value: 'slot-1' } });
    fireEvent.change(screen.getByLabelText('被委托人'), { target: { value: 'be-1' } });
    fireEvent.click(screen.getByRole('button', { name: '创建委托' }));

    expect(await screen.findByText('生效中')).toBeInTheDocument();
    expect(screen.getAllByText(/DEMO-1 · 登录页改版/).length).toBeGreaterThan(0);
    const createCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/projects/p1/delegations' &&
        methodOf(init ?? {}) === 'POST',
    );
    const createBody = bodyOf(createCall?.[1] ?? {}) as {
      slotId: string;
      delegateUserId: string;
      expiresAt: string;
    };
    expect(createBody.slotId).toBe('slot-1');
    expect(createBody.delegateUserId).toBe('be-1');
    expect(new Date(createBody.expiresAt).getTime()).toBeGreaterThan(Date.now());

    // 撤销委托
    fireEvent.click(screen.getByRole('button', { name: '撤销委托' }));
    expect(await screen.findByText('已撤销')).toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url, init]) =>
          pathOf(String(url)) === '/api/v1/projects/p1/delegations/delegation-1' &&
          methodOf(init ?? {}) === 'DELETE',
      ),
    ).toBe(true);

    // 升级逾期槽位
    expect(screen.getByRole('heading', { name: /超时未决定/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '标记全部升级' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.some(
          ([url, init]) =>
            pathOf(String(url)) === '/api/v1/projects/p1/approvals/escalate' &&
            methodOf(init ?? {}) === 'POST',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('没有逾期审批')).toBeInTheDocument();
  });

  it('普通成员只读：不出现创建/撤销/升级按钮', async () => {
    useAuthStore.setState({
      user: { id: 'be-1', email: 'be@example.com' },
      status: 'authenticated',
    });
    mockFetch(handler());
    renderPanel();

    expect(
      await screen.findByText('只读：仅 OWNER/ADMIN 可建立或撤销委托'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建委托' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '标记全部升级' })).not.toBeInTheDocument();
  });

  it('委托将在 24 小时内到期时给出提醒与「即将到期」状态', async () => {
    delegations = [
      {
        id: 'delegation-soon',
        projectId: 'p1',
        slotId: 'slot-1',
        delegatorUserId: 'be-1',
        delegateUserId: 'owner-1',
        expiresAt: new Date(Date.now() + 2 * 3_600_000).toISOString(),
        revokedAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    mockFetch(handler());
    renderPanel();

    expect(await screen.findByText(/将在 24 小时内到期/)).toBeInTheDocument();
    expect(screen.getByText(/即将到期（2 小时）/)).toBeInTheDocument();
  });
});
