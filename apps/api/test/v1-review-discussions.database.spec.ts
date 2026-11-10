import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import type { PrismaService } from '../src/prisma/prisma.service';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../src/auth/v1-policy';
import { V1ReviewService } from '../src/reviews/v1-review.service';
import { V1ReviewPrismaRepository } from '../src/reviews/v1-review.prisma-repository';
import {
  V1ReviewDiscussionService,
  type DiscussionMutation,
} from '../src/reviews/v1-review-discussion.service';
import type { V1ConfirmationRepository } from '../src/auth/v1-confirmation';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

suite('PostgreSQL review discussions', () => {
  let db: PrismaClient;
  let service: V1ReviewDiscussionService;
  let reviews: V1ReviewService;
  let projectId: string;
  let roleId: string;
  let knowledgeBaseId: string;
  const userIds: string[] = [];
  let author: V1Principal;
  let reviewer: V1Principal;
  let admin: V1Principal;
  let contributor: V1Principal;
  let outsider: V1Principal;
  let agent: V1Principal;
  let firstReviewId: string;
  let secondReviewId: string;
  let unrelatedReviewId: string;

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    expect(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name,
    ).toBe(target.database);
    const prisma = db as PrismaService;
    const authorization = new V1AuthorizationService(new V1AuthorizationPrismaRepository(prisma));
    reviews = new V1ReviewService(
      new V1ReviewPrismaRepository(prisma),
      authorization,
      {} as V1ConfirmationRepository,
      new V1IdempotencyPrismaRepository(prisma),
    );
    service = new V1ReviewDiscussionService(prisma, reviews, authorization);
    async function human() {
      const user = await db.user.create({
        data: { email: `${randomUUID()}@discussion.test`, passwordHash: 'fixture' },
      });
      userIds.push(user.id);
      const session = await db.webSession.create({
        data: {
          userId: user.id,
          tokenHash: hash(randomUUID()),
          csrfTokenHash: hash(randomUUID()),
          userAuthVersion: 1,
          idleExpiresAt: new Date(Date.now() + 3600_000),
          expiresAt: new Date(Date.now() + 7200_000),
        },
      });
      return {
        kind: 'HUMAN',
        userId: user.id,
        sessionId: session.id,
        authVersion: 1,
        scopes: [],
      } as V1Principal;
    }
    [author, reviewer, admin, contributor, outsider] = await Promise.all(
      Array.from({ length: 5 }, human),
    );
    const project = await db.project.create({
      data: {
        key: randomUUID().slice(0, 6),
        name: 'Discussion isolated fixture',
        createdById: author.userId,
      },
    });
    projectId = project.id;
    await db.projectMember.createMany({
      data: [author, reviewer, admin, contributor].map((principal) => ({
        projectId,
        userId: principal.userId,
        role: principal === admin ? ('ADMIN' as const) : ('MEMBER' as const),
      })),
    });
    const role = await db.projectRole.create({ data: { projectId, key: 'qa', title: 'QA' } });
    roleId = role.id;
    await db.projectRoleAssignment.create({ data: { projectId, userId: author.userId, roleId } });
    const credential = await db.agentCredential.create({
      data: {
        projectId,
        userId: author.userId,
        roleId,
        tokenHash: hash(randomUUID()),
        name: 'Discussion fixture',
        scopes: ['review:read', 'review:request', 'knowledge:read'],
        userAuthVersion: 1,
        expiresAt: new Date(Date.now() + 7200_000),
      },
    });
    agent = {
      kind: 'AGENT',
      userId: author.userId,
      projectId,
      roleIds: [roleId],
      agentCredentialId: credential.id,
      scopes: ['review:read', 'review:request', 'knowledge:read'],
    };
    const kb = await db.knowledgeBase.create({
      data: {
        projectId,
        key: 'discussion',
        name: 'Discussion fixture',
        visibility: 'PROJECT',
        publicationApproverUserId: reviewer.userId,
      },
    });
    knowledgeBaseId = kb.id;
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId, kind: 'PRD' },
    });
    const otherDocument = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId, kind: 'PRD' },
    });
    const ids: string[] = [];
    for (const [index, documentId] of [document.id, document.id, otherDocument.id].entries()) {
      const revision = await db.documentRevision.create({
        data: {
          projectId,
          documentId,
          seq: index + 1,
          title: `Round ${index + 1}`,
          mimeType: 'text/plain',
          bodyBytes: Buffer.from('evidence'),
          byteLength: 8,
          sha256: hash(`round-${index}`),
          createdById: author.userId,
        },
      });
      const review = await db.reviewRequest.create({
        data: {
          projectId,
          kind: 'PRD_PUBLICATION',
          documentRevisionId: revision.id,
          subjectDigest: revision.sha256,
          createdAt: new Date(`2026-11-0${index + 1}T00:00:00.000Z`),
        },
      });
      await db.approvalSlot.create({
        data: {
          projectId,
          reviewRequestId: review.id,
          slotKey: 'reviewer',
          kind: 'HUMAN',
          requiredUserId: reviewer.userId,
        },
      });
      ids.push(review.id);
    }
    [firstReviewId, secondReviewId, unrelatedReviewId] = ids;
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        const where = { projectId };
        await db.reviewDiscussionEntry.deleteMany({ where });
        await db.reviewDiscussion.deleteMany({ where });
        await db.auditEvent.deleteMany({ where });
        await db.idempotentOperation.deleteMany({ where });
        await db.approvalSlot.deleteMany({ where });
        await db.reviewRequest.deleteMany({ where });
        await db.documentRevision.deleteMany({ where });
        await db.knowledgeDocument.deleteMany({ where });
        await db.knowledgeBaseGrant.deleteMany({ where });
        await db.knowledgeBase.deleteMany({ where });
        await db.principalStamp.deleteMany({ where });
        await db.agentCredential.deleteMany({ where });
        await db.projectRoleAssignment.deleteMany({ where });
        await db.projectRole.deleteMany({ where });
        await db.projectMember.deleteMany({ where });
        await db.project.delete({ where: { id: projectId } });
      }
      await db.webSession.deleteMany({ where: { userId: { in: userIds } } });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
    } finally {
      await db.$disconnect();
    }
  });

  function write(
    principal: V1Principal,
    reviewId: string,
    input: DiscussionMutation,
    key = randomUUID(),
  ) {
    return service.mutate(principal, reviewId, input, {
      idempotencyKey: key,
      method: 'POST',
      route: `/api/v1/review-requests/${reviewId}/discussions${input.kind === 'CREATE' ? '' : `/${input.discussionId}/entries`}`,
      now: new Date(),
    });
  }

  it('creates a version-bound problem, keeps unresolved history visible in a new delivery round, responds and resolves/reopens independently of approval', async () => {
    const created = await write(author, firstReviewId, {
      kind: 'CREATE',
      title: '补充失败场景',
      body: '请补充重试耗尽的证据',
    });
    await db.reviewRequest.update({
      where: { id: firstReviewId },
      data: { status: 'CHANGES_REQUESTED' },
    });
    const inherited = await service.list(reviewer, secondReviewId);
    expect(inherited.items[0].source.reviewId).toBe(firstReviewId);
    expect(inherited.items[0].source.documentRevisionId).not.toBeNull();
    expect(inherited.unresolvedCount).toBe(1);
    const replied = await write(agent, secondReviewId, {
      kind: 'REPLY',
      discussionId: created.discussionId,
      expectedVersion: 1,
      body: '已补充用例，见新交付',
      addressedInReviewId: secondReviewId,
    });
    expect(replied.version).toBe(2);
    const resolved = await write(reviewer, secondReviewId, {
      kind: 'RESOLVED',
      discussionId: created.discussionId,
      expectedVersion: 2,
      body: '已核对新版本证据',
      addressedInReviewId: secondReviewId,
    });
    expect(resolved.version).toBe(3);
    expect((await service.list(reviewer, secondReviewId)).items).toHaveLength(0);
    const original = await service.list(reviewer, firstReviewId);
    expect(original.items[0].resolved).toBe(true);
    expect(original.items[0].entries.map((entry) => entry.kind)).toEqual(['REPLY', 'RESOLVED']);
    expect(original.items[0].entries[0].addressedInReview?.reviewId).toBe(secondReviewId);
    await write(author, firstReviewId, {
      kind: 'REOPENED',
      discussionId: created.discussionId,
      expectedVersion: 3,
      body: '补充场景仍有遗漏',
    });
    expect((await service.list(reviewer, secondReviewId)).unresolvedCount).toBe(1);
    expect(await db.reviewDecision.count({ where: { projectId } })).toBe(0);
    expect(await db.documentPublication.count({ where: { projectId } })).toBe(0);
    expect(
      (await db.reviewRequest.findUniqueOrThrow({ where: { id: secondReviewId } })).status,
    ).toBe('OPEN');
    expect(
      (await db.reviewRequest.findUniqueOrThrow({ where: { id: secondReviewId } })).version,
    ).toBe(1);
  });

  it('does not let project admins, unrelated contributors, or Agents resolve on behalf of a reviewer', async () => {
    const created = await write(author, secondReviewId, {
      kind: 'CREATE',
      title: '核对来源',
      body: '需要人类核对来源',
    });
    for (const principal of [admin, contributor, agent]) {
      const page = await service.list(principal, secondReviewId);
      expect(page.items.find((item) => item.id === created.discussionId)?.canManage).toBe(false);
      await expect(
        write(principal, secondReviewId, {
          kind: 'RESOLVED',
          discussionId: created.discussionId,
          expectedVersion: 1,
          body: '越权解决',
        }),
      ).rejects.toMatchObject({ message: 'DISCUSSION_REVIEWER_REQUIRED' });
    }
    expect(
      (await db.reviewDiscussion.findUniqueOrThrow({ where: { id: created.discussionId } }))
        .version,
    ).toBe(1);
    await expect(service.list(outsider, secondReviewId)).rejects.toMatchObject({ status: 404 });
  });

  it('replays identical writes once and rejects different payloads, stale versions and unrelated delivery references', async () => {
    const key = randomUUID();
    const input = { kind: 'CREATE' as const, title: '幂等问题', body: '原始问题' };
    const [left, right] = await Promise.all([
      write(author, secondReviewId, input, key),
      write(author, secondReviewId, input, key),
    ]);
    expect(left.discussionId).toBe(right.discussionId);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    await expect(
      write(author, secondReviewId, { ...input, body: '换意图' }, key),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      write(author, secondReviewId, {
        kind: 'REPLY',
        discussionId: left.discussionId,
        expectedVersion: 1,
        body: '关联错误文档',
        addressedInReviewId: unrelatedReviewId,
      }),
    ).rejects.toMatchObject({ message: 'DISCUSSION_DELIVERY_MISMATCH' });
    await write(contributor, secondReviewId, {
      kind: 'REPLY',
      discussionId: left.discussionId,
      expectedVersion: 1,
      body: '同一问题回应',
    });
    await expect(
      write(author, secondReviewId, {
        kind: 'REPLY',
        discussionId: left.discussionId,
        expectedVersion: 1,
        body: '旧版覆盖',
      }),
    ).rejects.toMatchObject({ message: 'DISCUSSION_VERSION_CONFLICT' });
    expect(
      await db.reviewDiscussionEntry.count({ where: { discussionId: left.discussionId } }),
    ).toBe(1);
  });

  it('pages every response and rejects a cursor from another discussion scope', async () => {
    const created = await write(author, secondReviewId, {
      kind: 'CREATE',
      title: '多轮回应',
      body: '逐项记录历史',
    });
    const stamp = await db.principalStamp.findFirstOrThrow({
      where: { projectId, userId: author.userId },
    });
    await db.reviewDiscussionEntry.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        projectId,
        discussionId: created.discussionId,
        kind: 'REPLY',
        body: `回复 ${index + 1}`,
        createdByStampId: stamp.id,
      })),
    });
    const first = (await service.list(reviewer, secondReviewId)).items.find(
      (item) => item.id === created.discussionId,
    )!;
    expect(first.entries).toHaveLength(20);
    expect(first.nextEntriesCursor).not.toBeNull();
    const rest = await service.entries(
      reviewer,
      secondReviewId,
      created.discussionId,
      first.nextEntriesCursor!,
    );
    expect(rest.items).toHaveLength(5);
    expect(new Set([...first.entries, ...rest.items].map((item) => item.id)).size).toBe(25);
    expect(rest.nextCursor).toBeNull();
    await expect(
      service.list(reviewer, secondReviewId, first.nextEntriesCursor!),
    ).rejects.toMatchObject({ message: 'DISCUSSION_CURSOR_INVALID' });
  });

  it('rechecks current credential, KB permissions and archived project state on writes', async () => {
    await db.agentCredential.update({
      where: { id: agent.agentCredentialId! },
      data: { scopes: ['review:read', 'knowledge:read'] },
    });
    await expect(
      write(agent, secondReviewId, { kind: 'CREATE', title: '过期权限', body: '应拒绝' }),
    ).rejects.toMatchObject({ message: 'DISCUSSION_CREDENTIAL_INACTIVE' });
    const readOnly = await service.list(agent, secondReviewId);
    expect(readOnly.canCreate).toBe(false);
    expect(readOnly.items.every((item) => !item.canReply)).toBe(true);
    await db.agentCredential.update({
      where: { id: agent.agentCredentialId! },
      data: { scopes: ['review:read', 'review:request'] },
    });
    await expect(
      write(agent, secondReviewId, { kind: 'CREATE', title: '知识权限已撤回', body: '应拒绝' }),
    ).rejects.toMatchObject({ message: 'DISCUSSION_CREDENTIAL_INACTIVE' });
    await expect(service.list(agent, secondReviewId)).rejects.toMatchObject({
      message: 'DISCUSSION_CREDENTIAL_INACTIVE',
    });
    await db.agentCredential.update({
      where: { id: agent.agentCredentialId! },
      data: { scopes: ['review:read', 'review:request', 'knowledge:read'] },
    });
    await db.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: { visibility: 'RESTRICTED' },
    });
    await expect(service.list(contributor, secondReviewId)).rejects.toMatchObject({ status: 404 });
    await db.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: { visibility: 'PROJECT' },
    });
    await db.project.update({ where: { id: projectId }, data: { archivedAt: new Date() } });
    expect((await service.list(author, secondReviewId)).canCreate).toBe(false);
    await expect(
      write(author, secondReviewId, { kind: 'CREATE', title: '归档项目', body: '应拒绝' }),
    ).rejects.toMatchObject({ message: 'PROJECT_ARCHIVED' });
    await db.project.update({ where: { id: projectId }, data: { archivedAt: null } });
  });

  it.each(['membership', 'role', 'session', 'credential', 'knowledge'] as const)(
    'rejects a write if %s is revoked after the preliminary read and before its transaction',
    async (boundary) => {
      const principal = boundary === 'role' || boundary === 'credential' ? agent : contributor;
      const original = reviews.getReview.bind(reviews);
      const count = await db.reviewDiscussion.count({ where: { projectId } });
      const spy = vi.spyOn(reviews, 'getReview').mockImplementationOnce(async (...args) => {
        const value = await original(...args);
        if (boundary === 'membership')
          await db.projectMember.update({
            where: { projectId_userId: { projectId, userId: principal.userId } },
            data: { revokedAt: new Date() },
          });
        if (boundary === 'role')
          await db.projectRole.update({ where: { id: roleId }, data: { isActive: false } });
        if (boundary === 'session')
          await db.webSession.update({
            where: { id: principal.sessionId! },
            data: { revokedAt: new Date() },
          });
        if (boundary === 'credential')
          await db.agentCredential.update({
            where: { id: principal.agentCredentialId! },
            data: { scopes: ['review:read', 'knowledge:read'] },
          });
        if (boundary === 'knowledge')
          await db.knowledgeBase.update({
            where: { id: knowledgeBaseId },
            data: { visibility: 'RESTRICTED' },
          });
        return value;
      });
      try {
        await expect(
          write(principal, secondReviewId, {
            kind: 'CREATE',
            title: '权限竞态',
            body: '预检之后已撤权',
          }),
        ).rejects.toMatchObject({
          ...(boundary === 'membership' || boundary === 'knowledge' ? { status: 404 } : {}),
          ...(boundary === 'session' ? { message: 'HUMAN_SESSION_REQUIRED' } : {}),
          ...(boundary === 'role' ? { message: 'AGENT_ROLE_ASSIGNMENT_INACTIVE' } : {}),
          ...(boundary === 'credential' ? { message: 'DISCUSSION_CREDENTIAL_INACTIVE' } : {}),
        });
        expect(await db.reviewDiscussion.count({ where: { projectId } })).toBe(count);
      } finally {
        spy.mockRestore();
        await db.projectMember.update({
          where: { projectId_userId: { projectId, userId: principal.userId } },
          data: { revokedAt: null },
        });
        await db.projectRole.update({ where: { id: roleId }, data: { isActive: true } });
        if (principal.sessionId)
          await db.webSession.update({
            where: { id: principal.sessionId },
            data: { revokedAt: null },
          });
        await db.agentCredential.update({
          where: { id: agent.agentCredentialId! },
          data: { scopes: ['review:read', 'review:request', 'knowledge:read'] },
        });
        await db.knowledgeBase.update({
          where: { id: knowledgeBaseId },
          data: { visibility: 'PROJECT' },
        });
      }
    },
  );

  it('paginates all matching issues without duplicates and rejects future-round writes through old reviews', async () => {
    const stamp = await db.principalStamp.findFirstOrThrow({
      where: { projectId, userId: author.userId },
    });
    await db.reviewDiscussion.createMany({
      data: Array.from({ length: 25 }, (_, index) => ({
        projectId,
        reviewRequestId: secondReviewId,
        title: `分页问题 ${index + 1}`,
        body: '分页证据',
        createdByStampId: stamp.id,
      })),
    });
    const first = await service.list(reviewer, secondReviewId);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await service.list(reviewer, secondReviewId, first.nextCursor!);
    const all = [...first.items, ...second.items];
    expect(second.nextCursor).toBeNull();
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length);
    expect(all.filter((item) => item.title.startsWith('分页问题'))).toHaveLength(25);
    expect(first.unresolvedCount).toBe(second.unresolvedCount);
    await expect(
      service.list(reviewer, unrelatedReviewId, first.nextCursor!),
    ).rejects.toMatchObject({ message: 'DISCUSSION_CURSOR_INVALID' });
    const later = all.find((item) => item.source.reviewId === secondReviewId)!;
    await expect(
      write(reviewer, firstReviewId, {
        kind: 'REPLY',
        discussionId: later.id,
        expectedVersion: later.version,
        body: '从旧轮次错误引用新问题',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
