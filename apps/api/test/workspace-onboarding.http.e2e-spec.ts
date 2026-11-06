/**
 * Workspace onboarding over the real AppModule HTTP stack and an explicitly
 * guarded disposable PostgreSQL database. This file deliberately does not
 * construct onboarding services or replace authentication/authorization.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { workspaceDefinitionDigest } from '../src/projects/workspace-definition-validator';

const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;
const origin = 'http://127.0.0.1:5173';

suite('workspace onboarding through real HTTP and PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let browser: ReturnType<typeof request.agent>;
  let csrf = '';
  let userId = '';
  let projectId = '';
  const sessionIds = new Set<string>();
  const email = `workspace-${randomUUID()}@http.test`;
  const password = `Workspace-${randomUUID()}!`;

  beforeAll(async () => {
    // Refuse to create the app/client unless the explicit URL passes the shared
    // test DB guard (loopback, workmesh_test_* database, workmesh_v1 schema).
    const target = verifiedTestDatabase();
    vi.stubEnv('WORKMESH_V1_DATABASE_URL', target.url);
    vi.stubEnv('WORKMESH_COOKIE_MODE', 'LOCAL_INSECURE');
    vi.stubEnv('WORKMESH_PUBLIC_ORIGIN', origin);
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0]?.name).toBe(target.database);

    const { AppModule } = await import('../src/app.module');
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    browser = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    try {
      if (db) {
        if (projectId) {
          await db.projectWorkspaceDefinition.updateMany({
            where: { projectId },
            data: { currentRevisionId: null },
          });
          await db.auditEvent.deleteMany({ where: { projectId } });
          await db.projectWorkspaceEnrollment.deleteMany({ where: { projectId } });
          await db.idempotentOperation.deleteMany({ where: { projectId } });
          await db.confirmationTicket.deleteMany({ where: { projectId } });
          const revisions = await db.projectWorkspaceDefinitionRevision.findMany({
            where: { projectId },
            select: { id: true },
          });
          await db.projectWorkspaceDefinitionRevisionRepository.deleteMany({
            where: { revisionId: { in: revisions.map((revision) => revision.id) } },
          });
          await db.projectWorkspaceDefinitionRevision.deleteMany({ where: { projectId } });
          await db.projectWorkspaceDefinition.deleteMany({ where: { projectId } });
          await db.projectRepositoryLocator.deleteMany({ where: { projectId } });
          await db.projectRepository.deleteMany({ where: { projectId } });
          await db.principalStamp.deleteMany({ where: { projectId } });
          await db.knowledgeBaseGrant.deleteMany({ where: { projectId } });
          await db.knowledgeBase.deleteMany({ where: { projectId } });
          await db.projectRoleAssignment.deleteMany({ where: { projectId } });
          await db.projectMember.deleteMany({ where: { projectId } });
          await db.projectRole.deleteMany({ where: { projectId } });
          await db.project.delete({ where: { id: projectId } });
        }
        if (userId) {
          await db.webSession.deleteMany({
            where: { OR: [{ userId }, { id: { in: [...sessionIds] } }] },
          });
          await db.principalStamp.deleteMany({ where: { userId } });
          await db.user.delete({ where: { id: userId } });
        }
      }
    } finally {
      await app?.close();
      await db?.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  function remember(response: request.Response) {
    const data = response.body?.data;
    if (typeof data?.csrfToken === 'string') csrf = data.csrfToken;
    if (typeof data?.session?.csrfToken === 'string') csrf = data.session.csrfToken;
    for (const cookie of response.headers['set-cookie'] ?? []) {
      const match = /wm_session=wm_s1\.([0-9a-f-]{36})\./.exec(cookie);
      if (match) sessionIds.add(match[1]!);
    }
    return response;
  }

  function humanWrite(method: 'post' | 'put', path: string, body: object, key?: string) {
    let call = browser[method](`/api/v1${path}`).set('Origin', origin).set('X-CSRF-Token', csrf);
    if (key) call = call.set('Idempotency-Key', key);
    return call.send(body).then(remember);
  }

  async function issueTicket(binding: {
    action: string;
    projectId: string;
    targetType: string;
    targetId: string;
    expectedVersion: number;
    roleSlot: null;
    payload: Record<string, unknown>;
  }) {
    const preview = await humanWrite('post', '/auth/action-previews', binding);
    expect(preview.status).toBe(201);
    expect(preview.body.data.actionDigest).toMatch(/^[0-9a-f]{64}$/);
    const issued = await humanWrite('post', '/auth/confirmation-tickets', {
      ...binding,
      actionDigest: preview.body.data.actionDigest,
      password,
    });
    expect(issued.status).toBe(201);
    expect(issued.body.data.ticketId).toBeTruthy();
    expect(issued.body.data.ticketSecret).toBeTruthy();
    return {
      ticketId: issued.body.data.ticketId as string,
      ticketSecret: issued.body.data.ticketSecret as string,
    };
  }

  it('registers a HUMAN, declares and publishes a repository-backed revision, then consumes a one-time code anonymously', async () => {
    // Establish a real anonymous browser session, then register through the
    // account controller so the subsequent project writes use an actual HUMAN session.
    const bootstrap = remember(await browser.get('/api/v1/auth/session'));
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.data.authenticated).toBe(false);
    expect(csrf).toBeTruthy();
    expect((await request(app.getHttpServer()).get('/api/v1/auth/me')).body.error).toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    const unauthorized = await request(app.getHttpServer()).get('/api/v1/projects');
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body).toMatchObject({
      error: { code: 'AUTH_REQUIRED', requestId: expect.any(String) },
    });
    expect(unauthorized.body.data).toBeUndefined();
    expect(unauthorized.body.meta).toBeUndefined();
    expect(unauthorized.headers['x-request-id']).toBe(unauthorized.body.error.requestId);

    const missingCsrf = await browser
      .post('/api/v1/projects')
      .set('Origin', origin)
      .send({ name: 'must reject', key: 'MUSTRE' });
    expect(missingCsrf.status).toBe(403);
    expect(missingCsrf.body.error).toMatchObject({ code: 'CSRF_FAILED' });
    const mismatchedOrigin = await browser
      .post('/api/v1/projects')
      .set('Origin', 'http://evil.example')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'must reject', key: 'ORIGIN' });
    expect(mismatchedOrigin.status).toBe(403);
    expect(mismatchedOrigin.body.error).toMatchObject({
      code: 'UNSAFE_ORIGIN',
      requestId: expect.any(String),
    });

    const registered = await humanWrite('post', '/auth/register', {
      email,
      password,
      name: 'Workspace HTTP operator',
    });
    expect(registered.status).toBe(201);
    expect(registered.body).toMatchObject({
      data: { user: { email }, session: { csrfToken: expect.any(String) } },
      meta: { requestId: expect.any(String) },
    });
    userId = registered.body.data.user.id;

    const suffix = randomBytes(3)
      .toString('hex')
      .toUpperCase()
      .replace(/[0-9]/g, (digit) => 'ABCDEF'[Number(digit) % 6]!);
    const createdProject = await humanWrite('post', '/projects', {
      name: 'Workspace HTTP acceptance',
      key: `W${suffix.slice(0, 5)}`,
    });
    expect(createdProject.status).toBe(201);
    projectId = createdProject.body.data.id as string;
    expect(
      await db.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      }),
    ).toMatchObject({ role: 'OWNER' });

    const invalidDto = await humanWrite(
      'post',
      `/projects/${projectId}/workspace-definition/validate`,
      {
        definition: 'not-an-object',
      },
    );
    expect(invalidDto.status).toBe(400);
    expect(invalidDto.body.error).toMatchObject({ code: 'REQUEST_REJECTED' });
    expect(invalidDto.body.data).toBeUndefined();

    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { version: true },
    });
    const locator = `https://github.com/workmesh-http/${suffix.toLowerCase()}.git`;
    const declarationBinding = {
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: project.version,
      roleSlot: null as null,
      payload: { locator, targetRepositoryId: null, displayName: 'HTTP acceptance repo' },
    };
    const declarationTicket = await issueTicket(declarationBinding);
    const declarationPath = `/projects/${projectId}/repositories/declarations`;
    const declarationKey = randomUUID();
    const declarationRequest = {
      expectedProjectVersion: project.version,
      locator,
      displayName: 'HTTP acceptance repo',
      confirmation: declarationTicket,
    };
    const declarations = await Promise.all([
      humanWrite('post', declarationPath, declarationRequest, declarationKey),
      humanWrite('post', declarationPath, declarationRequest, declarationKey),
    ]);
    expect(declarations.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(declarations.map((response) => response.body.data.replayed).sort()).toEqual([
      false,
      true,
    ]);
    const declaration = declarations.find((response) => response.status === 201)!;
    const declarationConflict = await humanWrite(
      'post',
      declarationPath,
      { ...declarationRequest, displayName: 'different name' },
      declarationKey,
    );
    expect(declarationConflict.status).toBe(409);
    expect(declarationConflict.body.error.code).toBe('IDEMPOTENCY_DIGEST_CONFLICT');
    expect(declaration.status).toBe(201);
    expect(declaration.body).toMatchObject({
      data: { identityMode: 'DECLARED', canonicalLocator: locator, replayed: false },
      meta: { requestId: expect.any(String) },
    });
    const repositoryId = declaration.body.data.repositoryId as string;

    const definition = {
      schemaVersion: '1.0',
      projectId,
      layout: { kind: 'SINGLE_ROOT' },
      repositories: [
        {
          key: 'app',
          projectRepositoryId: repositoryId,
          suggestedPath: '.',
          defaultRef: null,
          description: null,
        },
      ],
      relations: [],
      roleHints: {},
      contextPolicy: { requiredDocumentIds: [], roleDocumentIds: {}, repositoryDocuments: [] },
    };
    const digest = workspaceDefinitionDigest(definition);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    const draftRequest = { expectedDefinitionVersion: 0, payloadDigest: digest, definition };
    const missingIdempotencyKey = await humanWrite(
      'put',
      `/projects/${projectId}/workspace-definition/draft`,
      draftRequest,
    );
    expect(missingIdempotencyKey.status).toBe(400);
    expect(missingIdempotencyKey.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED', requestId: expect.any(String) },
    });
    expect(missingIdempotencyKey.body.data).toBeUndefined();
    expect(missingIdempotencyKey.body.meta).toBeUndefined();

    const draftKey = randomUUID();
    const drafts = await Promise.all([
      humanWrite(
        'put',
        `/projects/${projectId}/workspace-definition/draft`,
        draftRequest,
        draftKey,
      ),
      humanWrite(
        'put',
        `/projects/${projectId}/workspace-definition/draft`,
        draftRequest,
        draftKey,
      ),
    ]);
    expect(drafts.map((response) => response.status)).toEqual([200, 200]);
    expect(drafts.map((response) => response.body.data.replayed).sort()).toEqual([false, true]);
    const draft = drafts.find((response) => !response.body.data.replayed)!;
    expect(draft.status).toBe(200);
    expect(draft.body.data).toMatchObject({
      definitionVersion: 1,
      payloadDigest: digest,
      replayed: false,
    });
    const draftReplay = await humanWrite(
      'put',
      `/projects/${projectId}/workspace-definition/draft`,
      draftRequest,
      draftKey,
    );
    expect(draftReplay.status).toBe(200);
    expect(draftReplay.body.data).toMatchObject({
      definitionVersion: 1,
      payloadDigest: digest,
      replayed: true,
    });
    const differentDraft = {
      ...definition,
      repositories: definition.repositories.map((repository) => ({
        ...repository,
        suggestedPath: 'src',
      })),
    };
    const differentDraftDigest = workspaceDefinitionDigest(differentDraft);
    const draftConflict = await humanWrite(
      'put',
      `/projects/${projectId}/workspace-definition/draft`,
      {
        expectedDefinitionVersion: 0,
        payloadDigest: differentDraftDigest,
        definition: differentDraft,
      },
      draftKey,
    );
    expect(draftConflict.status).toBe(409);
    expect(draftConflict.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_DIGEST_CONFLICT', requestId: expect.any(String) },
    });
    expect(draftConflict.body.data).toBeUndefined();
    expect(draftConflict.body.meta).toBeUndefined();

    const validation = await humanWrite(
      'post',
      `/projects/${projectId}/workspace-definition/validate`,
      {},
    );
    expect(validation.status).toBe(200);
    expect(validation.body.data.valid).toBe(true);
    const currentProject = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { version: true },
    });
    const publishBinding = {
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: currentProject.version,
      roleSlot: null as null,
      payload: { expectedDefinitionVersion: 1, payloadDigest: digest },
    };
    const publishTicket = await issueTicket(publishBinding);
    const publishPath = `/projects/${projectId}/workspace-definition/publish`;
    const publishKey = randomUUID();
    const publishRequest = {
      expectedProjectVersion: currentProject.version,
      expectedDefinitionVersion: 1,
      payloadDigest: digest,
      confirmation: publishTicket,
    };
    const publishes = await Promise.all([
      humanWrite('post', publishPath, publishRequest, publishKey),
      humanWrite('post', publishPath, publishRequest, publishKey),
    ]);
    expect(publishes.map((response) => response.status)).toEqual([200, 200]);
    expect(publishes.map((response) => response.body.data.replayed).sort()).toEqual([false, true]);
    const published = publishes.find((response) => !response.body.data.replayed)!;
    const publishConflict = await humanWrite(
      'post',
      publishPath,
      { ...publishRequest, expectedDefinitionVersion: 2 },
      publishKey,
    );
    expect(publishConflict.status).toBe(409);
    expect(publishConflict.body.error.code).toBe('IDEMPOTENCY_DIGEST_CONFLICT');
    expect(published.status).toBe(200);
    expect(published.body.data).toMatchObject({ definitionVersion: 2, digest, revisionNo: 1 });
    const revisionId = published.body.data.revisionId as string;
    expect(revisionId).toBeTruthy();
    const current = await browser.get(`/api/v1/projects/${projectId}/workspace-definition`);
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({
      data: { revisionId, digest, definitionStatus: 'CONFIGURED' },
      meta: { requestId: expect.any(String) },
    });
    const revision = await browser.get(
      `/api/v1/projects/${projectId}/workspace-definition/revisions/${revisionId}`,
    );
    expect(revision.status).toBe(200);
    expect(revision.body.data).toMatchObject({ revisionId, digest, payload: definition });
    const missingRevision = await browser.get(
      `/api/v1/projects/${projectId}/workspace-definition/revisions/${randomUUID()}`,
    );
    expect(missingRevision.status).toBe(404);
    expect(missingRevision.body).toMatchObject({
      error: { code: 'REVISION_NOT_FOUND', requestId: expect.any(String) },
    });
    expect(missingRevision.body.data).toBeUndefined();
    expect(missingRevision.body.meta).toBeUndefined();
    expect(missingRevision.headers['x-request-id']).toBe(missingRevision.body.error.requestId);

    const issuePath = `/projects/${projectId}/workspace-enrollments`;
    const issueKey = randomUUID();
    const issueAttempts = await Promise.all([
      humanWrite('post', issuePath, { ttlSeconds: 600 }, issueKey),
      humanWrite('post', issuePath, { ttlSeconds: 600 }, issueKey),
    ]);
    expect(issueAttempts.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(issueAttempts.find((response) => response.status === 409)?.body.error.code).toBe(
      'ENROLLMENT_CODE_NOT_REPLAYABLE',
    );
    const issueConflict = await humanWrite('post', issuePath, { ttlSeconds: 601 }, issueKey);
    expect(issueConflict.status).toBe(409);
    expect(issueConflict.body.error.code).toBe('IDEMPOTENCY_DIGEST_CONFLICT');
    const issuedCode = await humanWrite(
      'post',
      `/projects/${projectId}/workspace-enrollments`,
      { ttlSeconds: 600 },
      randomUUID(),
    );
    expect(issuedCode.status).toBe(201);
    expect(issuedCode.body.data.code).toMatch(/^wme_[A-Za-z0-9_-]{43}$/);
    expect(issuedCode.body.data.definitionRevisionId).toBe(revisionId);
    expect(
      JSON.stringify(
        await db.projectWorkspaceEnrollment.findFirstOrThrow({
          where: { projectId },
          select: { codeHash: true, definitionRevisionId: true, definitionDigest: true },
        }),
      ),
    ).not.toContain(issuedCode.body.data.code);

    // This is intentionally a raw anonymous HTTP request: no cookie,
    // Authorization, Origin, or CSRF header is attached.
    const anonymous = request(app.getHttpServer());
    const consumed = await anonymous
      .post('/api/v1/workspace-enrollments/consume')
      .send({ code: issuedCode.body.data.code });
    expect(consumed.status).toBe(200);
    expect(consumed.body).toMatchObject({
      data: { projectId, definitionRevisionId: revisionId },
      meta: { requestId: expect.any(String) },
    });
    expect(consumed.headers.authorization).toBeUndefined();
    const repeatedConsume = await anonymous
      .post('/api/v1/workspace-enrollments/consume')
      .send({ code: issuedCode.body.data.code });
    expect(repeatedConsume.status).toBe(409);
    expect(repeatedConsume.body).toMatchObject({
      error: { code: 'ENROLLMENT_CONSUMED', requestId: expect.any(String) },
    });
    expect(repeatedConsume.body.data).toBeUndefined();
    expect(repeatedConsume.body.meta).toBeUndefined();

    // Exercise the real service-level per-(HUMAN, project) issuance limiter via
    // the route. Four requests above have used slots including rejected replays;
    // one fresh key fills the remaining quota before the domain 429.
    for (let index = 0; index < 1; index += 1) {
      const additionalCode = await humanWrite(
        'post',
        `/projects/${projectId}/workspace-enrollments`,
        { ttlSeconds: 600 },
        randomUUID(),
      );
      expect(additionalCode.status).toBe(201);
    }
    const rateLimitedIssue = await humanWrite(
      'post',
      `/projects/${projectId}/workspace-enrollments`,
      { ttlSeconds: 600 },
      randomUUID(),
    );
    expect(rateLimitedIssue.status).toBe(429);
    expect(rateLimitedIssue.body).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        message: 'RATE_LIMITED',
        details: { retryAfterSeconds: expect.any(Number) },
        requestId: expect.any(String),
      },
    });
    expect(rateLimitedIssue.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(rateLimitedIssue.body.data).toBeUndefined();
    expect(rateLimitedIssue.body.meta).toBeUndefined();

    // A structurally valid draft with a missing referenced document reaches the
    // real publish validator and must fail with its domain 422 envelope before
    // consuming the confirmation ticket or creating a revision.
    const badReferenceDefinition = {
      ...definition,
      contextPolicy: { ...definition.contextPolicy, requiredDocumentIds: [randomUUID()] },
    };
    const badReferenceDigest = workspaceDefinitionDigest(badReferenceDefinition);
    const definitionRow = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { version: true },
    });
    const invalidDraft = await humanWrite(
      'put',
      `/projects/${projectId}/workspace-definition/draft`,
      {
        expectedDefinitionVersion: definitionRow.version,
        payloadDigest: badReferenceDigest,
        definition: badReferenceDefinition,
      },
      randomUUID(),
    );
    expect(invalidDraft.status).toBe(200);
    const publishProject = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { version: true },
    });
    const invalidTicket = await issueTicket({
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: publishProject.version,
      roleSlot: null,
      payload: {
        expectedDefinitionVersion: invalidDraft.body.data.definitionVersion,
        payloadDigest: badReferenceDigest,
      },
    });
    const revisionsBeforeInvalidPublish = await db.projectWorkspaceDefinitionRevision.count({
      where: { projectId },
    });
    const invalidPublish = await humanWrite(
      'post',
      `/projects/${projectId}/workspace-definition/publish`,
      {
        expectedProjectVersion: publishProject.version,
        expectedDefinitionVersion: invalidDraft.body.data.definitionVersion,
        payloadDigest: badReferenceDigest,
        confirmation: invalidTicket,
      },
      randomUUID(),
    );
    expect(invalidPublish.status).toBe(422);
    expect(invalidPublish.body).toMatchObject({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'DEFINITION_INVALID',
        details: {
          issues: expect.arrayContaining([expect.objectContaining({ code: 'DOCUMENT_NOT_FOUND' })]),
        },
        requestId: expect.any(String),
      },
    });
    expect(invalidPublish.body.data).toBeUndefined();
    expect(invalidPublish.body.meta).toBeUndefined();
    expect(await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } })).toBe(
      revisionsBeforeInvalidPublish,
    );
    expect(
      await db.confirmationTicket.findUniqueOrThrow({
        where: { id: invalidTicket.ticketId },
        select: { consumedAt: true },
      }),
    ).toEqual({ consumedAt: null });
  });
});
