import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import { receiptsDir } from './config';
import { ensurePrivateDir, IS_WINDOWS, hardenWindowsPath, writePrivateFile } from './private-fs';

export type SourceFile = { path: string; sha256: string; byteLength: number };
export type ExecutionLink = {
  id: string;
  taskId: string;
  stage: 'CLAIM' | 'CONTEXT' | 'DELIVER' | 'REVIEW';
  claimId?: string;
  snapshotId?: string;
  expectedTaskVersion?: number;
};

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
  execution?: ExecutionLink;
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

async function writeReceipt(
  workspaceDir: string,
  receipt: OperationReceipt,
  exclusive = false,
): Promise<void> {
  const path = receiptPath(workspaceDir, receipt.operationId);
  if (exclusive) {
    // wx must apply to the destination, not a temporary file later renamed over it.
    await ensurePrivateDir(receiptsDir(workspaceDir));
    try {
      await writeFile(path, `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      throw new CliError('IDEMPOTENCY_CONFLICT', '原操作记录已存在；请保留原编号并核对其结果。', {
        details: {
          operationId: receipt.operationId,
          operationOutcome: 'UNKNOWN',
          recoveryAction: 'RECONCILE',
        },
      });
    }
    if (IS_WINDOWS) await hardenWindowsPath(path, false);
  } else await writePrivateFile(path, `${JSON.stringify(receipt)}\n`);
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
  if (
    typeof record.scopeKey !== 'string' ||
    typeof record.credentialId !== 'string' ||
    typeof record.method !== 'string' ||
    typeof record.relativeRoute !== 'string' ||
    !Array.isArray(record.sourceFiles) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt))
  )
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 元数据非法`);
  if (record.body !== undefined || record.response !== undefined)
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 不得保存请求/响应正文`);
  if (record.execution !== undefined) {
    const link = record.execution as ExecutionLink;
    if (
      !link ||
      typeof link !== 'object' ||
      !UUID.test(link.id) ||
      !UUID.test(link.taskId) ||
      !['CLAIM', 'CONTEXT', 'DELIVER', 'REVIEW'].includes(link.stage) ||
      (link.claimId !== undefined && !UUID.test(link.claimId)) ||
      (link.snapshotId !== undefined && !UUID.test(link.snapshotId)) ||
      (link.expectedTaskVersion !== undefined &&
        (!Number.isSafeInteger(link.expectedTaskVersion) || link.expectedTaskVersion < 1))
    )
      throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} execution 非法`);
  }
}

export async function readReceipt(
  workspaceDir: string,
  operationId: string,
): Promise<OperationReceipt> {
  const path = receiptPath(workspaceDir, operationId);
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new CliError('LOCAL_RECEIPT_READ_FAILED', '无法读取本地操作记录，请检查路径访问权限。');
    throw new CliError('RESOURCE_NOT_FOUND', `本地没有 operation ${operationId} 的 receipt`, {
      status: 404,
    });
  }
  if (info.isSymbolicLink())
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 是符号链接`);
  if (!info.isFile())
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 不是普通文件`);
  const raw = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 不是合法 JSON`);
  }
  assertReceipt(parsed, path);
  if (parsed.operationId !== operationId)
    throw new CliError('CONTENT_INTEGRITY_FAILED', `receipt ${path} 与 operationId 不一致`);
  return parsed;
}

/** Local discovery works offline, including after the original command lost its response. */
export async function listReceipts(
  workspaceDir: string,
  status: OperationReceipt['status'] | 'ALL' = 'PENDING',
): Promise<OperationReceipt[]> {
  const dir = receiptsDir(workspaceDir);
  let files;
  try {
    files = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const records: OperationReceipt[] = [];
  for (const file of files) {
    if (!file.name.endsWith('.json') || !UUID.test(file.name.slice(0, -5))) continue;
    const record = await readReceipt(workspaceDir, file.name.slice(0, -5));
    if (status === 'ALL' || record.status === status) records.push(record);
  }
  return records.sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || a.operationId.localeCompare(b.operationId),
  );
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
  execution?: ExecutionLink;
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
    ...(input.execution ? { execution: input.execution } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await writeReceipt(input.workspaceDir, receipt, true);
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
