import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import type { V1ReviewService } from '../reviews/v1-review.service';
import type { V1ChangeService } from '../tasks/v1-change.service';
import type { V1ReadyService } from '../tasks/v1-ready.service';
import { V1WorkbenchService } from './v1-workbench.service';

const principal = {
  kind: 'HUMAN',
  userId: 'u-1',
  sessionId: 's-1',
  authVersion: 1,
  scopes: [],
} as unknown as Principal;

function createHarness() {
  const prisma = {
    project: { findMany: vi.fn() },
    reviewRequest: { findMany: vi.fn() },
    documentRevision: { findMany: vi.fn() },
    workflowRevision: { findMany: vi.fn().mockResolvedValue([]) },
    task: { findMany: vi.fn() },
    artifactSet: { findMany: vi.fn() },
    projectRole: { findMany: vi.fn() },
    requirement: { findMany: vi.fn() },
    changeEvent: { findMany: vi.fn() },
    changeRecipient: { findMany: vi.fn() },
    approvalSlot: { findMany: vi.fn() },
  };
  const authorization = { resolveProjectContext: vi.fn() };
  const reviews = { listReviews: vi.fn() };
  const changes = { listRecipients: vi.fn() };
  const ready = { ready: vi.fn() };
  const service = new V1WorkbenchService(
    prisma as unknown as PrismaService,
    authorization as unknown as V1AuthorizationService,
    reviews as unknown as V1ReviewService,
    changes as unknown as V1ChangeService,
    ready as unknown as V1ReadyService,
  );
  return { service, prisma, authorization, reviews, changes, ready };
}

describe('V1WorkbenchService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds project fan-out and still reads all authorized projects after a partial failure', async () => {
    const { service, prisma, authorization, reviews, changes, ready } = createHarness();
    const projects = Array.from({ length: 9 }, (_, index) => ({
      id: `p${index}`,
      key: `P${index}`,
      name: `Project ${index}`,
    }));
    prisma.project.findMany.mockResolvedValue(projects);
    prisma.approvalSlot.findMany.mockResolvedValue([]);
    reviews.listReviews.mockImplementation(async (_principal, query) => {
      if (query.projectId === 'p2') throw new Error('PROJECT_REVIEW_UNAVAILABLE');
      return { items: [], nextCursor: null };
    });
    changes.listRecipients.mockResolvedValue({ items: [], nextCursor: null });
    ready.ready.mockImplementation(async (_principal, projectId: string) => ({
      items: [
        { id: `task-${projectId}`, stepKey: 'qa', executionStatus: 'PENDING', workStatus: 'IDLE' },
      ],
      nextCursor: null,
      hasMore: false,
    }));
    prisma.task.findMany.mockResolvedValue([]);

    const pending = new Map<string, () => void>();
    let inFlight = 0;
    let maximum = 0;
    authorization.resolveProjectContext.mockImplementation(
      (_principal, projectId: string) =>
        new Promise((resolve) => {
          inFlight++;
          maximum = Math.max(maximum, inFlight);
          pending.set(projectId, () => {
            inFlight--;
            resolve({ activeRoleIds: [] });
          });
        }),
    );

    const operation = service.get(principal, null);
    for (const expected of [4, 8, 9]) {
      await vi.waitFor(() =>
        expect(authorization.resolveProjectContext).toHaveBeenCalledTimes(expected),
      );
      const wave = [...pending.values()];
      pending.clear();
      wave.reverse().forEach((complete) => complete());
    }
    const result = await operation;

    expect(maximum).toBe(4);
    expect(inFlight).toBe(0);
    for (const project of projects) {
      expect(authorization.resolveProjectContext).toHaveBeenCalledWith(
        principal,
        project.id,
        'read',
      );
      expect(reviews.listReviews).toHaveBeenCalledWith(
        principal,
        expect.objectContaining({ projectId: project.id }),
      );
      expect(changes.listRecipients).toHaveBeenCalledWith(
        principal,
        expect.objectContaining({ projectId: project.id }),
      );
      expect(ready.ready).toHaveBeenCalledWith(principal, project.id, { limit: 50 });
    }
    expect(result.counts.total).toBe(9);
    expect(result.readyTasks.map((task) => task.projectId)).toEqual(
      projects.map((project) => project.id),
    );
    expect(result.warnings).toEqual(['P2：评审数据加载失败（PROJECT_REVIEW_UNAVAILABLE）']);
    expect(prisma.approvalSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: { in: projects.map((project) => project.id) },
        }),
      }),
    );
  });

  it('工作台任务和评审各自按绑定修订显示名称并限定项目', async () => {
    const { service, prisma, authorization, reviews, changes, ready } = createHarness();
    const requireTaskRead = vi.fn().mockResolvedValue(undefined);
    Object.assign(authorization, { requireScope: requireTaskRead });
    prisma.project.findMany.mockResolvedValue([{ id: 'p1', key: 'DEMO', name: 'Demo' }]);
    authorization.resolveProjectContext.mockResolvedValue({ activeRoleIds: [] });
    const tasks = ['old', 'new', 'legacy'].map((suffix) => ({
      id: `task-${suffix}`,
      stepKey: 'build',
      roleId: 'role-1',
      instance: {
        definitionRevisionId: `revision-${suffix}`,
        requirement: { code: 'R-1', title: '需求' },
      },
      role: { key: 'dev', title: '开发' },
    }));
    reviews.listReviews.mockResolvedValue({
      items: tasks.map((task) => ({
        id: `review-${task.id}`,
        taskId: task.id,
        documentRevisionId: null,
        artifactSetId: null,
        kind: 'TASK_ACCEPTANCE',
        status: 'OPEN',
        version: 1,
        slots: [],
        decisions: [],
      })),
      nextCursor: null,
    });
    changes.listRecipients.mockResolvedValue({ items: [], nextCursor: null });
    ready.ready.mockResolvedValue({
      items: tasks.map((task) => ({
        id: task.id,
        stepKey: task.stepKey,
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
      })),
      nextCursor: null,
      hasMore: false,
    });
    prisma.task.findMany.mockResolvedValue(tasks);
    prisma.workflowRevision.findMany.mockResolvedValue([
      { id: 'revision-old', definition: { steps: [{ key: 'build', displayName: '旧任务名称' }] } },
      { id: 'revision-new', definition: { steps: [{ key: 'build', displayName: '新任务名称' }] } },
      { id: 'revision-legacy', definition: { steps: [{ key: 'build' }] } },
    ]);
    prisma.reviewRequest.findMany.mockResolvedValue([]);
    prisma.projectRole.findMany.mockResolvedValue([]);
    prisma.approvalSlot.findMany.mockResolvedValue([]);
    const result = await service.get(principal, 'p1');
    expect(result.readyTasks.map((item) => item.stepDisplayName)).toEqual([
      '旧任务名称',
      '新任务名称',
      null,
    ]);
    expect(result.reviews.map((item) => item.stepDisplayName)).toEqual([
      '旧任务名称',
      '新任务名称',
      null,
    ]);
    expect(requireTaskRead).toHaveBeenCalledWith(principal, 'p1', 'task:read');
    // 任务名称、评审名称及完整依赖图各读取绑定修订，三次查询均须限定项目。
    expect(prisma.workflowRevision.findMany).toHaveBeenCalledTimes(3);
    for (const [args] of prisma.workflowRevision.findMany.mock.calls) {
      expect(args).toEqual({
        where: { id: { in: ['revision-old', 'revision-new', 'revision-legacy'] }, projectId: 'p1' },
        select: { id: true, definition: true },
      });
    }
  });

  it('工作台不会读取或返回非成员项目的任务名称', async () => {
    const { service, prisma, reviews, ready } = createHarness();
    prisma.project.findMany.mockResolvedValue([]);
    const result = await service.get(principal, 'hidden-project');
    expect(result.readyTasks).toEqual([]);
    expect(result.reviews).toEqual([]);
    expect(prisma.project.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          members: { some: { userId: principal.userId, revokedAt: null } },
          id: 'hidden-project',
        },
      }),
    );
    expect(prisma.workflowRevision.findMany).not.toHaveBeenCalled();
    expect(reviews.listReviews).not.toHaveBeenCalled();
    expect(ready.ready).not.toHaveBeenCalled();
  });

  it('聚合三类待办并补齐需求、角色与可签性', async () => {
    const { service, prisma, authorization, reviews, changes, ready } = createHarness();

    prisma.project.findMany.mockResolvedValue([{ id: 'p1', key: 'DEMO', name: 'Demo' }]);
    authorization.resolveProjectContext.mockResolvedValue({
      activeRoleIds: ['role-product'],
    });
    reviews.listReviews.mockResolvedValue({
      items: [
        {
          id: 'review-1',
          projectId: 'p1',
          kind: 'PRD_PUBLICATION',
          status: 'OPEN',
          version: 3,
          subjectDigest: 'a'.repeat(64),
          documentRevisionId: 'rev-1',
          artifactSetId: null,
          taskId: null,
          slots: [
            {
              id: 'slot-1',
              slotKey: 'product',
              kind: 'PRODUCT',
              requiredUserId: 'u-2',
              requiredRoleId: 'role-product',
              sourceSlotBindingId: null,
            },
          ],
          decisions: [],
          subject: null,
        },
      ],
      nextCursor: null,
    });
    changes.listRecipients.mockResolvedValue({
      items: [
        {
          id: 'c1',
          projectId: 'p1',
          eventId: 'evt-1',
          userId: 'u-1',
          roleId: null,
          guidance: {
            checkedAt: '2026-11-10T00:00:00Z',
            scope: 'EVENT_TASKS',
            eventBaseline: 'CURRENT',
            tasks: [{ taskId: 'task-1', reason: 'NO_CONTEXT', action: 'INSPECT_AND_CLAIM' }],
          },
          version: 2,
          ackedAt: null,
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
      ],
      nextCursor: null,
    });
    ready.ready.mockResolvedValue({
      items: [
        {
          id: 'task-1',
          projectId: 'p1',
          workflowInstanceId: 'inst-1',
          stepKey: 'backend-impl',
          roleId: 'role-backend',
          responsibleUserId: 'u-1',
          version: 1,
          generation: 1,
          executionStatus: 'OPEN',
          workStatus: 'ACTIVE',
          currentClaim: null,
          claimEligibility: { canClaim: true, reason: null },
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    prisma.reviewRequest.findMany.mockResolvedValue([
      { id: 'review-1', createdAt: new Date(Date.now() - 120_000) },
    ]);
    prisma.documentRevision.findMany.mockResolvedValue([
      { id: 'rev-1', title: 'PRD v3', document: { requirementId: 'req-1' } },
    ]);
    prisma.task.findMany.mockImplementation(
      async (args: { where?: { id?: { in?: string[] } } }) => {
        const ids = args?.where?.id?.in ?? [];
        if (!ids.includes('task-1')) return [];
        return [
          {
            id: 'task-1',
            stepKey: 'backend-impl',
            roleId: 'role-backend',
            instance: {
              definitionRevisionId: 'workflow-rev-1',
              requirement: { code: 'DEMO-REQ-3', title: '支付回调重试' },
            },
            role: { key: 'backend', title: '后端' },
            responsibleUser: { id: 'u-1', email: 'developer@example.test' },
          },
        ];
      },
    );
    prisma.workflowRevision.findMany.mockResolvedValue([
      {
        id: 'workflow-rev-1',
        definition: { steps: [{ key: 'backend-impl', displayName: '后端实现' }] },
      },
    ]);
    prisma.artifactSet.findMany.mockResolvedValue([]);
    prisma.projectRole.findMany.mockResolvedValue([
      { id: 'role-product', key: 'product', title: '产品' },
      { id: 'role-backend', key: 'backend', title: '后端' },
    ]);
    prisma.requirement.findMany.mockResolvedValue([
      { id: 'req-1', code: 'DEMO-REQ-1', title: '登录页改版' },
      { id: 'req-2', code: 'DEMO-REQ-2', title: '订单取消规则' },
    ]);
    prisma.changeEvent.findMany.mockResolvedValue([
      {
        id: 'evt-1',
        requirementId: 'req-2',
        changedFields: ['acceptance'],
        targets: {},
        createdAt: new Date(),
      },
    ]);
    prisma.changeRecipient.findMany.mockResolvedValue([
      { eventId: 'evt-1', roleId: 'role-backend' },
    ]);
    prisma.approvalSlot.findMany.mockResolvedValue([]);

    const result = await service.get(principal, null);

    expect(result.counts).toMatchObject({ reviews: 1, changes: 1, readyTasks: 1, total: 3 });
    expect(result.reviews[0].requirement).toEqual({
      code: 'DEMO-REQ-1',
      title: '登录页改版',
    });
    expect(result.reviews[0].slots[0].viewerCanDecide).toBe(true);
    expect(result.changes[0].pendingRoles).toEqual([{ key: 'backend', title: '后端' }]);
    expect(result.changes[0].guidance).toMatchObject({
      scope: 'EVENT_TASKS',
      tasks: [{ taskId: 'task-1', reason: 'NO_CONTEXT' }],
    });
    expect(result.readyTasks[0].requirement).toEqual({
      code: 'DEMO-REQ-3',
      title: '支付回调重试',
    });
    expect(result.readyTasks[0].stepDisplayName).toBe('后端实现');
    expect(result.readyTasks[0].responsibleUser).toEqual({
      id: 'u-1',
      email: 'developer@example.test',
    });
    expect(result.readyTasks[0].claimEligibility).toEqual({ canClaim: true, reason: null });
    expect(prisma.workflowRevision.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['workflow-rev-1'] }, projectId: 'p1' } }),
    );
    expect(result.warnings).toEqual([]);
  });

  it('单个项目读取失败时返回其它数据并记录 warning', async () => {
    const { service, prisma, authorization, reviews, changes, ready } = createHarness();

    prisma.project.findMany.mockResolvedValue([{ id: 'p1', key: 'DEMO', name: 'Demo' }]);
    authorization.resolveProjectContext.mockResolvedValue({ activeRoleIds: [] });
    reviews.listReviews.mockRejectedValue(new Error('REVIEW_READ_FAILED'));
    changes.listRecipients.mockResolvedValue({ items: [], nextCursor: null });
    ready.ready.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    prisma.reviewRequest.findMany.mockResolvedValue([]);
    prisma.documentRevision.findMany.mockResolvedValue([]);
    prisma.task.findMany.mockResolvedValue([]);
    prisma.artifactSet.findMany.mockResolvedValue([]);
    prisma.projectRole.findMany.mockResolvedValue([]);
    prisma.requirement.findMany.mockResolvedValue([]);
    prisma.changeEvent.findMany.mockResolvedValue([]);
    prisma.changeRecipient.findMany.mockResolvedValue([]);
    prisma.approvalSlot.findMany.mockResolvedValue([]);

    const result = await service.get(principal, 'p1');

    expect(result.counts.total).toBe(0);
    expect(result.warnings.join(' ')).toContain('评审数据加载失败');
  });

  it('聚合逾期审批：跨项目按 dueAt 升序返回，并标记是否已升级', async () => {
    const { service, prisma, authorization, reviews, changes, ready } = createHarness();

    prisma.project.findMany.mockResolvedValue([
      { id: 'p1', key: 'DEMO', name: 'Demo' },
      { id: 'p2', key: 'OPS', name: 'Ops' },
    ]);
    authorization.resolveProjectContext.mockResolvedValue({ activeRoleIds: [] });
    reviews.listReviews.mockResolvedValue({ items: [], nextCursor: null });
    changes.listRecipients.mockResolvedValue({ items: [], nextCursor: null });
    ready.ready.mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    prisma.approvalSlot.findMany.mockResolvedValue([
      {
        id: 'slot-late',
        slotKey: 'task-acceptance',
        kind: 'TASK_ACCEPTANCE',
        reviewRequestId: 'review-9',
        projectId: 'p1',
        dueAt: new Date(Date.now() - 2 * 3_600_000),
        escalatedAt: null,
      },
      {
        id: 'slot-escalated',
        slotKey: 'release-approval',
        kind: 'RELEASE_ACCEPTANCE',
        reviewRequestId: 'review-8',
        projectId: 'p2',
        dueAt: new Date(Date.now() - 3_600_000),
        escalatedAt: new Date(),
      },
    ]);

    const result = await service.get(principal, null);

    expect(result.counts.overdueApprovals).toBe(2);
    // counts.total 不重复计入逾期（逾期只是置顶视图）。
    expect(result.counts.total).toBe(0);
    expect(result.overdueApprovals).toHaveLength(2);
    expect(result.overdueApprovals[0]).toMatchObject({
      slotId: 'slot-late',
      projectKey: 'DEMO',
      projectName: 'Demo',
      reviewId: 'review-9',
      escalated: false,
    });
    expect(result.overdueApprovals[0].overdueSeconds).toBeGreaterThanOrEqual(7200);
    expect(result.overdueApprovals[1]).toMatchObject({
      slotId: 'slot-escalated',
      projectKey: 'OPS',
      escalated: true,
    });
  });
});
