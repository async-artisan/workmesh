import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbench } from './Workbench';
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

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

const snapshot = {
  counts: { reviews: 1, changes: 1, readyTasks: 1, total: 3 },
  reviews: [
    {
      reviewId: 'review-1',
      kind: 'PRD_PUBLICATION',
      status: 'OPEN',
      version: 3,
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-1', title: '登录页改版' },
      subjectLabel: 'PRD v3',
      role: { id: 'role-product', key: 'product', title: '产品' },
      slots: [
        {
          id: 'slot-1',
          slotKey: 'product',
          requiredUserId: 'user-1',
          requiredRoleId: 'role-product',
          decided: false,
          viewerCanDecide: true,
        },
      ],
      ageSeconds: 259200,
      evidence: { artifactCount: 2, hasPr: true },
    },
  ],
  changes: [
    {
      recipientId: 'c1',
      eventId: 'evt-1',
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-2', title: '订单取消规则' },
      changedFields: ['acceptance'],
      targets: {},
      pendingRoles: [{ key: 'backend', title: '后端' }],
      version: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      ageSeconds: 172800,
    },
  ],
  readyTasks: [
    {
      taskId: 'task-1',
      projectId: 'p1',
      projectKey: 'DEMO',
      projectName: 'Demo',
      requirement: { code: 'DEMO-REQ-3', title: '支付回调重试' },
      role: { key: 'backend', title: '后端' },
      stepKey: 'backend-impl',
      executionStatus: 'OPEN',
      workStatus: 'ACTIVE',
      ageSeconds: null,
    },
  ],
  warnings: [],
};

function handler(overrides: { ackStatus?: number } = {}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/workbench' && method === 'GET')
      return { status: 200, body: envelope(snapshot) };
    if (path === '/api/v1/change-recipients/c1/ack' && method === 'POST') {
      if (overrides.ackStatus === 409)
        return {
          status: 409,
          body: {
            error: {
              code: 'VERSION_CONFLICT',
              message: '收件人版本已变化',
              details: { currentVersion: 3 },
              requestId: 'req-409',
            },
          },
        };
      return { status: 200, body: envelope({ acked: true }) };
    }
    return undefined;
  };
}

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <Workbench />
    </MemoryRouter>,
  );
}

describe('Workbench（跨项目待办聚合）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('展示四类待办与人类可读标识，不出现裸 UUID', async () => {
    mockFetch(handler());
    renderWorkbench();

    expect(await screen.findByText(/登录页改版/)).toBeInTheDocument();
    expect(screen.getByText(/订单取消规则/)).toBeInTheDocument();
    expect(screen.getByText(/支付回调重试/)).toBeInTheDocument();
    expect(screen.getByText(/DEMO-REQ-1/)).toBeInTheDocument();
    expect(screen.getByText(/证据 2 件 · 含 PR/)).toBeInTheDocument();
    expect(screen.queryByText('review-1')).not.toBeInTheDocument();
    expect(screen.queryByText('evt-1')).not.toBeInTheDocument();
  });

  it('记住角色筛选，下次打开继续生效', async () => {
    mockFetch(handler());
    renderWorkbench();

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const select = await screen.findByLabelText('角色筛选');
      fireEvent.change(select, { target: { value: 'backend' } });

      expect(setItem).toHaveBeenCalledWith('workmesh.workbench.role', 'backend');
    } finally {
      setItem.mockRestore();
    }
  });

  it('确认变更提交收件人版本；旧版本 409 原样展示', async () => {
    const mock = mockFetch(handler({ ackStatus: 409 }));
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: '去确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认已处理' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[VERSION_CONFLICT] 收件人版本已变化 · requestId req-409',
    );
    expect(screen.queryByText('变更已确认。')).not.toBeInTheDocument();

    const ackCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/change-recipients/c1/ack' &&
        methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(ackCall?.[1] ?? {})).toEqual({ expectedVersion: 2 });
    expect(headersOf(ackCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });

  it('确认成功时提示并刷新', async () => {
    mockFetch(handler());
    renderWorkbench();

    fireEvent.click(await screen.findByRole('button', { name: '去确认' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认已处理' }));

    expect(await screen.findByText('变更已确认。')).toBeInTheDocument();
  });
});
