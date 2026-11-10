import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { PrismaService } from '../prisma/prisma.service';
import { V1BoardPrismaRepository } from './v1-board.prisma-repository';
import {
  boardSearchPattern,
  decodeBoardCursor,
  encodeBoardCursor,
  normalizeBoardQuery,
} from './v1-board.pagination';
import { V1_BOARD_COLUMNS } from './v1-board.repository';

const projectId = '00000000-0000-0000-0000-000000000099';
const ids = [1, 2, 3].map(
  (number) => '00000000-0000-0000-0000-' + String(number).padStart(12, '0'),
);
function task(id: string) {
  return {
    id,
    projectId,
    generation: 2,
    stepKey: 'build',
    roleId: 'role-1',
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentArtifactSetId: null,
    role: { key: 'dev', title: '开发' },
    responsibleUser: { email: 'responsible@example.test' },
    instance: {
      definitionRevisionId: 'revision-1',
      requirement: { id: 'req-1', code: 'AA-001', title: '需求' },
    },
  };
}
function harness(replies: unknown[]) {
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn(async () => replies.shift()),
    task: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map(task),
      ),
    },
    workflowRevision: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'revision-1',
          definition: { steps: [{ key: 'build', displayName: '绑定修订名称' }] },
        },
      ]),
    },
  };
  const prisma = { $transaction: vi.fn(async (work) => work(tx)) };
  return {
    tx,
    prisma,
    repository: new V1BoardPrismaRepository(prisma as unknown as PrismaService),
  };
}
const count = [{ total: 50n, matchedTotal: 40n, requirementTotal: 3n, key: 'BACKLOG', count: 40n }];
describe('Board bounded PostgreSQL projection', () => {
  it('returns exact full counts while enriching only per-column page IDs in one read snapshot', async () => {
    const { repository, tx, prisma } = harness([
      count,
      ids.map((id) => ({ id, generation: 2, columnKey: 'BACKLOG' })),
      [],
    ]);
    const query = normalizeBoardQuery({ limit: 2 });
    const result = await repository.snapshot(projectId, query);
    expect(result.summary).toEqual({
      total: 50,
      matchedTotal: 40,
      requirementTotal: 3,
      columns: V1_BOARD_COLUMNS.map((key) => ({ key, total: key === 'BACKLOG' ? 40 : 0 })),
    });
    expect(result.columns[0].cards.map((card) => card.taskId)).toEqual(ids.slice(0, 2));
    expect(result.columns[0].cards.every((card) => card.stepDisplayName === '绑定修订名称')).toBe(
      true,
    );
    expect(
      decodeBoardCursor(
        projectId,
        { ...query, cursor: result.columns[0].nextCursor },
        'column:BACKLOG',
      ),
    ).toEqual({ id: ids[1], generation: 2 });
    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId, id: { in: ids.slice(0, 2) } }, take: 2 }),
    );
    expect(tx.workflowRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['revision-1'] }, projectId }, take: 2 }),
    );
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
    expect(tx.$executeRaw.mock.calls[0][0][0]).toBe('SET TRANSACTION READ ONLY');
    const summarySql = (tx.$queryRaw.mock.calls[0] as unknown as [Prisma.Sql])[0];
    expect(summarySql.text).toContain('WHEN t."currentArtifactSetId" IS NOT NULL THEN');
    expect(summarySql.text.indexOf('currentArtifactSetId')).toBeLessThan(
      summarySql.text.indexOf('currentClaimId'),
    );
    expect(summarySql.text).not.toContain('retiredAt');
    expect(summarySql.text).not.toContain('TaskClaim');
    const pageSql = (tx.$queryRaw.mock.calls[1] as unknown as [Prisma.Sql])[0];
    expect(pageSql.text).toContain('PARTITION BY "columnKey"');
    expect(pageSql.values).toContain(3);
  });
  it('uses stable generation/id values rather than a cursor row lookup and parameterizes literal search', async () => {
    const { repository, tx } = harness([[{ total: 40n }], [{ id: ids[2], generation: 1 }], []]);
    const query = normalizeBoardQuery({
      limit: 2,
      q: "50%_\\' OR 1=1 --",
      roleTitle: '开发',
      requirementCode: 'AA-001',
    });
    query.cursor = encodeBoardCursor(projectId, query, 'column:BACKLOG', {
      generation: 2,
      id: ids[1],
    });
    const result = await repository.column(projectId, 'BACKLOG', query);
    expect(result.total).toBe(40);
    expect(result.nextCursor).toBeNull();
    expect(result.cards[0].taskId).toBe(ids[2]);
    const sql = (tx.$queryRaw.mock.calls[1] as unknown as [Prisma.Sql])[0];
    expect(sql.values).toContain(boardSearchPattern(query.q));
    expect(sql.values).toContain(ids[1]);
    expect(sql.text).toContain('"generation" <');
    expect(sql.text).toContain('"id" >');
    expect(sql.text).toContain("ESCAPE '\\'");
    expect(sql.text).not.toContain('OR 1=1');
    expect(sql.text).toContain('LIMIT 1');
  });
  it('keeps the unfiltered total and skips task enrichment for zero matches', async () => {
    const { repository, tx } = harness([[], [{ total: 50n }], []]);
    const result = await repository.snapshot(projectId, normalizeBoardQuery({ q: 'missing' }));
    expect(result.summary.total).toBe(50);
    expect(result.summary.matchedTotal).toBe(0);
    expect(
      result.columns.every(
        (column) => column.total === 0 && column.cards.length === 0 && column.nextCursor === null,
      ),
    ).toBe(true);
    expect(tx.task.findMany).not.toHaveBeenCalled();
    expect(tx.workflowRevision.findMany).not.toHaveBeenCalled();
  });
  it('paginates globally aggregated requirements and bounds role previews without enriching task cards', async () => {
    const group = (code: string, score: bigint) => ({
      code,
      title: code,
      total: 30n,
      score,
      ...Object.fromEntries(V1_BOARD_COLUMNS.map((key) => [key, key === 'ACTIVE' ? 30n : 0n])),
    });
    const roles = Array.from({ length: 11 }, (_, index) => ({
      code: 'AA-001',
      value: 'role-' + String(index).padStart(2, '0'),
      total: 30n,
    }));
    const { repository, tx } = harness([
      count,
      [group('AA-001', 30n), group('AA-002', 20n)],
      roles,
    ]);
    const query = normalizeBoardQuery({ limit: 1, q: 'active' });
    const result = await repository.requirements(projectId, query);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      code: 'AA-001',
      total: 30,
      counts: { ACTIVE: 30 },
      roleTotal: 30,
    });
    expect(result.items[0].roles).toHaveLength(10);
    expect(
      decodeBoardCursor(projectId, { ...query, cursor: result.nextCursor }, 'requirements'),
    ).toEqual({ score: 30, code: 'AA-001' });
    const roleQuery = {
      ...query,
      requirementCode: 'AA-001',
      cursor: result.items[0].rolesNextCursor,
    };
    expect(decodeBoardCursor(projectId, roleQuery, 'filters:roles')).toEqual({ value: 'role-09' });
    const sql = (tx.$queryRaw.mock.calls[1] as unknown as [Prisma.Sql])[0];
    expect(sql.text).toContain('ORDER BY score DESC, code COLLATE "C" ASC LIMIT');
    expect(sql.text).toContain("= 'BLOCKED') * 10");
    const roleSql = (tx.$queryRaw.mock.calls[2] as unknown as [Prisma.Sql])[0];
    expect(roleSql.text).toContain('PARTITION BY code');
    expect(roleSql.values).toContain(11);
    expect(tx.task.findMany).not.toHaveBeenCalled();
  });
  it('paginates distinct facets using the same complete matching set and literal option search', async () => {
    const { repository, tx } = harness([
      [{ total: 30n }],
      [
        { value: 'a', label: 'a' },
        { value: 'b', label: 'b' },
      ],
    ]);
    const query = normalizeBoardQuery({ limit: 1, search: '50%_' });
    const result = await repository.filters(projectId, 'roles', query);
    expect(result.items).toEqual([{ value: 'a', label: 'a' }]);
    expect(result.total).toBe(30);
    expect(
      decodeBoardCursor(projectId, { ...query, cursor: result.nextCursor }, 'filters:roles'),
    ).toEqual({ value: 'a' });
    const sql = (tx.$queryRaw.mock.calls[1] as unknown as [Prisma.Sql])[0];
    expect(sql.values).toContain(boardSearchPattern('50%_'));
    expect(sql.text).toContain('GROUP BY "roleTitle"');
    expect(sql.text).toContain('ORDER BY value COLLATE "C" ASC LIMIT');
  });
});
