import type { Principal, Scope } from '@workmesh/shared';
import type { RepositoryEvidenceInput } from './v1-code-evidence-policy';

export const V1_GITHUB_EVIDENCE_REPOSITORY = Symbol('V1_GITHUB_EVIDENCE_REPOSITORY');

export type V1ReviewerKind = 'USER' | 'BOT';
export type V1ReviewEvidenceState = 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';

export type V1WebhookReceiptRecord = {
  id: string;
  projectId: string;
  source: 'GITHUB';
  eventType: string;
  deliveryId: string;
  signatureValid: boolean;
  payloadDigest: string;
  receivedAt: Date;
  processedAt: Date | null;
  status: string;
  errorMessage: string | null;
};

export type V1CodeReviewEvidenceRecord = {
  id: string;
  projectId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  authorExternalId: string;
  reviewerExternalId: string;
  reviewerKind: V1ReviewerKind;
  state: V1ReviewEvidenceState;
  commitSha: string | null;
  submittedAt: Date | null;
  reviewExternalId: string;
  artifactSetId: string | null;
  evidenceFingerprint: string;
  receiptId: string | null;
  createdAt: Date;
};

export type V1ArtifactSetSummary = {
  id: string;
  projectId: string;
  taskGeneration: number;
  manifestDigest: string;
};

export type V1RecordReceiptInput = {
  projectId: string;
  source: 'GITHUB';
  eventType: string;
  deliveryId: string;
  signatureValid: boolean;
  payloadDigest: string;
};

export type V1RecordEvidenceInput = {
  projectId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  authorExternalId: string;
  reviewerExternalId: string;
  reviewerKind: V1ReviewerKind;
  state: V1ReviewEvidenceState;
  commitSha: string | null;
  submittedAt: Date | null;
  reviewExternalId: string;
  artifactSetId: string | null;
  evidenceFingerprint: string;
  receiptId: string | null;
};

export type V1CreateVersionedTicketInput = {
  projectId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  artifactSetId: string;
  generation: number;
  evidenceId: string;
  now: Date;
  expiresInMs: number;
};

export type V1VersionedTicketRecord = {
  id: string;
  evidenceId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  artifactSetId: string;
  generation: number;
  preparedSecretHash: string | null;
  preparedExpiresAt: Date | null;
};

export type V1PersistIdempotencyInput = {
  id: string;
  projectScopeKey: string;
  principalScopeKey: string;
  key: string;
  method: string;
  route: string;
  requestDigest: string;
  resultRefs: Record<string, unknown>;
  now: Date;
};

export interface V1GithubEvidenceRepository {
  findReceiptByDelivery(source: 'GITHUB', deliveryId: string): Promise<V1WebhookReceiptRecord | null>;
  recordReceipt(input: V1RecordReceiptInput): Promise<V1WebhookReceiptRecord>;
  recordReceiptProcessed(receiptId: string, status: string, errorMessage: string | null): Promise<void>;
  findEvidenceIdsByReceipt(receiptId: string): Promise<string[]>;
  findEvidenceByFingerprint(fingerprint: string): Promise<V1CodeReviewEvidenceRecord | null>;
  recordEvidence(input: V1RecordEvidenceInput): Promise<V1CodeReviewEvidenceRecord>;
  findArtifactSet(id: string): Promise<V1ArtifactSetSummary | null>;
  findApprovedEvidenceForHead(
    repositoryId: string,
    changeRequestId: string,
    headSha: string,
  ): Promise<V1CodeReviewEvidenceRecord | null>;
  createVersionedTicket(
    input: V1CreateVersionedTicketInput,
  ): Promise<{ ticketId: string; secret: string; expiresAt: Date }>;
  findVersionedTicket(ticketId: string): Promise<V1VersionedTicketRecord | null>;
  consumeVersionedTicket(ticketId: string, now: Date): Promise<void>;
  persistIdempotency(input: V1PersistIdempotencyInput): Promise<void>;
}

export type { Principal, Scope, RepositoryEvidenceInput };
