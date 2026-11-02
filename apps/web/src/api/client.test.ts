import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SESSION_EXPIRED_EVENT, apiRequest, formatApiError, getCsrfToken, setCsrfToken } from './client';
import { useAuthStore } from '../store/auth';

interface StubResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

function envelope(data: unknown) {
  return { data, meta: { requestId: 'req-1' } };
}

function json(status: number, body: unknown): StubResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

const fetchMock = vi.fn();

describe('apiRequest（/api/v1 + cookie + CSRF）', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    setCsrfToken(null);
    useAuthStore.getState().clearAuth();
    useAuthStore
      .getState()
      .setSession({ id: 'user-1', email: 'user@example.com' });
  });

  it('同源请求 /api/v1，携带 cookie，写操作自动带 X-CSRF-Token 与幂等键', async () => {
    setCsrfToken('csrf-token-1');
    fetchMock.mockResolvedValueOnce(json(200, envelope({ id: 'p1' })));

    const result = await apiRequest<{ id: string }>('/projects', {
      method: 'POST',
      body: { name: 'Demo' },
      idempotencyKey: 'auto',
    });

    expect(result).toEqual({ id: 'p1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/projects');
    expect(init.credentials).toBe('include');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-CSRF-Token']).toBe('csrf-token-1');
    expect(headers['Idempotency-Key']).toBeTruthy();
  });

  it('403 错误 envelope 原样抛出，不吞成通用消息', async () => {
    fetchMock.mockResolvedValueOnce(
      json(403, { error: { code: 'FORBIDDEN', message: '不具备该槽位', requestId: 'req-403' } }),
    );

    const caught = await apiRequest('/projects', { method: 'POST', body: {} }).catch((value: unknown) => value);

    expect(caught).toBeInstanceOf(ApiError);
    const error = caught as ApiError;
    expect(error.status).toBe(403);
    expect(error.code).toBe('FORBIDDEN');
    expect(error.requestId).toBe('req-403');
    expect(formatApiError(error)).toContain('[FORBIDDEN] 不具备该槽位');
    expect(formatApiError(error)).toContain('requestId req-403');
  });

  it('409 冲突与 410 过期均抛出，保留 code 与 details', async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, {
        error: {
          code: 'VERSION_CONFLICT',
          message: '版本冲突',
          details: { currentVersion: 4 },
          requestId: 'req-409',
        },
      }),
    );
    const conflict = await apiRequest('/documents/d1/withdraw', { method: 'POST', body: {} }).catch(
      (value: unknown) => value,
    );
    expect((conflict as ApiError).status).toBe(409);
    expect((conflict as ApiError).code).toBe('VERSION_CONFLICT');
    expect((conflict as ApiError).details).toEqual({ currentVersion: 4 });

    fetchMock.mockResolvedValueOnce(
      json(410, { error: { code: 'CONFIRMATION_EXPIRED', message: '票据已过期', requestId: 'req-410' } }),
    );
    const expired = await apiRequest('/review-requests/r1/decisions', { method: 'POST', body: {} }).catch(
      (value: unknown) => value,
    );
    expect((expired as ApiError).status).toBe(410);
    expect((expired as ApiError).code).toBe('CONFIRMATION_EXPIRED');
  });

  it('401 结束会话并触发 session-expired，不尝试刷新', async () => {
    const onExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    fetchMock.mockResolvedValueOnce(
      json(401, { error: { code: 'AUTH_REQUIRED', message: '会话已失效', requestId: 'req-401' } }),
    );

    await expect(apiRequest('/projects')).rejects.toMatchObject({ status: 401, code: 'AUTH_REQUIRED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toBeNull();
    expect(getCsrfToken()).toBe('');
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  });
});
