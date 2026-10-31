import { describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

describe('AiService', () => {
  it('retries transient embedding failures', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0] }] }),
      });
    vi.stubGlobal('fetch', fetchMock);
    const service = new AiService({
      get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
    } as never);
    await expect(service.embeddings(['hello'])).resolves.toEqual([[1, 0]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('opens the circuit after repeated embedding failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const service = new AiService({
      get: (key: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : undefined),
    } as never);

    try {
      for (let index = 0; index < 5; index += 1) {
        const pending = service.embeddings(['prompt']);
        const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
        await vi.runAllTimersAsync();
        await rejected;
      }
      const requests = fetchMock.mock.calls.length;
      await expect(service.embeddings(['prompt'])).rejects.toMatchObject({ status: 503 });
      expect(fetchMock).toHaveBeenCalledTimes(requests);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('creates normalized local vectors and sorts provider embeddings', async () => {
    const offline = new AiService({ get: () => undefined } as never);
    const [first, empty] = await offline.embeddings(['ReqFlow requirement', '!!!']);
    expect(first).toHaveLength(64);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value ** 2, 0))).toBeCloseTo(1);
    expect(empty.every((value) => value === 0)).toBe(true);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const provider = new AiService({
      get: (key: string, fallback?: string) => (key === 'OPENAI_API_KEY' ? 'test-key' : fallback),
    } as never);
    await expect(provider.embeddings(['one', 'two'])).resolves.toEqual([
      [1, 0],
      [0, 1],
    ]);
    vi.unstubAllGlobals();
  });
});
