import { Inject, Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Confirmation,
  type Principal,
} from '@workmesh/shared';
import { V1AuthorizationService, type ProjectManagementRole } from '../auth/v1-authorization';
import { actionDigestOf, verifyTicketBinding, V1_CONFIRMATION_REPOSITORY, type V1ConfirmationRepository, type V1TicketRecord } from '../auth/v1-confirmation';
import {
  assertReplayable,
  requestDigestOf,
  requireExpectedVersion,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import {
  V1_REVIEW_REPOSITORY,
  type V1CommitDecisionResult,
  type V1DecisionContext,
  type V1DecisionValue,
  type V1RequirementState,
  type V1ReviewListQuery,
  type V1ReviewListResult,
  type V1ReviewRepository,
  type V1ReviewSnapshot,
  type V1ReviewSubjectRef,
  type V1ReviewStatus,
  type V1RevocationSnapshot,
  type V1SubjectResult,
  type V1TaskState,
} from './v1-review.repository';

export const REVIEW_DECIDE_ACTION = 'REVIEW_DECIDE';
export const REVIEW_DECIDE_TARGET_TYPE = 'REVIEW_REQUEST';
export const REVIEW_REVOKE_ACTION = 'REVIEW_REVOKE';
export const REVIEW_REVOKE_TARGET_TYPE = 'REVIEW_DECISION';

export type V1DecideInput = {
  slotId: string;
  decision: V1DecisionValue;
  expectedVersion: number;
  comment?: string | null;
  confirmation: Confirmation;
};

export type V1DecideContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
  /** HUMAN 主体的当前 WebSession ID；票据必须绑定同一会话。 */
  webSessionId: string;
  userAuthVersion: number;
};

export type V1DecideResult = {
  review: V1ReviewSnapshot;
  decisionId: string;
  published: boolean;
  publicationId: string | null;
  documentVersion: number | null;
  subjectResult: V1SubjectResult | null;
  task: V1TaskState | null;
  requirement: V1RequirementState | null;
  replayed: boolean;
};

export type V1RevokeRequest = {
  expectedVersion: number;
  reason: string;
  confirmation: Confirmation;
};

export type V1RevokeResultView = {
  revocation: V1RevocationSnapshot;
  affectedTaskIds: string[];
  replayed: boolean;
};

export type V1RequestReviewInput = {
  subject: V1ReviewSubjectRef;
  expectedVersion: number;
  taskId?: string | null;
};

export type V1RequestReviewContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
  /** HUMAN WebSession；AGENT 无会话时为 null。 */
  webSessionId: string | null;
  userAuthVersion: number;
};

export type V1ListReviewsInput = {
  projectId: string;
  assignedToMe?: boolean;
  status?: V1ReviewStatus;
  limit?: number;
  cursor?: string;
};

/** 幂等记录里的 JSON 结果必须按运行时形状收窄，不能直接断言成领域类型。 */
function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringArrayOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function positiveIntOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function requirementStateOf(value: unknown): V1RequirementState | null {
  const record = recordOf(value);
  if (!record) return null;
  const version = positiveIntOf(record.version);
  if (typeof record.id !== 'string' || typeof record.phase !== 'string' || version === null) return null;
  return { id: record.id, version, phase: record.phase };
}

function taskStateOf(value: unknown): V1TaskState | null {
  const record = recordOf(value);
  if (!record) return null;
  const version = positiveIntOf(record.version);
  const generation = positiveIntOf(record.generation);
  if (
    typeof record.id !== 'string' ||
    version === null ||
    generation === null ||
    typeof record.executionStatus !== 'string'
  )
    return null;
  return { id: record.id, version, generation, executionStatus: record.executionStatus };
}

function subjectResultOf(value: unknown): V1SubjectResult | null {
  const record = recordOf(value);
  if (!record) return null;
  switch (record.kind) {
    case 'PUBLISHED': {
      const documentVersion = positiveIntOf(record.documentVersion);
      return typeof record.publicationId === 'string' && documentVersion !== null
        ? { kind: 'PUBLISHED', publicationId: record.publicationId, documentVersion }
        : null;
    }
    case 'ACCEPTED': {
      const taskVersion = positiveIntOf(record.taskVersion);
      return typeof record.taskId === 'string' && taskVersion !== null
        ? { kind: 'ACCEPTED', taskId: record.taskId, taskVersion, requirement: requirementStateOf(record.requirement) }
        : null;
    }
    case 'REWORK':
      return { kind: 'REWORK', affectedTaskIds: stringArrayOf(record.affectedTaskIds) };
    case 'REJECTED':
      return { kind: 'REJECTED', affectedTaskIds: stringArrayOf(record.affectedTaskIds) };
    case 'RECORDED':
      return {
        kind: 'RECORDED',
        approvedSlotIds: stringArrayOf(record.approvedSlotIds),
        remainingSlotIds: stringArrayOf(record.remainingSlotIds),
      };
    default:
      return null;
  }
}

@Injectable()
export class V1ReviewService {
  constructor(
    @Inject(V1_REVIEW_REPOSITORY) private readonly reviews: V1ReviewRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async getReview(principal: Principal, reviewId: string): Promise<V1ReviewSnapshot> {
    const review = await this.reviews.findReview(reviewId);
    if (!review) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_NOT_FOUND', { reviewId }, 404);
    // 无对象访问权按 404 返回，不泄露 review 存在性。
    if (review.subject) await this.authorization.assertCanReadKnowledge(principal, review.subject.knowledgeBaseId);
    return review;
  }

  /**
   * 创建评审请求：客户端只声明 subject 与版本；kind、槽位与摘要由服务端派生，
   * 不接受客户端 slots/approved。同一 subject 已有 OPEN 请求时返回既有请求。
   */
  async requestReview(
    principal: Principal,
    input: V1RequestReviewInput,
    context: V1RequestReviewContext,
  ): Promise<V1ReviewSnapshot> {
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    let projectId: string;

    if (input.subject.kind === 'DOCUMENT_REVISION') {
      const subject = await this.reviews.findDocumentReviewSubject(input.subject.id);
      if (!subject || subject.archived)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'REVIEW_SUBJECT_NOT_FOUND',
          { revisionId: input.subject.id },
          404,
        );
      // 当前项目活动成员 + 对该 KB 的当前 READ；缺权统一按 404 处理。
      await this.authorization.assertCanReadKnowledge(principal, subject.knowledgeBaseId);
      await this.authorization.requireScope(principal, subject.projectId, 'review:request');
      if (expectedVersion !== subject.documentVersion)
        throw new WorkmeshError(
          V1_ERROR_CODES.VERSION_CONFLICT,
          'VERSION_CONFLICT',
          { documentId: subject.documentId, expectedVersion, currentVersion: subject.documentVersion },
          409,
        );
      projectId = subject.projectId;
    } else {
      const subject = await this.reviews.findArtifactReviewSubject(input.subject.id);
      if (!subject)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'REVIEW_SUBJECT_NOT_FOUND',
          { artifactSetId: input.subject.id },
          404,
        );
      const projectContext = await this.authorization.resolveProjectContext(principal, subject.projectId);
      await this.authorization.requireScope(principal, subject.projectId, 'review:request');
      this.assertTaskResponsibility(
        principal,
        projectContext.membership.role,
        projectContext.activeRoleIds,
        subject.taskRoleId,
        subject.responsibleUserId,
      );
      if (input.taskId !== undefined && input.taskId !== null && input.taskId !== subject.taskId)
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'TASK_SUBJECT_MISMATCH',
          { taskId: input.taskId, artifactSetId: subject.artifactSetId },
          422,
        );
      if (expectedVersion !== subject.taskVersion)
        throw new WorkmeshError(
          V1_ERROR_CODES.VERSION_CONFLICT,
          'VERSION_CONFLICT',
          { taskId: subject.taskId, expectedVersion, currentVersion: subject.taskVersion },
          409,
        );
      projectId = subject.projectId;
    }

    const projectScopeKey = `project:${projectId}`;
    const principalScopeKeyValue = principalScopeKey(principal);
    const requestDigest = requestDigestOf({ method: context.method, route: context.route, body: context.body });

    // 同键重放先核当前授权（上面已完成），同 digest 返回原结果且不再新建。
    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey: principalScopeKeyValue,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, { method: context.method, route: context.route, digest: requestDigest });
      const reviewId = typeof existing.resultRefs.reviewRequestId === 'string' ? existing.resultRefs.reviewRequestId : '';
      const review = reviewId ? await this.reviews.findReview(reviewId) : null;
      if (!review) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_NOT_FOUND', { reviewId }, 404);
      return review;
    }

    const result = await this.reviews.createReviewRequest({
      projectId,
      subject: input.subject,
      expectedVersion,
      taskId: input.taskId ?? null,
      actor: {
        kind: principal.kind,
        userId: principal.userId,
        webSessionId: context.webSessionId,
        agentCredentialId: principal.kind === 'AGENT' ? (principal.agentCredentialId ?? null) : null,
        roleId: principal.kind === 'AGENT' ? (principal.roleIds?.[0] ?? null) : null,
        scopeSnapshot: [...principal.scopes],
        userAuthVersion: context.userAuthVersion,
      },
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey: principalScopeKeyValue,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
        now: context.now,
      },
    });
    return result.review;
  }

  /** 项目评审待办：KB READ 与角色/指派过滤在仓储 SQL 层完成，先过滤再分页。 */
  async listReviews(principal: Principal, input: V1ListReviewsInput): Promise<V1ReviewListResult> {
    const projectContext = await this.authorization.resolveProjectContext(principal, input.projectId);
    await this.authorization.requireScope(principal, input.projectId, 'review:read');
    const query: V1ReviewListQuery = {
      projectId: input.projectId,
      userId: principal.userId,
      principalKind: principal.kind,
      agentRoleId: principal.kind === 'AGENT' ? (principal.roleIds?.[0] ?? null) : null,
      activeRoleIds: projectContext.activeRoleIds,
      knowledgeReadAllowed: principal.kind === 'HUMAN' || principal.scopes.includes('knowledge:read'),
      assignedToMe: input.assignedToMe === true,
      status: input.status ?? null,
      limit: input.limit ?? 20,
      cursor: input.cursor ?? null,
    };
    return this.reviews.listReviews(query);
  }

  /** AGENT 只能用凭据唯一角色且必须等于任务角色；HUMAN 需责任人、任务业务角色或 OWNER/ADMIN。 */
  private assertTaskResponsibility(
    principal: Principal,
    membershipRole: ProjectManagementRole,
    activeRoleIds: readonly string[],
    taskRoleId: string,
    responsibleUserId: string,
  ): void {
    if (principal.kind === 'AGENT') {
      const agentRoleId = principal.roleIds?.[0] ?? null;
      if (principal.roleIds?.length !== 1 || agentRoleId !== taskRoleId)
        throw new WorkmeshError(
          V1_ERROR_CODES.FORBIDDEN,
          'REVIEW_SUBJECT_NOT_IN_RESPONSIBILITY',
          { taskRoleId, agentRoleId },
          403,
        );
      return;
    }
    if (
      membershipRole === 'OWNER' ||
      membershipRole === 'ADMIN' ||
      responsibleUserId === principal.userId ||
      activeRoleIds.includes(taskRoleId)
    )
      return;
    throw new WorkmeshError(
      V1_ERROR_CODES.FORBIDDEN,
      'REVIEW_SUBJECT_NOT_IN_RESPONSIBILITY',
      { taskRoleId, principalKind: principal.kind },
      403,
    );
  }

  /**
   * 服务端派生绑定：客户端不能传任意 slots、approved 或自造批准者。
   */
  bindingFor(review: V1ReviewSnapshot, input: V1DecideInput): ActionBinding & { slotId: string } {
    const slot = review.slots.find((item) => item.id === input.slotId);
    if (!slot)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_SLOT_NOT_FOUND', { slotId: input.slotId }, 404);
    const roleSlot = slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null;
    return {
      action: REVIEW_DECIDE_ACTION,
      projectId: review.projectId,
      targetType: REVIEW_DECIDE_TARGET_TYPE,
      targetId: review.id,
      expectedVersion: review.version,
      roleSlot,
      // payload 绑定 slotId、决定、当前 subject 摘要与有业务意义的 comment。
      payload: {
        slotId: slot.id,
        decision: input.decision,
        subjectDigest: review.subjectDigest,
        comment: input.comment ?? null,
      },
      slotId: slot.id,
    };
  }

  async decide(principal: Principal, reviewId: string, input: V1DecideInput, context: V1DecideContext): Promise<V1DecideResult> {
    // 1) 主体：批准决定只能来自 HUMAN Web 会话，不能由 Agent 或自报身份完成。
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);

    const review = await this.reviews.findReview(reviewId);
    if (!review) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_NOT_FOUND', { reviewId }, 404);

    // 2) 对象访问权：先满足当前成员与 KB READ，再判断槽位资格。
    if (review.subject) await this.authorization.assertCanReadKnowledge(principal, review.subject.knowledgeBaseId);

    // 3) 幂等重放优先：已提交的同键请求直接返回原结果，不再受之后的 CLOSED、版本或槽位状态影响。
    const requestDigest = requestDigestOf({ method: context.method, route: context.route, body: context.body });
    const projectScopeKey = `project:${review.projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, { method: context.method, route: context.route, digest: requestDigest });
      return {
        review,
        decisionId: String(existing.resultRefs.decisionId ?? ''),
        published: existing.resultRefs.published === true,
        publicationId: (existing.resultRefs.publicationId as string | null) ?? null,
        documentVersion: (existing.resultRefs.documentVersion as number | null) ?? null,
        subjectResult: subjectResultOf(existing.resultRefs.subjectResult),
        task: taskStateOf(existing.resultRefs.task),
        requirement: requirementStateOf(existing.resultRefs.requirement),
        replayed: true,
      };
    }

    // 4) 请求与状态校验。
    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    if (review.status !== 'OPEN')
      throw new WorkmeshError(V1_ERROR_CODES.REVIEW_CLOSED, 'REVIEW_CLOSED', { reviewId, status: review.status }, 409);
    if (expectedVersion !== review.version)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        { reviewId, expectedVersion, currentVersion: review.version },
        409,
      );

    const binding = this.bindingFor(review, input);
    const slot = review.slots.find((item) => item.id === binding.slotId)!;

    // 5) 准确槽位资格：指定审批人本人，或当前具备该业务角色；失权不回退为 OWNER/管理员。
    // 知识 USER-grant 出版槽位 roleId 为 null，此时只认准确指定的审批人本人；
    // 普通业务槽位必须当前具备该真实业务角色，不按管理头衔回退。
    const isAssignedUser = slot.requiredUserId === principal.userId;
    const hasRole = slot.requiredRoleId
      ? await this.authorization.hasBusinessRole(principal, review.projectId, slot.requiredRoleId)
      : false;
    if (!isAssignedUser && !hasRole)
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'REVIEW_SLOT_NOT_ASSIGNED',
        { reviewId, slotId: slot.id, principalKind: principal.kind },
        403,
      );

    // 6) 每 slot 每 request 仅一条正式决定，重试靠幂等而非 upsert 覆盖。
    if (review.decisions.some((item) => item.approvalSlotId === slot.id))
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_SLOT_DECIDED,
        'REVIEW_SLOT_DECIDED',
        { reviewId, slotId: slot.id },
        409,
      );

    // 7) 票据：必须在最终动作前核验绑定，且每次正式决定消费对应票据。
    const ticket = await this.tickets.findTicket(input.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: input.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: input.confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding: this.stripBinding(binding),
      now: context.now,
    });

    const result = await this.reviews.commitDecision({
      reviewId: review.id,
      expectedVersion: review.version,
      slotId: slot.id,
      decision: input.decision,
      subjectDigest: review.subjectDigest,
      comment: input.comment ?? null,
      actorUserId: principal.userId,
      roleSlot: binding.roleSlot,
      operationId: context.operationId,
      ticket: { id: ticket.id, secretHash: ticket.secretHash, webSessionId: context.webSessionId },
      principalScopeKey,
      projectScopeKey,
      operationKey: context.idempotencyKey,
      method: context.method,
      route: context.route,
      requestDigest,
      now: context.now,
    });

    return {
      review: result.review,
      decisionId: result.decisionId,
      published: result.published,
      publicationId: result.publicationId,
      documentVersion: result.documentVersion,
      subjectResult: result.subjectResult,
      task: result.task,
      requirement: result.requirement,
      replayed: false,
    };
  }

  /**
   * 撤销批准：只有原决定人或当前准确槽位有权 HUMAN 可撤销，且每次撤销必须绑定父请求版本的
   * 一次性票据与幂等键。撤销追加新记录，不删除原决定，也不删除已有发布历史。
   */
  async revoke(principal: Principal, decisionId: string, input: V1RevokeRequest, context: V1DecideContext): Promise<V1RevokeResultView> {
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
    if (!context.webSessionId)
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);

    const decision = await this.reviews.findDecisionContext(decisionId);
    if (!decision) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_DECISION_NOT_FOUND', { decisionId }, 404);
    if (decision.knowledgeBaseId) await this.authorization.assertCanReadKnowledge(principal, decision.knowledgeBaseId);

    const expectedVersion = requireExpectedVersion(input.expectedVersion);
    if (decision.decision !== 'APPROVE')
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'REVOCATION_NOT_APPLICABLE',
        { decisionId, decision: decision.decision },
        422,
      );
    const isOriginalDecider = decision.createdById === principal.userId;
    const hasRole = decision.slot.requiredRoleId
      ? await this.authorization.hasBusinessRole(principal, decision.projectId, decision.slot.requiredRoleId)
      : false;
    const isAssignedUser = decision.slot.requiredUserId === principal.userId;
    if (!isOriginalDecider && !isAssignedUser && !hasRole)
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'REVOCATION_NOT_PERMITTED',
        { decisionId, principalKind: principal.kind },
        403,
      );

    const binding = this.bindingForRevoke(decision, input.reason, expectedVersion);
    const projectScopeKey = `project:${decision.projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const requestDigest = requestDigestOf({ method: context.method, route: context.route, body: context.body });

    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, { method: context.method, route: context.route, digest: requestDigest });
      return {
        revocation: {
          id: String(existing.resultRefs.revocationId ?? ''),
          decisionId: String(existing.resultRefs.decisionId ?? decisionId),
          reason: String(existing.resultRefs.reason ?? input.reason),
          createdAt: new Date(String(existing.resultRefs.revokedAt ?? '')),
        },
        affectedTaskIds: Array.isArray(existing.resultRefs.affectedTaskIds)
          ? existing.resultRefs.affectedTaskIds.map((id) => String(id))
          : [],
        replayed: true,
      };
    }

    // 已提交撤销的合法重试必须先返回原结果：撤销本身会把父请求置为 INVALIDATED 并推进版本，
    // 若先做状态/版本检查，同键重放会被误判为冲突。
    if (decision.revoked)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_CONFLICT, 'DECISION_ALREADY_REVOKED', { decisionId }, 409);
    if (decision.reviewStatus !== 'APPROVED' && decision.reviewStatus !== 'OPEN')
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_CLOSED,
        'REVIEW_CLOSED',
        { decisionId, status: decision.reviewStatus },
        409,
      );
    if (expectedVersion !== decision.reviewVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        { decisionId, expectedVersion, currentVersion: decision.reviewVersion },
        409,
      );

    const ticket = await this.tickets.findTicket(input.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: input.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: input.confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding,
      now: context.now,
    });

    const result = await this.reviews.revokeDecision({
      decisionId,
      expectedVersion,
      reason: input.reason,
      actorUserId: principal.userId,
      roleSlot: binding.roleSlot,
      operationId: context.operationId,
      ticket: { id: ticket.id, secretHash: ticket.secretHash, webSessionId: context.webSessionId },
      principalScopeKey,
      projectScopeKey,
      operationKey: context.idempotencyKey,
      method: context.method,
      route: context.route,
      requestDigest,
      now: context.now,
    });

    return { ...result, replayed: false };
  }

  /** 撤销的预览摘要：Web 必须先展示父请求准确版本与受影响范围，再取票据。 */
  previewRevoke(decision: V1DecisionContext, reason: string, expectedVersion: number): { binding: ActionBinding; actionDigest: string } {
    const binding = this.bindingForRevoke(decision, reason, expectedVersion);
    return { binding, actionDigest: actionDigestOf(binding) };
  }

  private bindingForRevoke(decision: V1DecisionContext, reason: string, expectedVersion: number): ActionBinding {
    return {
      action: REVIEW_REVOKE_ACTION,
      projectId: decision.projectId,
      targetType: REVIEW_REVOKE_TARGET_TYPE,
      targetId: decision.decisionId,
      expectedVersion,
      roleSlot: decision.slot.requiredRoleId
        ? { roleId: decision.slot.requiredRoleId, approvalSlotId: decision.slot.id }
        : null,
      payload: { decisionId: decision.decisionId, subjectDigest: decision.subjectDigest, reason },
    };
  }

  private stripBinding(binding: ActionBinding & { slotId: string }): ActionBinding {
    const { slotId: _slotId, ...rest } = binding;
    return rest;
  }

  /** 预览用摘要：Web 展示“批准并发布”前必须先取得它。 */
  previewDigest(review: V1ReviewSnapshot, input: V1DecideInput): { binding: ActionBinding; actionDigest: string } {
    const binding = this.stripBinding(this.bindingFor(review, input));
    return { binding, actionDigest: actionDigestOf(binding) };
  }
}

export type { V1OperationRecord, V1TicketRecord, V1CommitDecisionResult };
