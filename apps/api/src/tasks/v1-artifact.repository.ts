import type { V1TaskSnapshot } from './v1-task.repository';

export const V1_ARTIFACT_REPOSITORY = Symbol('V1_ARTIFACT_REPOSITORY');

export type V1ArtifactKind = 'PRD' | 'DESIGN' | 'IMPL' | 'CASES' | 'RELEASE';
export type V1ArtifactStorage = 'HOSTED' | 'GIT_REF';

export type V1ArtifactCheckSource = 'AGENT_REPORTED' | 'EXTERNAL_REFERENCE';

export type V1ArtifactCheckEvidence = {
  kind: 'CI_RUN' | 'TEST_REPORT';
  provider: string;
  url: string;
  runId?: string;
  commitSha?: string;
};

export type V1ArtifactCheck = {
  code: string;
  passed: boolean;
  message?: string;
  source?: V1ArtifactCheckSource;
  /** An externally reviewable reference; WorkMesh does not verify it. */
  evidence?: V1ArtifactCheckEvidence;
};

export type V1ArtifactContentPreview = {
  text: string;
  truncated: boolean;
};

export type V1CodeReviewEvidenceSnapshot = {
  id: string;
  repositoryId: string;
  repositoryOwner: string | null;
  repositoryName: string | null;
  adapter: string | null;
  changeRequestId: string;
  headSha: string;
  commitSha: string | null;
  authorExternalId: string;
  reviewerExternalId: string;
  reviewerKind: string;
  state: string;
  submittedAt: string | null;
};

export type V1CodeReviewSummary = {
  required: boolean;
  acceptable: boolean;
  evidence: V1CodeReviewEvidenceSnapshot[];
};

/** Only expose a small, UTF-8 text preview; GIT_REF has no hosted bytes. */
export function contentPreviewOf(
  storage: string,
  mediaType: string,
  bodyBytes: Buffer | null | undefined,
): V1ArtifactContentPreview | null {
  const maxBytes = 4096;
  if (storage !== 'HOSTED' || !mediaType.toLowerCase().startsWith('text/') || !bodyBytes)
    return null;
  const truncated = bodyBytes.byteLength > maxBytes;
  const bytes = truncated ? bodyBytes.subarray(0, maxBytes) : bodyBytes;
  let text = bytes.toString('utf8');
  if (truncated && text.endsWith('\ufffd')) text = text.slice(0, -1);
  return { text, truncated };
}

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
  contentPreview?: V1ArtifactContentPreview | null;
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
  /** Populated for read-only artifact-set detail; omitted by deliver responses. */
  codeReview?: V1CodeReviewSummary;
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
  /** Read-only external code-review evidence for an artifact set. */
  findCodeReviewEvidence?(
    projectId: string,
    artifactSetId: string,
  ): Promise<V1CodeReviewEvidenceSnapshot[]>;
}
