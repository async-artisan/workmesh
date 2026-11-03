import type { Response } from 'express';
import {
  cookieNames,
  csrfCookieOptions,
  remainingSeconds,
  sessionCookieOptions,
  type CookieMode,
} from './v1-cookie-policy';
import type { V1CookiePayload } from './v1-account.service';

/** 登录/注册/接受邀请后统一写双值 Cookie；__Host- 前缀要求 Path=/ 且无 Domain。 */
export function setSessionCookies(
  response: Response,
  mode: CookieMode,
  cookies: V1CookiePayload,
): void {
  const names = cookieNames(mode);
  const maxAge = Math.max(1, remainingSeconds(cookies.expiresAt, new Date()));
  const sessionOptions = sessionCookieOptions(mode, maxAge);
  const csrfOptions = csrfCookieOptions(mode, maxAge);
  response.setHeader('Set-Cookie', [
    serializeCookie(names.session, cookies.sessionCookie, sessionOptions),
    serializeCookie(names.csrf, cookies.csrfCookie, csrfOptions),
  ]);
}

/** 删除同名 Cookie：SECURE 模式必须带 Secure，且 __Host- 前缀要求 Path=/、无 Domain。 */
export function serializeDeletionCookie(name: string, mode: CookieMode, httpOnly: boolean): string {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (mode === 'SECURE') parts.push('Secure');
  return parts.join('; ');
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.floor(options.maxAge / 1000)}`,
    `SameSite=Lax`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
