import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

  it('无项目时从看板创建项目并导航到 /projects', async () => {
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects' && methodOf(init) === 'GET')
        return { status: 200, body: envelope([]) };
      return undefined;
    });
    render(
      <MemoryRouter initialEntries={['/board']}>
        <Routes>
          <Route path="/board" element={<Board />} />
          <Route path="/projects" element={<div>项目列表页</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: '创建项目' }));
    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
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

    expect((await screen.findAllByText('未开始')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('进行中').length).toBeGreaterThan(0);
    // 看板不提供依赖/评审信息：OPEN 任务只能显示「状态待确认」，不能写成「待认领」。
    expect(screen.getAllByText('状态待确认').length).toBeGreaterThan(0);
    expect(screen.queryByText('待认领')).not.toBeInTheDocument();
    expect(screen.getByText(/看板不包含流程依赖与评审状态/)).toBeInTheDocument();
    expect(screen.getByText('task-ope')).toBeInTheDocument();
    expect(screen.getByText('task-cla')).toBeInTheDocument();
    expect(screen.getByText(/认领与交付由本地 Agent 通过 CLI 完成/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '认领' })).not.toBeInTheDocument();
  });

  it('窄屏提供列切换页签，选中列标记为当前列', async () => {
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

    const tabs = await screen.findAllByRole('tab', {
      name: /未开始|进行中|阻塞|暂停|已交付|已取消/,
    });
    expect(tabs.length).toBe(2);
    const targetTab = tabs.find((tab) => tab.textContent?.includes('进行中'))!;
    expect(targetTab).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(targetTab);
    expect(targetTab).toHaveAttribute('aria-selected', 'true');
    // 只有当前列在窄屏显示（类名由状态决定，CSS 只在 ≤720px 生效）。
    const activeColumns = document.querySelectorAll('.board-col.is-mobile-active');
    expect(activeColumns).toHaveLength(1);
    expect(activeColumns[0]?.textContent).toContain('进行中');
  });
});
