import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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

const anonymousSession = {
  authenticated: false,
  sessionId: 's-1',
  expiresAt: '2026-11-03T01:00:00.000Z',
  idleExpiresAt: '2026-11-03T00:30:00.000Z',
  csrfToken: 'csrf-1',
  user: null,
};

function handler(
  overrides: {
    view?: unknown;
    accept?: { status: number; body: unknown };
    join?: { status: number; body: unknown };
    session?: () => unknown;
  } = {},
) {
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/session' && method === 'GET')
      return {
        status: 200,
        body: envelope(overrides.session?.() ?? anonymousSession),
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
    if (path === '/api/v1/invitations/tok-1/join' && method === 'POST')
      return (
        overrides.join ?? {
          status: 200,
          body: envelope({ invitationId: 'inv-1', projectId: 'p1', roleKeys: ['backend'] }),
        }
      );
    return undefined;
  };
}

function LoginProbe() {
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (
    <div>
      <h1>登录页</h1>
      <p data-testid="login-from">{from ?? ''}</p>
    </div>
  );
}

function renderInvite() {
  return render(
    <MemoryRouter initialEntries={['/invite/tok-1']}>
      <Routes>
        <Route path="/invite/:token" element={<Invite />} />
        <Route path="/" element={<div>工作台首页</div>} />
        <Route path="/login" element={<LoginProbe />} />
        <Route path="/workspace" element={<WorkspaceProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function WorkspaceProbe() {
  const location = useLocation();
  return <p>项目接入页{location.search}</p>;
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
    expect(screen.getByText(/邀请状态：待接受/)).toBeInTheDocument();
    expect(screen.queryByText(/邀请人/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@workmesh.local' } });
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'Passw0rd!' } });
    fireEvent.change(screen.getByLabelText('姓名（可选）'), { target: { value: '新同学' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并加入' }));

    expect(await screen.findByText(/已加入「易番番 ERP」/)).toBeInTheDocument();
    expect(screen.queryByLabelText('CLI 初始化命令')).not.toBeInTheDocument();
    expect(screen.getByText(/复制 workspace init --join 预览命令/)).toBeInTheDocument();
    expect(screen.queryByText(/workmesh setup/)).not.toBeInTheDocument();

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

  it('真实 409 已注册邮箱显示专属提示、登录入口并保留邀请路径', async () => {
    mockFetch(
      handler({
        accept: {
          status: 409,
          body: {
            error: {
              code: 'RESOURCE_CONFLICT',
              message: 'EMAIL_ALREADY_REGISTERED',
              details: { email: 'old@workmesh.local' },
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

    await waitFor(() =>
      expect(screen.getByText('这个邮箱已经有账号，请先登录再接受邀请。')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: '先登录再接受' })).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    if (!details) throw new Error('邀请错误应包含技术详情折叠区');
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('RESOURCE_CONFLICT');
    expect(details).toHaveTextContent('EMAIL_ALREADY_REGISTERED');
    expect(details).not.toHaveTextContent('Passw0rd!');
    expect(alert).not.toHaveTextContent('Passw0rd!');

    fireEvent.click(screen.getByRole('button', { name: '先登录再接受' }));
    expect(screen.getByText('登录页')).toBeInTheDocument();
    expect(screen.getByTestId('login-from')).toHaveTextContent('/invite/tok-1');
  });

  it('其他 409 响应不显示先登录再接受', async () => {
    mockFetch(
      handler({
        accept: {
          status: 409,
          body: {
            error: {
              code: 'RESOURCE_CONFLICT',
              message: 'PROJECT_VERSION_CONFLICT',
              requestId: 'req-conflict',
            },
          },
        },
      }),
    );

    renderInvite();
    expect(await screen.findByText(/加入「易番番 ERP」/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'new@workmesh.local' } });
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'Passw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并加入' }));

    expect(await screen.findByText('邀请状态已发生变化，请刷新页面后重试。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '先登录再接受' })).not.toBeInTheDocument();
    expect(screen.queryByText(/这个邮箱已经有账号/)).not.toBeInTheDocument();
  });

  it('先登录后返回原邀请页并接受邀请', async () => {
    let authenticated = false;
    let loginClicks = 0;
    const authenticatedSession = {
      ...anonymousSession,
      authenticated: true,
      sessionId: 'session-old',
      csrfToken: 'csrf-old',
      user: { id: 'u-old', email: 'old@workmesh.local' },
    };
    mockFetch(
      handler({
        accept: {
          status: 409,
          body: {
            error: {
              code: 'RESOURCE_CONFLICT',
              message: 'EMAIL_ALREADY_REGISTERED',
              details: { email: 'old@workmesh.local' },
              requestId: 'req-1',
            },
          },
        },
        session: () => (authenticated ? authenticatedSession : anonymousSession),
      }),
    );

    function MockLogin() {
      const location = useLocation();
      const navigate = useNavigate();
      const from = (location.state as { from?: string } | null)?.from;
      return (
        <div>
          <h1>登录页</h1>
          <button
            type="button"
            onClick={() => {
              loginClicks += 1;
              authenticated = true;
              useAuthStore.getState().setSession({ id: 'u-old', email: 'old@workmesh.local' });
              navigate(from ?? '/invite/tok-1');
            }}
          >
            模拟登录成功
          </button>
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/invite/tok-1']}>
        <Routes>
          <Route path="/invite/:token" element={<Invite />} />
          <Route path="/" element={<div>工作台首页</div>} />
          <Route path="/login" element={<MockLogin />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/加入「易番番 ERP」/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'old@workmesh.local' } });
    fireEvent.change(screen.getByLabelText('设置密码'), { target: { value: 'Passw0rd!' } });
    fireEvent.click(screen.getByRole('button', { name: '创建账号并加入' }));
    await waitFor(() =>
      expect(screen.getByText('这个邮箱已经有账号，请先登录再接受邀请。')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: '先登录再接受' }));
    expect(screen.getByText('登录页')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '模拟登录成功' }));

    expect(await screen.findByText(/你已登录为 old@workmesh.local/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));

    expect(await screen.findByText(/已加入「易番番 ERP」/)).toBeInTheDocument();
    expect(loginClicks).toBe(1);
  });

  it('已登录用户直接加入项目', async () => {
    useAuthStore.getState().setSession({ id: 'u-old', email: 'old@workmesh.local' });
    const mock = mockFetch(
      handler({
        session: () => ({
          ...anonymousSession,
          authenticated: true,
          user: { id: 'u-old', email: 'old@workmesh.local' },
        }),
      }),
    );

    renderInvite();
    expect(await screen.findByText(/你已登录为 old@workmesh.local/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));

    expect(await screen.findByText(/已加入「易番番 ERP」/)).toBeInTheDocument();
    const joinCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/invitations/tok-1/join' && methodOf(init ?? {}) === 'POST',
    );
    expect(joinCall).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '配置本地 Agent 接入' }));
    expect(await screen.findByText('项目接入页?projectId=p1')).toBeInTheDocument();
  });

  it('过期邀请直接提示，不显示接受表单', async () => {
    mockFetch(handler({ view: { ...view, status: 'EXPIRED' } }));
    renderInvite();

    expect(await screen.findByText(/这个邀请已经过期/)).toBeInTheDocument();
    expect(screen.queryByLabelText('设置密码')).not.toBeInTheDocument();
  });

  it('已接受的邀请直接提示，不再显示表单', async () => {
    mockFetch(handler({ view: { ...view, status: 'ACCEPTED' } }));

    renderInvite();

    expect(await screen.findByText(/已经被接受过了/)).toBeInTheDocument();
    expect(screen.queryByLabelText('设置密码')).not.toBeInTheDocument();
  });
});
