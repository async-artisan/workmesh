import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import {
  V1DocumentHistoryController,
  V1DocumentHistoryQueryDto,
} from './v1-document-history.controller';
import type { V1DocumentHistoryService } from './v1-document-history.service';

const request = {
  v1Principal: { kind: 'HUMAN', userId: 'reader', scopes: [] },
} as unknown as V1Request;
function harness() {
  const service = { list: vi.fn(), metadata: vi.fn() };
  const controller = new V1DocumentHistoryController(
    service as unknown as V1DocumentHistoryService,
  );
  return { service, controller };
}

describe('document history route contract', () => {
  it('guards the two additive GET routes and forwards the exact document/revision IDs', () => {
    expect(Reflect.getMetadata('path', V1DocumentHistoryController)).toBe(
      'v1/documents/:documentId',
    );
    expect(Reflect.getMetadata('__guards__', V1DocumentHistoryController)).toContain(V1AuthGuard);
    for (const [method, path] of [
      ['list', 'history'],
      ['metadata', 'revisions/:revisionId/metadata'],
    ] as const) {
      const handler = V1DocumentHistoryController.prototype[method];
      expect(Reflect.getMetadata('path', handler)).toBe(path);
      expect(Reflect.getMetadata('method', handler)).toBe(0);
    }
    const { controller, service } = harness();
    const query = { limit: 4, cursor: 'cursor' };
    controller.list(request, 'document-1', query);
    controller.metadata(request, 'document-1', 'revision-137');
    expect(service.list).toHaveBeenCalledWith(request.v1Principal, 'document-1', query);
    expect(service.metadata).toHaveBeenCalledWith(
      request.v1Principal,
      'document-1',
      'revision-137',
    );
  });

  it('rejects missing authentication before dispatching either reader', () => {
    const { controller, service } = harness();
    expect(() => controller.list({} as V1Request, 'document-1', {})).toThrowError('AUTH_REQUIRED');
    expect(() => controller.metadata({} as V1Request, 'document-1', 'revision-1')).toThrowError(
      'AUTH_REQUIRED',
    );
    expect(service.list).not.toHaveBeenCalled();
    expect(service.metadata).not.toHaveBeenCalled();
  });

  it('transforms limits for service validation and rejects unrelated query fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'query' as const, metatype: V1DocumentHistoryQueryDto };
    expect(await pipe.transform({ limit: '7', cursor: 'abc' }, metadata)).toMatchObject({
      limit: 7,
      cursor: 'abc',
    });
    expect(await pipe.transform({ limit: '999' }, metadata)).toMatchObject({ limit: 999 });
    expect((await pipe.transform({ limit: 'bad' }, metadata)).limit).toBeNaN();
    await expect(pipe.transform({ unrelated: 'field' }, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });
});
