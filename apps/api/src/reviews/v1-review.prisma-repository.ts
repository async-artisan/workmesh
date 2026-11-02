import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { normalizeRoute } from '../common/v1-idempotency';
import { assertWorkflowInstanceActive } from '../tasks/v1-task-consistency-policy';
import { PrismaClient as V1PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
type V1TransactionClient = Omit<
  V1PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

import type {
  V1ArtifactReviewSubject,
  V1CommitDecisionInput,
  V1CommitDecisionResult,
  V1CreateReviewRequestInput,
  V1CreateReviewRequestResult,
  V1DecisionContext,
  V1DocumentReviewSubject,
  V1RequirementState,
  V1ReviewListQuery,
  V1ReviewListResult,
  V1ReviewKind,
  V1ReviewRepository,
  V1ReviewSnapshot,
  V1RevokeInput,
  V1RevokeResult,
  V1SubjectResult,
  V1TaskState,
} from './v1-review.repository';
import { collectDownstreamStepKeys } from './v1-review-policy';
import {
  documentReviewKindOf,
  encodeReviewCursor,
  reviewListWhere,
  taskAcceptanceSlotBindings,
  type V1AcceptanceSlotBinding,
} from './v1-review-derivation';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

const PHASE_ORDER = [
  'DISCOVERY',
  'DEFINITION',
  'DELIVERY',
  'ACCEPTANCE',
  'RELEASED',
  'ARCHIVED',
] as const;
type Phase = (typeof PHASE_ORDER)[number];

/** 任务验收通过后，按步骤 kind 推进到的需求阶段。 */
const PHASE_BY_STEP_KIND: Record<string, Phase> = {
  PRODUCT: 'DEFINITION',
  DELIVERY: 'DELIVERY',
  VERIFY: 'ACCEPTANCE',
  RELEASE: 'RELEASED',
};

/** 需求阶段只前进不后退：理解确认至少 DEFINITION，PRD 发布至少 DELIVERY。 */
function atLeastPhase(current: string, target: Phase): Phase {
  const currentIndex = PHASE_ORDER.indexOf(current as Phase);
  const targetIndex = PHASE_ORDER.indexOf(target);
  if (currentIndex < 0) return target;
  return PHASE_ORDER[Math.max(currentIndex, targetIndex)];
}

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

const REVIEW_SNAPSHOT_INCLUDE = {
  approvalSlots: true,
  decisions: {
    select: {
      id: true,
      approvalSlotId: true,
      decision: true,
      subjectDigest: true,
      comment: true,
      createdByStampId: true,
      createdAt: true,
      createdByStamp: { select: { user: { select: { id: true, email: true } } } },
    },
  },
  documentRevision: {
    select: {
      id: true,
      sha256: true,
      document: {
        select: {
          id: true,
          projectId: true,
          knowledgeBaseId: true,
          version: true,
          currentPublishedRevisionId: true,
        },
      },
    },
  },
} satisfies Prisma.ReviewRequestInclude;

type ReviewSnapshotRow = Prisma.ReviewRequestGetPayload<{
  include: typeof REVIEW_SNAPSHOT_INCLUDE;
}>;

type DerivedReviewSlot = { slotKey: string; requiredUserId: string; requiredRoleId: string | null };

type DerivedReview = {
  kind: V1ReviewKind;
  subjectDigest: string;
  slots: DerivedReviewSlot[];
  documentRevisionId: string | null;
  artifactSetId: string | null;
  taskId: string | null;
  taskGeneration: number | null;
};

function toSnapshot(review: ReviewSnapshotRow): V1ReviewSnapshot {
  const document = review.documentRevision?.document ?? null;
  return {
    id: review.id,
    projectId: review.projectId,
    kind: review.kind as V1ReviewSnapshot['kind'],
    status: review.status as V1ReviewSnapshot['status'],
    version: review.version,
    subjectDigest: review.subjectDigest,
    documentRevisionId: review.documentRevisionId,
    artifactSetId: review.artifactSetId,
    taskId: review.taskId,
    slots: review.approvalSlots.map((slot) => ({
      id: slot.id,
      slotKey: slot.slotKey,
      kind: slot.kind,
      requiredRoleId: slot.requiredRoleId,
      requiredUserId: slot.requiredUserId ?? '',
      sourceSlotBindingId: slot.sourceSlotBindingId,
    })),
    decisions: review.decisions.map((decision) => ({
      id: decision.id,
      approvalSlotId: decision.approvalSlotId,
      decision: decision.decision as V1ReviewSnapshot['decisions'][number]['decision'],
      subjectDigest: decision.subjectDigest,
      comment: decision.comment,
      createdById: decision.createdByStampId ?? '',
      createdAt: decision.createdAt,
      actor: decision.createdByStamp?.user ?? null,
    })),
    subject:
      document && review.documentRevision
        ? {
            documentId: document.id,
            knowledgeBaseId: document.knowledgeBaseId,
            documentVersion: document.version,
            currentPublishedRevisionId: document.currentPublishedRevisionId,
            revisionId: review.documentRevision.id,
            revisionDigest: review.documentRevision.sha256,
          }
        : null,
  };
}

@Injectable()
export class V1ReviewPrismaRepository implements V1ReviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReview(reviewId: string): Promise<V1ReviewSnapshot | null> {
    const review = await this.prisma.reviewRequest.findUnique({
      where: { id: reviewId },
      include: REVIEW_SNAPSHOT_INCLUDE,
    });
    return review ? toSnapshot(review) : null;
  }

  async findDecisionContext(decisionId: string): Promise<V1DecisionContext | null> {
    const decision = await this.prisma.reviewDecision.findUnique({
      where: { id: decisionId },
      select: {
        id: true,
        projectId: true,
        reviewRequestId: true,
        approvalSlotId: true,
        decision: true,
        subjectDigest: true,
        revocation: { select: { id: true } },
        createdByStamp: { select: { userId: true } },
        approvalSlot: {
          select: {
            id: true,
            slotKey: true,
            kind: true,
            requiredRoleId: true,
            requiredUserId: true,
            sourceSlotBindingId: true,
          },
        },
        reviewRequest: {
          select: {
            id: true,
            kind: true,
            status: true,
            version: true,
            subjectDigest: true,
            documentRevisionId: true,
            artifactSetId: true,
            taskId: true,
            documentRevision: {
              select: {
                id: true,
                document: { select: { knowledgeBaseId: true } },
              },
            },
          },
        },
      },
    });
    if (!decision) return null;
    return {
      decisionId: decision.id,
      projectId: decision.projectId,
      reviewId: decision.reviewRequest.id,
      reviewKind: decision.reviewRequest.kind as V1DecisionContext['reviewKind'],
      reviewStatus: decision.reviewRequest.status as V1DecisionContext['reviewStatus'],
      reviewVersion: decision.reviewRequest.version,
      subjectDigest: decision.reviewRequest.subjectDigest,
      documentRevisionId: decision.reviewRequest.documentRevisionId,
      artifactSetId: decision.reviewRequest.artifactSetId,
      taskId: decision.reviewRequest.taskId,
      decision: decision.decision as V1DecisionContext['decision'],
      createdById: decision.createdByStamp?.userId ?? '',
      revoked: decision.revocation !== null,
      knowledgeBaseId: decision.reviewRequest.documentRevision?.document.knowledgeBaseId ?? null,
      slot: {
        id: decision.approvalSlot.id,
        slotKey: decision.approvalSlot.slotKey,
        kind: decision.approvalSlot.kind,
        requiredRoleId: decision.approvalSlot.requiredRoleId,
        requiredUserId: decision.approvalSlot.requiredUserId ?? '',
        sourceSlotBindingId: decision.approvalSlot.sourceSlotBindingId,
      },
    };
  }

  async findDocumentReviewSubject(revisionId: string): Promise<V1DocumentReviewSubject | null> {
    const revision = await this.prisma.documentRevision.findUnique({
      where: { id: revisionId },
      select: {
        id: true,
        sha256: true,
        document: {
          select: {
            id: true,
            projectId: true,
            knowledgeBaseId: true,
            kind: true,
            version: true,
            archivedAt: true,
            knowledgeBase: { select: { archivedAt: true } },
          },
        },
      },
    });
    const document = revision?.document;
    if (!revision || !document) return null;
    return {
      revisionId: revision.id,
      projectId: document.projectId,
      knowledgeBaseId: document.knowledgeBaseId,
      documentId: document.id,
      documentKind: document.kind as V1DocumentReviewSubject['documentKind'],
      documentVersion: document.version,
      revisionDigest: revision.sha256,
      archived: document.archivedAt !== null || document.knowledgeBase.archivedAt !== null,
    };
  }

  async findArtifactReviewSubject(artifactSetId: string): Promise<V1ArtifactReviewSubject | null> {
    const set = await this.prisma.artifactSet.findUnique({
      where: { id: artifactSetId },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        taskGeneration: true,
        manifestDigest: true,
        task: { select: { id: true, version: true, roleId: true, responsibleUserId: true } },
      },
    });
    if (!set || set.taskId !== set.task.id) return null;
    return {
      artifactSetId: set.id,
      projectId: set.projectId,
      taskId: set.taskId,
      taskVersion: set.task.version,
      taskGeneration: set.taskGeneration,
      taskRoleId: set.task.roleId,
      responsibleUserId: set.task.responsibleUserId,
      manifestDigest: set.manifestDigest,
    };
  }

  async createReviewRequest(
    input: V1CreateReviewRequestInput,
  ): Promise<V1CreateReviewRequestResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runCreateReviewRequest(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  async listReviews(query: V1ReviewListQuery): Promise<V1ReviewListResult> {
    const rows = await this.prisma.reviewRequest.findMany({
      where: reviewListWhere(query),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      include: REVIEW_SNAPSHOT_INCLUDE,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map((row) => toSnapshot(row)),
      nextCursor:
        hasMore && last ? encodeReviewCursor({ createdAt: last.createdAt, id: last.id }) : null,
      hasMore,
    };
  }

  private async runCreateReviewRequest(
    input: V1CreateReviewRequestInput,
  ): Promise<V1CreateReviewRequestResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1) 项目行锁定串行化同项目写；再共享锁用户行，保持与决定/撤销一致的锁顺序。
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${input.actor.userId}::uuid FOR SHARE`,
        );

        // 1b) 同键并发在拿到项目锁后复核幂等记录：后到者必须返回先提交的同一结果，
        //     同键异语义按 409 拒绝，而不是等唯一约束报错。
        const replay = await tx.idempotentOperation.findUnique({
          where: {
            projectScopeKey_principalScopeKey_key: {
              projectScopeKey: input.operation.projectScopeKey,
              principalScopeKey: input.operation.principalScopeKey,
              key: input.operation.key,
            },
          },
          select: { id: true, method: true, route: true, requestDigest: true, resultRefs: true },
        });
        if (replay) {
          if (
            replay.method.toUpperCase() !== input.operation.method.toUpperCase() ||
            normalizeRoute(replay.route) !== normalizeRoute(input.operation.route)
          )
            throw new WorkmeshError(
              V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              'IDEMPOTENCY_ROUTE_CONFLICT',
              { operationId: replay.id },
              409,
            );
          if (replay.requestDigest !== input.operation.requestDigest)
            throw new WorkmeshError(
              V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
              'IDEMPOTENCY_DIGEST_CONFLICT',
              { operationId: replay.id },
              409,
            );
          const refs =
            typeof replay.resultRefs === 'object' &&
            replay.resultRefs !== null &&
            !Array.isArray(replay.resultRefs)
              ? (replay.resultRefs as Record<string, unknown>)
              : {};
          const reviewId = typeof refs.reviewRequestId === 'string' ? refs.reviewRequestId : '';
          if (!reviewId)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'REVIEW_NOT_FOUND',
              { reviewId },
              404,
            );
          return { review: await this.snapshotInTransaction(tx, reviewId), created: false };
        }

        // 2) 事务内重读主体并派生 kind、摘要与槽位；不使用事务外读到的旧值。
        const derived =
          input.subject.kind === 'DOCUMENT_REVISION'
            ? await this.deriveDocumentSubject(tx, input)
            : await this.deriveArtifactSubject(tx, input);

        // 3) 同一 subject 已有 OPEN 请求时只返回既有请求，不重复创建。
        const existing = await tx.reviewRequest.findFirst({
          where: {
            projectId: input.projectId,
            status: 'OPEN',
            ...(derived.documentRevisionId
              ? { documentRevisionId: derived.documentRevisionId }
              : { artifactSetId: derived.artifactSetId }),
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, version: true },
        });
        if (existing) {
          await tx.idempotentOperation.create({
            data: {
              id: input.operation.id,
              projectId: input.projectId,
              projectScopeKey: input.operation.projectScopeKey,
              principalScopeKey: input.operation.principalScopeKey,
              key: input.operation.key,
              method: input.operation.method,
              route: input.operation.route,
              requestDigest: input.operation.requestDigest,
              resultRefs: {
                reviewRequestId: existing.id,
                version: existing.version,
                created: false,
              },
              responseMetadata: { reviewKind: derived.kind },
            },
          });
          return { review: await this.snapshotInTransaction(tx, existing.id), created: false };
        }

        const review = await tx.reviewRequest.create({
          data: {
            projectId: input.projectId,
            kind: derived.kind,
            documentRevisionId: derived.documentRevisionId,
            artifactSetId: derived.artifactSetId,
            taskId: derived.taskId,
            taskGeneration: derived.taskGeneration,
            subjectDigest: derived.subjectDigest,
            version: 1,
            status: 'OPEN',
          },
          select: { id: true, version: true },
        });

        await tx.approvalSlot.createMany({
          data: derived.slots.map((slot) => ({
            projectId: input.projectId,
            reviewRequestId: review.id,
            slotKey: slot.slotKey,
            kind: derived.kind,
            requiredUserId: slot.requiredUserId,
            requiredRoleId: slot.requiredRoleId,
            sourceSlotBindingId: null,
          })),
        });

        const stamp = await tx.principalStamp.create({
          data: {
            kind: input.actor.kind,
            userId: input.actor.userId,
            webSessionId: input.actor.webSessionId,
            agentCredentialId: input.actor.agentCredentialId,
            projectId: input.projectId,
            roleId: input.actor.roleId,
            scopeSnapshot: [...input.actor.scopeSnapshot],
            userAuthVersion: input.actor.userAuthVersion,
          },
        });

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            actorStampId: stamp.id,
            action: 'REVIEW_REQUEST_CREATE',
            targetType: 'REVIEW_REQUEST',
            targetId: review.id,
            targetVersion: review.version,
            outcome: 'SUCCESS',
            details: {
              subjectKind: input.subject.kind,
              subjectId: input.subject.id,
              reviewKind: derived.kind,
              slotKeys: derived.slots.map((slot) => slot.slotKey),
            },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: input.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: { reviewRequestId: review.id, version: review.version, created: true },
            responseMetadata: { reviewKind: derived.kind },
          },
        });

        return { review: await this.snapshotInTransaction(tx, review.id), created: true };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async deriveDocumentSubject(
    tx: V1TransactionClient,
    input: V1CreateReviewRequestInput,
  ): Promise<DerivedReview> {
    const revision = await tx.documentRevision.findUnique({
      where: { id: input.subject.id },
      select: {
        id: true,
        sha256: true,
        document: {
          select: {
            id: true,
            projectId: true,
            kind: true,
            version: true,
            archivedAt: true,
            knowledgeBase: {
              select: {
                archivedAt: true,
                publicationApproverUserId: true,
                publicationApproverRoleId: true,
              },
            },
          },
        },
      },
    });
    const document = revision?.document;
    if (
      !revision ||
      !document ||
      document.projectId !== input.projectId ||
      document.archivedAt !== null ||
      document.knowledgeBase.archivedAt !== null
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REVIEW_SUBJECT_NOT_FOUND',
        { revisionId: input.subject.id },
        404,
      );
    if (document.version !== input.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        {
          documentId: document.id,
          expectedVersion: input.expectedVersion,
          currentVersion: document.version,
        },
        409,
      );

    // taskId 可选关联；只接受本项目任务，不能把评审挂到别项目。
    if (input.taskId) {
      const task = await tx.task.findFirst({
        where: { id: input.taskId, projectId: input.projectId },
        select: { id: true },
      });
      if (!task)
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'TASK_SUBJECT_MISMATCH',
          { taskId: input.taskId, revisionId: revision.id },
          422,
        );
    }

    return {
      kind: documentReviewKindOf(document.kind as V1DocumentReviewSubject['documentKind']),
      subjectDigest: revision.sha256,
      slots: [
        {
          slotKey: 'publication',
          requiredUserId: document.knowledgeBase.publicationApproverUserId,
          requiredRoleId: document.knowledgeBase.publicationApproverRoleId,
        },
      ],
      documentRevisionId: revision.id,
      artifactSetId: null,
      taskId: input.taskId,
      taskGeneration: null,
    };
  }

  private async deriveArtifactSubject(
    tx: V1TransactionClient,
    input: V1CreateReviewRequestInput,
  ): Promise<DerivedReview> {
    const set = await tx.artifactSet.findUnique({
      where: { id: input.subject.id },
      select: {
        id: true,
        projectId: true,
        taskId: true,
        taskGeneration: true,
        manifestDigest: true,
        workflowDefinitionRevisionId: true,
        task: {
          select: {
            id: true,
            version: true,
            roleId: true,
            stepKey: true,
            workflowInstanceId: true,
          },
        },
      },
    });
    if (!set || set.projectId !== input.projectId || set.taskId !== set.task.id)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REVIEW_SUBJECT_NOT_FOUND',
        { artifactSetId: input.subject.id },
        404,
      );

    if (input.taskId !== null && input.taskId !== set.taskId)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'TASK_SUBJECT_MISMATCH',
        { taskId: input.taskId, artifactSetId: set.id },
        422,
      );
    if (set.task.version !== input.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        {
          taskId: set.taskId,
          expectedVersion: input.expectedVersion,
          currentVersion: set.task.version,
        },
        409,
      );

    const revision = await tx.workflowRevision.findUnique({
      where: { id: set.workflowDefinitionRevisionId },
      select: { definition: true },
    });
    const instance = await tx.workflowInstance.findFirst({
      where: { id: set.task.workflowInstanceId, projectId: input.projectId },
      select: { bindings: true },
    });
    if (!revision || !instance)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'TASK_ACCEPTANCE_GATE_MISSING',
        { artifactSetId: set.id, taskId: set.taskId },
        422,
      );

    const bindings: V1AcceptanceSlotBinding[] = taskAcceptanceSlotBindings(
      revision.definition,
      instance.bindings,
      set.task.stepKey,
      set.taskId,
    );
    if (bindings.length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'TASK_ACCEPTANCE_GATE_REQUIRED',
        { artifactSetId: set.id, taskId: set.taskId, stepKey: set.task.stepKey },
        422,
      );

    return {
      kind: 'TASK_ACCEPTANCE',
      subjectDigest: set.manifestDigest,
      slots: bindings.map((binding) => ({
        slotKey: binding.slotKey,
        requiredUserId: binding.userId,
        requiredRoleId: binding.roleId,
      })),
      documentRevisionId: null,
      artifactSetId: set.id,
      taskId: set.taskId,
      taskGeneration: set.taskGeneration,
    };
  }

  async revokeDecision(input: V1RevokeInput): Promise<V1RevokeResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runRevoke(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runRevoke(input: V1RevokeInput): Promise<V1RevokeResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1) 决定与父请求、项目锁顺序固定；撤销必须与票据消费、指针失效同事务。
        const decision = await tx.reviewDecision.findUnique({
          where: { id: input.decisionId },
          select: {
            id: true,
            projectId: true,
            reviewRequestId: true,
            approvalSlotId: true,
            decision: true,
            revocation: { select: { id: true } },
            reviewRequest: {
              select: {
                id: true,
                status: true,
                version: true,
                taskId: true,
                documentRevisionId: true,
              },
            },
          },
        });
        if (!decision)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REVIEW_DECISION_NOT_FOUND',
            { decisionId: input.decisionId },
            404,
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${decision.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${input.actorUserId}::uuid FOR SHARE`,
        );

        // 2) 事务内复核决定、父请求状态与版本，不接受事务外旧值。
        if (decision.decision !== 'APPROVE')
          throw new WorkmeshError(
            V1_ERROR_CODES.VALIDATION_FAILED,
            'REVOCATION_NOT_APPLICABLE',
            { decisionId: input.decisionId },
            422,
          );
        if (decision.revocation)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'DECISION_ALREADY_REVOKED',
            { decisionId: input.decisionId },
            409,
          );
        const review = decision.reviewRequest;
        if (review.status !== 'APPROVED' && review.status !== 'OPEN')
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_CLOSED,
            'REVIEW_CLOSED',
            { reviewId: review.id, status: review.status },
            409,
          );
        if (review.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            {
              reviewId: review.id,
              expectedVersion: input.expectedVersion,
              currentVersion: review.version,
            },
            409,
          );

        // 3) 条件消费票据：并发两次撤销只允许一次成功。
        const consumed = await tx.$executeRaw(
          Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
            SET "consumedAt" = ${input.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${input.operationId}::uuid
            WHERE "id" = ${input.ticket.id}::uuid
              AND "secretHash" = ${input.ticket.secretHash}
              AND "webSessionId" = ${input.ticket.webSessionId}::uuid
              AND "consumedAt" IS NULL
              AND "invalidatedAt" IS NULL
              AND "expiresAt" > ${input.now}`,
        );
        if (consumed !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );

        const actor = await tx.user.findUnique({
          where: { id: input.actorUserId },
          select: { id: true, authVersion: true },
        });
        if (!actor)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'ACTOR_NOT_FOUND',
            { userId: input.actorUserId },
            404,
          );

        const stamp = await tx.principalStamp.create({
          data: {
            kind: 'HUMAN',
            userId: input.actorUserId,
            webSessionId: input.ticket.webSessionId,
            projectId: decision.projectId,
            roleId: input.roleSlot?.roleId ?? null,
            userAuthVersion: actor.authVersion,
          },
        });

        const revocation = await tx.reviewDecisionRevocation.create({
          data: {
            projectId: decision.projectId,
            decisionId: decision.id,
            reason: input.reason,
            confirmationTicketId: input.ticket.id,
            createdByStampId: stamp.id,
          },
        });

        // 撤销后同一请求的该槽位无法再次决定（每槽每请求仅一条决定），因此父请求整体失效，
        // 需要重新创建请求，不能复用旧批准。
        await tx.reviewRequest.update({
          where: { id: review.id },
          data: { status: 'INVALIDATED', version: { increment: 1 } },
        });

        const affectedTaskIds = new Set<string>();
        if (review.taskId) affectedTaskIds.add(review.taskId);

        // 4) 失效当前发布指针：仅处理“已批准并产生发布”的请求；未决请求的局部批准撤销只
        //    令请求失效，不改发布指针。无指针则只追加撤销，不改历史发布记录。
        if (review.documentRevisionId && review.status === 'APPROVED') {
          const revision = await tx.documentRevision.findUnique({
            where: { id: review.documentRevisionId },
            select: { id: true, documentId: true },
          });
          if (!revision)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'REVISION_NOT_FOUND',
              { revisionId: review.documentRevisionId },
              404,
            );

          const ownPublication = await tx.documentPublication.findFirst({
            where: {
              documentId: revision.documentId,
              revisionId: revision.id,
              kind: 'PUBLISH',
              reviewRequestId: review.id,
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              revisionId: true,
              documentId: true,
              kind: true,
              reviewRequestId: true,
              previousPublicationId: true,
            },
          });
          if (!ownPublication)
            throw new WorkmeshError(
              V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
              'REVIEW_PRECONDITION_FAILED',
              { reviewId: review.id, revisionId: revision.id, condition: 'PUBLICATION_REQUIRED' },
              422,
            );

          const document = await tx.knowledgeDocument.findUnique({
            where: { id: revision.documentId },
            select: {
              id: true,
              version: true,
              kind: true,
              requirementId: true,
              currentPublishedRevisionId: true,
            },
          });
          if (!document)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'DOCUMENT_NOT_FOUND',
              { documentId: revision.documentId },
              404,
            );

          if (document.currentPublishedRevisionId === revision.id) {
            const cleared = await tx.$executeRaw(
              Prisma.sql`UPDATE "workmesh_v1"."KnowledgeDocument"
                SET "version" = "version" + 1,
                    "currentPublishedRevisionId" = NULL,
                    "updatedAt" = now()
                WHERE "id" = ${document.id}::uuid
                  AND "version" = ${document.version}
                  AND "currentPublishedRevisionId" = ${revision.id}::uuid`,
            );
            if (cleared !== 1)
              throw new WorkmeshError(
                V1_ERROR_CODES.VERSION_CONFLICT,
                'PUBLICATION_REVOKE_CONFLICT',
                { documentId: document.id, revisionId: revision.id },
                409,
              );

            await tx.documentPublication.create({
              data: {
                projectId: decision.projectId,
                documentId: revision.documentId,
                revisionId: revision.id,
                kind: 'WITHDRAW',
                reviewRequestId: review.id,
                previousPublicationId: ownPublication.id,
                reason: `decision-revoked:${decision.id}`,
              },
            });

            // 需求当前理解/PRD 指针同步失效并推进 generation，旧快照/认领立即过期；
            // 历史 phase 不回退，由当前 gate 状态另行表达。
            if (
              (document.kind === 'UNDERSTANDING' || document.kind === 'PRD') &&
              document.requirementId
            ) {
              const requirement = await tx.requirement.findUnique({
                where: { id: document.requirementId },
                select: {
                  id: true,
                  version: true,
                  currentUnderstandingRevisionId: true,
                  currentPrdRevisionId: true,
                },
              });
              if (!requirement)
                throw new WorkmeshError(
                  V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                  'REQUIREMENT_NOT_FOUND',
                  { requirementId: document.requirementId },
                  404,
                );
              const pointerMatches =
                document.kind === 'UNDERSTANDING'
                  ? requirement.currentUnderstandingRevisionId === revision.id
                  : requirement.currentPrdRevisionId === revision.id;
              if (pointerMatches) {
                const advanced = await tx.requirement.updateMany({
                  where: { id: requirement.id, version: requirement.version },
                  data: {
                    version: { increment: 1 },
                    generation: { increment: 1 },
                    ...(document.kind === 'UNDERSTANDING'
                      ? { currentUnderstandingRevisionId: null }
                      : { currentPrdRevisionId: null, deliveryScope: Prisma.JsonNull }),
                  },
                });
                if (advanced.count !== 1)
                  throw new WorkmeshError(
                    V1_ERROR_CODES.VERSION_CONFLICT,
                    'REQUIREMENT_VERSION_CONFLICT',
                    { requirementId: requirement.id },
                    409,
                  );
              }
            }
          }

          // 任何以该修订为输入快照资源的任务都失去基线，必须重新认领。
          const refs = await tx.snapshotResourceRef.findMany({
            where: { documentRevisionId: revision.id },
            select: { snapshot: { select: { taskId: true } } },
          });
          for (const ref of refs) affectedTaskIds.add(ref.snapshot.taskId);
        }

        // 5) 受影响任务统一失效：generation/version++、回到 OPEN、释放 claim、清空当前指针；
        //    PAUSED/CANCELLED 的工作状态保留，不被撤销动作复活。
        const taskIds = [...affectedTaskIds].sort();
        if (taskIds.length > 0) {
          const tasks = await tx.task.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, version: true, workStatus: true, currentClaimId: true },
          });
          for (const task of tasks) {
            if (task.currentClaimId) {
              await tx.taskClaim.updateMany({
                where: { id: task.currentClaimId, releasedAt: null },
                data: { releasedAt: input.now, releaseReason: `baseline-invalidated:${review.id}` },
              });
            }
            const updated = await tx.task.updateMany({
              where: { id: task.id, version: task.version },
              data: {
                version: { increment: 1 },
                generation: { increment: 1 },
                executionStatus: 'OPEN',
                ...(task.workStatus === 'PAUSED' || task.workStatus === 'CANCELLED'
                  ? {}
                  : { workStatus: 'ACTIVE' as const }),
                currentClaimId: null,
                currentSnapshotId: null,
                currentArtifactSetId: null,
              },
            });
            if (updated.count !== 1)
              throw new WorkmeshError(
                V1_ERROR_CODES.VERSION_CONFLICT,
                'TASK_VERSION_CONFLICT',
                { taskId: task.id },
                409,
              );

            // 旧验收不再有效：同任务其它未决验收请求一并失效。
            await tx.reviewRequest.updateMany({
              where: { status: 'OPEN', taskId: task.id, id: { not: review.id } },
              data: { status: 'INVALIDATED', version: { increment: 1 } },
            });
          }
        }

        await tx.auditEvent.create({
          data: {
            projectId: decision.projectId,
            actorStampId: stamp.id,
            action: 'REVIEW_DECISION_REVOKE',
            targetType: 'REVIEW_DECISION',
            targetId: decision.id,
            targetVersion: review.version,
            outcome: 'SUCCESS',
            details: { reviewRequestId: review.id, affectedTaskIds: taskIds },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operationId,
            projectId: decision.projectId,
            projectScopeKey: input.projectScopeKey,
            principalScopeKey: input.principalScopeKey,
            key: input.operationKey,
            method: input.method,
            route: input.route,
            requestDigest: input.requestDigest,
            resultRefs: {
              reviewRequestId: review.id,
              decisionId: decision.id,
              revocationId: revocation.id,
              reason: input.reason,
              revokedAt: input.now.toISOString(),
              affectedTaskIds: taskIds,
            },
            responseMetadata: { reviewVersion: review.version + 1 },
          },
        });

        return {
          revocation: {
            id: revocation.id,
            decisionId: decision.id,
            reason: revocation.reason,
            createdAt: revocation.createdAt,
          },
          affectedTaskIds: taskIds,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async commitDecision(input: V1CommitDecisionInput): Promise<V1CommitDecisionResult> {
    let attempt = 0;
    // 序列化冲突最多重试三次；版本或业务前提变化返回 409，不把它当序列化冲突自动换意图。
    for (;;) {
      try {
        return await this.runCommit(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runCommit(input: V1CommitDecisionInput): Promise<V1CommitDecisionResult> {
    return this.prisma.$transaction(
      async (tx) => {
        // 1) 读取 review，再按固定锁顺序锁 Project 行 FOR UPDATE（项目级串行写边界）。
        const review = await tx.reviewRequest.findUnique({
          where: { id: input.reviewId },
          include: { approvalSlots: true, decisions: true },
        });
        if (!review)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REVIEW_NOT_FOUND',
            { reviewId: input.reviewId },
            404,
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${review.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${input.actorUserId}::uuid FOR SHARE`,
        );

        // 2) 事务内重新读取状态、版本与 subject 摘要，不使用事务外读到的旧值。
        if (review.status !== 'OPEN')
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_CLOSED,
            'REVIEW_CLOSED',
            { reviewId: review.id },
            409,
          );
        if (review.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            {
              reviewId: review.id,
              expectedVersion: input.expectedVersion,
              currentVersion: review.version,
            },
            409,
          );
        if (review.subjectDigest !== input.subjectDigest)
          throw new WorkmeshError(
            V1_ERROR_CODES.REVISION_DIGEST_CHANGED,
            'REVISION_DIGEST_CHANGED',
            { reviewId: review.id },
            409,
          );

        const slot = review.approvalSlots.find((item) => item.id === input.slotId);
        if (!slot)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REVIEW_SLOT_NOT_FOUND',
            { slotId: input.slotId },
            404,
          );
        if (review.decisions.some((item) => item.approvalSlotId === input.slotId))
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_SLOT_DECIDED,
            'REVIEW_SLOT_DECIDED',
            { slotId: input.slotId },
            409,
          );

        // 3) 条件消费票据：要求影响行数恰为 1；并发两次消费只允许一次成功。
        const consumed = await tx.$executeRaw(
          Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
            SET "consumedAt" = ${input.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${input.operationId}::uuid
            WHERE "id" = ${input.ticket.id}::uuid
              AND "secretHash" = ${input.ticket.secretHash}
              AND "webSessionId" = ${input.ticket.webSessionId}::uuid
              AND "consumedAt" IS NULL
              AND "invalidatedAt" IS NULL
              AND "expiresAt" > ${input.now}`,
        );
        if (consumed !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );

        // 4) 审计主体 stamp：HUMAN 必须绑定真实 WebSession，且不携带 Agent 凭据。
        const actor = await tx.user.findUnique({
          where: { id: input.actorUserId },
          select: { id: true, authVersion: true },
        });
        if (!actor)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'ACTOR_NOT_FOUND',
            { userId: input.actorUserId },
            404,
          );
        const stamp = await tx.principalStamp.create({
          data: {
            kind: 'HUMAN',
            userId: input.actorUserId,
            webSessionId: input.ticket.webSessionId,
            projectId: review.projectId,
            roleId: input.roleSlot?.roleId ?? null,
            userAuthVersion: actor.authVersion,
          },
        });

        const decision = await tx.reviewDecision.create({
          data: {
            projectId: review.projectId,
            reviewRequestId: review.id,
            approvalSlotId: slot.id,
            decision: input.decision,
            subjectDigest: review.subjectDigest,
            comment: input.comment,
            confirmationTicketId: input.ticket.id,
            createdByStampId: stamp.id,
          },
        });

        const approvedSlots = new Set(
          [...review.decisions, decision]
            .filter((item) => item.decision === 'APPROVE')
            .map((item) => item.approvalSlotId),
        );
        const allApproved =
          review.approvalSlots.length > 0 &&
          review.approvalSlots.every((item) => approvedSlots.has(item.id)) &&
          input.decision === 'APPROVE';

        let published = false;
        let publicationId: string | null = null;
        let documentVersion: number | null = null;
        /** CHANGES_REQUESTED/REJECT 影响的任务；审计与结果追溯使用，不改变旧发布历史。 */
        let affectedTaskIds: string[] = [];
        let subjectResult: V1SubjectResult | null = null;
        let taskState: V1TaskState | null = null;
        let requirementState: V1RequirementState | null = null;

        if (
          allApproved &&
          (review.kind === 'TASK_ACCEPTANCE' || review.kind === 'RELEASE_ACCEPTANCE')
        ) {
          // 工件验收：复核当前快照/代次/工件集与 IMPL 证据，随后把任务置 DONE，
          // 并按步骤 kind 推进需求阶段（RELEASE 需全部任务 DONE）。
          const accepted = await this.completeAcceptanceTask(tx, {
            projectId: review.projectId,
            reviewId: review.id,
            taskId: review.taskId,
            taskGeneration: review.taskGeneration,
            artifactSetId: review.artifactSetId,
            now: input.now,
          });
          affectedTaskIds = [accepted.task.id];
          taskState = accepted.task;
          requirementState = accepted.requirement;
          subjectResult = {
            kind: 'ACCEPTED',
            taskId: accepted.task.id,
            taskVersion: accepted.task.version,
            requirement: accepted.requirement,
          };
          await tx.reviewRequest.update({
            where: { id: review.id },
            data: { status: 'APPROVED', version: { increment: 1 } },
          });
        } else if (review.documentRevisionId && allApproved) {
          const revision = await tx.documentRevision.findUnique({
            where: { id: review.documentRevisionId },
            select: {
              id: true,
              projectId: true,
              documentId: true,
              sha256: true,
              basisUnderstandingRevisionId: true,
              deliveryScope: true,
            },
          });
          if (!revision)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'REVISION_NOT_FOUND',
              { revisionId: review.documentRevisionId },
              404,
            );
          if (revision.sha256 !== review.subjectDigest)
            throw new WorkmeshError(
              V1_ERROR_CODES.REVISION_DIGEST_CHANGED,
              'REVISION_DIGEST_CHANGED',
              { revisionId: revision.id },
              409,
            );

          const document = await tx.knowledgeDocument.findUnique({
            where: { id: revision.documentId },
            select: {
              id: true,
              version: true,
              kind: true,
              requirementId: true,
              currentPublishedRevisionId: true,
            },
          });
          if (!document)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'DOCUMENT_NOT_FOUND',
              { documentId: revision.documentId },
              404,
            );

          // 评审 kind 必须与文档 kind 精确对应：理解确认、PRD 发布、知识发布互不替代。
          const expectedKind =
            document.kind === 'UNDERSTANDING'
              ? 'UNDERSTANDING_CONFIRM'
              : document.kind === 'PRD'
                ? 'PRD_PUBLICATION'
                : 'KNOWLEDGE_PUBLICATION';
          if (review.kind !== expectedKind)
            throw new WorkmeshError(
              V1_ERROR_CODES.INVALID_REQUEST,
              'REVIEW_KIND_MISMATCH',
              { reviewKind: review.kind, documentKind: document.kind },
              409,
            );

          // 5) 准确 CAS：IS DISTINCT FROM 正确处理首次发布时指针为 NULL 的情况；
          //    重复发布同一 revision 命中 0 行，按并发冲突处理。
          const updated = await tx.$executeRaw(
            Prisma.sql`UPDATE "workmesh_v1"."KnowledgeDocument"
              SET "version" = "version" + 1,
                  "currentPublishedRevisionId" = ${revision.id}::uuid,
                  "updatedAt" = now()
              WHERE "id" = ${document.id}::uuid
                AND "version" = ${document.version}
                AND "currentPublishedRevisionId" IS DISTINCT FROM ${revision.id}::uuid`,
          );
          if (updated !== 1)
            throw new WorkmeshError(
              V1_ERROR_CODES.VERSION_CONFLICT,
              'PUBLISH_CONFLICT',
              { documentId: document.id, revisionId: revision.id },
              409,
            );
          documentVersion = document.version + 1;

          const publication = await tx.documentPublication.create({
            data: {
              projectId: revision.projectId,
              documentId: revision.documentId,
              revisionId: revision.id,
              kind: 'PUBLISH',
              reviewRequestId: review.id,
              reason: `review-approved:${review.id}`,
            },
          });
          publicationId = publication.id;
          published = true;

          // 理解确认与 PRD 发布在同一事务推进需求指针、阶段与代次；旧的快照/认领立即失效。
          if (document.kind === 'UNDERSTANDING' || document.kind === 'PRD') {
            if (!document.requirementId)
              throw new WorkmeshError(
                V1_ERROR_CODES.INVALID_REQUEST,
                'REQUIREMENT_REQUIRED_DOCUMENT',
                { documentId: document.id },
                422,
              );
            const requirement = await tx.requirement.findUnique({
              where: { id: document.requirementId },
              select: {
                id: true,
                version: true,
                generation: true,
                phase: true,
                currentUnderstandingRevisionId: true,
              },
            });
            if (!requirement)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'REQUIREMENT_NOT_FOUND',
                { requirementId: document.requirementId },
                404,
              );
            if (document.kind === 'PRD') {
              if (
                revision.basisUnderstandingRevisionId !== requirement.currentUnderstandingRevisionId
              )
                throw new WorkmeshError(
                  V1_ERROR_CODES.BASELINE_STALE,
                  'PRD_BASIS_STALE',
                  {
                    basisUnderstandingRevisionId: revision.basisUnderstandingRevisionId,
                    currentUnderstandingRevisionId: requirement.currentUnderstandingRevisionId,
                  },
                  409,
                );
            }
            const advanced = await tx.requirement.updateMany({
              where: {
                id: requirement.id,
                version: requirement.version,
                generation: requirement.generation,
              },
              data: {
                version: { increment: 1 },
                generation: { increment: 1 },
                phase:
                  document.kind === 'UNDERSTANDING'
                    ? atLeastPhase(requirement.phase, 'DEFINITION')
                    : atLeastPhase(requirement.phase, 'DELIVERY'),
                ...(document.kind === 'UNDERSTANDING'
                  ? { currentUnderstandingRevisionId: revision.id }
                  : {
                      currentPrdRevisionId: revision.id,
                      deliveryScope: (revision.deliveryScope ??
                        Prisma.JsonNull) as Prisma.InputJsonValue,
                    }),
              },
            });
            if (advanced.count !== 1)
              throw new WorkmeshError(
                V1_ERROR_CODES.VERSION_CONFLICT,
                'REQUIREMENT_VERSION_CONFLICT',
                { requirementId: requirement.id },
                409,
              );
            // 同文档其它未决评审请求随新基线失效，不能再用旧候选批准当前版本。
            await tx.reviewRequest.updateMany({
              where: {
                status: 'OPEN',
                id: { not: review.id },
                documentRevision: { documentId: revision.documentId },
              },
              data: { status: 'INVALIDATED', version: { increment: 1 } },
            });
          }

          await tx.reviewRequest.update({
            where: { id: review.id },
            data: { status: 'APPROVED', version: { increment: 1 } },
          });
        } else if (input.decision !== 'APPROVE') {
          const rejected = input.decision === 'REJECT';
          await tx.reviewRequest.update({
            where: { id: review.id },
            data: {
              status: rejected ? 'REJECTED' : 'CHANGES_REQUESTED',
              version: { increment: 1 },
            },
          });

          // 返修：绑定任务进入新 generation 并回到 OPEN/ACTIVE，废止 claim/当前 set；
          // 按已发布流程定义的 deps 传递失效下游任务，旧验收请求一并作废。
          // 拒绝：任务 OPEN/BLOCKED，保留拒绝原因，不把拒绝当需求撤回；候选不发布。
          if (review.taskId) {
            affectedTaskIds = rejected
              ? await this.blockTaskAfterReject(tx, {
                  projectId: review.projectId,
                  reviewId: review.id,
                  taskId: review.taskId,
                  now: input.now,
                })
              : await this.reworkTaskTree(tx, {
                  projectId: review.projectId,
                  reviewId: review.id,
                  taskId: review.taskId,
                  now: input.now,
                });
          }
        }

        // 语义结果只描述本次决定的客观效应：发布、验收、返修、拒绝或仅记录一票。
        if (!subjectResult) {
          if (published && publicationId !== null && documentVersion !== null)
            subjectResult = { kind: 'PUBLISHED', publicationId, documentVersion };
          else if (input.decision === 'REJECT')
            subjectResult = { kind: 'REJECTED', affectedTaskIds };
          else if (input.decision === 'CHANGES_REQUESTED')
            subjectResult = { kind: 'REWORK', affectedTaskIds };
          else
            subjectResult = {
              kind: 'RECORDED',
              approvedSlotIds: [...approvedSlots],
              remainingSlotIds: review.approvalSlots
                .filter((item) => !approvedSlots.has(item.id))
                .map((item) => item.id),
            };
        }

        // 6) 审计与幂等操作与业务同事务：任一步失败全部回滚。
        await tx.auditEvent.create({
          data: {
            projectId: review.projectId,
            actorStampId: stamp.id,
            action: 'REVIEW_DECIDE',
            targetType: 'REVIEW_REQUEST',
            targetId: review.id,
            targetVersion: review.version,
            outcome: 'SUCCESS',
            details: { decision: input.decision, slotId: slot.id, published, affectedTaskIds },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operationId,
            projectId: review.projectId,
            projectScopeKey: input.projectScopeKey,
            principalScopeKey: input.principalScopeKey,
            key: input.operationKey,
            method: input.method,
            route: input.route,
            requestDigest: input.requestDigest,
            resultRefs: {
              reviewRequestId: review.id,
              decisionId: decision.id,
              published,
              publicationId,
              documentVersion,
              // 重放必须返回与原请求一致语义结果，因此一并持久化。
              subjectResult,
              task: taskState,
              requirement: requirementState,
            },
            responseMetadata: {
              reviewVersion: review.version + (published || input.decision !== 'APPROVE' ? 1 : 0),
            },
          },
        });

        return {
          decisionId: decision.id,
          review: await this.snapshotInTransaction(tx, review.id),
          published,
          publicationId,
          documentVersion,
          approvedSlotIds: [...approvedSlots],
          subjectResult,
          task: taskState,
          requirement: requirementState,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /**
   * 工件验收终态：复核当前工件集/快照与任务代次一致，IMPL 步骤必须有绑定该工件集的已批准
   * 提交级证据；通过后释放 claim、任务置 DONE，并按步骤 kind 单调推进需求阶段。
   * RELEASE 步骤还要求同实例全部任务已 DONE（测试 9：必要任务全完成才 RELEASED）。
   */
  private async completeAcceptanceTask(
    tx: V1TransactionClient,
    input: {
      projectId: string;
      reviewId: string;
      taskId: string | null;
      taskGeneration: number | null;
      artifactSetId: string | null;
      now: Date;
    },
  ): Promise<{ task: V1TaskState; requirement: V1RequirementState | null }> {
    if (!input.taskId || !input.artifactSetId)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'ACCEPTANCE_SUBJECT_MISSING',
        { reviewId: input.reviewId, taskId: input.taskId, artifactSetId: input.artifactSetId },
        422,
      );

    const task = await tx.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: {
        id: true,
        version: true,
        generation: true,
        currentClaimId: true,
        currentArtifactSetId: true,
        workflowInstanceId: true,
        stepKey: true,
        instance: { select: { retiredAt: true } },
      },
    });
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );

    assertWorkflowInstanceActive(task.instance.retiredAt, {
      taskId: task.id,
      workflowInstanceId: task.workflowInstanceId,
    });

    const set = await tx.artifactSet.findFirst({
      where: { id: input.artifactSetId, projectId: input.projectId },
      select: { id: true, taskId: true, taskGeneration: true, snapshotId: true },
    });
    if (!set)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'ARTIFACT_SET_NOT_FOUND',
        { artifactSetId: input.artifactSetId },
        422,
      );

    const snapshot = await tx.contextSnapshot.findFirst({
      where: { id: set.snapshotId, projectId: input.projectId },
      select: {
        id: true,
        taskId: true,
        taskGeneration: true,
        requirementId: true,
        requirementGeneration: true,
      },
    });
    if (!snapshot)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'ARTIFACT_SNAPSHOT_NOT_FOUND',
        { snapshotId: set.snapshotId },
        422,
      );

    const requirement = await tx.requirement.findUnique({
      where: { id: snapshot.requirementId },
      select: { generation: true },
    });

    // 旧基线交付：评审、任务、工件集、快照、需求代次任一代次/指针不一致都不能验收。
    if (
      set.taskId !== task.id ||
      set.taskGeneration !== task.generation ||
      input.taskGeneration !== task.generation ||
      task.currentArtifactSetId !== set.id ||
      snapshot.taskId !== task.id ||
      snapshot.taskGeneration !== task.generation ||
      !requirement ||
      requirement.generation !== snapshot.requirementGeneration
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        'BASELINE_STALE',
        {
          taskId: task.id,
          taskGeneration: task.generation,
          reviewTaskGeneration: input.taskGeneration,
          setGeneration: set.taskGeneration,
          snapshotGeneration: snapshot.taskGeneration,
        },
        409,
      );

    return this.completeTaskAndAdvancePhase(tx, { task, snapshot, set, input });
  }

  /** 按 workflow 步骤定义复核 IMPL 证据、完成 DONE 并推进需求阶段。 */
  private async completeTaskAndAdvancePhase(
    tx: V1TransactionClient,
    ctx: {
      task: {
        id: string;
        version: number;
        generation: number;
        currentClaimId: string | null;
        workflowInstanceId: string;
        stepKey: string;
      };
      snapshot: { id: string; requirementId: string };
      set: { id: string };
      input: { projectId: string; reviewId: string; now: Date };
    },
  ): Promise<{ task: V1TaskState; requirement: V1RequirementState | null }> {
    const instance = await tx.workflowInstance.findFirst({
      where: { id: ctx.task.workflowInstanceId, projectId: ctx.input.projectId },
      select: { definitionRevisionId: true },
    });
    if (!instance)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'WORKFLOW_INSTANCE_NOT_FOUND',
        { instanceId: ctx.task.workflowInstanceId },
        404,
      );

    const revision = instance.definitionRevisionId
      ? await tx.workflowRevision.findUnique({
          where: { id: instance.definitionRevisionId },
          select: { definition: true },
        })
      : null;
    const definition = (revision?.definition ?? null) as {
      steps?: Array<{ key?: unknown; kind?: unknown; outputKinds?: unknown }>;
    } | null;
    const step = (definition?.steps ?? []).find((entry) => entry.key === ctx.task.stepKey);
    const outputKinds = Array.isArray(step?.outputKinds) ? step!.outputKinds : [];

    if (outputKinds.includes('IMPL')) {
      const evidence = await tx.codeReviewEvidence.findMany({
        where: { projectId: ctx.input.projectId, artifactSetId: ctx.set.id },
        select: { state: true, reviewerKind: true },
      });
      // 证据必须全部为 APPROVED 且非 Bot；任一 changes_requested/dismissed/pending 都拒绝。
      if (
        evidence.length === 0 ||
        evidence.some((item) => item.state !== 'APPROVED' || item.reviewerKind === 'BOT')
      )
        throw new WorkmeshError(
          V1_ERROR_CODES.CODE_EVIDENCE_MISSING,
          'CODE_REVIEW_EVIDENCE_MISSING',
          { taskId: ctx.task.id, artifactSetId: ctx.set.id },
          422,
        );
    }

    if (ctx.task.currentClaimId) {
      await tx.taskClaim.updateMany({
        where: { id: ctx.task.currentClaimId, releasedAt: null },
        data: { releasedAt: ctx.input.now, releaseReason: `task-accepted:${ctx.input.reviewId}` },
      });
    }
    const updated = await tx.task.updateMany({
      where: { id: ctx.task.id, version: ctx.task.version, generation: ctx.task.generation },
      data: { version: { increment: 1 }, executionStatus: 'DONE', currentClaimId: null },
    });
    if (updated.count !== 1)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'TASK_VERSION_CONFLICT',
        { taskId: ctx.task.id },
        409,
      );

    await this.advanceRequirementPhase(tx, {
      projectId: ctx.input.projectId,
      instanceId: ctx.task.workflowInstanceId,
      requirementId: ctx.snapshot.requirementId,
      stepKind: typeof step?.kind === 'string' ? step.kind : null,
      currentTaskId: ctx.task.id,
    });
    const requirement = await this.readRequirementState(
      tx,
      ctx.input.projectId,
      ctx.snapshot.requirementId,
    );
    return {
      task: {
        id: ctx.task.id,
        version: ctx.task.version + 1,
        generation: ctx.task.generation,
        executionStatus: 'DONE',
      },
      requirement,
    };
  }

  private async readRequirementState(
    tx: V1TransactionClient,
    projectId: string,
    requirementId: string,
  ): Promise<V1RequirementState | null> {
    const requirement = await tx.requirement.findFirst({
      where: { id: requirementId, projectId },
      select: { id: true, version: true, phase: true },
    });
    return requirement
      ? { id: requirement.id, version: requirement.version, phase: requirement.phase }
      : null;
  }

  private async advanceRequirementPhase(
    tx: V1TransactionClient,
    input: {
      projectId: string;
      instanceId: string;
      requirementId: string;
      stepKind: string | null;
      currentTaskId: string;
    },
  ): Promise<void> {
    const target = PHASE_BY_STEP_KIND[input.stepKind ?? ''];
    if (!target) return;

    if (target === 'RELEASED') {
      // 发布门：同实例其它任务必须全部 DONE，避免“局部完成即 RELEASED”。
      const remaining = await tx.task.count({
        where: {
          projectId: input.projectId,
          workflowInstanceId: input.instanceId,
          id: { not: input.currentTaskId },
          executionStatus: { not: 'DONE' },
        },
      });
      if (remaining > 0)
        throw new WorkmeshError(
          V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
          'RELEASE_TASKS_INCOMPLETE',
          { instanceId: input.instanceId, remainingTasks: remaining },
          422,
        );
    }

    const requirement = await tx.requirement.findFirst({
      where: { id: input.requirementId, projectId: input.projectId },
      select: { id: true, version: true, phase: true },
    });
    if (!requirement)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId: input.requirementId },
        404,
      );

    const currentIndex = PHASE_ORDER.indexOf(requirement.phase as Phase);
    const targetIndex = PHASE_ORDER.indexOf(target);
    if (currentIndex < 0 || requirement.phase === 'ARCHIVED' || currentIndex >= targetIndex) return;

    const changed = await tx.requirement.updateMany({
      where: { id: requirement.id, version: requirement.version },
      data: { version: { increment: 1 }, phase: target },
    });
    if (changed.count !== 1)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'REQUIREMENT_VERSION_CONFLICT',
        { requirementId: requirement.id },
        409,
      );
  }

  /**
   * 返修传播：绑定任务及其全部下游任务进入新 generation、回到 OPEN/ACTIVE、释放 claim 并清空
   * 当前快照/交付指针；同任务其它未决验收请求一并失效。下游集合只由已发布流程定义的 deps
   * 计算，不做全项目无差别失效。
   */
  private async reworkTaskTree(
    tx: V1TransactionClient,
    input: { projectId: string; reviewId: string; taskId: string; now: Date },
  ): Promise<string[]> {
    const root = await tx.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true, workflowInstanceId: true, stepKey: true },
    });
    if (!root)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );

    const instance = await tx.workflowInstance.findFirst({
      where: { id: root.workflowInstanceId, projectId: input.projectId },
      select: { id: true, definitionRevisionId: true },
    });
    if (!instance)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'WORKFLOW_INSTANCE_NOT_FOUND',
        { instanceId: root.workflowInstanceId },
        404,
      );

    let downstreamStepKeys: string[] = [];
    if (instance.definitionRevisionId) {
      const revision = await tx.workflowRevision.findUnique({
        where: { id: instance.definitionRevisionId },
        select: { definition: true },
      });
      if (!revision)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'WORKFLOW_REVISION_NOT_FOUND',
          { revisionId: instance.definitionRevisionId },
          404,
        );
      downstreamStepKeys = collectDownstreamStepKeys(revision.definition, root.stepKey);
    }

    const tasks = await tx.task.findMany({
      where: {
        projectId: input.projectId,
        workflowInstanceId: instance.id,
        stepKey: { in: [root.stepKey, ...downstreamStepKeys] },
      },
      select: { id: true, version: true, workStatus: true, currentClaimId: true },
      orderBy: { stepKey: 'asc' },
    });

    const affected: string[] = [];
    for (const task of tasks) {
      if (task.currentClaimId) {
        await tx.taskClaim.updateMany({
          where: { id: task.currentClaimId, releasedAt: null },
          data: { releasedAt: input.now, releaseReason: `changes-requested:${input.reviewId}` },
        });
      }
      const updated = await tx.task.updateMany({
        where: { id: task.id, version: task.version },
        data: {
          version: { increment: 1 },
          generation: { increment: 1 },
          executionStatus: 'OPEN',
          ...(task.workStatus === 'PAUSED' || task.workStatus === 'CANCELLED'
            ? {}
            : { workStatus: 'ACTIVE' as const }),
          currentClaimId: null,
          currentSnapshotId: null,
          currentArtifactSetId: null,
        },
      });
      if (updated.count !== 1)
        throw new WorkmeshError(
          V1_ERROR_CODES.VERSION_CONFLICT,
          'TASK_VERSION_CONFLICT',
          { taskId: task.id },
          409,
        );

      await tx.reviewRequest.updateMany({
        where: { status: 'OPEN', taskId: task.id, id: { not: input.reviewId } },
        data: { status: 'INVALIDATED', version: { increment: 1 } },
      });
      affected.push(task.id);
    }
    return affected.sort();
  }

  /** 拒绝：绑定任务回到 OPEN/BLOCKED，释放 claim，保留拒绝原因；不推进 generation、不发布。 */
  private async blockTaskAfterReject(
    tx: V1TransactionClient,
    input: { projectId: string; reviewId: string; taskId: string; now: Date },
  ): Promise<string[]> {
    const task = await tx.task.findFirst({
      where: { id: input.taskId, projectId: input.projectId },
      select: { id: true, version: true, currentClaimId: true },
    });
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );

    if (task.currentClaimId) {
      await tx.taskClaim.updateMany({
        where: { id: task.currentClaimId, releasedAt: null },
        data: { releasedAt: input.now, releaseReason: `review-rejected:${input.reviewId}` },
      });
    }
    const updated = await tx.task.updateMany({
      where: { id: task.id, version: task.version },
      data: {
        version: { increment: 1 },
        executionStatus: 'OPEN',
        workStatus: 'BLOCKED',
        currentClaimId: null,
      },
    });
    if (updated.count !== 1)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'TASK_VERSION_CONFLICT',
        { taskId: task.id },
        409,
      );
    return [task.id];
  }

  private async snapshotInTransaction(
    tx: V1TransactionClient,
    reviewId: string,
  ): Promise<V1ReviewSnapshot> {
    const review = await tx.reviewRequest.findUnique({
      where: { id: reviewId },
      include: REVIEW_SNAPSHOT_INCLUDE,
    });
    if (!review)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REVIEW_NOT_FOUND',
        { reviewId },
        404,
      );
    return toSnapshot(review);
  }
}
