import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { RequirementsService } from './requirements.service';
import { decodeRequirementCursor, normalizeRequirementQuery } from './requirements.pagination';

const principal = {
  kind: 'HUMAN',
  userId: 'u-1',
  sessionId: 's-1',
  authVersion: 1,
  scopes: [],
} as unknown as Principal;

function createHarness() {
  const prisma = {
    requirement: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    documentRevision: { findUnique: vi.fn() },
    task: { findMany: vi.fn() },
    artifact: { findMany: vi.fn() },
    artifactSet: { findMany: vi.fn().mockResolvedValue([]) },
    contextSnapshot: { findMany: vi.fn().mockResolvedValue([]) },
    codeReviewEvidence: { findMany: vi.fn().mockResolvedValue([]) },
    projectRepository: { findMany: vi.fn().mockResolvedValue([]) },
    knowledgeDocument: { findMany: vi.fn().mockResolvedValue([]) },
    reviewRequest: { findMany: vi.fn() },
    changeEvent: { findMany: vi.fn(), create: vi.fn() },
    changeRecipient: { createMany: vi.fn() },
    workflowInstance: { findMany: vi.fn() },
    workflowRevision: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  // 事务直接复用同一个假客户端：这些用例断言的是“调用了什么”，不是隔离性。
  prisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    callback(prisma),
  );
  const authorization = {
    resolveProjectContext: vi
      .fn()
      .mockResolvedValue({ project: { id: 'p1', archivedAt: null }, activeRoleIds: [] }),
    requireScope: vi.fn(),
    resolveKnowledgeAccess: vi.fn().mockResolvedValue({
      projectId: 'p1',
      canRead: true,
      isActiveMember: true,
      canPropose: true,
      canPublish: true,
    }),
  };
  const service = new RequirementsService(
    prisma as unknown as PrismaService,
    authorization as unknown as V1AuthorizationService,
  );
  return { service, prisma, authorization };
}

describe('RequirementsService.list', () => {
  const row = (seq: number) => ({
    id: `req-${seq}`,
    projectId: 'p1',
    seq,
    code: `DEMO-${seq}`,
    title: `匹配需求 ${seq}`,
    description: null,
    version: 1,
    generation: 1,
    phase: 'DELIVERY',
    workStatus: 'ACTIVE',
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
  });

  it('searches all project records before pagination and counts the same filter without cursor', async () => {
    const { service, prisma, authorization } = createHarness();
    prisma.requirement.count.mockResolvedValue(74);
    prisma.requirement.findMany.mockResolvedValue([row(81), row(85), row(90)]);
    const query = { limit: 2, q: '  需求50%_\\Doc  ', phase: 'delivery' };
    const first = await service.list(principal, 'p1', query);
    expect(first.items.map((item) => item.seq)).toEqual([81, 85]);
    expect(first.total).toBe(74);
    expect(
      decodeRequirementCursor('p1', {
        ...normalizeRequirementQuery(query),
        cursor: first.nextCursor,
      }),
    ).toBe(85);
    const expectedWhere = {
      projectId: 'p1',
      phase: 'DELIVERY',
      OR: [
        { code: { contains: '需求50\\%\\_\\\\doc', mode: 'insensitive' } },
        { title: { contains: '需求50\\%\\_\\\\doc', mode: 'insensitive' } },
        { description: { contains: '需求50\\%\\_\\\\doc', mode: 'insensitive' } },
      ],
    };
    expect(prisma.requirement.findMany).toHaveBeenLastCalledWith({
      where: expectedWhere,
      orderBy: { seq: 'asc' },
      take: 3,
    });
    expect(prisma.requirement.count).toHaveBeenLastCalledWith({ where: expectedWhere });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(authorization.requireScope).toHaveBeenCalledWith(principal, 'p1', 'requirement:read');

    prisma.requirement.findMany.mockResolvedValue([row(90)]);
    const second = await service.list(principal, 'p1', { ...query, cursor: first.nextCursor });
    expect(prisma.requirement.findMany).toHaveBeenLastCalledWith({
      where: { ...expectedWhere, seq: { gt: 85 } },
      orderBy: { seq: 'asc' },
      take: 3,
    });
    expect(prisma.requirement.count).toHaveBeenLastCalledWith({ where: expectedWhere });
    expect(second.nextCursor).toBeNull();
    expect(second.total).toBe(74);
  });

  it('does not query records when permission is denied or cursor belongs to another search', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockRejectedValueOnce(new Error('PROJECT_NOT_FOUND'));
    await expect(service.list(principal, 'p1', {})).rejects.toThrow('PROJECT_NOT_FOUND');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    await expect(service.list(principal, 'p1', { q: 'filtered', cursor: '50' })).rejects.toThrow(
      'REQUIREMENT_CURSOR_INVALID',
    );
    expect(prisma.requirement.findMany).not.toHaveBeenCalled();
    expect(prisma.requirement.count).not.toHaveBeenCalled();
  });
});

describe('RequirementsService.detail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('按每个任务的绑定修订投影名称，并保留旧定义的空值回退', async () => {
    const { service, prisma } = createHarness();
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req-1',
      projectId: 'p1',
      seq: 1,
      code: 'R-1',
      title: '需求',
      description: null,
      version: 1,
      generation: 1,
      phase: 'DELIVERY',
      workStatus: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const rows = ['old', 'new', 'legacy'].map((suffix) => ({
      id: `task-${suffix}`,
      stepKey: 'build',
      version: 1,
      generation: 1,
      role: { key: 'dev', title: '开发' },
      responsibleUser: { id: 'u1', email: 'u@example.test' },
      instance: { id: `instance-${suffix}`, definitionRevisionId: `revision-${suffix}` },
    }));
    prisma.task.findMany.mockResolvedValue(rows);
    prisma.workflowRevision.findMany.mockResolvedValue([
      { id: 'revision-old', definition: { steps: [{ key: 'build', displayName: '旧流程任务' }] } },
      { id: 'revision-new', definition: { steps: [{ key: 'build', displayName: '新流程任务' }] } },
      { id: 'revision-legacy', definition: { steps: [{ key: 'build' }] } },
    ]);
    prisma.artifact.findMany.mockResolvedValue([]);
    prisma.reviewRequest.findMany.mockResolvedValue(
      rows.map((task) => ({
        id: `review-${task.id}`,
        kind: 'TASK_ACCEPTANCE',
        status: 'OPEN',
        taskId: task.id,
        task: { stepKey: task.stepKey },
        createdAt: new Date(),
        approvalSlots: [],
        decisions: [],
      })),
    );
    prisma.changeEvent.findMany.mockResolvedValue([]);
    const result = await service.detail(principal, 'p1', 'R-1');
    expect(result.tasks.map((row) => row.stepDisplayName)).toEqual([
      '旧流程任务',
      '新流程任务',
      null,
    ]);
    expect(result.reviews.map((row) => row.stepDisplayName)).toEqual([
      '旧流程任务',
      '新流程任务',
      null,
    ]);
    expect(prisma.workflowRevision.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['revision-old', 'revision-new', 'revision-legacy'] }, projectId: 'p1' },
      select: { id: true, definition: true },
    });
    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'p1', instance: { requirementId: 'req-1' } },
      }),
    );
  });

  it('项目权限拒绝时不查询需求、任务和修订名称', async () => {
    const { service, prisma, authorization } = createHarness();
    const denied = new Error('PROJECT_NOT_FOUND');
    authorization.resolveProjectContext.mockRejectedValue(denied);
    await expect(service.detail(principal, 'p1', 'R-1')).rejects.toBe(denied);
    expect(prisma.requirement.findFirst).not.toHaveBeenCalled();
    expect(prisma.task.findMany).not.toHaveBeenCalled();
    expect(prisma.workflowRevision.findMany).not.toHaveBeenCalled();
  });

  it('hides unreadable document reviews and precise change targets rather than exposing project-member-only history', async () => {
    const { service, prisma, authorization } = createHarness();
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req',
      projectId: 'p1',
      generation: 3,
      currentPrdRevisionId: 'secret-revision',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      {
        id: 'secret-document',
        knowledgeBaseId: 'kb',
        kind: 'PRD',
        archivedAt: null,
        currentPublishedRevisionId: 'secret-revision',
        revisions: [
          {
            id: 'secret-revision',
            createdById: 'someone',
            title: 'secret-title',
            publications: [],
          },
        ],
      },
    ]);
    prisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: 'secret-review',
        documentRevisionId: 'secret-revision',
        documentRevision: { documentId: 'secret-document' },
        decisions: [],
        approvalSlots: [],
      },
    ]);
    prisma.changeEvent.findMany.mockResolvedValue([
      {
        id: 'secret-change',
        targets: { documentId: 'secret-document', documentRevisionId: 'secret-revision' },
      },
    ]);
    authorization.resolveKnowledgeAccess.mockResolvedValue({ projectId: 'p1', canRead: false });
    const result = await service.detail(principal, 'p1', 'REQ-1');
    expect(result).toMatchObject({
      reviews: [],
      changes: [],
      acceptanceKeys: [],
      trustChain: { status: 'UNAVAILABLE', visibility: 'PARTIAL' },
    });
    expect(JSON.stringify(result)).not.toContain('secret-');
  });

  it('does not show unassigned candidate review history to a reader with only KB READ', async () => {
    const { service, prisma, authorization } = createHarness();
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req',
      projectId: 'p1',
      generation: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      {
        id: 'doc',
        knowledgeBaseId: 'kb',
        kind: 'PRD',
        archivedAt: null,
        currentPublishedRevisionId: null,
        revisions: [
          { id: 'candidate', createdById: 'someone', title: 'private draft', publications: [] },
        ],
      },
    ]);
    prisma.reviewRequest.findMany.mockResolvedValue([
      {
        id: 'review',
        documentRevisionId: 'candidate',
        decisions: [],
        approvalSlots: [{ id: 'slot', requiredUserId: 'someone' }],
      },
    ]);
    prisma.changeEvent.findMany.mockResolvedValue([]);
    authorization.resolveKnowledgeAccess.mockResolvedValue({
      projectId: 'p1',
      isActiveMember: true,
      canRead: true,
      canPropose: false,
      canPublish: false,
    });
    const result = await service.detail(principal, 'p1', 'REQ-1');
    expect(result.reviews).toEqual([]);
    expect(result.trustChain.visibility).toBe('PARTIAL');
    expect(JSON.stringify(result)).not.toContain('private draft');
    expect(JSON.stringify(result)).not.toContain('candidate');
  });

  it('preserves infrastructure failures and rechecks a document grant after assembling the read model', async () => {
    const { service, prisma, authorization } = createHarness();
    prisma.requirement.findFirst.mockResolvedValue({
      id: 'req',
      projectId: 'p1',
      generation: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    prisma.task.findMany.mockResolvedValue([]);
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      {
        id: 'doc',
        knowledgeBaseId: 'kb',
        kind: 'PRD',
        archivedAt: null,
        currentPublishedRevisionId: null,
        revisions: [],
      },
    ]);
    prisma.reviewRequest.findMany.mockResolvedValue([]);
    prisma.changeEvent.findMany.mockResolvedValue([]);
    authorization.resolveKnowledgeAccess.mockRejectedValueOnce(new Error('database timeout'));
    await expect(service.detail(principal, 'p1', 'REQ-1')).rejects.toThrow('database timeout');
    authorization.resolveKnowledgeAccess
      .mockResolvedValueOnce({ projectId: 'p1', canRead: true })
      .mockResolvedValueOnce({ projectId: 'p1', canRead: false });
    await expect(service.detail(principal, 'p1', 'REQ-1')).rejects.toMatchObject({ status: 404 });
  });

  it('按人类编号解析需求并返回任务、工件、评审与决定人', async () => {
    const { service, prisma, authorization } = createHarness();
    authorization.resolveProjectContext.mockResolvedValue({
      project: { id: 'p1', archivedAt: null },
      activeRoleIds: [],
    });
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
        taskGeneration: 1,
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
    prisma.knowledgeDocument.findMany.mockResolvedValue([
      {
        id: 'doc-prd',
        kind: 'PRD',
        knowledgeBaseId: 'kb',
        archivedAt: null,
        currentPublishedRevisionId: 'rev-9',
        revisions: [
          {
            id: 'rev-9',
            seq: 9,
            title: 'PRD',
            sha256: 'a'.repeat(64),
            basisUnderstandingRevisionId: undefined,
            acceptance: [{ key: 'A1', text: '可导出' }, { key: 'A2' }, { text: '缺 key 的条目' }],
            publications: [
              {
                id: 'pub-9',
                kind: 'PUBLISH',
                revisionId: 'rev-9',
                reviewRequestId: null,
                createdAt: new Date(),
              },
            ],
          },
        ],
      },
    ]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.reviewRequest.findMany.mockResolvedValue([]);
    prisma.changeEvent.findMany.mockResolvedValue([]);

    const result = await service.detail(principal, 'p1', 'DEMO-002');

    expect(prisma.documentRevision.findUnique).not.toHaveBeenCalled();
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
