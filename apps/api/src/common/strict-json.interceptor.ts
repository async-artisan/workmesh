import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { parseJsonStrict, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

/** 05 §1：JSON body 最大 16MiB；超过限制 413 PAYLOAD_TOO_LARGE。 */
export const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
/** 05 §1：最大嵌套深度 32；超过限制 400 INVALID_REQUEST。 */
export const MAX_JSON_DEPTH = 32;
/** 05 §5：文档与单件正文最多 10MiB 原始字节。 */
export const MAX_DOCUMENT_BODY_BYTES = 10 * 1024 * 1024;

type RawBodyRequest = {
  rawBody?: Buffer | string;
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
};

/**
 * 在 DTO 之前对原始请求字节做严格 JSON 校验：
 * 重复 key（含转义等价）、浮点数、非有限数字、非法 UTF-8、超深嵌套与尾部数据一律 400。
 * class-validator 不保证这些，不能只靠 ValidationPipe。
 */
@Injectable()
export class StrictJsonInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RawBodyRequest>();
    const method = (request?.method ?? 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();
    // 严格 JSON 仅作用于 v1 路由；legacy 路由不强制（避免影响既有浮点字段等契约）。
    const url = typeof request?.url === 'string' ? request.url : '';
    if (!url.includes('/api/v1/')) return next.handle();

    const raw = request?.rawBody;
    if (raw === undefined || raw === null) return next.handle();

    const bytes = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
    if (bytes.byteLength > MAX_JSON_BODY_BYTES)
      return throwError(
        () =>
          new WorkmeshError(
            V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
            'PAYLOAD_TOO_LARGE',
            { limitBytes: MAX_JSON_BODY_BYTES },
            413,
          ),
      );

    try {
      parseJsonStrict(new Uint8Array(bytes), MAX_JSON_DEPTH);
    } catch (error) {
      return throwError(
        () =>
          new WorkmeshError(
            V1_ERROR_CODES.INVALID_REQUEST,
            'MALFORMED_JSON_BODY',
            { reason: error instanceof Error ? error.message : String(error) },
            400,
          ),
      );
    }

    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error && typeof error === 'object' && 'type' in error) {
          const typed = error as { type?: string; status?: number };
          if (typed.type === 'entity.too.large')
            return throwError(
              () =>
                new WorkmeshError(
                  V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
                  'PAYLOAD_TOO_LARGE',
                  { limitBytes: MAX_JSON_BODY_BYTES },
                  413,
                ),
            );
        }
        return throwError(() => error);
      }),
    );
  }
}
