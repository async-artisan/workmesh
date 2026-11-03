import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Invite } from './Invite';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const view = {
  id: 'inv-1',
  status: 'PENDING',
  project: { id: 'p1', key: 'YFF', name: '易番番 ERP' },
  roles: [{ id: 'r-backend', key: 'backend', title: '后端' }],
  email: null,
  expiresAt: '2026-11-06T00:00:00.000Z',
  createdAt: '2026-11-03T00:00:00.000Z',
};

function handler(overrides: { view?: unknown; accept?: { status: number; body: unknown } } = {}) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/session' && method === 'GET')
      return {
        status: 200,
        body: envelope({
          authenticated: false,
          sessionId: 's-1',
          expiresAt: '2026-11-03T01:00:00.000Z',
          idleExpiresAt: '2026-11-03T00:30:00.000Z',
          csrfToken: 'csrf-1',
          user: null,
        }),
      };
    if (path === '/api/v1/invitations/tok-1' && method === 'GET')
      return { status: 200, body: envelope(overrides.view ?? view) };
    if (path === '/api/v1/invitations/tok-1/accept' && method === 'POST')
      return (
        overrides.accept ?? {
          status: 201,
          body: envelope({
            user: { id: 'u-9', email: 'new@workmesh.local' },
            invitation: { projectId: 'p1', roleKeys: ['backend'] },
          }),
        }
      );
    return undefined;
  };
}

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={['/invite/tok-1']}>
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/" element={<div>工作台首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Invite（邀请接受页）', () => {
  beforeEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
  });

  afterEach(() => {
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it('展示项目与角色，填邮箱密码后接受并跳转工作台', async () => {
    const mock = mockFetch(handler());

    renderInvite();

    expect(await screen.findByText(/加入「易番番 ERP」/)).toBeInTheDocument();
    expect(screen.getByText(/后端/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@workmesh.local' } });
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'Passw0rd!' } });
    fireEvent.change(screen.getByLabelText('姓名'), { target: { value: '新同学' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并加入' }));

    expect(await screen.findByText(/已加入「易番番 ERP」/)).toBeInTheDocument();
    const setup = screen.getByLabelText('CLI 初始化命令') as HTMLInputElement;
    expect(setup.value).toContain('workmesh setup --role backend');
    expect(setup.value).toContain('--project p1');

    const call = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/invitations/tok-1/accept' &&
        methodOf(init ?? {}) === 'POST',
    );
    const body = bodyOf(call?.[1] ?? {});
    expect(body).toMatchObject({
      email: 'new@workmesh.local',
      password: 'Passw0rd!',
      name: '新同学',
    });

    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    expect(await screen.findByText('工作台首页')).toBeInTheDocument();
  });

  it('邮箱已注册时提示先登录再接受', async () => {
    mockFetch(
      handler({
        accept: {
          status: 409,
          body: {
            error: {
              code: 'EMAIL_ALREADY_REGISTERED',
              message: '邮箱已注册',
              requestId: 'req-1',
            },
          },
        },
      }),
    );

    renderInvite();

    expect(await screen.findByText(/加入「易番番 ERP」/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'old@workmesh.local' } });
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'Passw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并加入' }));

    await waitFor(() => expect(screen.getByText(/这个邮箱已经有账号/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '先登录再接受' })).toBeInTheDocument();
  });

  it('已接受的邀请直接提示，不再显示表单', async () => {
    mockFetch(handler({ view: { ...view, status: 'ACCEPTED' } }));

    renderInvite();

    expect(await screen.findByText(/已经被接受过了/)).toBeInTheDocument();
    expect(screen.queryByLabelText('设置密码')).not.toBeInTheDocument();
  });
});
