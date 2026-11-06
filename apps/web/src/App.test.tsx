import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

interface StubReply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

/** 带响应头的 fetch stub；用于验证真实 Retry-After，而不是猜测等待时间。 */
function stubApi(handler: (url: string, init: RequestInit) => StubReply | undefined) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const reply = handler(url, init ?? {});
    if (!reply) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { code: 'STUB_NOT_FOUND', message: url } }),
      };
    }
    const headerEntries = Object.entries(reply.headers ?? {});
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: {
        get: (name: string) =>
          headerEntries.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null,
      },
      text: async () => JSON.stringify(reply.body),
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

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
    vi.unstubAllGlobals();
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

  it('生产邀请页把路径中的 token 传给 Invite，不请求空 token', async () => {
    const mock = mockFetch((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            authenticated: false,
            sessionId: 'invite-session',
            expiresAt: '2026-12-01T00:00:00.000Z',
            idleExpiresAt: '2026-11-02T00:00:00.000Z',
            csrfToken: 'csrf-invite',
          }),
        };
      if (path === '/api/v1/invitations/tok-1' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            id: 'inv-1',
            status: 'PENDING',
            project: { id: 'p1', key: 'DEMO', name: 'Demo' },
            roles: [{ id: 'role-1', key: 'backend', title: '后端' }],
            email: null,
            expiresAt: '2026-12-01T00:00:00.000Z',
            createdAt: '2026-11-03T00:00:00.000Z',
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/invite/tok-1']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '加入「Demo」' })).toBeInTheDocument();
    expect(
      mock.mock.calls.some(
        ([url, init]) =>
          pathOf(String(url)) === '/api/v1/invitations/tok-1' && methodOf(init ?? {}) === 'GET',
      ),
    ).toBe(true);
    expect(mock.mock.calls.some(([url]) => pathOf(String(url)) === '/api/v1/invitations/')).toBe(
      false,
    );
  });

  it('会话引导失败显示可读错误、重试和返回登录，不无限停留 loading', async () => {
    let sessions = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        return {
          status: 503,
          body: {
            error: {
              code: 'SESSION_UNAVAILABLE',
              message: '会话服务暂时不可用',
              requestId: 'req-boot-1',
            },
          },
        };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    expect(screen.getByText(/会话服务暂时不可用，无法验证登录状态/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试建立会话' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '返回登录' })).toBeInTheDocument();
    expect(screen.getByText('查看详细信息')).toBeInTheDocument();
    expect(screen.queryByText('正在建立会话…')).not.toBeInTheDocument();

    // 错误态不得触发 effect 自动循环 bootstrap。
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(sessions).toBe(1);
  });

  it('重试建立会话成功后继续进入应用', async () => {
    let sessions = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1)
          return {
            status: 503,
            body: { error: { code: 'SESSION_UNAVAILABLE', message: '会话服务暂时不可用' } },
          };
        return { status: 200, body: envelope(authenticatedSession) };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试建立会话' }));

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(sessions).toBe(2);
    expect(screen.queryByText('无法建立会话')).not.toBeInTheDocument();
  });

  it('429 且有 Retry-After 时显示真实倒计时，冷却期间禁用重试', async () => {
    let sessions = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1)
          return {
            status: 429,
            headers: { 'Retry-After': '1' },
            body: {
              error: {
                code: 'RATE_LIMITED',
                message: '请求过于频繁',
                requestId: 'req-429',
              },
            },
          };
        return { status: 200, body: envelope(authenticatedSession) };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    expect(screen.getByText(/会话重试将在 [0-9]+ 秒后恢复/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /请等待 \d+ 秒/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '重试建立会话' })).not.toBeInTheDocument();

    const retry = await screen.findByRole('button', { name: '重试建立会话' }, { timeout: 4000 });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(sessions).toBe(2);
  });

  it('429 缺少有效 Retry-After 时不虚构秒数，仍可人工重试', async () => {
    let sessions = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1)
          return {
            status: 429,
            headers: { 'Retry-After': 'later' },
            body: { error: { code: 'RATE_LIMITED', message: '请求过于频繁' } },
          };
        return { status: 200, body: envelope(authenticatedSession) };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    expect(screen.queryByText(/请等待 \d+ 秒/)).not.toBeInTheDocument();
    expect(screen.getByText(/服务端没有提供可解析的等待时间/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '重试建立会话' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(sessions).toBe(2);
  });

  it('429 缺少 Retry-After 响应头时也不显示虚构秒数，仍可人工重试', async () => {
    let sessions = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1)
          return {
            status: 429,
            body: { error: { code: 'RATE_LIMITED', message: '请求过于频繁' } },
          };
        return { status: 200, body: envelope(authenticatedSession) };
      }
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    expect(screen.queryByText(/请等待 \d+ 秒/)).not.toBeInTheDocument();
    expect(screen.getByText(/服务端没有提供可解析的等待时间/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '重试建立会话' });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(sessions).toBe(2);
  });

  it('返回登录保留原目标路径，登录成功后回到目标页面且不写浏览器存储', async () => {
    let sessions = 0;
    let loginCalls = 0;
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET') {
        sessions += 1;
        if (sessions === 1)
          return {
            status: 503,
            body: { error: { code: 'SESSION_UNAVAILABLE', message: '会话服务暂时不可用' } },
          };
        if (sessions === 2)
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
        return { status: 200, body: envelope(authenticatedSession) };
      }
      if (path === '/api/v1/auth/login' && method === 'POST') {
        loginCalls += 1;
        return { status: 200, body: envelope({ loggedIn: true }) };
      }
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('无法建立会话')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回登录' }));
    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByRole('heading', { name: '项目列表' })).toBeInTheDocument();
    expect(loginCalls).toBe(1);
    expect(sessions).toBeGreaterThanOrEqual(3);
    expect(Object.keys(localStorage).some((key) => /session|token|csrf|password/i.test(key))).toBe(
      false,
    );
  });

  it('首屏工作台快照只请求一次，手动刷新时才强制拉新', async () => {
    const mock = stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/workbench' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            reviews: [],
            changes: [],
            readyTasks: [],
            warnings: [],
            counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        mock.mock.calls.filter(([url]) => pathOf(String(url)) === '/api/v1/workbench'),
      ).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() =>
      expect(
        mock.mock.calls.filter(([url]) => pathOf(String(url)) === '/api/v1/workbench').length,
      ).toBeGreaterThanOrEqual(2),
    );
  });

  it('最近活动有未读时铃铛显示未读点，可一键全部标为已读', async () => {
    const now = new Date().toISOString();
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/workbench' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            reviews: [],
            changes: [],
            readyTasks: [],
            warnings: [],
            counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
          }),
        };
      if (path === '/api/v1/activity' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [1, 2].map((index) => ({
              id: `activity-${index}`,
              projectId: 'p1',
              projectName: 'Demo',
              action: 'REVIEW_DECIDE',
              targetType: 'REVIEW_REQUEST',
              targetId: `review-${index}`,
              targetVersion: 1,
              outcome: 'OK',
              details: null,
              createdAt: now,
              actor: { id: 'u-1', email: 'user@example.com' },
            })),
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    const bell = await screen.findByRole('button', { name: /2 条未读活动/ });
    expect(document.querySelector('.nav-bell-dot')).not.toBeNull();

    fireEvent.click(bell);
    expect(await screen.findByText('2 条未读')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '全部标为已读' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /条未读活动/ })).not.toBeInTheDocument(),
    );
    expect(document.querySelector('.nav-bell-dot')).toBeNull();
    expect(Number(localStorage.getItem('workmesh.activity.lastSeenAt'))).toBeGreaterThan(0);
  });

  it('通知中心的最近活动可以跳转到目标页面', async () => {
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/activity' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            items: [
              {
                id: 'activity-1',
                projectId: 'p1',
                projectName: 'Demo',
                action: 'REVIEW_DECIDE',
                targetType: 'REVIEW_REQUEST',
                targetId: 'review-9',
                targetVersion: 1,
                outcome: 'OK',
                details: null,
                createdAt: new Date().toISOString(),
                actor: { id: 'u-1', email: 'user@example.com' },
              },
            ],
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /通知：/ }));
    expect(await screen.findByRole('dialog', { name: '通知中心' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /评审决定/ }));

    await waitFor(() => expect(document.title).toBe('评审 · WorkMesh'));
    expect(screen.queryByRole('dialog', { name: '通知中心' })).toBeNull();
  });

  function stubShellApis(onActivity?: () => void) {
    return stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/activity' && method === 'GET') {
        onActivity?.();
        return { status: 200, body: envelope({ items: [] }) };
      }
      return undefined;
    });
  }

  it('路由完成后更新浏览器标题、提供跳到正文链接和页面级 h1', async () => {
    stubShellApis();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();
    expect(document.title).toBe('我的待办 · WorkMesh');
    expect(
      screen.getByRole('heading', { level: 1, name: '当前页面：我的待办' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '跳到正文' })).toHaveAttribute('href', '#main-content');
  });

  it('通知中心支持 Escape 与点击外部关闭，并把焦点还给铃铛', async () => {
    stubShellApis();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();

    const bell = screen.getByRole('button', { name: /通知：/ });
    fireEvent.click(bell);
    const panel = await screen.findByRole('dialog', { name: '通知中心' });
    expect(panel).toHaveAttribute('aria-modal', 'true');
    // 打开后焦点进入面板，Tab 只在面板内循环。
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    const focusables = within(panel).getAllByRole('button');
    const lastFocusable = focusables[focusables.length - 1]!;
    lastFocusable.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    // Tab 到末尾会回到面板内第一个可聚焦元素，而不是背景内容。
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(lastFocusable);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '通知中心' })).toBeNull());
    expect(document.activeElement).toBe(bell);

    fireEvent.click(bell);
    expect(await screen.findByRole('dialog', { name: '通知中心' })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '通知中心' })).toBeNull());
  });

  it('移动导航抽屉声明为对话框，打开后焦点在抽屉内，Escape 关闭并回到开关', async () => {
    stubShellApis();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: '工作台' })).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: '打开导航菜单' });
    fireEvent.click(toggle);
    const drawer = await screen.findByRole('dialog', { name: '主导航' });
    expect(drawer).toHaveAttribute('aria-modal', 'true');
    expect(drawer.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '主导航' })).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it('接入与工作区路由可达，并在主导航中注册入口', async () => {
    stubApi((url, init) => {
      const path = pathOf(url);
      const method = methodOf(init);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session' && method === 'GET')
        return { status: 200, body: envelope(authenticatedSession) };
      if (path === '/api/v1/projects' && method === 'GET')
        return { status: 200, body: envelope([project]) };
      if (path === '/api/v1/activity' && method === 'GET')
        return { status: 200, body: envelope({ items: [] }) };
      if (path === '/api/v1/projects/p1/members' && method === 'GET')
        return {
          status: 200,
          body: envelope([{ id: 'user-1', email: 'user@example.com', role: 'MEMBER', version: 1 }]),
        };
      if (path === '/api/v1/projects/p1/repositories' && method === 'GET')
        return { status: 200, body: envelope([]) };
      if (path === '/api/v1/projects/p1/workspace-definition' && method === 'GET')
        return {
          status: 200,
          body: envelope({
            definitionStatus: 'NOT_CONFIGURED',
            projectId: 'p1',
            projectVersion: 1,
            definitionVersion: 0,
            revisionId: null,
            revisionNo: null,
            digest: null,
            publishedAt: null,
            payload: null,
            repositories: [],
            draft: null,
            validation: { valid: true, issues: [] },
          }),
        };
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '接入与工作区' })).toBeInTheDocument();
    expect(await screen.findByText('工作区定义尚未发布')).toBeInTheDocument();
    expect(document.title).toBe('接入与工作区 · WorkMesh');
    // 桌面侧栏与移动抽屉共享同一导航项；至少存在一个可达入口。
    expect(screen.getAllByRole('button', { name: '接入与工作区' }).length).toBeGreaterThan(0);
  });
});
