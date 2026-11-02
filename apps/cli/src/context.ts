import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import { contextDir, ensurePrivateDir } from './config';
import { writePrivateFile } from './private-fs';
import type { V1Client } from './client';

export type SnapshotResource = {
  refId: string;
  kind: 'DOCUMENT_REVISION' | 'ARTIFACT' | 'ROLE_RESOURCE';
  targetId: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
  authority: 'PUBLISHED' | 'CANDIDATE';
};

export type SnapshotManifest = {
  schemaVersion: '1.0';
  projectId: string;
  requirementId: string;
  taskId: string;
  taskGeneration: number;
  workflowDefinitionRevisionId: string;
  resources: SnapshotResource[];
  [key: string]: unknown;
};

export type SnapshotView = {
  id: string;
  projectId: string;
  taskId: string;
  manifest: SnapshotManifest;
  manifestDigest: string;
  resources: SnapshotResource[];
};

export type MaterializeResult = {
  snapshotId: string;
  path: string;
  files: string[];
  reused: boolean;
};

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MEDIA_EXTENSIONS: ReadonlyArray<[string, string]> = [
  ['text/markdown', '.md'],
  ['application/json', '.json'],
  ['text/plain', '.txt'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/svg+xml', '.svg'],
  ['application/pdf', '.pdf'],
];

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', message);
  return value as Record<string, unknown>;
}

function readResource(value: unknown): SnapshotResource {
  const record = asRecord(value, '快照资源结构非法');
  const refId = record.refId;
  const kind = record.kind;
  const targetId = record.targetId;
  const sha256 = record.sha256;
  const byteLength = record.byteLength;
  const mediaType = record.mediaType;
  const authority = record.authority;
  if (typeof refId !== 'string' || !refId || refId.length > 120)
    throw new CliError('PROTOCOL_INVALID', '快照资源 refId 非法');
  if (!['DOCUMENT_REVISION', 'ARTIFACT', 'ROLE_RESOURCE'].includes(String(kind)))
    throw new CliError('PROTOCOL_INVALID', '快照资源 kind 非法');
  if (typeof targetId !== 'string' || !targetId)
    throw new CliError('PROTOCOL_INVALID', '快照资源 targetId 非法');
  if (typeof sha256 !== 'string' || !DIGEST.test(sha256))
    throw new CliError('PROTOCOL_INVALID', '快照资源 sha256 非法');
  if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0)
    throw new CliError('PROTOCOL_INVALID', '快照资源 byteLength 非法');
  if (typeof mediaType !== 'string' || !mediaType)
    throw new CliError('PROTOCOL_INVALID', '快照资源 mediaType 非法');
  if (!['PUBLISHED', 'CANDIDATE'].includes(String(authority)))
    throw new CliError('PROTOCOL_INVALID', '快照资源 authority 非法');
  return {
    refId,
    kind: kind as SnapshotResource['kind'],
    targetId,
    sha256,
    byteLength,
    mediaType,
    authority: authority as SnapshotResource['authority'],
  };
}

export function parseSnapshot(value: unknown): SnapshotView {
  const record = asRecord(value, '快照响应结构非法');
  if (typeof record.id !== 'string' || !UUID.test(record.id))
    throw new CliError('PROTOCOL_INVALID', '快照 id 非法');
  const manifest = asRecord(record.manifest, '快照 manifest 非法');
  const resources = manifest.resources;
  if (!Array.isArray(resources))
    throw new CliError('PROTOCOL_INVALID', '快照 manifest.resources 非法');
  const parsed = resources.map(readResource);
  const seen = new Set<string>();
  for (const resource of parsed) {
    if (seen.has(resource.refId)) throw new CliError('PROTOCOL_INVALID', '快照资源 refId 重复');
    seen.add(resource.refId);
  }
  const manifestDigest = record.manifestDigest;
  if (typeof manifestDigest !== 'string' || !DIGEST.test(manifestDigest))
    throw new CliError('PROTOCOL_INVALID', '快照 manifestDigest 非法');
  return {
    id: record.id,
    projectId: typeof record.projectId === 'string' ? record.projectId : '',
    taskId: typeof record.taskId === 'string' ? record.taskId : '',
    manifest: manifest as unknown as SnapshotManifest,
    manifestDigest,
    resources: parsed,
  };
}

export async function fetchSnapshot(client: V1Client, snapshotId: string): Promise<SnapshotView> {
  if (!UUID.test(snapshotId)) throw new CliError('VALIDATION_FAILED', '--snapshot 必须是 UUID');
  const response = await client.request<unknown>(
    'GET',
    `/context-snapshots/${encodeURIComponent(snapshotId)}`,
  );
  return parseSnapshot(response.data);
}

export async function createSnapshot(
  client: V1Client,
  taskId: string,
  input: { claimId: string; expectedVersion: number; candidateRevisionIds?: string[] },
  operationId: string,
): Promise<{ snapshot: SnapshotView; taskVersion: number; requestId: string }> {
  if (!UUID.test(taskId)) throw new CliError('VALIDATION_FAILED', '--task 必须是 UUID');
  if (!UUID.test(input.claimId)) throw new CliError('VALIDATION_FAILED', '--claim 必须是 UUID');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1)
    throw new CliError('VALIDATION_FAILED', '--expected-version 必须是 >= 1 的整数');
  const response = await client.request<unknown>(
    'POST',
    `/tasks/${encodeURIComponent(taskId)}/context-snapshots`,
    {
      body: {
        expectedVersion: input.expectedVersion,
        claimId: input.claimId,
        ...(input.candidateRevisionIds ? { candidateRevisionIds: input.candidateRevisionIds } : {}),
      },
      idempotencyKey: operationId,
    },
  );
  const data = asRecord(response.data, '创建快照响应结构非法');
  const snapshot = parseSnapshot(data.snapshot);
  const taskVersion = Number(data.taskVersion);
  if (!Number.isSafeInteger(taskVersion) || taskVersion < 1)
    throw new CliError('PROTOCOL_INVALID', '创建快照响应 taskVersion 非法');
  return { snapshot, taskVersion, requestId: response.requestId };
}

function safeFileName(index: number, resource: SnapshotResource): string {
  const base = resource.refId
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 80);
  const extension =
    MEDIA_EXTENSIONS.find(
      ([mediaType]) => resource.mediaType.split(';')[0].trim() === mediaType,
    )?.[1] ?? '.bin';
  return `${String(index + 1).padStart(3, '0')}-${base || 'resource'}${extension}`;
}

function decodeStrict(base64: string): Buffer {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
    throw new CliError('CONTENT_INTEGRITY_FAILED', '资源正文不是严格 base64');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.toString('base64') !== base64)
    throw new CliError('CONTENT_INTEGRITY_FAILED', '资源正文 base64 不可逆');
  return bytes;
}

async function fileDigest(path: string): Promise<string> {
  return sha256Bytes(new Uint8Array(await readFile(path)));
}

async function assertManagedTree(
  target: string,
  expected: Map<string, string>,
  manifestDigest: string,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new CliError('CONTENT_INTEGRITY_FAILED', `无法读取已物化目录 ${target}`);
  }
  const receiptPath = join(target, 'input-receipt.json');
  let receipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as unknown;
  } catch {
    throw new CliError(
      'LOCAL_MANAGED_FILE_MODIFIED',
      `${target} 不是受管副本或 input-receipt.json 缺失，拒绝覆盖（本地文件保持不变）`,
    );
  }
  const files = asRecord(receipt, `${receiptPath} 结构非法`).files;
  if (!Array.isArray(files))
    throw new CliError('LOCAL_MANAGED_FILE_MODIFIED', `${receiptPath} 缺少 files 清单`);

  const allowed = new Set([...expected.keys(), 'manifest.json', 'input-receipt.json']);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!allowed.has(entry.name))
      throw new CliError(
        'LOCAL_MANAGED_FILE_MODIFIED',
        `${target} 存在非受管文件 ${entry.name}，拒绝覆盖（本地文件保持不变）`,
      );
  }
  for (const [name, digest] of expected) {
    let actual: string;
    try {
      actual = await fileDigest(join(target, name));
    } catch {
      throw new CliError(
        'LOCAL_MANAGED_FILE_MODIFIED',
        `${target} 缺少受管文件 ${name}，拒绝覆盖（本地文件保持不变）`,
      );
    }
    if (actual !== digest)
      throw new CliError(
        'LOCAL_MANAGED_FILE_MODIFIED',
        `${target}/${name} 与快照摘要不一致，拒绝覆盖（本地修改保持不变）`,
      );
  }
  if ((await fileDigest(join(target, 'manifest.json'))) !== manifestDigest)
    throw new CliError(
      'LOCAL_MANAGED_FILE_MODIFIED',
      `${target}/manifest.json 与快照摘要不一致，拒绝覆盖`,
    );
}

/**
 * 先下载并校验全部 bytes，再原子发布到 .workmesh/context/<snapshotId>。
 * 任一失败都不切换 current.json，也不覆盖已有受管副本或草稿。
 */
export async function materializeSnapshot(options: {
  client: V1Client;
  workspaceDir: string;
  snapshot: SnapshotView;
  now?: () => Date;
}): Promise<MaterializeResult> {
  const { client, workspaceDir, snapshot } = options;
  const root = contextDir(workspaceDir);
  await ensurePrivateDir(root);
  const target = join(root, snapshot.id);
  const staging = join(root, `.staging-${randomUUID()}`);
  await ensurePrivateDir(staging);

  const expected = new Map<string, string>();
  const receiptFiles: Array<{ name: string; refId: string; sha256: string; byteLength: number }> =
    [];
  try {
    for (const [index, resource] of snapshot.resources.entries()) {
      const response = await client.request<unknown>(
        'GET',
        `/context-snapshots/${encodeURIComponent(snapshot.id)}/resources/${encodeURIComponent(resource.refId)}`,
      );
      const body = asRecord(response.data, '资源响应结构非法');
      if (body.refId !== resource.refId)
        throw new CliError('CONTENT_INTEGRITY_FAILED', `资源 refId 不匹配：${resource.refId}`);
      if (body.encoding !== 'base64' || typeof body.bodyBase64 !== 'string')
        throw new CliError('CONTENT_INTEGRITY_FAILED', `资源编码非法：${resource.refId}`);
      const bytes = decodeStrict(body.bodyBase64);
      const digest = await sha256Bytes(new Uint8Array(bytes));
      if (bytes.length !== resource.byteLength || digest !== resource.sha256)
        throw new CliError(
          'CONTENT_INTEGRITY_FAILED',
          `资源 ${resource.refId} 的长度或摘要与 manifest 不一致`,
        );
      if (body.byteLength !== undefined && body.byteLength !== bytes.length)
        throw new CliError(
          'CONTENT_INTEGRITY_FAILED',
          `资源 ${resource.refId} 的 byteLength 不一致`,
        );
      if (body.sha256 !== undefined && body.sha256 !== resource.sha256)
        throw new CliError('CONTENT_INTEGRITY_FAILED', `资源 ${resource.refId} 的 sha256 不一致`);
      const name = safeFileName(index, resource);
      const path = join(staging, name);
      await writePrivateFile(path, bytes);
      expected.set(name, resource.sha256);
      receiptFiles.push({
        name,
        refId: resource.refId,
        sha256: resource.sha256,
        byteLength: resource.byteLength,
      });
    }

    const manifestBytes = `${JSON.stringify(snapshot.manifest, null, 2)}\n`;
    const canonicalDigest = await sha256Bytes(
      new TextEncoder().encode(canonicalJson(snapshot.manifest)),
    );
    if (canonicalDigest !== snapshot.manifestDigest)
      throw new CliError('CONTENT_INTEGRITY_FAILED', '快照 manifest 摘要与 manifestDigest 不一致');
    await writePrivateFile(join(staging, 'manifest.json'), manifestBytes);
    const manifestFileDigest = await sha256Bytes(new TextEncoder().encode(manifestBytes));
    await writePrivateFile(
      join(staging, 'input-receipt.json'),
      `${JSON.stringify(
        {
          schemaVersion: '1.0',
          snapshotId: snapshot.id,
          manifestDigest: snapshot.manifestDigest,
          materializedAt: (options.now ?? (() => new Date()))().toISOString(),
          files: [
            ...receiptFiles,
            {
              name: 'manifest.json',
              refId: 'manifest',
              sha256: manifestFileDigest,
              byteLength: Buffer.byteLength(manifestBytes),
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    await assertManagedTree(target, expected, manifestFileDigest);
    let reused = false;
    try {
      const info = await lstat(target);
      if (info.isSymbolicLink())
        throw new CliError('LOCAL_MANAGED_FILE_MODIFIED', `${target} 是符号链接，拒绝覆盖`);
      reused = true;
    } catch (error) {
      if (error instanceof CliError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (reused) {
      await rm(staging, { recursive: true, force: true });
      return { snapshotId: snapshot.id, path: target, files: [...expected.keys()], reused: true };
    }

    await rename(staging, target);
    await writeFile(
      join(root, 'current.json'),
      `${JSON.stringify(
        {
          snapshotId: snapshot.id,
          manifestDigest: snapshot.manifestDigest,
          materializedAt: (options.now ?? (() => new Date()))().toISOString(),
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    return { snapshotId: snapshot.id, path: target, files: [...expected.keys()], reused: false };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
