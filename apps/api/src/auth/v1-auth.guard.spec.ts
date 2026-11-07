import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { hashSecret } from './v1-policy';
import type { V1AuthRepository, V1CredentialRecord, V1SessionRecord } from './v1-auth.repository';
import { V1AuthService } from './v1-auth.service';
import { V1AuthGuard, type V1Request } from './v1-auth.guard';

const secret = randomBytes(32).toString('base64url');
const sessionId = '11111111-1111-4111-8111-111111111111';
const credentialId = '22222222-2222-4222-8222-222222222222';
const now = new Date();
const CSRF_TOKEN = randomBytes(32).toString('base64url');
const PUBLIC_ORIGIN = 'http://127.0.0.1:5173';

const user = { id: 'user-1', isActive: true, authVersion: 3 };

function repository(): V1AuthRepository {
  const session: V1SessionRecord = {
    id: sessionId,
    userId: user.id,
    tokenHash: hashSecret(secret),
    csrfTokenHash: hashSecret(CSRF_TOKEN),
    userAuthVersion: 3,
    expiresAt: new Date(now.getTime() + 60_000),
    idleExpiresAt: new Date(now.getTime() + 30_000),
    revokedAt: null,
    user,
  };
  const credential: V1CredentialRecord = {
    id: credentialId,
    userId: user.id,
    projectId: 'project-1',
    roleId: 'role-1',
    name: 'cli',
    tokenHash: hashSecret(secret),
    scopes: ['task:claim', 'task:deliver', 'task:read'],
    userAuthVersion: 3,
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    user,
  };
  return {
    async findSession(id) {
      return id === sessionId ? session : null;
    },
    async findCredential(id) {
      return id === credentialId ? credential : null;
    },
    async touchSession() {},
    async findUserByEmail() {
      return null;
    },
    async findUser() {
      return null;
    },
    async createUser() {
      throw new Error('not used');
    },
    async createSession() {},
    async updateSessionCsrf() {},
    async revokeSession() {},
    async listCredentials() {
      return [];
    },
    async revokeCredential() {
      return false;
    },
    async createCredential() {
      throw new Error('not used');
    },
    async createCliAuthorization() {
      throw new Error('not used');
    },
    async findCliAuthorizationById() {
      return null;
    },
    async findCliAuthorizationByDeviceCodeHash() {
      return null;
    },
    async findCliAuthorizationByUserCodeHash() {
      return null;
    },
    async recordCliAuthorizationView() {},
    async hasCliAuthorizationView() {
      return false;
    },
    async approveCliAuthorization() {
      return null;
    },
    async denyCliAuthorization() {
      return null;
    },
    async markCliAuthorizationIssued() {
      return null;
    },
    async reservePasswordRateWindow() {
      throw new Error('not used');
    },
    async releasePasswordRateWindow() {
      throw new Error('not used');
    },
    async bumpRateWindow() {
      return 1;
    },
  };
}

function executionContext(request: Partial<V1Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}

const sessionCookieWm = `wm_session=wm_s1.${sessionId}.${secret}`;
const agentBearer = `Bearer wm_a1.${credentialId}.${secret}`;

async function authenticate(request: Partial<V1Request>) {
  process.env.WORKMESH_COOKIE_MODE = 'LOCAL_INSECURE';
  process.env.WORKMESH_PUBLIC_ORIGIN = PUBLIC_ORIGIN;
  const guard = new V1AuthGuard(new V1AuthService(repository()));
  await guard.canActivate(executionContext(request));
  return (request as V1Request).v1Principal;
}

describe('V1AuthGuard real request path', () => {
  it('rejects a HUMAN cookie write without Origin', async () => {
    await expect(
      authenticate({
        method: 'POST',
        url: '/v1/tasks/t1/claims',
        headers: { cookie: sessionCookieWm },
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ORIGIN', status: 403 });
  });

  it('rejects a HUMAN cookie write with a mismatched Origin', async () => {
    await expect(
      authenticate({
        method: 'POST',
        url: '/v1/tasks/t1/claims',
        headers: { cookie: sessionCookieWm, origin: 'https://evil.test' },
      }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ORIGIN', status: 403 });
  });

  it('rejects a HUMAN cookie write with a valid Origin but missing CSRF', async () => {
    await expect(
      authenticate({
        method: 'POST',
        url: '/v1/tasks/t1/claims',
        headers: { cookie: sessionCookieWm, origin: PUBLIC_ORIGIN },
      }),
    ).rejects.toMatchObject({ code: 'CSRF_FAILED', status: 403 });
  });

  it.each(['/v1/tasks/t1/claims', '/v1/tasks/t1/context', '/v1/tasks/t1/deliveries'])(
    'lets an AGENT Bearer write to %s without Origin',
    async (url) => {
      const principal = await authenticate({
        method: 'POST',
        url,
        headers: { authorization: agentBearer },
      });
      expect(principal).toMatchObject({
        kind: 'AGENT',
        projectId: 'project-1',
        roleIds: ['role-1'],
      });
    },
  );

  it('rejects mixing HUMAN session cookie and AGENT Bearer', async () => {
    await expect(
      authenticate({
        method: 'POST',
        url: '/v1/tasks/t1/claims',
        headers: { cookie: sessionCookieWm, authorization: agentBearer, origin: PUBLIC_ORIGIN },
      }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_CONFLICT', status: 401 });
  });

  it('rejects a revoked AGENT credential even without Origin', async () => {
    const repo = repository();
    const original = await repo.findCredential(credentialId);
    const revokedRepo: V1AuthRepository = {
      ...repo,
      async findCredential(id) {
        return id === credentialId && original ? { ...original, revokedAt: now } : null;
      },
    };
    process.env.WORKMESH_COOKIE_MODE = 'LOCAL_INSECURE';
    process.env.WORKMESH_PUBLIC_ORIGIN = PUBLIC_ORIGIN;
    const guard = new V1AuthGuard(new V1AuthService(revokedRepo));
    await expect(
      guard.canActivate(
        executionContext({
          method: 'POST',
          url: '/v1/tasks/t1/claims',
          headers: { authorization: agentBearer },
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', status: 401 });
  });
});
