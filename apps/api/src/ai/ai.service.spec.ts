import { describe, expect, it, vi } from 'vitest';
import { AiService } from './ai.service';

describe('AiService', () => {
  it('streams an offline draft in chunks when no provider key is configured', async () => {
    const service = new AiService({ get: () => undefined } as never);
    const chunks: string[] = [];
    for await (const chunk of service.stream([{ role: 'user', content: '登录功能' }]))
      chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('')).toContain('产品需求文档草稿');
  });

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

  it('uses configured Anthropic responses and excludes system messages from the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'Draft' }, {}, { text: ' complete' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const service = new AiService({
      get: (key: string, fallback?: string) =>
        key === 'ANTHROPIC_API_KEY' ? 'test-key' : fallback,
    } as never);

    await expect(
      service.complete(
        [
          { role: 'system', content: 'system rules' },
          { role: 'user', content: 'make a PRD' },
        ],
        { temperature: 0.8 },
      ),
    ).resolves.toBe('Draft complete');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.8,
      system: 'system rules',
      messages: [{ role: 'user', content: 'make a PRD' }],
    });
    vi.unstubAllGlobals();
  });

  it('opens the circuit after repeated completion failures', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers();
    const service = new AiService({
      get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : undefined),
    } as never);

    try {
      for (let index = 0; index < 5; index += 1) {
        const pending = service.complete([{ role: 'user', content: 'prompt' }]);
        const rejected = expect(pending).rejects.toMatchObject({ status: 503 });
        await vi.runAllTimersAsync();
        await rejected;
      }
      const requests = fetchMock.mock.calls.length;
      await expect(service.complete([{ role: 'user', content: 'prompt' }])).rejects.toMatchObject({
        status: 503,
      });
      expect(fetchMock).toHaveBeenCalledTimes(requests);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it('parses streamed content events and rejects unavailable streams', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'event: message_start\n: comment\ndata: {"type":"content_block_delta","delta":{"text":"A"}}\ndata: {"type":"other"}\ndata: {"type":"content_block_delta","delta":{"text":"B"}}\ndata: [DONE]\n',
          ),
        );
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: stream });
    vi.stubGlobal('fetch', fetchMock);
    const service = new AiService({
      get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : undefined),
    } as never);
    const chunks: string[] = [];
    for await (const chunk of service.stream([{ role: 'user', content: 'prompt' }]))
      chunks.push(chunk);
    expect(chunks).toEqual(['A', 'B']);

    const unavailable = new AiService({
      get: (key: string) => (key === 'ANTHROPIC_API_KEY' ? 'test-key' : undefined),
    } as never);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, body: null }));
    await expect(async () => {
      for await (const _ of unavailable.stream([{ role: 'user', content: 'prompt' }])) {
        void _;
      }
    }).rejects.toMatchObject({ status: 503 });
    vi.unstubAllGlobals();
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
