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
    documentRevision: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
    reviewRequest: { findMany: vi.fn() },
    changeEvent: { findMany: vi.fn(), create: vi.fn() },
    changeRecipient: { createMany: vi.fn() },
    workflowInstance: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  // 事务直接复用同一个假客户端：这些用例断言的是“调用了什么”，不是隔离性。
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback(prisma),
  );
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
    expect(result.acceptanceKeys).toEqual([]);
  });

  it('把当前发布 PRD 的验收 key 一并返回，供流程实例分配', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ projectId: 'p1' });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req-2',
      projectId: 'p1',
      seq: 2,
      code: 'DEMO-002',
      title: '导出对账单',
      description: null,
      version: 1,
      generation: 2,
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      currentPrdRevisionId: 'rev-9',
      createdAt: new Date('2026-11-02T00:00:00.000Z'),
      updatedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    prisma.documentRevision.findUnique.mockResolvedValue({
      acceptance: [{ key: 'A1', text: '可导出' }, { key: 'A2' }, { text: '缺 key 的条目' }],
    });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.reviewRequest.findMany.mockResolvedValue([]);
    prisma.changeEvent.findMany.mockResolvedValue([]);

    const result = await service.detail(principal, 'p1', 'DEMO-002');

    expect(prisma.documentRevision.findUnique).toHaveBeenCalledWith({
      where: { id: 'rev-9' },
      select: { acceptance: true },
    });
    expect(result.acceptanceKeys).toEqual(['A1', 'A2']);
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
    prisma.workflowInstance.findMany.mockResolvedValue([]);

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
    // 该需求还没有流程实例时：只记录事件，不产生收件人。
    expect(prisma.changeEvent.create).not.toHaveBeenCalled();
  });

  it('需求内容变化时生成变更事件并通知受影响责任人（发起人除外）', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({ project: { archivedAt: null } });
    authorization.requireScope.mockResolvedValue(undefined);
    prisma.requirement.findFirst
      .mockResolvedValueOnce({ id: 'req-1', projectId: 'p1', version: 2, title: '旧标题' })
      .mockResolvedValueOnce({ id: 'req-1', projectId: 'p1', version: 3, title: '新标题' });
    prisma.requirement.updateMany.mockResolvedValue({ count: 1 });
    prisma.workflowInstance.findMany.mockResolvedValue([{ id: 'inst-1' }]);
    prisma.task.findMany.mockResolvedValue([
      { id: 'task-1', responsibleUserId: 'u-2', roleId: 'role-frontend' },
      { id: 'task-2', responsibleUserId: 'u-1', roleId: 'role-frontend' },
      { id: 'task-3', responsibleUserId: 'u-2', roleId: 'role-frontend' },
    ]);
    prisma.changeEvent.create.mockResolvedValue({ id: 'event-1' });

    await service.update(principal, 'p1', 'req-1', { expectedVersion: 2, title: '新标题' });

    expect(prisma.changeEvent.create).toHaveBeenCalledWith({
      data: {
        projectId: 'p1',
        requirementId: 'req-1',
        sourceKind: 'REQUIREMENT_UPDATE',
        sourceId: 'req-1',
        changedFields: ['title'],
        targets: { taskIds: ['task-1', 'task-2', 'task-3'] },
      },
      select: { id: true },
    });
    // 同一人同角色只通知一次，发起人 u-1 不收件。
    expect(prisma.changeRecipient.createMany).toHaveBeenCalledWith({
      data: [{ projectId: 'p1', eventId: 'event-1', userId: 'u-2', roleId: 'role-frontend' }],
    });
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
