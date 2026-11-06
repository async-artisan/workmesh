import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectDetail } from './ProjectDetail';
import { setCsrfToken } from '../api/client';
import { envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const project = {
  id: 'p1',
  key: 'DEMO',
  name: 'Demo 项目',
  description: '演示项目',
  version: 3,
};

const member = {
  id: 'u-1',
  email: 'alice@example.com',
  name: 'Alice',
  role: 'OWNER',
  version: 2,
  roles: [{ id: 'r-1', title: '产品' }],
};

const definition = {
  workflowKey: 'standard',
  title: '标准交付流程',
  version: 2,
  currentRevision: 2,
  currentPublishedRevisionId: 'rev-1',
};

function renderDetail(projectId = 'p1') {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
        <Route path="/workspace" element={<div>接入与工作区</div>} />
        <Route path="/projects" element={<div>项目列表页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function handler(options: { repositories?: unknown[] } = {}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init ?? {});
    if (path === '/api/v1/projects' && method === 'GET')
      return { status: 200, body: envelope([project]) };
    if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
      return { status: 200, body: envelope(options.repositories ?? []) };
    if (path === '/api/v1/projects/p1/repositories' && method === 'POST')
      return {
        status: 201,
        body: envelope({
          id: 'repo-1',
          adapter: 'github',
          externalId: 'yesgoo/yifanfan',
          owner: 'yesgoo',
          name: 'yifanfan',
          defaultBranch: 'main',
          createdAt: '2026-11-05T00:00:00.000Z',
        }),
      };
    if (path === '/api/v1/projects/p1/members' && method === 'GET')
      return { status: 200, body: envelope([member]) };
    if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
      return { status: 200, body: envelope({ items: [definition], nextCursor: null }) };
    return undefined;
  };
}

describe('ProjectDetail（项目详情）', () => {
  beforeEach(() => {
    setCsrfToken('csrf-1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('展示项目信息、流程与成员，并引导到工作区登记仓库', async () => {
    mockFetch(handler());
    renderDetail();

    expect(await screen.findByRole('heading', { name: 'Demo 项目' })).toBeInTheDocument();
    expect(screen.getByText('演示项目', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('标准交付流程')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '成员' }));
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('产品')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '代码仓库' }));
    expect(await screen.findByText('还没有登记代码仓库')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '登记仓库' })[0]!);
    expect(await screen.findByText('接入与工作区')).toBeInTheDocument();
  });

  it('仓库为空时给出登记引导，登记按钮可用', async () => {
    mockFetch(handler());
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Demo 项目' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '代码仓库' }));
    expect(await screen.findByText('还没有登记代码仓库')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '登记仓库' }).length).toBeGreaterThan(0);
  });

  it('项目不存在时显示可重试的错误态', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/members' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/workflow-definitions' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });
    renderDetail();
    expect(await screen.findByText('项目不存在，或你没有访问权限。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载项目' })).toBeInTheDocument();
  });

  it('从项目详情返回项目列表', async () => {
    mockFetch(handler());
    renderDetail();
    expect(await screen.findByRole('heading', { name: 'Demo 项目' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回项目' }));
    await waitFor(() => expect(screen.getByText('项目列表页')).toBeInTheDocument());
  });
});
