import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { V1AuthorizationService } from './v1-authorization';
import { hashSecret } from './v1-policy';
import { V1CliAuthorizationService } from './v1-cli-authorization.service';
import type { V1AuthRepository, V1CliAuthorizationRecord, V1CredentialRecord } from './v1-auth.repository';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const DEVICE_CODE = 'd'.repeat(43);
const CODE_VERIFIER = 'v'.repeat(64);
const CODE_CHALLENGE = createHash('sha256').update(CODE_VERIFIER, 'utf8').digest('base64url');

function approvedRequest(over: Partial<V1CliAuthorizationRecord> = {}): V1CliAuthorizationRecord {
  return {
    id: 'auth-1',
    clientName: 'cli',
    deviceCodeHash: hashSecret(DEVICE_CODE),
    userCodeHash: 'user-code-hash',
    codeChallenge: CODE_CHALLENGE,
    codeChallengeMethod: 'S256',
    credentialSecretHash: 'a'.repeat(64),
    status: 'APPROVED',
    version: 2,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 10 * 60 * 1000),
    nextPollAt: NOW,
    approvedUserId: 'user-1',
    approvedProjectId: 'project-1',
    approvedRoleId: 'role-1',
    approvedScopes: ['task:read'],
    approvedExpiresInDays: 30,
    issuedCredentialId: null,
    issuedAt: null,
    deniedAt: null,
    ...over,
  };
}

class FakeAuthRepository implements V1AuthRepository {
  readonly credentials: V1CredentialRecord[] = [];
  readonly revoked = new Set<string>();
  markShouldFail = true;
  private request: V1CliAuthorizationRecord;
  private counter = 0;

  constructor(request: V1CliAuthorizationRecord) {
    this.request = { ...request };
  }

  async findSession(): Promise<never> {
    throw new Error('not used');
  }
  async findCredential(credentialId: string): Promise<V1CredentialRecord | null> {
    return this.credentials.find((item) => item.id === credentialId && !this.revoked.has(item.id)) ?? null;
  }
  async touchSession(): Promise<void> {}
  async findUserByEmail(): Promise<never> {
    throw new Error('not used');
  }
  async findUser(userId: string) {
    return { id: userId, isActive: true, authVersion: 1, email: 'a@example.com', passwordHash: 'x' };
  }
  async createUser(): Promise<never> {
    throw new Error('not used');
  }
  async createSession(): Promise<void> {}
  async updateSessionCsrf(): Promise<void> {}
  async revokeSession(): Promise<void> {}
  async listCredentials(): Promise<V1CredentialRecord[]> {
    return this.credentials;
  }
  async revokeCredential(credentialId: string): Promise<boolean> {
    if (!this.credentials.some((item) => item.id === credentialId)) return false;
    this.revoked.add(credentialId);
    return true;
  }
  async createCredential(input: {
    userId: string;
    projectId: string;
    roleId: string;
    name: string;
    tokenHash: string;
    scopes: string[];
    userAuthVersion: number;
    expiresAt: Date;
  }): Promise<V1CredentialRecord> {
    this.counter += 1;
    const record: V1CredentialRecord = {
      id: `cred-${this.counter}`,
      userId: input.userId,
      projectId: input.projectId,
      roleId: input.roleId,
      name: input.name,
      tokenHash: input.tokenHash,
      scopes: input.scopes,
      userAuthVersion: input.userAuthVersion,
      expiresAt: input.expiresAt,
      revokedAt: null,
      user: { id: input.userId, isActive: true, authVersion: input.userAuthVersion },
    };
    this.credentials.push(record);
    return record;
  }
  async createCliAuthorization(): Promise<never> {
    throw new Error('not used');
  }
  async findCliAuthorizationById(): Promise<V1CliAuthorizationRecord | null> {
    return { ...this.request };
  }
  async findCliAuthorizationByDeviceCodeHash(): Promise<never> {
    throw new Error('not used');
  }
  async findCliAuthorizationByUserCodeHash(): Promise<never> {
    throw new Error('not used');
  }
  async recordCliAuthorizationView(): Promise<void> {}
  async hasCliAuthorizationView(): Promise<boolean> {
    return true;
  }
  async approveCliAuthorization(): Promise<never> {
    throw new Error('not used');
  }
  async denyCliAuthorization(): Promise<never> {
    throw new Error('not used');
  }
  async markCliAuthorizationIssued(id: string, credentialId: string, now: Date): Promise<V1CliAuthorizationRecord | null> {
    if (this.markShouldFail) return null;
    this.request = { ...this.request, status: 'ISSUED', issuedCredentialId: credentialId, issuedAt: now };
    return { ...this.request };
  }
  async bumpRateWindow(): Promise<number> {
    return 1;
  }
}

function serviceWith(repository: V1AuthRepository): V1CliAuthorizationService {
  return new V1CliAuthorizationService(repository, {} as V1AuthorizationService);
}

function poll(service: V1CliAuthorizationService) {
  return service.poll({ authorizationId: 'auth-1', deviceCode: DEVICE_CODE, codeVerifier: CODE_VERIFIER, now: NOW });
}

describe('V1CliAuthorizationService credential issuance recovery', () => {
  it('revokes the credential that failed to bind and allows a later poll to issue safely', async () => {
    const repository = new FakeAuthRepository(approvedRequest());
    const service = serviceWith(repository);

    await expect(poll(service)).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    // 未绑定成功的凭据必须被补偿撤销，不能成为孤儿凭据。
    expect(repository.credentials).toHaveLength(1);
    expect(repository.revoked.has(repository.credentials[0].id)).toBe(true);

    repository.markShouldFail = false;
    const issued = await poll(service);
    expect(issued).toMatchObject({ status: 'ISSUED' });
    expect(repository.credentials).toHaveLength(2);
    expect(repository.revoked.has(repository.credentials[1].id)).toBe(false);
  });

  it('returns the already-issued credential when a concurrent poll won the race', async () => {
    // 模拟并发 poll 已先把另一个凭据绑定到授权请求，本轮的 mark 因此返回 null。
    const repository = new FakeAuthRepository(approvedRequest({ issuedCredentialId: 'cred-existing' }));
    repository.credentials.push({
      id: 'cred-existing',
      userId: 'user-1',
      projectId: 'project-1',
      roleId: 'role-1',
      name: 'CLI cli',
      tokenHash: 'a'.repeat(64),
      scopes: ['task:read'],
      userAuthVersion: 1,
      expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000),
      revokedAt: null,
      user: { id: 'user-1', isActive: true, authVersion: 1 },
    });
    const service = serviceWith(repository);

    const issued = await poll(service);
    expect(issued).toMatchObject({ status: 'ISSUED', credential: { credentialId: 'cred-existing' } });
    // 本轮创建但未绑定成功的多余凭据必须被撤销。
    const extra = repository.credentials.find((item) => item.id !== 'cred-existing');
    expect(extra).toBeDefined();
    expect(repository.revoked.has(extra!.id)).toBe(true);
    expect(repository.revoked.has('cred-existing')).toBe(false);
  });
});
