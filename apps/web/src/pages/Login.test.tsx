import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Login } from './Login';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, headersOf, methodOf, mockFetch, pathOf } from '../test-utils';

describe('Login（cookie WebSession + CSRF，不落本地 token）', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken(null);
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('先做匿名会话引导取得 CSRF，再以 cookie 登录并在内存保存会话', async () => {
    let sessions = 0;
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1) {
          return {
            status: 200,
            body: envelope({
              authenticated: false,
              sessionId: 'anon-session',
              expiresAt: '2026-12-01T00:00:00.000Z',
              idleExpiresAt: '2026-11-02T00:00:00.000Z',
              csrfToken: 'csrf-anon',
            }),
          };
        }
        return {
          status: 200,
          body: envelope({
            authenticated: true,
            sessionId: 'session-1',
            expiresAt: '2026-12-01T00:00:00.000Z',
            idleExpiresAt: '2026-11-02T00:00:00.000Z',
            csrfToken: 'csrf-login',
            user: { id: 'user-1', email: 'user@example.com' },
          }),
        };
      }
      if (path === '/api/v1/auth/login' && method === 'POST')
        return { status: 200, body: envelope({ authenticated: true }) };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>工作台首页</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('工作台首页')).toBeInTheDocument();

    const loginCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/login' && methodOf(init ?? {}) === 'POST',
    );
    expect(loginCall?.[1]?.credentials).toBe('include');
    expect(headersOf(loginCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-anon');
    expect(bodyOf(loginCall?.[1] ?? {})).toEqual({
      email: 'user@example.com',
      password: 'secret-pass',
    });
    expect(Object.keys(localStorage).some((key) => /token|session|csrf/i.test(key))).toBe(false);
  });

  it('登录失败显示可读中文，技术详情默认折叠可展开', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init ?? {});
      if (path === '/api/v1/auth/session' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            authenticated: false,
            sessionId: 'anon-session',
            expiresAt: '2026-12-01T00:00:00.000Z',
            idleExpiresAt: '2026-11-02T00:00:00.000Z',
            csrfToken: 'csrf-anon',
          }),
        };
      if (path === '/api/v1/auth/login' && method === 'POST')
        return {
          status: 401,
          body: {
            error: {
              code: 'AUTH_INVALID',
              message: '邮箱或密码不正确',
              requestId: 'req-login-401',
            },
          },
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('邮箱或密码不正确，请重新输入。')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    if (!details) throw new Error('登录错误应包含技术详情折叠区');
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('AUTH_INVALID');
    expect(details).toHaveTextContent('requestId req-login-401');
    expect(details).not.toHaveTextContent('wrong-pass');
    expect(alert).not.toHaveTextContent('wrong-pass');
    fireEvent.click(within(details).getByText('查看详细信息'));
    expect(details.open).toBe(true);
  });

  it('邀请上下文提示与密码重置说明真实，不伪造重置链接', () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/invite/tok-1' } }]}>
        <Login />
      </MemoryRouter>,
    );

    expect(screen.getByText(/登录成功后会回到原邀请页面，继续接受邀请/)).toBeInTheDocument();
    expect(screen.getByText(/当前版本未提供自助密码找回/)).toBeInTheDocument();
    expect(screen.getByText(/项目管理员身份本身不包含重置平台账号密码的能力/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /忘记密码/ })).not.toBeInTheDocument();
  });
});
