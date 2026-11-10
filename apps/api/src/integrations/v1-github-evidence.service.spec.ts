import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { V1_ERROR_CODES, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import { signGithubWebhookBody } from './v1-code-host-adapter';
import type { V1IdempotencyRepository } from '../common/v1-idempotency';
import type { RepositoryEvidenceInput } from './v1-code-evidence-policy';
import {
  V1GithubEvidenceService,
  evidenceFingerprintOf,
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

  async findReceiptByDelivery(
    source: 'GITHUB',
    deliveryId: string,
  ): Promise<V1WebhookReceiptRecord | null> {
    return (
      this.receipts.find(
        (receipt) => receipt.source === source && receipt.deliveryId === deliveryId,
      ) ?? null
    );
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

  async recordReceiptProcessed(
    receiptId: string,
    status: string,
    errorMessage: string | null,
  ): Promise<void> {
    const receipt = this.receipts.find((item) => item.id === receiptId);
    if (!receipt) throw new Error(`receipt not found: ${receiptId}`);
    receipt.status = status;
    receipt.errorMessage = errorMessage;
    receipt.processedAt = NOW;
  }

  async findEvidenceIdsByReceipt(receiptId: string): Promise<string[]> {
    return this.evidence.filter((row) => row.receiptId === receiptId).map((row) => row.id);
  }

  async completeReceipt(
    receiptId: string,
    status: string,
    errorMessage: string | null,
    operation: V1PersistIdempotencyInput,
  ): Promise<void> {
    await this.persistIdempotency(operation);
    await this.recordReceiptProcessed(receiptId, status, errorMessage);
  }

  async findEvidenceByFingerprint(
    projectId: string,
    fingerprint: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    return (
      this.evidence.find(
        (row) => row.projectId === projectId && row.evidenceFingerprint === fingerprint,
      ) ?? null
    );
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

  async assertCodeEvidenceTarget(): Promise<void> {}

  async findApprovedEvidenceForHead(
    _projectId: string,
    _repositoryId: string,
    _changeRequestId: string,
    _headSha: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    return null;
  }

  async createVersionedTicket(
    _input: V1CreateVersionedTicketInput,
    _operation: (ticket: {
      ticketId: string;
      secret: string;
      expiresAt: Date;
    }) => V1PersistIdempotencyInput,
  ): Promise<{ ticketId: string; secret: string; expiresAt: Date }> {
    throw new Error('not used');
  }

  async findVersionedTicket(_ticketId: string): Promise<V1VersionedTicketRecord | null> {
    return null;
  }

  async consumeVersionedTicket(
    _ticketId: string,
    _projectId: string,
    _now: Date,
  ): Promise<boolean> {
    return true;
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

function serviceWith(
  repository: V1GithubEvidenceRepository,
  secret = SECRET,
  operations = idempotencyRepository,
  ticketKey = 'a'.repeat(64),
): V1GithubEvidenceService {
  return new V1GithubEvidenceService(
    repository,
    new V1AuthorizationService(authorizationRepository),
    operations,
    secret,
    ticketKey,
  );
}

describe('evidenceFingerprintOf', () => {
  const review = {
    repositoryId: '1234',
    changeRequestId: '42',
    headSha: 'a'.repeat(40),
    reviewerExternalId: 'reviewer',
    reviewExternalId: 'review-1',
    state: 'APPROVED',
    commitSha: 'a'.repeat(40),
  };

  it('separates the same upstream review recorded under two projects', () => {
    // 同一个 GitHub 仓库可以被两个项目登记；指纹不含 projectId 时两边会互相顶掉，
    // 表现为后登记的项目永远查不到自己的证据。
    const inA = evidenceFingerprintOf({ ...review, projectId: 'p-a' });
    const inB = evidenceFingerprintOf({ ...review, projectId: 'p-b' });
    expect(inA).not.toBe(inB);
    // 同项目同内容必须稳定，否则去重失效。
    expect(evidenceFingerprintOf({ ...review, projectId: 'p-a' })).toBe(inA);
  });
});

describe('v1 github evidence delivery idempotency', () => {
  function prepareFixture() {
    const repository = new FakeEvidenceRepository();
    const input = {
      artifactSetId: 'artifact-1',
      repositoryId: 'repo-1',
      changeRequestId: 'change-1',
      headSha: HEAD_SHA,
      generation: 1,
    };
    vi.spyOn(repository, 'findArtifactSet').mockResolvedValue({
      id: 'artifact-1',
      projectId: 'project-1',
      taskGeneration: 1,
      manifestDigest: 'd'.repeat(64),
    });
    const approved: V1CodeReviewEvidenceRecord = {
      id: 'approved-1',
      projectId: 'project-1',
      repositoryId: 'repo-1',
      changeRequestId: 'change-1',
      headSha: HEAD_SHA,
      authorExternalId: 'author',
      reviewerExternalId: 'reviewer',
      reviewerKind: 'USER',
      state: 'APPROVED',
      commitSha: HEAD_SHA,
      submittedAt: NOW,
      reviewExternalId: 'review-1',
      artifactSetId: 'artifact-1',
      evidenceFingerprint: 'f'.repeat(64),
      receiptId: null,
      createdAt: NOW,
    };
    vi.spyOn(repository, 'findApprovedEvidenceForHead').mockResolvedValue(approved);
    const create = vi
      .spyOn(repository, 'createVersionedTicket')
      .mockImplementation(async (_input, operation) => {
        const ticket = {
          ticketId: 'ticket-1',
          secret: 'ticket-secret',
          expiresAt: new Date(NOW.getTime() + 60_000),
        };
        await repository.persistIdempotency(operation(ticket));
        return ticket;
      });
    const persist = vi.spyOn(repository, 'persistIdempotency');
    const operations: V1IdempotencyRepository = {
      findOperation: async () => {
        const record = persist.mock.calls.at(-1)?.[0];
        return record ? { ...record, committedAt: NOW } : null;
      },
    };
    const prepareContext = {
      ...context('prepare-1', 'operation-1'),
      route: '/prepare',
      body: input,
    };
    return { repository, input, approved, create, persist, operations, prepareContext };
  }

  it('encrypts persisted ticket secrets and replays the same response without creating another ticket', async () => {
    const f = prepareFixture();
    const service = serviceWith(f.repository, SECRET, f.operations);
    const first = await service.prepareCodeEvidence(
      principal,
      'project-1',
      f.input,
      f.prepareContext,
    );
    const stored = f.persist.mock.calls[0][0].resultRefs;
    expect(stored).not.toHaveProperty('secret');
    expect(JSON.stringify(stored)).not.toContain('ticket-secret');
    expect(stored.encryptedSecret).toEqual(expect.stringMatching(/^v1\./));
    const replay = await service.prepareCodeEvidence(
      principal,
      'project-1',
      f.input,
      f.prepareContext,
    );
    expect(replay).toEqual({ ...first, replayed: true });
    expect(f.create).toHaveBeenCalledTimes(1);
    stored.encryptedSecret = 'tampered';
    await expect(
      service.prepareCodeEvidence(principal, 'project-1', f.input, f.prepareContext),
    ).rejects.toMatchObject({ status: 409, message: 'CODE_EVIDENCE_TICKET_REPREPARE_REQUIRED' });
    delete stored.encryptedSecret;
    stored.secret = 'legacy-plaintext';
    await expect(
      service.prepareCodeEvidence(principal, 'project-1', f.input, f.prepareContext),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('fails before creating a ticket when the deployment encryption key is missing', async () => {
    const f = prepareFixture();
    await expect(
      serviceWith(f.repository, SECRET, f.operations, '').prepareCodeEvidence(
        principal,
        'project-1',
        f.input,
        f.prepareContext,
      ),
    ).rejects.toMatchObject({ status: 503, message: 'TICKET_ENCRYPTION_KEY_REQUIRED' });
    expect(f.create).not.toHaveBeenCalled();
  });

  it('refuses stale artifact generations and evidence belonging to another project', async () => {
    const f = prepareFixture();
    const service = serviceWith(f.repository, SECRET, f.operations);
    await expect(
      service.prepareCodeEvidence(
        principal,
        'project-1',
        { ...f.input, generation: 2 },
        f.prepareContext,
      ),
    ).rejects.toMatchObject({ status: 409 });
    vi.mocked(f.repository.findApprovedEvidenceForHead).mockResolvedValue({
      ...f.approved,
      projectId: 'project-2',
    });
    await expect(
      service.prepareCodeEvidence(principal, 'project-1', f.input, f.prepareContext),
    ).rejects.toMatchObject({ status: 422 });
    expect(f.create).not.toHaveBeenCalled();
  });

  function versionedTicket(): V1VersionedTicketRecord {
    return {
      id: 'ticket-1',
      projectId: 'project-1',
      evidenceId: 'evidence-1',
      repositoryId: 'repo-1',
      changeRequestId: 'change-1',
      headSha: HEAD_SHA,
      artifactSetId: 'artifact-1',
      generation: 1,
      preparedSecretHash: createHash('sha256').update('ticket-secret').digest('hex'),
      preparedExpiresAt: new Date(NOW.getTime() + 60_000),
    };
  }

  const useInput = {
    ticketId: 'ticket-1',
    secret: 'ticket-secret',
    artifactSetId: 'artifact-1',
    headSha: HEAD_SHA,
    generation: 1,
  };

  it('does not disclose or consume a ticket owned by another project', async () => {
    const repository = new FakeEvidenceRepository();
    vi.spyOn(repository, 'findVersionedTicket').mockResolvedValue(versionedTicket());
    const consume = vi.spyOn(repository, 'consumeVersionedTicket');
    await expect(
      serviceWith(repository).useVersionedTicket(principal, 'project-2', useInput, { now: NOW }),
    ).rejects.toMatchObject({ status: 404 });
    expect(consume).not.toHaveBeenCalled();
  });

  it('rejects the losing consumer when a valid ticket was consumed concurrently', async () => {
    const repository = new FakeEvidenceRepository();
    vi.spyOn(repository, 'findVersionedTicket').mockResolvedValue(versionedTicket());
    const consume = vi.spyOn(repository, 'consumeVersionedTicket').mockResolvedValue(false);
    await expect(
      serviceWith(repository).useVersionedTicket(principal, 'project-1', useInput, { now: NOW }),
    ).rejects.toMatchObject({ status: 409 });
    expect(consume).toHaveBeenCalledWith('ticket-1', 'project-1', NOW);
  });

  it('returns the evidence only after successful conditional consumption', async () => {
    const repository = new FakeEvidenceRepository();
    vi.spyOn(repository, 'findVersionedTicket').mockResolvedValue(versionedTicket());
    await expect(
      serviceWith(repository).useVersionedTicket(principal, 'project-1', useInput, { now: NOW }),
    ).resolves.toMatchObject({ evidenceId: 'evidence-1', repositoryId: 'repo-1' });
  });
  it('keeps a delivery resumable when completion persistence fails', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    vi.spyOn(repository, 'persistIdempotency').mockRejectedValueOnce(new Error('commit failed'));
    await expect(
      service.receiveWebhook(principal, 'project-1', receiveInput(), context('key-1', 'op-1')),
    ).rejects.toThrow('commit failed');
    expect(repository.receipts[0].status).toBe('PENDING');
    const result = await service.receiveWebhook(
      principal,
      'project-1',
      receiveInput(),
      context('key-1', 'op-2'),
    );
    expect(result.decision).toBe('VALID');
    expect(repository.receipts).toHaveLength(1);
    expect(repository.evidence).toHaveLength(1);
    expect(repository.receipts[0].status).toBe('PROCESSED');
  });

  it('resumes a pending delivery after an evidence write fails', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const evidence = repositoryEvidence();
    evidence.reviews.push({ ...evidence.reviews[0], reviewId: '502', reviewerId: '2002' });
    const input = receiveInput({ repositories: [evidence] });
    const original = repository.recordEvidence.bind(repository);
    vi.spyOn(repository, 'recordEvidence')
      .mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('temporary storage failure'))
      .mockImplementation(original);

    await expect(
      service.receiveWebhook(principal, 'project-1', input, context('key-1', 'op-1')),
    ).rejects.toThrow('temporary storage failure');
    expect(repository.receipts[0].status).toBe('PENDING');
    expect(repository.evidence).toHaveLength(1);

    const result = await service.receiveWebhook(
      principal,
      'project-1',
      input,
      context('key-1', 'op-2'),
    );
    expect(result.decision).toBe('VALID');
    expect(result.evidenceIds).toHaveLength(2);
    expect(repository.receipts).toHaveLength(1);
    expect(repository.evidence).toHaveLength(2);
    expect(repository.receipts[0].status).toBe('PROCESSED');
  });

  it('rejects a delivery belonging to another project', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    await service.receiveWebhook(principal, 'project-1', receiveInput(), context('key-1', 'op-1'));
    await expect(
      service.receiveWebhook(principal, 'project-2', receiveInput(), context('key-2', 'op-2')),
    ).rejects.toMatchObject({ message: 'WEBHOOK_REPLAY_CONFLICT', status: 409 });
    expect(repository.receipts).toHaveLength(1);
  });

  it('accepts a valid server-side HMAC signature', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const first = await service.receiveWebhook(
      principal,
      'project-1',
      receiveInput(),
      context('key-1', 'op-1'),
    );

    expect(first).toMatchObject({ decision: 'VALID', replayed: false, signatureValid: true });
    expect(first.evidenceIds).toHaveLength(1);
    expect(repository.receipts[0].payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the original result for a repeated delivery', async () => {
    const repository = new FakeEvidenceRepository();
    const service = serviceWith(repository);
    const input = receiveInput();

    const first = await service.receiveWebhook(
      principal,
      'project-1',
      input,
      context('key-1', 'op-1'),
    );
    const duplicate = await service.receiveWebhook(
      principal,
      'project-1',
      input,
      context('key-2', 'op-2'),
    );

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
        receiveInput({
          rawBody: differentBody,
          repositories: [repositoryEvidence({ changeRequestId: '987655' })],
        }),
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

    const result = await service.receiveWebhook(
      principal,
      'project-1',
      input,
      context('key-1', 'op-1'),
    );
    expect(result.decision).toBe('INVALID');
    expect(result.reasons).toContain('OTHER_USER_APPROVAL_REQUIRED');
  });
});
