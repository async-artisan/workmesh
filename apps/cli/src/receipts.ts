import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import { receiptsDir } from './config';
import { writePrivateFile } from './private-fs';

export type SourceFile = { path: string; sha256: string; byteLength: number };

export type OperationReceipt = {
  schemaVersion: '1.0';
  operationId: string;
  scopeKey: string;
  credentialId: string;
  method: string;
  relativeRoute: string;
  requestDigest: string;
  sourceFiles: SourceFile[];
  status: 'PENDING' | 'COMMITTED' | 'REJECTED';
  resultRefs?: Record<string, string | number | null>;
  createdAt: string;
  updatedAt: string;
};

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** 幂等摘要：方法、相对路由与语义 body；绝不含 bearer、verifier 或票据秘密。 */
export async function requestDigestOf(
  method: string,
  relativeRoute: string,
  body: unknown,
): Promise<string> {
  return sha256Bytes(
    new TextEncoder().encode(canonicalJson({ method: method.toUpperCase(), relativeRoute, body })),
  );
}

export function scopeKeyOf(parts: {
  origin: string;
  apiBasePath: string;
  projectId: string;
  roleKey: string;
  credentialId: string;
}): string {
  return canonicalJson({ ...parts });
}

export function receiptPath(workspaceDir: string, operationId: string): string {
  if (!UUID.test(operationId)) throw new CliError('VALIDATION_FAILED', 'operationId 必须是 UUID');
  return join(receiptsDir(workspaceDir), `${operationId}.json`);
}

async function writeReceipt(workspaceDir: string, receipt: OperationReceipt): Promise<void> {
  const path = receiptPath(workspaceDir, receipt.operationId);
  await writePrivateFile(path, `${JSON.stringify(receipt)}\n`, { flag: 'wx' });
}

function assertReceipt(value: unknown, path: string): asserts value is OperationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 结构非法`);
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== '1.0')
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 版本不受支持`);
  if (typeof record.operationId !== 'string' || !UUID.test(record.operationId))
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} operationId 非法`);
  if (!['PENDING', 'COMMITTED', 'REJECTED'].includes(String(record.status)))
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} status 非法`);
  if (typeof record.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(record.requestDigest))
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} digest 非法`);
  if (record.body !== undefined || record.response !== undefined)
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 不得保存请求/响应正文`);
}

export async function readReceipt(
  workspaceDir: string,
  operationId: string,
): Promise<OperationReceipt> {
  const path = receiptPath(workspaceDir, operationId);
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new CliError('RESOURCE_NOT_FOUND', `本地没有 operation ${operationId} 的 receipt`, {
      status: 404,
    });
  }
  if (info.isSymbolicLink())
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 是符号链接`);
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 不是合法 JSON`);
  }
  assertReceipt(parsed, path);
  return parsed;
}

export type BeginOperationInput = {
  workspaceDir: string;
  operationId: string;
  scopeKey: string;
  credentialId: string;
  method: string;
  relativeRoute: string;
  requestDigest: string;
  sourceFiles: SourceFile[];
  now?: Date;
};

/** 发请求之前先原子落 PENDING；崩溃后仍能按原 key 核对，不会误报成功。 */
export async function beginOperation(input: BeginOperationInput): Promise<OperationReceipt> {
  const now = (input.now ?? new Date()).toISOString();
  const receipt: OperationReceipt = {
    schemaVersion: '1.0',
    operationId: input.operationId,
    scopeKey: input.scopeKey,
    credentialId: input.credentialId,
    method: input.method.toUpperCase(),
    relativeRoute: input.relativeRoute,
    requestDigest: input.requestDigest,
    sourceFiles: input.sourceFiles,
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  };
  await writeReceipt(input.workspaceDir, receipt);
  return receipt;
}

export async function finishOperation(
  workspaceDir: string,
  operationId: string,
  status: 'COMMITTED' | 'REJECTED',
  resultRefs: Record<string, string | number | null>,
  now = new Date(),
): Promise<OperationReceipt> {
  const receipt = await readReceipt(workspaceDir, operationId);
  const next: OperationReceipt = {
    ...receipt,
    status,
    resultRefs,
    updatedAt: now.toISOString(),
  };
  await writeReceipt(workspaceDir, next);
  return next;
}

/** 复用 --operation 时只有凭据、scope 与重构摘要全部一致才允许同 key。 */
export function assertReusable(
  receipt: OperationReceipt,
  expected: { scopeKey: string; credentialId: string; requestDigest: string },
): void {
  if (
    receipt.scopeKey !== expected.scopeKey ||
    receipt.credentialId !== expected.credentialId ||
    receipt.requestDigest !== expected.requestDigest
  )
    throw new CliError(
      'IDEMPOTENCY_CONFLICT',
      'operation 与当前凭据/范围/请求摘要不一致，不能复用同一 Idempotency-Key',
      { details: { operationId: receipt.operationId } },
    );
}

export function localDigestOfFiles(files: SourceFile[]): string {
  return createHash('sha256').update(canonicalJson({ files }), 'utf8').digest('hex');
}
