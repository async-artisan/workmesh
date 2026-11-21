import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { setCsrfToken } from '../api/client';
import { useAuthStore } from '../store/auth';
import { envelope, mockFetch, pathOf } from '../test-utils';
import type { NotificationPanelProps } from './NotificationPanel';

const imports = vi.hoisted(() => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { load: vi.fn(), ready: { promise, resolve } };
});

vi.mock('./NotificationPanel', async () => {
  imports.load();
  if (imports.load.mock.calls.length === 1) throw new Error('notification chunk unavailable');
  await imports.ready.promise;
  return {
    NotificationPanel: (props: NotificationPanelProps) => (
      <>
        <p>已加载通知内容</p>
        {props.recentActivity.map((item) => (
          <p key={item.id}>{item.projectName}</p>
        ))}
        <button onClick={() => props.onNavigate('/?type=changes')}>查看通知变更</button>
      </>
    ),
  };
});

afterEach(() => {
  cleanup();
  setCsrfToken(null);
  localStorage.clear();
  useAuthStore.setState({ user: null, status: 'loading' });
  vi.unstubAllGlobals();
});

it('通知模块关闭时不请求；失败可重试，慢加载可键盘关闭，迟到模块不重开或带回旧账号资料', async () => {
  localStorage.clear();
  setCsrfToken(null);
  useAuthStore.setState({ user: null, status: 'loading' });
  mockFetch((url) => {
    const path = pathOf(url);
    if (path === '/api/health') return { status: 200, body: {} };
    if (path === '/api/v1/auth/session')
      return {
        status: 200,
        body: envelope({
          authenticated: true,
          sessionId: 'session-1',
          csrfToken: 'csrf-1',
          user: { id: 'user-1', email: 'first@example.com' },
        }),
      };
    if (path === '/api/v1/projects') return { status: 200, body: envelope([]) };
    if (path === '/api/v1/workbench')
      return {
        status: 200,
        body: envelope({
          reviews: [],
          changes: [],
          readyTasks: [],
          warnings: [],
          counts: { total: 0, reviews: 0, changes: 0, readyTasks: 0 },
        }),
      };
    if (path === '/api/v1/activity')
      return {
        status: 200,
        body: envelope({
          items: [
            {
              id: `activity-${useAuthStore.getState().user?.id}`,
              projectId: 'project-1',
              projectName:
                useAuthStore.getState().user?.id === 'user-2' ? '新账号活动' : '旧账号活动',
              action: 'REVIEW_DECIDE',
              targetType: 'REVIEW_REQUEST',
              targetId: 'review-1',
              targetVersion: 1,
              outcome: 'OK',
              details: null,
              createdAt: '2026-11-10T00:00:00Z',
              actor: null,
            },
          ],
        }),
      };
    return undefined;
  });
  render(
    <MemoryRouter initialEntries={['/projects']}>
      <App />
    </MemoryRouter>,
  );
  const bell = await screen.findByRole('button', { name: /1 条未读活动/ });
  expect(imports.load).not.toHaveBeenCalled();
  bell.focus();
  fireEvent.click(bell);
  expect(screen.getByRole('dialog', { name: '通知中心' })).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('无法加载通知内容');
  expect(screen.getByRole('alert')).toHaveTextContent('先保存其他未提交输入');
  expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument();
  const first = screen.getByRole('button', { name: '将当前活动标为已读' });
  expect(first).toHaveFocus();
  const last = screen.getByRole('button', { name: '刷新页面' });
  last.focus();
  fireEvent.keyDown(document, { key: 'Tab' });
  expect(first).toHaveFocus();

  fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
  await waitFor(() => expect(imports.load).toHaveBeenCalledTimes(2));
  expect(screen.getByText('正在加载通知内容…')).toHaveAttribute('role', 'status');
  // While the same shared module downloads, account-specific props must be reset.
  act(() =>
    useAuthStore.setState({
      user: { id: 'user-2', email: 'second@example.com' },
      status: 'authenticated',
    }),
  );
  await screen.findByRole('button', { name: /1 条未读活动/ });
  screen.getByRole('button', { name: '关闭通知' }).focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: '通知中心' })).not.toBeInTheDocument();
  expect(bell).toHaveFocus();
  await act(async () => {
    imports.ready.resolve();
    await imports.ready.promise;
  });
  expect(screen.queryByRole('dialog', { name: '通知中心' })).not.toBeInTheDocument();
  fireEvent.click(bell);
  expect(await screen.findByText('已加载通知内容')).toBeInTheDocument();
  expect(await screen.findByText('新账号活动')).toBeInTheDocument();
  expect(screen.queryByText('旧账号活动')).not.toBeInTheDocument();
  expect(imports.load).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: '将当前活动标为已读' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: '关闭通知' }));
  expect(bell).toHaveFocus();
});
