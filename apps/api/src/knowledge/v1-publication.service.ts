import { Inject, Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  CanonicalJsonError,
  V1_ERROR_CODES,
  WorkmeshError,
  type Confirmation,
  type Principal,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import { sessionIdOf } from '../auth/v1-cli-authorization.service';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  assertProposeScopes,
  assertVisibleRevision,
  canProposeKnowledge,
  canPublishKnowledge,
  normalizeAcceptance,
  normalizeDeliveryScope,
  requiredProposeScope,
  reviewKindForDocument,
  visibleRevisionState,
  type DocumentKind,
  type RevisionState,
  type V1AcceptanceItem,
  type V1DeliveryScope,
} from './v1-publication-policy';

export const V1_PUBLICATION_REPOSITORY = Symbol('V1_PUBLICATION_REPOSITORY');

export const KNOWLEDGE_WITHDRAW_ACTION = 'KNOWLEDGE_WITHDRAW';
export const KNOWLEDGE_WITHDRAW_TARGET_TYPE = 'KNOWLEDGE_DOCUMENT';

export type V1DocumentView = {
  id: string;
  projectId: string;
  knowledgeBaseId: string;
  requirementId: string | null;
  kind: DocumentKind;
  version: number;
  currentPublishedRevisionId: string | null;
  archivedAt: Date | null;
};

export type V1RevisionView = {
  id: string;
  documentId: string;
  knowledgeBaseId: string;
  projectId: string;
  seq: number;
  title: string;
  mimeType: string;
  byteLength: number;
  digest: string;
  state: RevisionState;
  bodyBytes: Uint8Array;
  createdBy: string;
  basisUnderstandingRevisionId: string | null;
  deliveryScope: V1DeliveryScope | null;
  acceptance: V1AcceptanceItem[] | null;
  /** 当前 revision 对应的最近一次评审请求；候选由 Web 用它进入人工评审。 */
  reviewRequestId?: string | null;
};

export type V1ProposeBinding = {
  basisUnderstandingRevisionId?: string | null;
  deliveryScope?: unknown;
  acceptance?: unknown;
};

export type V1ProposeRevisionInput = {
  documentId: string;
  title: string;
  mimeType: string;
  bodyBytes: Uint8Array;
  basisUnderstandingRevisionId?: string | null;
  deliveryScope?: unknown;
  acceptance?: unknown;
};

export type V1ReviewSlotView = {
  id: string;
  slotKey: string;
  requiredUserId: string;
  requiredRoleId: string | null;
};

/**
 * 修订元数据：列表、文档详情以及写响应不携带正文。
 * 正文读取仍由单修订 `findRevision` 与内容入口处理，避免历史列表读取全部原始字节。
 */
export type V1RevisionSnapshot = Omit<V1RevisionView, 'bodyBytes'>;

export type V1ProposeRevisionSnapshot = {
  revision: V1RevisionSnapshot;
  reviewRequestId: string;
  reviewKind: string;
  slots: V1ReviewSlotView[];
};

export type V1CreateDocumentSnapshot = V1ProposeRevisionSnapshot & { document: V1DocumentView };

/**
 * 写操作的幂等上下文。`operationId` 与 `idempotencyKey` 由控制器在请求级生成一次，
 * 同一次请求内的创建/候选/恢复写入都以 `(projectScopeKey, principalScopeKey, key)` 去重。
 */
export type V1DocumentWriteContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  now: Date;
  operationId: string;
};

/** 交给仓储在业务事务内落库的幂等记录。 */
export type V1WriteOperation = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
};

/** 兜底：即使仓储实现带回正文，元数据响应与幂等记录也绝不携带 `bodyBytes`。 */
function snapshotOf(view: V1RevisionView | V1RevisionSnapshot): V1RevisionSnapshot {
  const snapshot = { ...view } as V1RevisionView;
  delete (snapshot as Partial<V1RevisionView>).bodyBytes;
  return snapshot;
}

export type V1CreateDocumentInput = {
  projectId: string;
  knowledgeBaseId: string;
  kind: DocumentKind;
  requirementId?: string | null;
  title: string;
  mimeType: string;
  bodyBytes: Uint8Array;
  basisUnderstandingRevisionId?: string | null;
  deliveryScope?: unknown;
  acceptance?: unknown;
};

export type V1ListDocumentsQuery = {
  kind?: DocumentKind;
  q?: string;
  limit?: number;
  cursor?: string | null;
};

export type V1DocumentDetail = {
  document: V1DocumentView;
  revisions: V1RevisionSnapshot[];
  publishedRevision: V1RevisionSnapshot | null;
};

export type V1RequirementBinding = {
  id: string;
  projectId: string;
  currentUnderstandingRevisionId: string | null;
  currentPrdRevisionId: string | null;
};

export type V1WithdrawInput = {
  expectedVersion: number;
  reason: string;
  confirmation: Confirmation;
  webSessionId: string;
  userAuthVersion: number;
  now: Date;
};

export interface V1PublicationRepository {
  findDocument(documentId: string): Promise<V1DocumentView | null>;
  findRevision(revisionId: string): Promise<V1RevisionView | null>;
  /** 全部修订元数据，保持历史完整性；SQL 不读取正文。 */
  listRevisions(documentId: string): Promise<V1RevisionSnapshot[]>;
  isAssignedReviewer(revisionId: string, userId: string): Promise<boolean>;
  /** 与单修订明确评审者判定等价；仅返回给定集合中分配给该用户的修订 ID。 */
  listAssignedReviewerRevisionIds(
    revisionIds: readonly string[],
    userId: string,
  ): Promise<string[]>;
  findRequirement(requirementId: string): Promise<V1RequirementBinding | null>;
  findKnowledgeBaseProjectId(knowledgeBaseId: string): Promise<string | null>;
  projectRoleIds(projectId: string): Promise<string[]>;
  listDocuments(
    projectId: string,
    query: V1ListDocumentsQuery,
  ): Promise<{ items: V1DocumentView[]; nextCursor: string | null }>;
  createDocument(input: {
    projectId: string;
    knowledgeBaseId: string;
    kind: DocumentKind;
    requirementId: string | null;
    title: string;
    mimeType: string;
    bodyBytes: Uint8Array;
    createdBy: string;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: V1DeliveryScope | null;
    acceptance: V1AcceptanceItem[] | null;
    reviewKind: string;
    operation: V1WriteOperation;
    now: Date;
  }): Promise<V1CreateDocumentSnapshot>;
  proposeRevision(input: {
    document: V1DocumentView;
    title: string;
    mimeType: string;
    bodyBytes: Uint8Array;
    createdBy: string;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: V1DeliveryScope | null;
    acceptance: V1AcceptanceItem[] | null;
    reviewKind: string;
    operation: V1WriteOperation;
    now: Date;
  }): Promise<V1ProposeRevisionSnapshot>;
  restoreRevision(input: {
    document: V1DocumentView;
    sourceRevisionId: string;
    title: string | null;
    createdBy: string;
    reviewKind: string;
    operation: V1WriteOperation;
    now: Date;
  }): Promise<V1ProposeRevisionSnapshot>;
  withdraw(input: {
    document: V1DocumentView;
    expectedVersion: number;
    reason: string;
    ticket: { id: string; secretHash: string; webSessionId: string };
    actorUserId: string;
    now: Date;
  }): Promise<{ documentVersion: number; publicationId: string }>;
}

@Injectable()
export class V1PublicationService {
  constructor(
    @Inject(V1_PUBLICATION_REPOSITORY) private readonly repository: V1PublicationRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    /**
     * 与 claim / review / workflow / KB 一致的幂等收口：候选、创建、恢复都必须能安全重放。
     * 不提供默认空实现——漏接线会静默关掉去重，而静默关闭正是这条路径此前的缺陷。
     */
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  /** 候选／发布读取：先满足当前成员与 KB READ，再判断作者、明确评审者或当前 PROPOSE/PUBLISH 资格。 */
  async getRevision(principal: Principal, revisionId: string): Promise<V1RevisionView> {
    const revision = await this.repository.findRevision(revisionId);
    if (!revision)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVISION_NOT_FOUND,
        'REVISION_NOT_FOUND',
        { revisionId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      revision.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { revisionId },
        404,
      );
    const isAuthor = revision.createdBy === principal.userId;
    const isAssignedReviewer = await this.repository.isAssignedReviewer(
      revisionId,
      principal.userId,
    );
    const state = assertVisibleRevision(
      visibleRevisionState(revision.state, { access, isAuthor, isAssignedReviewer }),
      revisionId,
    );
    return { ...revision, state };
  }

  async getRevisionContent(principal: Principal, revisionId: string): Promise<V1RevisionView> {
    return this.getRevision(principal, revisionId);
  }

  async listRevisions(principal: Principal, documentId: string): Promise<V1RevisionSnapshot[]> {
    const document = await this.repository.findDocument(documentId);
    if (!document)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_NOT_FOUND',
        { documentId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { documentId },
        404,
      );
    return this.filterVisible(principal, access, await this.repository.listRevisions(documentId));
  }

  async getDocument(principal: Principal, documentId: string): Promise<V1DocumentDetail> {
    const document = await this.repository.findDocument(documentId);
    if (!document)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_NOT_FOUND',
        { documentId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { documentId },
        404,
      );
    const revisions = await this.filterVisible(
      principal,
      access,
      await this.repository.listRevisions(documentId),
    );
    const publishedRevision = revisions.find((revision) => revision.state === 'PUBLISHED') ?? null;
    return { document, revisions, publishedRevision };
  }

  /** 项目内文档搜索：结果再逐个按 KB 当前权限过滤，不因同项目成员身份泄露受限知识。 */
  async listDocuments(
    principal: Principal,
    projectId: string,
    query: V1ListDocumentsQuery,
  ): Promise<{ items: V1DocumentDetail[]; nextCursor: string | null }> {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    const limit = Number.isInteger(query.limit)
      ? Math.min(Math.max(query.limit ?? 20, 1), 100)
      : 20;
    const page = await this.repository.listDocuments(projectId, { ...query, limit });
    const items: V1DocumentDetail[] = [];
    for (const document of page.items) {
      const access = await this.authorization.resolveKnowledgeAccess(
        principal,
        document.knowledgeBaseId,
      );
      if (!access.canRead) continue;
      const revisions = await this.filterVisible(
        principal,
        access,
        await this.repository.listRevisions(document.id),
      );
      items.push({
        document,
        revisions,
        publishedRevision: revisions.find((revision) => revision.state === 'PUBLISHED') ?? null,
      });
    }
    return { items, nextCursor: page.nextCursor };
  }

  async createDocument(
    principal: Principal,
    projectId: string,
    input: V1CreateDocumentInput,
    context: V1DocumentWriteContext,
  ): Promise<V1CreateDocumentSnapshot> {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    const knowledgeBaseProjectId = await this.repository.findKnowledgeBaseProjectId(
      input.knowledgeBaseId,
    );
    if (!knowledgeBaseProjectId || knowledgeBaseProjectId !== projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_BASE_NOT_FOUND',
        { knowledgeBaseId: input.knowledgeBaseId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      input.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { knowledgeBaseId: input.knowledgeBaseId },
        404,
      );
    if (!canProposeKnowledge(access))
      throw new WorkmeshError(
        V1_ERROR_CODES.KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED,
        'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED',
        { knowledgeBaseId: input.knowledgeBaseId },
        403,
      );

    const requirementId = input.requirementId ?? null;
    if ((input.kind === 'PRD' || input.kind === 'UNDERSTANDING') && !requirementId)
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        `${input.kind} 文档必须绑定需求`,
        undefined,
        422,
      );
    if (requirementId) {
      const requirement = await this.repository.findRequirement(requirementId);
      if (!requirement || requirement.projectId !== projectId)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'REQUIREMENT_NOT_FOUND',
          { requirementId },
          404,
        );
    }

    const required = requiredProposeScope(input.kind, requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });

    // 幂等判定必须早于基线校验：已提交的写入即使基线后来变了，重放也要返回首次结果，
    // 否则"同一个 --operation 重试"会被 BASELINE_STALE 挡住而丢失已生效的操作。
    const operation = this.writeOperation(
      projectId,
      principal,
      {
        knowledgeBaseId: input.knowledgeBaseId,
        kind: input.kind,
        requirementId,
        title: input.title,
        mimeType: input.mimeType,
        bodyBase64: Buffer.from(input.bodyBytes).toString('base64'),
        basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
        deliveryScope: input.deliveryScope ?? null,
        acceptance: input.acceptance ?? null,
      },
      context,
    );

    const replayed = await this.replay(operation, context);
    if (replayed) return replayed as V1CreateDocumentSnapshot;

    const binding = await this.validateBinding({
      projectId,
      kind: input.kind,
      requirementId,
      documentId: null,
      basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
      deliveryScope: input.deliveryScope,
      acceptance: input.acceptance,
    });

    const created = await this.repository.createDocument({
      projectId,
      knowledgeBaseId: input.knowledgeBaseId,
      kind: input.kind,
      requirementId,
      title: input.title,
      mimeType: input.mimeType,
      bodyBytes: input.bodyBytes,
      createdBy: principal.userId,
      basisUnderstandingRevisionId: binding.basisUnderstandingRevisionId,
      deliveryScope: binding.deliveryScope,
      acceptance: binding.acceptance,
      reviewKind: reviewKindForDocument(input.kind),
      operation,
      now: context.now,
    });
    return { ...created, revision: snapshotOf(created.revision) };
  }

  /**
   * 创建候选 revision，并由服务端派生评审请求与审批槽。
   * 没有直接发布入口；发布只经由 POST /review-requests/:id/decisions 的最后 ALL APPROVE。
   */
  async proposeRevision(
    principal: Principal,
    documentId: string,
    input: { title: string; mimeType: string; bodyBytes: Uint8Array } & V1ProposeBinding,
    context: V1DocumentWriteContext,
  ): Promise<V1ProposeRevisionSnapshot> {
    const document = await this.loadWritableDocument(principal, documentId);
    const required = requiredProposeScope(document.kind, document.requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });

    // 幂等判定早于基线校验：已提交的写入即使基线后来变了，重放也要返回首次结果。
    const operation = this.writeOperation(
      document.projectId,
      principal,
      {
        documentId: document.id,
        title: input.title,
        mimeType: input.mimeType,
        bodyBase64: Buffer.from(input.bodyBytes).toString('base64'),
        basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
        deliveryScope: input.deliveryScope ?? null,
        acceptance: input.acceptance ?? null,
      },
      context,
    );

    const replayed = await this.replay(operation, context);
    if (replayed) return replayed as V1ProposeRevisionSnapshot;

    const binding = await this.validateBinding({
      projectId: document.projectId,
      kind: document.kind,
      requirementId: document.requirementId,
      documentId: document.id,
      basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
      deliveryScope: input.deliveryScope,
      acceptance: input.acceptance,
    });

    const proposed = await this.repository.proposeRevision({
      document,
      title: input.title,
      mimeType: input.mimeType,
      bodyBytes: input.bodyBytes,
      createdBy: principal.userId,
      basisUnderstandingRevisionId: binding.basisUnderstandingRevisionId,
      deliveryScope: binding.deliveryScope,
      acceptance: binding.acceptance,
      reviewKind: reviewKindForDocument(document.kind),
      operation,
      now: context.now,
    });
    return { ...proposed, revision: snapshotOf(proposed.revision) };
  }

  /** restore 只按历史原文生成新候选，不改变发布指针，不接受客户端摘要。 */
  async restoreRevision(
    principal: Principal,
    documentId: string,
    input: { sourceRevisionId: string; title?: string | null },
    context: V1DocumentWriteContext,
  ): Promise<V1ProposeRevisionSnapshot> {
    const document = await this.loadWritableDocument(principal, documentId);
    const required = requiredProposeScope(document.kind, document.requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });
    const source = await this.repository.findRevision(input.sourceRevisionId);
    if (!source || source.documentId !== document.id)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REVISION_NOT_FOUND',
        { sourceRevisionId: input.sourceRevisionId },
        404,
      );

    const operation = this.writeOperation(
      document.projectId,
      principal,
      {
        documentId: document.id,
        sourceRevisionId: source.id,
        title: input.title ?? null,
      },
      context,
    );

    const replayed = await this.replay(operation, context);
    if (replayed) return replayed as V1ProposeRevisionSnapshot;

    const restored = await this.repository.restoreRevision({
      document,
      sourceRevisionId: source.id,
      title: input.title ?? null,
      createdBy: principal.userId,
      reviewKind: reviewKindForDocument(document.kind),
      operation,
      now: context.now,
    });
    return { ...restored, revision: snapshotOf(restored.revision) };
  }

  /**
   * 构造本次写入的幂等记录。
   * 摘要由服务端在本层按"即将落库的那组值"计算，而不是信任控制器传进来的原始 body：
   * DTO 新增字段时不会因为忘记同步控制器而让两个不同语义的请求撞同一个 digest。
   */
  private writeOperation(
    projectId: string,
    principal: Principal,
    semanticBody: Record<string, unknown>,
    context: V1DocumentWriteContext,
  ): V1WriteOperation {
    let requestDigest: string;
    try {
      requestDigest = requestDigestOf({
        method: context.method,
        route: context.route,
        body: semanticBody,
      });
    } catch (error) {
      // canonical JSON 只接受安全整数与纯对象；请求体在这里不可摘要意味着它本来也落不了库，
      // 因此按输入校验失败返回，而不是把 CanonicalJsonError 暴露成 500。
      if (error instanceof CanonicalJsonError)
        throw new WorkmeshError(
          V1_ERROR_CODES.INVALID_REQUEST,
          'REQUEST_BODY_NOT_CANONICAL',
          { reason: error.message },
          422,
        );
      throw error;
    }
    return {
      id: context.operationId,
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
      method: context.method,
      route: context.route,
      requestDigest,
    };
  }

  /** 同键同语义返回首次结果；同键异语义或异路由一律 409，不产生第二次副作用。 */
  private async replay(
    operation: V1WriteOperation,
    context: V1DocumentWriteContext,
  ): Promise<V1ProposeRevisionSnapshot | V1CreateDocumentSnapshot | null> {
    const existing = await this.operations.findOperation({
      projectScopeKey: operation.projectScopeKey,
      principalScopeKey: operation.principalScopeKey,
      key: operation.key,
    });
    if (!existing) return null;
    assertReplayable(existing, {
      method: context.method,
      route: context.route,
      digest: operation.requestDigest,
    });
    return existing.resultRefs as unknown as V1ProposeRevisionSnapshot | V1CreateDocumentSnapshot;
  }

  /** 撤回当前发布只清空指针，不自动回退旧版；必须 HUMAN + PUBLISH 资格 + 单次确认票据。 */
  async withdraw(
    principal: Principal,
    documentId: string,
    input: V1WithdrawInput,
  ): Promise<{ documentVersion: number; publicationId: string }> {
    const document = await this.repository.findDocument(documentId);
    if (!document)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_NOT_FOUND',
        { documentId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { documentId },
        404,
      );
    if (!canPublishKnowledge(access, principal.kind))
      throw new WorkmeshError(
        principal.kind === 'AGENT'
          ? V1_ERROR_CODES.HUMAN_SESSION_REQUIRED
          : V1_ERROR_CODES.HUMAN_PUBLISH_PERMISSION_REQUIRED,
        'HUMAN_PUBLISH_PERMISSION_REQUIRED',
        { documentId },
        403,
      );
    if (
      typeof input.reason !== 'string' ||
      input.reason.trim().length === 0 ||
      input.reason.length > 1000
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        '撤回原因长度必须为 1–1000',
        undefined,
        422,
      );

    const binding = {
      action: KNOWLEDGE_WITHDRAW_ACTION,
      projectId: document.projectId,
      targetType: KNOWLEDGE_WITHDRAW_TARGET_TYPE,
      targetId: document.id,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: { reason: input.reason.trim() },
    };
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
      webSessionId: input.webSessionId,
      userAuthVersion: input.userAuthVersion,
      binding,
      now: input.now,
    });

    return this.repository.withdraw({
      document,
      expectedVersion: input.expectedVersion,
      reason: input.reason.trim(),
      ticket: {
        id: ticket.id,
        secretHash: ticket.secretHash,
        webSessionId: sessionIdOf(principal),
      },
      actorUserId: principal.userId,
      now: input.now,
    });
  }

  private async loadWritableDocument(
    principal: Principal,
    documentId: string,
  ): Promise<V1DocumentView> {
    const document = await this.repository.findDocument(documentId);
    if (!document)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_NOT_FOUND',
        { documentId },
        404,
      );
    if (document.archivedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_ARCHIVED',
        { documentId },
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
    );
    if (!access.canRead)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { documentId },
        404,
      );
    if (!canProposeKnowledge(access))
      throw new WorkmeshError(
        V1_ERROR_CODES.KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED,
        'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED',
        { knowledgeBaseId: document.knowledgeBaseId },
        403,
      );
    return document;
  }

  /**
   * PRD 候选必须绑定需求当前已确认理解、deliveryScope 和验收条款；
   * 其它 kind 不接受这些字段，避免借改类型绕过语义。
   */
  private async validateBinding(input: {
    projectId: string;
    kind: DocumentKind;
    requirementId: string | null;
    documentId: string | null;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: unknown;
    acceptance: unknown;
  }): Promise<{
    basisUnderstandingRevisionId: string | null;
    deliveryScope: V1DeliveryScope | null;
    acceptance: V1AcceptanceItem[] | null;
  }> {
    if (input.kind !== 'PRD') {
      if (
        input.basisUnderstandingRevisionId ||
        input.deliveryScope !== undefined ||
        input.acceptance !== undefined
      )
        throw new WorkmeshError(
          V1_ERROR_CODES.INVALID_REQUEST,
          '只有 PRD 候选可携带 basisUnderstanding/deliveryScope/acceptance',
          undefined,
          422,
        );
      return { basisUnderstandingRevisionId: null, deliveryScope: null, acceptance: null };
    }
    if (!input.requirementId)
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'PRD 文档必须绑定需求',
        undefined,
        422,
      );
    if (!input.basisUnderstandingRevisionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'PRD 候选必须绑定 basisUnderstandingRevisionId',
        undefined,
        422,
      );
    if (input.documentId && input.basisUnderstandingRevisionId === input.documentId) {
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        '理解依据不能是 PRD 自身',
        undefined,
        422,
      );
    }
    const requirement = await this.repository.findRequirement(input.requirementId);
    if (!requirement)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId: input.requirementId },
        404,
      );
    if (requirement.projectId !== input.projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId: input.requirementId },
        404,
      );
    if (requirement.currentUnderstandingRevisionId !== input.basisUnderstandingRevisionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        '理解依据不是该需求当前已确认版本',
        {
          basisUnderstandingRevisionId: input.basisUnderstandingRevisionId,
          current: requirement.currentUnderstandingRevisionId,
        },
        409,
      );
    const basisRevision = await this.repository.findRevision(input.basisUnderstandingRevisionId);
    if (!basisRevision)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REVISION_NOT_FOUND',
        { revisionId: input.basisUnderstandingRevisionId },
        404,
      );
    const basisDocument = await this.repository.findDocument(basisRevision.documentId);
    if (
      !basisDocument ||
      basisDocument.kind !== 'UNDERSTANDING' ||
      basisDocument.requirementId !== input.requirementId ||
      basisDocument.currentPublishedRevisionId !== basisRevision.id
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        '理解依据不是同需求已发布的理解版本',
        { revisionId: basisRevision.id },
        409,
      );

    const roleIds = await this.repository.projectRoleIds(input.projectId);
    return {
      basisUnderstandingRevisionId: basisRevision.id,
      deliveryScope: normalizeDeliveryScope(input.deliveryScope, roleIds),
      acceptance: normalizeAcceptance(input.acceptance),
    };
  }

  private async filterVisible(
    principal: Principal,
    access: Awaited<ReturnType<V1AuthorizationService['resolveKnowledgeAccess']>>,
    revisions: V1RevisionSnapshot[],
  ): Promise<V1RevisionSnapshot[]> {
    if (revisions.length === 0) return [];
    const assignedRevisionIds = new Set(
      await this.repository.listAssignedReviewerRevisionIds(
        revisions.map((revision) => revision.id),
        principal.userId,
      ),
    );
    const visible: V1RevisionSnapshot[] = [];
    for (const revision of revisions) {
      const isAuthor = revision.createdBy === principal.userId;
      const isAssignedReviewer = assignedRevisionIds.has(revision.id);
      const state = visibleRevisionState(revision.state, { access, isAuthor, isAssignedReviewer });
      if (state) visible.push({ ...snapshotOf(revision), state });
    }
    return visible;
  }
}
