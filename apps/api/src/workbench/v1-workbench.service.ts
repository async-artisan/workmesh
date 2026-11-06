import { Injectable } from '@nestjs/common';
import type { Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { PrismaService } from '../prisma/prisma.service';
import { V1ReviewService } from '../reviews/v1-review.service';
import { V1ChangeService } from '../tasks/v1-change.service';
import { V1ReadyService } from '../tasks/v1-ready.service';

type ProjectRow = { id: string; key: string; name: string };

type WorkbenchRequirement = { code: string; title: string };
type WorkbenchRole = { id: string; key: string; title: string };

export type WorkbenchReviewItem = {
  reviewId: string;
  kind: string;
  status: string;
  version: number;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  subjectLabel: string;
  role: WorkbenchRole | null;
  slots: Array<{
    id: string;
    slotKey: string;
    requiredUserId: string;
    requiredRoleId: string | null;
    decided: boolean;
    viewerCanDecide: boolean;
  }>;
  ageSeconds: number | null;
  evidence: {
    artifactCount: number;
    hasPr: boolean;
    artifactKinds: string[];
    checks: { total: number; failed: number };
    codeRefs: number;
  };
};

export type WorkbenchChangeItem = {
  recipientId: string;
  eventId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  changedFields: string[];
  targets: unknown;
  pendingRoles: Array<{ key: string; title: string }>;
  version: number;
  createdAt: string;
  ageSeconds: number;
};

export type WorkbenchReadyTaskItem = {
  taskId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  role: { key: string; title: string } | null;
  stepKey: string;
  executionStatus: string;
  workStatus: string;
  ageSeconds: number | null;
};

/** 逾期审批（到期未决定）：工作台置顶展示，跨项目按 dueAt 升序。 */
export type WorkbenchOverdueApprovalItem = {
  slotId: string;
  slotKey: string;
  kind: string;
  reviewId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  dueAt: string;
  escalated: boolean;
  overdueSeconds: number;
};

type ProjectResult = {
  reviews: WorkbenchReviewItem[];
  changes: WorkbenchChangeItem[];
  readyTasks: WorkbenchReadyTaskItem[];
};

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    if (code && message) return `[${String(code)}] ${String(message)}`;
    if (message) return String(message);
  }
  return String(error);
}

function ageSecondsOf(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 1000));
}

/**
 * 工作台只读聚合：一次请求返回“待我签字 / 待确认变更 / 可开工任务”。
 * 权限过滤复用各领域 service；本服务只做跨实体补齐人类可读标签，不写任何事实。
 */
@Injectable()
export class V1WorkbenchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
    private readonly reviews: V1ReviewService,
    private readonly changes: V1ChangeService,
    private readonly ready: V1ReadyService,
  ) {}

  async get(principal: Principal, projectId: string | null) {
    const projects = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        members: { some: { userId: principal.userId, revokedAt: null } },
        ...(projectId ? { id: projectId } : {}),
      },
      select: { id: true, key: true, name: true },
      orderBy: { updatedAt: 'desc' },
    });

    const warnings: string[] = [];
    const results = await Promise.all(
      projects.map((project) => this.loadProject(principal, project, warnings)),
    );
    const reviews = results.flatMap((result) => result.reviews);
    const changes = results.flatMap((result) => result.changes);
    const readyTasks = results.flatMap((result) => result.readyTasks);
    const overdueApprovals = await this.loadOverdueApprovals(projects);

    return {
      counts: {
        reviews: reviews.length,
        changes: changes.length,
        readyTasks: readyTasks.length,
        overdueApprovals: overdueApprovals.length,
        total: reviews.length + changes.length + readyTasks.length,
      },
      reviews,
      changes,
      readyTasks,
      overdueApprovals,
      warnings,
    };
  }

  /** 跨项目读取「到期且未决定」的审批槽；只读展示，升级动作仍在项目内手动触发。 */
  private async loadOverdueApprovals(
    projects: readonly ProjectRow[],
  ): Promise<WorkbenchOverdueApprovalItem[]> {
    if (projects.length === 0) return [];
    const now = new Date();
    const rows = await this.prisma.approvalSlot.findMany({
      where: {
        projectId: { in: projects.map((project) => project.id) },
        dueAt: { lte: now },
        decisions: { none: {} },
      },
      orderBy: { dueAt: 'asc' },
      take: 50,
      select: {
        id: true,
        slotKey: true,
        kind: true,
        reviewRequestId: true,
        projectId: true,
        dueAt: true,
        escalatedAt: true,
      },
    });
    const projectById = new Map(projects.map((project) => [project.id, project]));
    return rows.flatMap((row) => {
      const project = projectById.get(row.projectId);
      if (!project || !row.dueAt) return [];
      const dueTime =
        row.dueAt instanceof Date ? row.dueAt.getTime() : new Date(row.dueAt).getTime();
      return [
        {
          slotId: row.id,
          slotKey: row.slotKey,
          kind: row.kind,
          reviewId: row.reviewRequestId,
          projectId: project.id,
          projectKey: project.key,
          projectName: project.name,
          dueAt: new Date(dueTime).toISOString(),
          escalated: Boolean(row.escalatedAt),
          overdueSeconds: Math.max(0, Math.floor((now.getTime() - dueTime) / 1000)),
        },
      ];
    });
  }

  private async loadProject(
    principal: Principal,
    project: ProjectRow,
    warnings: string[],
  ): Promise<ProjectResult> {
    const [context, reviewPage, changePage, readyPage] = await Promise.allSettled([
      this.authorization.resolveProjectContext(principal, project.id, 'read'),
      this.reviews.listReviews(principal, {
        projectId: project.id,
        assignedToMe: true,
        status: 'OPEN',
        limit: 50,
      }),
      this.changes.listRecipients(principal, {
        projectId: project.id,
        ackedOnly: false,
        limit: 100,
      }),
      this.ready.ready(principal, project.id, { limit: 50 }),
    ]);

    const activeRoleIds = context.status === 'fulfilled' ? context.value.activeRoleIds : [];
    if (context.status === 'rejected')
      warnings.push(`${project.key}：无法读取项目权限（${errorText(context.reason)}）`);
    if (reviewPage.status === 'rejected')
      warnings.push(`${project.key}：评审数据加载失败（${errorText(reviewPage.reason)}）`);
    if (changePage.status === 'rejected')
      warnings.push(`${project.key}：变更数据加载失败（${errorText(changePage.reason)}）`);
    if (readyPage.status === 'rejected')
      warnings.push(`${project.key}：可开工任务加载失败（${errorText(readyPage.reason)}）`);

    const reviewItems = reviewPage.status === 'fulfilled' ? reviewPage.value.items : [];
    const recipients =
      changePage.status === 'fulfilled'
        ? changePage.value.items.filter((item) => !item.ackedAt)
        : [];
    const readyItems = readyPage.status === 'fulfilled' ? readyPage.value.items : [];

    const [reviews, changes, readyTasks] = await Promise.all([
      this.enrichReviews(principal, project, reviewItems, activeRoleIds),
      this.enrichChanges(project, recipients),
      this.enrichReadyTasks(project, readyItems),
    ]);

    return { reviews, changes, readyTasks };
  }

  private async enrichReviews(
    principal: Principal,
    project: ProjectRow,
    items: Awaited<ReturnType<V1ReviewService['listReviews']>>['items'],
    activeRoleIds: readonly string[],
  ): Promise<WorkbenchReviewItem[]> {
    if (items.length === 0) return [];

    const reviewIds = items.map((item) => item.id);
    const revisionIds = [
      ...new Set(
        items.flatMap((item) => (item.documentRevisionId ? [item.documentRevisionId] : [])),
      ),
    ];
    const taskIds = [...new Set(items.flatMap((item) => (item.taskId ? [item.taskId] : [])))];
    const artifactSetIds = [
      ...new Set(items.flatMap((item) => (item.artifactSetId ? [item.artifactSetId] : []))),
    ];

    const [createdRows, revisions, tasks, artifactSets] = await Promise.all([
      this.prisma.reviewRequest.findMany({
        where: { id: { in: reviewIds } },
        select: { id: true, createdAt: true },
      }),
      revisionIds.length
        ? this.prisma.documentRevision.findMany({
            where: { id: { in: revisionIds } },
            select: { id: true, title: true, document: { select: { requirementId: true } } },
          })
        : Promise.resolve([]),
      taskIds.length
        ? this.prisma.task.findMany({
            where: { id: { in: taskIds } },
            select: {
              id: true,
              stepKey: true,
              roleId: true,
              instance: {
                select: { requirement: { select: { code: true, title: true } } },
              },
            },
          })
        : Promise.resolve([]),
      artifactSetIds.length
        ? this.prisma.artifactSet.findMany({
            where: { id: { in: artifactSetIds } },
            select: {
              id: true,
              artifacts: {
                select: {
                  id: true,
                  kind: true,
                  checks: true,
                  commitSha: true,
                  projectRepositoryId: true,
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const documentRequirementIds = [
      ...new Set(
        revisions.flatMap((revision) =>
          revision.document.requirementId ? [revision.document.requirementId] : [],
        ),
      ),
    ];
    const roles = await this.prisma.projectRole.findMany({
      where: {
        id: {
          in: [
            ...new Set([
              ...items.flatMap((item) =>
                item.slots.flatMap((slot) => (slot.requiredRoleId ? [slot.requiredRoleId] : [])),
              ),
              ...tasks.map((task) => task.roleId),
            ]),
          ],
        },
      },
      select: { id: true, key: true, title: true },
    });
    const documentRequirements = documentRequirementIds.length
      ? await this.prisma.requirement.findMany({
          where: { id: { in: documentRequirementIds } },
          select: { id: true, code: true, title: true },
        })
      : [];

    const createdAtById = new Map(createdRows.map((row) => [row.id, row.createdAt]));
    const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
    const taskById = new Map(tasks.map((task) => [task.id, task]));
    const artifactSetById = new Map(artifactSets.map((set) => [set.id, set]));
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const documentRequirementById = new Map(
      documentRequirements.map((requirement) => [requirement.id, requirement]),
    );

    return items.map((item) => {
      const revision = item.documentRevisionId
        ? revisionById.get(item.documentRevisionId)
        : undefined;
      const task = item.taskId ? taskById.get(item.taskId) : undefined;
      const artifactSet = item.artifactSetId ? artifactSetById.get(item.artifactSetId) : undefined;
      const artifacts = artifactSet?.artifacts ?? [];
      const checkEntries = artifacts.flatMap((artifact) =>
        Array.isArray(artifact.checks) ? artifact.checks : [],
      );
      const failedChecks = checkEntries.filter(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          (entry as { passed?: unknown }).passed === false,
      ).length;
      const requirement =
        (revision?.document.requirementId
          ? documentRequirementById.get(revision.document.requirementId)
          : undefined) ?? task?.instance.requirement;
      const roleId =
        task?.roleId ?? (item.slots.length === 1 ? item.slots[0].requiredRoleId : null);
      const role = roleId ? roleById.get(roleId) : undefined;
      const decidedSlotIds = new Set(item.decisions.map((decision) => decision.approvalSlotId));
      const slots = item.slots.map((slot) => {
        const decided = decidedSlotIds.has(slot.id);
        const viewerCanDecide =
          !decided &&
          (slot.requiredUserId === principal.userId ||
            (slot.requiredRoleId ? activeRoleIds.includes(slot.requiredRoleId) : false));
        return {
          id: slot.id,
          slotKey: slot.slotKey,
          requiredUserId: slot.requiredUserId,
          requiredRoleId: slot.requiredRoleId,
          decided,
          viewerCanDecide,
        };
      });

      return {
        reviewId: item.id,
        kind: item.kind,
        status: item.status,
        version: item.version,
        projectId: project.id,
        projectKey: project.key,
        projectName: project.name,
        requirement: requirement ? { code: requirement.code, title: requirement.title } : null,
        subjectLabel: revision?.title ?? task?.stepKey ?? item.kind,
        role: role ? { id: role.id, key: role.key, title: role.title } : null,
        slots,
        ageSeconds: ageSecondsOf(createdAtById.get(item.id)),
        evidence: {
          artifactCount: artifacts.length || (item.documentRevisionId ? 1 : 0),
          hasPr: artifacts.some((artifact) => artifact.commitSha || artifact.projectRepositoryId),
          artifactKinds: [...new Set(artifacts.map((artifact) => artifact.kind))],
          checks: { total: checkEntries.length, failed: failedChecks },
          codeRefs: artifacts.filter((artifact) => artifact.commitSha).length,
        },
      };
    });
  }

  private async enrichChanges(
    project: ProjectRow,
    recipients: Awaited<ReturnType<V1ChangeService['listRecipients']>>['items'],
  ): Promise<WorkbenchChangeItem[]> {
    if (recipients.length === 0) return [];

    const eventIds = [...new Set(recipients.map((recipient) => recipient.eventId))];
    const [events, pending] = await Promise.all([
      this.prisma.changeEvent.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          requirementId: true,
          changedFields: true,
          targets: true,
          createdAt: true,
        },
      }),
      this.prisma.changeRecipient.findMany({
        where: { eventId: { in: eventIds }, ackedAt: null },
        select: { eventId: true, roleId: true },
      }),
    ]);

    const requirementIds = [
      ...new Set(events.flatMap((event) => (event.requirementId ? [event.requirementId] : []))),
    ];
    const roleIds = [...new Set(pending.flatMap((row) => (row.roleId ? [row.roleId] : [])))];
    const [requirements, roles] = await Promise.all([
      requirementIds.length
        ? this.prisma.requirement.findMany({
            where: { id: { in: requirementIds } },
            select: { id: true, code: true, title: true },
          })
        : Promise.resolve([]),
      roleIds.length
        ? this.prisma.projectRole.findMany({
            where: { id: { in: roleIds } },
            select: { id: true, key: true, title: true },
          })
        : Promise.resolve([]),
    ]);

    const eventById = new Map(events.map((event) => [event.id, event]));
    const requirementById = new Map(
      requirements.map((requirement) => [requirement.id, requirement]),
    );
    const roleById = new Map(roles.map((role) => [role.id, role]));
    const pendingByEvent = new Map<string, string[]>();
    for (const row of pending) {
      if (!row.roleId) continue;
      const list = pendingByEvent.get(row.eventId) ?? [];
      list.push(row.roleId);
      pendingByEvent.set(row.eventId, list);
    }

    return recipients.map((recipient) => {
      const event = eventById.get(recipient.eventId);
      const requirement = event?.requirementId
        ? requirementById.get(event.requirementId)
        : undefined;
      const pendingRoles = (pendingByEvent.get(recipient.eventId) ?? [])
        .map((roleId) => roleById.get(roleId))
        .filter((role): role is NonNullable<typeof role> => Boolean(role))
        .map((role) => ({ key: role.key, title: role.title }));

      return {
        recipientId: recipient.id,
        eventId: recipient.eventId,
        projectId: project.id,
        projectKey: project.key,
        projectName: project.name,
        requirement: requirement ? { code: requirement.code, title: requirement.title } : null,
        changedFields: event?.changedFields ?? [],
        targets: event?.targets ?? null,
        pendingRoles,
        version: recipient.version,
        createdAt: recipient.createdAt,
        ageSeconds: ageSecondsOf(recipient.createdAt) ?? 0,
      };
    });
  }

  private async enrichReadyTasks(
    project: ProjectRow,
    items: Awaited<ReturnType<V1ReadyService['ready']>>['items'],
  ): Promise<WorkbenchReadyTaskItem[]> {
    if (items.length === 0) return [];

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: items.map((item) => item.id) } },
      select: {
        id: true,
        stepKey: true,
        roleId: true,
        instance: { select: { requirement: { select: { code: true, title: true } } } },
        role: { select: { key: true, title: true } },
      },
    });
    const taskById = new Map(tasks.map((task) => [task.id, task]));

    return items.map((item) => {
      const task = taskById.get(item.id);
      return {
        taskId: item.id,
        projectId: project.id,
        projectKey: project.key,
        projectName: project.name,
        requirement: task?.instance.requirement ?? null,
        role: task?.role ?? null,
        stepKey: item.stepKey,
        executionStatus: item.executionStatus,
        workStatus: item.workStatus,
        ageSeconds: null,
      };
    });
  }
}
