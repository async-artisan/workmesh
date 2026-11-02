import { vi } from 'vitest';
import { invalidateProjects, useProjectStore } from './store/project';

/** 成功 envelope：页面只读取 data，meta 仅用于追踪。 */
export function envelope(data: unknown): { data: unknown; meta: { requestId: string } } {
  return { data, meta: { requestId: 'req-test' } };
}

export type StubReply = { status: number; body: unknown };
export type StubHandler = (url: string, init: RequestInit) => StubReply | undefined;

function stubResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/**
 * 注入 fetch stub：按 URL + method 返回响应，未配置的请求返回 404，
 * 让测试覆盖真实请求路径、头与请求体，而不是替换页面 API 模块。
 */
export function mockFetch(handler: StubHandler) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const request = init ?? {};
    const reply = handler(url, request);
    if (!reply) {
      return stubResponse(404, {
        error: {
          code: 'STUB_NOT_FOUND',
          message: `未配置的请求：${request.method ?? 'GET'} ${url}`,
        },
      });
    }
    return stubResponse(reply.status, reply.body);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** 读取 JSON 请求体，避免测试里出现隐式 any。 */
export function bodyOf(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('请求体不是 JSON 字符串');
  const parsed: unknown = JSON.parse(init.body);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('请求体不是对象');
  return parsed as Record<string, unknown>;
}

export function pathOf(url: string): string {
  return url.split('?')[0] ?? url;
}

export function methodOf(init: RequestInit): string {
  return (init.method ?? 'GET').toUpperCase();
}

export function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

/** 重置项目缓存并指定当前项目，避免测试之间共享 loadProjects 的模块级缓存。 */
export function useProject(id: string): void {
  localStorage.clear();
  useProjectStore.getState().setProjectId(id);
  invalidateProjects();
}
