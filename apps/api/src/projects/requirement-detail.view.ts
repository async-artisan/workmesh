import type { RequirementTrustChain, TaskClaimEligibility } from '@workmesh/shared';

type Actor = { id: string; email: string };
type Decision = { id: string; decision: string; createdAt: Date; actor: Actor | null };

/** Public read model uses stable protocol strings rather than generated Prisma enum paths. */
export type RequirementDetailView = {
  requirement: {
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
    createdAt: Date;
    updatedAt: Date;
  };
  acceptanceKeys: string[];
  tasks: Array<{
    id: string;
    stepKey: string;
    stepDisplayName: string | null;
    role: { key: string; title: string };
    responsibleUser: Actor;
    claimEligibility: TaskClaimEligibility;
    workflowWorkStatus: string;
    version: number;
    generation: number;
    executionStatus: string;
    workStatus: string;
    currentClaimId: string | null;
    currentArtifactSetId: string | null;
    instanceId: string;
    artifactCount: number;
    review: { id: string; kind: string; status: string; decisions: Decision[] } | null;
  }>;
  artifacts: Array<{
    id: string;
    taskId: string;
    artifactSetId: string;
    kind: string;
    storage: string;
    mediaType: string;
    byteLength: number;
    sha256: string;
    commitSha: string | null;
    repoPath: string | null;
    summary: string | null;
    checks: unknown;
    createdAt: Date;
  }>;
  reviews: Array<{
    id: string;
    kind: string;
    status: string;
    version: number;
    subjectDigest: string;
    documentRevisionId: string | null;
    artifactSetId: string | null;
    taskId: string | null;
    createdAt: Date;
    subjectLabel: string;
    stepDisplayName?: string | null;
    slots: Array<{
      id: string;
      slotKey: string;
      requiredUserId: string | null;
      requiredRoleId: string | null;
    }>;
    decisions: Array<Decision & { approvalSlotId: string; comment: string | null }>;
  }>;
  changes: Array<{
    id: string;
    sourceKind: string;
    sourceId: string;
    changedFields: string[];
    targets: unknown;
    createdAt: Date;
    recipients: Array<{
      id: string;
      userId: string;
      roleId: string | null;
      ackedAt: Date | null;
      version: number;
    }>;
  }>;
  counts: { tasks: number; artifacts: number; reviews: number; changes: number };
  trustChain: RequirementTrustChain;
};
