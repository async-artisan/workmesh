import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IS_WINDOWS, verifyWindowsPath } from './private-fs';
import { createProof, deviceLogin } from './auth';
import { credentialsDir, pendingAuthorizationsDir } from './config';
import type { FetchLike } from './client';
import { verificationUrl } from './platform';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const USER = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const ROLE = '3c4d5e6f-7a8b-9c0d-1e2f-3a4b5c6d7e8f';
const AUTHORIZATION = '4d5e6f7a-8b9c-0d1e-2f3a-4b5c6d7e8f9a';
const EXPIRES = '2099-01-01T00:00:00.000Z';
const PLATFORM = { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' };

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function stub(responses: Response[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    const body =
      typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    calls.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!next) throw new Error('no response');
    return next;
  };
  return { fetch, calls };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function created(expiresAt = EXPIRES): Response {
  return json(201, {
    data: {
      authorizationId: AUTHORIZATION,
      deviceCode: 'd'.repeat(43),
      userCode: 'ABCD-EFGH',
      verificationUri: '/cli/authorize',
      expiresAt,
      intervalSeconds: 5,
    },
    meta: { requestId: 'create-1' },
  });
}

function issued(): Response {
  return json(200, {
    data: {
      status: 'ISSUED',
      credential: {
        credentialId: '5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b',
        userId: USER,
        projectId: PROJECT,
        roleId: ROLE,
        scopes: ['task:claim', 'context:create'],
        expiresAt: EXPIRES,
      },
    },
    meta: { requestId: 'poll-2' },
  });
}

function pending(): Response {
  return json(200, {
    data: { status: 'PENDING', intervalSeconds: 5 },
    meta: { requestId: 'poll-1' },
  });
}

async function loginHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wm-auth-'));
}

describe('PKCE proof', () => {
  it('challenge 是 S256(base64url)，secret 是 43 字符且 hash 为 hex', () => {
    const proof = createProof();
    expect(proof.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.credentialSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(proof.codeChallenge).toBe(
      createHash('sha256').update(proof.codeVerifier, 'utf8').digest('base64url'),
    );
    expect(proof.credentialSecretHash).toBe(
      createHash('sha256').update(proof.credentialSecret, 'utf8').digest('hex'),
    );
    expect(proof.credentialSecretHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('授权页地址拒绝携带设备码、userCode 或秘密', () => {
    expect(verificationUrl(PLATFORM, '/cli/authorize')).toBe(
      'https://workmesh.example.com/cli/authorize',
    );
    expect(() => verificationUrl(PLATFORM, '/cli/authorize?userCode=ABCD')).toThrow();
    expect(() => verificationUrl(PLATFORM, '/cli/authorize?deviceCode=1')).toThrow();
  });
});

describe('deviceLogin', () => {
  it('PENDING → ISSUED：保存 0600 凭据、清理 pending proof、输出不含秘密', async () => {
    const home = await loginHome();
    const { fetch, calls } = stub([created(), pending(), issued()]);
    const prompts: Array<{ url: string; userCode: string }> = [];
    const notices: string[] = [];

    const result = await deviceLogin({
      platform: PLATFORM,
      configHome: home,
      projectId: PROJECT,
      roleKey: 'backend',
      clientName: 'workmesh-cli',
      fetch,
      sleep: async () => undefined,
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
      onPrompt: (prompt) => prompts.push({ url: prompt.url, userCode: prompt.userCode }),
      onNotice: (text) => notices.push(text),
    });

    expect(result.credential.projectId).toBe(PROJECT);
    expect(result.credential.roleKey).toBe('backend');
    expect(result.credential.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.requestId).toBe('poll-2');

    const create = calls[0];
    expect(create?.url).toBe('https://workmesh.example.com/api/v1/auth/cli-authorizations');
    expect(create?.body.codeChallengeMethod).toBe('S256');
    expect(create?.body.credentialSecretHash).toBe(
      createHash('sha256').update(result.credential.secret, 'utf8').digest('hex'),
    );
    expect(create?.body.codeChallenge).toBe(
      createHash('sha256').update(String(calls[1]?.body.codeVerifier), 'utf8').digest('base64url'),
    );
    expect(create?.headers.authorization).toBeUndefined();
    expect(create?.headers['idempotency-key']).toBeUndefined();

    const credentialFiles = await readdir(credentialsDir(home));
    expect(credentialFiles).toHaveLength(1);
    const credentialPath = join(credentialsDir(home), credentialFiles[0] ?? '');
    const info = await stat(credentialPath);
    if (IS_WINDOWS) {
      // Windows 没有 mode 位，等价保证是“只授予当前用户”的 NTFS DACL。
      await expect(verifyWindowsPath(credentialPath)).resolves.toBeUndefined();
      expect(info.isFile()).toBe(true);
    } else {
      expect(info.mode & 0o777).toBe(0o600);
    }
    const stored = JSON.parse(await readFile(credentialPath, 'utf8')) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('accessToken');
    expect(stored).not.toHaveProperty('refreshToken');
    expect(stored).not.toHaveProperty('password');

    const pendingFiles = await readdir(pendingAuthorizationsDir(home)).catch(() => []);
    expect(pendingFiles).toHaveLength(0);

    expect(prompts[0]?.url).toBe('https://workmesh.example.com/cli/authorize');
    expect(prompts[0]?.url).not.toContain('ABCD');
    const printed = [
      ...prompts.map((prompt) => `${prompt.url} ${prompt.userCode}`),
      ...notices,
    ].join('\n');
    expect(printed).not.toContain(result.credential.secret);
  });

  it('浏览器拒绝授权：403 AUTHORIZATION_DENIED → exit 4，不写凭据', async () => {
    const home = await loginHome();
    const { fetch } = stub([
      created(),
      json(403, {
        error: { code: 'AUTHORIZATION_DENIED', message: '已拒绝', requestId: 'r' },
      }),
    ]);
    await expect(
      deviceLogin({
        platform: PLATFORM,
        configHome: home,
        projectId: PROJECT,
        roleKey: 'backend',
        fetch,
        sleep: async () => undefined,
        now: () => Date.parse('2026-01-01T00:00:00.000Z'),
        onPrompt: () => undefined,
        onNotice: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED', exitCode: 4 });
    await expect(readdir(credentialsDir(home))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('授权过期：expiresAt 已过 → exit 3，不写凭据', async () => {
    const home = await loginHome();
    const { fetch, calls } = stub([created('2020-01-01T00:00:00.000Z')]);
    await expect(
      deviceLogin({
        platform: PLATFORM,
        configHome: home,
        projectId: PROJECT,
        roleKey: 'backend',
        fetch,
        sleep: async () => undefined,
        now: () => Date.parse('2026-01-01T00:00:00.000Z'),
        onPrompt: () => undefined,
        onNotice: () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_EXPIRED', exitCode: 3 });
    expect(calls).toHaveLength(1);
    await expect(readdir(credentialsDir(home))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('轮询 429 时放慢间隔并继续，最终仍可签发', async () => {
    const home = await loginHome();
    const sleeps: number[] = [];
    const { fetch, calls } = stub([
      created(),
      json(429, { error: { code: 'RATE_LIMITED', message: '限流', requestId: 'r' } }),
      issued(),
    ]);
    const result = await deviceLogin({
      platform: PLATFORM,
      configHome: home,
      projectId: PROJECT,
      roleKey: 'backend',
      fetch,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
      onPrompt: () => undefined,
      onNotice: () => undefined,
    });
    expect(result.credential.credentialId).toBe('5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b');
    expect(calls).toHaveLength(3);
    expect(sleeps.some((ms) => ms >= 10_000)).toBe(true);
  });

  it('浏览器批准了其他项目时仍保存凭据，但当前工作区不会匹配使用', async () => {
    const home = await loginHome();
    const other = json(200, {
      data: {
        status: 'ISSUED',
        credential: {
          credentialId: '5e6f7a8b-9c0d-1e2f-3a4b-5c6d7e8f9a0b',
          userId: USER,
          projectId: PROJECT,
          roleId: ROLE,
          scopes: ['task:claim'],
          expiresAt: EXPIRES,
        },
      },
      meta: { requestId: 'poll-2' },
    });
    const { fetch } = stub([created(), other]);
    const notices: string[] = [];
    const result = await deviceLogin({
      platform: PLATFORM,
      configHome: home,
      projectId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      roleKey: 'backend',
      fetch,
      sleep: async () => undefined,
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
      onPrompt: () => undefined,
      onNotice: (text) => notices.push(text),
    });
    expect(result.credential.projectId).toBe(PROJECT);
    expect(result.credential.roleKey).toBe('');
    expect(notices.join('\n')).toContain('不同');
  });
});
