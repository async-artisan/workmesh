import type {
  V1SnapshotAuthority,
  V1SnapshotManifest,
  V1SnapshotManifestResource,
  V1SnapshotRefKind,
} from './v1-snapshot-policy';

export const V1_SNAPSHOT_REPOSITORY = Symbol('V1_SNAPSHOT_REPOSITORY');

export type V1SnapshotClaim = {
  id: string;
  taskGeneration: number;
  principalScopeKey: string;
  releasedAt: Date | null;
  userId: string;
  credentialId: string | null;
};

export type V1SnapshotTaskState = {
  id: string;
  projectId: string;
  requirementId: string;
  requirementGeneration: number;
  requirementVersion: number;
  requirementPhase: string;
  currentUnderstandingRevisionId: string | null;
  currentPrdRevisionId: string | null;
  deliveryScope: unknown;
  knowledgeBindingsVersion: number;
  taskVersion: number;
  taskGeneration: number;
  stepKey: string;
  roleId: string;
  roleKey: string;
  responsibleUserId: string;
  baselinePolicy: 'NONE' | 'PUBLISHED_PRD';
  workflowDefinitionRevisionId: string;
  workflowDigest: string;
  retiredAt: Date | null;
  currentClaim: V1SnapshotClaim | null;
  currentSnapshotId: string | null;
  /** 当前步骤声明的上游产物输入；旧修订缺省为空。 */
  upstreamInputs?: Array<{
    inputKey: string;
    fromStepKey: string;
    kind: string;
    required?: boolean;
  }>;
  /** 当前步骤声明的已发布知识输入；旧修订缺省为空。 */
  knowledgeInputs?: Array<{ inputKey: string; documentId: string; required?: boolean }>;
};

export type V1SnapshotDocumentRef = {
  revisionId: string;
  documentId: string;
  knowledgeBaseId: string;
  documentKind: 'UNDERSTANDING' | 'DECISION' | 'PRD' | 'KNOWLEDGE';
  sha256: string;
  byteLength: number;
  mediaType: string;
  isCurrentPublished: boolean;
  requirementId: string | null;
};

export type V1SnapshotBindingRecord = {
  bindingId: string;
  documentId: string;
  knowledgeBaseId: string;
  roleId: string | null;
  required: boolean;
  currentPublishedRevisionId: string | null;
};

export type V1SnapshotPrerequisiteArtifact = {
  artifactId: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  /** 编译输入绑定对应的上游步骤与工件类型；旧仓库实现可省略。 */
  sourceStepKey?: string;
  kind?: string;
};

export type V1SnapshotRoleResource = {
  rolePackageResourceId: string;
  refKey: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
};

export type V1SnapshotView = {
  id: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  taskGeneration: number;
  requirementGeneration: number;
  manifest: V1SnapshotManifest;
  manifestDigest: string;
  createdAt: Date;
  resources: V1SnapshotManifestResource[];
};

export type V1SnapshotResourceBody = {
  refId: string;
  kind: V1SnapshotRefKind;
  targetId: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  authority: V1SnapshotAuthority;
  bodyBytes: Uint8Array;
};

export type V1CreateSnapshotInput = {
  snapshotId: string;
  projectId: string;
  requirementId: string;
  taskId: string;
  taskGeneration: number;
  requirementGeneration: number;
  workflowDefinitionRevisionId: string;
  claimId: string;
  manifest: V1SnapshotManifest;
  manifestDigest: string;
  resources: Array<
    V1SnapshotManifestResource & {
      documentRevisionId?: string | null;
      artifactId?: string | null;
      rolePackageResourceId?: string | null;
    }
  >;
  expectedTaskVersion: number;
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
  operation: {
    id: string;
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
    method: string;
    route: string;
    requestDigest: string;
  };
};

export type V1CreateSnapshotResult = {
  snapshot: V1SnapshotView;
  taskVersion: number;
};

export interface V1SnapshotRepository {
  findTaskState(taskId: string): Promise<V1SnapshotTaskState | null>;
  findRevision(revisionId: string): Promise<V1SnapshotDocumentRef | null>;
  findCandidateRevisions(input: {
    projectId: string;
    requirementId: string;
    revisionIds: string[];
  }): Promise<V1SnapshotDocumentRef[]>;
  listRoleKnowledgeBindings(projectId: string, roleId: string): Promise<V1SnapshotBindingRecord[]>;
  listAcceptedPrerequisiteArtifacts(taskId: string): Promise<V1SnapshotPrerequisiteArtifact[]>;
  listRolePackageResources(input: {
    projectId: string;
    roleKey: string;
    revisionId: string;
  }): Promise<V1SnapshotRoleResource[]>;
  findSnapshot(snapshotId: string): Promise<V1SnapshotView | null>;
  findSnapshotResource(snapshotId: string, refId: string): Promise<V1SnapshotResourceBody | null>;
  /** 角色资源所属项目；`null` 表示内置包，对所有项目可见。 */
  findRoleResourceProjectId(rolePackageResourceId: string): Promise<string | null>;
  createSnapshot(input: V1CreateSnapshotInput): Promise<V1CreateSnapshotResult>;
}
