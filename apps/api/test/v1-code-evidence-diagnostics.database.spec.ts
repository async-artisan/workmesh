import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { V1ArtifactPrismaRepository } from '../src/tasks/v1-artifact.prisma-repository';
import { V1ArtifactService } from '../src/tasks/v1-artifact.service';
import { V1TaskPrismaRepository } from '../src/tasks/v1-task.prisma-repository';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { V1GithubEvidenceService } from '../src/integrations/v1-github-evidence.service';
import { V1GithubEvidencePrismaRepository } from '../src/integrations/v1-github-evidence.prisma-repository';
import { assertCodeEvidenceAcceptable } from '../src/reviews/v1-review-code-evidence';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL artifact code evidence diagnostics', () => {
  let db: PrismaClient;
  let projectId: string,
    userId: string,
    outsiderId: string,
    roleId: string,
    instanceId: string,
    taskId: string,
    setId: string,
    artifactId: string;
  let repository: V1ArtifactPrismaRepository;
  let service: V1ArtifactService;
  let github: V1GithubEvidenceService;
  let principal: Principal;
  const sha = 'a'.repeat(40);
  const secret = 'isolated-diagnostics-webhook';
  const now = new Date();
  function context(body: Record<string, unknown> = {}) {
    return {
      idempotencyKey: randomUUID(),
      method: 'POST',
      route: `/projects/${projectId}/integrations/github/evidence`,
      body,
      requestId: randomUUID(),
      operationId: randomUUID(),
      now,
    };
  }

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    expect(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name,
    ).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@evidence.test`, passwordHash: 'fixture' },
      })
    ).id;
    outsiderId = (
      await db.user.create({
        data: { email: `${randomUUID()}@evidence.test`, passwordHash: 'fixture' },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { key: randomUUID().slice(0, 6), name: 'Code diagnostics', createdById: userId },
      })
    ).id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    roleId = (
      await db.projectRole.create({ data: { projectId, key: 'backend', title: 'Backend' } })
    ).id;
    await db.projectRoleAssignment.create({ data: { projectId, userId, roleId } });
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'CODE-1', title: 'Code evidence' },
    });
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: 'code-evidence' },
    });
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest: 'c'.repeat(64),
        definition: {},
        compiledRules: {},
      },
    });
    instanceId = (
      await db.workflowInstance.create({
        data: {
          projectId,
          definitionId: definition.id,
          definitionRevisionId: revision.id,
          requirementId: requirement.id,
        },
      })
    ).id;
    taskId = (
      await db.task.create({
        data: {
          projectId,
          workflowInstanceId: instanceId,
          stepKey: 'impl',
          roleId,
          responsibleUserId: userId,
        },
      })
    ).id;
    const stamp = await db.principalStamp.create({
      data: { projectId, userId, kind: 'HUMAN', scopeSnapshot: [], userAuthVersion: 1 },
    });
    setId = (
      await db.artifactSet.create({
        data: {
          projectId,
          taskId,
          taskGeneration: 1,
          snapshotId: randomUUID(),
          manifestDigest: 'b'.repeat(64),
          workflowDefinitionRevisionId: revision.id,
          localRunId: 'diagnostics',
          createdByStampId: stamp.id,
        },
      })
    ).id;
    const repo = await db.projectRepository.create({
      data: {
        projectId,
        adapter: 'GITHUB',
        externalId: 'provider-1',
        owner: 'team',
        name: 'source',
      },
    });
    artifactId = (
      await db.artifact.create({
        data: {
          projectId,
          taskId,
          artifactSetId: setId,
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/plain',
          byteLength: 0,
          sha256: 'd'.repeat(64),
          projectRepositoryId: repo.id,
          commitSha: sha,
          repoPath: 'src/index.ts',
          checks: [],
          submittedByStampId: stamp.id,
        },
      })
    ).id;
    const prisma = db as PrismaService;
    const authorization = new V1AuthorizationService(new V1AuthorizationPrismaRepository(prisma));
    const operations = new V1IdempotencyPrismaRepository(prisma);
    repository = new V1ArtifactPrismaRepository(prisma);
    service = new V1ArtifactService(
      repository,
      new V1TaskPrismaRepository(prisma),
      authorization,
      operations,
    );
    github = new V1GithubEvidenceService(
      new V1GithubEvidencePrismaRepository(prisma),
      authorization,
      operations,
      secret,
      'e'.repeat(64),
    );
    principal = { kind: 'HUMAN', userId, scopes: [] };
  });
  beforeEach(async () => {
    await db.codeReviewEvidence.deleteMany({ where: { projectId } });
    await db.webhookReceipt.deleteMany({ where: { projectId } });
    await db.idempotentOperation.deleteMany({ where: { projectId } });
    await db.task.update({
      where: { id: taskId },
      data: { generation: 1, currentArtifactSetId: setId },
    });
    await db.workflowInstance.update({ where: { id: instanceId }, data: { retiredAt: null } });
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { revokedAt: null },
    });
  });
  async function receive(
    head = sha,
    reviewerKind: 'USER' | 'BOT' = 'USER',
    state: 'APPROVED' | 'CHANGES_REQUESTED' = 'APPROVED',
  ) {
    const repositories = [
      {
        repositoryId: 'provider-1',
        changeRequestId: '10',
        changeRequestHeadSha: head,
        authorExternalId: 'author',
        merged: true,
        artifactCommitSha: head,
        reviews: [
          {
            reviewerId: 'reviewer',
            reviewerKind,
            state,
            commitSha: head,
            submittedAt: now.toISOString(),
            reviewId: randomUUID(),
          },
        ],
      },
    ];
    const rawBody = Buffer.from(JSON.stringify({ repositories }));
    return github.receiveWebhook(
      principal,
      projectId,
      {
        eventType: 'pull_request',
        deliveryId: randomUUID(),
        rawBody,
        signatureHeader: `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`,
        repositories,
      },
      context({ repositories }),
    );
  }
  async function prepare(head = sha) {
    const input = {
      artifactSetId: setId,
      repositoryId: 'provider-1',
      changeRequestId: '10',
      headSha: head,
      generation: 1,
    };
    return github.prepareCodeEvidence(principal, projectId, input, context(input));
  }
  async function inspect() {
    const result = await service.getArtifactSet(principal, setId);
    expect(JSON.stringify(result.codeReview?.diagnostics)).not.toMatch(
      /preparedSecretHash|encryptedSecret|payloadDigest|errorMessage/,
    );
    return result.codeReview!.diagnostics!;
  }

  it('rejects bad signatures before receipt and does not invent an attributable delivery', async () => {
    await expect(
      github.receiveWebhook(
        principal,
        projectId,
        {
          eventType: 'pull_request',
          deliveryId: randomUUID(),
          rawBody: Buffer.from('{}'),
          signatureHeader: `sha256=${'0'.repeat(64)}`,
          repositories: [],
        },
        context(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.webhookReceipt.count({ where: { projectId } })).toBe(0);
    expect((await inspect()).references[0]).toMatchObject({
      status: 'NO_ASSOCIATED_DELIVERY',
      deliveries: [],
    });
  });
  it('shows signed invalid processing and bot reasons separately from signature failure', async () => {
    const received = await receive(sha, 'BOT');
    expect(received.decision).toBe('INVALID');
    expect((await inspect()).references[0]).toMatchObject({
      status: 'REVIEW_NOT_QUALIFYING',
      deliveries: [{ signatureValid: true, status: 'EVIDENCE_INVALID' }],
      reviews: [{ reasons: expect.arrayContaining(['BOT_REVIEW', 'DELIVERY_NOT_PROCESSED']) }],
    });
  });
  it('follows prepare, expiration, consumption and replay through the actual services', async () => {
    await receive();
    expect((await inspect()).references[0].status).toBe('TICKET_MISSING');
    const ticket = await prepare();
    expect((await inspect()).references[0].status).toBe('TICKET_LIVE');
    await db.codeReviewEvidence.update({
      where: { id: ticket.ticketId },
      data: { preparedExpiresAt: new Date(Date.now() - 1000) },
    });
    expect((await inspect()).references[0].status).toBe('TICKET_EXPIRED');
    await db.codeReviewEvidence.update({
      where: { id: ticket.ticketId },
      data: { preparedExpiresAt: ticket.expiresAt },
    });
    const input = {
      ticketId: ticket.ticketId,
      secret: ticket.secret,
      artifactSetId: setId,
      headSha: sha,
      generation: 1,
    };
    await github.useVersionedTicket(principal, projectId, input, { now });
    expect((await inspect()).references[0]).toMatchObject({
      status: 'BOUND',
      tickets: [{ state: 'CONSUMED', matchesReference: true, matchesGeneration: true }],
    });
    await expect(
      github.useVersionedTicket(principal, projectId, input, { now }),
    ).rejects.toMatchObject({ status: 409 });
    await db.task.update({ where: { id: taskId }, data: { generation: 2 } });
    expect(await inspect()).toMatchObject({
      currentBinding: 'HISTORICAL',
      references: [{ status: 'HISTORICAL', tickets: [{ matchesGeneration: false }] }],
    });
    await db.workflowInstance.update({ where: { id: instanceId }, data: { retiredAt: now } });
    expect((await inspect()).currentBinding).toBe('INACTIVE');
  });
  it('does not disclose diagnostics to another project principal or revoked member', async () => {
    await receive();
    expect(await repository.findCodeReviewDiagnostics(randomUUID(), setId)).toBeNull();
    await expect(
      service.getArtifactSet({ kind: 'HUMAN', userId: outsiderId, scopes: [] }, setId),
    ).rejects.toMatchObject({ status: 404 });
    const wrongProject: Principal = {
      kind: 'AGENT',
      userId,
      projectId: randomUUID(),
      agentCredentialId: randomUUID(),
      roleIds: [roleId],
      scopes: [],
    };
    await expect(service.getArtifactSet(wrongProject, setId)).rejects.toMatchObject({
      status: 404,
    });
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { revokedAt: now },
    });
    await expect(service.getArtifactSet(principal, setId)).rejects.toMatchObject({ status: 404 });
  });
  it('rejects the original other-SHA preparation and legacy mismatched consumed-ticket bypass', async () => {
    const wrongSha = 'f'.repeat(40);
    const received = await receive(wrongSha);
    // Original pre-fix reproduction: prepare(wrongSha) → use(wrongSha) → gate accepted SHA a.
    await expect(prepare(wrongSha)).rejects.toMatchObject({
      status: 409,
      message: 'CODE_EVIDENCE_TARGET_MISMATCH',
    });
    expect(await db.codeReviewEvidence.count({ where: { projectId, artifactSetId: setId } })).toBe(
      0,
    );
    // A previously issued/consumed malformed ticket must also fail the final gate.
    await db.codeReviewEvidence.create({
      data: {
        projectId,
        artifactSetId: setId,
        repositoryId: 'provider-1',
        changeRequestId: '10',
        headSha: wrongSha,
        commitSha: wrongSha,
        authorExternalId: '_ticket',
        reviewerExternalId: '_ticket',
        reviewerKind: 'USER',
        state: 'PENDING',
        reviewExternalId: randomUUID(),
        evidenceFingerprint: '0'.repeat(64),
        preparedSecretHash: '1'.repeat(64),
        preparedExpiresAt: null,
        preparedEvidenceId: received.evidenceIds[0],
        ticketGeneration: 1,
      },
    });
    await expect(
      assertCodeEvidenceAcceptable({ tx: db as any, projectId, artifactSetId: setId, taskId }),
    ).rejects.toMatchObject({ status: 422, message: 'CODE_REVIEW_EVIDENCE_MISSING' });
    const actual = await service.getArtifactSet(principal, setId);
    expect(actual.codeReview?.acceptable).toBe(false);
    expect(actual.codeReview?.diagnostics?.references[0]).toMatchObject({
      artifactId,
      commitSha: sha,
      status: 'SHA_MISMATCH',
      reviews: [{ headSha: wrongSha }],
      tickets: [{ state: 'CONSUMED', matchesReference: false }],
    });
  });
  it('rechecks current generation and opinions when consuming a previously valid ticket', async () => {
    await receive();
    const ticket = await prepare();
    const input = {
      ticketId: ticket.ticketId,
      secret: ticket.secret,
      artifactSetId: setId,
      headSha: sha,
      generation: 1,
    };
    await db.task.update({ where: { id: taskId }, data: { generation: 2 } });
    await expect(
      github.useVersionedTicket(principal, projectId, input, { now }),
    ).rejects.toMatchObject({ status: 409 });
    await db.task.update({ where: { id: taskId }, data: { generation: 1 } });
    await receive(sha, 'USER', 'CHANGES_REQUESTED');
    await expect(
      github.useVersionedTicket(principal, projectId, input, { now }),
    ).rejects.toMatchObject({ status: 422 });
    expect(
      (await db.codeReviewEvidence.findUniqueOrThrow({ where: { id: ticket.ticketId } }))
        .preparedExpiresAt,
    ).not.toBeNull();
  });
  it('requires separate bindings for multiple code SHAs and refuses unregistered repository targets', async () => {
    await receive();
    const ticket = await prepare();
    await github.useVersionedTicket(
      principal,
      projectId,
      {
        ticketId: ticket.ticketId,
        secret: ticket.secret,
        artifactSetId: setId,
        headSha: sha,
        generation: 1,
      },
      { now },
    );
    const source = await db.artifact.findUniqueOrThrow({ where: { id: artifactId } });
    const second = await db.artifact.create({
      data: { ...source, id: randomUUID(), commitSha: 'b'.repeat(40), repoPath: 'src/second.ts' },
    });
    try {
      expect((await service.getArtifactSet(principal, setId)).codeReview?.acceptable).toBe(false);
      await expect(
        assertCodeEvidenceAcceptable({ tx: db as any, projectId, artifactSetId: setId, taskId }),
      ).rejects.toMatchObject({ status: 422 });
      await expect(
        github.prepareCodeEvidence(
          principal,
          projectId,
          {
            artifactSetId: setId,
            generation: 1,
            repositoryId: 'other-repo',
            changeRequestId: '10',
            headSha: sha,
          },
          context(),
        ),
      ).rejects.toMatchObject({ status: 409 });
    } finally {
      await db.artifact.delete({ where: { id: second.id } });
    }
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        const where = { projectId };
        await db.codeReviewEvidence.deleteMany({ where });
        await db.webhookReceipt.deleteMany({ where });
        await db.idempotentOperation.deleteMany({ where });
        await db.artifact.deleteMany({ where });
        await db.artifactSet.deleteMany({ where });
        await db.task.deleteMany({ where });
        await db.workflowInstance.deleteMany({ where });
        await db.workflowRevision.deleteMany({ where });
        await db.workflowDefinition.deleteMany({ where });
        await db.requirement.deleteMany({ where });
        await db.projectRepository.deleteMany({ where });
        await db.principalStamp.deleteMany({ where });
        await db.projectRoleAssignment.deleteMany({ where });
        await db.projectRole.deleteMany({ where });
        await db.projectMember.deleteMany({ where });
        await db.project.delete({ where: { id: projectId } });
      }
      await db.user.deleteMany({ where: { id: { in: [userId, outsiderId].filter(Boolean) } } });
    } finally {
      await db.$disconnect();
    }
  });
});
