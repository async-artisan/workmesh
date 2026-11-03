import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';

const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;

suite('real account and device authorization HTTP boundaries', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let browser: ReturnType<typeof request.agent>;
  let csrf = '';
  let userId = '';
  let projectId = '';
  let roleId = '';
  let credentialId = '';
  const sessionIds = new Set<string>();
  const authorizationIds: string[] = [];
  const invitedUserIds: string[] = [];
  const origin = 'http://127.0.0.1:5173';
  const email = `device-${randomUUID()}@http.test`;
  const password = `Account-${randomUUID()}!`;
  const verifier = randomBytes(32).toString('base64url');
  const credentialSecret = randomBytes(32).toString('base64url');
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  let device: { authorizationId: string; deviceCode: string; userCode: string };

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    vi.stubEnv('WORKMESH_V1_DATABASE_URL', target.url);
    vi.stubEnv('WORKMESH_COOKIE_MODE', 'LOCAL_INSECURE');
    vi.stubEnv('WORKMESH_PUBLIC_ORIGIN', origin);
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);
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
        await db.cliAuthorizationView.deleteMany({
          where: { authorizationRequestId: { in: authorizationIds } },
        });
        await db.cliAuthorizationRequest.deleteMany({ where: { id: { in: authorizationIds } } });
        if (userId) {
          if (projectId) {
            await db.confirmationTicket.deleteMany({ where: { projectId } });
            await db.idempotentOperation.deleteMany({ where: { projectId } });
            await db.auditEvent.deleteMany({ where: { projectId } });
            await db.projectInvitation.deleteMany({ where: { projectId } });
          }
          await db.auditEvent.deleteMany({ where: { actorStamp: { userId } } });
          await db.principalStamp.deleteMany({ where: { userId } });
          await db.agentCredential.deleteMany({ where: { userId } });
        }
        if (projectId) {
          await db.knowledgeBaseGrant.deleteMany({ where: { projectId } });
          await db.knowledgeBase.deleteMany({ where: { projectId } });
          await db.projectRoleAssignment.deleteMany({ where: { projectId } });
          await db.projectRole.deleteMany({ where: { projectId } });
          await db.projectMember.deleteMany({ where: { projectId } });
          await db.project.delete({ where: { id: projectId } });
        }
        await db.webSession.deleteMany({
          where: {
            OR: [
              { id: { in: [...sessionIds] } },
              { userId: { in: invitedUserIds } },
              ...(userId ? [{ userId }] : []),
            ],
          },
        });
        await db.user.deleteMany({ where: { id: { in: invitedUserIds } } });
        if (userId) await db.user.delete({ where: { id: userId } });
      }
    } finally {
      await app?.close();
      await db?.$disconnect();
      vi.unstubAllEnvs();
    }
  });

  function remember(response: request.Response) {
    const data = response.body.data;
    if (data?.csrfToken) csrf = data.csrfToken;
    if (data?.session?.csrfToken) csrf = data.session.csrfToken;
    if (data?.sessionId) sessionIds.add(data.sessionId);
    for (const cookie of response.headers['set-cookie'] ?? []) {
      const match = /wm_session=wm_s1\.([0-9a-f-]{36})\./.exec(cookie);
      if (match) sessionIds.add(match[1]);
    }
    return response;
  }

  const post = (path: string, body: object) =>
    browser
      .post(`/api/v1${path}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send(body)
      .then(remember);

  async function newDevice() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/cli-authorizations')
      .send({
        clientName: 'Database acceptance',
        codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
        codeChallengeMethod: 'S256',
        credentialSecretHash: hash(credentialSecret),
      });
    expect(response.status).toBe(201);
    authorizationIds.push(response.body.data.authorizationId);
    return response.body.data;
  }

  it('requires identity and exact Origin/CSRF before accepting anonymous writes', async () => {
    expect((await browser.get('/api/v1/auth/me')).status).toBe(401);
    const bootstrap = remember(await browser.get('/api/v1/auth/session'));
    expect(bootstrap.body.data.authenticated).toBe(false);
    expect(
      (await browser.post('/api/v1/auth/register').set('Origin', origin).send({ email, password }))
        .status,
    ).toBe(403);
    expect(
      (
        await browser
          .post('/api/v1/auth/register')
          .set('Origin', 'https://other.test')
          .set('X-CSRF-Token', csrf)
          .send({ email, password })
      ).status,
    ).toBe(403);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  it('registers with hashed secrets, rotates the session and refuses identity overposting', async () => {
    const response = await post('/auth/register', {
      email: email.toUpperCase(),
      password,
      name: 'HTTP device account',
    });
    expect(response.status).toBe(201);
    userId = response.body.data.user.id;
    const stored = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(stored.email).toBe(email);
    expect(stored.passwordHash).not.toBe(password);
    expect(stored.passwordHash).toMatch(/^\$2/);
    expect((await browser.get('/api/v1/auth/me')).body.data.user.email).toBe(email);
    const rejected = await post('/projects', {
      name: 'forged',
      key: 'FORGED',
      createdById: randomUUID(),
    });
    expect(rejected.status).toBe(400);
    expect(await db.project.count({ where: { createdById: userId } })).toBe(0);
  });

  it('creates a real project with explicit roles and rejects duplicate project keys', async () => {
    const key = randomBytes(3).toString('hex').replace(/[0-9]/g, 'A').toUpperCase();
    const created = await post('/projects', { name: 'Device HTTP fixture', key });
    expect(created.status).toBe(201);
    projectId = created.body.data.id;
    const roles = await browser.get(`/api/v1/projects/${projectId}/roles`);
    expect(roles.body.data).toHaveLength(6);
    roleId = roles.body.data.find((role: { key: string }) => role.key === 'backend').id;
    const members = await browser.get(`/api/v1/projects/${projectId}/members`);
    expect(members.body.data).toEqual([expect.objectContaining({ id: userId, role: 'OWNER' })]);
    expect(
      (await browser.get('/api/v1/projects')).body.data.some(
        (p: { id: string }) => p.id === projectId,
      ),
    ).toBe(true);
    expect((await post('/projects', { name: 'duplicate', key })).status).toBe(409);
    expect(await db.project.count({ where: { createdById: userId } })).toBe(1);
  });

  it('requires device proof and browser viewing before granting a scoped credential', async () => {
    device = await newDevice();
    const poll = (codeVerifier: string) =>
      request(app.getHttpServer()).post('/api/v1/auth/cli-authorizations/poll').send({
        authorizationId: device.authorizationId,
        deviceCode: device.deviceCode,
        codeVerifier,
      });
    expect((await poll('x'.repeat(43))).status).toBe(401);
    expect((await poll(verifier)).body.data.status).toBe('PENDING');
    const approval = {
      expectedVersion: 1,
      projectId,
      roleId,
      scopes: ['project:read'],
      expiresInDays: 1,
    };
    expect(
      (await post(`/auth/cli-authorizations/${device.authorizationId}/approve`, approval)).status,
    ).toBe(404);
    const lookup = await post('/auth/cli-authorizations/lookup', { userCode: device.userCode });
    expect(lookup.body.data.status).toBe('PENDING');
    expect(
      (
        await post(`/auth/cli-authorizations/${device.authorizationId}/approve`, {
          ...approval,
          scopes: ['not:a-scope'],
        })
      ).status,
    ).toBe(422);
    expect(
      (await post(`/auth/cli-authorizations/${device.authorizationId}/approve`, approval)).body.data
        .status,
    ).toBe('APPROVED');
    const issued = await poll(verifier);
    expect(issued.body.data.status).toBe('ISSUED');
    credentialId = issued.body.data.credential.credentialId;
    expect((await poll(verifier)).body.data.credential.credentialId).toBe(credentialId);
    const stored = await db.agentCredential.findUniqueOrThrow({ where: { id: credentialId } });
    expect(stored.tokenHash).toBe(hash(credentialSecret));
    expect(stored.scopes).toEqual(['project:read']);
    expect(await db.agentCredential.count({ where: { userId, revokedAt: null } })).toBe(1);
  });

  it('lists and revokes only owned credentials, immediately rejecting the old bearer', async () => {
    const bearer = `Bearer wm_a1.${credentialId}.${credentialSecret}`;
    expect(
      (await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', bearer))
        .status,
    ).toBe(200);
    expect(
      (
        await browser
          .delete(`/api/v1/auth/credentials/${randomUUID()}`)
          .set('Origin', origin)
          .set('X-CSRF-Token', csrf)
      ).status,
    ).toBe(404);
    const credentials = await browser.get('/api/v1/auth/credentials');
    expect(credentials.body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: credentialId })]),
    );
    const revoked = await browser
      .delete(`/api/v1/auth/credentials/${credentialId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf);
    expect(revoked.status).toBe(200);
    expect(
      (await db.agentCredential.findUniqueOrThrow({ where: { id: credentialId } })).revokedAt,
    ).not.toBeNull();
    const rejected = await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', bearer);
    expect(rejected.status).toBe(401);
  });

  it('persists denial and refuses issuance after a browser denies the device', async () => {
    const deniedDevice = await newDevice();
    await post('/auth/cli-authorizations/lookup', { userCode: deniedDevice.userCode });
    const denied = await post(`/auth/cli-authorizations/${deniedDevice.authorizationId}/deny`, {
      expectedVersion: 1,
    });
    expect(denied.body.data.status).toBe('DENIED');
    const polled = await request(app.getHttpServer())
      .post('/api/v1/auth/cli-authorizations/poll')
      .send({
        authorizationId: deniedDevice.authorizationId,
        deviceCode: deniedDevice.deviceCode,
        codeVerifier: verifier,
      });
    expect(polled.status).toBe(403);
    expect(await db.agentCredential.count({ where: { userId } })).toBe(1);
  });

  it('logout revokes the session and login restores identity only after password verification', async () => {
    expect((await post('/auth/logout', {})).status).toBe(201);
    expect((await browser.get('/api/v1/auth/me')).status).toBe(401);
    remember(await browser.get('/api/v1/auth/session'));
    expect((await post('/auth/login', { email, password: 'incorrect' })).status).toBe(401);
    expect((await post('/auth/login', { email, password })).status).toBe(201);
    expect((await browser.get('/api/v1/auth/me')).body.data.user.email).toBe(email);
  });
  async function createInvitation(inviteEmail: string) {
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const binding = {
      action: 'PROJECT_INVITATION_CREATE',
      projectId,
      targetType: 'PROJECT_INVITATION',
      targetId: projectId,
      expectedVersion: project.version,
      roleSlot: null,
      payload: { roleIds: [roleId], email: inviteEmail.toLowerCase(), expiresInHours: 72 },
    };
    const preview = await post('/auth/action-previews', binding);
    expect(preview.status).toBe(201);
    const confirmation = await post('/auth/confirmation-tickets', {
      ...binding,
      actionDigest: preview.body.data.actionDigest,
      password,
    });
    expect(confirmation.status).toBe(201);
    const response = await browser
      .post(`/api/v1/projects/${projectId}/invitations`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .set('Idempotency-Key', randomUUID())
      .send({
        roleKeys: ['backend'],
        email: inviteEmail,
        expiresInHours: 72,
        expectedVersion: project.version,
        confirmation: {
          ticketId: confirmation.body.data.ticketId,
          ticketSecret: confirmation.body.data.ticketSecret,
        },
      });
    expect(response.status).toBe(201);
    return response.body.data as { id: string; token: string };
  }

  it('invites a new teammate through confirmed HTTP actions and assigns only the requested project role', async () => {
    const inviteEmail = `invited-${randomUUID()}@http.test`;
    const invitation = await createInvitation(inviteEmail);
    const stored = await db.projectInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.tokenHash).not.toBe(invitation.token);
    const listing = await browser.get(`/api/v1/projects/${projectId}/invitations`);
    expect(listing.status).toBe(200);
    expect(JSON.stringify(listing.body)).not.toContain(invitation.token);
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/invitations/${invitation.token}`)).body.data,
    ).toMatchObject({ status: 'PENDING', roles: [{ key: 'backend' }] });
    const invitee = request.agent(app.getHttpServer());
    const bootstrap = await invitee.get('/api/v1/auth/session');
    for (const cookie of bootstrap.headers['set-cookie'] ?? []) {
      const match = /wm_session=wm_s1\.([0-9a-f-]{36})\./.exec(cookie);
      if (match) sessionIds.add(match[1]);
    }
    const inviteCsrf = bootstrap.body.data.csrfToken;
    const accept = (targetEmail: string) =>
      invitee
        .post(`/api/v1/invitations/${invitation.token}/accept`)
        .set('Origin', origin)
        .set('X-CSRF-Token', inviteCsrf)
        .send({ email: targetEmail, password, name: 'Invited teammate' });
    // A bound invitation determines the registration identity; a submitted email
    // cannot substitute a different account (the public API deliberately ignores it).
    const accepted = await accept('ignored-input@http.test');
    if (accepted.body.data?.user?.id) invitedUserIds.push(accepted.body.data.user.id);
    expect(accepted.status).toBe(201);
    expect(accepted.body.data.user.email).toBe(inviteEmail);
    const invitedId = accepted.body.data.user.id;
    expect(
      await db.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId: invitedId } },
      }),
    ).toMatchObject({ role: 'MEMBER', revokedAt: null });
    expect(
      await db.projectRoleAssignment.findMany({ where: { projectId, userId: invitedId } }),
    ).toMatchObject([{ roleId }]);
    expect((await invitee.get('/api/v1/projects')).body.data).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: projectId })]),
    );
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/invitations/${invitation.token}`)).body.data
        .status,
    ).toBe('ACCEPTED');
  });

  it('revokes pending invitations and rejects invitation resolution and acceptance for invalid tokens', async () => {
    const invitation = await createInvitation(`revoked-${randomUUID()}@http.test`);
    expect(
      (await post(`/projects/${projectId}/invitations/${invitation.id}/revoke`, {})).status,
    ).toBe(201);
    expect(
      (await db.projectInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).revokedAt,
    ).not.toBeNull();
    expect(
      (await request(app.getHttpServer()).get(`/api/v1/invitations/${invitation.token}`)).body.data
        .status,
    ).toBe('REVOKED');
    expect((await post(`/invitations/${invitation.token}/join`, {})).status).toBe(410);
    expect(
      (await request(app.getHttpServer()).get('/api/v1/invitations/invalid-token')).status,
    ).toBe(404);
    expect(
      (await post(`/projects/${projectId}/invitations/${randomUUID()}/revoke`, {})).status,
    ).toBe(409);
  });
});
