import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import type { SourceFile } from './receipts';

export type ArtifactKind = 'PRD' | 'DESIGN' | 'IMPL' | 'CASES' | 'RELEASE';
export type ArtifactStorage = 'HOSTED' | 'GIT_REF';

export type DeliverItemPayload = {
  kind: ArtifactKind;
  schemaVersion: '1.0';
  storage: ArtifactStorage;
  mediaType: string;
  sha256: string;
  byteLength: number;
  bodyBase64?: string;
  projectRepositoryId?: string;
  commitSha?: string;
  repoPath?: string;
  summary?: string;
  checks: Array<{ code: string; passed: boolean; message?: string }>;
};

export type DeliverPayload = {
  workflowDefinitionRevisionId: string;
  localRunId: string;
  candidateRevisionIds: string[];
  items: DeliverItemPayload[];
};

export type BuiltDeliver = { payload: DeliverPayload; sourceFiles: SourceFile[] };

const UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const KINDS: ArtifactKind[] = ['PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE'];

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('LOCAL_INPUT_INVALID', message);
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== 'string' || !value.trim())
    throw new CliError('LOCAL_INPUT_INVALID', `manifest.${key} 必须是非空字符串`);
  if (value.length > max)
    throw new CliError('LOCAL_INPUT_INVALID', `manifest.${key} 超过 ${max} 字符`);
  return value;
}

function readChecks(value: unknown): Array<{ code: string; passed: boolean; message?: string }> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CliError('LOCAL_INPUT_INVALID', 'items.checks 必须是数组');
  return value.map((item) => {
    const record = asRecord(item, 'items.checks 项结构非法');
    if (typeof record.code !== 'string' || !record.code)
      throw new CliError('LOCAL_INPUT_INVALID', '检出项 code 必须是非空字符串');
    if (typeof record.passed !== 'boolean')
      throw new CliError('LOCAL_INPUT_INVALID', '检出项 passed 必须是布尔值');
    return {
      code: record.code.slice(0, 100),
      passed: record.passed,
      ...(typeof record.message === 'string' ? { message: record.message.slice(0, 500) } : {}),
    };
  });
}

/**
 * 读取交付 manifest：HOSTED 项在这里计算原始 bytes 的 sha256/长度，
 * 声明的摘要不一致即中止，不降级为指针交付。
 */
export async function buildDeliver(manifestFile: string): Promise<BuiltDeliver> {
  let raw: string;
  try {
    raw = await readFile(resolve(manifestFile), 'utf8');
  } catch {
    throw new CliError('LOCAL_INPUT_INVALID', `无法读取 manifest：${manifestFile}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('LOCAL_INPUT_INVALID', `${manifestFile} 不是合法 JSON`);
  }
  const record = asRecord(parsed, '交付 manifest 必须是 JSON 对象');
  const workflowDefinitionRevisionId = readString(record, 'workflowDefinitionRevisionId', 36);
  if (!UUID.test(workflowDefinitionRevisionId))
    throw new CliError('LOCAL_INPUT_INVALID', 'workflowDefinitionRevisionId 必须是 UUID');
  const localRunId = readString(record, 'localRunId', 120);
  const candidates = record.candidateRevisionIds;
  if (candidates !== undefined && (!Array.isArray(candidates) || candidates.some((id) => typeof id !== 'string' || !UUID.test(id))))
    throw new CliError('LOCAL_INPUT_INVALID', 'candidateRevisionIds 必须是 UUID 数组');
  const candidateRevisionIds = candidates === undefined ? [] : (candidates as string[]);
  const itemsValue = record.items;
  if (!Array.isArray(itemsValue) || itemsValue.length === 0)
    throw new CliError('LOCAL_INPUT_INVALID', '交付至少需要一项 item');
  if (itemsValue.length > 32) throw new CliError('LOCAL_INPUT_INVALID', '交付项最多 32 个');

  const sourceFiles: SourceFile[] = [];
  const items: DeliverItemPayload[] = [];
  for (const [index, itemValue] of itemsValue.entries()) {
    const item = asRecord(itemValue, `items[${index}] 结构非法`);
    const kind = item.kind;
    if (typeof kind !== 'string' || !KINDS.includes(kind as ArtifactKind))
      throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].kind 非法`);
    if (item.schemaVersion !== '1.0')
      throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].schemaVersion 必须为 1.0`);
    const storage = item.storage;
    if (storage !== 'HOSTED' && storage !== 'GIT_REF')
      throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].storage 非法`);
    const mediaType = readString(item, 'mediaType', 100);
    if (storage === 'GIT_REF') {
      if (item.file !== undefined || item.bodyBase64 !== undefined)
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}] GIT_REF 不能携带 file/bodyBase64`);
      if (typeof item.projectRepositoryId !== 'string' || !UUID.test(item.projectRepositoryId))
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].projectRepositoryId 必须是 UUID`);
      if (typeof item.commitSha !== 'string' || !COMMIT.test(item.commitSha))
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].commitSha 必须是 40 位小写 hex`);
      if (typeof item.repoPath !== 'string' || !item.repoPath || item.repoPath.length > 500)
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].repoPath 非法`);
      if (typeof item.sha256 !== 'string' || !DIGEST.test(item.sha256))
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].sha256 必须是 64 位小写 hex`);
      const byteLength = item.byteLength;
      if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 0)
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].byteLength 非法`);
      items.push({
        kind: kind as ArtifactKind,
        schemaVersion: '1.0',
        storage,
        mediaType,
        sha256: item.sha256,
        byteLength,
        projectRepositoryId: item.projectRepositoryId,
        commitSha: item.commitSha,
        repoPath: item.repoPath,
        ...(typeof item.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {}),
        checks: readChecks(item.checks),
      });
      continue;
    }

    for (const forbidden of ['projectRepositoryId', 'commitSha', 'repoPath'])
      if (item[forbidden] !== undefined)
        throw new CliError('LOCAL_INPUT_INVALID', `items[${index}] HOSTED 不能携带 ${forbidden}`);
    if (typeof item.file !== 'string' || !item.file)
      throw new CliError('LOCAL_INPUT_INVALID', `items[${index}].file 必须指向本地文件`);
    const path = resolve(item.file);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(await readFile(path));
    } catch {
      throw new CliError('LOCAL_INPUT_INVALID', `无法读取 ${path}`);
    }
    const digest = await sha256Bytes(new Uint8Array(bytes));
    if (typeof item.sha256 === 'string' && item.sha256 !== digest)
      throw new CliError('CONTENT_INTEGRITY_FAILED', `items[${index}] 声明的 sha256 与文件不一致`, {
        details: { expected: item.sha256, actual: digest },
      });
    if (
      typeof item.byteLength === 'number' &&
      (!Number.isSafeInteger(item.byteLength) || item.byteLength !== bytes.length)
    )
      throw new CliError('CONTENT_INTEGRITY_FAILED', `items[${index}] 声明的 byteLength 与文件不一致`);
    sourceFiles.push({ path, sha256: digest, byteLength: bytes.length });
    items.push({
      kind: kind as ArtifactKind,
      schemaVersion: '1.0',
      storage: 'HOSTED',
      mediaType,
      sha256: digest,
      byteLength: bytes.length,
      bodyBase64: bytes.toString('base64'),
      ...(typeof item.summary === 'string' ? { summary: item.summary.slice(0, 2000) } : {}),
      checks: readChecks(item.checks),
    });
  }

  return {
    payload: {
      workflowDefinitionRevisionId,
      localRunId,
      candidateRevisionIds,
      items,
    },
    sourceFiles,
  };
}
