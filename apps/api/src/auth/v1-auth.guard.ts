import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { V1Principal } from './v1-policy';
import { cookieNames, resolveCookieMode } from './v1-cookie-policy';
import { V1AuthService } from './v1-auth.service';

export type V1Request = Request & { v1Principal?: V1Principal; requestId?: string };

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

@Injectable()
export class V1AuthGuard implements CanActivate {
  constructor(private readonly auth: V1AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<V1Request>();
    // 按已验证的 cookieMode 识别正式 __Host- 名称；本地不安全名称只在明确允许的 loopback 开发模式启用。
    const names = cookieNames(resolveCookieMode(process.env.WORKMESH_COOKIE_MODE));
    const principal = await this.auth.authenticate({
      authorization: request.headers.authorization,
      sessionCookie: cookieValue(request.headers.cookie, names.session),
      csrfCookie: cookieValue(request.headers.cookie, names.csrf),
      csrfHeader:
        typeof request.headers['x-csrf-token'] === 'string'
          ? request.headers['x-csrf-token']
          : undefined,
      method: request.method,
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
      publicOrigin: process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173',
      body:
        request.body && typeof request.body === 'object'
          ? (request.body as Record<string, unknown>)
          : undefined,
    });
    request.v1Principal = principal;
    return true;
  }
}
