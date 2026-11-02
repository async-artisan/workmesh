import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Board } from './Board';
import { setCsrfToken } from '../api/client';
import { envelope, methodOf, mockFetch, pathOf, useProject } from '../test-utils';

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

describe('Board（只读看板）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
    useProject('p1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('按服务端派生列展示任务，不提供认领入口', async () => {
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
    expect(screen.getByText(/认领与交付由本地 Agent 通过 CLI 完成/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();
  });
});
