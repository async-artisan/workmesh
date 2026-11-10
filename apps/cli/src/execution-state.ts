import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from './errors';
import { ensurePrivateDir } from './private-fs';
import { listReceipts, type OperationReceipt } from './receipts';

export type ExecutionScope = { workspaceDir: string; scopeKey: string; credentialId: string };
export type ExecutionState = {
  executionId: string;
  taskId: string;
  claimId: string | null;
  taskVersion: number | null;
  taskGeneration: number | null;
  snapshotId: string | null;
  artifactSetId: string | null;
  reviewRequestId: string | null;
  stage: 'CLAIMED' | 'CONTEXT_READY' | 'DELIVERED' | 'NEEDS_INSPECTION' | 'PENDING';
  pendingOperations: string[];
  operations: string[];
  updatedAt: string;
};
const positive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** Receipts are the local journal; no second mutable execution baseline is maintained. */
export function executionStates(
  receipts: OperationReceipt[],
  scope: Omit<ExecutionScope, 'workspaceDir'>,
): ExecutionState[] {
  const groups = new Map<string, OperationReceipt[]>();
  for (const receipt of receipts) {
    if (
      receipt.scopeKey !== scope.scopeKey ||
      receipt.credentialId !== scope.credentialId ||
      !receipt.execution
    )
      continue;
    const group = groups.get(receipt.execution.id) ?? [];
    group.push(receipt);
    groups.set(receipt.execution.id, group);
  }
  return [...groups]
    .map(([executionId, records]) => {
      records.sort(
        (a, b) =>
          (a.execution!.stage === 'CLAIM'
            ? 0
            : (a.execution!.expectedTaskVersion ?? Number.MAX_SAFE_INTEGER)) -
            (b.execution!.stage === 'CLAIM'
              ? 0
              : (b.execution!.expectedTaskVersion ?? Number.MAX_SAFE_INTEGER)) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.operationId.localeCompare(b.operationId),
      );
      const claim = records.find((r) => r.execution!.stage === 'CLAIM');
      const state: ExecutionState = {
        executionId,
        taskId: records[0]!.execution!.taskId,
        claimId: null,
        taskVersion: null,
        taskGeneration: null,
        snapshotId: null,
        artifactSetId: null,
        reviewRequestId: null,
        stage: 'NEEDS_INSPECTION',
        pendingOperations: [],
        operations: records.map((r) => r.operationId),
        updatedAt: records
          .map((r) => r.updatedAt)
          .sort()
          .at(-1)!,
      };
      for (const record of records) {
        if (record.execution!.taskId !== state.taskId)
          throw new CliError('CONTENT_INTEGRITY_FAILED', '同一执行包含不同任务');
        if (record.status === 'PENDING') {
          state.pendingOperations.push(record.operationId);
          continue;
        }
        if (record.status !== 'COMMITTED') continue;
        const refs = record.resultRefs ?? {};
        if (refs.taskId !== undefined && refs.taskId !== state.taskId)
          throw new CliError('CONTENT_INTEGRITY_FAILED', '执行收据的任务标识与原请求不一致');
        const stage = record.execution!.stage;
        if (stage === 'CLAIM') {
          state.claimId = text(refs.claimId);
          state.taskVersion = positive(refs.taskVersion);
          state.taskGeneration = positive(refs.taskGeneration);
          state.stage =
            state.claimId && state.taskVersion && state.taskGeneration
              ? 'CLAIMED'
              : 'NEEDS_INSPECTION';
        } else {
          if (
            !claim ||
            !state.claimId ||
            record.execution!.claimId !== state.claimId ||
            (refs.claimId !== undefined && refs.claimId !== state.claimId)
          ) {
            state.stage = 'NEEDS_INSPECTION';
            continue;
          }
          const generation = positive(refs.taskGeneration);
          if (generation !== null && generation !== state.taskGeneration) {
            state.stage = 'NEEDS_INSPECTION';
            continue;
          }
          // An old journal entry must not move a newer execution back to an earlier version.
          const version = positive(refs.taskVersion);
          if (stage === 'CONTEXT') {
            const expected = record.execution!.expectedTaskVersion;
            if (!version || expected !== state.taskVersion || version !== expected + 1) {
              state.stage = 'NEEDS_INSPECTION';
              continue;
            }
            state.taskVersion = version;
            state.snapshotId = text(refs.snapshotId);
            state.stage = state.snapshotId ? 'CONTEXT_READY' : 'NEEDS_INSPECTION';
          } else if (stage === 'DELIVER') {
            if (
              !version ||
              record.execution!.expectedTaskVersion !== state.taskVersion ||
              record.execution!.snapshotId !== state.snapshotId ||
              version !== state.taskVersion! + 1
            ) {
              state.stage = 'NEEDS_INSPECTION';
              continue;
            }
            state.taskVersion = version;
            state.artifactSetId = text(refs.artifactSetId);
            state.reviewRequestId = text(refs.reviewRequestId);
            state.stage = state.artifactSetId ? 'DELIVERED' : 'NEEDS_INSPECTION';
          } else if (stage === 'REVIEW') state.reviewRequestId = text(refs.reviewRequestId);
        }
      }
      if (state.pendingOperations.length) state.stage = 'PENDING';
      return state;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listExecutions(scope: ExecutionScope): Promise<ExecutionState[]> {
  return executionStates(await listReceipts(scope.workspaceDir, 'ALL'), scope);
}

export async function resolveExecution(
  scope: ExecutionScope,
  selector: { executionId?: string; taskId?: string },
): Promise<ExecutionState> {
  const matches = (await listExecutions(scope)).filter(
    (state) =>
      (!selector.executionId || state.executionId === selector.executionId) &&
      (!selector.taskId || state.taskId === selector.taskId),
  );
  if (matches.length !== 1)
    throw new CliError(
      matches.length ? 'EXECUTION_AMBIGUOUS' : 'EXECUTION_NOT_FOUND',
      matches.length
        ? '该任务有多个本地执行，请用 execution list 后指定 --execution。'
        : '当前凭据和工作区没有匹配执行，请先认领或使用精确 ID。',
    );
  return matches[0]!;
}

export function assertExecutionReady(
  state: ExecutionState,
  requireSnapshot = false,
  retryOperation?: string,
): void {
  const pending = state.pendingOperations.filter((id) => id !== retryOperation);
  if (pending.length)
    throw new CliError('EXECUTION_PENDING', '上次写入结果待核对，请先 receipt reconcile。', {
      details: {
        executionId: state.executionId,
        operationId: pending[0],
        recoveryAction: 'RECONCILE',
      },
    });
  if (
    !state.claimId ||
    !state.taskVersion ||
    !state.taskGeneration ||
    state.stage === 'NEEDS_INSPECTION'
  )
    throw new CliError(
      'EXECUTION_NEEDS_INSPECTION',
      '缺少可证明的原提交版本；请核对任务并显式提供精确 ID 与版本，不能自动采用最新版本。',
    );
  if (requireSnapshot && !state.snapshotId)
    throw new CliError('EXECUTION_CONTEXT_REQUIRED', '请先获取本次执行的上下文。');
  if (state.artifactSetId && (!retryOperation || !state.operations.includes(retryOperation)))
    throw new CliError(
      'EXECUTION_DELIVERED',
      '本次执行已经交付，请查看现有评审或按返修流程重新认领。',
    );
}

/** Serialize local commands for one authenticated task. Dead process locks can be recovered after restart. */
export async function withExecutionLock<T>(
  scope: ExecutionScope,
  taskId: string,
  run: () => Promise<T>,
): Promise<T> {
  const dir = join(scope.workspaceDir, '.workmesh', 'local', 'execution-locks');
  await ensurePrivateDir(dir);
  const path = join(
    dir,
    `${createHash('sha256').update(scope.scopeKey).update('\0').update(taskId).digest('hex')}.lock`,
  );
  const nonce = randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600);
      try {
        await file.writeFile(JSON.stringify({ pid: process.pid, nonce }));
      } finally {
        await file.close();
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (attempt > 0) throw new CliError('EXECUTION_BUSY', '本任务已有本地命令运行，稍后重试。');
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink())
        throw new CliError('CONTENT_INTEGRITY_FAILED', '执行锁不是普通文件');
      let owner: { pid?: number; nonce?: string };
      try {
        owner = JSON.parse(await readFile(path, 'utf8'));
      } catch {
        throw new CliError('EXECUTION_BUSY', '执行锁尚未写完或不可读取。');
      }
      if (
        !Number.isSafeInteger(owner.pid) ||
        Number(owner.pid) < 1 ||
        typeof owner.nonce !== 'string' ||
        !owner.nonce
      )
        throw new CliError('EXECUTION_BUSY', '执行锁身份待核对。');
      try {
        process.kill(owner.pid!, 0);
      } catch (probe) {
        if ((probe as NodeJS.ErrnoException).code === 'ESRCH') {
          const recoveryPath = `${path}.recovery`;
          let recovery;
          try {
            recovery = await open(recoveryPath, 'wx', 0o600);
          } catch {
            throw new CliError('EXECUTION_BUSY', '执行锁正在恢复，请稍后重试。');
          }
          try {
            const current = JSON.parse(await readFile(path, 'utf8')) as { nonce?: string };
            if (current.nonce === owner.nonce) await unlink(path);
          } finally {
            await recovery.close();
            await unlink(recoveryPath);
          }
          continue;
        }
      }
      throw new CliError('EXECUTION_BUSY', '本任务已有本地命令运行，稍后重试。');
    }
  }
  try {
    return await run();
  } finally {
    const owner = JSON.parse(await readFile(path, 'utf8')) as { nonce: string };
    if (owner.nonce === nonce) await unlink(path);
  }
}
