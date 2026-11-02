import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRequirementDto } from './dto';

const MAX_PAGE = 100;

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
  ) {}

  async list(
    principal: Principal,
    projectId: string,
    query: { limit?: number; cursor?: string | null },
  ) {
    await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:read');

    const take = Number.isInteger(query.limit)
      ? Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE)
      : 20;
    const cursor = query.cursor ? Number(query.cursor) : null;
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1))
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'REQUIREMENT_CURSOR_INVALID',
        { cursor: query.cursor },
        400,
      );

    const rows = await this.prisma.requirement.findMany({
      where: { projectId, ...(cursor !== null ? { seq: { gt: cursor } } : {}) },
      orderBy: { seq: 'asc' },
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => this.viewOf(row)),
      nextCursor: hasMore ? String(page[page.length - 1].seq) : null,
    };
  }

  async create(principal: Principal, projectId: string, dto: CreateRequirementDto) {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:propose');
    if (context.project.archivedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'PROJECT_ARCHIVED',
        { projectId },
        409,
      );

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({
        where: { id: projectId },
        select: { key: true },
      });
      if (!project)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'PROJECT_NOT_FOUND',
          { projectId },
          404,
        );
      const max = await tx.requirement.aggregate({ where: { projectId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      const row = await tx.requirement.create({
        data: {
          projectId,
          seq,
          code: `${project.key}-${String(seq).padStart(3, '0')}`,
          title: dto.title,
          description: dto.description ?? null,
        },
      });
      return this.viewOf(row);
    });
  }

  /** 需求编辑只允许标题/描述；版本必须匹配，避免覆盖别人刚改的内容。 */
  async update(
    principal: Principal,
    projectId: string,
    requirementId: string,
    dto: { expectedVersion: number; title?: string; description?: string },
  ) {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:propose');
    if (context.project.archivedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'PROJECT_ARCHIVED',
        { projectId },
        409,
      );

    const current = await this.prisma.requirement.findFirst({
      where: { id: requirementId, projectId },
    });
    if (!current)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId },
        404,
      );
    if (current.version !== dto.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'REQUIREMENT_VERSION_CONFLICT',
        { requirementId, currentVersion: current.version },
        409,
      );

    const updated = await this.prisma.requirement.updateMany({
      where: { id: requirementId, projectId, version: dto.expectedVersion },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() || null }
          : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'REQUIREMENT_VERSION_CONFLICT',
        { requirementId, currentVersion: dto.expectedVersion },
        409,
      );

    const next = await this.prisma.requirement.findFirst({
      where: { id: requirementId, projectId },
    });
    if (!next)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId },
        404,
      );
    return this.viewOf(next);
  }

  /**
   * 需求详情只读读模型：需求、任务、工件、评审、变更一次返回。
   * key 同时接受需求 UUID 与人类编号（如 YFF-REQ-12），方便深链。
   */
  async detail(principal: Principal, projectId: string, key: string) {
    await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:read');

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    );
    const row = await this.prisma.requirement.findFirst({
      where: { projectId, ...(isUuid ? { id: key } : { code: key }) },
    });
    if (!row)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId: key },
        404,
      );

    const tasks = await this.prisma.task.findMany({
      where: { projectId, instance: { requirementId: row.id } },
      orderBy: [{ stepKey: 'asc' }],
      select: {
        id: true,
        stepKey: true,
        roleId: true,
        responsibleUserId: true,
        version: true,
        generation: true,
        executionStatus: true,
        workStatus: true,
        currentClaimId: true,
        currentArtifactSetId: true,
        role: { select: { key: true, title: true } },
        responsibleUser: { select: { id: true, email: true } },
        instance: { select: { id: true } },
      },
    });
    const taskIds = tasks.map((task) => task.id);

    const [artifacts, reviews, changes] = await Promise.all([
      taskIds.length
        ? this.prisma.artifact.findMany({
            where: { projectId, taskId: { in: taskIds } },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              taskId: true,
              kind: true,
              storage: true,
              mediaType: true,
              byteLength: true,
              sha256: true,
              commitSha: true,
              repoPath: true,
              summary: true,
              checks: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
      this.prisma.reviewRequest.findMany({
        where: {
          projectId,
          OR: [
            ...(taskIds.length ? [{ taskId: { in: taskIds } }] : []),
            { documentRevision: { document: { requirementId: row.id } } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          version: true,
          subjectDigest: true,
          documentRevisionId: true,
          artifactSetId: true,
          taskId: true,
          createdAt: true,
          documentRevision: { select: { title: true, seq: true } },
          task: { select: { stepKey: true } },
          approvalSlots: {
            select: {
              id: true,
              slotKey: true,
              requiredUserId: true,
              requiredRoleId: true,
            },
          },
          decisions: {
            select: {
              id: true,
              approvalSlotId: true,
              decision: true,
              comment: true,
              createdAt: true,
              createdByStamp: {
                select: { user: { select: { id: true, email: true } } },
              },
            },
          },
        },
      }),
      this.prisma.changeEvent.findMany({
        where: { projectId, requirementId: row.id },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          sourceKind: true,
          sourceId: true,
          changedFields: true,
          targets: true,
          createdAt: true,
          recipients: {
            select: { id: true, userId: true, roleId: true, ackedAt: true, version: true },
          },
        },
      }),
    ]);

    return {
      requirement: this.viewOf(row),
      tasks: tasks.map((task) => {
        const review = reviews.find((item) => item.taskId === task.id);
        return {
          id: task.id,
          stepKey: task.stepKey,
          role: task.role,
          responsibleUser: task.responsibleUser,
          version: task.version,
          generation: task.generation,
          executionStatus: task.executionStatus,
          workStatus: task.workStatus,
          currentClaimId: task.currentClaimId,
          currentArtifactSetId: task.currentArtifactSetId,
          instanceId: task.instance.id,
          artifactCount: artifacts.filter((artifact) => artifact.taskId === task.id).length,
          review: review ? { id: review.id, kind: review.kind, status: review.status } : null,
        };
      }),
      artifacts,
      reviews: reviews.map((review) => ({
        id: review.id,
        kind: review.kind,
        status: review.status,
        version: review.version,
        subjectDigest: review.subjectDigest,
        documentRevisionId: review.documentRevisionId,
        artifactSetId: review.artifactSetId,
        taskId: review.taskId,
        createdAt: review.createdAt,
        subjectLabel:
          review.documentRevision?.title ?? review.task?.stepKey ?? String(review.kind),
        slots: review.approvalSlots,
        decisions: review.decisions.map((decision) => ({
          id: decision.id,
          approvalSlotId: decision.approvalSlotId,
          decision: decision.decision,
          comment: decision.comment,
          createdAt: decision.createdAt,
          actor: decision.createdByStamp?.user ?? null,
        })),
      })),
      changes,
      counts: {
        tasks: tasks.length,
        artifacts: artifacts.length,
        reviews: reviews.length,
        changes: changes.length,
      },
    };
  }

  private viewOf(row: {
    id: string;
    projectId: string;
    seq: number;
    code: string;
    title: string;
    description: string | null;
    version: number;
    generation: number;
    phase: string;
    workStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      seq: row.seq,
      code: row.code,
      title: row.title,
      description: row.description,
      version: row.version,
      generation: row.generation,
      phase: row.phase,
      workStatus: row.workStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
