/**
 * Requirement-scoped published PRD projection with real PostgreSQL, Nest and authentication.
 * Publication pointers are explicit read fixtures, not evidence of a publication approval.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { V1DocumentHistoryService } from '../src/knowledge/v1-document-history.service';
import { V1RequirementPrdsController } from '../src/knowledge/v1-requirement-prds.controller';
import { V1RequirementPrdsService } from '../src/knowledge/v1-requirement-prds.service';
import { PrismaService } from '../src/prisma/prisma.service';

type Actor = 'owner' | 'reader' | 'roleReader' | 'other';
type Scope = { projectId: string; requirementId: string; knowledgeBaseId: string };
type DocumentFixture = Scope & { id: string; revisionIds: string[] };
type PrdItem = {
  document: {
    id: string;
    projectId: string;
    knowledgeBaseId: string;
    requirementId: string | null;
    kind: string;
    version: number;
    currentPublishedRevisionId: string | null;
    archivedAt: string | null;
  };
  publishedRevision: { id: string; documentId: string; seq: number; title: string; digest: string };
};

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL requirement published PRDs over HTTP', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let projectId: string;
  let ownerRoleId: string;
  let readerRoleId: string;
  let nextRequirement = 0;
  const projects: string[] = [];
  const userIds: string[] = [];
  const users = {} as Record<Actor, string>;
  const cookies = {} as Record<Actor, string>;
  const bodyBytes = Buffer.from('PRD body should not appear in a compact projection.\n正文');
  const digest = createHash('sha256').update(bodyBytes).digest('hex');
  const acceptance = [
    { key: 'exact-prd', text: 'Read the precise published baseline', verification: 'TEST' },
  ];

  async function createProject() {
    const project = await db.project.create({
      data: {
        // The formal Project.key column is VARCHAR(6).
        key: `p${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Isolated requirement PRD fixture',
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
    for (const actor of ['owner', 'reader', 'roleReader', 'other'] as const) {
      const user = await db.user.create({
        data: { email: `${randomUUID()}@requirement-prds.test`, passwordHash: 'fixture-only' },
      });
      users[actor] = user.id;
      userIds.push(user.id);
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
      cookies[actor] = `${names.session}=wm_s1.${session.id}.${secret}; ${names.csrf}=${csrf}`;
    }
    projectId = await createProject();
    ownerRoleId = (
      await db.projectRole.create({ data: { projectId, key: 'prd-owner', title: 'PRD owner' } })
    ).id;
    readerRoleId = (
      await db.projectRole.create({ data: { projectId, key: 'prd-reader', title: 'PRD reader' } })
    ).id;
    await db.projectRoleAssignment.createMany({
      data: [
        { projectId, userId: users.owner, roleId: ownerRoleId },
        { projectId, userId: users.roleReader, roleId: readerRoleId },
      ],
    });

    const module = await Test.createTestingModule({
      controllers: [V1RequirementPrdsController, V1DocumentHistoryController],
      providers: [
        { provide: PrismaService, useValue: db },
        V1AuthService,
        { provide: V1_AUTH_REPOSITORY, useClass: V1AuthPrismaRepository },
        V1AuthorizationService,
        { provide: V1_AUTHORIZATION_REPOSITORY, useClass: V1AuthorizationPrismaRepository },
        V1RequirementPrdsService,
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
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    if (!db) return;
    try {
      for (const fixtureProjectId of [...projects].reverse()) {
        const where = { projectId: fixtureProjectId };
        // Only the recorded random project graph is removed; no database/schema-wide cleanup.
        await db.requirement.deleteMany({ where });
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
      if (userIds.length) {
        await db.webSession.deleteMany({ where: { userId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
    } finally {
      await db.$disconnect();
    }
  }, 60_000);

  async function requirement(targetProject = projectId) {
    const seq = ++nextRequirement;
    return db.requirement.create({
      data: { projectId: targetProject, seq, code: `PRD-${seq}`, title: 'Requirement PRD fixture' },
    });
  }

  async function knowledgeBase(
    options: { projectId?: string; reader?: boolean; roleReader?: boolean } = {},
  ) {
    const targetProject = options.projectId ?? projectId;
    const kb = await db.knowledgeBase.create({
      data: {
        projectId: targetProject,
        key: `p-${randomUUID()}`,
        name: 'Published PRD fixture',
        visibility: 'RESTRICTED',
        publicationApproverUserId: users.owner,
      },
    });
    await db.knowledgeBaseGrant.create({
      data: {
        projectId: targetProject,
        knowledgeBaseId: kb.id,
        subjectKind: 'USER',
        subjectUserId: users.owner,
        permissions: ['READ', 'PROPOSE'],
      },
    });
    if (options.reader !== false) {
      await db.knowledgeBaseGrant.create({
        data: {
          projectId: targetProject,
          knowledgeBaseId: kb.id,
          subjectKind: 'USER',
          subjectUserId: users.reader,
          permissions: ['READ'],
        },
      });
    }
    if (options.roleReader) {
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
    return kb;
  }

  async function scope(
    options: { projectId?: string; reader?: boolean; roleReader?: boolean } = {},
  ) {
    const req = await requirement(options.projectId);
    const kb = await knowledgeBase(options);
    return { projectId: req.projectId, requirementId: req.id, knowledgeBaseId: kb.id };
  }

  async function addRevisions(document: DocumentFixture, start: number, count: number) {
    const rows = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(),
      seq: start + index,
      projectId: document.projectId,
      documentId: document.id,
      title: `Published PRD revision ${start + index}`,
      mimeType: 'text/markdown',
      bodyBytes,
      byteLength: bodyBytes.length,
      sha256: digest,
      createdById: users.owner,
      acceptance,
      deliveryScope: { participatingRoleIds: [ownerRoleId], requiredOutputKinds: ['IMPL'] },
    }));
    if (rows.length) await db.documentRevision.createMany({ data: rows });
    document.revisionIds.push(...rows.map((row) => row.id));
  }

  async function document(
    target: Scope,
    options: {
      id?: string;
      history?: number;
      publishSeq?: number | null;
      kind?: string;
      archived?: boolean;
      createdAt?: Date;
    } = {},
  ): Promise<DocumentFixture> {
    const row = await db.knowledgeDocument.create({
      data: {
        ...(options.id ? { id: options.id } : {}),
        projectId: target.projectId,
        requirementId: target.requirementId,
        knowledgeBaseId: target.knowledgeBaseId,
        kind: options.kind ?? 'PRD',
        archivedAt: options.archived ? new Date() : null,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
    });
    const entry = { ...target, id: row.id, revisionIds: [] as string[] };
    await addRevisions(entry, 1, options.history ?? 3);
    const published =
      options.publishSeq === null ? null : entry.revisionIds[(options.publishSeq ?? 2) - 1];
    if (published) {
      await db.knowledgeDocument.update({
        where: { id: row.id },
        data: { currentPublishedRevisionId: published },
      });
    }
    return entry;
  }

  const path = (target: { projectId: string; requirementId: string }) =>
    `/api/v1/projects/${target.projectId}/requirements/${target.requirementId}/published-prds`;
  function get(target: { projectId: string; requirementId: string }, actor: Actor = 'reader') {
    return request(app.getHttpServer()).get(path(target)).set('Cookie', cookies[actor]);
  }
  function metadata(entry: DocumentFixture, revisionId: string, actor: Actor = 'reader') {
    return request(app.getHttpServer())
      .get(`/api/v1/documents/${entry.id}/revisions/${revisionId}/metadata`)
      .set('Cookie', cookies[actor]);
  }

  function compact(item: PrdItem) {
    expect(Object.keys(item).sort()).toEqual(['document', 'publishedRevision']);
    expect(Object.keys(item.document).sort()).toEqual([
      'archivedAt',
      'currentPublishedRevisionId',
      'id',
      'kind',
      'knowledgeBaseId',
      'projectId',
      'requirementId',
      'version',
    ]);
    expect(Object.keys(item.publishedRevision).sort()).toEqual([
      'digest',
      'documentId',
      'id',
      'seq',
      'title',
    ]);
    for (const value of [item, item.document, item.publishedRevision]) {
      for (const field of ['revisions', 'acceptance', 'deliveryScope', 'bodyBytes', 'bodyBase64']) {
        expect(value).not.toHaveProperty(field);
      }
    }
  }

  async function credential(scopes: string[] = ['knowledge:read']) {
    const secret = randomBytes(32).toString('base64url');
    const row = await db.agentCredential.create({
      data: {
        userId: users.owner,
        projectId,
        roleId: ownerRoleId,
        name: 'Published PRD fixture credential',
        tokenHash: hashSecret(secret),
        scopes,
        userAuthVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return `Bearer wm_a1.${row.id}.${secret}`;
  }

  it('finds a target after 60 unrelated documents and keeps the summary byte-identical as history grows to 205', async () => {
    const target = await scope();
    const unrelated = await requirement();
    const unrelatedDocumentIds: string[] = [];
    for (let index = 0; index < 60; index += 1) {
      const unrelatedDocument = await document(
        { ...target, requirementId: unrelated.id },
        { createdAt: new Date('2026-01-01T00:00:00Z') },
      );
      unrelatedDocumentIds.push(unrelatedDocument.id);
    }
    const entry = await document(target, {
      history: 5,
      publishSeq: 2,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    async function placeTargetAfterLegacyFirstPage() {
      // Publication-pointer updates change updatedAt, which controls the legacy list order.
      const updated = await db.knowledgeDocument.updateMany({
        where: {
          projectId,
          requirementId: unrelated.id,
          id: { in: unrelatedDocumentIds },
        },
        data: { updatedAt: new Date('2026-03-01T00:00:00Z') },
      });
      expect(updated.count).toBe(60);
      await db.knowledgeDocument.update({
        where: { id: entry.id },
        data: { updatedAt: new Date('2026-02-01T00:00:00Z') },
      });
      const legacyOrder = await db.knowledgeDocument.findMany({
        where: { projectId, archivedAt: null, kind: 'PRD' },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, requirementId: true },
      });
      expect(legacyOrder.slice(0, 60).map((row) => row.requirementId)).toEqual(
        Array.from({ length: 60 }, () => unrelated.id),
      );
      const targetRank = legacyOrder.findIndex((row) => row.id === entry.id) + 1;
      expect(targetRank).toBe(61);
      expect(targetRank).toBeGreaterThan(50);
      expect(legacyOrder.slice(0, 50).map((row) => row.id)).not.toContain(entry.id);
    }
    await placeTargetAfterLegacyFirstPage();
    const before = await get(target);
    expect(before.status).toBe(200);
    expect(before.body.data.total).toBe(1);
    expect(before.body.data.items).toHaveLength(1);
    compact(before.body.data.items[0]);
    const bytesBefore = Buffer.byteLength(JSON.stringify(before.body.data));
    await addRevisions(entry, 6, 200);
    await placeTargetAfterLegacyFirstPage();
    const after = await get(target);
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual(before.body.data);
    expect(Buffer.byteLength(JSON.stringify(after.body.data))).toBe(bytesBefore);
    expect(bytesBefore).toBeLessThan(2_000);
    expect(JSON.stringify(after.body.data)).not.toContain(bodyBytes.toString('utf8'));
    expect(await db.documentRevision.count({ where: { documentId: entry.id } })).toBe(205);
    expect(after.body.data.items[0].publishedRevision).toEqual({
      id: entry.revisionIds[1],
      documentId: entry.id,
      seq: 2,
      title: 'Published PRD revision 2',
      digest,
    });
    expect(after.body.meta.requestId).toBe(after.headers['x-request-id']);
    const exact = await metadata(entry, after.body.data.items[0].publishedRevision.id);
    expect(exact.status).toBe(200);
    expect(exact.body.data).toMatchObject({
      id: entry.revisionIds[1],
      documentId: entry.id,
      seq: 2,
      state: 'PUBLISHED',
      acceptance,
    });
    expect(exact.body.data).not.toHaveProperty('bodyBytes');
    expect(exact.body.data).not.toHaveProperty('bodyBase64');
  });

  it('reports an exact visible total above two while returning only two compact rows', async () => {
    const target = await scope();
    const entries: DocumentFixture[] = [];
    for (let index = 0; index < 5; index += 1) entries.push(await document(target));
    const response = await get(target);
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(5);
    expect(response.body.data.items).toHaveLength(2);
    const returned = response.body.data.items as PrdItem[];
    expect(returned.map((item) => item.document.id)).toEqual(
      entries
        .map((entry) => entry.id)
        .sort()
        .slice(0, 2),
    );
    expect(new Set(returned.map((item) => item.document.id)).size).toBe(2);
    for (const item of returned) {
      compact(item);
      expect(
        entries.some(
          (entry) =>
            entry.id === item.document.id && entry.revisionIds[1] === item.publishedRevision.id,
        ),
      ).toBe(true);
    }
  });

  it('filters hidden, unrelated, archived, unpublished and non-PRD documents before counting or taking two', async () => {
    const target = await scope();
    const hidden = await knowledgeBase({ reader: false });
    for (let index = 0; index < 5; index += 1) {
      await document(
        { ...target, knowledgeBaseId: hidden.id },
        {
          id: `00000000-${randomUUID().slice(9)}`,
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      );
    }
    const unrelated = await requirement();
    await document({ ...target, requirementId: unrelated.id });
    await document(target, { archived: true });
    await document(target, { publishSeq: null });
    await document(target, { kind: 'KNOWLEDGE' });
    const visible = await document(target, {
      id: `ffffffff-${randomUUID().slice(9)}`,
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    const response = await get(target);
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items.map((item: PrdItem) => item.document.id)).toEqual([visible.id]);
    expect(JSON.stringify(response.body.data)).not.toContain(hidden.id);
  });

  it('returns an explicit empty result for an existing requirement without a readable published PRD', async () => {
    const target = await scope();
    const empty = await get(target);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ items: [], total: 0 });
    await document(target, { publishSeq: null });
    await document({ ...target, knowledgeBaseId: (await knowledgeBase({ reader: false })).id });
    const stillEmpty = await get(target);
    expect(stillEmpty.status).toBe(200);
    expect(stillEmpty.body.data).toEqual({ items: [], total: 0 });
  });

  it('rechecks KB READ and does not use authorship to reveal a publication after access is revoked', async () => {
    const target = await scope();
    const entry = await document(target);
    const before = await get(target, 'owner');
    expect(before.status).toBe(200);
    expect(before.body.data.total).toBe(1);
    await db.knowledgeBaseGrant.updateMany({
      where: { knowledgeBaseId: target.knowledgeBaseId, subjectUserId: users.owner },
      data: { revokedAt: new Date() },
    });
    const after = await get(target, 'owner');
    expect(after.status).toBe(200);
    expect(after.body.data).toEqual({ items: [], total: 0 });
    const denied = await metadata(entry, entry.revisionIds[1]!, 'owner');
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('uses only active role grants and current project membership', async () => {
    const target = await scope({ roleReader: true });
    await document(target);
    expect((await get(target, 'roleReader')).body.data.total).toBe(1);
    const assignment = {
      projectId_userId_roleId: { projectId, userId: users.roleReader, roleId: readerRoleId },
    };
    try {
      await db.projectRoleAssignment.update({ where: assignment, data: { revokedAt: new Date() } });
      const revoked = await get(target, 'roleReader');
      expect(revoked.status).toBe(200);
      expect(revoked.body.data).toEqual({ items: [], total: 0 });
    } finally {
      await db.projectRoleAssignment.update({ where: assignment, data: { revokedAt: null } });
    }
    const membership = { projectId_userId: { projectId, userId: users.reader } };
    try {
      await db.projectMember.update({ where: membership, data: { revokedAt: new Date() } });
      const nonMember = await get(target);
      expect(nonMember.status).toBe(404);
      expect(nonMember.body.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await db.projectMember.update({ where: membership, data: { revokedAt: null } });
    }
  });

  it('keeps real Agent credentials within their read scope, project and active assigned role', async () => {
    const target = await scope();
    await document(target);
    const token = await credential();
    const agentGet = (entry: Scope, authorization = token) =>
      request(app.getHttpServer()).get(path(entry)).set('Authorization', authorization);
    const allowed = await agentGet(target);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.total).toBe(1);
    const noScope = await agentGet(target, await credential([]));
    expect(noScope.status).toBe(200);
    expect(noScope.body.data).toEqual({ items: [], total: 0 });
    const crossProject = await scope({ projectId: await createProject() });
    await document(crossProject);
    const cross = await agentGet(crossProject);
    expect(cross.status).toBe(404);
    const assignment = {
      projectId_userId_roleId: { projectId, userId: users.owner, roleId: ownerRoleId },
    };
    try {
      await db.projectRoleAssignment.update({ where: assignment, data: { revokedAt: new Date() } });
      const inactive = await agentGet(target);
      expect(inactive.status).toBe(422);
      expect(inactive.body.error.code).toBe('ROLE_INACTIVE');
    } finally {
      await db.projectRoleAssignment.update({ where: assignment, data: { revokedAt: null } });
    }
  });

  it('rejects missing or cross-project requirements and invalid paths and query fields with real HTTP envelopes', async () => {
    const target = await scope();
    const missing = await get({ ...target, requirementId: randomUUID() });
    expect(missing.status).toBe(404);
    expect(missing.body.error.message).toBe('REQUIREMENT_NOT_FOUND');
    const otherProject = await createProject();
    const crossRequirement = await requirement(otherProject);
    const cross = await get({ ...target, requirementId: crossRequirement.id });
    expect(cross.status).toBe(404);
    expect(cross.body.error.message).toBe('REQUIREMENT_NOT_FOUND');
    for (const malformed of [
      { ...target, projectId: 'not-a-uuid' },
      { ...target, requirementId: 'not-a-uuid' },
    ]) {
      const invalid = await get(malformed);
      expect(invalid.status).toBe(422);
      expect(invalid.body.error).toMatchObject({
        code: 'INVALID_REQUEST',
        message: 'PRD_CONTEXT_ID_INVALID',
      });
      expect(invalid.body.error.requestId).toBe(invalid.headers['x-request-id']);
      expect(invalid.body).not.toHaveProperty('data');
    }
    for (const query of [{ limit: 100 }, { cursor: 'ignored' }, { unknown: 'field' }]) {
      const invalid = await get(target).query(query);
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('REQUEST_REJECTED');
    }
    const unauthenticated = await request(app.getHttpServer()).get(path(target));
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('reports a missing non-null publication pointer as a refresh conflict instead of an empty match', async () => {
    const target = await scope();
    const entry = await document(target);
    await db.knowledgeDocument.update({
      where: { id: entry.id },
      data: { currentPublishedRevisionId: randomUUID() },
    });
    const broken = await get(target);
    expect(broken.status).toBe(409);
    expect(broken.body.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PRD_PUBLICATION_REFRESH_REQUIRED',
    });
    expect(broken.body).not.toHaveProperty('data');
  });

  it('rejects publication pointers into another document or project rather than reading its revision', async () => {
    const target = await scope();
    const entry = await document(target);
    const unrelated = await document(await scope());
    const crossProject = await document(await scope({ projectId: await createProject() }));
    for (const invalidId of [unrelated.revisionIds[1]!, crossProject.revisionIds[1]!]) {
      await db.knowledgeDocument.update({
        where: { id: entry.id },
        data: { currentPublishedRevisionId: invalidId },
      });
      const broken = await get(target);
      expect(broken.status).toBe(409);
      expect(broken.body.error).toMatchObject({
        code: 'RESOURCE_CONFLICT',
        message: 'PRD_PUBLICATION_REFRESH_REQUIRED',
      });
      expect(JSON.stringify(broken.body)).not.toContain(invalidId);
    }
  });

  it('keeps two-request publication changes explicit and does not substitute the new published metadata', async () => {
    const target = await scope();
    const entry = await document(target, { history: 205, publishSeq: 2 });
    const summary = await get(target);
    expect(summary.status).toBe(200);
    expect(summary.body.data.items[0].publishedRevision.id).toBe(entry.revisionIds[1]);
    await db.knowledgeDocument.update({
      where: { id: entry.id },
      data: { currentPublishedRevisionId: entry.revisionIds[2], version: { increment: 1 } },
    });
    const oldReader = await metadata(entry, summary.body.data.items[0].publishedRevision.id);
    expect(oldReader.status).toBe(404);
    const oldAuthor = await metadata(
      entry,
      summary.body.data.items[0].publishedRevision.id,
      'owner',
    );
    expect(oldAuthor.status).toBe(200);
    expect(oldAuthor.body.data).toMatchObject({ id: entry.revisionIds[1], state: 'CANDIDATE' });
    const refreshed = await get(target);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.items[0].publishedRevision.id).toBe(entry.revisionIds[2]);
    const current = await metadata(entry, refreshed.body.data.items[0].publishedRevision.id);
    expect(current.status).toBe(200);
    expect(current.body.data).toMatchObject({
      id: entry.revisionIds[2],
      state: 'PUBLISHED',
      acceptance,
    });
  });
});
