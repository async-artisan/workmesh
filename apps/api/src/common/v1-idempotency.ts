import { createHash } from 'node:crypto';
import { canonicalJson, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

/** requestDigest 覆盖的内容排除 password、confirmation secret、CSRF、requestId 和 header key 本身。 */
const EXCLUDED_BODY_KEYS = new Set(['password', 'confirmation', 'csrfToken', 'requestId']);

export type V1OperationRecord = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
  resultRefs: Record<string, unknown>;
  committedAt: Date | null;
};

export interface V1IdempotencyRepository {
  findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null>;
}

export const V1_IDEMPOTENCY_REPOSITORY = Symbol('V1_IDEMPOTENCY_REPOSITORY');

export function normalizeRoute(route: string): string {
  const [path] = route.split('?');
  return path.replace(/\/+$/, '') || '/';
}

/**
 * 控制器交给摘要的是 ValidationPipe transform 之后的 DTO 实例，其原型不是 Object.prototype，
 * canonicalJson 会拒绝并让整条路由 500。这里先做纯 JSON 归一化：
 * 对已经是纯 JSON 的正文，归一化结果与直接 canonicalJson 完全等价，摘要值不变；
 * 只有原本必然抛错的 DTO 实例/Date/undefined 才被收敛为纯值。
 */
function toPlainJson(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

export function requestDigestOf(input: {
  method: string;
  route: string;
  body?: Record<string, unknown> | null;
}): string {
  const body = input.body ?? {};
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (EXCLUDED_BODY_KEYS.has(key)) continue;
    payload[key] = toPlainJson(value);
  }
  const canonical = canonicalJson({
    method: input.method.toUpperCase(),
    route: normalizeRoute(input.route),
    body: payload,
  });
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

/**
 * 合法重放：同 digest 返回原结果，不再验证首次 expectedVersion 或消费旧票据。
 * 同键异语义（含换 route）必须 409 IDEMPOTENCY_CONFLICT。
 */
export function assertReplayable(
  operation: V1OperationRecord,
  input: { method: string; route: string; digest: string },
): void {
  if (
    operation.method.toUpperCase() !== input.method.toUpperCase() ||
    normalizeRoute(operation.route) !== normalizeRoute(input.route)
  )
    throw new WorkmeshError(
      V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'IDEMPOTENCY_ROUTE_CONFLICT',
      { operationId: operation.id },
      409,
    );
  if (operation.requestDigest !== input.digest)
    throw new WorkmeshError(
      V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'IDEMPOTENCY_DIGEST_CONFLICT',
      { operationId: operation.id },
      409,
    );
}

/** RFC 4122 形态的 UUID。只校验形状，不限定版本位——客户端可能用 v7，服务端不需要限制。 */
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuidShaped(value: unknown): value is string {
  return typeof value === 'string' && UUID_SHAPE.test(value);
}

/**
 * Idempotency-Key 必须是 UUID。
 *
 * 原实现用 `/^[0-9a-fA-F-]{36}$/`，放行「36 个横线」这类根本不是 UUID 的字符串，
 * 随后它在写进 `@db.Uuid` 列时被 PostgreSQL 拒绝（22P02），把一个可纠正的输入错误
 * 变成 500。校验必须与列类型同源。
 */
export function requireIdempotencyKey(headerValue: string | undefined): string {
  if (!isUuidShaped(headerValue))
    throw new WorkmeshError(
      V1_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED,
      'IDEMPOTENCY_KEY_REQUIRED',
      undefined,
      400,
    );
  return headerValue;
}

export function requireExpectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new WorkmeshError(
      V1_ERROR_CODES.EXPECTED_VERSION_REQUIRED,
      'EXPECTED_VERSION_REQUIRED',
      undefined,
      400,
    );
  return value;
}
