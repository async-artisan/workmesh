import { describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { V1ReadyPrismaRepository } from './v1-ready.prisma-repository';
import type { V1ReadyOwnership } from './v1-ready.repository';

type FindManyArgs = { where: Record<string, unknown>; take: number; include: unknown };

function repositoryWith(rows: unknown[]): {
  repository: V1ReadyPrismaRepository;
  args: () => FindManyArgs | null;
} {
  let captured: FindManyArgs | null = null;
  const prisma = {
    task: {
      findMany: async (args: FindManyArgs) => {
        captured = args;
        return rows;
      },
    },
  };
  return {
    repository: new V1ReadyPrismaRepository(prisma as unknown as PrismaService),
    args: () => captured,
  };
}

const OWNERSHIP: V1ReadyOwnership = { kind: 'ALL' };

describe('ready repository retired-instance filter', () => {
  it('excludes tasks from retired workflow instances in the SQL filter', async () => {
    const { repository, args } = repositoryWith([]);

    await repository.listCandidates({
      projectId: 'project-1',
      roleId: null,
      ownership: OWNERSHIP,
      after: null,
      take: 10,
    });

    const where = args()?.where ?? {};
    expect(where).toMatchObject({
      projectId: 'project-1',
      executionStatus: 'OPEN',
      currentClaimId: null,
      workStatus: 'ACTIVE',
      instance: { retiredAt: null },
    });
  });

  it('maps definition revision from the instance include and respects take+1', async () => {
    const rows = [
      {
        id: 'task-1',
        projectId: 'project-1',
        workflowInstanceId: 'instance-1',
        stepKey: 'impl',
        roleId: 'role-1',
        responsibleUserId: 'user-1',
        version: 2,
        generation: 3,
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
        currentClaimId: null,
        instance: { definitionRevisionId: 'revision-1' },
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        workflowInstanceId: 'instance-1',
        stepKey: 'review',
        roleId: 'role-1',
        responsibleUserId: 'user-1',
        version: 1,
        generation: 2,
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
        currentClaimId: null,
        instance: { definitionRevisionId: 'revision-1' },
      },
    ];
    const { repository, args } = repositoryWith(rows);

    const page = await repository.listCandidates({
      projectId: 'project-1',
      roleId: null,
      ownership: OWNERSHIP,
      after: null,
      take: 1,
    });

    expect(args()?.take).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.items[0]).toMatchObject({ id: 'task-1', definitionRevisionId: 'revision-1' });
  });
});
