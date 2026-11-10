import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { V1BoardController } from './v1-board.controller';
import type { V1BoardService } from './v1-board.service';
import type { V1Request } from '../auth/v1-auth.guard';

const projectId = '00000000-0000-0000-0000-000000000001';
const request = {
  v1Principal: { kind: 'HUMAN', userId: 'user-1', scopes: [] },
} as unknown as V1Request;
function harness() {
  const service = { board: vi.fn(), column: vi.fn(), requirements: vi.fn(), filters: vi.fn() };
  return { controller: new V1BoardController(service as unknown as V1BoardService), service };
}
describe('Board HTTP route/query contract', () => {
  it('registers all four GET routes without changing the existing board route', () => {
    for (const [method, path] of [
      ['getBoard', ':projectId/board'],
      ['getColumn', ':projectId/board/columns/:column'],
      ['getRequirements', ':projectId/board/requirements'],
      ['getFilters', ':projectId/board/filters/:kind'],
    ]) {
      const handler = V1BoardController.prototype[method as keyof V1BoardController];
      expect(Reflect.getMetadata('path', handler)).toBe(path);
      expect(Reflect.getMetadata('method', handler)).toBe(0);
    }
  });
  it('passes page and global filter query parameters to the service', () => {
    const { controller, service } = harness();
    const query = {
      q: 'literal%_',
      roleTitle: '研发',
      requirementCode: 'AA-001',
      limit: 7,
      cursor: 'cursor',
    };
    controller.getBoard(request, projectId, { limit: 7 });
    controller.getColumn(request, projectId, 'BACKLOG', query);
    controller.getRequirements(request, projectId, query);
    controller.getFilters(request, projectId, 'roles', { ...query, search: 'role' });
    expect(service.board).toHaveBeenCalledWith(request.v1Principal, projectId, { limit: 7 });
    expect(service.column).toHaveBeenCalledWith(request.v1Principal, projectId, 'BACKLOG', query);
    expect(service.requirements).toHaveBeenCalledWith(request.v1Principal, projectId, query);
    expect(service.filters).toHaveBeenCalledWith(request.v1Principal, projectId, 'roles', {
      ...query,
      search: 'role',
    });
  });
  it('rejects missing authentication and malformed project IDs for all views', () => {
    const { controller, service } = harness();
    const calls = (req: V1Request, project: string) => [
      () => controller.getBoard(req, project),
      () => controller.getColumn(req, project, 'BACKLOG', {}),
      () => controller.getRequirements(req, project, {}),
      () => controller.getFilters(req, project, 'roles', {}),
    ];
    for (const call of calls({} as V1Request, projectId))
      expect(call).toThrowError('AUTH_REQUIRED');
    for (const call of calls(request, 'invalid')) expect(call).toThrowError('PROJECT_ID_INVALID');
    for (const read of Object.values(service)) expect(read).not.toHaveBeenCalled();
  });
  it('transforms numeric page limits and validates query bounds with the actual route DTO', async () => {
    const types = Reflect.getMetadata('design:paramtypes', V1BoardController.prototype, 'getBoard');
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const metadata = { type: 'query' as const, metatype: types[2] };
    expect(
      await pipe.transform({ limit: '7', q: 'query', cursor: 'a'.repeat(1500) }, metadata),
    ).toMatchObject({ limit: 7, q: 'query' });
    for (const value of [
      { limit: '0' },
      { limit: '1.5' },
      { limit: 'bad' },
      { q: ['array'] },
      { q: 'x'.repeat(501) },
      { roleTitle: 'x'.repeat(81) },
      { requirementCode: 'x'.repeat(33) },
      { cursor: 'x'.repeat(2049) },
      { search: 'x'.repeat(201) },
    ]) {
      await expect(pipe.transform(value, metadata)).rejects.toMatchObject({ status: 400 });
    }
  });
});
