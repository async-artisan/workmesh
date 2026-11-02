import { apiRequest } from './client';

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
}

export interface BoardCard {
  taskId: string;
  projectId: string;
  stepKey: string;
  roleId: string;
  executionStatus: string;
  workStatus: string | null;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  claimedUserId: string | null;
  claimedAt: string | null;
  generation: number;
}

export interface BoardSnapshot {
  projectId: string;
  columns: Array<{ key: string; cards: BoardCard[] }>;
}

export interface TaskView {
  id: string;
  projectId: string;
  workflowInstanceId: string;
  stepKey: string;
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
  role: { key: string; title: string };
  responsibleUser: { id: string; email: string };
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaimId: string | null;
  currentArtifactSetId: string | null;
  instanceId: string;
  artifactCount: number;
  review: { id: string; kind: string; status: string } | null;
}

export interface RequirementArtifactDetail {
  id: string;
  taskId: string;
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
  tasks: RequirementTaskDetail[];
  artifacts: RequirementArtifactDetail[];
  reviews: RequirementReviewDetail[];
  changes: RequirementChangeDetail[];
  counts: { tasks: number; artifacts: number; reviews: number; changes: number };
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

export const requirementApi = {
  list: (projectId: string, cursor?: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    return apiRequest<ListPage<RequirementView>>(`${projectPath(projectId)}/requirements?${query}`);
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
  steps: Array<Record<string, unknown>>;
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
  deps?: string[];
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

export const boardApi = {
  get: (projectId: string) => apiRequest<BoardSnapshot>(`${projectPath(projectId)}/board`),
};

export const taskApi = {
  get: (taskId: string) => apiRequest<TaskView>(`/tasks/${enc(taskId)}`),
};

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
  checks: Array<{ code: string; passed: boolean; message?: string }>;
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
  createdAt: string;
}

export const artifactApi = {
  get: (artifactId: string) => apiRequest<ArtifactSetView>(`/artifact-sets/${enc(artifactId)}`),
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
  reviewId: string;
  kind: string;
  status: string;
  version: number;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  subjectLabel: string;
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
}

export interface WorkbenchReadyTaskItem {
  taskId: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  requirement: WorkbenchRequirement | null;
  role: { key: string; title: string } | null;
  stepKey: string;
  executionStatus: string;
  workStatus: string;
  ageSeconds: number | null;
}

export interface WorkbenchSnapshot {
  counts: { reviews: number; changes: number; readyTasks: number; total: number };
  reviews: WorkbenchReviewItem[];
  changes: WorkbenchChangeItem[];
  readyTasks: WorkbenchReadyTaskItem[];
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
