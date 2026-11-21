/**
 * Isolated PostgreSQL + Nest HTTP evidence for compact document reads.
 * Direct publication pointers and review slots are read fixtures, not HUMAN approval evidence.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthService, V1_AUTH_REPOSITORY } from '../src/auth/v1-auth.service';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import { V1AuthorizationService, V1_AUTHORIZATION_REPOSITORY } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1_CONFIRMATION_REPOSITORY } from '../src/auth/v1-confirmation';
import { V1ConfirmationPrismaRepository } from '../src/auth/v1-confirmation.prisma-repository';
import { cookieNames, resolveCookieMode } from '../src/auth/v1-cookie-policy';
import { hashSecret } from '../src/auth/v1-policy';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { RequestContextMiddleware } from '../src/common/request-context.middleware';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { V1_IDEMPOTENCY_REPOSITORY } from '../src/common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { V1DocumentSummaryController } from '../src/knowledge/v1-document-summary.controller';
import { V1DocumentSummaryService } from '../src/knowledge/v1-document-summary.service';
import { V1DocumentHistoryController } from '../src/knowledge/v1-document-history.controller';
import { V1DocumentHistoryService } from '../src/knowledge/v1-document-history.service';
import { V1PublicationController } from '../src/knowledge/v1-publication.controller';
import { V1PublicationPrismaRepository } from '../src/knowledge/v1-publication.prisma-repository';
import {
  V1PublicationService,
  V1_PUBLICATION_REPOSITORY,
} from '../src/knowledge/v1-publication.service';
import { PrismaService } from '../src/prisma/prisma.service';

type Actor = 'owner' | 'reader' | 'other' | 'outsider';
type Scope = { projectId: string; ownerRoleId: string; readerRoleId: string };
type Base = Scope & { id: string };
type Entry = Base & { documentId: string; revisionIds: string[] };
type Compact = {
  id: string;
  documentId: string;
  seq: number;
  title: string;
  digest: string;
  state: string;
};
type Summary = {
  document: {
    id: string;
    requirementId: string | null;
    currentPublishedRevisionId: string | null;
    version: number;
  };
  updatedAt: string;
  knowledgeBase: { id: string; name: string; kind: string };
  requirement: { id: string; code: string; title: string } | null;
  latestVisibleRevision: Compact | null;
  publishedRevision: Compact | null;
  visibleRevisionCount: number;
  candidateRevisionCount: number;
};

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL compact document summaries over HTTP', () => {
  let db: PrismaClient;
  let app: INestApplication;
  let authorization: V1AuthorizationService;
  const projectIds: string[] = [];
  const users = {} as Record<Actor, string>;
  const cookies = {} as Record<Actor, string>;
  const body = Buffer.from(`Summary fixture body must remain absent.\n${'正文'.repeat(4000)}`);
  const digest = createHash('sha256').update(body).digest('hex');

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe(target.database);
    for (const actor of ['owner', 'reader', 'other', 'outsider'] as const) {
      users[actor] = (
        await db.user.create({
          data: {
            email: `${randomUUID()}@document-summary.test`,
            passwordHash: 'fixture-only',
          },
        })
      ).id;
      const secret = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      const session = await db.webSession.create({
        data: {
          userId: users[actor],
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
    const module = await Test.createTestingModule({
      controllers: [
        V1DocumentSummaryController,
        V1DocumentHistoryController,
        V1PublicationController,
      ],
      providers: [
        { provide: PrismaService, useValue: db },
        V1AuthService,
        { provide: V1_AUTH_REPOSITORY, useClass: V1AuthPrismaRepository },
        V1AuthorizationService,
        { provide: V1_AUTHORIZATION_REPOSITORY, useClass: V1AuthorizationPrismaRepository },
        V1DocumentSummaryService,
        V1DocumentHistoryService,
        V1PublicationService,
        { provide: V1_PUBLICATION_REPOSITORY, useClass: V1PublicationPrismaRepository },
        { provide: V1_CONFIRMATION_REPOSITORY, useClass: V1ConfirmationPrismaRepository },
        { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
      ],
    }).compile();
    authorization = module.get(V1AuthorizationService);
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
    vi.restoreAllMocks();
    await app?.close();
    if (!db) return;
    try {
      for (const projectId of [...projectIds].reverse()) {
        const where = { projectId };
        // Delete only this suite's recorded random fixture graph. Keep database and migrations.
        await db.approvalSlotDelegation.deleteMany({ where });
        await db.approvalSlot.deleteMany({ where });
        await db.reviewRequest.deleteMany({ where });
        await db.requirement.deleteMany({ where });
        await db.documentRevision.deleteMany({ where });
        await db.knowledgeDocument.deleteMany({ where });
        await db.knowledgeBaseGrant.deleteMany({ where });
        await db.knowledgeBase.deleteMany({ where });
        await db.agentCredential.deleteMany({ where });
        await db.projectRoleAssignment.deleteMany({ where });
        await db.projectMember.deleteMany({ where });
        await db.projectRole.deleteMany({ where });
        await db.project.delete({ where: { id: projectId } });
      }
      const ids = Object.values(users);
      if (ids.length) {
        await db.webSession.deleteMany({ where: { userId: { in: ids } } });
        await db.user.deleteMany({ where: { id: { in: ids } } });
      }
    } finally {
      await db.$disconnect();
    }
  }, 60_000);

  async function scope(): Promise<Scope> {
    const project = await db.project.create({
      data: {
        key: `s${randomUUID().replaceAll('-', '').slice(0, 5)}`,
        name: 'Isolated summary fixture',
        createdById: users.owner,
      },
    });
    projectIds.push(project.id);
    await db.projectMember.createMany({
      data: ['owner', 'reader', 'other'].map((actor) => ({
        projectId: project.id,
        userId: users[actor as Actor],
        role: 'MEMBER' as const,
      })),
    });
    const ownerRole = await db.projectRole.create({
      data: { projectId: project.id, key: 'summary-owner', title: 'Owner' },
    });
    const readerRole = await db.projectRole.create({
      data: { projectId: project.id, key: 'summary-reader', title: 'Reader' },
    });
    await db.projectRoleAssignment.createMany({
      data: [
        { projectId: project.id, userId: users.owner, roleId: ownerRole.id },
        { projectId: project.id, userId: users.reader, roleId: readerRole.id },
      ],
    });
    return { projectId: project.id, ownerRoleId: ownerRole.id, readerRoleId: readerRole.id };
  }

  async function base(
    target: Scope,
    options: {
      kind?: string;
      reader?: boolean;
      ownerPermissions?: string[];
      archived?: boolean;
    } = {},
  ): Promise<Base> {
    const kb = await db.knowledgeBase.create({
      data: {
        projectId: target.projectId,
        key: `s-${randomUUID()}`,
        name: 'Summary knowledge',
        kind: options.kind ?? 'SYSTEM',
        visibility: 'RESTRICTED',
        publicationApproverUserId: users.owner,
        archivedAt: options.archived ? new Date() : null,
      },
    });
    await db.knowledgeBaseGrant.create({
      data: {
        projectId: target.projectId,
        knowledgeBaseId: kb.id,
        subjectKind: 'USER',
        subjectUserId: users.owner,
        permissions: options.ownerPermissions ?? ['READ', 'PROPOSE'],
      },
    });
    if (options.reader !== false)
      await db.knowledgeBaseGrant.create({
        data: {
          projectId: target.projectId,
          knowledgeBaseId: kb.id,
          subjectKind: 'USER',
          subjectUserId: users.reader,
          permissions: ['READ'],
        },
      });
    return { ...target, id: kb.id };
  }

  async function requirement(target: Scope, title = 'Visible requirement') {
    const seq = 1 + (await db.requirement.count({ where: { projectId: target.projectId } }));
    return db.requirement.create({
      data: { projectId: target.projectId, seq, code: `SUM-${seq}`, title },
    });
  }

  async function addRevisions(
    entry: Entry,
    start: number,
    count: number,
    options: {
      title?: (seq: number) => string;
      author?: (seq: number) => string;
    } = {},
  ) {
    const data = Array.from({ length: count }, (_, offset) => {
      const seq = start + offset;
      return {
        id: randomUUID(),
        projectId: entry.projectId,
        documentId: entry.documentId,
        seq,
        title: options.title?.(seq) ?? `Revision ${String(seq).padStart(3, '0')}`,
        mimeType: 'text/markdown',
        bodyBytes: body,
        byteLength: body.length,
        sha256: digest,
        createdById: options.author?.(seq) ?? users.owner,
        acceptance: [
          { key: 'fixture', text: 'Must remain outside compact reads', verification: 'TEST' },
        ],
        deliveryScope: { participatingRoleIds: [entry.ownerRoleId], requiredOutputKinds: ['IMPL'] },
      };
    });
    if (data.length) await db.documentRevision.createMany({ data });
    entry.revisionIds.push(...data.map((row) => row.id));
  }

  async function document(
    kb: Base,
    options: {
      count?: number;
      publishSeq?: number | null;
      kind?: string;
      requirementId?: string;
      archived?: boolean;
      updatedAt?: Date;
      title?: (seq: number) => string;
      author?: (seq: number) => string;
    } = {},
  ): Promise<Entry> {
    const row = await db.knowledgeDocument.create({
      data: {
        projectId: kb.projectId,
        knowledgeBaseId: kb.id,
        kind: options.kind ?? 'KNOWLEDGE',
        requirementId: options.requirementId ?? null,
        archivedAt: options.archived ? new Date() : null,
      },
    });
    const entry = { ...kb, documentId: row.id, revisionIds: [] as string[] };
    await addRevisions(entry, 1, options.count ?? 3, options);
    await db.knowledgeDocument.update({
      where: { id: row.id },
      data: {
        currentPublishedRevisionId:
          options.publishSeq === null
            ? null
            : (entry.revisionIds[(options.publishSeq ?? 1) - 1] ?? null),
        ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
      },
    });
    return entry;
  }

  const listPath = (target: Scope) => `/api/v1/projects/${target.projectId}/document-summaries`;
  const overviewPath = (target: Scope) =>
    `/api/v1/projects/${target.projectId}/document-summary-overview`;
  const summaryPath = (entry: Entry) => `/api/v1/documents/${entry.documentId}/summary`;
  function get(path: string, actor: Actor = 'owner') {
    return request(app.getHttpServer()).get(path).set('Cookie', cookies[actor]);
  }
  function ids(response: { body: { data: { items: Summary[] } } }) {
    return response.body.data.items.map((item) => item.document.id);
  }
  function compact(item: Summary) {
    expect(Object.keys(item).sort()).toEqual([
      'candidateRevisionCount',
      'document',
      'knowledgeBase',
      'latestVisibleRevision',
      'publishedRevision',
      'requirement',
      'updatedAt',
      'visibleRevisionCount',
    ]);
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
    for (const revision of [item.latestVisibleRevision, item.publishedRevision])
      if (revision) {
        expect(Object.keys(revision).sort()).toEqual([
          'digest',
          'documentId',
          'id',
          'seq',
          'state',
          'title',
        ]);
      }
    const json = JSON.stringify(item);
    for (const field of ['revisions', 'acceptance', 'deliveryScope', 'bodyBytes', 'bodyBase64']) {
      expect(json).not.toContain(`"${field}"`);
    }
    expect(json).not.toContain('Summary fixture body must remain absent.');
  }

  async function credential(target: Scope, scopes: string[]) {
    const secret = randomBytes(32).toString('base64url');
    const row = await db.agentCredential.create({
      data: {
        userId: users.owner,
        projectId: target.projectId,
        roleId: target.ownerRoleId,
        name: 'Summary read fixture',
        tokenHash: hashSecret(secret),
        scopes,
        userAuthVersion: 1,
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return `Bearer wm_a1.${row.id}.${secret}`;
  }

  it('keeps response size bounded as history grows to 205 and resolves an early publication independently', async () => {
    const target = await scope();
    const kb = await base(target);
    const entry = await document(kb, { count: 5, publishSeq: 2 });
    const before = await get(summaryPath(entry));
    expect(before.status).toBe(200);
    compact(before.body.data);
    expect(before.body.data).toMatchObject({
      visibleRevisionCount: 5,
      candidateRevisionCount: 4,
      publishedRevision: { id: entry.revisionIds[1], seq: 2, state: 'PUBLISHED' },
    });
    await addRevisions(entry, 6, 200);
    const after = await get(summaryPath(entry));
    expect(after.status).toBe(200);
    compact(after.body.data);
    expect(after.body.data).toMatchObject({
      visibleRevisionCount: 205,
      candidateRevisionCount: 204,
      latestVisibleRevision: { id: entry.revisionIds[204], seq: 205, state: 'CANDIDATE' },
    });
    expect(after.body.data.publishedRevision).toEqual(before.body.data.publishedRevision);
    const bytesBefore = Buffer.byteLength(JSON.stringify(before.body.data));
    const bytesAfter = Buffer.byteLength(JSON.stringify(after.body.data));
    expect(bytesAfter).toBeLessThan(2500);
    expect(Math.abs(bytesAfter - bytesBefore)).toBeLessThan(80);
    const page = await get(listPath(target));
    expect(page.status).toBe(200);
    expect(page.body.data).toEqual({ items: [after.body.data], nextCursor: null, total: 1 });
    expect(page.body.meta.requestId).toBe(page.headers['x-request-id']);
    const legacy = await get(`/api/v1/documents/${entry.documentId}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.revisions).toHaveLength(205);
    const legacyRevisions = await get(`/api/v1/documents/${entry.documentId}/revisions`);
    expect(legacyRevisions.status).toBe(200);
    expect(legacyRevisions.body.data).toHaveLength(205);
    const exact = await get(
      `/api/v1/documents/${entry.documentId}/revisions/${entry.revisionIds[1]}/metadata`,
    );
    expect(exact.status).toBe(200);
    expect(exact.body.data).toMatchObject({ id: entry.revisionIds[1], seq: 2, state: 'PUBLISHED' });
  });

  it('walks 107 static documents in updatedAt/id order with accurate total, a 50 default and a 100 maximum', async () => {
    const target = await scope();
    const kb = await base(target);
    const data = Array.from({ length: 107 }, (_, index) => ({
      id: randomUUID(),
      projectId: target.projectId,
      knowledgeBaseId: kb.id,
      kind: 'KNOWLEDGE',
      updatedAt: new Date(
        `2026-01-${String(1 + Math.floor(index / 4)).padStart(2, '0')}T00:00:00Z`,
      ),
    }));
    await db.knowledgeDocument.createMany({ data });
    const expected = data
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id.localeCompare(a.id))
      .map((row) => row.id);
    const first = await get(listPath(target));
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(50);
    expect(first.body.data.total).toBe(107);
    const max = await get(listPath(target)).query({ limit: 999 });
    expect(max.status).toBe(200);
    expect(max.body.data.items).toHaveLength(100);
    const all: string[] = [];
    let cursor: string | null = null;
    for (let index = 0; index < 20; index++) {
      const response = await get(listPath(target)).query({
        limit: 7,
        ...(cursor ? { cursor } : {}),
      });
      expect(response.status).toBe(200);
      expect(response.body.data.total).toBe(107);
      expect(response.body.data.items.length).toBeLessThanOrEqual(7);
      all.push(...ids(response));
      cursor = response.body.data.nextCursor;
      if (!cursor) break;
    }
    expect(cursor).toBeNull();
    expect(all).toEqual(expected);
    expect(new Set(all).size).toBe(107);
    const outsideFirstPage = await get(`/api/v1/documents/${expected[106]}/summary`);
    expect(outsideFirstPage.status).toBe(200);
    expect(outsideFirstPage.body.data.document.id).toBe(expected[106]);
  });

  it('filters unreadable KBs, archives, kind, collection and requirement before count and page', async () => {
    const target = await scope();
    const req = await requirement(target);
    const kb = await base(target, { kind: 'BUSINESS' });
    const hidden = await base(target, { kind: 'BUSINESS', reader: false });
    for (let index = 0; index < 5; index++)
      await document(hidden, { kind: 'PRD', requirementId: req.id });
    const visible = await document(kb, { kind: 'PRD', requirementId: req.id });
    await document(kb, { kind: 'PRD', requirementId: req.id, archived: true });
    await document(kb, { kind: 'KNOWLEDGE', requirementId: req.id });
    await document(kb, { kind: 'PRD' });
    await document(await base(target, { kind: 'PRACTICE' }), {
      kind: 'PRD',
      requirementId: req.id,
    });
    const response = await get(listPath(target), 'reader').query({
      kind: 'PRD',
      requirementId: req.id,
      knowledgeBaseKind: 'BUSINESS',
      limit: 1,
    });
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(ids(response)).toEqual([visible.documentId]);
    expect(response.body.data.nextCursor).toBeNull();
    expect(JSON.stringify(response.body.data)).not.toContain(hidden.id);
    expect((await get(summaryPath(await document(kb, { archived: true })), 'reader')).status).toBe(
      200,
    );
  });

  it('keeps READ-visible empty documents and applies current publication, author and explicit user slots across states', async () => {
    const target = await scope();
    const kb = await base(target);
    const entry = await document(kb, {
      count: 8,
      publishSeq: 1,
      author: (seq) => (seq === 2 ? users.reader : users.owner),
    });
    for (const [index, status] of (
      ['OPEN', 'APPROVED', 'REJECTED', 'INVALIDATED'] as const
    ).entries()) {
      const review = await db.reviewRequest.create({
        data: {
          projectId: target.projectId,
          documentRevisionId: entry.revisionIds[index + 2],
          kind: 'KNOWLEDGE_PUBLICATION',
          status,
          subjectDigest: digest,
        },
      });
      await db.approvalSlot.create({
        data: {
          projectId: target.projectId,
          reviewRequestId: review.id,
          slotKey: 'explicit',
          kind: 'APPROVAL',
          requiredUserId: users.reader,
        },
      });
    }
    for (const [index, roleOnly] of [true, false].entries()) {
      const review = await db.reviewRequest.create({
        data: {
          projectId: target.projectId,
          documentRevisionId: entry.revisionIds[index + 6],
          kind: 'KNOWLEDGE_PUBLICATION',
          subjectDigest: digest,
        },
      });
      const slot = await db.approvalSlot.create({
        data: {
          projectId: target.projectId,
          reviewRequestId: review.id,
          slotKey: 'excluded',
          kind: 'APPROVAL',
          requiredUserId: roleOnly ? null : users.owner,
          requiredRoleId: roleOnly ? target.readerRoleId : null,
        },
      });
      if (!roleOnly)
        await db.approvalSlotDelegation.create({
          data: {
            projectId: target.projectId,
            slotId: slot.id,
            delegatorUserId: users.owner,
            delegateUserId: users.reader,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
    }
    const result = await get(summaryPath(entry), 'reader');
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({
      visibleRevisionCount: 6,
      candidateRevisionCount: 5,
      latestVisibleRevision: { seq: 6 },
      publishedRevision: { seq: 1 },
    });
    const empty = await document(kb, { count: 2, publishSeq: null });
    const emptyResult = await get(summaryPath(empty), 'reader');
    expect(emptyResult.status).toBe(200);
    expect(emptyResult.body.data).toMatchObject({
      visibleRevisionCount: 0,
      candidateRevisionCount: 0,
      latestVisibleRevision: null,
      publishedRevision: null,
    });
    expect((await get(listPath(target), 'reader')).body.data.total).toBe(2);
    expect(
      (await get(listPath(target), 'reader').query({ q: 'Revision 007' })).body.data.total,
    ).toBe(0);
    expect(
      (await get(listPath(target), 'reader').query({ status: 'candidate' })).body.data.total,
    ).toBe(1);
  });

  it('does not promote write access in one KB to a READ-only KB, including a null publication pointer', async () => {
    const target = await scope();
    const proposer = await document(await base(target), {
      count: 3,
      author: () => users.other,
      publishSeq: null,
    });
    const reader = await document(await base(target, { ownerPermissions: ['READ'] }), {
      count: 3,
      author: () => users.other,
      publishSeq: 1,
    });
    const response = await get(listPath(target));
    expect(response.status).toBe(200);
    const items = response.body.data.items as Summary[];
    expect(items.find((item) => item.document.id === proposer.documentId)).toMatchObject({
      visibleRevisionCount: 3,
      candidateRevisionCount: 3,
    });
    expect(items.find((item) => item.document.id === reader.documentId)).toMatchObject({
      visibleRevisionCount: 1,
      candidateRevisionCount: 0,
    });
    const candidates = await get(listPath(target)).query({ status: 'candidate' });
    expect(ids(candidates)).toEqual([proposer.documentId]);
  });

  it('preserves literal joined search over all visible history and status independently of the matched revision', async () => {
    const target = await scope();
    const req = await requirement(target, 'Requirement title');
    const kb = await base(target);
    const entry = await document(kb, {
      count: 103,
      kind: 'KNOWLEDGE',
      requirementId: req.id,
      publishSeq: 1,
      title: (seq) => (seq === 1 ? 'Alpha' : seq === 103 ? 'Omega%_ tail' : `HiddenGhost ${seq}`),
      author: (seq) => (seq === 103 ? users.reader : users.owner),
    });
    const searchText = [
      '知识',
      'KNOWLEDGE',
      req.code,
      req.title,
      `${req.code} · ${req.title}`,
      'Omega%_ tail',
      'v103',
      'CANDIDATE',
      '候选',
      'Alpha',
      'v1',
      'PUBLISHED',
      '已发布',
    ]
      .join(' ')
      .toLowerCase();
    for (const q of [
      '  OMEGA  ',
      'v1',
      '%',
      '_',
      'tail v103',
      'CANDIDATE 候选 Alpha',
      `knowledge ${req.code}`,
      `${req.title} ${req.code} ·`,
      'HiddenGhost',
      '已撤回',
      "' OR true --",
    ]) {
      const response = await get(listPath(target), 'reader').query({ q });
      expect(response.status, q).toBe(200);
      expect(response.body.data.total, q).toBe(searchText.includes(q.trim().toLowerCase()) ? 1 : 0);
    }
    const candidateMatch = await get(listPath(target), 'reader').query({
      q: 'Omega',
      status: 'published',
    });
    expect(candidateMatch.status).toBe(200);
    expect(ids(candidateMatch)).toEqual([entry.documentId]);
    const publishedMatch = await get(listPath(target), 'reader').query({
      q: 'Alpha',
      status: 'candidate',
    });
    expect(ids(publishedMatch)).toEqual([entry.documentId]);
    const prd = await document(kb, { kind: 'PRD', count: 1, requirementId: req.id });
    const profile = await get(listPath(target), 'reader').query({
      searchProfile: 'prd',
      q: `prd prd prd ${req.code}`,
    });
    expect(profile.status).toBe(200);
    expect(ids(profile)).toEqual([prd.documentId]);
    expect(
      (await get(listPath(target)).query({ searchProfile: 'prd', kind: 'KNOWLEDGE' })).status,
    ).toBe(422);
  });

  it('preserves JavaScript Unicode lowercase search independently of database locale', async () => {
    const target = await scope();
    const kb = await base(target);
    const titles = [
      'ÉCOLE ÀÖ',
      'İSTANBUL',
      'ΟΣ',
      'ΟΣΑ',
      'AΣ\u0345A',
      '\u0345Σ',
      'A\u0345Σ',
      'AΣΣ',
      'AΣ.Σ',
      'AΣ\u0301 BΣ\u0301C',
      '𐐀𐐁𞤀𐒰',
    ];
    const entries: Array<{ id: string; text: string }> = [];
    for (const title of titles) {
      const entry = await document(kb, { count: 1, title: () => title });
      entries.push({
        id: entry.documentId,
        text: ['知识', 'KNOWLEDGE', title, 'v1', 'PUBLISHED', '已发布'].join(' ').toLowerCase(),
      });
    }
    for (const q of new Set([
      ...titles,
      ...titles.map((title) => title.toLowerCase()),
      'école',
      'i\u0307stanbul',
      'ος',
      'οσ',
      'aς',
      'aσ',
      'σ\u0345a',
      '𐐨𐐩',
    ])) {
      const response = await get(listPath(target)).query({ q });
      expect(response.status, JSON.stringify(q)).toBe(200);
      const expected = entries
        .filter((entry) => entry.text.includes(q.trim().toLowerCase()))
        .map((entry) => entry.id)
        .sort();
      expect(ids(response).sort(), JSON.stringify(q)).toEqual(expected);
      expect(response.body.data.total, JSON.stringify(q)).toBe(expected.length);
    }
  });

  it('redacts requirement text and matching from knowledge-only Agent credentials while retaining the binding id', async () => {
    const target = await scope();
    const req = await requirement(target, `Private requirement ${randomUUID()}`);
    const entry = await document(await base(target), { kind: 'PRD', requirementId: req.id });
    const knowledgeOnly = await credential(target, ['knowledge:read']);
    const response = await request(app.getHttpServer())
      .get(summaryPath(entry))
      .set('Authorization', knowledgeOnly);
    expect(response.status).toBe(200);
    expect(response.body.data.document.requirementId).toBe(req.id);
    expect(response.body.data.requirement).toBeNull();
    expect(JSON.stringify(response.body.data)).not.toContain(req.title);
    expect(JSON.stringify(response.body.data)).not.toContain(req.code);
    const hiddenSearch = await request(app.getHttpServer())
      .get(listPath(target))
      .set('Authorization', knowledgeOnly)
      .query({ q: req.title });
    expect(hiddenSearch.status).toBe(200);
    expect(hiddenSearch.body.data.total).toBe(0);
    const allowed = await credential(target, ['knowledge:read', 'requirement:read']);
    const readable = await request(app.getHttpServer())
      .get(listPath(target))
      .set('Authorization', allowed)
      .query({ q: req.title });
    expect(readable.status).toBe(200);
    expect(readable.body.data.total).toBe(1);
    expect(readable.body.data.items[0].requirement).toEqual({
      id: req.id,
      code: req.code,
      title: req.title,
    });
    const noKnowledge = await credential(target, ['requirement:read']);
    const empty = await request(app.getHttpServer())
      .get(listPath(target))
      .set('Authorization', noKnowledge);
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual({ items: [], nextCursor: null, total: 0 });
    expect(
      (await request(app.getHttpServer()).get(summaryPath(entry)).set('Authorization', noKnowledge))
        .status,
    ).toBe(404);
    const other = await scope();
    expect(
      (await request(app.getHttpServer()).get(listPath(other)).set('Authorization', allowed))
        .status,
    ).toBe(404);
    await db.projectRoleAssignment.updateMany({
      where: { projectId: target.projectId, roleId: target.ownerRoleId, userId: users.owner },
      data: { revokedAt: new Date() },
    });
    expect(
      (await request(app.getHttpServer()).get(listPath(target)).set('Authorization', allowed))
        .status,
    ).toBe(422);
  });

  it('returns exact overview counts and two recent items per collection without excluding empty revision sets', async () => {
    const target = await scope();
    const business = await base(target, { kind: 'BUSINESS' });
    const system = await base(target, { kind: 'SYSTEM', archived: true });
    await base(target, { kind: 'PRACTICE' });
    const expected: string[] = [];
    for (let index = 0; index < 4; index++) {
      const entry = await document(business, {
        kind: index === 0 ? 'PRD' : 'KNOWLEDGE',
        count: 0,
        publishSeq: null,
        updatedAt: new Date(`2026-02-0${index + 1}T00:00:00Z`),
      });
      expected.unshift(entry.documentId);
    }
    await document(system, { kind: 'UNDERSTANDING' });
    await document(system, { kind: 'DECISION' });
    await document(system, { kind: 'PRD', archived: true });
    await document(await base(target, { reader: false }), { kind: 'PRD' });
    const response = await get(overviewPath(target), 'reader');
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(6);
    expect(response.body.data.totalsByDocumentKind).toEqual({
      UNDERSTANDING: 1,
      DECISION: 1,
      PRD: 1,
      KNOWLEDGE: 3,
    });
    const collections = response.body.data.collections as Array<{
      knowledgeBaseKind: string;
      knowledgeBaseCount: number;
      documentCount: number;
      recentItems: Summary[];
    }>;
    expect(collections).toHaveLength(3);
    expect(collections.find((item) => item.knowledgeBaseKind === 'BUSINESS')).toMatchObject({
      knowledgeBaseCount: 1,
      documentCount: 4,
    });
    expect(
      collections
        .find((item) => item.knowledgeBaseKind === 'BUSINESS')
        ?.recentItems.map((item) => item.document.id),
    ).toEqual(expected.slice(0, 2));
    expect(collections.find((item) => item.knowledgeBaseKind === 'SYSTEM')).toMatchObject({
      knowledgeBaseCount: 1,
      documentCount: 2,
    });
    expect(collections.find((item) => item.knowledgeBaseKind === 'PRACTICE')).toEqual({
      knowledgeBaseKind: 'PRACTICE',
      knowledgeBaseCount: 1,
      documentCount: 0,
      recentItems: [],
    });
    for (const collection of collections) for (const item of collection.recentItems) compact(item);
    expect((await get(overviewPath(target)).query({ q: 'ignored?' })).status).toBe(400);
  });

  it('binds strict cursors to query, principal, credential and current knowledge permissions', async () => {
    const target = await scope();
    const kb = await base(target);
    for (let index = 0; index < 3; index++) await document(kb);
    const first = await get(listPath(target)).query({ limit: 1, q: 'revision' });
    expect(first.status).toBe(200);
    const cursor = first.body.data.nextCursor as string;
    expect(typeof cursor).toBe('string');
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const invalid = [
      '!',
      'a',
      `${cursor}=`,
      Buffer.from(JSON.stringify({ ...value, extra: true })).toString('base64url'),
      Buffer.from(`{"v":1,"v":1}`).toString('base64url'),
    ];
    for (const bad of invalid)
      expect(
        (await get(listPath(target)).query({ limit: 1, q: 'revision', cursor: bad })).status,
      ).toBe(422);
    for (const changed of [
      { limit: 2 },
      { q: 'different' },
      { status: 'published' },
      { kind: 'PRD' },
      { knowledgeBaseKind: 'SYSTEM' },
      { searchProfile: 'prd' },
    ]) {
      const result = await get(listPath(target)).query({
        limit: 1,
        q: 'revision',
        cursor,
        ...changed,
      });
      expect(result.status).toBe(422);
    }
    expect(
      (await get(listPath(target), 'reader').query({ limit: 1, q: 'revision', cursor })).status,
    ).toBe(422);
    const bearer = await credential(target, ['knowledge:read', 'knowledge:propose']);
    const agentFirst = await request(app.getHttpServer())
      .get(listPath(target))
      .set('Authorization', bearer)
      .query({ limit: 1 });
    expect(agentFirst.status).toBe(200);
    const secondBearer = await credential(target, ['knowledge:read', 'knowledge:propose']);
    const changedCredential = await request(app.getHttpServer())
      .get(listPath(target))
      .set('Authorization', secondBearer)
      .query({ limit: 1, cursor: agentFirst.body.data.nextCursor });
    expect(changedCredential.status).toBe(422);
    await db.knowledgeBase.update({
      where: { id: kb.id },
      data: { authzVersion: { increment: 1 } },
    });
    expect((await get(listPath(target)).query({ limit: 1, q: 'revision', cursor })).status).toBe(
      422,
    );
  });

  it('uses one repeatable-read snapshot for authorization, count and selected projection', async () => {
    const target = await scope();
    const kb = await base(target);
    const entry = await document(kb, { count: 1, title: () => 'Before snapshot' });
    const resolve = authorization.resolveKnowledgeAccess.bind(authorization);
    const spy = vi
      .spyOn(authorization, 'resolveKnowledgeAccess')
      .mockImplementationOnce(async (...args) => {
        const access = await resolve(...args);
        // This is a separate committed connection, after this request established its read snapshot.
        await db.documentRevision.update({
          where: { id: entry.revisionIds[0] },
          data: { title: 'After snapshot' },
        });
        await document(kb, { count: 0 });
        return access;
      });
    let response;
    try {
      response = await get(listPath(target));
    } finally {
      spy.mockRestore();
    }
    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].latestVisibleRevision.title).toBe('Before snapshot');
    const fresh = await get(listPath(target));
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.total).toBe(2);
    expect(
      (fresh.body.data.items as Summary[]).find((item) => item.document.id === entry.documentId)
        ?.latestVisibleRevision?.title,
    ).toBe('After snapshot');
  });

  it('rejects broken selected publication pointers instead of substituting another revision', async () => {
    const target = await scope();
    const kb = await base(target);
    const entry = await document(kb);
    const other = await document(kb);
    const foreign = await document(await base(await scope()));
    for (const pointer of [randomUUID(), other.revisionIds[0], foreign.revisionIds[0]]) {
      await db.knowledgeDocument.update({
        where: { id: entry.documentId },
        data: { currentPublishedRevisionId: pointer },
      });
      for (const path of [summaryPath(entry), listPath(target), overviewPath(target)]) {
        const response = await get(path);
        expect(response.status).toBe(409);
      }
    }
  });

  it('rejects malformed queries and hides unreadable or foreign objects without leaking text', async () => {
    const target = await scope();
    const hidden = await document(await base(target, { reader: false }));
    expect((await get(summaryPath(hidden), 'reader')).status).toBe(404);
    expect((await get(listPath(target), 'outsider')).status).toBe(404);
    expect((await get(listPath(target), 'reader')).body.data).toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    expect((await get('/api/v1/projects/not-a-uuid/document-summaries')).status).toBe(422);
    expect((await get('/api/v1/documents/not-a-uuid/summary')).status).toBe(422);
    expect((await get(listPath(target)).query({ unknown: 'field' })).status).toBe(400);
    for (const query of [
      { limit: 0 },
      { limit: 1.5 },
      { limit: 'NaN' },
      { kind: 'OTHER' },
      { knowledgeBaseKind: 'OTHER' },
      { requirementId: 'not-a-uuid' },
      { status: 'withdrawn' },
      { searchProfile: 'other' },
    ]) {
      expect((await get(listPath(target)).query(query)).status).toBe(422);
    }
    const unauthenticated = await request(app.getHttpServer()).get(listPath(target));
    expect(unauthenticated.status).toBe(401);
  });
});
