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
}

export interface ReviewDecision {
  id: string;
  approvalSlotId: string;
  decision: 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';
  subjectDigest: string;
  comment: string | null;
  createdById: string;
  createdAt: string;
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

/** 候选修订/恢复的响应：附带服务端生成的评审请求 ID 与派生槽位。 */
export interface ProposeRevisionResult {
  revision: RevisionView;
  reviewRequestId: string;
  reviewKind: string;
  slots: Array<{
    id: string;
    slotKey: string;
    requiredUserId: string;
    requiredRoleId: string | null;
  }>;
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
    apiRequest<MemberView>(`${projectPath(projectId)}/members`, { method: 'POST', body: { email } }),
  roles: (projectId: string) => apiRequest<RoleView[]>(`${projectPath(projectId)}/roles`),
  assignRole: (
    projectId: string,
    userId: string,
    roleId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest(
      `${projectPath(projectId)}/members/${enc(userId)}/roles/${enc(roleId)}`,
      { method: 'PUT', body: input, idempotencyKey: 'auto' },
    ),
  revokeRole: (
    projectId: string,
    userId: string,
    roleId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest(
      `${projectPath(projectId)}/members/${enc(userId)}/roles/${enc(roleId)}/revoke`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
};

export const requirementApi = {
  list: (projectId: string, cursor?: string) => {
    const query = new URLSearchParams({ limit: '50' });
    if (cursor) query.set('cursor', cursor);
    return apiRequest<ListPage<RequirementView>>(`${projectPath(projectId)}/requirements?${query}`);
  },
  create: (projectId: string, data: { title: string; description?: string }) =>
    apiRequest<RequirementView>(`${projectPath(projectId)}/requirements`, { method: 'POST', body: data }),
};

export const workflowApi = {
  revision: (revisionId: string) =>
    apiRequest<{
      id: string;
      projectId: string;
      workflowKey: string;
      revision: number;
      digest: string;
      definition: Record<string, unknown>;
    }>(`/workflow-definition-revisions/${enc(revisionId)}`),
  createInstance: (
    requirementId: string,
    input: {
      definitionRevisionId: string;
      expectedRequirementVersion: number;
      stepBindings: Array<{ stepKey: string; roleId: string; responsibleUserId: string; repositoryIds?: string[] }>;
      roleSlotBindings: Array<{ slotKey: string; roleId: string; userId: string }>;
    },
  ) =>
    apiRequest<{ instanceId: string; requirementVersion: number }>(
      `/requirements/${enc(requirementId)}/workflow-instances`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
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
  /**
   * 追加候选修订。服务端同时创建对应评审请求，返回 reviewRequestId，
   * Web 只能凭它进入评审页，不能自行构造槽位或直接发布。
   */
  proposeRevision: (
    documentId: string,
    data: {
      title: string;
      mimeType?: string;
      bodyBase64: string;
      basisUnderstandingRevisionId?: string | null;
      deliveryScope?: Record<string, unknown>;
      acceptance?: Array<{ key: string; text: string; verification: string }>;
    },
  ) =>
    apiRequest<ProposeRevisionResult>(`/documents/${enc(documentId)}/revisions`, {
      method: 'POST',
      body: { mimeType: 'text/markdown; charset=utf-8', ...data },
    }),
  /** 恢复旧修订同样生成候选评审，不触碰发布指针。 */
  restore: (documentId: string, input: { sourceRevisionId: string; title?: string }) =>
    apiRequest<ProposeRevisionResult>(`/documents/${enc(documentId)}/restore`, {
      method: 'POST',
      body: input,
    }),
  /** 撤销发布必须提交 expectedVersion + 一次性票据；不携带 DTO 未声明的字段。 */
  withdraw: (
    documentId: string,
    input: { expectedVersion: number; reason: string; confirmation: Confirmation },
  ) =>
    apiRequest<{ documentVersion: number; publicationId: string | null }>(
      `/documents/${enc(documentId)}/withdraw`,
      { method: 'POST', body: input, idempotencyKey: 'auto' },
    ),
  create: (
    projectId: string,
    data: {
      knowledgeBaseId: string;
      kind: DocumentKind;
      requirementId?: string | null;
      title: string;
      bodyBase64: string;
    },
  ) =>
    apiRequest<{ document: DocumentView } & ProposeRevisionResult>(
      `${projectPath(projectId)}/documents`,
      {
        method: 'POST',
        body: { mimeType: 'text/markdown; charset=utf-8', ...data },
        idempotencyKey: 'auto',
      },
    ),
};

export const reviewApi = {
  /** 评审请求由候选修订创建时生成；Web 只按 ID 读取，不自行创建。 */
  get: (reviewId: string) => apiRequest<ReviewView>(`/review-requests/${enc(reviewId)}`),
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
  /** v1 ClaimDto 为空：服务端按任务当前代次串行，不接受客户端版本声明。 */
  claim: (taskId: string) =>
    apiRequest<TaskView>(`/tasks/${enc(taskId)}/claims`, {
      method: 'POST',
      body: {},
      idempotencyKey: 'auto',
    }),
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
