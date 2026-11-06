import { Inject, Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Confirmation,
  type Principal,
} from '@workmesh/shared';
import {
  V1AuthorizationService,
  type KnowledgeVisibility,
  type ProjectManagementRole,
} from '../auth/v1-authorization';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  KNOWLEDGE_GRANT_PERMISSIONS,
  KNOWLEDGE_VISIBILITIES,
  isProjectManager,
} from './v1-knowledge-base-policy';
import {
  V1_KNOWLEDGE_BASE_REPOSITORY,
  type V1KnowledgeBaseAccessView,
  type V1KnowledgeBaseListQuery,
  type V1KnowledgeBaseRepository,
  type V1KnowledgeBaseSearchItem,
  type V1KnowledgeBaseView,
  type V1KnowledgeGrantInput,
} from './v1-knowledge-base.repository';

export const KB_ACCESS_REPLACE_ACTION = 'KB_ACCESS_REPLACE';
export const KNOWLEDGE_BASE_TARGET_TYPE = 'KNOWLEDGE_BASE';
export const KNOWLEDGE_BASE_CREATE_ACTION = 'KNOWLEDGE_BASE_CREATE';

export type V1KnowledgeActionContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
};

export type V1KnowledgeReplaceContext = V1KnowledgeActionContext & {
  webSessionId: string;
  userAuthVersion: number;
};

export type V1CreateKnowledgeBaseInput = {
  key: string;
  name: string;
  visibility: KnowledgeVisibility;
};

export type V1KnowledgeGrantRequest = {
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: string[];
};

export type V1ReplaceKnowledgeAccessInput = {
  expectedVersion: number;
  expectedAuthzVersion: number;
  visibility: KnowledgeVisibility;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  grants: V1KnowledgeGrantRequest[];
  reason: string;
  confirmation: Confirmation;
};

export type V1KnowledgeBaseSearchResult = {
  items: V1KnowledgeBaseSearchItem[];
  nextCursor: string | null;
  hasMore: boolean;
  truncated: boolean;
};

function knowledgeBaseNotFound(knowledgeBaseId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    'KNOWLEDGE_BASE_NOT_FOUND',
    { knowledgeBaseId },
    404,
  );
}

function projectNotFound(projectId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    'PROJECT_NOT_FOUND',
    { projectId },
    404,
  );
}

function invalidGrant(message: string, details?: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.INVALID_GRANT, message, details, 422);
}

function assertHuman(principal: Principal): void {
  if (principal.kind !== 'HUMAN')
    throw new WorkmeshError(
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      undefined,
      403,
    );
}

/** 校验传入集合后返回规范化副本；不接受重复主体、混合 user/role 或未登记权限。 */
function normalizeGrants(grants: readonly V1KnowledgeGrantRequest[]): V1KnowledgeGrantInput[] {
  const seenSubjects = new Set<string>();
  const normalized: V1KnowledgeGrantInput[] = [];

  grants.forEach((grant, index) => {
    const subjectUserId = grant.subjectUserId ?? null;
    const subjectRoleId = grant.subjectRoleId ?? null;
    if (grant.subjectKind !== 'USER' && grant.subjectKind !== 'ROLE')
      throw invalidGrant('GRANT_SUBJECT_KIND_INVALID', { index });

    if (grant.subjectKind === 'USER') {
      if (typeof subjectUserId !== 'string' || subjectUserId.length === 0 || subjectRoleId !== null)
        throw invalidGrant('GRANT_USER_SUBJECT_INVALID', { index });
      const subject = `USER:${subjectUserId}`;
      if (seenSubjects.has(subject))
        throw invalidGrant('GRANT_SUBJECT_DUPLICATED', { index, subject });
      seenSubjects.add(subject);
    } else {
      if (typeof subjectRoleId !== 'string' || subjectRoleId.length === 0 || subjectUserId !== null)
        throw invalidGrant('GRANT_ROLE_SUBJECT_INVALID', { index });
      const subject = `ROLE:${subjectRoleId}`;
      if (seenSubjects.has(subject))
        throw invalidGrant('GRANT_SUBJECT_DUPLICATED', { index, subject });
      seenSubjects.add(subject);
    }

    if (!Array.isArray(grant.permissions) || grant.permissions.length === 0)
      throw invalidGrant('GRANT_PERMISSIONS_EMPTY', { index });
    const permissions: KnowledgePermissionValue[] = [];
    const seenPermissions = new Set<string>();
    for (const permission of grant.permissions) {
      if (!(KNOWLEDGE_GRANT_PERMISSIONS as readonly string[]).includes(permission))
        throw invalidGrant('GRANT_PERMISSION_INVALID', { index, permission });
      if (seenPermissions.has(permission))
        throw invalidGrant('GRANT_PERMISSION_DUPLICATED', { index, permission });
      seenPermissions.add(permission);
      permissions.push(permission as KnowledgePermissionValue);
    }

    normalized.push({ subjectKind: grant.subjectKind, subjectUserId, subjectRoleId, permissions });
  });

  return normalized;
}

type KnowledgePermissionValue = (typeof KNOWLEDGE_GRANT_PERMISSIONS)[number];

function assertVisibility(visibility: string): asserts visibility is KnowledgeVisibility {
  if (!(KNOWLEDGE_VISIBILITIES as readonly string[]).includes(visibility))
    throw new WorkmeshError(
      V1_ERROR_CODES.VALIDATION_FAILED,
      'KNOWLEDGE_VISIBILITY_INVALID',
      { visibility },
      422,
    );
}

@Injectable()
export class V1KnowledgeBaseService {
  constructor(
    @Inject(V1_KNOWLEDGE_BASE_REPOSITORY) private readonly repository: V1KnowledgeBaseRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  /** HUMAN 项目管理者创建 KB；创建者显式获得全部内容权限，其他成员不自动获得写权限。 */
  async createKnowledgeBase(
    principal: Principal,
    projectId: string,
    input: V1CreateKnowledgeBaseInput,
    context: V1KnowledgeActionContext,
  ): Promise<V1KnowledgeBaseView> {
    assertHuman(principal);
    assertVisibility(input.visibility);

    let membershipRole: ProjectManagementRole;
    try {
      const resolved = await this.authorization.resolveProjectContext(
        principal,
        projectId,
        'write',
      );
      membershipRole = resolved.membership.role;
    } catch {
      throw projectNotFound(projectId);
    }
    if (!isProjectManager(membershipRole)) throw projectNotFound(projectId);

    const projectScope = `project:${projectId}`;
    const ownerScope = principalScopeKey(principal);
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const existing = await this.operations.findOperation({
      projectScopeKey: projectScope,
      principalScopeKey: ownerScope,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      return existing.resultRefs.knowledgeBase as V1KnowledgeBaseView;
    }

    return this.repository.createKnowledgeBase({
      projectId,
      key: input.key,
      name: input.name,
      visibility: input.visibility,
      creatorUserId: principal.userId,
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey: projectScope,
        principalScopeKey: ownerScope,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    });
  }

  /** 当前活动成员按 KB 可见性分页；OWNER/ADMIN 读取管理列表。 */
  async listKnowledgeBases(
    principal: Principal,
    projectId: string,
    query: V1KnowledgeBaseListQuery,
  ): Promise<{ items: V1KnowledgeBaseView[]; nextCursor: string | null; hasMore: boolean }> {
    let context;
    try {
      context = await this.authorization.resolveProjectContext(principal, projectId, 'read');
    } catch {
      throw projectNotFound(projectId);
    }
    const management = isProjectManager(context.membership.role);
    const limit = Number.isInteger(query.limit)
      ? Math.min(Math.max(query.limit ?? 20, 1), 100)
      : 20;
    const page = await this.repository.listKnowledgeBases(projectId, {
      limit,
      cursor: query.cursor ?? null,
      management,
      principalUserId: principal.userId,
    });

    const items: V1KnowledgeBaseView[] = [];
    for (const knowledgeBase of page.items) {
      if (management) {
        items.push(knowledgeBase);
        continue;
      }
      try {
        const access = await this.authorization.resolveKnowledgeAccess(principal, knowledgeBase.id);
        if (access.canRead) items.push(knowledgeBase);
      } catch {
        // 不可读的库在普通列表中完全不可见。
      }
    }

    return { items, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  /** ACL 读取仅限 HUMAN OWNER/ADMIN；无权一律 404，且保留已撤销 grant 历史。 */
  async getAccess(
    principal: Principal,
    knowledgeBaseId: string,
  ): Promise<V1KnowledgeBaseAccessView> {
    const knowledgeBase = await this.repository.findKnowledgeBase(knowledgeBaseId);
    if (!knowledgeBase) throw knowledgeBaseNotFound(knowledgeBaseId);
    if (principal.kind !== 'HUMAN') throw knowledgeBaseNotFound(knowledgeBaseId);

    let membershipRole: ProjectManagementRole;
    try {
      const resolved = await this.authorization.resolveProjectContext(
        principal,
        knowledgeBase.projectId,
        'read',
      );
      membershipRole = resolved.membership.role;
    } catch {
      throw knowledgeBaseNotFound(knowledgeBaseId);
    }
    if (!isProjectManager(membershipRole)) throw knowledgeBaseNotFound(knowledgeBaseId);

    const grants = await this.repository.listAccessGrants(knowledgeBaseId);
    return {
      knowledgeBaseId: knowledgeBase.id,
      projectId: knowledgeBase.projectId,
      visibility: knowledgeBase.visibility,
      version: knowledgeBase.version,
      authzVersion: knowledgeBase.authzVersion,
      publicationApproverUserId: knowledgeBase.publicationApproverUserId,
      publicationApproverRoleId: knowledgeBase.publicationApproverRoleId,
      grants,
    };
  }

  /**
   * 替换 ACL：版本 + authzVersion 双重 CAS、票据绑定、撤销旧 grant 并追加新集合，
   * 全部在同一次 Serializable 事务内完成。
   */
  async replaceAccess(
    principal: Principal,
    knowledgeBaseId: string,
    input: V1ReplaceKnowledgeAccessInput,
    context: V1KnowledgeReplaceContext,
  ): Promise<V1KnowledgeBaseAccessView> {
    const knowledgeBase = await this.repository.findKnowledgeBase(knowledgeBaseId);
    if (!knowledgeBase) throw knowledgeBaseNotFound(knowledgeBaseId);
    if (principal.kind !== 'HUMAN') throw knowledgeBaseNotFound(knowledgeBaseId);
    if (!context.webSessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );

    let membershipRole: ProjectManagementRole;
    try {
      const resolved = await this.authorization.resolveProjectContext(
        principal,
        knowledgeBase.projectId,
        'write',
      );
      membershipRole = resolved.membership.role;
    } catch {
      throw knowledgeBaseNotFound(knowledgeBaseId);
    }
    if (!isProjectManager(membershipRole)) throw knowledgeBaseNotFound(knowledgeBaseId);

    const ownerScope = principalScopeKey(principal);
    const projectScope = `project:${knowledgeBase.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const existing = await this.operations.findOperation({
      projectScopeKey: projectScope,
      principalScopeKey: ownerScope,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      return existing.resultRefs.access as V1KnowledgeBaseAccessView;
    }

    assertVisibility(input.visibility);
    if (
      typeof input.reason !== 'string' ||
      input.reason.trim().length === 0 ||
      input.reason.length > 1000
    )
      throw new WorkmeshError(V1_ERROR_CODES.VALIDATION_FAILED, 'REASON_INVALID', undefined, 422);

    const grants = normalizeGrants(input.grants);

    const approver = await this.repository.findMember(
      knowledgeBase.projectId,
      input.publicationApproverUserId,
    );
    if (!approver || approver.revokedAt)
      throw invalidGrant('PUBLICATION_APPROVER_NOT_ACTIVE_MEMBER', {
        publicationApproverUserId: input.publicationApproverUserId,
      });

    const roleIds = new Set<string>();
    if (input.publicationApproverRoleId) roleIds.add(input.publicationApproverRoleId);
    for (const grant of grants)
      if (grant.subjectKind === 'ROLE' && grant.subjectRoleId) roleIds.add(grant.subjectRoleId);
    if (roleIds.size > 0) {
      const roles = await this.repository.findProjectRoles(knowledgeBase.projectId, [...roleIds]);
      const activeIds = new Set(roles.filter((role) => role.isActive).map((role) => role.id));
      if (input.publicationApproverRoleId && !activeIds.has(input.publicationApproverRoleId))
        throw invalidGrant('PUBLICATION_APPROVER_ROLE_NOT_ACTIVE', {
          publicationApproverRoleId: input.publicationApproverRoleId,
        });
      for (const grant of grants) {
        if (
          grant.subjectKind === 'ROLE' &&
          grant.subjectRoleId &&
          !activeIds.has(grant.subjectRoleId)
        )
          throw invalidGrant('GRANT_ROLE_NOT_ACTIVE', { subjectRoleId: grant.subjectRoleId });
      }
    }

    const binding = {
      action: KB_ACCESS_REPLACE_ACTION,
      projectId: knowledgeBase.projectId,
      targetType: KNOWLEDGE_BASE_TARGET_TYPE,
      targetId: knowledgeBase.id,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: {
        expectedAuthzVersion: input.expectedAuthzVersion,
        visibility: input.visibility,
        publicationApproverUserId: input.publicationApproverUserId,
        publicationApproverRoleId: input.publicationApproverRoleId,
        grants: grants.map((grant) => ({
          subjectKind: grant.subjectKind,
          subjectUserId: grant.subjectUserId,
          subjectRoleId: grant.subjectRoleId,
          permissions: grant.permissions,
        })),
        reason: input.reason,
      },
    } as const;

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

    return this.repository.replaceAccess({
      knowledgeBaseId: knowledgeBase.id,
      expectedVersion: input.expectedVersion,
      expectedAuthzVersion: input.expectedAuthzVersion,
      visibility: input.visibility,
      publicationApproverUserId: input.publicationApproverUserId,
      publicationApproverRoleId: input.publicationApproverRoleId,
      grants,
      reason: input.reason,
      actorUserId: principal.userId,
      ticket: { id: ticket.id, secretHash: ticket.secretHash, webSessionId: context.webSessionId },
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey: projectScope,
        principalScopeKey: ownerScope,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    });
  }

  /** 仅检索当前发布修订；正文非法 UTF-8 时只按标题匹配。 */
  async search(
    principal: Principal,
    knowledgeBaseId: string,
    query: { q: string; limit?: number; cursor?: string | null },
  ): Promise<V1KnowledgeBaseSearchResult> {
    const knowledgeBase = await this.repository.findKnowledgeBase(knowledgeBaseId);
    if (!knowledgeBase) throw knowledgeBaseNotFound(knowledgeBaseId);
    try {
      const access = await this.authorization.resolveKnowledgeAccess(principal, knowledgeBaseId);
      if (!access.canRead)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'KNOWLEDGE_NOT_READABLE',
          { knowledgeBaseId },
          404,
        );
    } catch (error) {
      if (error instanceof WorkmeshError) throw error;
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        { knowledgeBaseId },
        404,
      );
    }

    const limit = Number.isInteger(query.limit)
      ? Math.min(Math.max(query.limit ?? 20, 1), 100)
      : 20;
    const page = await this.repository.searchKnowledgeBase({
      knowledgeBaseId,
      knowledgeBaseName: knowledgeBase.name,
      knowledgeBaseKind: knowledgeBase.kind,
      q: query.q,
      limit,
      cursor: query.cursor ?? null,
    });
    return {
      items: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
      truncated: page.truncated,
    };
  }
}
