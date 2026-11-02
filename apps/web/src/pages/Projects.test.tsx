import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Projects } from './Projects';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf } from '../test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', description: null, version: 3 };

function renderProjects() {
  return render(
    <MemoryRouter>
      <Projects />
    </MemoryRouter>,
  );
}

describe('Projects（项目列表 / 创建 / 归档）', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken('csrf-1');
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('创建项目只提交 name/key/description，归档走 DELETE，不发送仓库地址', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/projects' && method === 'POST')
        return { status: 201, body: envelope({ ...project, id: 'p2', key: 'NEW', name: 'New project' }) };
      if (path === '/api/v1/projects/p1' && method === 'DELETE')
        return { status: 200, body: envelope({ ...project, archivedAt: '2026-11-01T00:00:00.000Z' }) };
      return undefined;
    });

    renderProjects();
    expect(await screen.findByText('Demo')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'New project' } });
    fireEvent.change(screen.getByLabelText('项目 Key'), { target: { value: 'NEW' } });
    fireEvent.click(screen.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      const call = mock.mock.calls.find(
        ([url, init]) => pathOf(String(url)) === '/api/v1/projects' && methodOf(init ?? {}) === 'POST',
      );
      expect(call).toBeTruthy();
    });
    const createCall = mock.mock.calls.find(
      ([url, init]) => pathOf(String(url)) === '/api/v1/projects' && methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(createCall?.[1] ?? {});
    expect(body).toEqual({ name: 'New project', key: 'NEW' });
    expect(body).not.toHaveProperty('repositoryUrl');
    expect(headersOf(createCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');

    fireEvent.click(await screen.findByRole('button', { name: '归档' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '归档' }));

    await waitFor(() => {
      const call = mock.mock.calls.find(
        ([url, init]) => pathOf(String(url)) === '/api/v1/projects/p1' && methodOf(init ?? {}) === 'DELETE',
      );
      expect(call).toBeTruthy();
    });
    expect(headersOf(mock.mock.calls.find(([url, init]) => pathOf(String(url)) === '/api/v1/projects/p1' && methodOf(init ?? {}) === 'DELETE')?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
  });

  it('列表被服务端 403 拒绝时原样展示错误 envelope', async () => {
    mockFetch((url, init) => {
      if (pathOf(url) === '/api/v1/projects' && methodOf(init ?? {}) === 'GET')
        return {
          status: 403,
          body: { error: { code: 'FORBIDDEN', message: '无权访问项目', requestId: 'req-403' } },
        };
      return undefined;
    });

    renderProjects();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[FORBIDDEN] 无权访问项目 · requestId req-403',
    );
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();
  });
});
