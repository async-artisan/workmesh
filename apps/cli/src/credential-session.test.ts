import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findReusableCredential } from './credential-session';
import { saveCredential, type AgentCredential } from './credential-store';

const platform = { origin: 'https://workmesh.example.com', apiBasePath: '/team/api/v1' };
const credential: AgentCredential = {
  version: '1.0',
  ...platform,
  userId: '00000000-0000-4000-8000-000000000001',
  credentialId: '00000000-0000-4000-8000-000000000002',
  projectId: '00000000-0000-4000-8000-000000000003',
  roleId: '00000000-0000-4000-8000-000000000004',
  roleKey: 'backend',
  secret: 's'.repeat(43),
  scopes: ['task:read', 'context:read'],
  createdAt: '2026-11-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};
const principal = {
  kind: 'AGENT',
  agentCredentialId: credential.credentialId,
  projectId: credential.projectId,
  roleIds: [credential.roleId],
  scopes: credential.scopes,
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function home(value: AgentCredential | null = credential) {
  const directory = await mkdtemp(join(tmpdir(), 'wm-session-'));
  directories.push(directory);
  if (value) await saveCredential(directory, value);
  return directory;
}
function reply(value: unknown = principal) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ data: { principal: value }, meta: { requestId: 'req-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}
function options(configHome: string) {
  return {
    configHome,
    platform,
    projectId: credential.projectId,
    roleKey: credential.roleKey,
    now: Date.parse('2026-11-09T00:00:00.000Z'),
  };
}

describe('findReusableCredential', () => {
  it('精确匹配并在线核验后复用，API保留反向代理前缀', async () => {
    const fetch = reply();
    await expect(findReusableCredential({ ...options(await home()), fetch })).resolves.toEqual(
      credential,
    );
    expect(fetch).toHaveBeenCalledWith(
      `${platform.origin}${platform.apiBasePath}/auth/me`,
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: expect.objectContaining({
          authorization: `Bearer wm_a1.${credential.credentialId}.${credential.secret}`,
        }),
      }),
    );
  });
  it.each([
    { roleKey: 'frontend' },
    { projectId: '00000000-0000-4000-8000-000000000009' },
    { origin: 'https://other.example.com' },
    { apiBasePath: '/api/v1' },
    { expiresAt: '2026-11-08T00:00:00.000Z' },
    { scopes: ['task:read'] },
  ])('不复用不匹配、过期或缺少权限的凭据 %o', async (override) => {
    const fetch = reply();
    await expect(
      findReusableCredential({ ...options(await home({ ...credential, ...override })), fetch }),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('没有凭据时不发请求', async () => {
    const fetch = reply();
    await expect(
      findReusableCredential({ ...options(await home(null)), fetch }),
    ).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('服务端已吊销时回到授权', async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: { code: 'AUTH_REQUIRED', message: 'expired' },
            requestId: 'req-2',
          }),
          { status: 401 },
        ),
    );
    await expect(findReusableCredential({ ...options(await home()), fetch })).resolves.toBeNull();
  });
  it.each([
    { projectId: 'another' },
    { roleIds: [] },
    { scopes: ['task:read'] },
    { kind: 'HUMAN' },
  ])('不把不符的在线身份当作可复用 %o', async (override) => {
    await expect(
      findReusableCredential({
        ...options(await home()),
        fetch: reply({ ...principal, ...override }),
      }),
    ).resolves.toBeNull();
  });
  it('网络失败保留错误，不要求重新授权', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(findReusableCredential({ ...options(await home()), fetch })).rejects.toMatchObject(
      { code: 'NETWORK_UNAVAILABLE' },
    );
  });
});
