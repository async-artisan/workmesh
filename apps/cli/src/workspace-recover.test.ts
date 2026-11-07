import { lstat, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as userIndex from './user-index';
import {
  makeTempDir,
  PROJECT_B,
  REVISION_B,
  snapshotTree,
  WORKSPACE,
  WORKSPACE_B,
  writeJsonFile,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  initLockPath,
  parseWorkspaceConfigV2,
  pendingInitPath,
  workspaceV2Path,
} from './workspace-config';
import {
  canonicalWorkspaceRoot,
  emptyUserIndex,
  loadUserIndex,
  saveUserIndex,
  upsertUserWorkspace,
} from './user-index';
import { runWorkspaceRecover, workspaceInitPlanDigestOf } from './workspace-recover';

const CREATED = '2026-11-07T00:00:00.000Z';

async function committed() {
  const root = await makeTempDir('wm-recover-');
  const home = await makeTempDir('wm-home-');
  const config = parseWorkspaceConfigV2(await writeV2Workspace(root));
  const pending = {
    schemaVersion: '1.0',
    workspaceId: config.workspaceId,
    projectId: config.projectId,
    platform: config.platform,
    definitionRevisionId: config.definition!.revisionId,
    definitionDigest: config.definition!.sha256,
    planDigest: await workspaceInitPlanDigestOf(config, config.definition!.revisionId),
    createdAt: CREATED,
  };
  await writeJsonFile(pendingInitPath(root), pending);
  await saveUserIndex(
    home,
    upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: config.workspaceId,
      root: await canonicalWorkspaceRoot(root),
      projectId: config.projectId,
      platform: config.platform,
      updatedAt: CREATED,
    }),
  );
  return { root, home, config, pending };
}

describe('workspace recover', () => {
  it('rechecks pending after obtaining locks and retains changed evidence', async () => {
    const { root, home, pending } = await committed();
    const acquire = userIndex.acquireFileLock;
    const spy = vi.spyOn(userIndex, 'acquireFileLock').mockImplementation(async (path, options) => {
      const lock = await acquire(path, options);
      if (path === initLockPath(root))
        await writeJsonFile(pendingInitPath(root), {
          ...pending,
          createdAt: '2026-11-07T01:00:00.000Z',
        });
      return lock;
    });
    try {
      const report = await runWorkspaceRecover({ root, configHome: home, apply: true });
      expect(report.state).toBe('MISMATCH');
      expect(report.cleanupAllowed).toBe(false);
      expect(report.reasonCodes).toContain('RECOVERY_EVIDENCE_CHANGED');
      expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
      await expect(stat(initLockPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      spy.mockRestore();
    }
  });

  it('preserves a replaced init lock and pending if lock ownership changes during recovery', async () => {
    const { root, home } = await committed();
    const acquire = userIndex.acquireFileLock;
    const replacement = JSON.stringify({ token: 'replacement-owner' });
    const spy = vi.spyOn(userIndex, 'acquireFileLock').mockImplementation(async (path, options) => {
      const lock = await acquire(path, options);
      if (path === join(home, 'workspaces', 'index.lock'))
        await writeFile(initLockPath(root), replacement);
      return lock;
    });
    try {
      await expect(
        runWorkspaceRecover({ root, configHome: home, apply: true }),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_WRITE_FAILED',
        details: { lockReleaseFailed: true },
      });
      expect(await readFile(initLockPath(root), 'utf8')).toBe(replacement);
      expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
      await expect(stat(join(home, 'workspaces', 'index.lock'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('defaults to a read-only preview and never consumes enrollment or touches credentials', async () => {
    const { root, home } = await committed();
    const rootBefore = await snapshotTree(root);
    const homeBefore = await snapshotTree(home);
    const report = await runWorkspaceRecover({ root, configHome: home });
    expect(report).toMatchObject({
      mode: 'preview',
      state: 'COMMITTED_PENDING',
      cleanupAllowed: true,
      writes: [],
      checks: { workspace: true, userIndex: true, planDigest: true },
    });
    expect(await snapshotTree(root)).toEqual(rootBefore);
    expect(await snapshotTree(home)).toEqual(homeBefore);
    expect(report.nextAction).toContain('--apply');
  });

  it('only explicit apply removes pending, preserves both authoritative files and releases its locks', async () => {
    const { root, home } = await committed();
    const configBefore = await readFile(workspaceV2Path(root), 'utf8');
    const indexBefore = await readFile(join(home, 'workspaces', 'index.json'), 'utf8');
    expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
      state: 'CLEANED',
      mode: 'applied',
    });
    await expect(stat(pendingInitPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(workspaceV2Path(root), 'utf8')).toBe(configBefore);
    expect(await readFile(join(home, 'workspaces', 'index.json'), 'utf8')).toBe(indexBefore);
    for (const path of [
      initLockPath(root),
      join(root, '.workmesh', 'local', 'bind.lock'),
      join(home, 'workspaces', 'index.lock'),
    ])
      await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
      state: 'NO_PENDING',
      writes: [],
    });
  });

  it.each(['init', 'bind', 'userIndex'] as const)(
    'never deletes or overrides an existing %s lock',
    async (kind) => {
      const { root, home } = await committed();
      const lockPath =
        kind === 'init'
          ? initLockPath(root)
          : kind === 'bind'
            ? join(root, '.workmesh', 'local', 'bind.lock')
            : join(home, 'workspaces', 'index.lock');
      await writeFile(lockPath, '{interrupted or active');
      const before = await snapshotTree(root);
      const homeBefore = await snapshotTree(home);
      expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
        state: 'LOCKED',
        cleanupAllowed: false,
      });
      expect(await readFile(lockPath, 'utf8')).toBe('{interrupted or active');
      expect(await snapshotTree(root)).toEqual(before);
      expect(await snapshotTree(home)).toEqual(homeBefore);
    },
  );

  it.each([
    'workspaceId',
    'projectId',
    'platform',
    'definitionRevisionId',
    'definitionDigest',
    'planDigest',
  ] as const)('retains evidence when pending %s mismatches', async (field) => {
    const { root, home, pending } = await committed();
    const changed = {
      ...pending,
      [field]:
        field === 'workspaceId'
          ? WORKSPACE_B
          : field === 'projectId'
            ? PROJECT_B
            : field === 'platform'
              ? { origin: 'https://other.example.com', apiBasePath: '/api/v1' }
              : field === 'definitionRevisionId'
                ? REVISION_B
                : 'b'.repeat(64),
    };
    await writeJsonFile(pendingInitPath(root), changed);
    const before = await snapshotTree(root);
    expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
      state: 'MISMATCH',
      cleanupAllowed: false,
      writes: [],
    });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('detects plan changes beyond identity fields', async () => {
    const { root, home } = await committed();
    await writeV2Workspace(root, { roleKey: 'frontend' });
    const report = await runWorkspaceRecover({ root, configHome: home, apply: true });
    expect(report).toMatchObject({
      state: 'MISMATCH',
      checks: { workspace: true, planDigest: false },
    });
    expect(report.reasonCodes).toContain('PLAN_DIGEST_MISMATCH');
    expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
  });

  it.each(['project', 'platform', 'root'] as const)(
    'requires the actual indexed %s to match exactly',
    async (field) => {
      const { root, home } = await committed();
      const index = await loadUserIndex(home);
      index.workspaces[WORKSPACE] = {
        ...index.workspaces[WORKSPACE]!,
        ...(field === 'project'
          ? { projectId: PROJECT_B }
          : field === 'platform'
            ? { platform: { origin: 'https://other.example.com', apiBasePath: '/api/v1' } }
            : { root: await makeTempDir('wm-other-root-') }),
      };
      await saveUserIndex(home, index);
      expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
        state: 'MISMATCH',
        checks: { userIndex: false },
        writes: [],
      });
      expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
    },
  );

  it('keeps an incomplete init with no workspace intact and does not promise automatic resume', async () => {
    const { root, home } = await committed();
    await rm(workspaceV2Path(root));
    const report = await runWorkspaceRecover({ root, configHome: home, apply: true });
    expect(report).toMatchObject({ state: 'INCOMPLETE', cleanupAllowed: false, writes: [] });
    expect(report.nextAction).toContain('不自动续接授权');
    expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
  });

  it.each(['invalid', 'legacy', 'unknown'] as const)(
    'preserves %s pending without leaking its raw contents',
    async (kind) => {
      const { root, home, pending } = await committed();
      const raw =
        kind === 'invalid'
          ? '{secret-join-code'
          : JSON.stringify(
              kind === 'legacy'
                ? { ...pending, platform: undefined }
                : { ...pending, token: 'secret-join-code' },
            );
      await writeFile(pendingInitPath(root), raw);
      const report = await runWorkspaceRecover({ root, configHome: home, apply: true });
      expect(report.state).toBe('INVALID_PENDING');
      expect(JSON.stringify(report)).not.toContain('secret-join-code');
      expect(await readFile(pendingInitPath(root), 'utf8')).toBe(raw);
    },
  );

  it('refuses dual active configuration and leaves every file intact', async () => {
    const { root, home } = await committed();
    await writeV1Workspace(root);
    const before = await snapshotTree(root);
    expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
      state: 'MISMATCH',
      cleanupAllowed: false,
    });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('does not create root or config-home when no pending exists', async () => {
    const root = join(await makeTempDir(), 'absent');
    const home = join(await makeTempDir(), 'absent');
    expect(await runWorkspaceRecover({ root, configHome: home, apply: true })).toMatchObject({
      state: 'NO_PENDING',
      writes: [],
    });
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(home)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
