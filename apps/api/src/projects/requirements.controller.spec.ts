import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { V1Request } from '../auth/v1-auth.guard';
import type { RequirementsService } from './requirements.service';
import { RequirementsController } from './requirements.controller';

describe('requirement list HTTP query', () => {
  it('passes search, stage, cursor and limit to the authorized list service', () => {
    const service = { list: vi.fn() };
    const controller = new RequirementsController(service as unknown as RequirementsService);
    const request = {
      v1Principal: { kind: 'HUMAN', userId: 'u1', scopes: [] },
    } as unknown as V1Request;
    const query = { q: 'checkout', phase: 'DELIVERY', cursor: 'bound-cursor', limit: 12 };
    controller.list(request, 'p1', query);
    expect(service.list).toHaveBeenCalledWith(request.v1Principal, 'p1', query);
    expect(() => controller.list({} as V1Request, 'p1', query)).toThrow('AUTH_REQUIRED');
  });

  it('validates the real route DTO and permits the scoped opaque cursor', async () => {
    const types = Reflect.getMetadata(
      'design:paramtypes',
      RequirementsController.prototype,
      'list',
    );
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'query' as const, metatype: types[2] };
    expect(
      await pipe.transform(
        { q: 'checkout', phase: 'DELIVERY', cursor: 'x'.repeat(200), limit: '12' },
        metadata,
      ),
    ).toMatchObject({ limit: 12, phase: 'DELIVERY' });
    for (const value of [
      { q: ['array'] },
      { q: 'x'.repeat(501) },
      { phase: 'x'.repeat(33) },
      { cursor: 'x'.repeat(2049) },
      { limit: '0' },
      { limit: '1.5' },
    ]) {
      await expect(pipe.transform(value, metadata)).rejects.toMatchObject({ status: 400 });
    }
  });
});
