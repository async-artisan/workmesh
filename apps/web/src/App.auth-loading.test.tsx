import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envelope, headersOf, methodOf, mockFetch, pathOf } from './test-utils';

function deferredImport() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const user = { id: 'user-1', email: 'user@example.com' };
const session = {
  sessionId: 'session-1',
  expiresAt: '2026-12-01T00:00:00.000Z',
  idleExpiresAt: '2026-12-01T00:00:00.000Z',
  csrfToken: 'csrf-1',
};

describe('App public authentication page loading', () => {
  let App: ComponentType;
  let router: typeof import('react-router-dom');
  let authStore: typeof import('./store/auth');
  let client: typeof import('./api/client');
  let loads: { login: number; register: number };
  let loginImport: ReturnType<typeof deferredImport> | null;
  let registerImport: ReturnType<typeof deferredImport> | null;

  beforeEach(async () => {
    // Reset App as well as its page modules: React.lazy and import factories must not
    // reuse a page loaded by an earlier test and hide an eager-loading regression.
    vi.resetModules();
    localStorage.clear();
    loads = { login: 0, register: 0 };
    loginImport = null;
    registerImport = null;
    vi.doMock('./pages/Login', async () => {
      loads.login += 1;
      if (loginImport) await loginImport.promise;
      return vi.importActual<typeof import('./pages/Login')>('./pages/Login');
    });
    vi.doMock('./pages/Register', async () => {
      loads.register += 1;
      if (registerImport) await registerImport.promise;
      return vi.importActual<typeof import('./pages/Register')>('./pages/Register');
    });
    vi.doMock('./pages/Workbench', () => ({
      Workbench: () => <h2>已登录工作台</h2>,
    }));
    vi.doMock('./pages/Projects', () => ({
      Projects: () => {
        const location = router.useLocation();
        return <h2>项目目标：{`${location.pathname}${location.search}`}</h2>;
      },
    }));
    router = await import('react-router-dom');
    ({ App } = await import('./App'));
    authStore = await import('./store/auth');
    client = await import('./api/client');
    client.setCsrfToken(null);
    authStore.useAuthStore.setState({ user: null, status: 'loading' });
  });

  afterEach(() => {
    cleanup();
    client.setCsrfToken(null);
    vi.doUnmock('./pages/Login');
    vi.doUnmock('./pages/Register');
    vi.doUnmock('./pages/Workbench');
    vi.doUnmock('./pages/Projects');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stubSession(initialAuthenticated: boolean) {
    let authenticated = initialAuthenticated;
    return mockFetch((url, init) => {
      const path = pathOf(url);
      if (path === '/api/health') return { status: 200, body: {} };
      if (path === '/api/v1/auth/session')
        return {
          status: 200,
          body: envelope({ ...session, authenticated, ...(authenticated ? { user } : {}) }),
        };
      if (
        (path === '/api/v1/auth/login' || path === '/api/v1/auth/register') &&
        methodOf(init) === 'POST'
      ) {
        authenticated = true;
        return { status: 200, body: envelope({ authenticated: true }) };
      }
      if (path === '/api/v1/workbench')
        return {
          status: 200,
          body: envelope({
            reviews: [],
            changes: [],
            readyTasks: [],
            counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
          }),
        };
      if (path === '/api/v1/activity')
        return { status: 200, body: envelope({ items: [], nextCursor: null }) };
      return undefined;
    });
  }

  function renderRoute(path: string) {
    const { MemoryRouter } = router;
    return render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );
  }

  it('does not import either authentication page when opening an authenticated home', async () => {
    stubSession(true);
    renderRoute('/');

    expect(await screen.findByRole('heading', { name: '已登录工作台' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /账号菜单：user@example.com/ })).toBeVisible();
    expect(loads).toEqual({ login: 0, register: 0 });
  });

  it('shows the login loading state after an anonymous redirect and preserves the requested URL', async () => {
    const mock = stubSession(false);
    loginImport = deferredImport();
    renderRoute('/projects?view=mine');

    await waitFor(() => expect(loads.login).toBe(1));
    expect(screen.getByText('正在加载页面…')).toBeVisible();
    expect(screen.queryByRole('heading', { name: '登录工作台' })).not.toBeInTheDocument();
    expect(loads.register).toBe(0);

    await act(async () => loginImport!.resolve());
    expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(
      await screen.findByRole('heading', { name: '项目目标：/projects?view=mine' }),
    ).toBeVisible();
    const loginCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/login' && methodOf(init ?? {}) === 'POST',
    );
    expect(headersOf(loginCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
    expect(loads).toEqual({ login: 1, register: 0 });
  });

  it('loads the public register form on demand and submits through the existing session flow', async () => {
    const mock = stubSession(false);
    registerImport = deferredImport();
    renderRoute('/register');

    await waitFor(() => expect(loads.register).toBe(1));
    expect(screen.getByText('正在加载页面…')).toBeVisible();
    expect(mock.mock.calls.some(([url]) => pathOf(String(url)) === '/api/v1/auth/session')).toBe(
      false,
    );
    expect(loads.login).toBe(0);

    await act(async () => registerImport!.resolve());
    expect(await screen.findByRole('button', { name: '注册' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-pass' } });
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'secret-pass' } });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByRole('heading', { name: '已登录工作台' })).toBeVisible();
    const registerCall = mock.mock.calls.find(
      ([url, init]) =>
        pathOf(String(url)) === '/api/v1/auth/register' && methodOf(init ?? {}) === 'POST',
    );
    expect(headersOf(registerCall?.[1] ?? {})['X-CSRF-Token']).toBe('csrf-1');
    expect(loads).toEqual({ login: 0, register: 1 });
  });

  it('keeps a failed public page import inside the existing error boundary', async () => {
    stubSession(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('login chunk unavailable');
    const ignoreExpectedError = (event: ErrorEvent) => {
      if (event.error === failure || event.error?.cause === failure) event.preventDefault();
    };
    window.addEventListener('error', ignoreExpectedError);
    try {
      loginImport = deferredImport();
      renderRoute('/login');
      await waitFor(() => expect(loads.login).toBe(1));

      await act(async () => loginImport!.reject(failure));

      expect(await screen.findByText('页面渲染出错')).toBeVisible();
      expect(screen.getByRole('button', { name: '刷新页面' })).toBeEnabled();
      expect(screen.queryByText('正在加载页面…')).not.toBeInTheDocument();
      expect(loads.register).toBe(0);
    } finally {
      window.removeEventListener('error', ignoreExpectedError);
    }
  });
});
