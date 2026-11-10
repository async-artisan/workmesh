import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IS_WINDOWS, verifyWindowsPath } from './private-fs';
import {
  assertReusable,
  beginOperation,
  finishOperation,
  listReceipts,
  readReceipt,
  receiptPath,
  requestDigestOf,
  scopeKeyOf,
} from './receipts';

const SCOPE = scopeKeyOf({
  origin: 'https://workmesh.example.com',
  apiBasePath: '/api/v1',
  projectId: '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a',
  roleKey: 'backend',
  credentialId: '9c1a4a2e-6f2b-4c3d-8e5f-1a2b3c4d5e6f',
});
const CREDENTIAL = '9c1a4a2e-6f2b-4c3d-8e5f-1a2b3c4d5e6f';

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wm-receipts-'));
}

describe('operation receipts', () => {
  it('creates a pending operation exclusively instead of replacing a concurrent original', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    const input = {
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/fixture',
      requestDigest: 'a'.repeat(64),
      sourceFiles: [],
    };
    const results = await Promise.allSettled([
      beginOperation(input),
      beginOperation({ ...input, requestDigest: 'b'.repeat(64) }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing original receipt');
    expect((await readReceipt(dir, operationId)).requestDigest).toBe(winner.value.requestDigest);
  });
  it('离线列表默认仅待核对，支持状态筛选并按时间稳定排序', async () => {
    const dir = await workspace();
    expect(await listReceipts(dir)).toEqual([]);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (const [index, operationId] of ids.entries()) {
      await beginOperation({
        workspaceDir: dir,
        operationId,
        scopeKey: SCOPE,
        credentialId: CREDENTIAL,
        method: 'POST',
        relativeRoute: '/tasks/x/claims',
        requestDigest: 'a'.repeat(64),
        sourceFiles: [],
        now: new Date(2026, 10, 9, index),
      });
    }
    await finishOperation(dir, ids[1]!, 'COMMITTED', {});
    await finishOperation(dir, ids[2]!, 'REJECTED', {});
    await writeFile(join(dir, '.workmesh', 'local', 'receipts', 'unrelated.json'), '{}');
    expect((await listReceipts(dir)).map((r) => r.operationId)).toEqual([ids[0]]);
    expect((await listReceipts(dir, 'COMMITTED')).map((r) => r.operationId)).toEqual([ids[1]]);
    expect((await listReceipts(dir, 'ALL')).map((r) => r.operationId)).toEqual([...ids].reverse());
  });

  it('收据文件名必须匹配内部操作编号', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    await beginOperation({
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/tasks/x/claims',
      requestDigest: 'a'.repeat(64),
      sourceFiles: [],
    });
    const path = receiptPath(dir, operationId);
    const value = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...value, operationId: randomUUID() }));
    await expect(listReceipts(dir)).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
  });
  it('PENDING receipt 为 0600，只含摘要与安全元数据', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    const digest = await requestDigestOf('POST', '/tasks/x/claims', {});
    const receipt = await beginOperation({
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/tasks/x/claims',
      requestDigest: digest,
      sourceFiles: [],
    });
    expect(receipt.status).toBe('PENDING');
    const path = receiptPath(dir, operationId);
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('body');
    expect(parsed).not.toHaveProperty('response');
    expect(raw).not.toMatch(/wm_a1|bearer|deviceCode|codeVerifier/i);
    const info = await stat(path);
    if (IS_WINDOWS) {
      // Windows 没有 mode 位，等价保证是“只授予当前用户”的 NTFS DACL。
      await expect(verifyWindowsPath(path)).resolves.toBeUndefined();
      await expect(
        verifyWindowsPath(join(dir, '.workmesh', 'local', 'receipts')),
      ).resolves.toBeUndefined();
    } else {
      expect(info.mode & 0o777).toBe(0o600);
      const parent = await stat(join(dir, '.workmesh', 'local', 'receipts'));
      expect(parent.mode & 0o777).toBe(0o700);
    }
  });

  it('requestDigest 对方法、路由与语义 body 稳定且区分为不同请求', async () => {
    const a = await requestDigestOf('POST', '/tasks/x/claims', {});
    const b = await requestDigestOf('post', '/tasks/x/claims', {});
    const c = await requestDigestOf('POST', '/tasks/x/claims', { bodyBase64: 'aGk=' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('同一 operation 只有 scope/凭据/摘要全部一致才允许复用', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    const digest = await requestDigestOf('POST', '/tasks/x/claims', {});
    await beginOperation({
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/tasks/x/claims',
      requestDigest: digest,
      sourceFiles: [],
    });
    const receipt = await readReceipt(dir, operationId);
    expect(() =>
      assertReusable(receipt, { scopeKey: SCOPE, credentialId: CREDENTIAL, requestDigest: digest }),
    ).not.toThrow();
    expect(() =>
      assertReusable(receipt, {
        scopeKey: SCOPE,
        credentialId: CREDENTIAL,
        requestDigest: 'f'.repeat(64),
      }),
    ).toThrow(/不能复用/);
  });

  it('COMMITTED 只记录安全 resultRefs，不含响应正文', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    const digest = await requestDigestOf('POST', '/tasks/x/artifact-sets', { a: 1 });
    await beginOperation({
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/tasks/x/artifact-sets',
      requestDigest: digest,
      sourceFiles: [{ path: '/tmp/a.md', sha256: 'a'.repeat(64), byteLength: 3 }],
    });
    const done = await finishOperation(dir, operationId, 'COMMITTED', {
      artifactSetId: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    });
    expect(done.status).toBe('COMMITTED');
    const raw = await readFile(receiptPath(dir, operationId), 'utf8');
    expect(raw).not.toMatch(/artifactSetId.*bodyBase64/);
    expect(raw).not.toMatch(/wm_a1|codeVerifier/);
  });

  it('缺少 receipt 时明确报本地不存在', async () => {
    const dir = await workspace();
    await expect(readReceipt(dir, randomUUID())).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('拒绝被写入正文或被篡改的 receipt', async () => {
    const dir = await workspace();
    const operationId = randomUUID();
    const digest = await requestDigestOf('POST', '/tasks/x/claims', {});
    await beginOperation({
      workspaceDir: dir,
      operationId,
      scopeKey: SCOPE,
      credentialId: CREDENTIAL,
      method: 'POST',
      relativeRoute: '/tasks/x/claims',
      requestDigest: digest,
      sourceFiles: [],
    });
    const path = receiptPath(dir, operationId);
    const tampered = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    tampered.body = { secret: 'should-not-be-here' };
    await writeFile(path, JSON.stringify(tampered), 'utf8');
    await expect(readReceipt(dir, operationId)).rejects.toMatchObject({
      code: 'CONTENT_INTEGRITY_FAILED',
    });
  });
});
