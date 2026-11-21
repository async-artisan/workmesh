import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import {
  V1DocumentSummaryController,
  V1DocumentSummaryEmptyQueryDto,
  V1DocumentSummaryQueryDto,
} from './v1-document-summary.controller';
import type { V1DocumentSummaryService } from './v1-document-summary.service';

const request = {
  v1Principal: { kind: 'HUMAN', userId: 'reader', scopes: [] },
} as unknown as V1Request;

function harness() {
  const service = { list: vi.fn(), summary: vi.fn(), overview: vi.fn() };
  return {
    service,
    controller: new V1DocumentSummaryController(service as unknown as V1DocumentSummaryService),
  };
}

describe('additive document summary routes', () => {
  it('guards all three GET routes and forwards the exact principal, IDs and query', () => {
    expect(Reflect.getMetadata('path', V1DocumentSummaryController)).toBe('v1');
    expect(Reflect.getMetadata('__guards__', V1DocumentSummaryController)).toContain(V1AuthGuard);
    for (const [method, path] of [
      ['list', 'projects/:projectId/document-summaries'],
      ['summary', 'documents/:documentId/summary'],
      ['overview', 'projects/:projectId/document-summary-overview'],
    ] as const) {
      const handler = V1DocumentSummaryController.prototype[method];
      expect(Reflect.getMetadata('path', handler)).toBe(path);
      expect(Reflect.getMetadata('method', handler)).toBe(0);
    }
    const { controller, service } = harness();
    const query = {
      kind: 'PRD',
      knowledgeBaseKind: 'BUSINESS',
      requirementId: 'requirement',
      status: 'candidate',
      q: 'text',
      searchProfile: 'prd',
      limit: 7,
      cursor: 'cursor',
    };
    controller.list(request, 'project', query);
    controller.summary(request, 'document', {});
    controller.overview(request, 'project', {});
    expect(service.list).toHaveBeenCalledWith(request.v1Principal, 'project', query);
    expect(service.summary).toHaveBeenCalledWith(request.v1Principal, 'document');
    expect(service.overview).toHaveBeenCalledWith(request.v1Principal, 'project');
  });

  it('rejects missing authentication before dispatching each reader', () => {
    const { controller, service } = harness();
    for (const run of [
      () => controller.list({} as V1Request, 'project', {}),
      () => controller.summary({} as V1Request, 'document', {}),
      () => controller.overview({} as V1Request, 'project', {}),
    ])
      expect(run).toThrowError('AUTH_REQUIRED');
    expect(service.list).not.toHaveBeenCalled();
    expect(service.summary).not.toHaveBeenCalled();
    expect(service.overview).not.toHaveBeenCalled();
  });

  it('keeps the global unknown-field rejection and leaves known value validation to the service', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'query' as const, metatype: V1DocumentSummaryQueryDto };
    expect(
      await pipe.transform({ limit: '7', q: '%_ boundary', status: 'all', kind: 'PRD' }, metadata),
    ).toMatchObject({ limit: 7, q: '%_ boundary', status: 'all', kind: 'PRD' });
    expect((await pipe.transform({ limit: 'bad' }, metadata)).limit).toBeNaN();
    expect(await pipe.transform({ q: ['one', 'two'], limit: ['1', '2'] }, metadata)).toMatchObject({
      q: ['one', 'two'],
      limit: [1, 2],
    });
    await expect(pipe.transform({ unknown: 'x' }, metadata)).rejects.toMatchObject({ status: 400 });
    const empty = { type: 'query' as const, metatype: V1DocumentSummaryEmptyQueryDto };
    expect(await pipe.transform({}, empty)).toBeInstanceOf(V1DocumentSummaryEmptyQueryDto);
    for (const query of [
      { q: 'x' },
      { limit: '2' },
      { kind: 'PRD' },
      { status: 'all' },
      { cursor: 'cursor' },
    ])
      await expect(pipe.transform(query, empty)).rejects.toMatchObject({ status: 400 });
  });
});
