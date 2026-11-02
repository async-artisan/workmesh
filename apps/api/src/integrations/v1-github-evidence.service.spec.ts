import { describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import { signGithubWebhookBody } from './v1-code-host-adapter';
import type { V1IdempotencyRepository } from '../common/v1-idempotency';
import type { RepositoryEvidenceInput } from './v1-code-evidence-policy';
import {
  V1GithubEvidenceService,
  type V1WebhookReceiveContext,
  type V1WebhookReceiveInput,
} from './v1-github-evidence.service';
import type {
  V1ArtifactSetSummary,
  V1CodeReviewEvidenceRecord,
  V1CreateVersionedTicketInput,
  V1GithubEvidenceRepository,
  V1PersistIdempotencyInput,
  V1RecordEvidenceInput,
  V1RecordReceiptInput,
  V1VersionedTicketRecord,
  V1WebhookReceiptRecord,
} from './v1-github-evidence.repository';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const SECRET = 'webhook-secret-fixture';
const HEAD_SHA = 'a'.repeat(40);

class FakeEvidenceRepository implements V1GithubEvidenceRepository {
  readonly receipts: V1WebhookReceiptRecord[] = [];
  readonly evidence: V1CodeReviewEvidenceRecord[] = [];
  receiptCreateCount = 0;

  async findReceiptByDelivery(source: 'GITHUB', deliveryId: string): Promise<V1WebhookReceiptRecord | null> {
    return this.receipts.find((receipt) => receipt.source === source && receipt.deliveryId === deliveryId) ?? null;
  }

  async recordReceipt(input: V1RecordReceiptInput): Promise<V1WebhookReceiptRecord> {
    this.receiptCreateCount += 1;
    const receipt: V1WebhookReceiptRecord = {
      id: `receipt-${this.receiptCreateCount}`,
      projectId: input.projectId,
      source: input.source,
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      signatureValid: input.signatureValid,
      payloadDigest: input.payloadDigest,
      receivedAt: NOW,
      processedAt: null,
      status: 'PENDING',
      errorMessage: null,
    };
    this.receipts.push(receipt);
    return receipt;
  }

  async recordReceiptProcessed(receiptId: string, status: string, errorMessage: string | null): Promise<void> {
    const receipt = this.receipts.find((item) => item.id === receiptId);
    if (!receipt) throw new Error(`receipt not found: ${receiptId}`);
    receipt.status = status;
    receipt.errorMessage = errorMessage;
    receipt.processedAt = NOW;
  }

  async findEvidenceIdsByReceipt(receiptId: string): Promise<string[]> {
    return this.evidence.filter((row) => row.receiptId === receiptId).map((row) => row.id);
  }

  async findEvidenceByFingerprint(fingerprint: string): Promise<V1CodeReviewEvidenceRecord | null> {
    return this.evidence.find((row) => row.evidenceFingerprint === fingerprint) ?? null;
  }

  async recordEvidence(input: V1RecordEvidenceInput): Promise<V1CodeReviewEvidenceRecord> {
    const record: V1CodeReviewEvidenceRecord = {
      id: `evidence-${this.evidence.length + 1}`,
      projectId: input.projectId,
      repositoryId: input.repositoryId,
      changeRequestId: input.changeRequestId,
      headSha: input.headSha,
      authorExternalId: input.authorExternalId,
      reviewerExternalId: input.reviewerExternalId,
      reviewerKind: input.reviewerKind,
      state: input.state,
      commitSha: input.commitSha,
      submittedAt: input.submittedAt,
      reviewExternalId: input.reviewExternalId,
      artifactSetId: input.artifactSetId,
      evidenceFingerprint: input.evidenceFingerprint,
      receiptId: input.receiptId,
      createdAt: NOW,
    };
    this.evidence.push(record);
    return record;
  }

  async findArtifactSet(_id: string): Promise<V1ArtifactSetSummary | null> {
    return null;
  }

  async findApprovedEvidenceForHead(
    _repositoryId: string,
    _changeRequestId: string,
    _headSha: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    return null;
  }

  async createVersionedTicket(
    _input: V1CreateVersionedTicketInput,
  ): Promise<{ ticketId: string; secret: string; expiresAt: Date }> {
    throw new Error('not used');
  }

  async findVersionedTicket(_ticketId: string): Promise<V1VersionedTicketRecord | null> {
    return null;
  }

  async consumeVersionedTicket(_ticketId: string, _now: Date): Promise<void> {
    return;
  }

  async persistIdempotency(_input: V1PersistIdempotencyInput): Promise<void> {
    return;
  }
}

const authorizationRepository: V1AuthorizationRepository = {
  findProject: async (projectId) => ({ id: projectId, version: 1, archivedAt: null }),
  findMember: async (projectId, userId) => ({
    projectId,
    userId,
    role: 'OWNER',
    version: 1,
    revokedAt: null,
  }),
  findActiveRoleAssignments: async () => [],
  findRoleAssignment: async () => null,
  findKnowledgeBase: async () => null,
  findGrants: async () => [],
};

const idempotencyRepository: V1IdempotencyRepository = {
  findOperation: async () => null,
};

const principal: Principal = { kind: 'HUMAN', userId: 'user-1', scopes: [] };

function repositoryEvidence(over: Partial<RepositoryEvidenceInput> = {}): RepositoryEvidenceInput {
  return {
    repositoryId: 'GITHUB:1296269',
    changeRequestId: '987654',
    changeRequestHeadSha: HEAD_SHA,
    authorExternalId: '1001',
    merged: true,
    artifactCommitSha: HEAD_SHA,
    reviews: [
      {
        reviewId: '501',
        reviewerId: '2001',
        reviewerKind: 'USER',
        state: 'APPROVED',
        commitSha: HEAD_SHA,
        submittedAt: '2026-10-31T09:00:00Z',
      },
    ],
    ...over,
  };
}

function rawBodyOf(repositories: RepositoryEvidenceInput[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      projectId: 'project-1',
      eventType: 'pull_request_review',
      deliveryId: 'delivery-1',
      repositories,
    }),
    'utf8',
  );
}

function receiveInput(over: Partial<V1WebhookReceiveInput> = {}): V1WebhookReceiveInput {
  const repositories = over.repositories ?? [repositoryEvidence()];
  const rawBody = over.rawBody ?? rawBodyOf(repositories);
  return {
    eventType: 'pull_request_review',
    deliveryId: 'delivery-1',
    rawBody,
    signatureHeader: over.signatureHeader ?? signGithubWebhookBody(rawBody, SECRET),
    repositories,
    ...over,
  };
}

function context(idempotencyKey: string, operationId: string): V1WebhookReceiveContext {
  return {
    idempotencyKey,
    method: 'POST',
    route: '/api/v1/integrations/github/webhooks',
    body: { deliveryId: 'delivery-1', eventType: 'pull_request_review' },
    requestId: 'request-1',
    now: NOW,
    operationId,
  };
}

function serviceWith(repository: V1GithubEvidenceRepository, secret = SECRET): V1GithubEvidenceService {
  return new V1GithubEvidenceService(
    repository,
    new V1AuthorizationService(authorizationRepository),
    idempotencyRepository,
    secret,
  );
}

describe('v1 github evidence delivery idempotency', () => {
  it('accepts a valid server-side HMAC signature', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const first = await service.receiveWebhook(principal, 'project-1', receiveInput(), context('key-1', 'op-1'));

    expect(first).toMatchObject({ decision: 'VALID', replayed: false, signatureValid: true });
    expect(first.evidenceIds).toHaveLength(1);
    expect(repository.receipts[0].payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the original result for a repeated delivery', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const input = receiveInput();

    const first = await service.receiveWebhook(principal, 'project-1', input, context('key-1', 'op-1'));
    const duplicate = await service.receiveWebhook(principal, 'project-1', input, context('key-2', 'op-2'));

    expect(duplicate).toMatchObject({
      receiptId: first.receiptId,
      decision: 'VALID',
      replayed: true,
      signatureValid: true,
      evidenceIds: first.evidenceIds,
    });
    expect(repository.receiptCreateCount).toBe(1);
  });

  it('rejects the same delivery id with a different payload digest', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);

    await service.receiveWebhook(principal, 'project-1', receiveInput(), context('key-1', 'op-1'));
    const differentBody = rawBodyOf([repositoryEvidence({ changeRequestId: '987655' })]);
    await expect(
      service.receiveWebhook(
        principal,
        'project-1',
        receiveInput({ rawBody: differentBody, repositories: [repositoryEvidence({ changeRequestId: '987655' })] }),
        context('key-2', 'op-2'),
      ),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_CONFLICT,
      message: 'WEBHOOK_REPLAY_CONFLICT',
      status: 409,
    });
    expect(repository.receiptCreateCount).toBe(1);
  });

  it('rejects a forged signature before recording anything', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const input = receiveInput({ signatureHeader: `sha256=${'0'.repeat(64)}` });

    await expect(
      service.receiveWebhook(principal, 'project-1', input, context('key-1', 'op-1')),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.FORBIDDEN,
      message: 'WEBHOOK_SIGNATURE_INVALID',
      status: 403,
    });
    expect(repository.receiptCreateCount).toBe(0);
    expect(repository.evidence).toHaveLength(0);
  });

  it('fails closed when no webhook secret is configured', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository, '');
    const input = receiveInput();

    await expect(
      service.receiveWebhook(principal, 'project-1', input, context('key-1', 'op-1')),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.FORBIDDEN,
      message: 'WEBHOOK_SIGNATURE_INVALID',
      status: 403,
    });
    expect(repository.receiptCreateCount).toBe(0);
  });

  it('does not treat the change author reviewing their own head as valid approval', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const input = receiveInput({
      repositories: [
        repositoryEvidence({
          authorExternalId: '1001',
          reviews: [
            {
              reviewId: '501',
              reviewerId: '1001',
              reviewerKind: 'USER',
              state: 'APPROVED',
              commitSha: HEAD_SHA,
              submittedAt: '2026-10-31T09:00:00Z',
            },
          ],
        }),
      ],
    });

    const result = await service.receiveWebhook(principal, 'project-1', input, context('key-1', 'op-1'));
    expect(result.decision).toBe('INVALID');
    expect(result.reasons).toContain('OTHER_USER_APPROVAL_REQUIRED');
  });
});
