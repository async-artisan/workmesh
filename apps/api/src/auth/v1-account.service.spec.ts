import { describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { V1AccountService } from './v1-account.service';
import type {
  V1AuthRepository,
  V1CredentialDeviceRecord,
  V1CredentialRecord,
} from './v1-auth.repository';

const now = new Date('2026-11-01T00:00:00.000Z');
const OWN_CREDENTIAL = '11111111-1111-4111-8111-111111111111';
const OTHER_CREDENTIAL = '22222222-2222-4222-8222-222222222222';

function credential(over: Partial<V1CredentialRecord> = {}): V1CredentialRecord {
  return {
    id: OWN_CREDENTIAL,
    userId: 'user-1',
    projectId: 'project-1',
    roleId: 'role-1',
    name: 'cli',
    tokenHash: 'hash',
    scopes: ['task:read'],
    userAuthVersion: 1,
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    user: { id: 'user-1', isActive: true, authVersion: 1 },
    ...over,
  };
}

type Revocation = { credentialId: string; userId: string; revokedAt: Date };

function repository() {
  const credentials = new Map<string, V1CredentialRecord>([
    [OWN_CREDENTIAL, credential()],
    [OTHER_CREDENTIAL, credential({ id: OTHER_CREDENTIAL, userId: 'user-2' })],
  ]);
  const devices = new Map<string, V1CredentialDeviceRecord>();
  const revocations: Revocation[] = [];
  const listedFor: string[] = [];

  const repo: V1AuthRepository = {
    async findSession() {
      return null;
    },
    async findCredential(credentialId) {
      return credentials.get(credentialId) ?? null;
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
    async listCredentials(userId) {
      listedFor.push(userId);
      return [...credentials.values()]
        .filter((item) => item.userId === userId)
        .map((item) => ({
          ...item,
          createdAt: now,
          device: devices.get(item.id) ?? null,
        }));
    },
    async revokeCredential(credentialId, userId, revokedAt) {
      const target = credentials.get(credentialId);
      if (!target || target.userId !== userId || target.revokedAt) return false;
      revocations.push({ credentialId, userId, revokedAt });
      credentials.set(credentialId, { ...target, revokedAt });
      return true;
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
    async bumpRateWindow() {
      return 1;
    },
  };
  return { repo, revocations, listedFor, devices, service: new V1AccountService(repo) };
}

function human(): Principal {
  return { kind: 'HUMAN', userId: 'user-1', scopes: [] };
}

function agent(credentialId = OWN_CREDENTIAL, userId = 'user-1'): Principal {
  return {
    kind: 'AGENT',
    userId,
    agentCredentialId: credentialId,
    projectId: 'project-1',
    roleIds: ['role-1'],
    scopes: ['task:read'],
  };
}

describe('V1AccountService.revokeCredential', () => {
  it('HUMAN 保持原行为：只吊销本人凭据', async () => {
    const { service, revocations } = repository();
    await expect(service.revokeCredential(human(), OWN_CREDENTIAL, now)).resolves.toEqual({
      revoked: true,
    });
    expect(revocations).toEqual([
      { credentialId: OWN_CREDENTIAL, userId: 'user-1', revokedAt: now },
    ]);
  });

  it('HUMAN 吊销不存在或他人的凭据仍返回 404', async () => {
    const { service } = repository();
    await expect(service.revokeCredential(human(), OTHER_CREDENTIAL, now)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('AGENT 可自吊销本凭据，返回 {revoked:true}', async () => {
    const { service, revocations } = repository();
    await expect(service.revokeCredential(agent(), OWN_CREDENTIAL, now)).resolves.toEqual({
      revoked: true,
    });
    expect(revocations).toEqual([
      { credentialId: OWN_CREDENTIAL, userId: 'user-1', revokedAt: now },
    ]);
  });

  it('AGENT 吊销他人凭据返回 404 且不执行吊销', async () => {
    const { service, revocations } = repository();
    await expect(service.revokeCredential(agent(), OTHER_CREDENTIAL, now)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
    expect(revocations).toEqual([]);
  });

  it('AGENT 即使凭据 ID 相同，若凭据不属于其授权用户仍返回 404', async () => {
    const { service, revocations } = repository();
    await expect(
      service.revokeCredential(agent(OWN_CREDENTIAL, 'user-2'), OWN_CREDENTIAL, now),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(revocations).toEqual([]);
  });

  it('AGENT 仍不可列出凭据', async () => {
    const { service, listedFor } = repository();
    await expect(service.listCredentials(agent())).rejects.toMatchObject({
      status: 403,
      code: 'HUMAN_SESSION_REQUIRED',
    });
    expect(listedFor).toEqual([]);
  });
});

describe('V1AccountService.listCredentials device metadata', () => {
  it('returns the existing fields plus createdAt and the linked device', async () => {
    const { service, devices } = repository();
    devices.set(OWN_CREDENTIAL, {
      name: 'build-box',
      platform: 'win32 10.0.19045',
      clientVersion: '1.2.3',
      ip: '203.0.113.9',
      clientName: 'workmesh-setup',
      authorizedAt: now,
    });

    const items = await service.listCredentials(human());

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: OWN_CREDENTIAL,
      name: 'cli',
      projectId: 'project-1',
      roleId: 'role-1',
      scopes: ['task:read'],
      expiresAt: credential().expiresAt,
      revokedAt: null,
      createdAt: now,
      device: {
        name: 'build-box',
        platform: 'win32 10.0.19045',
        clientVersion: '1.2.3',
        ip: '203.0.113.9',
        clientName: 'workmesh-setup',
        authorizedAt: now,
      },
    });
  });

  it('returns device: null for a credential without a linked authorization request', async () => {
    const { service } = repository();

    const items = await service.listCredentials(human());

    expect(items[0]).toHaveProperty('createdAt', now);
    expect(items[0]).toMatchObject({ device: null });
  });
});
