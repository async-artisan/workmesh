import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './index';
import { saveWorkspace } from './config';
import { saveCredential } from './credential-store';
import { readReceipt } from './receipts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function workspace() {
  const dir = await mkdtemp(join(tmpdir(), 'wm-execution-command-'));
  const home = join(dir, 'user');
  const projectId = randomUUID(),
    credentialId = randomUUID();
  const platform = { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' };
  await saveWorkspace(dir, {
    schemaVersion: '1.0',
    profile: 'default',
    platform,
    projectId,
    roleKey: 'backend',
    repositoryId: null,
    host: 'codex',
    workflowDefinitionRevisionId: null,
  });
  await saveCredential(home, {
    version: '1.0',
    ...platform,
    userId: randomUUID(),
    credentialId,
    secret: 'a'.repeat(43),
    projectId,
    roleId: randomUUID(),
    roleKey: 'backend',
    scopes: ['task:claim', 'task:deliver', 'context:create', 'context:read', 'review:read'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  const taskId = randomUUID(),
    claimId = randomUUID(),
    snapshotId = randomUUID(),
    artifactSetId = randomUUID(),
    reviewRequestId = randomUUID(),
    executionId = randomUUID();
  const snapshot = {
    id: snapshotId,
    projectId,
    taskId,
    manifestDigest: 'a'.repeat(64),
    manifest: { schemaVersion: '1.0', projectId, taskId, taskGeneration: 2, resources: [] },
    resources: [],
  };
  const manifest = join(dir, 'deliver.json');
  await writeFile(
    manifest,
    JSON.stringify({
      workflowDefinitionRevisionId: randomUUID(),
      localRunId: 'execution-1',
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/plain',
          sha256: 'b'.repeat(64),
          byteLength: 0,
          projectRepositoryId: randomUUID(),
          commitSha: 'c'.repeat(40),
          repoPath: 'src/main.ts',
          checks: [],
        },
      ],
    }),
  );
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => lines.push(line));
  const args = ['--dir', dir, '--config-home', home, '--json'];
  const result = () => JSON.parse(lines.at(-1)!).data;
  const response = (data: unknown) =>
    new Response(JSON.stringify({ data, meta: { requestId: 'req' } }), { status: 200 });
  return {
    dir,
    home,
    projectId,
    taskId,
    claimId,
    snapshotId,
    artifactSetId,
    reviewRequestId,
    executionId,
    snapshot,
    manifest,
    lines,
    args,
    result,
    response,
  };
}

describe('execution commands', () => {
  it('reads a historical snapshot without consulting the current task role lock', async () => {
    const w = await workspace();
    w.snapshot.manifest = {
      ...w.snapshot.manifest,
      workflowDefinitionRevisionId: 'wf-historical',
    } as typeof w.snapshot.manifest;
    const network = vi.fn(async (url: string) => {
      if (url.includes('/context-snapshots/')) return w.response(w.snapshot);
      throw new Error(`historical read must not inspect current task: ${url}`);
    });
    vi.stubGlobal('fetch', network);
    expect(await main(['context', '--snapshot', w.snapshotId, ...w.args])).toBe(0);
    expect(w.result().roleContext).toMatchObject({
      scope: 'SNAPSHOT',
      workflowDefinitionRevisionId: 'wf-historical',
      metadata: 'NOT_COMPARED',
      local: { status: 'NOT_COMPARED' },
    });
    expect(network.mock.calls.every(([url]) => !url.includes('/input-status'))).toBe(true);
  });

  it('carries exact claim/snapshot/version through separate CLI invocations and reuses the automatic review', async () => {
    const w = await workspace();
    const contextOperation = randomUUID(),
      deliveryOperation = randomUUID();
    const network = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/claims'))
        return w.response({
          claimId: w.claimId,
          task: { version: 2, generation: 2 },
          committedState: { taskVersion: 2, taskGeneration: 2 },
        });
      if (url.endsWith('/input-status'))
        return w.response({
          comparison: { status: 'NO_SNAPSHOT', changes: [], metadataChanges: [] },
          rolePackage: {
            workflowDefinitionRevisionId: 'wf-locked',
            roleKey: 'backend',
            status: 'LOCKED',
            locked: {
              packageId: 'workmesh.role.backend',
              version: '1.2.0',
              packageDigest: 'a'.repeat(64),
              source: 'BUILTIN',
              resources: [],
            },
            latestAvailable: {
              packageId: 'workmesh.role.backend',
              version: '1.3.0',
              packageDigest: 'b'.repeat(64),
              source: 'PROJECT',
            },
            comparison: { status: 'NO_SNAPSHOT', changes: [] },
          },
        });
      if (url.endsWith('/context-snapshots')) {
        expect(JSON.parse(init!.body as string)).toEqual({
          expectedVersion: 2,
          claimId: w.claimId,
        });
        return w.response({ snapshot: w.snapshot, taskVersion: 3 });
      }
      if (url.includes('/context-snapshots/')) return w.response(w.snapshot);
      if (url.endsWith('/artifact-sets')) {
        expect(JSON.parse(init!.body as string)).toMatchObject({
          expectedVersion: 3,
          claimId: w.claimId,
          snapshotId: w.snapshotId,
        });
        return w.response({
          artifactSet: { id: w.artifactSetId },
          reviewRequestId: w.reviewRequestId,
          task: { version: 4, generation: 2, executionStatus: 'REVIEW_PENDING' },
          committedState: { taskVersion: 4, taskGeneration: 2 },
        });
      }
      if (url.includes('/review-requests/'))
        return w.response({ id: w.reviewRequestId, status: 'OPEN' });
      throw new Error(`unexpected ${init?.method} ${url}`);
    });
    vi.stubGlobal('fetch', network);
    expect(await main(['claim', '--task', w.taskId, '--operation', w.executionId, ...w.args])).toBe(
      0,
    );
    expect(w.result()).toMatchObject({ executionId: w.executionId, taskVersion: 2 });
    expect(
      await main([
        'context',
        '--execution',
        w.executionId,
        '--operation',
        contextOperation,
        ...w.args,
      ]),
    ).toBe(0);
    expect(w.result()).toMatchObject({ snapshotId: w.snapshotId, taskVersion: 3 });
    expect(w.result().roleContext).toMatchObject({
      notices: ['UPDATE_AVAILABLE', 'LOCAL_ROLE_PACKAGE_MISMATCH'],
      local: { status: 'MISSING' },
      locked: { version: '1.2.0' },
    });
    expect(
      await main([
        'context',
        '--execution',
        w.executionId,
        '--operation',
        contextOperation,
        ...w.args,
      ]),
    ).toBe(0);
    expect(await main(['execution', 'status', '--task', w.taskId, ...w.args])).toBe(0);
    expect(w.result()).toMatchObject({
      stage: 'CONTEXT_READY',
      taskVersion: 3,
      claimId: w.claimId,
    });
    expect(
      await main([
        'deliver',
        '--task',
        w.taskId,
        '--manifest',
        w.manifest,
        '--operation',
        deliveryOperation,
        ...w.args,
      ]),
    ).toBe(0);
    expect(w.result()).toMatchObject({
      executionId: w.executionId,
      taskVersion: 4,
      reviewRequestId: w.reviewRequestId,
    });
    expect(
      await main([
        'deliver',
        '--task',
        w.taskId,
        '--manifest',
        w.manifest,
        '--operation',
        deliveryOperation,
        ...w.args,
      ]),
    ).toBe(0);
    expect(await main(['review', '--execution', w.executionId, ...w.args])).toBe(0);
    expect(w.result()).toMatchObject({ reused: true, reviewRequestId: w.reviewRequestId });
    expect(network.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(5);
  });

  it('keeps a timed-out write pending, blocks another operation and resumes from the original server receipt', async () => {
    const w = await workspace();
    const contextOperation = randomUUID();
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/claims'))
          return w.response({
            claimId: w.claimId,
            task: { version: 2, generation: 2 },
            committedState: { taskVersion: 2, taskGeneration: 2 },
          });
        if (url.endsWith('/context-snapshots')) {
          attempts++;
          throw new TypeError('connection lost');
        }
        if (url.includes('/operation-receipts/'))
          return w.response({
            operationKey: contextOperation,
            projectId: w.projectId,
            method: 'POST',
            route: `/api/v1/tasks/${w.taskId}/context-snapshots`,
            status: 'COMMITTED',
            resultRefs: { snapshotId: w.snapshotId, taskVersion: 3 },
            committedAt: new Date().toISOString(),
          });
        throw new Error(`unexpected ${url}`);
      }),
    );
    expect(await main(['claim', '--task', w.taskId, '--operation', w.executionId, ...w.args])).toBe(
      0,
    );
    expect(
      await main([
        'context',
        '--execution',
        w.executionId,
        '--operation',
        contextOperation,
        ...w.args,
      ]),
    ).not.toBe(0);
    expect((await readReceipt(w.dir, contextOperation)).status).toBe('PENDING');
    expect(await main(['context', '--execution', w.executionId, ...w.args])).not.toBe(0);
    expect(attempts).toBe(1);
    expect(await main(['receipt', 'reconcile', '--operation', contextOperation, ...w.args])).toBe(
      0,
    );
    expect(await main(['execution', 'status', '--execution', w.executionId, ...w.args])).toBe(0);
    expect(w.result()).toMatchObject({
      stage: 'CONTEXT_READY',
      snapshotId: w.snapshotId,
      taskVersion: 3,
    });
  });

  it('never uses a replay response current task version as the original committed version', async () => {
    const w = await workspace();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        w.response({
          claimId: w.claimId,
          task: { version: 92, generation: 10 },
          committedState: null,
          replayed: true,
        }),
      ),
    );
    expect(await main(['claim', '--task', w.taskId, '--operation', w.executionId, ...w.args])).toBe(
      0,
    );
    expect(w.result()).toMatchObject({ taskVersion: null, taskGeneration: null });
    expect(await main(['context', '--execution', w.executionId, ...w.args])).not.toBe(0);
    expect(await main(['execution', 'status', '--execution', w.executionId, ...w.args])).toBe(0);
    expect(w.result()).toMatchObject({ stage: 'NEEDS_INSPECTION', taskVersion: null });
  });

  it('requires explicit refresh after changed inputs and preserves the version on a server conflict', async () => {
    const w = await workspace();
    let contexts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/claims'))
          return w.response({
            claimId: w.claimId,
            task: { version: 2, generation: 2 },
            committedState: { taskVersion: 2, taskGeneration: 2 },
          });
        if (url.includes('/input-status')) return w.response({ comparison: { status: 'CHANGED' } });
        if (url.endsWith('/context-snapshots')) {
          contexts++;
          if (contexts > 1)
            return new Response(
              JSON.stringify({
                error: { code: 'VERSION_CONFLICT', message: 'changed', requestId: 'conflict' },
              }),
              { status: 409 },
            );
          return w.response({ snapshot: w.snapshot, taskVersion: 3 });
        }
        return w.response(w.snapshot);
      }),
    );
    expect(await main(['claim', '--task', w.taskId, '--operation', w.executionId, ...w.args])).toBe(
      0,
    );
    expect(await main(['context', '--execution', w.executionId, ...w.args])).toBe(0);
    expect(await main(['context', '--execution', w.executionId, ...w.args])).not.toBe(0);
    expect(contexts).toBe(1);
    expect(await main(['context', '--execution', w.executionId, '--refresh', ...w.args])).not.toBe(
      0,
    );
    expect(contexts).toBe(2);
    expect(await main(['execution', 'status', '--execution', w.executionId, ...w.args])).toBe(0);
    expect(w.result()).toMatchObject({
      taskVersion: 3,
      snapshotId: w.snapshotId,
      stage: 'CONTEXT_READY',
    });
  });
});
