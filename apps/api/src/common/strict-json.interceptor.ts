import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { registerDecorator, type ValidationOptions } from 'class-validator';
import { Observable, throwError } from 'rxjs';
import { parseJsonStrict, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

/** 05 §1：JSON body 最大 16MiB；超过限制 413 PAYLOAD_TOO_LARGE。 */
export const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;
/** 05 §1：最大嵌套深度 32；超过限制 400 INVALID_REQUEST。 */
export const MAX_JSON_DEPTH = 32;
/** 05 §5：文档与单件正文最多 10MiB 原始字节。 */
export const MAX_DOCUMENT_BODY_BYTES = 10 * 1024 * 1024;

/** 05 §2：message 供人读，脚本只依据 code；请求体超限的两条路径共用同一文案。 */
export const PAYLOAD_TOO_LARGE_MESSAGE = '请求体超过大小上限';

/** 05 §1/§5 的 413 唯一构造点：所有超限路径都用同一 code、message 与 details 形状。 */
function payloadTooLarge(limitBytes: number, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
    PAYLOAD_TOO_LARGE_MESSAGE,
    { limitBytes, ...details },
    413,
  );
}

/**
 * 05 §5：按解码后的原始字节数校验正文上限，Base64 约 4/3 膨胀不能绕过 10MiB。
 * 放在本文件而不是各业务文件：两个上限常量只在这里定义，调用方只 import 常量与校验函数。
 * 必须在真正解码的位置校验，因为 HTTP 层（body-parser）只看到 JSON 字符串长度，看不到解码后字节：
 * - knowledge/v1-publication.controller.ts：文档 create/propose 的 bodyBase64
 * - workflows/v1-role-package.controller.ts：角色包资源登记
 * - tasks/v1-artifact.service.ts：HOSTED 工件正文（单件），以及单次交付所有 HOSTED 字节总和
 */
export function assertDocumentBodyWithinLimit(byteLength: number, field: string): void {
  if (byteLength > MAX_DOCUMENT_BODY_BYTES)
    throw payloadTooLarge(MAX_DOCUMENT_BODY_BYTES, { field, byteLength });
}

/** base64 正文的解码入口：先解码再按原始字节校验，避免调用方漏掉 10MiB 检查。 */
export function decodeDocumentBody(bodyBase64: string): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(bodyBase64, 'base64'));
  assertDocumentBodyWithinLimit(bytes.byteLength, 'bodyBase64');
  return bytes;
}

/**
 * 规范 Base64 的线性校验（长度 4 的倍数、只在末尾有 0–2 个 `=`、其余仅限字母数字 + /）。
 * 不用正则 `^(?:[A-Za-z0-9+/]{4})*...`：V8 在 ~8MB 以上的字符串上会因嵌套量词回溯抛
 * RangeError（Maximum call stack size exceeded），使 10MiB 超限路径变成 500 而不是 413。
 */
export function isCanonicalBase64(value: unknown): boolean {
  if (typeof value !== 'string' || value.length % 4 !== 0) return false;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const end = value.length - padding;
  for (let index = 0; index < end; index += 1) {
    const code = value.charCodeAt(index);
    const isBase64Char =
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      (code >= 48 && code <= 57) || // 0-9
      code === 43 || // +
      code === 47; // /
    if (!isBase64Char) return false;
  }
  // 走到这里：长度是 4 的倍数、填充只在末尾且正文全是 Base64 字符（空串也合法）。
  return true;
}

/** DTO 用：与原先 `@Matches(BASE64)` 语义一致，但为线性扫描，不会因大正文爆栈。 */
export function IsCanonicalBase64Body(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyName) => {
    registerDecorator({
      name: 'isCanonicalBase64Body',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => isCanonicalBase64(value),
        defaultMessage: () => 'bodyBase64 必须是规范的 Base64 字符串',
      },
    });
  };
}

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
    // 生产路径上 body-parser 已按 main.ts 的 limit（同一个 MAX_JSON_BODY_BYTES）先行拒绝超限请求，
    // 这里保留同一上限的复查：拦截器也可被直接调用（测试/其它适配器），不能只靠中间件。
    if (bytes.byteLength > MAX_JSON_BODY_BYTES)
      return throwError(() => payloadTooLarge(MAX_JSON_BODY_BYTES, {}));

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

    // 原先这里还有一个 catchError 分支把 `entity.too.large` 转成 413；它从未可达：
    // body-parser 在拦截器执行之前就已决定解析成败并抛错（由 http-exception.filter.ts 统一映射），
    // 能进到这里说明正文已被成功解析。留着它会让后来者误以为这里覆盖了超限路径。
    return next.handle();
  }
}
