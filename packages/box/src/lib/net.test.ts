import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForHttp } from './net';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('waitForHttp', () => {
  it.each([401, 404, 503])('does not treat HTTP %i as service readiness', async (status) => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(null, { status })),
    );
    const result = waitForHttp('http://127.0.0.1/ready', { timeoutMs: 10, intervalMs: 2 });
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
  });

  it('keeps waiting when HTTP 200 does not satisfy the readiness contract', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ready: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ready: true })));
    vi.stubGlobal('fetch', fetch);
    const result = waitForHttp('http://127.0.0.1/ready', {
      timeoutMs: 10,
      intervalMs: 2,
      accept: async (response) => (await response.json()).ready === true,
    });
    await vi.runAllTimersAsync();
    expect(await result).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
