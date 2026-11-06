import type {
  KnowledgePermission,
  KnowledgeVisibility,
  ProjectManagementRole,
} from '../auth/v1-authorization';

export const V1_KNOWLEDGE_BASE_REPOSITORY = Symbol('V1_KNOWLEDGE_BASE_REPOSITORY');

export type V1KnowledgeBaseView = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  /** 分类由 KnowledgeBase.kind 提供；保留 string 以兼容模板扩展的类别。 */
  kind: string;
  visibility: KnowledgeVisibility;
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  archivedAt: string | null;
};

export type V1KnowledgeBaseGrantView = {
  id: string;
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: string[];
  version: number;
  grantedAt: string;
  revokedAt: string | null;
};

export type V1KnowledgeBaseAccessView = {
  knowledgeBaseId: string;
  projectId: string;
  visibility: KnowledgeVisibility;
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  grants: V1KnowledgeBaseGrantView[];
};

export type V1KnowledgeBaseSearchItem = {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeBaseKind: string;
  revisionId: string;
  documentId: string;
  documentKind: string;
  status: 'PUBLISHED';
  title: string;
  excerpt: string;
  sha256: string;
};

export type V1KnowledgeBaseListQuery = {
  limit?: number;
  cursor?: string | null;
};

export type V1KnowledgeGrantInput = {
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: KnowledgePermission[];
};

/** 幂等操作的最小写入描述；仓储在业务事务内一并落库。 */
export type V1KnowledgeOperation = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
};

export type V1KnowledgeMemberRecord = {
  projectId: string;
  userId: string;
  role: ProjectManagementRole;
  revokedAt: Date | null;
};

export type V1KnowledgeProjectRoleRecord = {
  id: string;
  projectId: string;
  isActive: boolean;
};

export interface V1KnowledgeBaseRepository {
  createKnowledgeBase(input: {
    projectId: string;
    key: string;
    name: string;
    visibility: KnowledgeVisibility;
    creatorUserId: string;
    now: Date;
    operation: V1KnowledgeOperation;
  }): Promise<V1KnowledgeBaseView>;

  /**
   * 按项目与稳定排序分页；可见性过滤在服务层按当前授权逐项执行，
   * 避免普通列表返回受限库的标题或跨权限总量。
   */
  listKnowledgeBases(
    projectId: string,
    query: { limit: number; cursor: string | null; management: boolean; principalUserId: string },
  ): Promise<{ items: V1KnowledgeBaseView[]; nextCursor: string | null; hasMore: boolean }>;

  findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseView | null>;

  /** 返回全部历史（含已撤销），由 Web 自行按 revokedAt 过滤。 */
  listAccessGrants(knowledgeBaseId: string): Promise<V1KnowledgeBaseGrantView[]>;

  replaceAccess(input: {
    knowledgeBaseId: string;
    expectedVersion: number;
    expectedAuthzVersion: number;
    visibility: KnowledgeVisibility;
    publicationApproverUserId: string;
    publicationApproverRoleId: string | null;
    grants: V1KnowledgeGrantInput[];
    reason: string;
    actorUserId: string;
    ticket: { id: string; secretHash: string; webSessionId: string };
    operation: V1KnowledgeOperation;
    now: Date;
  }): Promise<V1KnowledgeBaseAccessView>;

  searchKnowledgeBase(input: {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    knowledgeBaseKind: string;
    q: string;
    limit: number;
    cursor: string | null;
  }): Promise<{
    items: V1KnowledgeBaseSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
    truncated: boolean;
  }>;

  findMember(projectId: string, userId: string): Promise<V1KnowledgeMemberRecord | null>;

  findProjectRoles(
    projectId: string,
    roleIds: readonly string[],
  ): Promise<V1KnowledgeProjectRoleRecord[]>;
}
