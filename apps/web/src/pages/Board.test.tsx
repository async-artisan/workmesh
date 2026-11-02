import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from './Board';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

const snapshot = {
  projectId: 'p1',
  columns: [
    {
      key: 'BACKLOG',
      cards: [
        {
          taskId: 'task-open',
          projectId: 'p1',
          stepKey: 'implement',
          roleId: 'role-backend',
          executionStatus: 'OPEN',
          workStatus: null,
          currentClaimId: null,
          currentArtifactSetId: null,
          claimedUserId: null,
          claimedAt: null,
          generation: 0,
        },
      ],
    },
    {
      key: 'ACTIVE',
      cards: [
        {
          taskId: 'task-claimed',
          projectId: 'p1',
          stepKey: 'verify',
          roleId: 'role-qa',
          executionStatus: 'CLAIMED',
          workStatus: 'ACTIVE',
          currentClaimId: 'claim-1',
          currentArtifactSetId: null,
          claimedUserId: 'user-1',
          claimedAt: '2026-11-01T00:00:00.000Z',
          generation: 1,
        },
      ],
    },
  ],
};

describe('Board（任务认领由服务端判定）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('按服务端派生列展示任务，只为未认领且 OPEN 的卡片提供认领操作', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/board' && method === 'GET')
        return { status: 200, body: envelope(snapshot) };
      return undefined;
    });

    render(
      <MemoryRouter>
        <Board />
      </MemoryRouter>,
    );

    expect(await screen.findByText('待认领')).toBeInTheDocument();
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    expect(screen.getByText('task-ope')).toBeInTheDocument();
    expect(screen.getByText('task-cla')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '认领' })).toBeInTheDocument();
  });

  it('认领被服务端 403 拒绝时展示 envelope，按钮仍可点击（权限不由按钮决定）', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects/p1/board' && method === 'GET')
        return { status: 200, body: envelope(snapshot) };
      if (path === '/api/v1/tasks/task-open/claims' && method === 'POST')
        return {
          status: 403,
          body: {
            error: {
              code: 'FORBIDDEN',
              message: '当前用户不具备该任务角色',
              requestId: 'req-403',
            },
          },
        };
      return undefined;
    });

    render(
      <MemoryRouter>
        <Board />
      </MemoryRouter>,
    );

    const claimButton = await screen.findByRole('button', { name: '认领' });
    expect(claimButton).toBeEnabled();
    fireEvent.click(claimButton);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[FORBIDDEN] 当前用户不具备该任务角色 · requestId req-403',
    );
    expect(screen.getByRole('button', { name: '认领' })).toBeEnabled();
    expect(screen.queryByText(/已认领/)).not.toBeInTheDocument();

    const claimCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/tasks/task-open/claims' && methodOf(init ?? {}) === 'POST',
    );
    expect(bodyOf(claimCall?.[1] ?? {})).toEqual({});
    expect(headersOf(claimCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });
});
