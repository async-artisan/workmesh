import { describe, expect, it, vi } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { V1IdempotencyRepository } from '../common/v1-idempotency';
import { V1BoardPrismaRepository } from './v1-board.prisma-repository';
import { V1BoardService } from './v1-board.service';
import { normalizeBoardQuery } from './v1-board.pagination';
import type { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1TaskPrismaRepository } from './v1-task.prisma-repository';
import { V1TaskService } from './v1-task.service';

const principal: Principal = { kind: 'HUMAN', userId: 'user-1', scopes: [] };
const definitions = [
  { id: 'revision-old', definition: { steps: [{ key: 'build', displayName: '旧修订名称' }] } },
  { id: 'revision-new', definition: { steps: [{ key: 'build', displayName: '新修订名称' }] } },
  { id: 'revision-legacy', definition: { steps: [{ key: 'build' }] } },
];
function task(id: string, revisionId: string | null) {
  return {
    id,
    projectId: 'project-1',
    workflowInstanceId: `instance-${id}`,
    stepKey: 'build',
    roleId: 'role-1',
    responsibleUserId: 'user-1',
    version: 1,
    generation: 1,
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentArtifactSetId: null,
    role: { key: 'dev', title: '开发' },
    responsibleUser: { email: 'user@example.test' },
    instance: {
      definitionRevisionId: revisionId,
      requirement: { id: 'req-1', code: 'R-1', title: '需求' },
    },
  };
}
function harness() {
  const tasks = [
    task('old', 'revision-old'),
    task('new', 'revision-new'),
    task('legacy', 'revision-legacy'),
    task('unbound', null),
  ];
  const prisma = {
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
      if (sql.text.includes('AS "matchedTotal"'))
        return [{ total: 4n, matchedTotal: 4n, requirementTotal: 1n, key: 'BACKLOG', count: 4n }];
      if (sql.text.includes('FROM ranked WHERE position'))
        return tasks.map((row) => ({
          id: row.id,
          generation: row.generation,
          columnKey: 'BACKLOG',
        }));
      return [];
    }),
    task: {
      findMany: vi.fn().mockResolvedValue(tasks),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          tasks.find((row) => row.id === where.id) ?? null,
      ),
    },
    taskClaim: { findMany: vi.fn().mockResolvedValue([]) },
    workflowInstance: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          tasks.find((row) => row.workflowInstanceId === where.id)?.instance ?? null,
      ),
    },
    workflowRevision: {
      findMany: vi.fn().mockResolvedValue(definitions),
      findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) =>
        where.projectId === 'project-1'
          ? (definitions.find((row) => row.id === where.id) ?? null)
          : null,
      ),
    },
  };
  prisma.$transaction.mockImplementation(async (work) => work(prisma));
  return {
    prisma,
    board: new V1BoardPrismaRepository(prisma as unknown as PrismaService),
    tasks: new V1TaskPrismaRepository(prisma as unknown as PrismaService),
  };
}
describe('task and board production step-name projection', () => {
  it('uses each board task bound revision within the requested project and keeps legacy fallback null', async () => {
    const { board, prisma } = harness();
    expect(
      (await board.snapshot('project-1', normalizeBoardQuery({}))).columns.flatMap((column) =>
        column.cards.map((row) => row.stepDisplayName),
      ),
    ).toEqual(['旧修订名称', '新修订名称', null, null]);
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1', id: { in: ['old', 'new', 'legacy', 'unbound'] } },
        take: 4,
      }),
    );
    expect(prisma.workflowRevision.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['revision-old', 'revision-new', 'revision-legacy'] },
        projectId: 'project-1',
      },
      select: { id: true, definition: true },
      take: 4,
    });
  });
  it('reads task names from bound revisions without querying a current/latest pointer', async () => {
    const { tasks, prisma } = harness();
    expect((await tasks.findTask('old'))?.stepDisplayName).toBe('旧修订名称');
    expect((await tasks.findTask('new'))?.stepDisplayName).toBe('新修订名称');
    expect((await tasks.findTask('legacy'))?.stepDisplayName).toBeNull();
    expect((await tasks.findTask('unbound'))?.stepDisplayName).toBeNull();
    expect(prisma.workflowRevision.findFirst.mock.calls.map(([args]) => args.where)).toEqual([
      { id: 'revision-old', projectId: 'project-1' },
      { id: 'revision-new', projectId: 'project-1' },
      { id: 'revision-legacy', projectId: 'project-1' },
    ]);
    expect(await tasks.findTask('missing')).toBeNull();
  });
  it('does not return named task or board data when project authorization rejects', async () => {
    const { board, tasks, prisma } = harness();
    const denied = new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'PROJECT_NOT_FOUND',
      {},
      404,
    );
    const authorization = {
      resolveProjectContext: vi.fn().mockRejectedValue(denied),
      requireScope: vi.fn(),
    } as unknown as V1AuthorizationService;
    await expect(
      new V1BoardService(board, authorization).board(principal, 'project-1'),
    ).rejects.toBe(denied);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    await expect(
      new V1TaskService(tasks, authorization, {} as V1IdempotencyRepository).getTask(
        principal,
        'old',
      ),
    ).rejects.toBe(denied);
  });
});
