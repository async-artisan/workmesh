import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { BrowserRouter } from 'react-router-dom';
import { useAuthStore } from './store/auth';

vi.mock('./api/resources', async () => {
  const actual = await vi.importActual<typeof import('./api/resources')>('./api/resources');
  return {
    ...actual,
    dashboardApi: {
      summary: vi.fn().mockResolvedValue({
        projectCount: 0,
        activeRequirementCount: 0,
        completionRate: 0,
        prdCount: 0,
        statusCounts: {},
        recentRequirements: [],
      }),
    },
  };
});

describe('App', () => {
  it('shows the ReqFlow workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    useAuthStore
      .getState()
      .setAuth(
        { id: 'user-1', email: 'user@example.com', name: 'User', role: 'USER' },
        'access-token',
        'refresh-token',
      );
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(screen.getByRole('heading', { name: /控制台/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('API 已连接')).toBeInTheDocument());
    useAuthStore.getState().clearAuth();
    vi.unstubAllGlobals();
  });

  it('redirects unauthenticated users to login', () => {
    useAuthStore.getState().clearAuth();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    window.history.pushState({}, '', '/projects');
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    expect(screen.getByRole('heading', { name: '登录工作台' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
