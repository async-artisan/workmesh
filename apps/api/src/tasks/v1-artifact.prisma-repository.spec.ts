import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { V1ArtifactPrismaRepository } from './v1-artifact.prisma-repository';
import type { V1DeliverInput } from './v1-artifact.repository';

function repository(prisma: unknown): V1ArtifactPrismaRepository {
  return new V1ArtifactPrismaRepository(prisma as PrismaService);
}

/** Guard tests use controlled reads; actual transaction rollback/concurrency is in v1-task.database.spec.ts. */
function deliveryFixture() {
  const task = {
    id: 'task-1',
    projectId: 'project-1',
    workflowInstanceId: 'workflow-1',
    stepKey: 'implementation',
    roleId: 'developer',
    responsibleUserId: 'user-1',
    version: 4,
    generation: 2,
    currentSnapshotId: 'snapshot-1',
    currentClaimId: 'claim-1',
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
  };
  const claim = {
    id: 'claim-1',
    userId: 'user-1',
    credentialId: 'credential-1',
    taskGeneration: 2,
    releasedAt: null as Date | null,
  };
  const snapshot = {
    id: 'snapshot-1',
    projectId: task.projectId,
    taskId: task.id,
    claimId: claim.id,
    taskGeneration: 2,
    requirementId: 'requirement-1',
    requirementGeneration: 3,
    workflowDefinitionRevisionId: 'revision-1',
    manifestDigest: 'a'.repeat(64),
    resources: [],
  };
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: task.projectId }]),
    task: {
      findUnique: vi.fn().mockResolvedValue(task),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    workflowInstance: {
      findFirst: vi.fn().mockResolvedValue({
        retiredAt: null,
        bindings: {
          roleSlotBindings: [{ slotKey: 'acceptance', roleId: 'reviewer', userId: 'human-1' }],
        },
      }),
    },
    taskClaim: {
      findFirst: vi.fn().mockResolvedValue(claim),
      findUnique: vi.fn().mockResolvedValue(claim),
    },
    contextSnapshot: { findUnique: vi.fn().mockResolvedValue(snapshot) },
    requirement: { findUnique: vi.fn().mockResolvedValue({ generation: 3 }) },
    projectRepository: { findFirst: vi.fn().mockResolvedValue(null) },
    principalStamp: { create: vi.fn().mockResolvedValue({ id: 'stamp-1' }) },
    artifactSet: { create: vi.fn().mockResolvedValue({ id: 'set-1' }) },
    artifact: { createManyAndReturn: vi.fn().mockResolvedValue([]) },
    artifactSetItem: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workflowRevision: {
      findUnique: vi.fn().mockResolvedValue({
        definition: {
          roleSlots: [{ key: 'acceptance', kind: 'TASK_ACCEPTANCE' }],
          steps: [
            {
              key: task.stepKey,
              kind: 'DELIVERY',
              gates: [{ reviewerSlots: ['acceptance'] }],
            },
          ],
        },
      }),
    },
    reviewRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({ id: 'review-1' }),
    },
    approvalSlot: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
    idempotentOperation: { create: vi.fn().mockResolvedValue({}) },
  };
  const transaction = vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx));
  const input: V1DeliverInput = {
    taskId: task.id,
    expectedVersion: task.version,
    claimId: claim.id,
    snapshotId: snapshot.id,
    workflowDefinitionRevisionId: snapshot.workflowDefinitionRevisionId,
    principalScopeKey: 'agent:credential-1',
    localRunId: 'local-1',
    candidateRevisionIds: [],
    items: [],
    subjectDigest: 'b'.repeat(64),
    actorUserId: claim.userId,
    actorStamp: {
      kind: 'AGENT',
      webSessionId: null,
      agentCredentialId: claim.credentialId,
      roleId: task.roleId,
      roleKeySnapshot: 'developer',
      scopeSnapshot: ['task:deliver'],
      userAuthVersion: 1,
    },
    now: new Date('2026-11-07T00:00:00Z'),
    operation: {
      id: 'operation-1',
      projectScopeKey: 'project:project-1',
      principalScopeKey: 'agent:credential-1',
      key: 'key-1',
      method: 'POST',
      route: '/tasks/task-1/artifact-sets',
      requestDigest: 'c'.repeat(64),
    },
  };
  return {
    task,
    claim,
    snapshot,
    tx,
    transaction,
    input,
    artifacts: repository({ $transaction: transaction }),
  };
}

describe('V1ArtifactPrismaRepository storage and evidence boundaries', () => {
  it('returns a detached copy of hosted bytes and their stored integrity metadata', async () => {
    const bytes = Buffer.from([0, 1, 2, 255]);
    const row = {
      id: 'binary-artifact',
      storage: 'HOSTED',
      mediaType: 'application/octet-stream',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bodyBytes: bytes,
    };
    const artifacts = repository({ artifact: { findUnique: vi.fn().mockResolvedValue(row) } });
    const body = await artifacts.findArtifactBody(row.id);
    expect(body).toEqual({
      artifactId: row.id,
      storage: row.storage,
      mediaType: row.mediaType,
      byteLength: row.byteLength,
      sha256: row.sha256,
      bytes,
    });
    body!.bytes[0] = 42;
    expect(bytes[0]).toBe(0);
  });

  it.each([
    ['absent artifact', null],
    ['hosted metadata without bytes', { storage: 'HOSTED', bodyBytes: null }],
    [
      'Git reference with stray bytes',
      { storage: 'GIT_REF', bodyBytes: Buffer.from('not hosted') },
    ],
  ])('does not invent downloadable content for %s', async (_name, row) => {
    const artifacts = repository({ artifact: { findUnique: vi.fn().mockResolvedValue(row) } });
    expect(await artifacts.findArtifactBody('artifact')).toBeNull();
  });

  it('keeps external checks distinct from agent reports and never previews Git references', async () => {
    const evidence = { kind: 'TEST_REPORT', provider: 'local', url: 'https://example.test/report' };
    const findUnique = vi.fn().mockResolvedValue({
      id: 'set-1',
      taskId: 'task-1',
      taskGeneration: 2,
      snapshotId: 'snapshot-1',
      manifestDigest: 'a'.repeat(64),
      workflowDefinitionRevisionId: 'revision-1',
      localRunId: 'local-1',
      createdAt: new Date('2026-11-07T00:00:00Z'),
      items: [
        { candidateRevisionId: 'revision-z' },
        { candidateRevisionId: null, artifactId: 'git-1' },
        { candidateRevisionId: 'revision-a' },
      ],
      artifacts: [
        {
          id: 'git-1',
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/typescript',
          byteLength: 10,
          sha256: 'b'.repeat(64),
          projectRepositoryId: 'repository-1',
          commitSha: 'c'.repeat(40),
          repoPath: 'src/index.ts',
          summary: 'Submitted code',
          bodyBytes: Buffer.from('stray bytes are not source content'),
          checks: [
            null,
            [],
            {
              code: 'human-readable-report',
              passed: true,
              source: 'EXTERNAL_REFERENCE',
              evidence,
              message: 'See report',
            },
            { code: 'missing-reference', passed: true, source: 'EXTERNAL_REFERENCE' },
            { passed: 'true' },
          ],
        },
      ],
    });
    const artifacts = repository({ artifactSet: { findUnique } });
    const set = await artifacts.findArtifactSet('set-1');
    expect(set?.candidateRevisionIds).toEqual(['revision-a', 'revision-z']);
    expect(set?.artifacts[0]).toMatchObject({
      storage: 'GIT_REF',
      projectRepositoryId: 'repository-1',
      commitSha: 'c'.repeat(40),
      repoPath: 'src/index.ts',
      contentPreview: null,
      checks: [
        {
          code: 'human-readable-report',
          passed: true,
          source: 'EXTERNAL_REFERENCE',
          evidence,
          message: 'See report',
        },
        { code: 'missing-reference', passed: true, source: 'AGENT_REPORTED' },
        { code: '', passed: false, source: 'AGENT_REPORTED' },
      ],
    });
    findUnique.mockResolvedValueOnce(null);
    expect(await artifacts.findArtifactSet('absent')).toBeNull();
  });

  it('does not resolve unconsumed, expired or non-ticket rows into review evidence', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        preparedSecretHash: 'secret',
        preparedExpiresAt: new Date(0),
        preparedEvidenceId: 'expired',
      },
      {
        preparedSecretHash: 'secret',
        preparedExpiresAt: new Date('2099-01-01'),
        preparedEvidenceId: 'pending',
      },
      { preparedSecretHash: null, preparedExpiresAt: null, preparedEvidenceId: 'not-a-ticket' },
      { preparedSecretHash: 'secret', preparedExpiresAt: null, preparedEvidenceId: null },
    ]);
    const repositories = vi.fn();
    const artifacts = repository({
      codeReviewEvidence: { findMany },
      projectRepository: { findMany: repositories },
    });
    expect(await artifacts.findCodeReviewEvidence('project-1', 'set-1')).toEqual([]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(repositories).not.toHaveBeenCalled();
  });

  it('scopes both evidence reads to the project and preserves a revoked approval as revoked', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([
        { preparedSecretHash: 'secret', preparedExpiresAt: null, preparedEvidenceId: 'review-1' },
        {
          preparedSecretHash: 'secret',
          preparedExpiresAt: new Date(0),
          preparedEvidenceId: 'foreign-review',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'review-1',
          repositoryId: 'provider-repository',
          changeRequestId: '42',
          headSha: 'c'.repeat(40),
          commitSha: 'c'.repeat(40),
          authorExternalId: 'author',
          reviewerExternalId: 'reviewer',
          reviewerKind: 'USER',
          state: 'DISMISSED',
          submittedAt: null,
        },
      ]);
    const repositories = vi.fn().mockResolvedValue([
      { externalId: 'provider-repository', owner: 'owner', name: 'repository', adapter: 'GITHUB' },
      { externalId: null, owner: 'unverified', name: 'declared', adapter: null },
    ]);
    const artifacts = repository({
      codeReviewEvidence: { findMany },
      projectRepository: { findMany: repositories },
    });
    expect(await artifacts.findCodeReviewEvidence('project-1', 'set-1')).toEqual([
      {
        id: 'review-1',
        repositoryId: 'provider-repository',
        repositoryOwner: 'owner',
        repositoryName: 'repository',
        adapter: 'GITHUB',
        changeRequestId: '42',
        headSha: 'c'.repeat(40),
        commitSha: 'c'.repeat(40),
        authorExternalId: 'author',
        reviewerExternalId: 'reviewer',
        reviewerKind: 'USER',
        state: 'DISMISSED',
        submittedAt: null,
      },
    ]);
    expect(findMany.mock.calls[0][0].where).toEqual({
      projectId: 'project-1',
      artifactSetId: 'set-1',
      preparedSecretHash: { not: null },
    });
    expect(findMany.mock.calls[1][0].where).toEqual({
      projectId: 'project-1',
      id: { in: ['review-1'] },
      preparedSecretHash: null,
    });
    expect(repositories.mock.calls[0][0].where).toEqual({
      projectId: 'project-1',
      identityMode: 'PROVIDER',
      externalId: { in: ['provider-repository'] },
    });
  });
});

describe('V1ArtifactPrismaRepository delivery guards', () => {
  function expectNoDeliveryWrites(tx: ReturnType<typeof deliveryFixture>['tx']) {
    expect(tx.principalStamp.create).not.toHaveBeenCalled();
    expect(tx.artifactSet.create).not.toHaveBeenCalled();
    expect(tx.reviewRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.task.updateMany).not.toHaveBeenCalled();
    expect(tx.idempotentOperation.create).not.toHaveBeenCalled();
  }

  it('rejects a deleted task without creating delivery or identity records', async () => {
    const f = deliveryFixture();
    f.tx.task.findUnique.mockResolvedValue(null);
    await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
      status: 404,
      message: 'TASK_NOT_FOUND',
    });
    expectNoDeliveryWrites(f.tx);
  });

  it.each(['missing', 'released', 'different'])(
    'rejects a %s claim before writing a delivery',
    async (state) => {
      const f = deliveryFixture();
      if (state === 'missing') f.tx.taskClaim.findFirst.mockResolvedValue(null);
      if (state === 'released') f.claim.releasedAt = new Date('2026-11-06T00:00:00Z');
      if (state === 'different') f.claim.id = 'replacement-claim';
      await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
        status: 409,
        message: 'CLAIM_INVALID',
      });
      expectNoDeliveryWrites(f.tx);
    },
  );

  it.each(['agent:other-credential', 'user:user-1'])(
    'does not let %s reuse an agent claim owned by the same user',
    async (principalScopeKey) => {
      const f = deliveryFixture();
      await expect(f.artifacts.deliver({ ...f.input, principalScopeKey })).rejects.toMatchObject({
        status: 409,
        message: 'CLAIM_INVALID',
      });
      expectNoDeliveryWrites(f.tx);
    },
  );

  it('rejects a claim from an older task generation even when its ID and owner still match', async () => {
    const f = deliveryFixture();
    f.claim.taskGeneration = 1;
    await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'BASELINE_STALE',
    });
    expectNoDeliveryWrites(f.tx);
  });

  it('rejects a foreign-project snapshot even when task, claim, generation and revision match', async () => {
    const f = deliveryFixture();
    f.snapshot.projectId = 'other-project';
    await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'SNAPSHOT_STALE',
    });
    expectNoDeliveryWrites(f.tx);
  });

  it('does not allow a Git reference to introduce a repository from another project', async () => {
    const f = deliveryFixture();
    const input: V1DeliverInput = {
      ...f.input,
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/typescript',
          bodyBytes: null,
          sha256: 'd'.repeat(64),
          byteLength: 12,
          projectRepositoryId: 'foreign-repository',
          commitSha: 'e'.repeat(40),
          repoPath: 'src/index.ts',
          summary: null,
          checks: [],
        },
      ],
    };
    await expect(f.artifacts.deliver(input)).rejects.toMatchObject({
      status: 422,
      message: 'ARTIFACT_REPOSITORY_UNKNOWN',
    });
    expect(f.tx.projectRepository.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-repository', projectId: f.task.projectId },
    });
    expectNoDeliveryWrites(f.tx);
  });

  it('fails closed when the immutable workflow revision is unavailable', async () => {
    const f = deliveryFixture();
    f.tx.workflowRevision.findUnique.mockResolvedValue(null);
    await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
      status: 422,
      message: 'TASK_ACCEPTANCE_GATE_REQUIRED',
    });
    expect(f.tx.reviewRequest.updateMany).not.toHaveBeenCalled();
    expect(f.tx.task.updateMany).not.toHaveBeenCalled();
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.idempotentOperation.create).not.toHaveBeenCalled();
  });

  it('does not report success or commit an operation after the final task CAS loses', async () => {
    const f = deliveryFixture();
    f.tx.task.updateMany.mockResolvedValue({ count: 0 });
    await expect(f.artifacts.deliver(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'TASK_VERSION_CONFLICT',
    });
    expect(f.tx.task.updateMany.mock.calls[0][0].where).toEqual({
      id: f.task.id,
      version: f.input.expectedVersion,
      generation: f.task.generation,
      currentClaimId: f.claim.id,
    });
    expect(f.tx.auditEvent.create).not.toHaveBeenCalled();
    expect(f.tx.idempotentOperation.create).not.toHaveBeenCalled();
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates an idempotency uniqueness conflict without retrying the delivery', async () => {
    const f = deliveryFixture();
    const conflict = Object.assign(new Error('Idempotency key already committed'), {
      code: 'P2002',
    });
    f.tx.idempotentOperation.create.mockRejectedValue(conflict);
    await expect(f.artifacts.deliver(f.input)).rejects.toBe(conflict);
    expect(f.transaction).toHaveBeenCalledTimes(1);
  });
});
