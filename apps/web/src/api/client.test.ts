import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { client, SESSION_EXPIRED_EVENT } from './client';
import { useAuthStore } from '../store/auth';

const originalAdapter = client.defaults.adapter;

const ok = (config: InternalAxiosRequestConfig, data: unknown) =>
  Promise.resolve({ data, status: 200, statusText: 'OK', headers: {}, config } as AxiosResponse);

const fail = (config: InternalAxiosRequestConfig, status: number, data: unknown) =>
  Promise.reject(
    Object.assign(new Error(`Request failed with status code ${status}`), {
      config,
      isAxiosError: true,
      response: { data, status, statusText: String(status), headers: {}, config },
    }),
  );

const user = { id: 'u1', email: 'a@b.c', name: 'Tester', role: 'ADMIN' } as never;

describe('auth interceptor', () => {
  beforeEach(() => {
    client.defaults.adapter = originalAdapter;
    useAuthStore.getState().setAuth(user, 'expired-access', 'refresh-token');
  });

  it('ends the session instead of retrying when the refresh token is rejected', async () => {
    const calls: string[] = [];
    client.defaults.adapter = (config) => {
      calls.push(config.url ?? '');
      return fail(config, 401, { message: 'Unauthorized' });
    };
    const onExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);

    await expect(client.get('/projects')).rejects.toMatchObject({ response: { status: 401 } });

    expect(calls).toEqual(['/projects', '/auth/refresh']);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(localStorage.getItem('reqflow.auth')).toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });

  it('surfaces the server message instead of the axios default', async () => {
    client.defaults.adapter = (config) =>
      fail(config, 400, { message: { message: '邮箱或密码错误' } });

    await expect(client.post('/auth/login', {})).rejects.toThrow('邮箱或密码错误');
  });

  it('retries the original request once with the refreshed token', async () => {
    const seen: Array<string | undefined> = [];
    client.defaults.adapter = (config) => {
      if (config.url === '/auth/refresh') return ok(config, { accessToken: 'fresh-access' });
      seen.push(config.headers.Authorization as string);
      return config.headers.Authorization === 'Bearer fresh-access'
        ? ok(config, { ok: true })
        : fail(config, 401, { message: 'Unauthorized' });
    };

    await expect(client.get('/projects')).resolves.toEqual({ ok: true });

    expect(seen).toEqual(['Bearer expired-access', 'Bearer fresh-access']);
    expect(useAuthStore.getState().accessToken).toBe('fresh-access');
  });
});
