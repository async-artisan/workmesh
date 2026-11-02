import type { V1TaskSnapshot } from './v1-task.repository';

export const V1_ARTIFACT_REPOSITORY = Symbol('V1_ARTIFACT_REPOSITORY');

export type V1ArtifactKind = 'PRD' | 'DESIGN' | 'IMPL' | 'CASES' | 'RELEASE';
export type V1ArtifactStorage = 'HOSTED' | 'GIT_REF';

export type V1ArtifactCheck = { code: string; passed: boolean; message?: string };

/** 客户端声明项；HOSTED 的摘要与长度由服务端按原始字节重算，不采用声明值。 */
export type V1DeliverItem = {
  kind: V1ArtifactKind;
  schemaVersion: string;
  storage: V1ArtifactStorage;
  mediaType: string;
  /** HOSTED 必填；GIT_REF 禁止携带。 */
  bodyBytes: Buffer | null;
  /** 服务端重算后的摘要（HOSTED）或客户端声明的提交摘要（GIT_REF，待外部核验）。 */
  sha256: string;
  byteLength: number;
  projectRepositoryId: string | null;
  commitSha: string | null;
  repoPath: string | null;
  summary: string | null;
  checks: V1ArtifactCheck[];
};

export type V1ArtifactSnapshot = {
  id: string;
  kind: V1ArtifactKind;
  schemaVersion: string;
  storage: V1ArtifactStorage;
  mediaType: string;
  byteLength: number;
  sha256: string;
  projectRepositoryId: string | null;
  commitSha: string | null;
  repoPath: string | null;
  summary: string | null;
  checks: V1ArtifactCheck[];
};

export type V1ArtifactSetSnapshot = {
  id: string;
  taskId: string;
  taskGeneration: number;
  snapshotId: string;
  manifestDigest: string;
  workflowDefinitionRevisionId: string;
  localRunId: string;
  candidateRevisionIds: string[];
  artifacts: V1ArtifactSnapshot[];
  createdAt: Date;
};

export type V1DeliverOperation = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
};

export type V1DeliverInput = {
  taskId: string;
  expectedVersion: number;
  claimId: string;
  snapshotId: string;
  workflowDefinitionRevisionId: string;
  principalScopeKey: string;
  localRunId: string;
  candidateRevisionIds: string[];
  items: V1DeliverItem[];
  /** 交付内容摘要，绑定 ArtifactSet 与 TASK_ACCEPTANCE 评审。 */
  subjectDigest: string;
  actorUserId: string;
  actorStamp: {
    kind: 'HUMAN' | 'AGENT';
    webSessionId: string | null;
    agentCredentialId: string | null;
    roleId: string | null;
    roleKeySnapshot: string | null;
    scopeSnapshot: string[];
    userAuthVersion: number;
  };
  now: Date;
  operation: V1DeliverOperation;
};

export type V1DeliverResultRow = {
  artifactSet: V1ArtifactSetSnapshot;
  task: V1TaskSnapshot;
  reviewRequestId: string;
};

export interface V1ArtifactRepository {
  deliver(input: V1DeliverInput): Promise<V1DeliverResultRow>;
  findArtifactSet(id: string): Promise<V1ArtifactSetSnapshot | null>;
}
