import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { containsForbiddenAgentScope, type Principal, type Scope } from '@workmesh/shared';

/**
 * 运行时主体沿用共享契约；`sessionId` 只是服务端内部溯源用的会话标识，
 * 不参与公开 Principal 契约，也不作为授权来源。
 */
export type V1Principal = Principal & { sessionId?: string; authVersion?: number };

export function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function equalSecret(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSecret(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function parseOpaqueSessionCookie(value: string): { sessionId: string; secret: string } | null {
  const match = /^wm_s1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { sessionId: match[1], secret: match[2] } : null;
}

export function validateOrigin(origin: string | undefined, publicOrigin: string): boolean {
  // Origin 必须完整精确匹配；缺失、null、额外端口或相似子域一律拒绝。
  return typeof origin === 'string' && origin.length > 0 && origin !== 'null' && origin === publicOrigin;
}

/**
 * CSRF 校验：header 与 cookie 必须相等，且对原值计算的摘要必须与本 WebSession 的
 * csrfTokenHash 常量时间匹配。仅两值相等不足以通过。
 */
export function validateCsrf(
  header: string | undefined,
  cookie: string | undefined,
  csrfTokenHash: string,
): boolean {
  if (typeof header !== 'string' || typeof cookie !== 'string') return false;
  if (header.length !== 43 || cookie.length !== 43) return false;
  if (header !== cookie) return false;
  return equalSecret(header, csrfTokenHash);
}

export function rejectSelfAssertedIdentity(body: Record<string, unknown>): void {
  const forbidden = ['actorType', 'kind', 'userId', 'roleIds', 'isAdmin', 'createdById', 'status'];
  const found = forbidden.filter((key) => key in body);
  if (found.length > 0) throw new Error(`self-asserted identity fields are not accepted: ${found.join(',')}`);
}

export function hasScope(principal: V1Principal, scope: Scope): boolean {
  return principal.kind === 'HUMAN' || principal.scopes.includes(scope);
}
