import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { ChangeRequestsService } from '../src/changes/change-requests.service';
import { V1GithubEvidencePrismaRepository } from '../src/integrations/v1-github-evidence.prisma-repository';
import type {
  V1PersistIdempotencyInput,
  V1RecordEvidenceInput,
} from '../src/integrations/v1-github-evidence.repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;

suite('PostgreSQL decision and webhook consistency', () => {
  let db: PrismaClient;
  let service: ChangeRequestsService;
  let repository: V1GithubEvidencePrismaRepository;
  let projectId: string;
  let userId: string;
  let requirementId: string;
  const constraint = `recipient_failure_${randomUUID().replaceAll('-', '')}`;

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);
    const user = await db.user.create({
      data: { email: `${randomUUID()}@consistency.test`, passwordHash: 'fixture' },
    });
    userId = user.id;
    const project = await db.project.create({
      data: {
        key: randomUUID().replaceAll('-', '').slice(0, 6),
        name: 'Consistency fixture',
        createdById: userId,
      },
    });
    projectId = project.id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'CONS-001', title: 'Concurrent decisions' },
    });
    requirementId = requirement.id;
    service = new ChangeRequestsService(db as PrismaService);
    repository = new V1GithubEvidencePrismaRepository(db as PrismaService);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.$executeRawUnsafe(
        `ALTER TABLE workmesh_v1."ChangeRecipient" DROP CONSTRAINT IF EXISTS "${constraint}"`,
      );
      if (projectId) {
        await db.changeRecipient.deleteMany({ where: { projectId } });
        await db.changeEvent.deleteMany({ where: { projectId } });
        await db.changeRequest.deleteMany({ where: { projectId } });
        await db.codeReviewEvidence.deleteMany({ where: { projectId } });
        await db.webhookReceipt.deleteMany({ where: { projectId } });
        await db.idempotentOperation.deleteMany({ where: { projectId } });
        await db.requirement.deleteMany({ where: { projectId } });
        await db.projectMember.deleteMany({ where: { projectId } });
        await db.project.delete({ where: { id: projectId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });

  async function change() {
    return service.create(projectId, userId, {
      requirementId,
      affected: ['ACCEPTANCE'],
      acceptanceKeys: ['A1'],
      reason: 'Database consistency test',
    });
  }

  it('allows exactly one of eight simultaneous acceptances and emits one event', async () => {
    const proposed = await change();
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        service.decide(projectId, userId, proposed.id, { decision: 'ACCEPTED' }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ status: 409, message: 'CHANGE_ALREADY_DECIDED' });
    const events = await db.changeEvent.findMany({ where: { sourceId: proposed.id } });
    expect(events).toHaveLength(1);
    expect(await db.changeRecipient.count({ where: { eventId: events[0].id } })).toBe(1);
  });

  it('does not overwrite an accepted or rejected result when decisions race', async () => {
    const proposed = await change();
    const results = await Promise.allSettled([
      service.decide(projectId, userId, proposed.id, { decision: 'ACCEPTED' }),
      service.decide(projectId, userId, proposed.id, { decision: 'REJECTED' }),
    ]);
    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const stored = await db.changeRequest.findUniqueOrThrow({ where: { id: proposed.id } });
    expect(stored.decision).toBe(
      winners[0].status === 'fulfilled' ? winners[0].value.decision : '',
    );
    expect(await db.changeEvent.count({ where: { sourceId: proposed.id } })).toBe(
      stored.decision === 'ACCEPTED' ? 1 : 0,
    );
  });

  it('rolls back decision and event on a real recipient database failure, then retries', async () => {
    const proposed = await change();
    await db.$executeRawUnsafe(
      `ALTER TABLE workmesh_v1."ChangeRecipient" ADD CONSTRAINT "${constraint}" CHECK ("projectId" <> '${projectId}'::uuid) NOT VALID`,
    );
    try {
      await expect(
        service.decide(projectId, userId, proposed.id, { decision: 'ACCEPTED' }),
      ).rejects.toThrow();
      expect(await db.changeRequest.findUnique({ where: { id: proposed.id } })).toMatchObject({
        decision: 'PENDING',
        decidedAt: null,
        appliedAt: null,
      });
      expect(await db.changeEvent.count({ where: { sourceId: proposed.id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `ALTER TABLE workmesh_v1."ChangeRecipient" DROP CONSTRAINT "${constraint}"`,
      );
    }
    await expect(
      service.decide(projectId, userId, proposed.id, { decision: 'ACCEPTED' }),
    ).resolves.toMatchObject({ decision: 'ACCEPTED' });
  });

  async function receipt() {
    const input = {
      projectId,
      source: 'GITHUB' as const,
      deliveryId: randomUUID(),
      eventType: 'pull_request_review',
      signatureValid: true,
      payloadDigest: 'a'.repeat(64),
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repository.recordReceipt(input)),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    return results[0];
  }

  it('deduplicates twelve concurrent receipt and evidence writes in PostgreSQL', async () => {
    const recorded = await receipt();
    const input: V1RecordEvidenceInput = {
      projectId,
      repositoryId: 'GITHUB:fixture',
      changeRequestId: randomUUID(),
      headSha: 'a'.repeat(40),
      authorExternalId: 'author',
      reviewerExternalId: 'reviewer',
      reviewerKind: 'USER',
      state: 'APPROVED',
      commitSha: 'a'.repeat(40),
      submittedAt: new Date(),
      reviewExternalId: randomUUID(),
      artifactSetId: null,
      evidenceFingerprint: randomUUID().replaceAll('-', '').repeat(2),
      receiptId: recorded.id,
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => repository.recordEvidence(input)),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(await repository.findEvidenceIdsByReceipt(recorded.id)).toEqual([results[0].id]);
    expect(await repository.findEvidenceByFingerprint(input.evidenceFingerprint)).toMatchObject({
      id: results[0].id,
    });
  });

  it('consumes a ticket exactly once and rejects wrong-project and expired consumption', async () => {
    const now = new Date();
    const ticket = await db.codeReviewEvidence.create({
      data: {
        projectId,
        repositoryId: 'repo-test',
        changeRequestId: 'change-test',
        headSha: 'a'.repeat(40),
        authorExternalId: '_ticket',
        reviewerExternalId: '_ticket',
        reviewerKind: 'USER',
        state: 'PENDING',
        submittedAt: now,
        reviewExternalId: randomUUID(),
        evidenceFingerprint: randomUUID(),
        preparedExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
    expect(await repository.consumeVersionedTicket(ticket.id, randomUUID(), now)).toBe(false);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repository.consumeVersionedTicket(ticket.id, projectId, now)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repository.consumeVersionedTicket(ticket.id, projectId, now)).toBe(false);
    await db.codeReviewEvidence.update({
      where: { id: ticket.id },
      data: { preparedExpiresAt: now },
    });
    expect(await repository.consumeVersionedTicket(ticket.id, projectId, now)).toBe(false);
  });

  it('atomically commits receipt completion and idempotency or leaves both uncommitted', async () => {
    const recorded = await receipt();
    const operation: V1PersistIdempotencyInput = {
      id: randomUUID(),
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: `user:${userId}`,
      key: randomUUID(),
      method: 'POST',
      route: '/api/v1/integrations/github/webhooks',
      requestDigest: 'b'.repeat(64),
      resultRefs: { receiptId: recorded.id },
      now: new Date(),
    };
    await expect(
      repository.completeReceipt(recorded.id, 'x'.repeat(40), null, operation),
    ).rejects.toThrow();
    expect(await db.idempotentOperation.findUnique({ where: { id: operation.id } })).toBeNull();
    expect(await repository.findReceiptByDelivery('GITHUB', recorded.deliveryId)).toMatchObject({
      status: 'PENDING',
      processedAt: null,
    });
    await repository.completeReceipt(recorded.id, 'PROCESSED', null, operation);
    expect(await db.idempotentOperation.findUnique({ where: { id: operation.id } })).not.toBeNull();
    expect(await repository.findReceiptByDelivery('GITHUB', recorded.deliveryId)).toMatchObject({
      status: 'PROCESSED',
    });
  });
});
