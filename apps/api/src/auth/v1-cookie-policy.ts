export type CookieMode = 'SECURE' | 'LOCAL_INSECURE';

export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 60 * 1000;
export const ANONYMOUS_SESSION_TIMEOUT_MS = 10 * 60 * 1000;

export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'] as const;

/** 正式部署使用 __Host- 前缀；本地开发例外只能使用无前缀名，且仅限明确允许的 loopback。 */
export const COOKIE_NAMES: Record<CookieMode, { session: string; csrf: string }> = {
  SECURE: { session: '__Host-wm_session', csrf: '__Host-wm_csrf' },
  LOCAL_INSECURE: { session: 'wm_session', csrf: 'wm_csrf' },
};

export function resolveCookieMode(explicit?: string): CookieMode {
  return explicit === 'LOCAL_INSECURE' ? 'LOCAL_INSECURE' : 'SECURE';
}

export function cookieNames(mode: CookieMode): { session: string; csrf: string } {
  return COOKIE_NAMES[mode];
}

export function isLoopbackOrigin(publicOrigin: string): boolean {
  try {
    const url = new URL(publicOrigin);
    return (LOOPBACK_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * 部署配置校验：SECURE 必须 HTTPS；LOCAL_INSECURE 必须 HTTP 且 publicOrigin 为 loopback。
 * 不根据任意 Host、Origin 或 Forwarded header 自动关闭 Secure。
 */
export function assertCookieDeployment(mode: CookieMode, publicOrigin: string): void {
  let origin: URL;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw new Error('INVALID_PUBLIC_ORIGIN');
  }
  if (mode === 'SECURE') {
    if (origin.protocol !== 'https:') throw new Error('SECURE_REQUIRES_HTTPS');
    return;
  }
  if (origin.protocol !== 'http:') throw new Error('LOCAL_MODE_REQUIRES_HTTP');
  if (!isLoopbackOrigin(publicOrigin)) throw new Error('LOCAL_MODE_LOOPBACK_ONLY');
}

export function sessionCookieOptions(mode: CookieMode, maxAgeSeconds: number) {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds <= 0 || maxAgeSeconds > 28800)
    throw new Error('INVALID_MAX_AGE');
  return {
    httpOnly: true,
    secure: mode === 'SECURE',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds * 1000,
    // 不设置 Domain：__Host- 前缀要求无 Domain 且 Path=/。
    domain: undefined,
  };
}

export function csrfCookieOptions(mode: CookieMode, maxAgeSeconds: number) {
  return { ...sessionCookieOptions(mode, maxAgeSeconds), httpOnly: false };
}

/**
 * 活动会话只向后延长 idle 截止，且不得越过绝对有效期 expiresAt。
 */
export function nextIdleExpiry(input: {
  idleExpiresAt: Date;
  expiresAt: Date;
  now: Date;
  idleTimeoutMs: number;
}): Date {
  const extended = new Date(input.now.getTime() + input.idleTimeoutMs);
  const candidate = extended > input.idleExpiresAt ? extended : input.idleExpiresAt;
  return candidate > input.expiresAt ? input.expiresAt : candidate;
}

/** session Set-Cookie 的 Max-Age 使用绝对剩余秒数，服务端仍执行更短 idle 检查。 */
export function remainingSeconds(expiresAt: Date, now: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  return seconds > 0 ? Math.min(seconds, 28800) : 0;
}
