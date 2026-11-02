import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { WorkmeshError } from '@workmesh/shared';
import type { Request, Response } from 'express';
import { requestIdOf } from './request-context.middleware';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const http = typeof host.switchToHttp === 'function' ? host.switchToHttp() : undefined;
    const request = http?.getRequest?.() as Request | undefined;
    const response = http?.getResponse?.() as Response | undefined;
    const requestId = requestIdOf(request);

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = '服务器内部错误';
    let details: Record<string, unknown> | undefined;

    if (error instanceof WorkmeshError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      const rawMessage = typeof body === 'string' ? body : typeof body === 'object' && body !== null && 'message' in body ? (body as { message?: unknown }).message : undefined;
      message = Array.isArray(rawMessage) ? rawMessage.join('; ') : String(rawMessage ?? '请求失败');
      code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED';
    }

    if (status >= 500) this.logger.error(`${request?.method ?? 'UNKNOWN'} ${request?.path ?? 'UNKNOWN'} returned ${status}: ${message}`);
    response?.setHeader?.('X-Request-Id', requestId);
    response?.status?.(status).json({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId,
      },
    });
  }
}
