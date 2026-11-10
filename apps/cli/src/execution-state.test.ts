import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  executionStates,
  assertExecutionReady,
  listExecutions,
  resolveExecution,
  withExecutionLock,
} from './execution-state';
import { beginOperation, finishOperation, type OperationReceipt } from './receipts';
import { ensurePrivateDir } from './private-fs';

const scope = { scopeKey: 'scope-a', credentialId: randomUUID() };
const taskId = randomUUID(),
  claimId = randomUUID(),
  snapshotId = randomUUID();
function journal() {
  const id = randomUUID();
  const make = (
    stage: 'CLAIM' | 'CONTEXT' | 'DELIVER',
    version: number,
    refs: OperationReceipt['resultRefs'],
    offset: number,
  ): OperationReceipt => ({
    schemaVersion: '1.0',
    operationId: stage === 'CLAIM' ? id : randomUUID(),
    ...scope,
    method: 'POST',
    relativeRoute: '/fixture',
    requestDigest: 'a'.repeat(64),
    sourceFiles: [],
    status: 'COMMITTED',
    execution: {
      id,
      taskId,
      stage,
      ...(stage !== 'CLAIM' ? { claimId, snapshotId, expectedTaskVersion: version } : {}),
    },
    resultRefs: refs,
    createdAt: new Date(1_800_000_000_000 + offset).toISOString(),
    updatedAt: new Date(1_800_000_000_000 + offset).toISOString(),
  });
  return [
    make('CLAIM', 1, { claimId, taskVersion: 2, taskGeneration: 3 }, 0),
    make('CONTEXT', 2, { snapshotId, taskVersion: 3, taskGeneration: 3 }, 1),
    make(
      'DELIVER',
      3,
      {
        artifactSetId: randomUUID(),
        reviewRequestId: randomUUID(),
        taskVersion: 4,
        taskGeneration: 3,
      },
      2,
    ),
  ];
}

describe('execution journal recovery', () => {
  it('reconstructs the original exact versions after restart and keeps independent executions separate', () => {
    const records = journal();
    const other = journal();
    const states = executionStates([...records].reverse().concat(other), scope);
    expect(states).toHaveLength(2);
    expect(states.find((s) => s.executionId === records[0]!.operationId)).toMatchObject({
      taskId,
      claimId,
      snapshotId,
      taskVersion: 4,
      taskGeneration: 3,
      stage: 'DELIVERED',
      artifactSetId: records[2]!.resultRefs!.artifactSetId,
      reviewRequestId: records[2]!.resultRefs!.reviewRequestId,
    });
    expect(() => assertExecutionReady(states[0]!, true)).toThrow(/已经交付/);
  });

  it('isolates platform, project, role and credential scope without adopting another journal', () => {
    const records = journal();
    expect(executionStates(records, { ...scope, scopeKey: 'scope-b' })).toEqual([]);
    expect(executionStates(records, { ...scope, credentialId: randomUUID() })).toEqual([]);
  });

  it('keeps an uncertain context pending and advances only after the exact original receipt is confirmed', () => {
    const records = journal().slice(0, 2);
    records[1]!.status = 'PENDING';
    records[1]!.resultRefs = undefined;
    const pending = executionStates(records, scope)[0]!;
    expect(pending).toMatchObject({
      taskVersion: 2,
      snapshotId: null,
      stage: 'PENDING',
      pendingOperations: [records[1]!.operationId],
    });
    expect(() => assertExecutionReady(pending)).toThrow(/待核对/);
    records[1]!.status = 'COMMITTED';
    records[1]!.resultRefs = { snapshotId, taskVersion: 3 };
    expect(executionStates(records, scope)[0]).toMatchObject({
      taskVersion: 3,
      snapshotId,
      stage: 'CONTEXT_READY',
    });
  });

  it('does not manufacture exact versions from legacy, rejected, stale or foreign-claim results', () => {
    const old = journal().slice(0, 2);
    old[0]!.resultRefs = { claimId };
    expect(executionStates(old, scope)[0]).toMatchObject({
      taskVersion: null,
      stage: 'NEEDS_INSPECTION',
    });
    expect(() => assertExecutionReady(executionStates(old, scope)[0]!)).toThrow(/原提交版本/);
    const stale = journal().slice(0, 2);
    stale[1]!.resultRefs = { snapshotId, taskVersion: 90, taskGeneration: 9 };
    expect(executionStates(stale, scope)[0]).toMatchObject({
      taskVersion: 2,
      snapshotId: null,
      stage: 'NEEDS_INSPECTION',
    });
    stale[1]!.resultRefs = { snapshotId, taskVersion: 3, claimId: randomUUID() };
    expect(executionStates(stale, scope)[0]).toMatchObject({
      taskVersion: 2,
      snapshotId: null,
      stage: 'NEEDS_INSPECTION',
    });
    stale[1]!.status = 'REJECTED';
    expect(executionStates(stale, scope)[0]).toMatchObject({ taskVersion: 2, stage: 'CLAIMED' });
  });

  it('selects a unique task execution and refuses ambiguous history', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-execution-'));
    for (let i = 0; i < 2; i++) {
      const record = journal()[0]!;
      await beginOperation({ ...record, workspaceDir });
      await finishOperation(workspaceDir, record.operationId, 'COMMITTED', record.resultRefs!);
    }
    expect(await listExecutions({ ...scope, workspaceDir })).toHaveLength(2);
    await expect(resolveExecution({ ...scope, workspaceDir }, { taskId })).rejects.toMatchObject({
      code: 'EXECUTION_AMBIGUOUS',
    });
  });

  it('serializes the same task while allowing another task, then releases on failure', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-execution-lock-'));
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = withExecutionLock({ ...scope, workspaceDir }, taskId, async () => {
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await ready;
    await expect(
      withExecutionLock({ ...scope, workspaceDir }, taskId, async () => true),
    ).rejects.toMatchObject({ code: 'EXECUTION_BUSY' });
    await expect(
      withExecutionLock({ ...scope, workspaceDir }, randomUUID(), async () => 7),
    ).resolves.toBe(7);
    release();
    await hold;
    await expect(
      withExecutionLock({ ...scope, workspaceDir }, taskId, async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(
      withExecutionLock({ ...scope, workspaceDir }, taskId, async () => 8),
    ).resolves.toBe(8);
    const lockDir = join(workspaceDir, '.workmesh', 'local', 'execution-locks');
    expect(await readdir(lockDir)).toEqual([]);
  });

  it('recovers the lock of a process confirmed exited after interruption', async () => {
    const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-execution-restart-'));
    const stoppedPid = Number(
      execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
        encoding: 'utf8',
        windowsHide: true,
      }),
    );
    const directory = join(workspaceDir, '.workmesh', 'local', 'execution-locks');
    await ensurePrivateDir(directory);
    const name = createHash('sha256')
      .update(scope.scopeKey)
      .update('\0')
      .update(taskId)
      .digest('hex');
    await writeFile(
      join(directory, `${name}.lock`),
      JSON.stringify({ pid: stoppedPid, nonce: randomUUID() }),
    );
    await expect(
      withExecutionLock({ ...scope, workspaceDir }, taskId, async () => 'recovered'),
    ).resolves.toBe('recovered');
    expect(await readdir(directory)).toEqual([]);
  });
});
