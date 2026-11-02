import type { RoleSlot } from '@workmesh/shared';

export type V1ReviewStatus = 'OPEN' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED' | 'INVALIDATED';
export type V1ReviewKind =
  | 'UNDERSTANDING_CONFIRM'
  | 'PRD_PUBLICATION'
  | 'KNOWLEDGE_PUBLICATION'
  | 'TASK_ACCEPTANCE'
  | 'RELEASE_ACCEPTANCE';
export type V1DecisionValue = 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

export type V1ReviewSlotRecord = {
  id: string;
  slotKey: string;
  kind: string;
  requiredRoleId: string | null;
  requiredUserId: string;
  sourceSlotBindingId: string | null;
};

export type V1ReviewDecisionRecord = {
  id: string;
  approvalSlotId: string;
  decision: V1DecisionValue;
  subjectDigest: string;
  comment: string | null;
  createdById: string;
  createdAt: Date;
};

export type V1ReviewSubject = {
  documentId: string;
  knowledgeBaseId: string;
  documentVersion: number;
  currentPublishedRevisionId: string | null;
  revisionId: string;
  revisionDigest: string;
};

export type V1ReviewSnapshot = {
  id: string;
  projectId: string;
  kind: V1ReviewKind;
  status: V1ReviewStatus;
  version: number;
  subjectDigest: string;
  documentRevisionId: string | null;
  artifactSetId: string | null;
  taskId: string | null;
  slots: V1ReviewSlotRecord[];
  decisions: V1ReviewDecisionRecord[];
  subject: V1ReviewSubject | null;
};

export type V1CommitDecisionInput = {
  reviewId: string;
  expectedVersion: number;
  slotId: string;
  decision: V1DecisionValue;
  subjectDigest: string;
  comment: string | null;
  actorUserId: string;
  roleSlot: RoleSlot;
  operationId: string;
  ticket: { id: string; secretHash: string; webSessionId: string };
  principalScopeKey: string;
  projectScopeKey: string;
  operationKey: string;
  method: string;
  route: string;
  requestDigest: string;
  now: Date;
};

export type V1TaskState = {
  id: string;
  version: number;
  generation: number;
  executionStatus: string;
};

export type V1RequirementState = {
  id: string;
  version: number;
  phase: string;
};

/** 一次决定的客观效应；响应只暴露语义结果，不暴露内部事务细节。 */
export type V1SubjectResult =
  | { kind: 'PUBLISHED'; publicationId: string; documentVersion: number }
  | { kind: 'ACCEPTED'; taskId: string; taskVersion: number; requirement: V1RequirementState | null }
  | { kind: 'REWORK'; affectedTaskIds: string[] }
  | { kind: 'REJECTED'; affectedTaskIds: string[] }
  | { kind: 'RECORDED'; approvedSlotIds: string[]; remainingSlotIds: string[] };

export type V1CommitDecisionResult = {
  decisionId: string;
  review: V1ReviewSnapshot;
  published: boolean;
  publicationId: string | null;
  documentVersion: number | null;
  approvedSlotIds: string[];
  subjectResult: V1SubjectResult;
  task: V1TaskState | null;
  requirement: V1RequirementState | null;
};

export type V1DecisionContext = {
  decisionId: string;
  projectId: string;
  reviewId: string;
  reviewKind: V1ReviewKind;
  reviewStatus: V1ReviewStatus;
  reviewVersion: number;
  subjectDigest: string;
  documentRevisionId: string | null;
  artifactSetId: string | null;
  taskId: string | null;
  decision: V1DecisionValue;
  createdById: string;
  revoked: boolean;
  knowledgeBaseId: string | null;
  slot: V1ReviewSlotRecord;
};

export type V1RevokeInput = {
  decisionId: string;
  /** 父 ReviewRequest.version；决定自身没有可变版本。 */
  expectedVersion: number;
  reason: string;
  actorUserId: string;
  roleSlot: RoleSlot;
  operationId: string;
  ticket: { id: string; secretHash: string; webSessionId: string };
  principalScopeKey: string;
  projectScopeKey: string;
  operationKey: string;
  method: string;
  route: string;
  requestDigest: string;
  now: Date;
};

export type V1RevocationSnapshot = {
  id: string;
  decisionId: string;
  reason: string;
  createdAt: Date;
};

export type V1RevokeResult = {
  revocation: V1RevocationSnapshot;
  affectedTaskIds: string[];
};

export type V1ReviewSubjectKind = 'DOCUMENT_REVISION' | 'TASK_ARTIFACT_SET';

/** 请求评审时客户端只能声明 subject 与版本，kind、槽位、摘要一律服务端派生。 */
export type V1ReviewSubjectRef = {
  kind: V1ReviewSubjectKind;
  id: string;
};

export type V1DocumentReviewSubject = {
  revisionId: string;
  projectId: string;
  knowledgeBaseId: string;
  documentId: string;
  documentKind: 'UNDERSTANDING' | 'PRD' | 'KNOWLEDGE' | 'DECISION';
  documentVersion: number;
  revisionDigest: string;
  archived: boolean;
};

export type V1ArtifactReviewSubject = {
  artifactSetId: string;
  projectId: string;
  taskId: string;
  taskVersion: number;
  taskGeneration: number;
  taskRoleId: string;
  responsibleUserId: string;
  manifestDigest: string;
};

export type V1CreateReviewRequestInput = {
  projectId: string;
  subject: V1ReviewSubjectRef;
  expectedVersion: number;
  taskId: string | null;
  actor: {
    kind: 'HUMAN' | 'AGENT';
    userId: string;
    webSessionId: string | null;
    agentCredentialId: string | null;
    roleId: string | null;
    scopeSnapshot: readonly string[];
    userAuthVersion: number;
  };
  operation: {
    id: string;
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
    method: string;
    route: string;
    requestDigest: string;
    now: Date;
  };
};

export type V1CreateReviewRequestResult = {
  review: V1ReviewSnapshot;
  /** false 表示同一 subject 已有 OPEN 评审，本次只返回既有请求。 */
  created: boolean;
};

export type V1ReviewListQuery = {
  projectId: string;
  userId: string;
  principalKind: 'HUMAN' | 'AGENT';
  /** AGENT 的凭据唯一角色；只返回该角色关联或直接指派给其 userId 的请求。 */
  agentRoleId: string | null;
  /** 当前项目活动业务角色，用于 assignedToMe 与 ROLE grant 命中。 */
  activeRoleIds: readonly string[];
  /** AGENT 缺少 knowledge:read 时看不到任何文档主体请求。 */
  knowledgeReadAllowed: boolean;
  assignedToMe: boolean;
  status: V1ReviewStatus | null;
  limit: number;
  cursor: string | null;
};

export type V1ReviewListResult = {
  items: V1ReviewSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
};

export interface V1ReviewRepository {
  findReview(reviewId: string): Promise<V1ReviewSnapshot | null>;
  /** 撤销资格与绑定所需的决定上下文；不存在返回 null。 */
  findDecisionContext(decisionId: string): Promise<V1DecisionContext | null>;
  /** 文档修订主体：用于创建前授权与版本前置检查。 */
  findDocumentReviewSubject(revisionId: string): Promise<V1DocumentReviewSubject | null>;
  /** 工件集主体：用于创建前责任范围与版本前置检查。 */
  findArtifactReviewSubject(artifactSetId: string): Promise<V1ArtifactReviewSubject | null>;
  /**
   * 单个 Serializable 事务内完成：锁项目行 → 事务内重读主体与版本 → 派生 kind/槽位/摘要 →
   * （同 subject 已有 OPEN 则返回既有）创建 review、槽位、审计与幂等操作 → 一次 commit。
   */
  createReviewRequest(input: V1CreateReviewRequestInput): Promise<V1CreateReviewRequestResult>;
  /** 按当前可见范围列出评审请求；(createdAt desc, id desc) keyset 分页。 */
  listReviews(query: V1ReviewListQuery): Promise<V1ReviewListResult>;
  /**
   * 单个 Serializable 事务内完成：重读 review/决定/版本 → 追加撤销 → 失效当前发布指针与
   * 需求指针 → 受影响任务失效并释放 claim → 审计与幂等操作 → 一次 commit。
   */
  revokeDecision(input: V1RevokeInput): Promise<V1RevokeResult>;
  /**
   * 单个 Serializable 事务内完成：重读 review/版本/槽位/决定 → 写决定 →（ALL APPROVE 时）
   * CAS 发布 + DocumentPublication + review APPROVED + 审计 + 幂等操作 → 一次 commit。
   * 任一步失败全部回滚；票据消费与决定不能分开提交。
   */
  commitDecision(input: V1CommitDecisionInput): Promise<V1CommitDecisionResult>;
}

export const V1_REVIEW_REPOSITORY = Symbol('V1_REVIEW_REPOSITORY');
