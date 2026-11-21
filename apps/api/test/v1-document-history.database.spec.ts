/**
 * Bounded document history against PostgreSQL and the real Nest/authentication stack.
 * All rows belong to randomly created fixtures in an explicitly guarded test database.
 * Seeded publication pointers and review states exercise reads; they are not publication approval evidence.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Principal } from '@workmesh/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthService, V1_AUTH_REPOSITORY } from '../src/auth/v1-auth.service';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import { V1AuthorizationService, V1_AUTHORIZATION_REPOSITORY } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { cookieNames, resolveCookieMode } from '../src/auth/v1-cookie-policy';
import { hashSecret } from '../src/auth/v1-policy';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { RequestContextMiddleware } from '../src/common/request-context.middleware';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { V1DocumentHistoryController } from '../src/knowledge/v1-document-history.controller';
import {
  V1DocumentHistoryService,
  type V1DocumentHistoryPage,
} from '../src/knowledge/v1-document-history.service';
import { PrismaService } from '../src/prisma/prisma.service';

type UserKey = 'owner' | 'reader' | 'other' | 'roleReader';
type Revision = { id: string; seq: number; createdById: string };
type Fixture = {
  projectId: string;
  knowledgeBaseId: string;
  documentId: string;
  revisions: Revision[];
};

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL bounded document history and metadata over HTTP', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let history: V1DocumentHistoryService;
  let projectId: string;
  let ownerRoleId: string;
  let readerRoleId: string;
  const projects: string[] = [];
  const createdUsers: string[] = [];
  const users = {} as Record<UserKey, string>;
  const cookies = {} as Record<UserKey, string>;
  const bodyBytes = Buffer.from('History fixture: exact bytes\n正文');
  const digest = createHash('sha256').update(bodyBytes).digest('hex');

  function human(user: UserKey): Principal {
    return { kind: 'HUMAN', userId: users[user], scopes: [] };
  }

  async function createProject() {
    const project = await db.project.create({
      data: {
        // Project.key is VARCHAR(6) in both schema.prisma and the formal initial migration.
        key: `h${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Isolated document history fixture',
        createdById: users.owner,
      },
    });
    projects.push(project.id);
    await db.projectMember.createMany({
      data: Object.values(users).map((userId) => ({
        projectId: project.id,
        userId,
        role: 'MEMBER' as const,
      })),
    });
    return project.id;
  }

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe(target.database);

    for (const key of ['owner', 'reader', 'other', 'roleReader'] as const) {
      const user = await db.user.create({
        data: { email: `${randomUUID()}@document-history.test`, passwordHash: 'fixture-only' },
      });
      users[key] = user.id;
      createdUsers.push(user.id);
      const secret = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      const session = await db.webSession.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(secret),
          csrfTokenHash: hashSecret(csrf),
          userAuthVersion: 1,
          idleExpiresAt: new Date(Date.now() + 3_600_000),
          expiresAt: new Date(Date.now() + 7_200_000),
        },
      });
      const names = cookieNames(resolveCookieMode(process.env.WORKMESH_COOKIE_MODE));
      cookies[key] = `${names.session}=wm_s1.${session.id}.${secret}; ${names.csrf}=${csrf}`;
    }
    projectId = await createProject();
    ownerRoleId = (
      await db.projectRole.create({
        data: { projectId, key: 'history-owner', title: 'History owner' },
      })
    ).id;
    readerRoleId = (
      await db.projectRole.create({
        data: { projectId, key: 'history-reader', title: 'History reader' },
      })
    ).id;
    await db.projectRoleAssignment.createMany({
      data: [
        { projectId, userId: users.owner, roleId: ownerRoleId },
        { projectId, userId: users.reader, roleId: readerRoleId },
        { projectId, userId: users.roleReader, roleId: readerRoleId },
      ],
    });

    const module = await Test.createTestingModule({
      controllers: [V1DocumentHistoryController],
      providers: [
        { provide: PrismaService, useValue: db },
        V1AuthService,
        { provide: V1_AUTH_REPOSITORY, useClass: V1AuthPrismaRepository },
        V1AuthorizationService,
        { provide: V1_AUTHORIZATION_REPOSITORY, useClass: V1AuthorizationPrismaRepository },
        V1DocumentHistoryService,
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
    const context = new RequestContextMiddleware();
    app.use(context.use.bind(context));
    await app.init();
    history = module.get(V1DocumentHistoryService);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (!db) return;
    try {
      // Every predicate is restricted to this suite's recorded random fixture IDs.
      for (const fixtureProjectId of [...projects].reverse()) {
        const where = { projectId: fixtureProjectId };
        await db.approvalSlotDelegation.deleteMany({ where });
        await db.approvalSlot.deleteMany({ where });
        await db.reviewRequest.deleteMany({ where });
        await db.documentRevision.deleteMany({ where });
        await db.knowledgeDocument.deleteMany({ where });
        await db.knowledgeBaseGrant.deleteMany({ where });
        await db.knowledgeBase.deleteMany({ where });
        await db.agentCredential.deleteMany({ where });
        await db.projectRoleAssignment.deleteMany({ where });
        await db.projectMember.deleteMany({ where });
        await db.projectRole.deleteMany({ where });
        await db.project.delete({ where: { id: fixtureProjectId } });
      }
      if (createdUsers.length) {
        await db.webSession.deleteMany({ where: { userId: { in: createdUsers } } });
        await db.user.deleteMany({ where: { id: { in: createdUsers } } });
      }
    } finally {
      await db.$disconnect();
    }
  }, 60_000);

  async function fixture(
    options: {
      count?: number;
      projectId?: string;
      publishSeq?: number | null;
      author?: (seq: number) => string;
      ownerPermissions?: string[];
      roleRead?: boolean;
    } = {},
  ): Promise<Fixture> {
    const targetProject = options.projectId ?? projectId;
    const kb = await db.knowledgeBase.create({
      data: {
        projectId: targetProject,
        key: `h-${randomUUID()}`,
        name: 'History fixture knowledge',
        visibility: 'RESTRICTED',
        publicationApproverUserId: users.owner,
      },
    });
    await db.knowledgeBaseGrant.createMany({
      data: [
        {
          projectId: targetProject,
          knowledgeBaseId: kb.id,
          subjectKind: 'USER',
          subjectUserId: users.owner,
          permissions: options.ownerPermissions ?? ['READ', 'PROPOSE', 'PUBLISH'],
        },
        {
          projectId: targetProject,
          knowledgeBaseId: kb.id,
          subjectKind: 'USER',
          subjectUserId: users.reader,
          permissions: ['READ'],
        },
      ],
    });
    if (options.roleRead) {
      await db.knowledgeBaseGrant.create({
        data: {
          projectId: targetProject,
          knowledgeBaseId: kb.id,
          subjectKind: 'ROLE',
          subjectRoleId: readerRoleId,
          permissions: ['READ'],
        },
      });
    }
    const document = await db.knowledgeDocument.create({
      data: { projectId: targetProject, knowledgeBaseId: kb.id, kind: 'KNOWLEDGE' },
    });
    const revisions = Array.from({ length: options.count ?? 5 }, (_, index) => ({
      id: randomUUID(),
      seq: index + 1,
      createdById: options.author?.(index + 1) ?? users.other,
    }));
    if (revisions.length) {
      await db.documentRevision.createMany({
        data: revisions.map((revision) => ({
          ...revision,
          projectId: targetProject,
          documentId: document.id,
          title: `Exact revision ${revision.seq}`,
          mimeType: 'text/markdown',
          bodyBytes,
          byteLength: bodyBytes.length,
          sha256: digest,
          deliveryScope: { participatingRoleIds: [ownerRoleId], requiredOutputKinds: ['IMPL'] },
          acceptance: [{ key: 'history-read', text: 'Read exact revision', verification: 'TEST' }],
        })),
      });
    }
    const published = revisions.find((revision) => revision.seq === (options.publishSeq ?? 2));
    if (options.publishSeq !== null && published) {
      // A read fixture pointer only: this does not simulate a successful publication operation.
      await db.knowledgeDocument.update({
        where: { id: document.id },
        data: { currentPublishedRevisionId: published.id },
      });
    }
    return {
      projectId: targetProject,
      knowledgeBaseId: kb.id,
      documentId: document.id,
      revisions,
    };
  }

  function get(path: string, user: UserKey = 'owner') {
    return request(app.getHttpServer()).get(path).set('Cookie', cookies[user]);
  }
  const historyPath = (documentId: string) => `/api/v1/documents/${documentId}/history`;
  const metadataPath = (documentId: string, revisionId: string) =>
    `/api/v1/documents/${documentId}/revisions/${revisionId}/metadata`;

  function metadataOnly(value: unknown) {
    expect(value).not.toHaveProperty('bodyBytes');
    expect(value).not.toHaveProperty('bodyBase64');
  }

  async function assignedReview(
    entry: Fixture,
    seq: number,
    status: 'OPEN' | 'APPROVED' | 'REJECTED' | 'INVALIDATED',
    assignment: { userId?: string; roleId?: string } = { userId: users.reader },
  ) {
    const review = await db.reviewRequest.create({
      data: {
        projectId: entry.projectId,
        documentRevisionId: entry.revisions[seq - 1]!.id,
        kind: 'KNOWLEDGE_PUBLICATION',
        status,
        subjectDigest: digest,
      },
    });
    const slot = await db.approvalSlot.create({
      data: {
        projectId: entry.projectId,
        reviewRequestId: review.id,
        slotKey: 'explicit-fixture',
        kind: 'APPROVAL',
        requiredUserId: assignment.userId ?? null,
        requiredRoleId: assignment.roleId ?? null,
      },
    });
    return { review, slot };
  }

  async function allPages(principal: Principal, documentId: string, limit: number) {
    const items: V1DocumentHistoryPage['items'] = [];
    let cursor: string | null = null;
    const cursors = new Set<string>();
    let expectedTotal: number | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await history.list(principal, documentId, { limit, cursor });
      expectedTotal ??= result.total;
      expect(result.total).toBe(expectedTotal);
      expect(result.items.length).toBeLessThanOrEqual(limit);
      for (const item of result.items) metadataOnly(item);
      items.push(...result.items);
      if (!result.nextCursor) return { items, total: result.total };
      expect(result.items.length).toBe(limit);
      expect(cursors.has(result.nextCursor)).toBe(false);
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error('Fixture history did not terminate within 20 pages');
  }

  async function credential(scopes: string[] = ['knowledge:read']) {
    const secret = randomBytes(32).toString('base64url');
    const row = await db.agentCredential.create({
      data: {
        userId: users.owner,
        projectId,
        roleId: ownerRoleId,
        name: 'History fixture credential',
        tokenHash: hashSecret(secret),
        scopes,
        userAuthVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return `Bearer wm_a1.${row.id}.${secret}`;
  }

  it('walks 205 revisions without omissions or duplicates, with a 50 default and a 100 maximum', async () => {
    const entry = await fixture({ count: 205, publishSeq: 2 });
    const first = await get(historyPath(entry.documentId));
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ total: 205, documentVersion: 1 });
    expect(first.body.data.items).toHaveLength(50);
    expect(first.body.data.items[0].seq).toBe(205);
    expect(first.body.meta.requestId).toBe(first.headers['x-request-id']);
    for (const item of first.body.data.items) metadataOnly(item);
    const maximum = await get(historyPath(entry.documentId)).query({ limit: 999 });
    expect(maximum.status).toBe(200);
    expect(maximum.body.data.items).toHaveLength(100);
    const continuation = await get(historyPath(entry.documentId)).query({
      limit: 100,
      cursor: maximum.body.data.nextCursor,
    });
    expect(continuation.status).toBe(200);
    expect(continuation.body.data.items.map((item: { seq: number }) => item.seq)).toEqual(
      Array.from({ length: 100 }, (_, index) => 105 - index),
    );
    const result = await allPages(human('owner'), entry.documentId, 50);
    expect(result.items.map((item) => item.seq)).toEqual(
      Array.from({ length: 205 }, (_, index) => 205 - index),
    );
    expect(new Set(result.items.map((item) => item.id)).size).toBe(205);
    expect(
      result.items.filter((item) => item.state === 'PUBLISHED').map((item) => item.seq),
    ).toEqual([2]);
  });

  it('filters before paging and counts the union of publication, author and explicit reviewers across review states', async () => {
    const own = (seq: number) => seq % 7 === 0;
    const assigned = [2, 51, 103, 200];
    const entry = await fixture({
      count: 205,
      publishSeq: 3,
      author: (seq) => (own(seq) ? users.reader : users.other),
    });
    for (const [index, status] of (
      ['OPEN', 'APPROVED', 'REJECTED', 'INVALIDATED'] as const
    ).entries()) {
      await assignedReview(entry, assigned[index]!, status);
    }
    await assignedReview(entry, 2, 'REJECTED'); // Multiple matching reviews must not duplicate a row.
    await assignedReview(entry, 7, 'APPROVED'); // Author and reviewer overlap is also one visible row.
    await assignedReview(entry, 204, 'OPEN', { roleId: readerRoleId });
    const expected = entry.revisions
      .filter(
        (revision) => revision.seq === 3 || own(revision.seq) || assigned.includes(revision.seq),
      )
      .reverse();
    const result = await allPages(human('reader'), entry.documentId, 3);
    expect(result.total).toBe(expected.length);
    expect(result.items.map((item) => item.id)).toEqual(expected.map((item) => item.id));
    expect(new Set(result.items.map((item) => item.id)).size).toBe(expected.length);
    expect(result.items.some((item) => item.seq === 204)).toBe(false);
    expect(
      result.items.filter((item) => item.state === 'PUBLISHED').map((item) => item.seq),
    ).toEqual([3]);
  });

  it('does not grant candidate visibility to a role-only slot or a delegated explicit-user slot', async () => {
    const entry = await fixture({ count: 3, publishSeq: null, roleRead: true });
    await assignedReview(entry, 1, 'OPEN', { roleId: readerRoleId });
    const { slot } = await assignedReview(entry, 2, 'APPROVED', { userId: users.owner });
    await db.approvalSlotDelegation.create({
      data: {
        projectId,
        slotId: slot.id,
        delegatorUserId: users.owner,
        delegateUserId: users.roleReader,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(history.list(human('roleReader'), entry.documentId)).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      documentVersion: 1,
    });
    const hidden = await get(metadataPath(entry.documentId, entry.revisions[0]!.id), 'roleReader');
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('reads an exact old revision with complete metadata and never falls back to a published revision', async () => {
    const entry = await fixture({ count: 205, publishSeq: 2 });
    await assignedReview(entry, 1, 'INVALIDATED');
    const old = entry.revisions[0]!;
    const response = await get(metadataPath(entry.documentId, old.id), 'reader');
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: old.id,
      documentId: entry.documentId,
      seq: 1,
      title: 'Exact revision 1',
      digest,
      byteLength: bodyBytes.length,
      state: 'CANDIDATE',
      deliveryScope: { participatingRoleIds: [ownerRoleId], requiredOutputKinds: ['IMPL'] },
      acceptance: [{ key: 'history-read', text: 'Read exact revision', verification: 'TEST' }],
    });
    metadataOnly(response.body.data);
    const another = await fixture();
    for (const path of [
      metadataPath(entry.documentId, entry.revisions[199]!.id),
      metadataPath(entry.documentId, randomUUID()),
      metadataPath(another.documentId, old.id),
    ]) {
      const denied = await get(path, 'reader');
      expect(denied.status).toBe(404);
      expect(denied.body.error).toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'REVISION_NOT_FOUND',
      });
      expect(denied.body).not.toHaveProperty('data');
    }
  });

  it('rechecks READ for an author and explicit reviewer on every page and exact metadata request', async () => {
    const entry = await fixture({
      count: 4,
      publishSeq: null,
      author: (seq) => (seq === 1 ? users.reader : users.other),
    });
    await assignedReview(entry, 2, 'OPEN');
    const page = await history.list(human('reader'), entry.documentId, { limit: 1 });
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeTruthy();
    await db.knowledgeBaseGrant.updateMany({
      where: { knowledgeBaseId: entry.knowledgeBaseId, subjectUserId: users.reader },
      data: { revokedAt: new Date() },
    });
    await expect(
      history.list(human('reader'), entry.documentId, { limit: 1, cursor: page.nextCursor }),
    ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    for (const revision of entry.revisions.slice(0, 2)) {
      await expect(
        history.metadata(human('reader'), entry.documentId, revision.id),
      ).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
    }
  });

  it('rechecks role-based READ and project membership instead of retaining a previous page permission', async () => {
    const entry = await fixture({ count: 4, roleRead: true, author: () => users.roleReader });
    const first = await history.list(human('roleReader'), entry.documentId, { limit: 1 });
    const assignmentWhere = {
      projectId_userId_roleId: { projectId, userId: users.roleReader, roleId: readerRoleId },
    };
    try {
      await db.projectRoleAssignment.update({
        where: assignmentWhere,
        data: { revokedAt: new Date() },
      });
      await expect(
        history.list(human('roleReader'), entry.documentId, { limit: 1, cursor: first.nextCursor }),
      ).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.projectRoleAssignment.update({ where: assignmentWhere, data: { revokedAt: null } });
    }
    const memberWhere = { projectId_userId: { projectId, userId: users.reader } };
    try {
      await db.projectMember.update({ where: memberWhere, data: { revokedAt: new Date() } });
      const denied = await get(historyPath(entry.documentId), 'reader');
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await db.projectMember.update({ where: memberWhere, data: { revokedAt: null } });
    }
  });

  it('keeps Agent scope, project and live role boundaries with real bearer authentication', async () => {
    const entry = await fixture({ count: 4, publishSeq: 2 });
    const token = await credential();
    const agentGet = (path: string, authorization = token) =>
      request(app.getHttpServer()).get(path).set('Authorization', authorization);
    const allowed = await agentGet(historyPath(entry.documentId));
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.total).toBe(1);
    expect(allowed.body.data.items.map((item: { seq: number }) => item.seq)).toEqual([2]);
    const noScope = await agentGet(historyPath(entry.documentId), await credential([]));
    expect(noScope.status).toBe(404);
    const crossProject = await fixture({ projectId: await createProject() });
    const cross = await agentGet(historyPath(crossProject.documentId));
    expect(cross.status).toBe(404);
    const assignmentWhere = {
      projectId_userId_roleId: { projectId, userId: users.owner, roleId: ownerRoleId },
    };
    try {
      await db.projectRoleAssignment.update({
        where: assignmentWhere,
        data: { revokedAt: new Date() },
      });
      const inactive = await agentGet(historyPath(entry.documentId));
      expect(inactive.status).toBe(422);
      expect(inactive.body.error.code).toBe('ROLE_INACTIVE');
    } finally {
      await db.projectRoleAssignment.update({ where: assignmentWhere, data: { revokedAt: null } });
    }
  });

  it('binds cursors to the document, human identity, normalized page size and effective KB permissions', async () => {
    const entry = await fixture({ count: 4, author: () => users.reader });
    const first = await history.list(human('owner'), entry.documentId, { limit: 1 });
    const another = await fixture();
    for (const [principal, documentId, limit] of [
      [human('reader'), entry.documentId, 1],
      [human('owner'), another.documentId, 1],
      [human('owner'), entry.documentId, 2],
    ] as const) {
      await expect(
        history.list(principal, documentId, { limit, cursor: first.nextCursor }),
      ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' });
    }
    await db.knowledgeBase.update({
      where: { id: entry.knowledgeBaseId },
      data: { authzVersion: { increment: 1 } },
    });
    await expect(
      history.list(human('owner'), entry.documentId, { limit: 1, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' });
    const updated = await history.list(human('owner'), entry.documentId, { limit: 1 });
    await db.knowledgeBaseGrant.updateMany({
      where: { knowledgeBaseId: entry.knowledgeBaseId, subjectUserId: users.owner },
      data: { permissions: ['READ', 'PROPOSE'] },
    });
    await expect(
      history.list(human('owner'), entry.documentId, { limit: 1, cursor: updated.nextCursor }),
    ).rejects.toMatchObject({ status: 422, code: 'INVALID_REQUEST' });
  });

  it('does not reuse a human or a different Agent credential cursor for the same user', async () => {
    const entry = await fixture({ count: 4, author: () => users.owner });
    const firstToken = await credential();
    const secondToken = await credential();
    const first = await request(app.getHttpServer())
      .get(historyPath(entry.documentId))
      .set('Authorization', firstToken)
      .query({ limit: 1 });
    expect(first.status).toBe(200);
    expect(first.body.data.nextCursor).toBeTruthy();
    const changedCredential = await request(app.getHttpServer())
      .get(historyPath(entry.documentId))
      .set('Authorization', secondToken)
      .query({ limit: 1, cursor: first.body.data.nextCursor });
    expect(changedCredential.status).toBe(422);
    const changedKind = await get(historyPath(entry.documentId)).query({
      limit: 1,
      cursor: first.body.data.nextCursor,
    });
    expect(changedKind.status).toBe(422);
    const same = await request(app.getHttpServer())
      .get(historyPath(entry.documentId))
      .set('Authorization', firstToken)
      .query({ limit: 1, cursor: first.body.data.nextCursor });
    expect(same.status).toBe(200);
    expect(same.body.data.items[0].seq).toBe(3);
  });

  it('requires refresh when document version changes and rechecks reviewer assignment on continuation', async () => {
    const entry = await fixture({ count: 4, publishSeq: null });
    const first = await history.list(human('owner'), entry.documentId, { limit: 1 });
    await db.knowledgeDocument.update({
      where: { id: entry.documentId },
      data: { version: { increment: 1 } },
    });
    const stale = await get(historyPath(entry.documentId)).query({
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'HISTORY_REFRESH_REQUIRED',
    });
    const refreshed = await history.list(human('owner'), entry.documentId, { limit: 1 });
    expect(refreshed.documentVersion).toBe(2);
    await assignedReview(entry, 4, 'OPEN');
    const old = await assignedReview(entry, 1, 'REJECTED');
    const readerPage = await history.list(human('reader'), entry.documentId, { limit: 1 });
    expect(readerPage.total).toBe(2);
    await db.approvalSlot.delete({ where: { id: old.slot.id } });
    const continuation = await history.list(human('reader'), entry.documentId, {
      limit: 1,
      cursor: readerPage.nextCursor,
    });
    expect(continuation).toMatchObject({ items: [], total: 1, nextCursor: null });
    await expect(
      history.metadata(human('reader'), entry.documentId, entry.revisions[0]!.id),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('validates HTTP query fields and malformed cursors through real pipes with standard envelopes', async () => {
    const entry = await fixture();
    for (const limit of ['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
      const response = await get(historyPath(entry.documentId)).query({ limit });
      expect(response.status).toBe(422);
      expect(response.body.error).toMatchObject({
        code: 'INVALID_REQUEST',
        requestId: expect.any(String),
      });
      expect(response.body.error.requestId).toBe(response.headers['x-request-id']);
      expect(response.body).not.toHaveProperty('data');
    }
    for (const cursor of [
      'not-json',
      'a=',
      '',
      'x'.repeat(2049),
      Buffer.from('{"v":1,"v":1}').toString('base64url'),
    ]) {
      const response = await get(historyPath(entry.documentId)).query({ cursor });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }
    const validPage = await history.list(human('owner'), entry.documentId, { limit: 1 });
    expect(validPage.nextCursor).toBeTruthy();
    const validCursor = JSON.parse(
      Buffer.from(validPage.nextCursor!, 'base64url').toString('utf8'),
    );
    for (const beforeSeq of [2_147_483_648, Number.MAX_SAFE_INTEGER]) {
      // Preserve the real binding and page size: rejection must validate the PostgreSQL Int bound.
      const cursor = Buffer.from(JSON.stringify({ ...validCursor, beforeSeq })).toString(
        'base64url',
      );
      const response = await get(historyPath(entry.documentId)).query({ limit: 1, cursor });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    }
    const unknown = await get(historyPath(entry.documentId)).query({ unknown: 'field' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatchObject({
      code: 'REQUEST_REJECTED',
      requestId: expect.any(String),
    });
    const unauthenticated = await request(app.getHttpServer()).get(historyPath(entry.documentId));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe('AUTH_REQUIRED');
    const missing = await get(historyPath(randomUUID()));
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('DOCUMENT_NOT_FOUND');
  });

  it('returns empty histories explicitly and preserves all-history PROPOSE or PUBLISH access without a publication', async () => {
    const empty = await fixture({ count: 0, publishSeq: null });
    await expect(history.list(human('reader'), empty.documentId)).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      documentVersion: 1,
    });
    for (const capability of ['PROPOSE', 'PUBLISH']) {
      const entry = await fixture({
        count: 5,
        publishSeq: null,
        ownerPermissions: ['READ', capability],
      });
      const allowed = await history.list(human('owner'), entry.documentId);
      expect(allowed.total).toBe(5);
      expect(allowed.items.every((item) => item.state === 'CANDIDATE')).toBe(true);
      await expect(history.list(human('reader'), entry.documentId)).resolves.toMatchObject({
        items: [],
        total: 0,
        nextCursor: null,
      });
    }
  });
});
