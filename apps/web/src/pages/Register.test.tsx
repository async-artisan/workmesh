import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Register } from './Register';
import { setCsrfToken } from '../api/client';
import { bodyOf, envelope, methodOf, mockFetch, pathOf } from '../test-utils';

const authenticatedSession = {
  authenticated: true,
  sessionId: 'session-1',
  expiresAt: '2026-12-01T00:00:00.000Z',
  idleExpiresAt: '2026-11-02T00:00:00.000Z',
  csrfToken: 'csrf-auth',
  user: { id: 'user-1', email: 'user@example.com' },
};

function handler(options: { registerReply?: { status: number; body: unknown } } = {}) {
  let sessions = 0;
  return (url: string, init: RequestInit) => {
    const path = pathOf(url);
    const method = methodOf(init);
    if (path === '/api/v1/auth/session' && method === 'GET') {
      sessions += 1;
      if (sessions === 1)
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
    if (path === '/api/v1/auth/register' && method === 'POST')
      return (
        options.registerReply ?? {
          status: 201,
          body: envelope({
            user: { id: 'user-1', email: 'user@example.com' },
          }),
        }
      );
    return undefined;
  };
}

function renderRegister() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<div>工作台首页</div>} />
        <Route path="/login" element={<div>登录页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillForm(values: {
  email?: string;
  password: string;
  confirmPassword: string;
  name?: string;
}) {
  fireEvent.change(screen.getByLabelText('邮箱'), {
    target: { value: values.email ?? 'new@example.com' },
  });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: values.password } });
  fireEvent.change(screen.getByLabelText('确认密码'), {
    target: { value: values.confirmPassword },
  });
  if (values.name !== undefined)
    fireEvent.change(screen.getByLabelText('姓名（可选）'), { target: { value: values.name } });
}

function registerCalls(mock: ReturnType<typeof mockFetch>) {
  return mock.mock.calls.filter(
    ([url, init]) =>
      pathOf(String(url)) === '/api/v1/auth/register' && methodOf(init ?? {}) === 'POST',
  );
}

describe('Register（创建账号）', () => {
  beforeEach(() => {
    localStorage.clear();
    setCsrfToken(null);
  });

  afterEach(() => {
    setCsrfToken(null);
    localStorage.clear();
  });

  it('注册成功：标题、密码规则与确认密码正确，成功后进入工作台', async () => {
    const mock = mockFetch(handler());

    renderRegister();
    expect(screen.getByRole('heading', { name: '创建账号' })).toBeInTheDocument();
    expect(screen.getByText(/密码长度必须为 8–200 个字符/)).toBeInTheDocument();

    fillForm({ password: 'Passw0rd', confirmPassword: 'Passw0rd', name: '  新同学  ' });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('工作台首页')).toBeInTheDocument();
    const calls = registerCalls(mock);
    expect(calls).toHaveLength(1);
    expect(bodyOf(calls[0]?.[1] ?? {})).toEqual({
      email: 'new@example.com',
      password: 'Passw0rd',
      name: '新同学',
    });
    expect(Object.keys(localStorage).some((key) => /token|session|csrf|password/i.test(key))).toBe(
      false,
    );
  });

  it('两次密码不一致时不调用注册 API', async () => {
    const mock = mockFetch(handler());
    renderRegister();

    fillForm({ password: 'Passw0rd', confirmPassword: 'Passw0rd-different' });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('两次输入的密码不一致，请重新输入。')).toBeInTheDocument();
    expect(registerCalls(mock)).toHaveLength(0);
  });

  it('密码长度边界：少于 8 或超过 200 时客户端拒绝，8 位可用', async () => {
    const rejected = mockFetch(handler());
    const { unmount } = renderRegister();

    fillForm({ password: '1234567', confirmPassword: '1234567' });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(
      within(await screen.findByRole('alert')).getByText('密码长度必须为 8–200 个字符。'),
    ).toBeInTheDocument();
    expect(registerCalls(rejected)).toHaveLength(0);
    unmount();

    setCsrfToken(null);
    const tooLong = mockFetch(handler());
    const second = renderRegister();
    fillForm({ password: 'a'.repeat(201), confirmPassword: 'a'.repeat(201) });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(
      within(await screen.findByRole('alert')).getByText('密码长度必须为 8–200 个字符。'),
    ).toBeInTheDocument();
    expect(registerCalls(tooLong)).toHaveLength(0);
    second.unmount();

    setCsrfToken(null);
    const accepted = mockFetch(handler());
    renderRegister();
    fillForm({ password: 'a'.repeat(8), confirmPassword: 'a'.repeat(8) });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('工作台首页')).toBeInTheDocument();
    expect(registerCalls(accepted)).toHaveLength(1);
  });

  it('姓名可选：留空时不提交 name，仍可注册成功', async () => {
    const mock = mockFetch(handler());
    renderRegister();

    fillForm({ password: 'Passw0rd', confirmPassword: 'Passw0rd' });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('工作台首页')).toBeInTheDocument();
    const body = bodyOf(registerCalls(mock)[0]?.[1] ?? {});
    expect(body).not.toHaveProperty('name');
  });

  it('已有账号入口跳转登录页', () => {
    mockFetch(handler());
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: '已有账号？登录' }));
    expect(screen.getByText('登录页')).toBeInTheDocument();
  });

  it('注册冲突错误显示可读中文，技术详情默认折叠', async () => {
    mockFetch(
      handler({
        registerReply: {
          status: 409,
          body: {
            error: {
              code: 'EMAIL_IN_USE',
              message: '该邮箱已注册',
              requestId: 'req-register-409',
            },
          },
        },
      }),
    );
    renderRegister();

    fillForm({ password: 'Passw0rd', confirmPassword: 'Passw0rd' });
    fireEvent.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('该邮箱已注册，请直接登录。')).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    const details = alert.querySelector('details');
    expect(details).not.toBeNull();
    if (!details) throw new Error('注册错误应包含技术详情折叠区');
    expect(details.open).toBe(false);
    expect(details).toHaveTextContent('[EMAIL_IN_USE] 该邮箱已注册');
    expect(details).toHaveTextContent('requestId req-register-409');
    expect(details).not.toHaveTextContent('Passw0rd');
    expect(alert).not.toHaveTextContent('Passw0rd');
    fireEvent.click(within(details).getByText('查看详细信息'));
    expect(details.open).toBe(true);
  });

  it('注册页说明注册后可以创建项目或通过邀请加入，且不额外发请求', async () => {
    const mock = mockFetch(handler());
    renderRegister();

    expect(screen.getByText('注册后可以创建项目，或通过邀请加入已有项目。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已有账号？登录' })).toBeInTheDocument();
    expect(
      mock.mock.calls.filter(
        ([url, init]) =>
          pathOf(String(url)) === '/api/v1/auth/register' && methodOf(init ?? {}) === 'POST',
      ),
    ).toHaveLength(0);
  });
});
