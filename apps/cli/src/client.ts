import { hostname as osHostname, platform as osPlatform, release as osRelease } from 'node:os';
import { canonicalJson, type ApiError } from '@workmesh/shared';
import { CLI_VERSION } from './config';
import { CliError } from './errors';
import type { Platform } from './platform';
import {
  parseConsumedEnrollment,
  parseCurrentWorkspaceDefinition,
  parseWorkspaceRevision,
  type EnrolledProject,
  type ResolvedWorkspaceDefinition,
  type WorkspaceDefinitionPayload,
} from './workspace-config';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type V1ClientOptions = {
  platform: Platform;
  bearer?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  attemptTimeoutMs?: number;
  deadlineMs?: number;
};

export type V1Response<T> = { data: T; requestId: string };

export type RequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  idempotencyKey?: string;
  /** 认证等例外写操作不带业务幂等键；其余写操作必须显式提供。 */
  idempotent?: boolean;
};

const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);
const MAX_ATTEMPTS = 3;
const SAFE_PATH = /^\/[A-Za-z0-9._~/:%+-]*$/;
const ENCODED_SEPARATOR = /%(?:2f|2e|00|5c)/i;

/** 设备元数据头上限，与 GET /auth/credentials 暴露的 device 字段契约一致。 */
const DEVICE_NAME_MAX = 80;
const PLATFORM_MAX = 60;
const CLIENT_VERSION_MAX = 30;
const HEADER_SAFE = /[^\x20-\x7e]/g;

function truncateHeader(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * 每个请求都上报设备元数据，让凭据列表能区分是哪台机器授权的。
 * 值在模块加载时只计算一次；HTTP 头只能是 ASCII，非 ASCII 主机名按 `_` 归一。
 */
function buildDeviceHeaders(): Readonly<Record<string, string>> {
  let hostname: string;
  try {
    hostname = osHostname();
  } catch {
    hostname = '';
  }
  return Object.freeze({
    'x-workmesh-device': truncateHeader(hostname.replace(HEADER_SAFE, '_'), DEVICE_NAME_MAX),
    'x-workmesh-platform': truncateHeader(
      `${osPlatform()} ${osRelease()}`.replace(HEADER_SAFE, '_'),
      PLATFORM_MAX,
    ),
    'x-workmesh-client-version': truncateHeader(CLI_VERSION, CLIENT_VERSION_MAX),
  });
}

const DEVICE_HEADERS = buildDeviceHeaders();

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 只打 /api/v1；失败一律按错误 envelope 解析，绝不以 2xx 之外的响应当作成功。 */
export class V1Client {
  private readonly platform: Platform;
  private readonly bearer?: string;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly attemptTimeoutMs: number;
  private readonly deadlineMs: number;

  constructor(options: V1ClientOptions) {
    this.platform = options.platform;
    this.bearer = options.bearer;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? 10_000;
    this.deadlineMs = options.deadlineMs ?? 30_000;
  }

  private url(path: string, query?: RequestOptions['query']): string {
    if (
      !SAFE_PATH.test(path) ||
      path.includes('//') ||
      path.includes('..') ||
      ENCODED_SEPARATOR.test(path)
    )
      throw new CliError('INVALID_REQUEST', `非法 API 路径：${path}`);
    const base = `${this.platform.origin}${this.platform.apiBasePath}`;
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(
    method: string,
    path: string,
    options: RequestOptions = {},
  ): Promise<V1Response<T>> {
    const upper = method.toUpperCase();
    const readOnly = upper === 'GET' || upper === 'HEAD';
    if (!readOnly && options.idempotent !== false && !options.idempotencyKey)
      throw new CliError('IDEMPOTENCY_KEY_REQUIRED', '写操作必须提供 Idempotency-Key');
    const url = this.url(path, options.query);
    const body = options.body === undefined ? undefined : canonicalJson(options.body);
    const idempotencyKey = options.idempotencyKey;
    const deadline = this.now() + this.deadlineMs;

    for (let attempt = 1; ; attempt += 1) {
      if (!readOnly && attempt > 1) throw new CliError('INTERNAL_ERROR', '写操作不得自动重试');
      const remaining = deadline - this.now();
      if (remaining <= 0)
        throw new CliError('RETRY_EXHAUSTED', '请求超过总时限，结果未知', { exitCode: 7 });

      let response: Response;
      let text: string;
      try {
        // 响应头与响应体都在同一个 AbortSignal / 超时窗口内读取，避免响应体无限挂起。
        const result = await this.once(url, upper, body, idempotencyKey, remaining);
        response = result.response;
        text = result.text;
      } catch (error) {
        const failure = this.networkError(error);
        if (readOnly && attempt < MAX_ATTEMPTS && this.now() < deadline) {
          await this.backoff(attempt, remaining, undefined);
          continue;
        }
        throw failure;
      }

      if (
        !response.ok &&
        readOnly &&
        RETRYABLE_STATUS.has(response.status) &&
        attempt < MAX_ATTEMPTS
      ) {
        await this.backoff(attempt, remaining, this.retryAfterMs(response));
        continue;
      }
      const payload = this.parse(text, response.status);
      if (!response.ok) {
        throw this.apiError(response.status, payload, response.headers.get('x-request-id') ?? '');
      }
      if (!isRecord(payload) || !('data' in payload) || !isRecord(payload.meta))
        throw new CliError('PROTOCOL_INVALID', '响应缺少 {data,meta}', {
          status: response.status,
        });
      const requestId = payload.meta.requestId;
      if (typeof requestId !== 'string' || !requestId)
        throw new CliError('PROTOCOL_INVALID', '响应 meta.requestId 缺失', {
          status: response.status,
        });
      return { data: payload.data as T, requestId };
    }
  }

  private async once(
    url: string,
    method: string,
    body: string | undefined,
    idempotencyKey: string | undefined,
    remaining: number,
  ): Promise<{ response: Response; text: string }> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...DEVICE_HEADERS,
    };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;

    const controller = new AbortController();
    const timeout = Math.min(this.attemptTimeoutMs, Math.max(1, remaining));
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      // 在超时窗口内读完响应体；AbortError 仍按 NETWORK_TIMEOUT 处理。
      const text = await response.text();
      return { response, text };
    } finally {
      clearTimeout(timer);
    }
  }

  private networkError(error: unknown): CliError {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return aborted
      ? new CliError('NETWORK_TIMEOUT', '请求超时，未获得可确认结果', { exitCode: 7 })
      : new CliError('NETWORK_UNAVAILABLE', '网络不可达，数据新鲜度未知（stale/unavailable）', {
          exitCode: 7,
        });
  }

  private parse(text: string, status: number): unknown {
    if (!text) {
      throw new CliError('PROTOCOL_INVALID', '响应正文为空', { status });
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new CliError('PROTOCOL_INVALID', '响应不是合法 JSON', { status });
    }
  }

  private apiError(status: number, payload: unknown, headerRequestId: string): CliError {
    if (isRecord(payload) && isRecord(payload.error)) {
      const envelope = payload as unknown as ApiError;
      const code = typeof envelope.error.code === 'string' ? envelope.error.code : 'SERVER_ERROR';
      const message =
        typeof envelope.error.message === 'string' ? envelope.error.message : '请求失败';
      const requestId =
        typeof envelope.error.requestId === 'string' ? envelope.error.requestId : headerRequestId;
      return new CliError(code, message, {
        status,
        details: isRecord(envelope.error.details) ? envelope.error.details : undefined,
        requestId: requestId || undefined,
      });
    }
    return new CliError('PROTOCOL_INVALID', `HTTP ${status} 未返回错误 envelope`, { status });
  }

  private retryAfterMs(response: Response): number | undefined {
    const header = response.headers.get('retry-after');
    if (!header) return undefined;
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    return Number.isNaN(date) ? undefined : Math.max(0, date - this.now());
  }

  private async backoff(attempt: number, remaining: number, retryAfter?: number): Promise<void> {
    const exponential = Math.min(2000, 250 * 2 ** (attempt - 1));
    const wait = Math.min(retryAfter ?? exponential + Math.floor(this.random() * 100), remaining);
    if (wait > 0) await this.sleep(wait);
  }

  /**
   * 匿名消费一次性接入码（不携带 bearer；码本身是唯一凭证）。
   * 响应只解析项目与精确已发布 revision，不授予任何额外权限。
   */
  async consumeEnrollmentCode(code: string): Promise<V1Response<EnrolledProject>> {
    const response = await this.request<unknown>('POST', '/workspace-enrollments/consume', {
      body: { code },
      idempotent: false,
    });
    return { data: parseConsumedEnrollment(response.data), requestId: response.requestId };
  }

  /**
   * 读取精确已发布 revision（绝不回退到“当前 revision”）。
   * digest 由服务端对 payload 规范化计算；这里同时做本地重算校验。
   */
  async getWorkspaceDefinitionRevision(
    projectId: string,
    revisionId: string,
  ): Promise<WorkspaceRevisionResponse> {
    const response = await this.request<unknown>(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/workspace-definition/revisions/${encodeURIComponent(revisionId)}`,
    );
    const parsed = await parseWorkspaceRevision(response.data);
    return {
      revision: parsed.revision,
      digestMatchesPayload: parsed.digestMatchesPayload,
      payloadPresent: parsed.payloadPresent,
      requestId: response.requestId,
    };
  }

  /** 读取当前已发布定义（只读；NOT_CONFIGURED 是展示状态，不是可接入 revision）。 */
  async getWorkspaceDefinition(projectId: string): Promise<WorkspaceDefinitionResponse> {
    const response = await this.request<unknown>(
      'GET',
      `/projects/${encodeURIComponent(projectId)}/workspace-definition`,
    );
    const parsed = await parseCurrentWorkspaceDefinition(response.data);
    return {
      definitionStatus: parsed.definitionStatus,
      projectId: parsed.projectId,
      revision: parsed.revision,
      digestMatchesPayload: parsed.digestMatchesPayload,
      requestId: response.requestId,
    };
  }
}

export type WorkspaceRevisionResponse = {
  revision: ResolvedWorkspaceDefinition;
  /** payload 在响应中显式给出时，本地 sha256(canonicalJson(payload)) 是否等于 digest。 */
  digestMatchesPayload: boolean;
  payloadPresent: boolean;
  requestId: string;
};

export type WorkspaceDefinitionResponse = {
  definitionStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
  projectId: string;
  revision: ResolvedWorkspaceDefinition | null;
  digestMatchesPayload: boolean;
  requestId: string;
};

export type WorkspaceRevisionPayload = WorkspaceDefinitionPayload;
