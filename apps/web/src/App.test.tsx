import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { getCsrfToken, setCsrfToken } from './api/client';
import { useAuthStore } from './store/auth';
import { envelope, headersOf, methodOf, mockFetch, pathOf } from './test-utils';

const project = { id: 'p1', key: 'DEMO', name: 'Demo', version: 1 };

const authenticatedSession = {
  authenticated: true,
  sessionId: 'session-1',
  expiresAt: '2026-12-01T00:00:00.000Z',
  idleExpiresAt: '2026-11-02T00:00:00.000Z',
  csrfToken: 'csrf-1',
  user: { id: 'user-1', email: 'user@example.com' },
};

describe('App（cookie WebSession 引导）', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken(null);
    // 模拟真实启动态：会话尚未建立，等待 /auth/session 结果，而不是直接判定匿名。
    useAuthStore.setState({ user: null, status: 'loading' });
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('用 /auth/session 建立会话，导航不依赖本地 token，登出走 cookie + CSRF', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/change-recipients' && method === 'GET')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      if (path === '/api/v1/auth/logout' && method === 'POST')
        return { status: 200, body: envelope({ loggedOut: true }) };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(screen.getByText('WorkMesh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /账号菜单：user@example.com/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '评审' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '设备授权' }).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText('API 已连接')).toBeInTheDocument());

    const sessionCall = mock.mock.calls.find(
      ([url]) => pathOf(String(url)) === '/api/v1/auth/session',
    );
    expect(sessionCall?.[1]?.credentials).toBe('include');
    expect(getCsrfToken()).toBe('csrf-1');

    const storageKeys = Object.keys(localStorage);
    expect(storageKeys.some((key) => /token|session/i.test(key))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /账号菜单：user@example.com/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: '登录工作台' })).toBeInTheDocument(),
    );

    const logoutCall = mock.mock.calls.find(
      ([url]) => pathOf(String(url)) === '/api/v1/auth/logout',
    );
    expect(methodOf(logoutCall?.[1] ?? {})).toBe('POST');
    expect(headersOf(logoutCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
    expect(getCsrfToken()).toBe('');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('匿名会话跳转登录页，不把 CSRF 或会话写入本地存储', async () => {
    mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
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
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(Object.keys(localStorage).some((key) => /token|session|csrf/i.test(key))).toBe(false);
  });
});
