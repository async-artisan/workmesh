import { Inject, Injectable } from '@nestjs/common';
import {
  containsForbiddenAgentScope,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
  type Scope,
} from '@workmesh/shared';

export type ProjectManagementRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type KnowledgePermission = 'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE';
export type KnowledgeVisibility = 'PROJECT' | 'RESTRICTED';

export type V1ProjectRecord = {
  id: string;
  version: number;
  archivedAt: Date | null;
};

export type V1MemberRecord = {
  projectId: string;
  userId: string;
  role: ProjectManagementRole;
  version: number;
  revokedAt: Date | null;
};

export type V1RoleAssignmentRecord = {
  id: string;
  projectId: string;
  userId: string;
  roleId: string;
  version: number;
  revokedAt: Date | null;
};

export type V1KnowledgeBaseRecord = {
  id: string;
  projectId: string;
  visibility: KnowledgeVisibility;
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  archivedAt: Date | null;
};

export type V1GrantRecord = {
  id: string;
  knowledgeBaseId: string;
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: readonly string[];
  revokedAt: Date | null;
};

export interface V1AuthorizationRepository {
  findProject(projectId: string): Promise<V1ProjectRecord | null>;
  findMember(projectId: string, userId: string): Promise<V1MemberRecord | null>;
  findActiveRoleAssignments(projectId: string, userId: string): Promise<V1RoleAssignmentRecord[]>;
  findRoleAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<V1RoleAssignmentRecord | null>;
  findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseRecord | null>;
  findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]>;
}

export const V1_AUTHORIZATION_REPOSITORY = Symbol('V1_AUTHORIZATION_REPOSITORY');

const KNOWLEDGE_PERMISSIONS: readonly KnowledgePermission[] = [
  'READ',
  'PROPOSE',
  'PUBLISH',
  'REVOKE',
];

/**
 * 当前项目上下文。一切项目内动作都必须先经过它，不能只按 userId 合并其全部角色权限。
 */
export type V1ProjectContext = {
  project: V1ProjectRecord;
  membership: V1MemberRecord;
  /** 当前仍活动的业务角色 ID；AGENT 恒为其凭据唯一角色且仍有活动 assignment。 */
  activeRoleIds: readonly string[];
  /** 主体在此项目下唯一可使用的业务角色；HUMAN 持多角色时由调用方明确选择。 */
  selectableRoleIds: readonly string[];
};

export type V1KnowledgeAccess = {
  knowledgeBase: V1KnowledgeBaseRecord;
  projectId: string;
  permissions: readonly KnowledgePermission[];
  isActiveMember: boolean;
  canRead: boolean;
  canPropose: boolean;
  canPublish: boolean;
  canRevoke: boolean;
};

export function notFound(code: string, details?: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, code, details, 404);
}

@Injectable()
export class V1AuthorizationService {
  constructor(
    @Inject(V1_AUTHORIZATION_REPOSITORY) private readonly repository: V1AuthorizationRepository,
  ) {}

  /**
   * 解析目标真实项目的当前授权上下文。
   * - 目标不存在、主体不是当前活动成员、或 Agent 跨项目：一律 404，不泄露对象存在性。
   * - 已可见但动作权限不足的场景由各动作自行返回 403。
   */
  async resolveProjectContext(principal: Principal, projectId: string): Promise<V1ProjectContext> {
    if (!projectId) throw notFound('PROJECT_ID_REQUIRED');
    // Agent 的 projectId 必须完全相同；不允许借用户其他项目关系提权。
    if (principal.kind === 'AGENT' && principal.projectId !== projectId)
      throw notFound('CROSS_PROJECT_AGENT', { principalProjectId: principal.projectId ?? null });

    const project = await this.repository.findProject(projectId);
    if (!project) throw notFound('PROJECT_NOT_FOUND', { projectId });

    const membership = await this.repository.findMember(projectId, principal.userId);
    if (!membership || membership.revokedAt) throw notFound('MEMBER_NOT_ACTIVE', { projectId });

    const assignments = (
      await this.repository.findActiveRoleAssignments(projectId, principal.userId)
    ).filter((item) => !item.revokedAt);
    const activeRoleIds = assignments.map((item) => item.roleId);

    if (principal.kind === 'AGENT') {
      const roleId = principal.roleIds?.[0];
      // Agent 只能使用其凭据唯一业务角色，且该 assignment 仍须活动。
      if (!roleId || !activeRoleIds.includes(roleId))
        throw new WorkmeshError(
          V1_ERROR_CODES.ROLE_INACTIVE,
          'AGENT_ROLE_ASSIGNMENT_INACTIVE',
          { projectId },
          422,
        );
      return { project, membership, activeRoleIds: [roleId], selectableRoleIds: [roleId] };
    }

    return { project, membership, activeRoleIds, selectableRoleIds: activeRoleIds };
  }

  /** 要求主体对本项目持有指定 scope；Agent 请求受保护能力时以 422 拒绝而非静默放行。 */
  async requireScope(principal: Principal, projectId: string, scope: Scope): Promise<void> {
    if (principal.kind !== 'AGENT') return;
    if (containsForbiddenAgentScope(principal.scopes))
      throw new WorkmeshError(
        V1_ERROR_CODES.UNSUPPORTED_SCOPE,
        'AGENT_SCOPE_REGISTRY_VIOLATION',
        { projectId },
        422,
      );
    if (!principal.scopes.includes(scope))
      throw new WorkmeshError(
        V1_ERROR_CODES.SCOPE_DENIED,
        'SCOPE_DENIED',
        { scope, projectId },
        403,
      );
  }

  /**
   * 解析当前 KB 权限交集。顺序固定：
   * 项目与成员 → Agent 项目/角色边界 → 当前 USER/ROLE grant 并集 → scope 交集 → 可见性默认值。
   */
  async resolveKnowledgeAccess(
    principal: Principal,
    knowledgeBaseId: string,
  ): Promise<V1KnowledgeAccess> {
    const knowledgeBase = await this.repository.findKnowledgeBase(knowledgeBaseId);
    if (!knowledgeBase) throw notFound('KNOWLEDGE_BASE_NOT_FOUND', { knowledgeBaseId });

    const context = await this.resolveProjectContext(principal, knowledgeBase.projectId);
    const grants = (await this.repository.findGrants(knowledgeBaseId)).filter(
      (grant) => !grant.revokedAt,
    );

    const permissions = new Set<KnowledgePermission>();
    // visibility=PROJECT：所有活动项目成员默认 READ；不默认 PROPOSE/PUBLISH/REVOKE。
    if (knowledgeBase.visibility === 'PROJECT') permissions.add('READ');

    const allowedRoleIds = new Set(context.activeRoleIds);
    for (const grant of grants) {
      const matchesUser = grant.subjectKind === 'USER' && grant.subjectUserId === principal.userId;
      // ROLE grant 必须匹配当前活动 assignment；AGENT 只匹配其凭据 roleId，不借授权人的其他业务角色。
      const matchesRole =
        grant.subjectKind === 'ROLE' &&
        grant.subjectRoleId !== null &&
        allowedRoleIds.has(grant.subjectRoleId);
      if (!matchesUser && !matchesRole) continue;
      for (const permission of grant.permissions) {
        if ((KNOWLEDGE_PERMISSIONS as readonly string[]).includes(permission))
          permissions.add(permission as KnowledgePermission);
      }
    }

    const effective = this.intersectWithScope(principal, permissions);
    return {
      knowledgeBase,
      projectId: knowledgeBase.projectId,
      permissions: [...effective],
      isActiveMember: true,
      canRead: effective.has('READ'),
      canPropose: effective.has('PROPOSE'),
      canPublish: effective.has('PUBLISH'),
      canRevoke: effective.has('REVOKE'),
    };
  }

  /**
   * Agent 的 KB 能力上限：仅 READ/PROPOSE 且对应 scope；PUBLISH/REVOKE 永不授予。
   */
  private intersectWithScope(
    principal: Principal,
    permissions: Set<KnowledgePermission>,
  ): Set<KnowledgePermission> {
    const effective = new Set(permissions);
    if (principal.kind !== 'AGENT') {
      // HUMAN 不依赖 scope 声明，权限完全来自当前成员/角色/grant。
      return effective;
    }
    if (!principal.scopes.includes('knowledge:read')) effective.delete('READ');
    if (!principal.scopes.includes('knowledge:propose')) effective.delete('PROPOSE');
    effective.delete('PUBLISH');
    effective.delete('REVOKE');
    // 没有 READ 的 PROPOSE 不成立：读取是所有内容出口的前置。
    if (!effective.has('READ')) effective.delete('PROPOSE');
    return effective;
  }

  async assertCanReadKnowledge(
    principal: Principal,
    knowledgeBaseId: string,
  ): Promise<V1KnowledgeAccess> {
    const access = await this.resolveKnowledgeAccess(principal, knowledgeBaseId);
    if (!access.canRead) throw notFound('KNOWLEDGE_NOT_READABLE', { knowledgeBaseId });
    return access;
  }

  async assertCanProposeKnowledge(
    principal: Principal,
    knowledgeBaseId: string,
  ): Promise<V1KnowledgeAccess> {
    const access = await this.assertCanReadKnowledge(principal, knowledgeBaseId);
    if (principal.kind === 'AGENT')
      await this.requireScope(principal, access.projectId, 'knowledge:propose');
    if (!access.canPropose)
      throw new WorkmeshError(
        V1_ERROR_CODES.KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED,
        'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED',
        { knowledgeBaseId },
        403,
      );
    return access;
  }

  async assertCanPublishKnowledge(
    principal: Principal,
    knowledgeBaseId: string,
  ): Promise<V1KnowledgeAccess> {
    const access = await this.assertCanReadKnowledge(principal, knowledgeBaseId);
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    if (!access.canPublish)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_PUBLISH_PERMISSION_REQUIRED,
        'HUMAN_PUBLISH_PERMISSION_REQUIRED',
        { knowledgeBaseId },
        403,
      );
    return access;
  }

  /**
   * 当前主体是否满足某个审批槽要求。AGENT 永不满足；ROLE 槽要求当前活动 assignment。
   */
  async hasBusinessRole(
    principal: Principal,
    projectId: string,
    roleId: string | null,
  ): Promise<boolean> {
    if (!roleId) return principal.kind === 'HUMAN';
    if (principal.kind === 'AGENT')
      return principal.roleIds?.length === 1 && principal.roleIds[0] === roleId;
    const assignment = await this.repository.findRoleAssignment(
      projectId,
      principal.userId,
      roleId,
    );
    return Boolean(assignment && !assignment.revokedAt);
  }
}
