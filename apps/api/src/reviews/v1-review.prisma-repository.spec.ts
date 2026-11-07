import { describe, expect, it, vi } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { V1ConfirmationRepository } from '../auth/v1-confirmation';
import type { V1IdempotencyRepository } from '../common/v1-idempotency';
import { V1ReviewPrismaRepository } from './v1-review.prisma-repository';
import { V1ReviewService } from './v1-review.service';
import type { V1ReviewListQuery } from './v1-review.repository';

const principal: Principal = { kind: 'HUMAN', userId: 'user-1', scopes: [] };
const definitions = [
  { id: 'revision-old', definition: { steps: [{ key: 'build', displayName: '旧流程名称' }] } },
  { id: 'revision-new', definition: { steps: [{ key: 'build', displayName: '新流程名称' }] } },
  { id: 'revision-legacy', definition: { steps: [{ key: 'build' }] } },
];
function review(id: string, revisionId: string | null) {
  return {
    id,
    projectId: 'project-1',
    kind: 'TASK_ACCEPTANCE',
    status: 'OPEN',
    version: 1,
    subjectDigest: 'a'.repeat(64),
    documentRevisionId: null,
    artifactSetId: `set-${id}`,
    taskId: `task-${id}`,
    approvalSlots: [],
    decisions: [],
    documentRevision: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    task: {
      stepKey: 'build',
      role: { id: 'role-1', key: 'dev', title: '开发' },
      instance: {
        definitionRevisionId: revisionId,
        requirement: { id: 'req-1', code: 'R-1', title: '需求' },
      },
    },
  };
}
const query: V1ReviewListQuery = {
  projectId: 'project-1',
  userId: 'user-1',
  principalKind: 'HUMAN',
  agentRoleId: null,
  activeRoleIds: [],
  knowledgeReadAllowed: true,
  assignedToMe: false,
  status: null,
  limit: 20,
  cursor: null,
};
function harness() {
  const rows = [
    review('old', 'revision-old'),
    review('new', 'revision-new'),
    review('legacy', 'revision-legacy'),
    review('unbound', null),
  ];
  const prisma = {
    reviewRequest: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((row) => row.id === where.id) ?? null,
      ),
      findMany: vi.fn().mockResolvedValue(rows),
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
  return { prisma, repository: new V1ReviewPrismaRepository(prisma as unknown as PrismaService) };
}
describe('V1ReviewPrismaRepository step-name projection', () => {
  it('resolves review detail from its task bound revision with a project filter', async () => {
    const { repository, prisma } = harness();
    for (const [id, expected] of [
      ['old', '旧流程名称'],
      ['new', '新流程名称'],
      ['legacy', null],
      ['unbound', null],
    ] as const) {
      const result = await repository.findReview(id);
      expect(result?.stepDisplayName).toBe(expected);
      expect(result?.subjectLabel).toBe('build');
    }
    expect(prisma.workflowRevision.findFirst.mock.calls.map(([args]) => args.where)).toEqual([
      { id: 'revision-old', projectId: 'project-1' },
      { id: 'revision-new', projectId: 'project-1' },
      { id: 'revision-legacy', projectId: 'project-1' },
    ]);
    expect(await repository.findReview('missing')).toBeNull();
  });
  it('projects list names from each bound revision and keeps SQL project filtering', async () => {
    const { repository, prisma } = harness();
    expect((await repository.listReviews(query)).items.map((row) => row.stepDisplayName)).toEqual([
      '旧流程名称',
      '新流程名称',
      null,
      null,
    ]);
    expect(prisma.reviewRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'project-1' }) }),
    );
    expect(prisma.workflowRevision.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['revision-old', 'revision-new', 'revision-legacy'] },
        projectId: 'project-1',
      },
      select: { id: true, definition: true },
    });
  });
  it('does not return a named review or read the list when project authorization rejects', async () => {
    const { repository, prisma } = harness();
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
    const service = new V1ReviewService(
      repository,
      authorization,
      {} as V1ConfirmationRepository,
      {} as V1IdempotencyRepository,
    );
    await expect(service.getReview(principal, 'old')).rejects.toBe(denied);
    await expect(service.listReviews(principal, { projectId: 'project-1' })).rejects.toBe(denied);
    expect(prisma.reviewRequest.findMany).not.toHaveBeenCalled();
  });
});
