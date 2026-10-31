import { describe, expect, it, vi } from 'vitest';
import { ReqFlowClient } from './client';

describe('reqflow cli', () => {
  it('has a stable command name', () => expect('reqflow').toBe('reqflow'));

  it('refreshes an expired access token before retrying', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'expired' }), { status: 401 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: { accessToken: 'new-access', refreshToken: 'new-refresh' } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { items: [] } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ReqFlowClient({
      apiUrl: 'http://127.0.0.1:3000/api',
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
    });
    await expect(client.request('/requirements?projectId=p')).resolves.toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toContain('/api/requirements');
    vi.unstubAllGlobals();
  });
});
