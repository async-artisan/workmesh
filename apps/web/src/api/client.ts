import { useAuthStore } from '../store/auth';

/** 正式协议只有 v1；浏览器同源访问，不使用其它 API root。 */
export const API_ROOT = '/api/v1';
export const SESSION_EXPIRED_EVENT = 'workmesh:session-expired';

/**
 * 错误不再折叠成 axios 的通用 message：保留 HTTP 状态、v1 code、details 与 requestId，
 * 401/403/409/410 等业务拒绝一律向上抛出，由页面决定如何展示。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
    /** HTTP Retry-After 的秒数；缺失或不可解析时为 null，不猜测等待时间。 */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 会话 CSRF 仅保存在内存（bootstrap 响应或同源可读 cookie），不写 localStorage。 */
let csrfToken = '';

export function setCsrfToken(token: string | null | undefined): void {
  csrfToken = token ?? '';
}

export function getCsrfToken(): string {
  return csrfToken;
}

const CSRF_COOKIE_NAMES = ['__Host-wm_csrf', 'wm_csrf'] as const;

function readCookie(name: string): string {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) return decodeURIComponent(entry.slice(prefix.length));
  }
  return '';
}

/** 服务端 bootstrap 已下发 CSRF 时优先使用内存值；缺失时回退到同源可读 cookie。 */
function activeCsrfToken(): string {
  if (csrfToken) return csrfToken;
  for (const name of CSRF_COOKIE_NAMES) {
    const value = readCookie(name);
    if (value) {
      csrfToken = value;
      return value;
    }
  }
  return '';
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  /** 'auto' 表示业务写操作自动生成 Idempotency-Key；字符串用于重放同一意图。 */
  idempotencyKey?: 'auto' | string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

interface SuccessEnvelope<T> {
  data: T;
  meta?: { requestId?: string };
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown; details?: unknown; requestId?: unknown };
}

const MUTATING: ReadonlySet<HttpMethod> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  throw new ApiError(0, 'CRYPTO_UNAVAILABLE', '当前浏览器无法生成幂等键');
}

/** Retry-After 只接受秒数形式；HTTP-date 或非法值返回 null，由 UI 走人工重试。 */
export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seconds = Number(trimmed);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

function parseError(
  status: number,
  payload: unknown,
  fallback: string,
  retryAfterSeconds: number | null = null,
): ApiError {
  const envelope = (payload as ErrorEnvelope | null)?.error;
  const code = typeof envelope?.code === 'string' ? envelope.code : `HTTP_${status}`;
  const message =
    typeof envelope?.message === 'string' && envelope.message.trim() ? envelope.message : fallback;
  const details =
    envelope?.details && typeof envelope.details === 'object'
      ? (envelope.details as Record<string, unknown>)
      : undefined;
  const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId : undefined;
  return new ApiError(status, code, message, details, requestId, retryAfterSeconds);
}

function endSession(): void {
  const { user, clearAuth } = useAuthStore.getState();
  clearAuth();
  setCsrfToken(null);
  if (user) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

/**
 * 统一请求：同源 /api/v1、credentials:'include'、写操作自动带 X-CSRF-Token。
 * 成功取 envelope.data；错误按 envelope 解析后抛出，不做自动刷新或自动重试。
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method)) {
    const token = activeCsrfToken();
    if (token) headers['X-CSRF-Token'] = token;
    if (options.idempotencyKey === 'auto') headers['Idempotency-Key'] = randomKey();
    else if (typeof options.idempotencyKey === 'string' && options.idempotencyKey)
      headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const retryAfterSeconds = parseRetryAfter(response.headers?.get?.('Retry-After') ?? null);
    const error = parseError(
      response.status,
      payload,
      `请求失败（HTTP ${response.status}）`,
      retryAfterSeconds,
    );
    if (response.status === 401) endSession();
    throw error;
  }

  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as SuccessEnvelope<T>).data;
  }
  return payload as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal });

/** 面向用户的错误文本：同时保留服务端 code 与 requestId，便于核对审计。 */
export function formatApiError(error: unknown): string {
  if (error instanceof ApiError) {
    const requestId = error.requestId ? ` · requestId ${error.requestId}` : '';
    return `[${error.code}] ${error.message}${requestId}`;
  }
  if (error instanceof Error) return error.message;
  return '请求失败';
}

export function apiErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}
