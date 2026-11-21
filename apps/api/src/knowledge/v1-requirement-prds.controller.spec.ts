import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import {
  V1RequirementPrdsController,
  V1RequirementPrdsQueryDto,
} from './v1-requirement-prds.controller';
import type { V1RequirementPrdsService } from './v1-requirement-prds.service';

const request = {
  v1Principal: { kind: 'HUMAN', userId: 'reader', scopes: [] },
} as unknown as V1Request;

function harness() {
  const service = { list: vi.fn() };
  const controller = new V1RequirementPrdsController(
    service as unknown as V1RequirementPrdsService,
  );
  return { service, controller };
}

describe('requirement published PRDs route contract', () => {
  it('guards the additive GET route and dispatches exact project and requirement IDs', () => {
    expect(Reflect.getMetadata('path', V1RequirementPrdsController)).toBe(
      'v1/projects/:projectId/requirements/:requirementId',
    );
    expect(Reflect.getMetadata('__guards__', V1RequirementPrdsController)).toContain(V1AuthGuard);
    const handler = V1RequirementPrdsController.prototype.list;
    expect(Reflect.getMetadata('path', handler)).toBe('published-prds');
    expect(Reflect.getMetadata('method', handler)).toBe(0);
    const { controller, service } = harness();
    controller.list(request, 'project-1', 'requirement-1', {});
    expect(service.list).toHaveBeenCalledWith(request.v1Principal, 'project-1', 'requirement-1');
  });

  it('rejects missing authentication before dispatch', () => {
    const { controller, service } = harness();
    expect(() => controller.list({} as V1Request, 'project-1', 'requirement-1', {})).toThrowError(
      'AUTH_REQUIRED',
    );
    expect(service.list).not.toHaveBeenCalled();
  });

  it('accepts an empty query and rejects every pagination, search and unrelated query field', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'query' as const, metatype: V1RequirementPrdsQueryDto };
    expect(await pipe.transform({}, metadata)).toBeInstanceOf(V1RequirementPrdsQueryDto);
    for (const query of [{ limit: '2' }, { cursor: 'abc' }, { q: 'private' }, { unrelated: 'x' }])
      await expect(pipe.transform(query, metadata)).rejects.toMatchObject({ status: 400 });
  });
});
