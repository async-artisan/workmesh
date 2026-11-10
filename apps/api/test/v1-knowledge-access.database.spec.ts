import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { V1KnowledgeBasePrismaRepository } from '../src/knowledge/v1-knowledge-base.prisma-repository';
import { V1PublicationPrismaRepository } from '../src/knowledge/v1-publication.prisma-repository';
import { V1ReviewPrismaRepository } from '../src/reviews/v1-review.prisma-repository';
import type { V1CommitDecisionInput } from '../src/reviews/v1-review.repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL knowledge access and published search', () => {
  let db: PrismaClient;
  let repository: V1KnowledgeBasePrismaRepository;
  let projectId: string;
  let userId: string;
  let sessionId: string;
  const hash = () => createHash('sha256').update(randomUUID()).digest('hex');

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(rows[0].name).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@knowledge.test`, passwordHash: 'fixture' },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { key: randomUUID().slice(0, 6), name: 'Knowledge fixture', createdById: userId },
      })
    ).id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    sessionId = (
      await db.webSession.create({
        data: {
          userId,
          tokenHash: hash(),
          csrfTokenHash: hash(),
          userAuthVersion: 1,
          idleExpiresAt: new Date(Date.now() + 3600000),
          expiresAt: new Date(Date.now() + 3600000),
        },
      })
    ).id;
    repository = new V1KnowledgeBasePrismaRepository(db as PrismaService);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        await db.idempotentOperation.deleteMany({ where: { projectId } });
        await db.auditEvent.deleteMany({ where: { projectId } });
        await db.reviewDecisionRevocation.deleteMany({ where: { projectId } });
        await db.reviewDecision.deleteMany({ where: { projectId } });
        await db.confirmationTicket.deleteMany({ where: { projectId } });
        await db.approvalSlot.deleteMany({ where: { projectId } });
        await db.reviewRequest.deleteMany({ where: { projectId } });
        await db.documentPublication.deleteMany({ where: { projectId } });
        await db.principalStamp.deleteMany({ where: { projectId } });
        await db.documentRevision.deleteMany({ where: { projectId } });
        await db.knowledgeDocument.deleteMany({ where: { projectId } });
        await db.knowledgeBaseGrant.deleteMany({ where: { projectId } });
        await db.knowledgeBase.deleteMany({ where: { projectId } });
        await db.projectMember.deleteMany({ where: { projectId } });
        await db.project.delete({ where: { id: projectId } });
      }
      if (userId) {
        await db.webSession.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
    } finally {
      await db.$disconnect();
    }
  });
  function operation() {
    return {
      id: randomUUID(),
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: `user:${userId}`,
      key: randomUUID(),
      method: 'POST',
      route: '/knowledge-bases',
      requestDigest: hash(),
    };
  }
  function create(op = operation(), key = randomUUID()) {
    return repository.createKnowledgeBase({
      projectId,
      key,
      name: 'Knowledge',
      visibility: 'RESTRICTED',
      creatorUserId: userId,
      now: new Date(),
      operation: op,
    });
  }
  async function access(knowledgeBaseId: string) {
    const secretHash = hash();
    const ticket = await db.confirmationTicket.create({
      data: {
        secretHash,
        userId,
        webSessionId: sessionId,
        projectId,
        userAuthVersion: 1,
        action: 'KB_ACCESS_REPLACE',
        targetType: 'KNOWLEDGE_BASE',
        targetId: knowledgeBaseId,
        expectedVersion: 1,
        actionDigest: hash(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return {
      knowledgeBaseId,
      expectedVersion: 1,
      expectedAuthzVersion: 1,
      visibility: 'PROJECT' as const,
      publicationApproverUserId: userId,
      publicationApproverRoleId: null,
      grants: [
        {
          subjectKind: 'USER' as const,
          subjectUserId: userId,
          subjectRoleId: null,
          permissions: ['READ' as const],
        },
      ],
      reason: 'Replace access',
      actorUserId: userId,
      ticket: { id: ticket.id, secretHash, webSessionId: sessionId },
      operation: operation(),
      now: new Date(),
    };
  }

  it('creates the owner grant, audit and operation together; duplicate keys do not create partial records', async () => {
    const op = operation();
    const kb = await create(op);
    expect(await repository.listAccessGrants(kb.id)).toMatchObject([
      { subjectUserId: userId, permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'] },
    ]);
    expect(await db.auditEvent.count({ where: { targetId: kb.id } })).toBe(1);
    const key = randomUUID();
    await expect(create(op, key)).rejects.toMatchObject({ message: 'IDEMPOTENCY_CONFLICT' });
    expect(await db.knowledgeBase.count({ where: { projectId, key } })).toBe(0);
    await expect(create(operation(), kb.key)).rejects.toMatchObject({
      message: 'KNOWLEDGE_BASE_KEY_CONFLICT',
    });
  });

  it('replaces grants, increments both versions and consumes a confirmation only once', async () => {
    const kb = await create();
    const input = await access(kb.id);
    const results = await Promise.allSettled([
      repository.replaceAccess(input),
      repository.replaceAccess({ ...input, operation: operation() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.findKnowledgeBase(kb.id)).toMatchObject({
      visibility: 'PROJECT',
      version: 2,
      authzVersion: 2,
    });
    const grants = await repository.listAccessGrants(kb.id);
    expect(grants.filter((grant) => grant.revokedAt === null)).toHaveLength(1);
    expect(grants.filter((grant) => grant.revokedAt !== null)).toHaveLength(1);
    const consumed = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: input.ticket.id },
    });
    expect(consumed).toMatchObject({
      consumedAt: expect.any(Date),
      consumedOperationId: expect.any(String),
    });
    expect(
      await db.idempotentOperation.findUnique({ where: { id: consumed.consumedOperationId! } }),
    ).not.toBeNull();
    expect(
      await db.auditEvent.count({ where: { targetId: kb.id, action: 'KB_ACCESS_REPLACE' } }),
    ).toBe(1);
  });

  it('rolls back grants and versions for an invalid confirmation and an operation write failure', async () => {
    const kb = await create();
    const input = await access(kb.id);
    await expect(
      repository.replaceAccess({ ...input, ticket: { ...input.ticket, secretHash: hash() } }),
    ).rejects.toMatchObject({ message: 'CONFIRMATION_CONSUME_CONFLICT' });
    const op = operation();
    await create(op);
    await expect(repository.replaceAccess({ ...input, operation: op })).rejects.toMatchObject({
      message: 'IDEMPOTENCY_CONFLICT',
    });
    expect(await repository.findKnowledgeBase(kb.id)).toMatchObject({
      visibility: 'RESTRICTED',
      version: 1,
      authzVersion: 1,
    });
    expect(await repository.listAccessGrants(kb.id)).toMatchObject([
      { revokedAt: null, version: 1 },
    ]);
    expect(
      await db.confirmationTicket.findUnique({ where: { id: input.ticket.id } }),
    ).toMatchObject({ consumedAt: null });
  });

  it('binds list pagination to project, actor and management context', async () => {
    await create();
    await create();
    const query = { limit: 1, cursor: null, management: true, principalUserId: userId };
    const first = await repository.listKnowledgeBases(projectId, query);
    expect(first.hasMore).toBe(true);
    const second = await repository.listKnowledgeBases(projectId, {
      ...query,
      cursor: first.nextCursor,
    });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    for (const changed of [{ management: false }, { principalUserId: randomUUID() }]) {
      await expect(
        repository.listKnowledgeBases(projectId, {
          ...query,
          ...changed,
          cursor: first.nextCursor,
        }),
      ).rejects.toMatchObject({ message: 'CURSOR_INVALID' });
    }
    await expect(
      repository.listKnowledgeBases(randomUUID(), { ...query, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ message: 'CURSOR_INVALID' });
  });

  it('searches only published, non-archived revisions and binds search cursors', async () => {
    const kb = await create();
    for (const state of ['published', 'published', 'draft', 'archived']) {
      const document = await db.knowledgeDocument.create({
        data: { projectId, knowledgeBaseId: kb.id, kind: 'KNOWLEDGE' },
      });
      const bodyBytes = Buffer.from(`searchable ${state} body`);
      const revision = await db.documentRevision.create({
        data: {
          projectId,
          documentId: document.id,
          seq: 1,
          title: `searchable ${state}`,
          mimeType: 'text/plain',
          bodyBytes,
          byteLength: bodyBytes.length,
          sha256: hash(),
          createdById: userId,
        },
      });
      await db.knowledgeDocument.update({
        where: { id: document.id },
        data: {
          currentPublishedRevisionId: state === 'draft' ? null : revision.id,
          archivedAt: state === 'archived' ? new Date() : null,
        },
      });
    }
    const input = { knowledgeBaseId: kb.id, q: 'searchable', limit: 1, cursor: null };
    const first = await repository.searchKnowledgeBase(input);
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const second = await repository.searchKnowledgeBase({ ...input, cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items[0].documentId).not.toBe(first.items[0].documentId);
    expect(
      [...first.items, ...second.items].every((item) => item.title === 'searchable published'),
    ).toBe(true);
    await expect(
      repository.searchKnowledgeBase({ ...input, q: 'changed', cursor: first.nextCursor }),
    ).rejects.toMatchObject({ message: 'CURSOR_INVALID' });
    expect((await repository.searchKnowledgeBase({ ...input, q: 'absent' })).items).toEqual([]);
  });

  it('refuses revoked project membership and returns absent lookup results safely', async () => {
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { revokedAt: new Date() },
    });
    try {
      await expect(create()).rejects.toMatchObject({ message: 'PROJECT_NOT_FOUND' });
    } finally {
      await db.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { revokedAt: null },
      });
    }
    expect(await repository.findMember(projectId, userId)).toMatchObject({
      role: 'OWNER',
      revokedAt: null,
    });
    expect(await repository.findMember(projectId, randomUUID())).toBeNull();
    expect(await repository.findKnowledgeBase(randomUUID())).toBeNull();
    expect(await repository.findProjectRoles(projectId, [])).toEqual([]);
    expect(await repository.findProjectRoles(projectId, [randomUUID()])).toEqual([]);
  });

  async function documentReview() {
    const kb = await create();
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId: kb.id, kind: 'KNOWLEDGE' },
    });
    const bodyBytes = Buffer.from('reviewed knowledge');
    const revision = await db.documentRevision.create({
      data: {
        projectId,
        documentId: document.id,
        seq: 1,
        title: 'Reviewed knowledge',
        mimeType: 'text/plain',
        bodyBytes,
        byteLength: bodyBytes.length,
        sha256: hash(),
        createdById: userId,
      },
    });
    const reviews = new V1ReviewPrismaRepository(db as PrismaService);
    const op = operation();
    const input = {
      projectId,
      subject: { kind: 'DOCUMENT_REVISION' as const, id: revision.id },
      expectedVersion: 1,
      taskId: null,
      actor: {
        kind: 'HUMAN' as const,
        userId,
        webSessionId: sessionId,
        agentCredentialId: null,
        roleId: null,
        scopeSnapshot: [],
        userAuthVersion: 1,
      },
      operation: { ...op, now: new Date() },
    };
    return { kb, document, revision, reviews, input };
  }

  it('matches single reviewer checks in PostgreSQL across reviews, slots, statuses and users', async () => {
    const { document, revision } = await documentReview();
    const role = await db.projectRole.create({
      data: { projectId, key: `test-${randomUUID()}`, title: 'Reviewer fixture' },
    });
    try {
      const bodyBytes = Buffer.from('reviewer batch fixture');
      const others = await Promise.all(
        [2, 3, 4].map((seq) =>
          db.documentRevision.create({
            data: {
              projectId,
              documentId: document.id,
              seq,
              title: `Review fixture ${seq}`,
              mimeType: 'text/plain',
              bodyBytes,
              byteLength: bodyBytes.length,
              sha256: hash(),
              createdById: userId,
            },
          }),
        ),
      );
      const [otherUser, unassignedUser] = [randomUUID(), randomUUID()];
      // A real second user is needed only when an approval slot references it.
      const secondUser = await db.user.create({
        data: { id: otherUser, email: `${randomUUID()}@knowledge.test`, passwordHash: 'fixture' },
      });
      try {
        const reviewData = [
          { revisionId: revision.id, status: 'OPEN' as const, users: [secondUser.id] },
          { revisionId: revision.id, status: 'APPROVED' as const, users: [userId, userId] },
          { revisionId: others[0]!.id, status: 'REJECTED' as const, users: [secondUser.id] },
          { revisionId: others[1]!.id, status: 'INVALIDATED' as const, users: [] },
        ];
        for (const entry of reviewData) {
          const review = await db.reviewRequest.create({
            data: {
              projectId,
              kind: 'KNOWLEDGE_PUBLICATION',
              documentRevisionId: entry.revisionId,
              status: entry.status,
              subjectDigest: hash(),
            },
          });
          for (const [index, assignedUser] of entry.users.entries()) {
            await db.approvalSlot.create({
              data: {
                projectId,
                reviewRequestId: review.id,
                slotKey: `user-${index}`,
                kind: 'APPROVAL',
                requiredUserId: assignedUser,
              },
            });
          }
          await db.approvalSlot.create({
            data: {
              projectId,
              reviewRequestId: review.id,
              slotKey: 'role-only',
              kind: 'APPROVAL',
              requiredRoleId: role.id,
            },
          });
        }

        const publications = new V1PublicationPrismaRepository(db as PrismaService);
        const ids = [revision.id, ...others.map((item) => item.id)];
        for (const [candidateUser, expected] of [
          [userId, [revision.id]],
          [secondUser.id, [revision.id, others[0]!.id]],
          [unassignedUser, []],
        ] as const) {
          const actual = await publications.listAssignedReviewerRevisionIds(ids, candidateUser);
          const individual: string[] = [];
          for (const id of ids) {
            if (await publications.isAssignedReviewer(id, candidateUser)) individual.push(id);
          }
          expect(new Set(actual)).toEqual(new Set(expected));
          expect(new Set(actual)).toEqual(new Set(individual));
        }
      } finally {
        await db.approvalSlot.deleteMany({ where: { projectId, requiredUserId: otherUser } });
        await db.user.delete({ where: { id: secondUser.id } });
      }
    } finally {
      await db.approvalSlot.deleteMany({ where: { projectId, requiredRoleId: role.id } });
      await db.projectRole.delete({ where: { id: role.id } });
    }
  });

  async function confirmation(targetId: string) {
    const secretHash = hash();
    const ticket = await db.confirmationTicket.create({
      data: {
        secretHash,
        userId,
        webSessionId: sessionId,
        projectId,
        userAuthVersion: 1,
        action: 'REVIEW_DECIDE',
        targetType: 'REVIEW_REQUEST',
        targetId,
        expectedVersion: 1,
        actionDigest: hash(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return { id: ticket.id, secretHash, webSessionId: sessionId };
  }

  it('creates a derived document review once under concurrent requests and hides cross-project subjects', async () => {
    const { input, reviews, revision } = await documentReview();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        reviews.createReviewRequest({ ...input, operation: { ...operation(), now: new Date() } }),
      ),
    );
    expect(new Set(results.map((result) => result.review.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(results[0].review).toMatchObject({
      kind: 'KNOWLEDGE_PUBLICATION',
      slots: [{ requiredUserId: userId }],
    });
    expect(await reviews.findDocumentReviewSubject(revision.id)).toMatchObject({
      projectId,
      documentKind: 'KNOWLEDGE',
      archived: false,
    });
    await expect(
      reviews.createReviewRequest({
        ...input,
        projectId: randomUUID(),
        operation: { ...operation(), now: new Date() },
      }),
    ).rejects.toMatchObject({ message: 'REVIEW_SUBJECT_NOT_FOUND' });
    await expect(
      reviews.createReviewRequest({ ...input, expectedVersion: 0 }),
    ).rejects.toMatchObject({ message: 'VERSION_CONFLICT' });
  });

  it('publishes through a decision and withdraws the current publication through a separately confirmed revocation', async () => {
    const { input, reviews, document, revision, kb } = await documentReview();
    const created = await reviews.createReviewRequest(input);
    const op = operation();
    const decide: V1CommitDecisionInput = {
      reviewId: created.review.id,
      expectedVersion: 1,
      slotId: created.review.slots[0].id,
      decision: 'APPROVE',
      subjectDigest: revision.sha256,
      comment: null,
      actorUserId: userId,
      roleSlot: null,
      operationId: op.id,
      ticket: await confirmation(created.review.id),
      principalScopeKey: op.principalScopeKey,
      projectScopeKey: op.projectScopeKey,
      operationKey: op.key,
      method: op.method,
      route: op.route,
      requestDigest: op.requestDigest,
      now: new Date(),
    };
    const result = await reviews.commitDecision(decide);
    expect(result.subjectResult).toMatchObject({ kind: 'PUBLISHED' });
    expect(
      (await db.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } }))
        .currentPublishedRevisionId,
    ).toBe(revision.id);
    expect(
      (
        await repository.searchKnowledgeBase({
          knowledgeBaseId: kb.id,
          q: 'reviewed',
          limit: 10,
          cursor: null,
        })
      ).items,
    ).toHaveLength(1);
    const revoke = {
      ...decide,
      decisionId: result.decisionId,
      expectedVersion: result.review.version,
      reason: 'Knowledge withdrawn',
      operationId: randomUUID(),
      operationKey: randomUUID(),
      ticket: await confirmation(result.decisionId),
    };
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(reviews.revokeDecision({ ...revoke, operationId: previous.id })).rejects.toThrow();
    expect(
      (await db.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } }))
        .currentPublishedRevisionId,
    ).toBe(revision.id);
    expect(
      (await db.confirmationTicket.findUniqueOrThrow({ where: { id: revoke.ticket.id } }))
        .consumedAt,
    ).toBeNull();
    await reviews.revokeDecision(revoke);
    expect(
      (await db.knowledgeDocument.findUniqueOrThrow({ where: { id: document.id } }))
        .currentPublishedRevisionId,
    ).toBeNull();
    expect(await db.documentPublication.count({ where: { documentId: document.id } })).toBe(2);
    expect(
      (
        await repository.searchKnowledgeBase({
          knowledgeBaseId: kb.id,
          q: 'reviewed',
          limit: 10,
          cursor: null,
        })
      ).items,
    ).toEqual([]);
    expect(await reviews.findDecisionContext(result.decisionId)).toMatchObject({ revoked: true });
  });
});
