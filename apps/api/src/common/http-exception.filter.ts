import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { Request, Response } from 'express';
import { MAX_JSON_BODY_BYTES, PAYLOAD_TOO_LARGE_MESSAGE } from './strict-json.interceptor';
import { requestIdOf } from './request-context.middleware';

/**
 * body-parser 在 Nest 拦截器之前就抛出 413（PayloadTooLargeError / `entity.too.large`）。
 * Nest 11 的 routes-resolver 注册了 express error layer，会把它交给本全局 @Catch() 过滤器
 * （所以在 main.ts 里改 body-parser limit 后，超限响应仍然由这里决定形状）。
 * 但它既不是 HttpException 也不是 WorkmeshError，若不显式映射会落到 500 INTERNAL_ERROR，
 * 与 05 §2 的错误信封和 05 §1 的 413 PAYLOAD_TOO_LARGE 契约都不一致。
 */
function isBodyParserPayloadTooLarge(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { type?: unknown; name?: unknown };
  return candidate.type === 'entity.too.large' || candidate.name === 'PayloadTooLargeError';
}

/**
 * body-parser/raw-body 会把实际生效的 limit 挂在错误对象上（见 raw-body 的 `entity.too.large`）。
 * JSON 解析器的 limit 就是 main.ts 传入的 MAX_JSON_BODY_BYTES；其它解析器（urlencoded 仍为默认
 * 100kb）则如实报告各自的 limit，避免信封里的 details 误导调用方。取不到时回退到同源常量。
 */
function bodyParserLimitOf(error: unknown): number {
  const limit = (error as { limit?: unknown }).limit;
  return typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0
    ? limit
    : MAX_JSON_BODY_BYTES;
}

/**
 * Prisma 把非法 UUID/数值传给强类型列时抛 `P2023`（inconsistent column data，PG 侧为 22P02）。
 * 那是**客户端传错参数**，不是服务端故障：`/projects/not-a-uuid` 之类应当 400，
 * 否则每个拼错 URL 的调用都会变成一条 500 并污染错误率。仍然记一条 warn，避免掩盖
 * 内部代码把坏值传进查询的真实 bug。
 */
function isPrismaInvalidInput(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === 'PrismaClientKnownRequestError' && candidate.code === 'P2023';
}

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
    let warned = false;

    if (error instanceof WorkmeshError) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if (isBodyParserPayloadTooLarge(error)) {
      // 超限发生在任何路由/拦截器之前，错的是传输层而不是业务；仍按 05 §2 信封返回。
      status = 413;
      code = V1_ERROR_CODES.PAYLOAD_TOO_LARGE;
      message = PAYLOAD_TOO_LARGE_MESSAGE;
      details = { limitBytes: bodyParserLimitOf(error) };
    } else if (isPrismaInvalidInput(error)) {
      status = 400;
      code = V1_ERROR_CODES.INVALID_REQUEST;
      message = '请求参数格式不正确';
      details = { reason: 'INVALID_COLUMN_DATA' };
      warned = true;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      const body = error.getResponse();
      const rawMessage =
        typeof body === 'string'
          ? body
          : typeof body === 'object' && body !== null && 'message' in body
            ? (body as { message?: unknown }).message
            : undefined;
      message = Array.isArray(rawMessage)
        ? rawMessage.join('; ')
        : String(rawMessage ?? '请求失败');
      code = status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_REJECTED';
    }

    if (status >= 500) {
      const line = `${request?.method ?? 'UNKNOWN'} ${request?.path ?? 'UNKNOWN'} returned ${status} [${code}]: ${message}`;
      if (error instanceof WorkmeshError) {
        // 已映射错误（如就绪探针 503）只记一行：堆栈对语义明确的错误没有定位价值，
        // 且探针被轮询时会刷屏。未映射异常仍必须留堆栈。
        this.logger.error(line);
      } else {
        // 未映射异常必须留堆栈：只记一行 message 会让 500 无法定位（A3 首跑就撞上过）。
        this.logger.error(line, error instanceof Error ? error.stack : String(error));
      }
    } else if (warned) {
      // 已降级为 4xx 的 Prisma 输入错误：不值得报警，但要留痕以便发现内部把坏值传进查询。
      const column = (error as { meta?: { columnName?: unknown } }).meta?.columnName;
      this.logger.warn(
        `${request?.method ?? 'UNKNOWN'} ${request?.path ?? 'UNKNOWN'} returned ${status} [${code}]: ${message}${
          typeof column === 'string' ? ` (column ${column})` : ''
        }`,
      );
    }
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
