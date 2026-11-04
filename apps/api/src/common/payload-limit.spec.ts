import type { ArgumentsHost, ExecutionContext } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { lastValueFrom, of, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { HttpExceptionFilter } from './http-exception.filter';
import {
  StrictJsonInterceptor,
  MAX_DOCUMENT_BODY_BYTES,
  MAX_JSON_BODY_BYTES,
  PAYLOAD_TOO_LARGE_MESSAGE,
  assertDocumentBodyWithinLimit,
  decodeDocumentBody,
  isCanonicalBase64,
} from './strict-json.interceptor';

function fakeResponse() {
  const response: Record<string, any> = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}

function fakeHost(request: Record<string, unknown>) {
  const response = fakeResponse();
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function payloadTooLargeErrorFromBodyParser() {
  return Object.assign(new Error('request entity too large'), {
    expose: true,
    status: 413,
    statusCode: 413,
    type: 'entity.too.large',
    name: 'PayloadTooLargeError',
  });
}

describe('HttpExceptionFilter: body-parser 超限映射', () => {
  it('把 entity.too.large 映射成 413 PAYLOAD_TOO_LARGE 统一信封', () => {
    const { host, response } = fakeHost({
      method: 'POST',
      path: '/api/v1/tasks/t/artifact-sets',
      requestId: 'req-1',
    });
    new HttpExceptionFilter().catch(payloadTooLargeErrorFromBodyParser(), host);

    expect(response.status).toHaveBeenCalledWith(413);
    const body = response.json.mock.calls[0][0] as { error: Record<string, unknown> };
    expect(body.error.code).toBe(V1_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    expect(body.error.details).toEqual({ limitBytes: MAX_JSON_BODY_BYTES });
    // 05 §2：错误信封必须带服务端 requestId，且与响应头一致。
    expect(body.error.requestId).toBe('req-1');
    expect(response.setHeader).toHaveBeenCalledWith('X-Request-Id', 'req-1');
  });

  it('details.limitBytes 优先采用 body-parser 实际挂载的 limit（取不到时才回退同源常量）', () => {
    const error = Object.assign(payloadTooLargeErrorFromBodyParser(), { limit: 100 * 1024 });
    const { host, response } = fakeHost({ method: 'POST', path: '/api/v1/x' });
    new HttpExceptionFilter().catch(error, host);
    const body = response.json.mock.calls[0][0] as { error: Record<string, unknown> };
    expect(body.error.details).toEqual({ limitBytes: 100 * 1024 });
  });

  it('只按 PayloadTooLargeError 名字也能识别（不同版本的 body-parser 暴露字段不同）', () => {
    const error = Object.assign(new Error('too large'), { name: 'PayloadTooLargeError' });
    const { host, response } = fakeHost({ method: 'POST', path: '/api/v1/x' });
    new HttpExceptionFilter().catch(error, host);
    expect(response.status).toHaveBeenCalledWith(413);
  });

  it('非超限错误仍保持既有映射（404 仍为 REQUEST_REJECTED，未知错误仍为 500）', () => {
    const notFound = fakeHost({ method: 'GET', path: '/api/v1/none' });
    new HttpExceptionFilter().catch(
      new NotFoundException('Cannot GET /api/v1/none'),
      notFound.host,
    );
    expect(notFound.response.status).toHaveBeenCalledWith(404);
    const notFoundBody = notFound.response.json.mock.calls[0][0] as { error: { code: string } };
    expect(notFoundBody.error.code).toBe('REQUEST_REJECTED');

    const unknown = fakeHost({ method: 'GET', path: '/api/v1/boom' });
    new HttpExceptionFilter().catch(new Error('boom'), unknown.host);
    expect(unknown.response.status).toHaveBeenCalledWith(500);
    const unknownBody = unknown.response.json.mock.calls[0][0] as { error: { code: string } };
    expect(unknownBody.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('MAX_DOCUMENT_BODY_BYTES 校验（decodeDocumentBody / assertDocumentBodyWithinLimit）', () => {
  it('恰好 10MiB 的解码正文通过，且返回原始字节', () => {
    const bytes = Buffer.alloc(MAX_DOCUMENT_BODY_BYTES, 0x61);
    const decoded = decodeDocumentBody(bytes.toString('base64'));
    expect(decoded.byteLength).toBe(MAX_DOCUMENT_BODY_BYTES);
    expect(decoded[0]).toBe(0x61);
  });

  it('多 1 字节即 413 PAYLOAD_TOO_LARGE，details 指出上限与字段', () => {
    const bytes = Buffer.alloc(MAX_DOCUMENT_BODY_BYTES + 1, 0x61);
    let caught: unknown;
    try {
      decodeDocumentBody(bytes.toString('base64'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkmeshError);
    const workmeshError = caught as WorkmeshError;
    expect(workmeshError.status).toBe(413);
    expect(workmeshError.code).toBe(V1_ERROR_CODES.PAYLOAD_TOO_LARGE);
    expect(workmeshError.message).toBe(PAYLOAD_TOO_LARGE_MESSAGE);
    expect(workmeshError.details).toEqual({
      limitBytes: MAX_DOCUMENT_BODY_BYTES,
      field: 'bodyBase64',
      byteLength: MAX_DOCUMENT_BODY_BYTES + 1,
    });
  });

  it('总和控制用同一个校验函数：HOSTED 总字节超过上限同样 413', () => {
    assertDocumentBodyWithinLimit(MAX_DOCUMENT_BODY_BYTES, 'hostedTotalBytes');
    expect(() =>
      assertDocumentBodyWithinLimit(MAX_DOCUMENT_BODY_BYTES + 1, 'hostedTotalBytes'),
    ).toThrow(WorkmeshError);
  });
});

describe('isCanonicalBase64（替代嵌套量词正则的线性校验）', () => {
  it('接受规范形式、拒绝长度/填充/字符集非法的形式', () => {
    for (const valid of ['', 'AA==', 'AAA=', 'AAAA', 'YWJjZA==', 'YWJjZGU=']) {
      expect(isCanonicalBase64(valid), valid).toBe(true);
    }
    for (const invalid of ['A', 'AAA', 'A===', '=AAA', 'AAAA=', 'AB$A', 'AAAA\n', 123, null]) {
      expect(isCanonicalBase64(invalid), String(invalid)).toBe(false);
    }
  });

  it('10MiB+ 的大串不会像原正则那样抛 RangeError', () => {
    // 原正则 ^(?:[A-Za-z0-9+/]{4})*...$ 在 ~8MB 以上会 RangeError（V8 回溯爆栈）。
    const huge = Buffer.alloc(MAX_DOCUMENT_BODY_BYTES + 1, 0x61).toString('base64');
    expect(huge.length).toBeGreaterThan(8 * 1024 * 1024);
    expect(() => isCanonicalBase64(huge)).not.toThrow();
    expect(isCanonicalBase64(huge)).toBe(true);
  });
});

describe('StrictJsonInterceptor: 原始字节上限复查', () => {
  function contextOf(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('未超限的合法 JSON 放行到处理器', async () => {
    const interceptor = new StrictJsonInterceptor();
    const request = {
      method: 'POST',
      url: '/api/v1/tasks/t/artifact-sets',
      rawBody: Buffer.from('{"a":1}', 'utf8'),
    };
    const next = { handle: () => of({ ok: true }) };
    await expect(lastValueFrom(interceptor.intercept(contextOf(request), next))).resolves.toEqual({
      ok: true,
    });
  });

  it('rawBody 超过 MAX_JSON_BODY_BYTES 时给出 413 PAYLOAD_TOO_LARGE', async () => {
    const interceptor = new StrictJsonInterceptor();
    const request = {
      method: 'POST',
      url: '/api/v1/tasks/t/artifact-sets',
      rawBody: Buffer.alloc(MAX_JSON_BODY_BYTES + 1, 0x20),
    };
    const next = { handle: () => of({ ok: true }) };
    await expect(
      firstValueFrom(interceptor.intercept(contextOf(request), next)),
    ).rejects.toMatchObject({
      status: 413,
      code: V1_ERROR_CODES.PAYLOAD_TOO_LARGE,
    });
  });
});
