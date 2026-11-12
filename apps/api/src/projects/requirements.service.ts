import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { workflowStepDisplayNameOf } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { taskClaimEligibilityOf } from '../tasks/v1-task-eligibility';
import type { RequirementDetailView } from './requirement-detail.view';
import { buildRequirementTrustChain } from './requirement-trust-chain';
import { readRequirementDeliveryLinks, trustStampSelect } from './requirement-trust-chain.reader';
import { visibleRevisionState } from '../knowledge/v1-publication-policy';
import type { V1KnowledgeAccess } from '../auth/v1-authorization';
import { affectedRecipients, changedFieldsOf } from '../changes/v1-requirement-change-policy';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRequirementDto } from './dto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  decodeRequirementCursor,
  encodeRequirementCursor,
  literalRequirementSearch,
  normalizeRequirementQuery,
  type RequirementListQuery,
} from './requirements.pagination';

/** Plain list-view item (no description, no deliveryScope) for paginated list endpoints. */
export type RequirementListItem = {
  id: string;
  projectId: string;
  seq: number;
  code: string;
  title: string;
  version: number;
  generation: number;
  phase: string;
  workStatus: string;
  createdAt: Date;
  updatedAt: Date;
};
type RequirementListPage = {
  items: RequirementListItem[];
  nextCursor: string | null;
  total: number;
};
@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
  ) {}

  async list(
    principal: Principal,
    projectId: string,
    query: RequirementListQuery,
  ): Promise<RequirementListPage> {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    await this.authorization.requireScope(principal, projectId, 'requirement:read');

    const normalized = normalizeRequirementQuery(query);
    const cursor = decodeRequirementCursor(projectId, normalized);
    const search = literalRequirementSearch(normalized.q);
    const where: Prisma.RequirementWhereInput = {
      projectId,
      ...(normalized.phase ? { phase: normalized.phase } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { title: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    // 页内数据与全范围计数使用同一快照，游标只限制当前页，不限制 total。
    // Select only list-view fields: skip description, deliveryScope, and
    // timestamps that are not shown in the list to avoid pulling large text
    // columns for every row on a full-project list.
    const listSelect = {
      id: true,
      projectId: true,
      seq: true,
      code: true,
      title: true,
      version: true,
      generation: true,
      phase: true,
      workStatus: true,
      currentUnderstandingRevisionId: true,
      currentPrdRevisionId: true,
      frozenAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
    const { rows, total } = await this.prisma.$transaction(
      async (tx) => ({
        total: await tx.requirement.count({ where }),
        rows: await tx.requirement.findMany({
          where: { ...where, ...(cursor !== null ? { seq: { gt: cursor } } : {}) },
          orderBy: { seq: 'asc' },
          take: normalized.limit + 1,
          select: listSelect,
        }),
      }),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const hasMore = rows.length > normalized.limit;
    const page = hasMore ? rows.slice(0, normalized.limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        seq: row.seq,
        code: row.code,
        title: row.title,
        // description is omitted in list view to reduce response size;
        // fetch the detail endpoint for the full requirement including description.
        version: row.version,
        generation: row.generation,
        phase: row.phase,
        workStatus: row.workStatus,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      nextCursor: hasMore
        ? encodeRequirementCursor(projectId, normalized, page[page.length - 1].seq)
        : null,
      total,
    };
  }

  async create(principal: Principal, projectId: string, dto: CreateRequirementDto) {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    await this.authorization.requireScope(principal, projectId, 'requirement:propose');

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
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    await this.authorization.requireScope(principal, projectId, 'requirement:propose');

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

    const changedFields = changedFieldsOf(dto);
    const next = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.requirement.updateMany({
        where: { id: requirementId, projectId, version: dto.expectedVersion },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
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

      const row = await tx.requirement.findFirst({ where: { id: requirementId, projectId } });
      if (!row)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'REQUIREMENT_NOT_FOUND',
          { requirementId },
          404,
        );

      // 变更传播：需求内容变化 → 记录一次变更事件，并通知该需求下所有未取消实例的
      // 任务责任人（ACK_ONLY，由收件人确认）。与需求更新同事务，不会出现“改了但没传播”。
      // 口径：只在需求字段真的变化时触发；发起人自己不收件；无人受影响时只留事件不产收件人。
      if (changedFields.length > 0) {
        const instances = await tx.workflowInstance.findMany({
          where: { requirementId, projectId },
          select: { id: true },
        });
        const tasks =
          instances.length === 0
            ? []
            : await tx.task.findMany({
                where: {
                  workflowInstanceId: { in: instances.map((item) => item.id) },
                  workStatus: { not: 'CANCELLED' },
                },
                select: { id: true, responsibleUserId: true, roleId: true },
              });
        const recipients = affectedRecipients(
          tasks.map((item) => ({
            taskId: item.id,
            userId: item.responsibleUserId,
            roleId: item.roleId,
          })),
          principal.userId,
        );
        if (recipients.length > 0) {
          const event = await tx.changeEvent.create({
            data: {
              projectId,
              requirementId,
              sourceKind: 'REQUIREMENT_UPDATE',
              sourceId: requirementId,
              changedFields,
              targets: { taskIds: tasks.map((item) => item.id) },
            },
            select: { id: true },
          });
          await tx.changeRecipient.createMany({
            data: recipients.map((item) => ({
              projectId,
              eventId: event.id,
              userId: item.userId,
              roleId: item.roleId,
            })),
          });
        }
      }

      return row;
    });
    return this.viewOf(next);
  }

  /**
   * 需求详情只读读模型：需求、任务、工件、评审、变更一次返回。
   * key 同时接受需求 UUID 与人类编号（如 YFF-REQ-12），方便深链。
   */
  async detail(
    principal: Principal,
    projectId: string,
    key: string,
  ): Promise<RequirementDetailView> {
    const context = await this.authorization.resolveProjectContext(principal, projectId, 'read');
    await this.authorization.requireScope(principal, projectId, 'requirement:read');
    return this.prisma.$transaction(
      async (tx) => {
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key);
        const row = await tx.requirement.findFirst({
          where: { projectId, ...(isUuid ? { id: key } : { code: key }) },
        });
        if (!row)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REQUIREMENT_NOT_FOUND',
            { requirementId: key },
            404,
          );

        const tasks = await tx.task.findMany({
          where: { projectId, instance: { requirementId: row.id } },
          orderBy: [{ stepKey: 'asc' }],
          select: {
            id: true,
            stepKey: true,
            roleId: true,
            responsibleUserId: true,
            version: true,
            generation: true,
            acceptanceKeys: true,
            executionStatus: true,
            workStatus: true,
            currentClaimId: true,
            currentSnapshotId: true,
            currentArtifactSetId: true,
            role: { select: { key: true, title: true } },
            responsibleUser: { select: { id: true, email: true } },
            instance: {
              select: { id: true, definitionRevisionId: true, workStatus: true, retiredAt: true },
            },
          },
        });
        const workflowRevisionIds = [
          ...new Set(
            tasks.flatMap((task) =>
              task.instance.definitionRevisionId ? [task.instance.definitionRevisionId] : [],
            ),
          ),
        ];
        const workflowRevisions = workflowRevisionIds.length
          ? await tx.workflowRevision.findMany({
              where: { id: { in: workflowRevisionIds }, projectId },
              select: { id: true, definition: true },
            })
          : [];
        const displayNameByRevision = new Map(
          workflowRevisions.map((revision) => [revision.id, revision.definition]),
        );
        const taskIds = tasks.map((task) => task.id);
        const documents = await tx.knowledgeDocument.findMany({
          where: { projectId, requirementId: row.id },
          select: {
            id: true,
            knowledgeBaseId: true,
            kind: true,
            archivedAt: true,
            currentPublishedRevisionId: true,
            revisions: {
              select: {
                id: true,
                seq: true,
                title: true,
                sha256: true,
                createdById: true,
                basisUnderstandingRevisionId: true,
                acceptance: true,
                publications: {
                  where: { projectId },
                  select: {
                    id: true,
                    kind: true,
                    revisionId: true,
                    reviewRequestId: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        });
        const readableDocumentIds = new Set<string>();
        const documentAccess = new Map<string, V1KnowledgeAccess>();
        for (const document of documents) {
          try {
            const access = await this.authorization.resolveKnowledgeAccess(
              principal,
              document.knowledgeBaseId,
            );
            if (access.canRead && access.projectId === projectId && !document.archivedAt) {
              readableDocumentIds.add(document.id);
              documentAccess.set(document.id, access);
            }
          } catch (error) {
            if (!(error instanceof WorkmeshError) || error.status !== 404) throw error;
          }
        }
        const [artifacts, allReviews, allChanges, deliveryLinks] = await Promise.all([
          taskIds.length
            ? tx.artifact.findMany({
                where: { projectId, taskId: { in: taskIds } },
                orderBy: { createdAt: 'desc' },
                select: {
                  id: true,
                  taskId: true,
                  artifactSetId: true,
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
          tx.reviewRequest.findMany({
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
              taskGeneration: true,
              createdAt: true,
              documentRevision: { select: { id: true, title: true, seq: true, documentId: true } },
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
                  subjectDigest: true,
                  comment: true,
                  createdAt: true,
                  createdByStamp: { select: trustStampSelect },
                  revocation: {
                    select: {
                      id: true,
                      createdAt: true,
                      createdByStamp: { select: trustStampSelect },
                    },
                  },
                },
              },
            },
          }),
          tx.changeEvent.findMany({
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
          readRequirementDeliveryLinks(tx, projectId, taskIds),
        ]);
        const visibleDocuments = documents.map((document) => ({
          ...document,
          revisions: document.revisions.filter((revision) => {
            const access = documentAccess.get(document.id);
            if (!access) return false;
            return (
              visibleRevisionState(
                document.currentPublishedRevisionId === revision.id ? 'PUBLISHED' : 'CANDIDATE',
                {
                  access,
                  isAuthor: revision.createdById === principal.userId,
                  isAssignedReviewer: allReviews.some(
                    (review) =>
                      review.documentRevisionId === revision.id &&
                      review.approvalSlots.some((slot) => slot.requiredUserId === principal.userId),
                  ),
                },
              ) !== null
            );
          }),
        }));
        const visibleRevisionIds = new Set(
          visibleDocuments.flatMap((document) => document.revisions.map((revision) => revision.id)),
        );
        const reviews = allReviews.filter(
          (review) =>
            !review.documentRevisionId || visibleRevisionIds.has(review.documentRevisionId),
        );
        const changes = allChanges.filter((change) => {
          const target =
            change.targets && typeof change.targets === 'object' && !Array.isArray(change.targets)
              ? (change.targets as Record<string, unknown>)
              : {};
          return (
            (typeof target.documentId !== 'string' || readableDocumentIds.has(target.documentId)) &&
            ['documentRevisionId', 'previousDocumentRevisionId'].every(
              (field) =>
                typeof target[field] !== 'string' || visibleRevisionIds.has(String(target[field])),
            )
          );
        });
        const trustChain = buildRequirementTrustChain(
          {
            requirement: row,
            tasks,
            documents: visibleDocuments,
            reviews,
            changes,
            definitions: workflowRevisions,
            ...deliveryLinks,
          },
          readableDocumentIds,
          new Date(),
          visibleDocuments.some(
            (document, index) => document.revisions.length !== documents[index].revisions.length,
          ),
        );
        const currentPrd = trustChain.baselines.find(
          (baseline) => baseline.kind === 'PRD' && baseline.state === 'CURRENT',
        );
        const acceptanceKeys = currentPrd ? trustChain.acceptance.map((item) => item.key) : [];
        // Slow aggregation never freezes document grants or project membership.
        for (const document of documents.filter((item) => readableDocumentIds.has(item.id))) {
          const access = await this.authorization.resolveKnowledgeAccess(
            principal,
            document.knowledgeBaseId,
          );
          if (!access.canRead || access.projectId !== projectId)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'KNOWLEDGE_NOT_READABLE',
              undefined,
              404,
            );
        }
        await this.authorization.resolveProjectContext(principal, projectId, 'read');

        return {
          requirement: this.viewOf(row),
          /** 当前发布 PRD 的验收 key：流程实例必须把它们分配到具体任务。 */
          acceptanceKeys,
          tasks: tasks.map((task) => {
            const review = reviews.find(
              (item) =>
                item.taskId === task.id &&
                item.taskGeneration === task.generation &&
                item.artifactSetId === task.currentArtifactSetId,
            );
            return {
              id: task.id,
              stepKey: task.stepKey,
              stepDisplayName: displayNameByRevision.has(task.instance.definitionRevisionId ?? '')
                ? workflowStepDisplayNameOf(
                    displayNameByRevision.get(task.instance.definitionRevisionId ?? ''),
                    task.stepKey,
                  )
                : null,
              role: task.role,
              responsibleUser: task.responsibleUser,
              claimEligibility: taskClaimEligibilityOf(principal, task, context),
              workflowWorkStatus: task.instance.retiredAt
                ? 'RETIRED'
                : String(task.instance.workStatus),
              version: task.version,
              generation: task.generation,
              executionStatus: task.executionStatus,
              workStatus: task.workStatus,
              currentClaimId: task.currentClaimId,
              currentArtifactSetId: task.currentArtifactSetId,
              instanceId: task.instance.id,
              artifactCount: artifacts.filter((artifact) => artifact.taskId === task.id).length,
              review: review
                ? {
                    id: review.id,
                    kind: review.kind,
                    status: review.status,
                    decisions: review.decisions.map((decision) => ({
                      id: decision.id,
                      decision: decision.decision,
                      createdAt: decision.createdAt,
                      actor: decision.createdByStamp?.user ?? null,
                    })),
                  }
                : null,
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
            ...(review.task
              ? {
                  stepDisplayName: tasks.find((task) => task.id === review.taskId)?.instance
                    .definitionRevisionId
                    ? workflowStepDisplayNameOf(
                        displayNameByRevision.get(
                          tasks.find((task) => task.id === review.taskId)!.instance
                            .definitionRevisionId!,
                        ),
                        review.task.stepKey,
                      )
                    : null,
                }
              : {}),
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
          trustChain,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
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
