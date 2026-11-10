import { describe, expect, it, vi } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1BoardService } from './v1-board.service';
import { encodeBoardCursor, normalizeBoardQuery } from './v1-board.pagination';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { V1BoardRepository } from './v1-board.repository';

const principal: Principal = { kind: 'HUMAN', userId: 'user-1', scopes: [] };
function harness() {
  const repository = {
    snapshot: vi.fn(),
    column: vi.fn(),
    requirements: vi.fn(),
    filters: vi.fn(),
  };
  const authorization = { resolveProjectContext: vi.fn(), requireScope: vi.fn() };
  const service = new V1BoardService(
    repository as V1BoardRepository,
    authorization as unknown as V1AuthorizationService,
  );
  return { service, repository, authorization };
}
describe('bounded Board authorization and routing', () => {
  it('delegates normalized global filters and clamps page size without dropping task:read', async () => {
    const { service, repository, authorization } = harness();
    repository.snapshot.mockResolvedValue({ projectId: 'p1' });
    expect(
      await service.board(principal, 'p1', {
        q: '  HELLO  ',
        roleTitle: '研发',
        requirementCode: 'AA-001',
        limit: 999,
      }),
    ).toEqual({ projectId: 'p1' });
    expect(repository.snapshot).toHaveBeenCalledWith('p1', {
      q: 'hello',
      roleTitle: '研发',
      requirementCode: 'AA-001',
      limit: 100,
      cursor: null,
      search: '',
    });
    expect(authorization.resolveProjectContext).toHaveBeenCalledWith(principal, 'p1', 'read');
    expect(authorization.requireScope).toHaveBeenCalledWith(principal, 'p1', 'task:read');
  });
  it.each(['board', 'column', 'requirements', 'filters'] as const)(
    'authorizes %s before parsing cursors or reading any data',
    async (method) => {
      const { service, repository, authorization } = harness();
      const denied = new WorkmeshError(
        V1_ERROR_CODES.SCOPE_DENIED,
        'SCOPE_DENIED',
        { scope: 'task:read' },
        403,
      );
      authorization.requireScope.mockRejectedValue(denied);
      const query = { cursor: 'malformed' };
      const request =
        method === 'column'
          ? service.column(principal, 'p1', 'BACKLOG', query)
          : method === 'filters'
            ? service.filters(principal, 'p1', 'roles', query)
            : service[method](principal, 'p1', query);
      await expect(request).rejects.toBe(denied);
      for (const read of Object.values(repository)) expect(read).not.toHaveBeenCalled();
    },
  );
  it('rejects invalid column, facet kind, page limit and snapshot cursor', async () => {
    const { service, repository } = harness();
    await expect(service.column(principal, 'p1', 'UNKNOWN')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'BOARD_COLUMN_INVALID',
    });
    await expect(service.filters(principal, 'p1', 'UNKNOWN')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'BOARD_FILTER_KIND_INVALID',
    });
    await expect(service.requirements(principal, 'p1', { limit: 1.5 })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'BOARD_QUERY_INVALID',
    });
    await expect(service.board(principal, 'p1', { cursor: 'x' })).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'BOARD_CURSOR_REQUIRES_VIEW',
    });
    for (const read of Object.values(repository)) expect(read).not.toHaveBeenCalled();
  });
  it('rejects cross-project/filter/view cursors before repository access', async () => {
    const { service, repository } = harness();
    const query = normalizeBoardQuery({ q: 'search' });
    const cursor = encodeBoardCursor('p1', query, 'column:BACKLOG', {
      generation: 1,
      id: '00000000-0000-0000-0000-000000000001',
    });
    await expect(
      service.column(principal, 'p2', 'BACKLOG', { q: 'search', cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'BOARD_CURSOR_INVALID' });
    await expect(
      service.column(principal, 'p1', 'ACTIVE', { q: 'search', cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'BOARD_CURSOR_INVALID' });
    await expect(
      service.column(principal, 'p1', 'BACKLOG', { q: 'changed', cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'BOARD_CURSOR_INVALID' });
    await expect(
      service.requirements(principal, 'p1', { q: 'search', cursor }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST', message: 'BOARD_CURSOR_INVALID' });
    for (const read of Object.values(repository)) expect(read).not.toHaveBeenCalled();
  });
  it('routes all continuation views with their normalized query', async () => {
    const { service, repository } = harness();
    await service.column(principal, 'p1', 'CANCELLED');
    await service.requirements(principal, 'p1');
    await service.filters(principal, 'p1', 'roles', { search: '  DEV  ' });
    expect(repository.column).toHaveBeenCalledWith('p1', 'CANCELLED', normalizeBoardQuery({}));
    expect(repository.requirements).toHaveBeenCalledWith('p1', normalizeBoardQuery({}));
    expect(repository.filters).toHaveBeenCalledWith(
      'p1',
      'roles',
      normalizeBoardQuery({ search: 'dev' }, 50),
    );
  });
});
