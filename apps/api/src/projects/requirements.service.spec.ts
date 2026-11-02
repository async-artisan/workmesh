import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { RequirementsService } from './requirements.service';

const principal = {
  kind: 'HUMAN',
  userId: 'u-1',
  sessionId: 's-1',
  authVersion: 1,
  scopes: [],
} as unknown as Principal;

function createHarness() {
  const prisma = {
    requirement: { findFirst: vi.fn(), updateMany: vi.fn() },
    task: { findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
    reviewRequest: { findMany: vi.fn() },
    changeEvent: { findMany: vi.fn() },
  };
  const authorization = { resolveProjectContext: vi.fn(), requireScope: vi.fn() };
  const service = new RequirementsService(
    prisma as unknown as PrismaService,
    authorization as unknown as V1AuthorizationService,
  );
  return { service, prisma, authorization };
}

describe('RequirementsService.detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按人类编号解析需求并返回任务、工件、评审与决定人', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ projectId: 'p1' });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req-1',
      projectId: 'p1',
      seq: 1,
      code: 'DEMO-001',
      title: '登录页改版',
      description: '支持记住登录状态。',
      version: 3,
      generation: 1,
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    prisma.task.findMany.mockResolvedValue([
      {
        id: 'task-1',
        stepKey: 'backend-impl',
        roleId: 'role-backend',
        responsibleUserId: 'u-2',
        version: 2,
        generation: 1,
        executionStatus: 'REVIEW_PENDING',
        workStatus: 'ACTIVE',
        currentClaimId: 'claim-1',
        currentArtifactSetId: 'set-1',
        role: { key: 'backend', title: '后端' },
        responsibleUser: { id: 'u-2', email: 'bob@example.com' },
        instance: { id: 'inst-1' },
      },
    ]);
    prisma.artifact.findMany.mockResolvedValue([
      {
        id: 'artifact-1',
        taskId: 'task-1',
        kind: 'IMPL',
        storage: 'HOSTED',
        mediaType: 'text/markdown',
        byteLength: 128,
        sha256: 'a'.repeat(64),
        commitSha: null,
        repoPath: 'src/auth/login.ts',
        summary: '登录实现',
        checks: [],
        createdAt: new Date('2026-11-02T00:00:00.000Z'),
      },
    ]);
    prisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: 'review-1',
        kind: 'TASK_ACCEPTANCE',
        status: 'OPEN',
        version: 2,
        subjectDigest: 'b'.repeat(64),
        documentRevisionId: null,
        artifactSetId: 'set-1',
        taskId: 'task-1',
        createdAt: new Date('2026-11-02T00:00:00.000Z'),
        documentRevision: null,
        task: { stepKey: 'backend-impl' },
        approvalSlots: [
          {
            id: 'slot-1',
            slotKey: 'backend',
            requiredUserId: 'u-2',
            requiredRoleId: 'role-backend',
          },
        ],
        decisions: [
          {
            id: 'dec-1',
            approvalSlotId: 'slot-1',
            decision: 'APPROVE',
            comment: '通过',
            createdAt: new Date('2026-11-02T01:00:00.000Z'),
            createdByStamp: { user: { id: 'u-2', email: 'bob@example.com' } },
          },
        ],
      },
    ]);
    prisma.changeEvent.findMany.mockResolvedValue([]);

    const result = await service.detail(principal, 'p1', 'DEMO-001');

    expect(prisma.requirement.findFirst).toHaveBeenCalledWith({
      where: { projectId: 'p1', code: 'DEMO-001' },
    });
    expect(result.requirement.code).toBe('DEMO-001');
    expect(result.tasks[0]).toMatchObject({
      stepKey: 'backend-impl',
      role: { key: 'backend', title: '后端' },
      artifactCount: 1,
      review: { id: 'review-1', status: 'OPEN' },
    });
    expect(result.reviews[0].subjectLabel).toBe('backend-impl');
    expect(result.reviews[0].decisions[0].actor).toEqual({
      id: 'u-2',
      email: 'bob@example.com',
    });
    expect(result.counts).toEqual({ tasks: 1, artifacts: 1, reviews: 1, changes: 0 });
  });

  it('按 expectedVersion 更新标题并返回新版本', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ project: { archivedAt: null } });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst
      .mockResolvedValueOnce({
        id: 'req-1',
        projectId: 'p1',
        seq: 1,
        code: 'DEMO-001',
        title: '旧标题',
        description: null,
        version: 2,
        generation: 1,
        phase: 'DISCOVERY',
        workStatus: 'ACTIVE',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'req-1',
        projectId: 'p1',
        seq: 1,
        code: 'DEMO-001',
        title: '新标题',
        description: '补充描述',
        version: 3,
        generation: 1,
        phase: 'DISCOVERY',
        workStatus: 'ACTIVE',
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        updatedAt: new Date('2026-11-02T00:00:00.000Z'),
      });
    prisma.requirement.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.update(principal, 'p1', 'req-1', {
      expectedVersion: 2,
      title: '新标题',
      description: '补充描述',
    });

    expect(prisma.requirement.updateMany).toHaveBeenCalledWith({
      where: { id: 'req-1', projectId: 'p1', version: 2 },
      data: { title: '新标题', description: '补充描述', version: { increment: 1 } },
    });
    expect(result).toMatchObject({ title: '新标题', version: 3 });
  });

  it('版本不匹配时返回 409，不写入', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ project: { archivedAt: null } });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req-1',
      projectId: 'p1',
      version: 5,
    });

    await expect(
      service.update(principal, 'p1', 'req-1', { expectedVersion: 2, title: '新标题' }),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      message: 'REQUIREMENT_VERSION_CONFLICT',
      status: 409,
    });
    expect(prisma.requirement.updateMany).not.toHaveBeenCalled();
  });

  it('找不到需求时返回 404 错误码', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ projectId: 'p1' });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst.mockResolvedValue(null);

    await expect(service.detail(principal, 'p1', 'DEMO-404')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      message: 'REQUIREMENT_NOT_FOUND',
      status: 404,
    });
  });
});
