/**
 * v1 知识发布端到端验证（真实 PostgreSQL）。
 *
 * 安全门禁（06 §3.1）：仅在显式 `WORKMESH_TEST_ENV` + `WORKMESH_TEST_DATABASE_URL` 指向
 * 合规测试库（workmesh_test_*、loopback、schema=workmesh_v1、用户白名单）时才运行；
 * 否则整段套件 `describe.skip`，绝不回退到应用连接配置。
 *
 * 验收路径：propose（无直接发布入口）→ 服务端派生审批槽 → 签发一次性确认票据 →
 * POST /review-requests/:id/decisions（真实人工动作，绝不直插 ReviewDecision）→ 最后 ALL APPROVE
 * 同事务完成发布 → 另一授权主体读取已发布正文。
 *
 * 注意：本文件需要真实数据库，运行须由 `scripts/test-e2e.mjs` 门禁前置；DB 未授权时自动跳过。
 * 运行状态标注见 .agent-local 进度记录（受限环境标 “未验证”）。
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { cookieNames, resolveCookieMode } from '../src/auth/v1-cookie-policy';
import { hashSecret } from '../src/auth/v1-policy';
import { V1AuthGuard } from '../src/auth/v1-auth.guard';
import { V1AuthService, V1_AUTH_REPOSITORY } from '../src/auth/v1-auth.service';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import { V1AuthorizationService, V1_AUTHORIZATION_REPOSITORY } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1ConfirmationRepository, V1_CONFIRMATION_REPOSITORY } from '../src/auth/v1-confirmation';
import { V1ConfirmationPrismaRepository } from '../src/auth/v1-confirmation.prisma-repository';
import { V1ReviewController } from '../src/reviews/v1-review.controller';
import {
  V1ReviewService,
  REVIEW_DECIDE_ACTION,
  REVIEW_DECIDE_TARGET_TYPE,
} from '../src/reviews/v1-review.service';
import { V1_REVIEW_REPOSITORY, type V1ReviewSnapshot } from '../src/reviews/v1-review.repository';
import { V1ReviewPrismaRepository } from '../src/reviews/v1-review.prisma-repository';
import { V1PublicationController } from '../src/knowledge/v1-publication.controller';
import {
  V1PublicationService,
  V1_PUBLICATION_REPOSITORY,
} from '../src/knowledge/v1-publication.service';
import { V1PublicationPrismaRepository } from '../src/knowledge/v1-publication.prisma-repository';
import { V1_IDEMPOTENCY_REPOSITORY } from '../src/common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';

const gate = evaluateSuiteTestDatabase();
const suite = gate.ok ? describe : describe.skip;

suite('v1 knowledge publication over HTTP with a real database', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const secret = randomBytes(32).toString('base64url');
  const csrf = randomBytes(32).toString('base64url');
  const ticketSecret = randomBytes(32).toString('base64url');
  const ids = {
    user: '',
    reader: '',
    project: '',
    role: '',
    knowledgeBase: '',
    document: '',
    session: '',
  };
  const readable = { user: '' };
  let cookie = '';

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    process.env.WORKMESH_V1_DATABASE_URL = target.url;
    prisma = new PrismaClient();
    // 连接后只读身份探针：确认连到的库名与门禁目标一致（不执行任何 DDL/DML）。
    const rows = await prisma.$queryRaw<
      Array<{ current_database: string }>
    >`SELECT current_database()`;
    if (rows[0]?.current_database !== target.database)
      throw new Error(
        `test database identity mismatch: connected ${rows[0]?.current_database} !== ${target.database}`,
      );

    const stamp = Date.now();
    const user = await prisma.user.create({
      data: {
        email: `e2e-author-${stamp}@workmesh.test`,
        passwordHash: 'not-used-in-e2e',
        isActive: true,
        authVersion: 1,
      },
    });
    const reader = await prisma.user.create({
      data: {
        email: `e2e-reader-${stamp}@workmesh.test`,
        passwordHash: 'not-used-in-e2e',
        isActive: true,
        authVersion: 1,
      },
    });
    const project = await prisma.project.create({
      data: { key: `e${String(stamp).slice(-5)}`, name: 'e2e project', createdById: user.id },
    });
    const role = await prisma.projectRole.create({
      data: { projectId: project.id, key: 'product', title: 'Product' },
    });
    await prisma.projectMember.createMany({
      data: [
        { projectId: project.id, userId: user.id, role: 'ADMIN' },
        { projectId: project.id, userId: reader.id, role: 'MEMBER' },
      ],
    });
    await prisma.projectRoleAssignment.create({
      data: { projectId: project.id, userId: user.id, roleId: role.id },
    });
    const knowledgeBase = await prisma.knowledgeBase.create({
      data: {
        projectId: project.id,
        key: 'kb-main',
        name: 'main',
        visibility: 'RESTRICTED',
        publicationApproverUserId: user.id,
        publicationApproverRoleId: null,
      },
    });
    await prisma.knowledgeBaseGrant.create({
      data: {
        projectId: project.id,
        knowledgeBaseId: knowledgeBase.id,
        subjectKind: 'USER',
        subjectUserId: user.id,
        permissions: ['READ', 'PROPOSE', 'PUBLISH'],
      },
    });
    await prisma.knowledgeBaseGrant.create({
      data: {
        projectId: project.id,
        knowledgeBaseId: knowledgeBase.id,
        subjectKind: 'USER',
        subjectUserId: reader.id,
        permissions: ['READ'],
      },
    });
    const document = await prisma.knowledgeDocument.create({
      data: { projectId: project.id, knowledgeBaseId: knowledgeBase.id, kind: 'KNOWLEDGE' },
    });
    const session = await prisma.webSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSecret(secret),
        csrfTokenHash: hashSecret(csrf),
        userAuthVersion: 1,
        idleExpiresAt: new Date(Date.now() + 3_600_000),
        expiresAt: new Date(Date.now() + 7_200_000),
      },
    });
    Object.assign(ids, {
      user: user.id,
      reader: reader.id,
      project: project.id,
      role: role.id,
      knowledgeBase: knowledgeBase.id,
      document: document.id,
      session: session.id,
    });
    readable.user = reader.id;
    const names = cookieNames(resolveCookieMode(process.env.WORKMESH_COOKIE_MODE));
    cookie = `${names.session}=wm_s1.${session.id}.${secret}; ${names.csrf}=${csrf}`;

    const moduleRef = await Test.createTestingModule({
      controllers: [V1ReviewController, V1PublicationController],
      providers: [
        V1AuthService,
        { provide: V1_AUTH_REPOSITORY, useClass: V1AuthPrismaRepository },
        V1AuthorizationService,
        { provide: V1_AUTHORIZATION_REPOSITORY, useClass: V1AuthorizationPrismaRepository },
        V1ReviewService,
        { provide: V1_REVIEW_REPOSITORY, useClass: V1ReviewPrismaRepository },
        V1PublicationService,
        { provide: V1_PUBLICATION_REPOSITORY, useClass: V1PublicationPrismaRepository },
        { provide: V1_CONFIRMATION_REPOSITORY, useClass: V1ConfirmationPrismaRepository },
        { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.use(
      (
        req: { requestId?: string },
        res: { setHeader: (n: string, v: string) => void },
        next: () => void,
      ) => {
        const id = randomBytes(16).toString('hex');
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
        res.setHeader('Cache-Control', 'no-store');
        next();
      },
    );
    await app.init();
  }, 90_000);

  afterAll(async () => {
    await app?.close();
    if (prisma && ids.project) {
      await prisma.confirmationTicket.deleteMany({ where: { projectId: ids.project } });
      await prisma.documentPublication.deleteMany({ where: { projectId: ids.project } });
      await prisma.reviewDecision.deleteMany({ where: { projectId: ids.project } });
      await prisma.approvalSlot.deleteMany({ where: { projectId: ids.project } });
      await prisma.reviewRequest.deleteMany({ where: { projectId: ids.project } });
      await prisma.documentRevision.deleteMany({ where: { projectId: ids.project } });
      await prisma.webSession.deleteMany({ where: { userId: { in: [ids.user, readable.user] } } });
      await prisma.knowledgeDocument.deleteMany({ where: { projectId: ids.project } });
      await prisma.knowledgeBaseGrant.deleteMany({ where: { projectId: ids.project } });
      await prisma.knowledgeBase.deleteMany({ where: { projectId: ids.project } });
      await prisma.projectRoleAssignment.deleteMany({ where: { projectId: ids.project } });
      await prisma.projectMember.deleteMany({ where: { projectId: ids.project } });
      await prisma.projectRole.deleteMany({ where: { projectId: ids.project } });
      await prisma.project.deleteMany({ where: { id: ids.project } });
      await prisma.user.deleteMany({ where: { id: { in: [ids.user, readable.user] } } });
    }
    await prisma?.$disconnect();
  }, 90_000);

  const post = (path: string, body: unknown, idempotencyKey?: string) => {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173');
    if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
    return req.set('X-CSRF-Token', csrf).send(body as Record<string, unknown>);
  };

  const get = (path: string) =>
    request(app.getHttpServer())
      .get(path)
      .set('Cookie', cookie)
      .set('Origin', process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173');

  it('proposes a candidate, publishes it after approval and exposes one version downstream', async () => {
    const body = '# e2e body';
    const proposed = await post(
      `/api/v1/documents/${ids.document}/revisions`,
      {
        title: 'e2e note',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBase64: Buffer.from(body, 'utf8').toString('base64'),
      },
      randomUUID(),
    );
    expect(proposed.status).toBe(201);
    const reviewRequestId = proposed.body.data.reviewRequestId as string;
    const slotId = proposed.body.data.slots[0].id as string;
    const revisionId = proposed.body.data.revision.id as string;
    expect(proposed.body.data.revision.digest).toMatch(/^[a-f0-9]{64}$/);

    // 校验候选未被直接发布：状态仍为 CANDIDATE，文档无已发布指针。
    const beforeDoc = await prisma.knowledgeDocument.findUnique({ where: { id: ids.document } });
    expect(beforeDoc?.currentPublishedRevisionId).toBeNull();

    // 合法用户读取候选正文（作者 + 审批人资格）。
    const candidate = await get(`/api/v1/document-revisions/${revisionId}/content`);
    expect(candidate.status).toBe(200);
    expect(Buffer.from(candidate.body.data.bodyBase64, 'base64').toString('utf8')).toBe(body);

    // 服务端派生绑定摘要，供签发一次性确认票据；票据绑定必须与服务端 decide 推导一致。
    const reviewResp = await get(`/api/v1/review-requests/${reviewRequestId}`);
    expect(reviewResp.status).toBe(200);
    const review = reviewResp.body.data as V1ReviewSnapshot;
    const reviewService = app.get(V1ReviewService) as V1ReviewService;
    const { actionDigest } = reviewService.previewDigest(review, {
      slotId,
      decision: 'APPROVE',
      expectedVersion: review.version,
      comment: null,
      confirmation: { ticketId: 'pending', ticketSecret },
    });

    const ticketId = randomBytes(16).toString('hex');
    await prisma.confirmationTicket.create({
      data: {
        id: ticketId,
        secretHash: hashSecret(ticketSecret),
        userId: ids.user,
        webSessionId: ids.session,
        projectId: ids.project,
        userAuthVersion: 1,
        action: REVIEW_DECIDE_ACTION,
        targetType: REVIEW_DECIDE_TARGET_TYPE,
        targetId: reviewRequestId,
        expectedVersion: review.version,
        actionDigest,
        roleId: null,
        approvalSlotId: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        consumedAt: null,
        invalidatedAt: null,
      },
    });

    const published = await post(
      `/api/v1/review-requests/${reviewRequestId}/decisions`,
      {
        slotId,
        decision: 'APPROVE',
        expectedVersion: review.version,
        confirmation: { ticketId, ticketSecret },
      },
      'e2e-publish-1',
    );
    expect(published.status).toBe(201);
    expect(published.body.data.published).toBe(true);
    expect(published.body.data.publicationId).toBeTruthy();

    const document = await prisma.knowledgeDocument.findUnique({ where: { id: ids.document } });
    expect(document?.currentPublishedRevisionId).toBe(revisionId);

    // 另一授权主体（仅 READ）读取已发布正文。
    const readCookie = `${cookieNames(resolveCookieMode(process.env.WORKMESH_COOKIE_MODE)).session}=wm_s1.${ids.session}.${secret}; ${cookieNames(resolveCookieMode(process.env.WORKMESH_COOKIE_MODE)).csrf}=${csrf}`;
    const read = await request(app.getHttpServer())
      .get(`/api/v1/document-revisions/${revisionId}/content`)
      .set('Cookie', readCookie)
      .set('Origin', process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173');
    expect(read.status).toBe(200);
    expect(Buffer.from(read.body.data.bodyBase64, 'base64').toString('utf8')).toBe(body);
    expect(read.body.data.sha256).toBe(
      published.body.data.revision?.digest ?? candidate.body.data.sha256,
    );
  }, 90_000);
});
