import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { hashSecret } from './v1-policy';
import type { V1AuthRepository, V1CredentialRecord, V1SessionRecord } from './v1-auth.repository';
import { V1AuthService } from './v1-auth.service';

const secret = randomBytes(32).toString('base64url');
const sessionId = '11111111-1111-4111-8111-111111111111';
const credentialId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-11-01T00:00:00.000Z');
const later = (ms: number) => new Date(now.getTime() + ms);

const user = { id: 'user-1', isActive: true, authVersion: 3 };
const CSRF_TOKEN = randomBytes(32).toString('base64url');

function repository(
  overrides: Partial<V1AuthRepository> = {},
): V1AuthRepository & { touched: string[] } {
  const session: V1SessionRecord = {
    id: sessionId,
    userId: user.id,
    tokenHash: hashSecret(secret),
    csrfTokenHash: hashSecret(CSRF_TOKEN),
    userAuthVersion: 3,
    expiresAt: later(60_000),
    idleExpiresAt: later(30_000),
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
    scopes: ['knowledge:read', 'knowledge:propose'],
    userAuthVersion: 3,
    expiresAt: later(60_000),
    revokedAt: null,
    user,
  };
  const touched: string[] = [];
  return {
    touched,
    async findSession(id) {
      return id === sessionId ? session : null;
    },
    async findCredential(id) {
      return id === credentialId ? credential : null;
    },
    async touchSession(id) {
      touched.push(id);
    },
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
    ...overrides,
  };
}

const base = { publicOrigin: 'https://workmesh.local', now, method: 'GET' };
const sessionCookie = `wm_s1.${sessionId}.${secret}`;
const agentBearer = `Bearer wm_a1.${credentialId}.${secret}`;

describe('v1 auth service', () => {
  it('authenticates a human session and records activity', async () => {
    const repo = repository();
    const service = new V1AuthService(repo);
    const principal = await service.authenticate({ ...base, sessionCookie });
    expect(principal).toMatchObject({ kind: 'HUMAN', userId: 'user-1' });
    expect(repo.touched).toEqual([sessionId]);
  });

  it('rejects a session whose secret does not match the stored hash', async () => {
    const service = new V1AuthService(repository());
    await expect(
      service.authenticate({
        ...base,
        sessionCookie: `wm_s1.${sessionId}.${randomBytes(32).toString('base64url')}`,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects expired, revoked and auth-version-stale sessions', async () => {
    const expired = repository({
      findSession: async () => ({
        ...(await repository().findSession(sessionId))!,
        idleExpiresAt: new Date(now.getTime() - 1),
      }),
    });
    await expect(
      new V1AuthService(expired).authenticate({ ...base, sessionCookie }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    const revoked = repository({
      findSession: async () => ({
        ...(await repository().findSession(sessionId))!,
        revokedAt: now,
      }),
    });
    await expect(
      new V1AuthService(revoked).authenticate({ ...base, sessionCookie }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    const stale = repository({
      findSession: async () => ({
        ...(await repository().findSession(sessionId))!,
        userAuthVersion: 2,
      }),
    });
    await expect(
      new V1AuthService(stale).authenticate({ ...base, sessionCookie }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects mixed agent bearer and human session credentials', async () => {
    const service = new V1AuthService(repository());
    await expect(
      service.authenticate({ ...base, sessionCookie, authorization: agentBearer }),
    ).rejects.toMatchObject({ code: 'CREDENTIAL_CONFLICT' });
  });

  it('grants agent scopes only from the server-side credential record', async () => {
    const service = new V1AuthService(repository());
    const principal = await service.authenticate({ ...base, authorization: agentBearer });
    expect(principal).toMatchObject({ kind: 'AGENT', projectId: 'project-1', roleIds: ['role-1'] });
    expect(principal.scopes).toEqual(['knowledge:read', 'knowledge:propose']);
  });

  it('rejects request bodies that assert identity or scopes', async () => {
    const service = new V1AuthService(repository());
    await expect(
      service.authenticate({
        ...base,
        authorization: agentBearer,
        body: { roleIds: ['role-9'], scopes: ['knowledge:publish'] },
      }),
    ).rejects.toMatchObject({ code: 'SELF_ASSERTED_IDENTITY' });
  });

  it('requires a matching origin and CSRF token for unsafe methods', async () => {
    const service = new V1AuthService(repository());
    await expect(
      service.authenticate({ ...base, method: 'POST', sessionCookie, origin: 'https://evil.test' }),
    ).rejects.toMatchObject({ code: 'UNSAFE_ORIGIN' });
    await expect(
      service.authenticate({
        ...base,
        method: 'POST',
        sessionCookie,
        origin: 'https://workmesh.local',
      }),
    ).rejects.toMatchObject({ code: 'CSRF_FAILED' });
    // 与会话 csrfTokenHash 匹配的 token 才通过
    await expect(
      service.authenticate({
        ...base,
        method: 'POST',
        sessionCookie,
        origin: 'https://workmesh.local',
        csrfCookie: CSRF_TOKEN,
        csrfHeader: CSRF_TOKEN,
      }),
    ).resolves.toMatchObject({ kind: 'HUMAN' });
    // 两值相等但摘要不匹配
    const random = randomBytes(32).toString('base64url');
    await expect(
      service.authenticate({
        ...base,
        method: 'POST',
        sessionCookie,
        origin: 'https://workmesh.local',
        csrfCookie: random,
        csrfHeader: random,
      }),
    ).rejects.toMatchObject({ code: 'CSRF_FAILED' });
  });
});
