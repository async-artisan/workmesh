import { apiRequest } from './client';
import type {
  CodeEvidenceDiagnostics,
  TaskClaimEligibility,
  WorkflowCompiledRules,
} from '@workmesh/shared';

export interface ProjectView {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  version: number;
  defaultKnowledgeBaseId?: string | null;
  archivedAt?: string | null;
}

export interface MemberView {
  id: string;
  email: string;
  name?: string | null;
  role: string;
  version: number;
  roles?: Array<{ id: string; key: string; title: string }>;
}

export interface RoleView {
  id: string;
  projectId: string;
  key: string;
  title: string;
  isActive?: boolean;
  version?: number;
}

export type DocumentKind = 'UNDERSTANDING' | 'DECISION' | 'PRD' | 'KNOWLEDGE';
export type RevisionState = 'CANDIDATE' | 'PUBLISHED' | 'WITHDRAWN';

export interface DocumentView {
  id: string;
  projectId: string;
  knowledgeBaseId: string;
  requirementId: string | null;
  kind: DocumentKind;
  version: number;
  currentPublishedRevisionId: string | null;
  archivedAt: string | null;
}

export interface RevisionView {
  id: string;
  documentId: string;
  seq: number;
  title: string;
  mimeType: string;
  byteLength: number;
  digest: string;
  state: RevisionState;
  createdBy: string;
  basisUnderstandingRevisionId: string | null;
  deliveryScope: Record<string, unknown> | null;
  acceptance: Array<{ key: string; text: string; verification: string }> | null;
  /** 最近一次与该 revision 关联的评审请求，供 PRD 页面进入人工评审。 */
  reviewRequestId?: string | null;
}

export interface DocumentDetail {
  document: DocumentView;
  revisions: RevisionView[];
  publishedRevision: RevisionView | null;
}

export interface ReviewSlot {
  id: string;
  slotKey: string;
  requiredRoleId: string | null;
  requiredUserId: string;
  sourceSlotBindingId: string | null;
  /** 服务端按当前用户派生；详情接口返回，列表接口可能缺省。 */
  viewerCanDecide?: boolean;
}

export interface ReviewDecision {
  id: string;
  approvalSlotId: string;
  decision: 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';
  subjectDigest: string;
  comment: string | null;
  createdById: string;
  createdAt: string;
  actor?: { id: string; email: string } | null;
}

export interface ReviewView {
  id: string;
  projectId: string;
  kind: string;
  status: string;
  version: number;
  subjectDigest: string;
  documentRevisionId: string | null;
  artifactSetId: string | null;
  taskId: string | null;
  slots: ReviewSlot[];
  decisions: ReviewDecision[];
  subject: Record<string, unknown> | null;
  requirement?: { id: string; code: string; title: string } | null;
  subjectLabel?: string | null;
  stepDisplayName?: string | null;
  role?: { id: string; key: string; title: string } | null;
}

export interface BoardCard {
  taskId: string;
  projectId: string;
  stepKey: string;
  stepDisplayName?: string | null;
  roleId: string;
  requirementId?: string;
  requirementCode?: string;
  requirementTitle?: string;
  roleKey?: string;
  roleTitle?: string;
  responsibleUserEmail?: string;
  claimedUserEmail?: string;
  executionStatus: string;
  workStatus: string | null;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  claimedUserId: string | null;
  claimedAt: string | null;
  generation: number;
}

export type BoardColumnKey =
  'BACKLOG' | 'ACTIVE' | 'BLOCKED' | 'PAUSED' | 'CANCELLED' | 'DELIVERED';

export interface BoardQuery {
  q?: string;
  roleTitle?: string;
  requirementCode?: string;
  limit?: number;
  cursor?: string;
}

export interface BoardSummary {
  total: number;
  matchedTotal: number;
  columns: Array<{ key: BoardColumnKey; total: number }>;
  requirementTotal: number;
}

export interface BoardColumn {
  key: BoardColumnKey;
  total: number;
  cards: BoardCard[];
  nextCursor: string | null;
}

export interface BoardSnapshot {
  projectId: string;
  queryKey: string;
  summary: BoardSummary;
  columns: BoardColumn[];
}

export interface BoardColumnPage extends BoardColumn {
  projectId: string;
  queryKey: string;
}

export interface BoardRequirementGroup {
  code: string;
  title: string;
  total: number;
  counts: Record<BoardColumnKey, number>;
  roles: string[];
  roleTotal: number;
  rolesNextCursor: string | null;
}

export interface BoardRequirementPage {
  projectId: string;
  queryKey: string;
  summary: BoardSummary;
  items: BoardRequirementGroup[];
  nextCursor: string | null;
}

export interface BoardFilterPage {
  projectId: string;
  queryKey: string;
  total: number;
  items: Array<{ value: string; label: string }>;
  nextCursor: string | null;
}

export interface TaskView {
  id: string;
  projectId: string;
  workflowInstanceId: string;
  stepKey: string;
  stepDisplayName?: string | null;
  roleId: string;
  responsibleUserId: string;
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaim: { id: string; userId: string; releasedAt: string | null } | null;
}

export interface ChangeRecipient {
  id: string;
  projectId: string;
  eventId: string;
  userId: string;
  roleId: string | null;
  version: number;
  ackedAt: string | null;
  createdAt: string;
}

export interface AccessGrant {
  id: string;
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: Array<'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE'>;
  version: number;
  grantedAt: string;
  revokedAt: string | null;
}

export interface AccessView {
  knowledgeBaseId: string;
  projectId: string;
  visibility: string;
  version: number;
  authzVersion: number;
  publicationApproverUserId: string | null;
  publicationApproverRoleId: string | null;
  grants: AccessGrant[];
}

/** The three knowledge collections exposed by the project knowledge API. */
export type KnowledgeBaseKind = 'BUSINESS' | 'SYSTEM' | 'PRACTICE';

export interface KnowledgeBaseView {
  id: string;
  projectId: string;
  key: string;
  name: string;
  /** Comes from the server's KnowledgeBase.kind field; do not infer it from the key or name. */
  kind: KnowledgeBaseKind | (string & {});
  visibility: 'PROJECT' | 'RESTRICTED';
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  archivedAt: string | null;
}

export interface KnowledgeBaseSearchItem {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  knowledgeBaseKind: KnowledgeBaseKind | (string & {});
  revisionId: string;
  documentId: string;
  documentKind: string;
  /** The revision state represented by this search hit. Current API searches published revisions. */
  status: RevisionState;
  title: string;
  excerpt: string;
  sha256: string;
}

export interface KnowledgeBaseListPage extends ListPage<KnowledgeBaseView> {
  hasMore: boolean;
}

export interface KnowledgeBaseSearchPage extends ListPage<KnowledgeBaseSearchItem> {
  hasMore: boolean;
  truncated: boolean;
}

/** Read-only system-unit and dependency records used inside the SYSTEM knowledge collection. */
export interface ProjectUnitView {
  id: string;
  projectId: string;
  key: string;
  name: string;
  kind: string;
  repositoryId: string | null;
  repoPath: string | null;
  ownerUserId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectUnitDependencyView {
  id: string;
  projectId: string;
  fromUnitId: string;
  toUnitId: string;
  edgeKind: string;
  protocol: string | null;
  contractDocumentId: string | null;
  source: string;
  confidence: string;
  evidence: string | null;
  verifiedAt: string | null;
  createdAt: string;
  fromUnit: { key: string; name: string } | null;
  toUnit: { key: string; name: string } | null;
}

export interface Confirmation {
  ticketId: string;
  ticketSecret: string;
}

export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore?: boolean;
}

const enc = (value: string) => encodeURIComponent(value);
const projectPath = (projectId: string) => `/projects/${enc(projectId)}`;

export function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

export function base64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export interface RequirementView {
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
  createdAt: string;
  updatedAt: string;
}

export interface RequirementTaskDetail {
  id: string;
  stepKey: string;
  stepDisplayName?: string | null;
  role: { key: string; title: string };
  responsibleUser: { id: string; email: string };
  claimEligibility?: TaskClaimEligibility;
  workflowWorkStatus?: string;
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  instanceId: string;
  artifactCount: number;
  review: {
    id: string;
    kind: string;
    status: string;
    decisions?: Array<{
      id: string;
      decision: string;
      createdAt: string;
      actor: { id: string; email: string } | null;
    }>;
  } | null;
}

export interface RequirementArtifactDetail {
  id: string;
  taskId: string;
  artifactSetId?: string;
  kind: string;
  storage: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  commitSha: string | null;
  repoPath: string | null;
  summary: string | null;
  checks: unknown;
  createdAt: string;
}

export interface RequirementReviewDetail {
  id: string;
  kind: string;
  status: string;
  version: number;
  subjectDigest: string;
  documentRevisionId: string | null;
  artifactSetId: string | null;
  taskId: string | null;
  createdAt: string;
  subjectLabel: string;
  stepDisplayName?: string | null;
  slots: Array<{
    id: string;
    slotKey: string;
    requiredUserId: string;
    requiredRoleId: string | null;
  }>;
  decisions: Array<{
    id: string;
    approvalSlotId: string;
    decision: string;
    comment: string | null;
    createdAt: string;
    actor: { id: string; email: string } | null;
  }>;
}

export interface RequirementChangeDetail {
  id: string;
  sourceKind: string;
  sourceId: string;
  changedFields: string[];
  targets: unknown;
  createdAt: string;
  recipients: Array<{
    id: string;
    userId: string;
    roleId: string | null;
    ackedAt: string | null;
    version: number;
  }>;
}

export interface RequirementDetail {
  requirement: RequirementView;
  /** 当前发布 PRD 的验收 key；创建流程实例时必须逐条分配到任务。 */
  acceptanceKeys: string[];
  tasks: RequirementTaskDetail[];
  artifacts: RequirementArtifactDetail[];
  reviews: RequirementReviewDetail[];
  changes: RequirementChangeDetail[];
  counts: { tasks: number; artifacts: number; reviews: number; changes: number };
  /** Absent on older servers; absence is not proof of a complete chain. */
  trustChain?: import('@workmesh/shared').RequirementTrustChain;
}

export const projectApi = {
  list: () => apiRequest<ProjectView[]>('/projects'),
  create: (data: { name: string; key: string; description?: string }) =>
    apiRequest<ProjectView>('/projects', { method: 'POST', body: data }),
  update: (projectId: string, data: { name?: string; description?: string }) =>
    apiRequest<ProjectView>(projectPath(projectId), { method: 'PUT', body: data }),
  archive: (projectId: string) =>
    apiRequest<ProjectView>(projectPath(projectId), { method: 'DELETE', idempotencyKey: 'auto' }),
  members: (projectId: string) => apiRequest<MemberView[]>(`${projectPath(projectId)}/members`),
  addMember: (projectId: string, email: string) =>
    apiRequest<MemberView>(`${projectPath(projectId)}/members`, {
      method: 'POST',
      body: { email },
    }),
  roles: (projectId: string) => apiRequest<RoleView[]>(`${projectPath(projectId)}/roles`),
  /** Read-only system units used by the SYSTEM knowledge collection's relations panel. */
  units: (projectId: string) => apiRequest<ProjectUnitView[]>(`${projectPath(projectId)}/units`),
  unitDependencies: (projectId: string) =>
    apiRequest<ProjectUnitDependencyView[]>(`${projectPath(projectId)}/unit-dependencies`),
  assignRole: (
    projectId: string,
    userId: string,
    roleId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest(`${projectPath(projectId)}/members/${enc(userId)}/roles/${enc(roleId)}`, {
      method: 'PUT',
      body: input,
      idempotencyKey: 'auto',
    }),
  revokeRole: (
    projectId: string,
    userId: string,
    roleId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest(`${projectPath(projectId)}/members/${enc(userId)}/roles/${enc(roleId)}/revoke`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
};

/**
 * Project knowledge collections and their published-document search.
 * The server applies project membership and knowledge-base read authorization before returning data.
 */
export interface KnowledgeBindingView {
  id: string;
  documentId: string;
  roleId: string | null;
  required: boolean;
}

export interface KnowledgeBindingsView {
  version: number;
  canManage: boolean;
  items: KnowledgeBindingView[];
}

export const knowledgeBindingApi = {
  list: (projectId: string) =>
    apiRequest<KnowledgeBindingsView>(`${projectPath(projectId)}/knowledge-bindings`),
  bind: (
    projectId: string,
    input: {
      expectedVersion: number;
      documentId: string;
      roleId: string | null;
      required: boolean;
    },
  ) =>
    apiRequest<{ version: number; binding: KnowledgeBindingView }>(
      `${projectPath(projectId)}/knowledge-bindings`,
      {
        method: 'PUT',
        body: input,
        idempotencyKey: 'auto',
      },
    ),
};

export const knowledgeBaseApi = {
  list: (projectId: string, input: { limit?: number; cursor?: string | null } = {}) => {
    const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.cursor) query.set('cursor', input.cursor);
    return apiRequest<KnowledgeBaseListPage>(
      `${projectPath(projectId)}/knowledge-bases?${query.toString()}`,
    );
  },
  search: (
    knowledgeBaseId: string,
    input: { q: string; limit?: number; cursor?: string | null },
  ) => {
    const query = new URLSearchParams({ q: input.q, limit: String(input.limit ?? 50) });
    if (input.cursor) query.set('cursor', input.cursor);
    return apiRequest<KnowledgeBaseSearchPage>(
      `/knowledge-bases/${enc(knowledgeBaseId)}/search?${query.toString()}`,
    );
  },
};

/**
 * 仓库身份模式（§7.4）：`DECLARED` 是 HUMAN 声明的受控 locator，
 * `PROVIDER` 才来自受支持 adapter 的稳定外部 ID。DECLARED 行的
 * `adapter/externalId` 必须为空，Web 不把 owner/name 或 URL 塞进这些字段。
 */
export type RepositoryIdentityMode = 'DECLARED' | 'PROVIDER';

/** 由 locator 推导出的来源协议；服务端返回，仅用于展示。 */
export type RepositoryLocatorSource = 'HTTPS' | 'SSH';

export interface ProjectRepositoryLocatorView {
  id: string;
  canonicalLocator: string;
  source?: RepositoryLocatorSource | string | null;
  declaredAt?: string | null;
}

/** PROVIDER 身份的稳定外部 ID；DECLARED 仓库该字段为空。 */
export interface ProjectRepositoryProviderView {
  adapter: string;
  externalId: string;
}

export interface ProjectRepositoryView {
  id: string;
  /** T2 扩展后的身份模式；旧响应缺失时由页面按 provider 字段保守判断，不推断“已验证”。 */
  identityMode?: RepositoryIdentityMode;
  /** 仅 PROVIDER 可非空；DECLARED 必须为空。 */
  adapter: string | null;
  /** 仅 PROVIDER 可非空；禁止用 owner/name 或 URL 冒充。 */
  externalId: string | null;
  /** 展示字段，不是身份字段。 */
  owner: string;
  name: string;
  defaultBranch: string | null;
  createdAt: string;
  archivedAt?: string | null;
  /** P0a 不执行真实 provider 核验，这里只展示服务端已有记录。 */
  lastVerifiedStatus?: string | null;
  lastVerifiedAt?: string | null;
  provider?: ProjectRepositoryProviderView | null;
  locators?: ProjectRepositoryLocatorView[];
}

/** 代码仓库登记：流程实例的 IMPL 步骤必须声明仓库范围，GIT_REF 工件只能引用这里的仓库。 */
export const repositoryApi = {
  list: (projectId: string) =>
    apiRequest<ProjectRepositoryView[]>(`${projectPath(projectId)}/repositories`),
};

/**
 * 工作区定义与接入码（T9 只读/编辑契约，来源 docs/design/project-workspace-onboarding.md §13.2–§13.5）。
 * 未发布定义时 `GET workspace-definition` 仍是 200 + `NOT_CONFIGURED`，不制造空 revision；
 * 该状态只用于展示与引导发布，不能签发接入码。
 */
export type WorkspaceDefinitionStatus = 'CONFIGURED' | 'NOT_CONFIGURED';
export type WorkspaceLayoutKind = 'SINGLE_ROOT' | 'MULTI_ROOT' | 'NONE';
export type WorkspaceRelationType = 'SUBMODULE_OF' | 'NESTED_IN';

export interface WorkspaceDefinitionIssue {
  path: string;
  code: string;
  message: string;
}

export interface WorkspaceDefinitionRepositoryRef {
  key: string;
  projectRepositoryId: string;
  suggestedPath: string | null;
  defaultRef: string | null;
  description: string | null;
}

export interface WorkspaceDefinitionRelation {
  type: WorkspaceRelationType;
  repositoryKey: string;
  parentRepositoryKey: string;
}

export interface WorkspaceContextPolicy {
  requiredDocumentIds: string[];
  roleDocumentIds: Record<string, string[]>;
  repositoryDocuments: Array<Record<string, unknown>>;
}

/** 定义 payload：文档引用只存在 JSON 里，不建文档关系表（§21.1 冻结）。 */
export interface WorkspaceDefinitionPayload {
  schemaVersion: string;
  projectId?: string;
  layout: { kind: WorkspaceLayoutKind };
  repositories: WorkspaceDefinitionRepositoryRef[];
  relations?: WorkspaceDefinitionRelation[];
  roleHints?: Record<string, { recommendedRepositoryKeys: string[] }>;
  contextPolicy?: WorkspaceContextPolicy;
  [key: string]: unknown;
}

/** GET 定义响应里的仓库条目：拓扑引用 + 服真实仓库身份字段（DECLARED/PROVIDER）。 */
export interface WorkspaceDefinitionRepositoryView extends WorkspaceDefinitionRepositoryRef {
  identityMode: RepositoryIdentityMode;
  adapter: string | null;
  externalId: string | null;
  owner: string;
  name: string;
  archivedAt: string | null;
  provider?: ProjectRepositoryProviderView | null;
  locators?: ProjectRepositoryLocatorView[];
}

export interface WorkspaceDefinitionDraftView {
  definitionVersion: number;
  payloadDigest: string;
  payload: WorkspaceDefinitionPayload;
  updatedAt: string;
}

export interface WorkspaceDefinitionView {
  definitionStatus: WorkspaceDefinitionStatus;
  projectId: string;
  projectVersion: number;
  definitionVersion: number;
  revisionId: string | null;
  revisionNo: number | null;
  digest: string | null;
  publishedAt: string | null;
  /** 当前已发布 payload；未配置时为 null。 */
  payload: WorkspaceDefinitionPayload | null;
  repositories: WorkspaceDefinitionRepositoryView[];
  /** 服务端已保存的草稿；没有草稿时为 null。 */
  draft: WorkspaceDefinitionDraftView | null;
  validation: { valid: boolean; issues: WorkspaceDefinitionIssue[] };
}

export interface WorkspaceDefinitionValidationResult {
  valid: boolean;
  digest: string | null;
  definition: WorkspaceDefinitionPayload | null;
  issues: WorkspaceDefinitionIssue[];
}

export interface WorkspaceDefinitionDraftSaveView {
  definitionVersion: number;
  payloadDigest: string;
  projectVersion: number;
  updatedAt: string;
  replayed: boolean;
}

export interface WorkspaceDefinitionPublishView {
  revisionId: string;
  revisionNo: number;
  digest: string;
  definitionVersion: number;
  projectVersion: number;
  publishedAt: string;
  replayed: boolean;
}

export interface RepositoryDeclarationInput {
  expectedProjectVersion: number;
  locator: string;
  targetRepositoryId?: string | null;
  displayName?: string | null;
  confirmation: Confirmation;
}

export interface RepositoryDeclarationView {
  repositoryId: string;
  locatorId: string;
  /** 复用已有仓库时保留服务端已有的真实身份。 */
  identityMode: RepositoryIdentityMode;
  canonicalLocator: string;
  source: RepositoryLocatorSource | string;
  owner: string;
  name: string;
  reused: boolean;
  replayed: boolean;
  alias: boolean;
  projectVersion: number;
}

export interface RepositoryArchiveInput {
  expectedProjectVersion: number;
  confirmation: Confirmation;
}

export interface RepositoryArchiveView {
  repositoryId: string;
  archivedAt: string;
  projectVersion: number;
  replayed: boolean;
}

export interface WorkspaceEnrollmentView {
  enrollmentId: string;
  /** 明文码只在签发响应中出现一次；前端不得缓存、重放或写入持久存储。 */
  code: string;
  projectId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  expiresAt: string;
}

/**
 * 工作区接入 API。所有写请求自动带 `Idempotency-Key`；
 * 接入码签发不需要确认票据（码本身不授权），但必须保留幂等键：
 * 同键重放返回 409 `ENROLLMENT_CODE_NOT_REPLAYABLE`，明文永不重复返回。
 */
export const workspaceApi = {
  /** 活动仓库列表；已归档仓库不返回。 */
  repositories: (projectId: string) =>
    apiRequest<ProjectRepositoryView[]>(`${projectPath(projectId)}/repositories`),
  /** 声明 DECLARED 仓库：只提交 locator，不用 owner/name 伪造 externalId。 */
  declareRepository: (projectId: string, input: RepositoryDeclarationInput) =>
    apiRequest<RepositoryDeclarationView>(`${projectPath(projectId)}/repositories/declarations`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
  archiveRepository: (projectId: string, repositoryId: string, input: RepositoryArchiveInput) =>
    apiRequest<RepositoryArchiveView>(
      `${projectPath(projectId)}/repositories/${enc(repositoryId)}`,
      { method: 'DELETE', body: input, idempotencyKey: 'auto' },
    ),
  definition: (projectId: string) =>
    apiRequest<WorkspaceDefinitionView>(`${projectPath(projectId)}/workspace-definition`),
  /** 草稿保存要求 `payloadDigest` 与服务端规范化结果一致；先 validate 再保存。 */
  saveDraft: (
    projectId: string,
    input: {
      expectedDefinitionVersion: number;
      payloadDigest: string;
      definition: WorkspaceDefinitionPayload;
    },
  ) =>
    apiRequest<WorkspaceDefinitionDraftSaveView>(
      `${projectPath(projectId)}/workspace-definition/draft`,
      { method: 'PUT', body: input, idempotencyKey: 'auto' },
    ),
  /** 内容诊断永远 200 + issues；不产生已发布定义。 */
  validateDefinition: (projectId: string, definition: WorkspaceDefinitionPayload) =>
    apiRequest<WorkspaceDefinitionValidationResult>(
      `${projectPath(projectId)}/workspace-definition/validate`,
      { method: 'POST', body: { definition } },
    ),
  /** 发布已保存的草稿：双版本 CAS + 票据 + 幂等；请求体不带定义内容。 */
  publishDefinition: (
    projectId: string,
    input: {
      expectedProjectVersion: number;
      expectedDefinitionVersion: number;
      payloadDigest: string;
      confirmation: Confirmation;
    },
  ) =>
    apiRequest<WorkspaceDefinitionPublishView>(
      `${projectPath(projectId)}/workspace-definition/publish`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
  issueEnrollment: (projectId: string, ttlSeconds?: number) =>
    apiRequest<WorkspaceEnrollmentView>(`${projectPath(projectId)}/workspace-enrollments`, {
      method: 'POST',
      body: ttlSeconds ? { ttlSeconds } : {},
      idempotencyKey: 'auto',
    }),
};

export interface InvitationRoleView {
  id: string;
  key: string;
  title: string;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationView {
  id: string;
  status: InvitationStatus;
  project: { id: string; key: string; name: string };
  roles: InvitationRoleView[];
  email: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface CreatedInvitationView {
  id: string;
  /** 明文 token 只在创建响应当次返回；丢失后只能重新生成。 */
  token: string | null;
  projectId: string;
  roleIds: string[];
  roleKeys: string[];
  email: string | null;
  expiresAt: string;
  replayed: boolean;
}

export interface AcceptedInvitationView {
  user: { id: string; email: string };
  invitation: { projectId: string; roleKeys: string[] };
}

/**
 * 邀请链接：管理员生成（带角色、限时、一次性），成员点开设置密码即入项目。
 * token 是唯一凭据，前端只拼 URL，不做任何角色或身份推断。
 */
export const invitationApi = {
  resolve: (token: string) =>
    apiRequest<InvitationView>(`/invitations/${encodeURIComponent(token)}`),
  create: (
    projectId: string,
    input: {
      roleKeys: string[];
      email?: string;
      expiresInHours?: number;
      expectedVersion: number;
      confirmation: Confirmation;
    },
  ) =>
    apiRequest<CreatedInvitationView>(`${projectPath(projectId)}/invitations`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
  list: (projectId: string) =>
    apiRequest<Array<Omit<InvitationView, 'project'>>>(`${projectPath(projectId)}/invitations`),
  revoke: (projectId: string, invitationId: string) =>
    apiRequest<{ id: string; revokedAt: string }>(
      `${projectPath(projectId)}/invitations/${enc(invitationId)}/revoke`,
      { method: 'POST', body: {}, idempotencyKey: 'auto' },
    ),
  accept: (token: string, input: { password: string; name?: string; email?: string }) =>
    apiRequest<AcceptedInvitationView>(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: input,
    }),
  join: (token: string) =>
    apiRequest<{ invitationId: string; projectId: string; roleKeys: string[] }>(
      `/invitations/${encodeURIComponent(token)}/join`,
      { method: 'POST', body: {} },
    ),
};

export interface RequirementListQuery {
  cursor?: string;
  limit?: number;
  q?: string;
  phase?: string;
}

export const requirementApi = {
  list: (projectId: string, options: string | RequirementListQuery = {}) => {
    const input = typeof options === 'string' ? { cursor: options } : options;
    const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.q?.trim()) query.set('q', input.q.trim());
    if (input.phase) query.set('phase', input.phase);
    return apiRequest<ListPage<RequirementView> & { total: number }>(
      `${projectPath(projectId)}/requirements?${query}`,
    );
  },
  create: (projectId: string, data: { title: string; description?: string }) =>
    apiRequest<RequirementView>(`${projectPath(projectId)}/requirements`, {
      method: 'POST',
      body: data,
    }),
  /** key 同时接受需求 UUID 与人类编号（YFF-REQ-12）。 */
  detail: (projectId: string, key: string) =>
    apiRequest<RequirementDetail>(
      `${projectPath(projectId)}/requirements/${encodeURIComponent(key)}`,
    ),
  update: (
    projectId: string,
    requirementId: string,
    input: { expectedVersion: number; title?: string; description?: string },
  ) =>
    apiRequest<RequirementView>(`${projectPath(projectId)}/requirements/${enc(requirementId)}`, {
      method: 'PATCH',
      body: input,
      idempotencyKey: 'auto',
    }),
};

/** 工作流定义摘要：不含定义体，只看当前修订号与已发布指针。 */
export interface WorkflowInstanceView {
  id: string;
  projectId: string;
  requirementId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  version: number;
  workStatus: string;
  retiredAt: string | null;
  steps: Array<Record<string, unknown> & { stepKey?: string; stepDisplayName?: string | null }>;
}

export interface WorkflowDefinitionView {
  workflowKey: string;
  title: string;
  version: number;
  currentPublishedRevisionId: string | null;
  currentRevision: number;
}

/** 角色包锁：把某个业务角色固定到一个已登记、不可变的角色包版本上。 */
export interface WorkflowPackageLock {
  roleKey: string;
  packageId: string;
  version: string;
  packageDigest: string;
}

export interface WorkflowIssue {
  path: string;
  code: string;
  message: string;
}

export interface WorkflowCompileResult {
  valid: boolean;
  issues: WorkflowIssue[];
  digest: string | null;
}

export interface RolePackageListItem {
  id: string;
  packageId: string;
  version: string;
  roleKey: string;
  manifestDigest: string;
  scope: 'BUILTIN' | 'PROJECT';
}

export interface WorkflowStepDefinition {
  key: string;
  roleKey: string;
  /** 可选的业务界面显示名称；未设置时按既有步骤映射回退。 */
  displayName?: string;
  deps?: string[];
  /** PRODUCT | DELIVERY | VERIFY | RELEASE */
  kind?: string;
  /** 步骤产出类型，IMPL 步骤必须声明代码仓库范围。 */
  outputKinds?: string[];
}

export interface WorkflowSlotDefinition {
  key: string;
  roleKey: string;
}

export interface WorkflowRevisionView {
  id: string;
  projectId: string;
  workflowKey: string;
  revision: number;
  digest: string;
  definition: Record<string, unknown>;
  compiledRules?: WorkflowCompiledRules;
}

export const workflowApi = {
  listDefinitions: (projectId: string) =>
    apiRequest<ListPage<WorkflowDefinitionView>>(
      `${projectPath(projectId)}/workflow-definitions?limit=50`,
    ),
  /** 只校验不落库；返回的 digest 必须原样进入发布票据的 payload。 */
  validate: (
    projectId: string,
    input: { definition: Record<string, unknown>; packageLocks: WorkflowPackageLock[] },
  ) =>
    apiRequest<WorkflowCompileResult>(`${projectPath(projectId)}/workflow-definitions/validate`, {
      method: 'POST',
      body: input,
    }),
  publish: (
    projectId: string,
    workflowKey: string,
    input: {
      expectedVersion: number;
      expectedCurrentRevision: number;
      definition: Record<string, unknown>;
      packageLocks: WorkflowPackageLock[];
      confirmation: Confirmation;
    },
  ) =>
    apiRequest<{
      definitionRevisionId: string;
      revision: number;
      digest: string;
      projectVersion: number;
      replayed: boolean;
    }>(`${projectPath(projectId)}/workflow-definitions/${enc(workflowKey)}/publish`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
  revision: (revisionId: string) =>
    apiRequest<WorkflowRevisionView>(`/workflow-definition-revisions/${enc(revisionId)}`),
  instance: (instanceId: string) =>
    apiRequest<WorkflowInstanceView>(`/workflow-instances/${enc(instanceId)}`),
  createInstance: (
    requirementId: string,
    input: {
      definitionRevisionId: string;
      expectedRequirementVersion: number;
      stepBindings: Array<{
        stepKey: string;
        roleId: string;
        responsibleUserId: string;
        repositoryIds?: string[];
      }>;
      roleSlotBindings: Array<{ slotKey: string; roleId: string; userId: string }>;
    },
  ) =>
    apiRequest<{ instanceId: string; requirementVersion: number }>(
      `/requirements/${enc(requirementId)}/workflow-instances`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
};

/** 已登记的角色包版本（含内置）；发布工作流时为每个被引用角色挑选一个版本作锁。 */
export const rolePackageApi = {
  list: (projectId: string) =>
    apiRequest<ListPage<RolePackageListItem>>(`${projectPath(projectId)}/role-packages?limit=100`),
};

export const documentApi = {
  list: (projectId: string, kind?: DocumentKind, cursor?: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (kind) query.set('kind', kind);
    if (cursor) query.set('cursor', cursor);
    return apiRequest<ListPage<DocumentDetail>>(`${projectPath(projectId)}/documents?${query}`);
  },
  get: (documentId: string) => apiRequest<DocumentDetail>(`/documents/${enc(documentId)}`),
  /** 按评审绑定的精确修订读取元数据，不加载所属文档的全部历史或正文。 */
  revisionMetadata: (documentId: string, revisionId: string) =>
    apiRequest<RevisionView>(`/documents/${enc(documentId)}/revisions/${enc(revisionId)}/metadata`),
  content: (revisionId: string) =>
    apiRequest<{
      revisionId: string;
      mimeType: string;
      encoding: 'base64';
      bodyBase64: string;
      byteLength: number;
      sha256: string;
    }>(`/document-revisions/${enc(revisionId)}/content`),
  /** 撤销发布必须提交 expectedVersion + 一次性票据；不携带 DTO 未声明的字段。 */
  withdraw: (
    documentId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest<{ documentVersion: number; publicationId: string | null }>(
      `/documents/${enc(documentId)}/withdraw`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
};

export const reviewApi = {
  /** 评审请求由候选修订创建时生成；Web 只按 ID 读取，不自行创建。 */
  get: (reviewId: string) => apiRequest<ReviewView>(`/review-requests/${enc(reviewId)}`),
  /** 项目评审收件箱：默认只返回当前用户被指派且仍开放的评审请求。 */
  list: (
    projectId: string,
    input: { assignedToMe?: boolean; status?: string; cursor?: string } = {},
  ) => {
    const query = new URLSearchParams({
      assignedToMe: String(input.assignedToMe ?? true),
      status: input.status ?? 'OPEN',
      limit: '50',
    });
    if (input.cursor) query.set('cursor', input.cursor);
    return apiRequest<ListPage<ReviewView>>(`${projectPath(projectId)}/review-requests?${query}`);
  },
  decide: (
    reviewId: string,
    input: {
      slotId: string;
      decision: 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';
      expectedVersion: number;
      comment?: string;
      confirmation: Confirmation;
    },
  ) =>
    apiRequest<{
      review: ReviewView;
      decisionId: string;
      published: boolean;
      publicationId: string | null;
      documentVersion: number | null;
      replayed: boolean;
    }>(`/review-requests/${enc(reviewId)}/decisions`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
  batchDecide: (
    decision: 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT',
    items: Array<{
      reviewId: string;
      slotId: string;
      expectedVersion: number;
      comment?: string;
      confirmation: Confirmation;
    }>,
  ) =>
    apiRequest<{
      results: Array<{ reviewId: string; status: string; decisionId?: string; message?: string }>;
    }>('/review-requests/batch-decisions', {
      method: 'POST',
      body: { decision, items },
      idempotencyKey: 'auto',
    }),
  revoke: (
    decisionId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest(`/review-decisions/${enc(decisionId)}/revoke`, {
      method: 'POST',
      body: input,
      idempotencyKey: 'auto',
    }),
};

/** 槽位临时委托：原 requiredUserId 不变，到期/撤销即失效；写操作仅 OWNER/ADMIN。 */
export interface ApprovalSlotDelegationView {
  id: string;
  projectId: string;
  slotId: string;
  delegatorUserId: string;
  delegateUserId: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

/** 到期且未决定的审批槽：只读视图，升级只标记 escalatedAt，不自动批准。 */
export interface OverdueApprovalSlotView {
  id: string;
  slotKey: string;
  kind: string;
  reviewRequestId: string;
  requiredUserId: string;
  requiredRoleId: string | null;
  dueAt: string;
}

export const delegationApi = {
  list: (projectId: string) =>
    apiRequest<ApprovalSlotDelegationView[]>(`${projectPath(projectId)}/delegations`),
  create: (
    projectId: string,
    input: { slotId: string; delegateUserId: string; expiresAt: string },
  ) =>
    apiRequest<ApprovalSlotDelegationView>(`${projectPath(projectId)}/delegations`, {
      method: 'POST',
      body: input,
    }),
  revoke: (projectId: string, delegationId: string) =>
    apiRequest<{ revoked: boolean }>(`${projectPath(projectId)}/delegations/${enc(delegationId)}`, {
      method: 'DELETE',
    }),
  overdue: (projectId: string) =>
    apiRequest<OverdueApprovalSlotView[]>(`${projectPath(projectId)}/approvals/overdue`),
  escalate: (projectId: string) =>
    apiRequest<{ escalated: number }>(`${projectPath(projectId)}/approvals/escalate`, {
      method: 'POST',
    }),
};

function boardQueryString(input: BoardQuery & { search?: string } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  return query.size ? `?${query}` : '';
}

export const boardApi = {
  get: (projectId: string, query: BoardQuery = {}) =>
    apiRequest<BoardSnapshot>(`${projectPath(projectId)}/board${boardQueryString(query)}`),
  column: (projectId: string, column: BoardColumnKey, query: BoardQuery = {}) =>
    apiRequest<BoardColumnPage>(
      `${projectPath(projectId)}/board/columns/${enc(column)}${boardQueryString(query)}`,
    ),
  requirements: (projectId: string, query: BoardQuery = {}) =>
    apiRequest<BoardRequirementPage>(
      `${projectPath(projectId)}/board/requirements${boardQueryString(query)}`,
    ),
  filters: (
    projectId: string,
    kind: 'roles' | 'requirements',
    query: BoardQuery & { search?: string } = {},
  ) =>
    apiRequest<BoardFilterPage>(
      `${projectPath(projectId)}/board/filters/${kind}${boardQueryString(query)}`,
    ),
};

export const taskApi = {
  get: (taskId: string) => apiRequest<TaskView>(`/tasks/${enc(taskId)}`),
  inputs: (taskId: string) => apiRequest<TaskInputStatus>(`/tasks/${enc(taskId)}/input-status`),
};

export type TaskInputStatus = import('@workmesh/shared').TaskInputStatusView;

export interface ArtifactView {
  id: string;
  kind: string;
  schemaVersion: string;
  storage: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  projectRepositoryId: string | null;
  commitSha: string | null;
  repoPath: string | null;
  summary: string | null;
  contentPreview?: { text: string; truncated: boolean } | null;
  checks: Array<{
    code: string;
    passed: boolean;
    message?: string;
    source?: 'AGENT_REPORTED' | 'EXTERNAL_REFERENCE';
    evidence?: {
      kind: 'CI_RUN' | 'TEST_REPORT';
      provider: string;
      url: string;
      runId?: string;
      commitSha?: string;
    };
  }>;
}

export interface CodeReviewEvidenceView {
  id: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  authorExternalId: string;
  reviewerExternalId: string;
  reviewerKind: string;
  state: string;
  commitSha: string | null;
  submittedAt: string | null;
}

export interface ArtifactSetCodeReviewView {
  required: boolean;
  acceptable: boolean;
  evidence: CodeReviewEvidenceView[];
  diagnostics?: CodeEvidenceDiagnostics;
}

export interface ArtifactSetView {
  id: string;
  taskId: string;
  taskGeneration: number;
  snapshotId: string;
  manifestDigest: string;
  workflowDefinitionRevisionId: string;
  localRunId: string;
  candidateRevisionIds: string[];
  artifacts: ArtifactView[];
  codeReview?: ArtifactSetCodeReviewView;
  createdAt: string;
}

export interface ArtifactContentView {
  artifactId: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  storage: string;
  text: string | null;
  bodyBase64: string;
}

export const artifactApi = {
  get: (artifactId: string) => apiRequest<ArtifactSetView>(`/artifact-sets/${enc(artifactId)}`),
  content: (artifactId: string, evidenceId: string) =>
    apiRequest<ArtifactContentView>(
      `/artifact-sets/${enc(artifactId)}/artifacts/${enc(evidenceId)}/content`,
    ),
};

export const changeApi = {
  listRecipients: (projectId: string, ackedOnly = false) =>
    apiRequest<ListPage<ChangeRecipient>>(
      `/change-recipients?projectId=${enc(projectId)}&limit=100&ackedOnly=${ackedOnly ? 'true' : 'false'}`,
    ),
  ack: (recipientId: string, expectedVersion: number) =>
    apiRequest(`/change-recipients/${enc(recipientId)}/ack`, {
      method: 'POST',
      body: { expectedVersion },
      idempotencyKey: 'auto',
    }),
};

export interface WorkbenchRequirement {
  code: string;
  title: string;
}

export interface WorkbenchRole {
  id: string;
  key: string;
  title: string;
}

export interface WorkbenchReviewItem {
  blocking?: number | null;
  dependencyImpact?: import('@workmesh/shared').DependencyImpact;
  reviewId: string;
  kind: string;
  status: string;
  version: number;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  subjectLabel: string;
  stepDisplayName?: string | null;
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
}

export interface WorkbenchChangeItem {
  blocking?: number | null;
  dependencyImpact?: import('@workmesh/shared').DependencyImpact;
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
  guidance?: import('@workmesh/shared').ChangeGuidance;
}

export interface WorkbenchReadyTaskItem {
  blocking?: number | null;
  dependencyImpact?: import('@workmesh/shared').DependencyImpact;
  taskId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  role: { key: string; title: string } | null;
  stepKey: string;
  stepDisplayName?: string | null;
  executionStatus: string;
  workStatus: string;
  ageSeconds: number | null;
  responsibleUser: { id: string; email: string } | null;
  claimEligibility: TaskClaimEligibility;
}

/** 逾期审批（到期未决定）：工作台置顶展示，跨项目按 dueAt 升序。 */
export interface WorkbenchOverdueApprovalItem {
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
}

export interface WorkbenchSnapshot {
  counts: {
    reviews: number;
    changes: number;
    readyTasks: number;
    total: number;
    overdueApprovals?: number;
  };
  reviews: WorkbenchReviewItem[];
  changes: WorkbenchChangeItem[];
  readyTasks: WorkbenchReadyTaskItem[];
  /** 旧服务端响应可能没有该字段；前端按空数组处理。 */
  overdueApprovals?: WorkbenchOverdueApprovalItem[];
  warnings: string[];
}

export interface ActivityItem {
  id: string;
  projectId: string | null;
  projectName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetVersion: number | null;
  outcome: string;
  details: unknown;
  createdAt: string;
  actor: { id: string; email: string } | null;
}

export const activityApi = {
  list: (limit = 30) => apiRequest<{ items: ActivityItem[] }>(`/activity?limit=${limit}`),
};

export const notificationApi = {
  sendEmailDigest: () =>
    apiRequest<{
      sent: boolean;
      to: string;
      counts: { reviews: number; changes: number; readyTasks: number; total: number };
    }>('/notifications/email-digest', { method: 'POST' }),
};

export const workbenchApi = {
  get: (projectId?: string | null) =>
    apiRequest<WorkbenchSnapshot>(`/workbench${projectId ? `?projectId=${enc(projectId)}` : ''}`),
};

export const aclApi = {
  getAccess: (knowledgeBaseId: string) =>
    apiRequest<AccessView>(`/knowledge-bases/${enc(knowledgeBaseId)}/access`),
  replaceAccess: (
    knowledgeBaseId: string,
    input: {
      expectedVersion: number;
      expectedAuthzVersion: number;
      visibility: 'PROJECT' | 'RESTRICTED';
      publicationApproverUserId: string;
      publicationApproverRoleId?: string | null;
      grants: Array<{
        subjectKind: 'USER' | 'ROLE';
        subjectUserId: string | null;
        subjectRoleId: string | null;
        permissions: string[];
      }>;
      reason: string;
      confirmation: Confirmation;
    },
  ) =>
    apiRequest<AccessView>(`/knowledge-bases/${enc(knowledgeBaseId)}/access`, {
      method: 'PUT',
      body: input,
      idempotencyKey: 'auto',
    }),
};
