import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type V1RequestContext = Request & { requestId: string };

/**
 * requestId 由服务端为每次请求生成 UUID，并在成功与失败链路共享。
 * 不信任客户端自定义的 X-Request-Id：它只会被忽略，不进入审计身份。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const id = randomUUID();
    (request as V1RequestContext).requestId = id;
    response.setHeader('X-Request-Id', id);
    response.setHeader('Cache-Control', 'no-store');
    next();
  }
}

export function requestIdOf(request: Request | undefined): string {
  const existing = (request as V1RequestContext | undefined)?.requestId;
  return typeof existing === 'string' && existing ? existing : randomUUID();
}
