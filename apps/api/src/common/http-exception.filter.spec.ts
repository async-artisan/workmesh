import type { ArgumentsHost } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

function fakeResponse() {
  const response: Record<string, unknown> = {
    setHeader: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  (response.status as ReturnType<typeof vi.fn>).mockReturnValue(response);
  (response.json as ReturnType<typeof vi.fn>).mockReturnValue(response);
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

/** 形状取自 Prisma 的 PrismaClientKnownRequestError（P2023 = 列数据不合法）。 */
function prismaError(code: string) {
  return Object.assign(new Error(`Prisma error ${code}`), {
    name: 'PrismaClientKnownRequestError',
    code,
    meta: { columnName: 'projectId' },
  });
}

function bodyOf(response: Record<string, unknown>): { code: string; [key: string]: unknown } {
  const json = response.json as ReturnType<typeof vi.fn>;
  return json.mock.calls[0][0].error;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HttpExceptionFilter input-error mapping', () => {
  it('turns an invalid UUID reaching a typed column into 400, not 500', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = fakeHost({ method: 'GET', path: '/api/v1/projects/not-a-uuid' });

    new HttpExceptionFilter().catch(prismaError('P2023'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(bodyOf(response)).toMatchObject({
      code: 'INVALID_REQUEST',
      details: { reason: 'INVALID_COLUMN_DATA' },
    });
    // 降级为 4xx 但仍要留痕，否则「内部把坏值传进查询」的 bug 就看不见了。
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('leaves other Prisma errors as 500 so real failures still surface', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = fakeHost({ method: 'POST', path: '/api/v1/projects' });

    new HttpExceptionFilter().catch(prismaError('P2002'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(bodyOf(response)).toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('does not mistake an unrelated error carrying a code field for a Prisma error', () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { host, response } = fakeHost({ method: 'GET', path: '/api/v1/x' });

    new HttpExceptionFilter().catch(Object.assign(new Error('boom'), { code: 'P2023' }), host);

    expect(response.status).toHaveBeenCalledWith(500);
  });
});
