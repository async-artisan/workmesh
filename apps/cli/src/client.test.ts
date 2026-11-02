import { describe, expect, it } from 'vitest';
import { V1Client, type FetchLike } from './client';
import { CliError } from './errors';
import type { Platform } from './platform';

const platform: Platform = {
  origin: 'https://workmesh.example.com',
  apiBasePath: '/api/v1',
};
const UUID = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';

type Call = { url: string; init: RequestInit };

function stub(responses: Array<() => Response | Promise<Response>>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!next) throw new Error('no response');
    return next();
  };
  return { fetch, calls };
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function makeClient(fetch: FetchLike, bearer?: string): V1Client {
  return new V1Client({
    platform,
    bearer,
    fetch,
    sleep: async () => undefined,
    now: () => 0,
    random: () => 0,
  });
}

describe('V1Client', () => {
  it('只打 /api/v1 并解析成功 envelope 的 requestId', async () => {
    const { fetch, calls } = stub([
      () => json(200, { data: { ok: true }, meta: { requestId: 'req-1' } }),
    ]);
    const client = makeClient(fetch, 'wm_a1.credential.secret');
    const response = await client.request<{ ok: boolean }>('GET', '/tasks/1', { query: { a: 1 } });
    expect(response).toEqual({ data: { ok: true }, requestId: 'req-1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://workmesh.example.com/api/v1/tasks/1?a=1');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer wm_a1.credential.secret');
    expect(headers.accept).toBe('application/json');
    expect(calls[0]?.init.redirect).toBe('error');
  });

  it('非 2xx 一律按错误 envelope 失败，不当作成功', async () => {
    const { fetch } = stub([
      () =>
        json(
          409,
          {
            error: {
              code: 'VERSION_CONFLICT',
              message: '版本冲突',
              details: { expectedVersion: 1 },
              requestId: 'req-2',
            },
          },
          { 'x-request-id': 'req-header' },
        ),
    ]);
    const client = makeClient(fetch);
    await expect(client.request('GET', `/tasks/${UUID}`)).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      exitCode: 5,
      status: 409,
      requestId: 'req-2',
      details: { expectedVersion: 1 },
    });
  });

  it('非 2xx 缺少 envelope 视为协议错误（exit 9）', async () => {
    const { fetch } = stub([() => json(400, { statusCode: 400, message: 'Bad Request' })]);
    const client = makeClient(fetch);
    await expect(client.request('GET', '/tasks')).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID',
      exitCode: 9,
    });
  });

  it('2xx 缺少 {data,meta.requestId} 视为协议错误', async () => {
    const { fetch } = stub([() => json(200, { data: {} })]);
    const client = makeClient(fetch);
    await expect(client.request('GET', '/tasks')).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID',
    });
  });

  it('401 立即停止，不刷新、不重试', async () => {
    const { fetch, calls } = stub([
      () => json(401, { error: { code: 'AUTH_INVALID', message: '凭据无效', requestId: 'req-3' } }),
    ]);
    const client = makeClient(fetch, 'wm_a1.old.secret');
    await expect(client.request('GET', '/tasks')).rejects.toMatchObject({
      code: 'AUTH_INVALID',
      exitCode: 3,
    });
    expect(calls).toHaveLength(1);
  });

  it('GET 对 503 退避后重试，最终返回成功结果', async () => {
    const { fetch, calls } = stub([
      () =>
        json(
          503,
          { error: { code: 'SERVER_ERROR', message: '暂不可用', requestId: 'req-4' } },
          { 'retry-after': '1' },
        ),
      () => json(200, { data: { ok: true }, meta: { requestId: 'req-5' } }),
    ]);
    const client = makeClient(fetch);
    const response = await client.request<{ ok: boolean }>('GET', '/tasks');
    expect(response.requestId).toBe('req-5');
    expect(calls).toHaveLength(2);
  });

  it('网络不可达明确报 stale/unavailable（exit 7）', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const client = makeClient(fetch);
    await expect(client.request('GET', '/tasks')).rejects.toMatchObject({
      code: 'NETWORK_UNAVAILABLE',
      exitCode: 7,
    });
  });

  it('写操作必须携带 Idempotency-Key，否则本地拒绝', async () => {
    const { fetch, calls } = stub([() => json(200, { data: {}, meta: { requestId: 'r' } })]);
    const client = makeClient(fetch);
    await expect(client.request('POST', '/tasks/1/claims', { body: {} })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
    });
    expect(calls).toHaveLength(0);

    await client.request('POST', '/tasks/1/claims', { body: {}, idempotencyKey: UUID });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBe(UUID);
  });

  it('认证类写操作可显式禁用业务幂等键', async () => {
    const { fetch, calls } = stub([() => json(201, { data: {}, meta: { requestId: 'r' } })]);
    const client = makeClient(fetch);
    await client.request('POST', '/auth/cli-authorizations', { body: {}, idempotent: false });
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['idempotency-key']).toBeUndefined();
  });

  it('非法或不安全路径在本地拒绝', async () => {
    const client = makeClient(async () => json(200, { data: {}, meta: { requestId: 'r' } }));
    await expect(client.request('GET', '../api/v1/tasks')).rejects.toBeInstanceOf(CliError);
    await expect(client.request('GET', 'https://evil.example.com/tasks')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('GET 超过总时限后报告 RETRY_EXHAUSTED', async () => {
    let clock = 0;
    const fetch: FetchLike = async () => {
      clock += 20_000;
      return json(503, { error: { code: 'SERVER_ERROR', message: 'down', requestId: 'r' } });
    };
    const client = new V1Client({
      platform,
      fetch,
      sleep: async () => undefined,
      now: () => clock,
      deadlineMs: 30_000,
    });
    await expect(client.request('GET', '/tasks')).rejects.toMatchObject({
      code: 'RETRY_EXHAUSTED',
      exitCode: 7,
    });
  });
});

describe('V1Client 错误码映射', () => {
  it('403 → exit 4，429 → exit 7', async () => {
    const forbidden = makeClient(async () =>
      json(403, { error: { code: 'FORBIDDEN', message: '无权', requestId: 'r' } }),
    );
    await expect(forbidden.request('GET', '/tasks')).rejects.toMatchObject({ exitCode: 4 });
    const limited = makeClient(async () =>
      json(429, { error: { code: 'RATE_LIMITED', message: '限流', requestId: 'r' } }),
    );
    await expect(limited.request('GET', '/tasks')).rejects.toMatchObject({ exitCode: 7 });
  });
});
