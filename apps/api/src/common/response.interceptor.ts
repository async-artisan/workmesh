import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { requestIdOf } from './request-context.middleware';

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = typeof context.switchToHttp === 'function' ? context.switchToHttp() : undefined;
    const request = http?.getRequest?.() as Request | undefined;
    const response = http?.getResponse?.() as Response | undefined;
    // 复用本请求服务端生成的 requestId，不采纳客户端自定义值。
    const requestId = requestIdOf(request);
    response?.setHeader?.('X-Request-Id', requestId);
    return next.handle().pipe(map((data) => ({ data, meta: { requestId } })));
  }
}
