import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Confirmation, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { verifyTicketBinding, V1_CONFIRMATION_REPOSITORY, type V1ConfirmationRepository } from '../auth/v1-confirmation';
import { sessionIdOf } from '../auth/v1-cli-authorization.service';
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

export type V1ProposeRevisionResult = {
  revision: V1RevisionView;
  reviewRequestId: string;
  reviewKind: string;
  slots: Array<{ id: string; slotKey: string; requiredUserId: string; requiredRoleId: string | null }>;
};

export type V1CreateDocumentResult = V1ProposeRevisionResult & { document: V1DocumentView };

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
  revisions: V1RevisionView[];
  publishedRevision: V1RevisionView | null;
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
  listRevisions(documentId: string): Promise<V1RevisionView[]>;
  isAssignedReviewer(revisionId: string, userId: string): Promise<boolean>;
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
  }): Promise<V1CreateDocumentResult>;
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
  }): Promise<V1ProposeRevisionResult>;
  restoreRevision(input: {
    document: V1DocumentView;
    sourceRevisionId: string;
    title: string | null;
    createdBy: string;
    reviewKind: string;
  }): Promise<V1ProposeRevisionResult>;
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
  ) {}

  /** 候选／发布读取：先满足当前成员与 KB READ，再判断作者、明确评审者或当前 PROPOSE/PUBLISH 资格。 */
  async getRevision(principal: Principal, revisionId: string): Promise<V1RevisionView> {
    const revision = await this.repository.findRevision(revisionId);
    if (!revision) throw new WorkmeshError(V1_ERROR_CODES.REVISION_NOT_FOUND, 'REVISION_NOT_FOUND', { revisionId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, revision.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { revisionId }, 404);
    const isAuthor = revision.createdBy === principal.userId;
    const isAssignedReviewer = await this.repository.isAssignedReviewer(revisionId, principal.userId);
    const state = assertVisibleRevision(
      visibleRevisionState(revision.state, { access, isAuthor, isAssignedReviewer }),
      revisionId,
    );
    return { ...revision, state };
  }

  async getRevisionContent(principal: Principal, revisionId: string): Promise<V1RevisionView> {
    return this.getRevision(principal, revisionId);
  }

  async listRevisions(principal: Principal, documentId: string): Promise<V1RevisionView[]> {
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { documentId }, 404);
    return this.filterVisible(principal, access, await this.repository.listRevisions(documentId));
  }

  async getDocument(principal: Principal, documentId: string): Promise<V1DocumentDetail> {
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { documentId }, 404);
    const revisions = await this.filterVisible(principal, access, await this.repository.listRevisions(documentId));
    const publishedRevision = revisions.find((revision) => revision.state === 'PUBLISHED') ?? null;
    return { document, revisions, publishedRevision };
  }

  /** 项目内文档搜索：结果再逐个按 KB 当前权限过滤，不因同项目成员身份泄露受限知识。 */
  async listDocuments(
    principal: Principal,
    projectId: string,
    query: V1ListDocumentsQuery,
  ): Promise<{ items: V1DocumentDetail[]; nextCursor: string | null }> {
    await this.authorization.resolveProjectContext(principal, projectId);
    const limit = Number.isInteger(query.limit) ? Math.min(Math.max(query.limit ?? 20, 1), 100) : 20;
    const page = await this.repository.listDocuments(projectId, { ...query, limit });
    const items: V1DocumentDetail[] = [];
    for (const document of page.items) {
      const access = await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId);
      if (!access.canRead) continue;
      const revisions = await this.filterVisible(principal, access, await this.repository.listRevisions(document.id));
      items.push({
        document,
        revisions,
        publishedRevision: revisions.find((revision) => revision.state === 'PUBLISHED') ?? null,
      });
    }
    return { items, nextCursor: page.nextCursor };
  }

  async createDocument(principal: Principal, projectId: string, input: V1CreateDocumentInput): Promise<V1CreateDocumentResult> {
    await this.authorization.resolveProjectContext(principal, projectId);
    const knowledgeBaseProjectId = await this.repository.findKnowledgeBaseProjectId(input.knowledgeBaseId);
    if (!knowledgeBaseProjectId || knowledgeBaseProjectId !== projectId)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_BASE_NOT_FOUND', { knowledgeBaseId: input.knowledgeBaseId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, input.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { knowledgeBaseId: input.knowledgeBaseId }, 404);
    if (!canProposeKnowledge(access))
      throw new WorkmeshError(
        V1_ERROR_CODES.KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED,
        'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED',
        { knowledgeBaseId: input.knowledgeBaseId },
        403,
      );

    const requirementId = input.requirementId ?? null;
    if ((input.kind === 'PRD' || input.kind === 'UNDERSTANDING') && !requirementId)
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, `${input.kind} 文档必须绑定需求`, undefined, 422);
    if (requirementId) {
      const requirement = await this.repository.findRequirement(requirementId);
      if (!requirement || requirement.projectId !== projectId)
        throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REQUIREMENT_NOT_FOUND', { requirementId }, 404);
    }

    const required = requiredProposeScope(input.kind, requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });

    const binding = await this.validateBinding({
      projectId,
      kind: input.kind,
      requirementId,
      documentId: null,
      basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
      deliveryScope: input.deliveryScope,
      acceptance: input.acceptance,
    });

    return this.repository.createDocument({
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
    });
  }

  /**
   * 创建候选 revision，并由服务端派生评审请求与审批槽。
   * 没有直接发布入口；发布只经由 POST /review-requests/:id/decisions 的最后 ALL APPROVE。
   */
  async proposeRevision(
    principal: Principal,
    documentId: string,
    input: { title: string; mimeType: string; bodyBytes: Uint8Array } & V1ProposeBinding,
  ): Promise<V1ProposeRevisionResult> {
    const document = await this.loadWritableDocument(principal, documentId);
    const required = requiredProposeScope(document.kind, document.requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });

    const binding = await this.validateBinding({
      projectId: document.projectId,
      kind: document.kind,
      requirementId: document.requirementId,
      documentId: document.id,
      basisUnderstandingRevisionId: input.basisUnderstandingRevisionId ?? null,
      deliveryScope: input.deliveryScope,
      acceptance: input.acceptance,
    });

    return this.repository.proposeRevision({
      document,
      title: input.title,
      mimeType: input.mimeType,
      bodyBytes: input.bodyBytes,
      createdBy: principal.userId,
      basisUnderstandingRevisionId: binding.basisUnderstandingRevisionId,
      deliveryScope: binding.deliveryScope,
      acceptance: binding.acceptance,
      reviewKind: reviewKindForDocument(document.kind),
    });
  }

  /** restore 只按历史原文生成新候选，不改变发布指针，不接受客户端摘要。 */
  async restoreRevision(
    principal: Principal,
    documentId: string,
    input: { sourceRevisionId: string; title?: string | null },
  ): Promise<V1ProposeRevisionResult> {
    const document = await this.loadWritableDocument(principal, documentId);
    const required = requiredProposeScope(document.kind, document.requirementId !== null);
    assertProposeScopes({ principalKind: principal.kind, scopes: principal.scopes, required });
    const source = await this.repository.findRevision(input.sourceRevisionId);
    if (!source || source.documentId !== document.id)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVISION_NOT_FOUND', { sourceRevisionId: input.sourceRevisionId }, 404);
    return this.repository.restoreRevision({
      document,
      sourceRevisionId: source.id,
      title: input.title ?? null,
      createdBy: principal.userId,
      reviewKind: reviewKindForDocument(document.kind),
    });
  }

  /** 撤回当前发布只清空指针，不自动回退旧版；必须 HUMAN + PUBLISH 资格 + 单次确认票据。 */
  async withdraw(principal: Principal, documentId: string, input: V1WithdrawInput): Promise<{ documentVersion: number; publicationId: string }> {
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { documentId }, 404);
    if (!canPublishKnowledge(access, principal.kind))
      throw new WorkmeshError(
        principal.kind === 'AGENT' ? V1_ERROR_CODES.HUMAN_SESSION_REQUIRED : V1_ERROR_CODES.HUMAN_PUBLISH_PERMISSION_REQUIRED,
        'HUMAN_PUBLISH_PERMISSION_REQUIRED',
        { documentId },
        403,
      );
    if (typeof input.reason !== 'string' || input.reason.trim().length === 0 || input.reason.length > 1000)
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '撤回原因长度必须为 1–1000', undefined, 422);

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
      throw new WorkmeshError(V1_ERROR_CODES.CONFIRMATION_INVALID, 'CONFIRMATION_NOT_FOUND', { ticketId: input.confirmation.ticketId }, 403);
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
      ticket: { id: ticket.id, secretHash: ticket.secretHash, webSessionId: sessionIdOf(principal) },
      actorUserId: principal.userId,
      now: input.now,
    });
  }

  private async loadWritableDocument(principal: Principal, documentId: string): Promise<V1DocumentView> {
    const document = await this.repository.findDocument(documentId);
    if (!document) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId }, 404);
    if (document.archivedAt)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_ARCHIVED', { documentId }, 404);
    const access = await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId);
    if (!access.canRead)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_NOT_READABLE', { documentId }, 404);
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
      if (input.basisUnderstandingRevisionId || input.deliveryScope !== undefined || input.acceptance !== undefined)
        throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '只有 PRD 候选可携带 basisUnderstanding/deliveryScope/acceptance', undefined, 422);
      return { basisUnderstandingRevisionId: null, deliveryScope: null, acceptance: null };
    }
    if (!input.requirementId)
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'PRD 文档必须绑定需求', undefined, 422);
    if (!input.basisUnderstandingRevisionId)
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'PRD 候选必须绑定 basisUnderstandingRevisionId', undefined, 422);
    if (input.documentId && input.basisUnderstandingRevisionId === input.documentId) {
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '理解依据不能是 PRD 自身', undefined, 422);
    }
    const requirement = await this.repository.findRequirement(input.requirementId);
    if (!requirement)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REQUIREMENT_NOT_FOUND', { requirementId: input.requirementId }, 404);
    if (requirement.projectId !== input.projectId)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REQUIREMENT_NOT_FOUND', { requirementId: input.requirementId }, 404);
    if (requirement.currentUnderstandingRevisionId !== input.basisUnderstandingRevisionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        '理解依据不是该需求当前已确认版本',
        { basisUnderstandingRevisionId: input.basisUnderstandingRevisionId, current: requirement.currentUnderstandingRevisionId },
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
    revisions: V1RevisionView[],
  ): Promise<V1RevisionView[]> {
    const visible: V1RevisionView[] = [];
    for (const revision of revisions) {
      const isAuthor = revision.createdBy === principal.userId;
      const isAssignedReviewer = await this.repository.isAssignedReviewer(revision.id, principal.userId);
      const state = visibleRevisionState(revision.state, { access, isAuthor, isAssignedReviewer });
      if (state) visible.push({ ...revision, state });
    }
    return visible;
  }
}
