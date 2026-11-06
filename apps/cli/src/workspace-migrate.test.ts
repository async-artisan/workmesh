import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeDefinitionFixture,
  makeTempDir,
  PLATFORM,
  PROJECT,
  PROJECT_B,
  REVISION,
  REPOSITORY,
  ROLE,
  snapshotTree,
  v2Config,
  WORKSPACE,
  writeDefinitionCache,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  detectWorkspaceState,
  legacyWorkspaceView,
  loadWorkspaceConfigV2,
  migrationJournalPath,
  resolveActiveWorkspace,
  workspaceBackupPath,
  workspaceV2Path,
  writeMigrationJournal,
  type MigrationJournal,
} from './workspace-config';
import {
  emptyUserIndex,
  loadUserIndex,
  saveUserIndex,
  upsertUserWorkspace,
  userIndexLabel,
} from './user-index';
import {
  runMigrationApply,
  runMigrationDryRun,
  runMigrationInspect,
  runMigrationResolve,
} from './workspace-migrate';

const NOW = new Date('2026-11-05T12:00:00.000Z');

function journal(overrides: Partial<MigrationJournal> = {}): MigrationJournal {
  return {
    schemaVersion: '1.0',
    migrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    phase: 'V2_WRITTEN',
    workspaceId: WORKSPACE,
    previousState: 'V1_ONLY',
    v1File: 'config.json',
    v2File: 'workspace.json',
    backupFile: '20261105T120000000Z',
    v2Digest: null,
    startedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    resolution: null,
    error: null,
    ...overrides,
  };
}

function digest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function journalForV2(
  dir: string,
  overrides: Partial<MigrationJournal> = {},
): Promise<MigrationJournal> {
  return journal({
    v2Digest: digest(await readFile(workspaceV2Path(dir))),
    ...overrides,
  });
}

async function dualActive(): Promise<{ dir: string; home: string }> {
  const dir = await makeTempDir();
  const home = await makeTempDir('wm-home-');
  await writeV1Workspace(dir);
  await writeV2Workspace(dir, { definition: null });
  await writeMigrationJournal(dir, await journalForV2(dir));
  expect((await detectWorkspaceState(dir)).state).toBe('DUAL_ACTIVE');
  return { dir, home };
}

async function backupFiles(dir: string): Promise<string[]> {
  return (await readdir(join(dir, '.workmesh'))).filter((name) => name.endsWith('.json.bak'));
}

afterEach(() => {
  // temp dirs are per-test
});

describe('workspace migrate --dry-run', () => {
  it('列出 8 字段映射与备份位置，且零写入', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir, { repositoryId: REPOSITORY });
    const before = await snapshotTree(dir);
    const result = await runMigrationDryRun({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(result.mode).toBe('dry-run');
    expect(result.state).toBe('V1_ONLY');
    expect(result.alreadyMigrated).toBe(false);
    expect(result.plan?.projectId).toBe(PROJECT);
    expect(result.plan?.platform).toEqual(PLATFORM);
    expect(result.plan?.layoutKind).toBe('SINGLE_ROOT');
    expect(result.plan?.repositories).toEqual([
      expect.objectContaining({
        key: 'legacy-repository',
        projectRepositoryId: REPOSITORY,
        path: '.',
        needsRevalidation: true,
      }),
    ]);
    expect(result.wouldWrite.map((write) => write.path).join('\n')).toContain('config.v1.');
    expect(result.writes).toEqual([]);
    expect(await snapshotTree(dir)).toEqual(before);
    expect(await snapshotTree(home)).toEqual([]);
    // dry-run 不写 journal
    await expect(stat(migrationJournalPath(dir))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('repositoryId=null 时不猜仓库，映射为空且 layout NONE', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const result = await runMigrationDryRun({ root: dir, configHome: home });
    expect(result.plan?.layoutKind).toBe('NONE');
    expect(result.plan?.repositories).toEqual([]);
  });

  it('NONE 状态返回 CONFIG_NOT_FOUND；DUAL_ACTIVE 拒绝', async () => {
    const home = await makeTempDir('wm-home-');
    const empty = await makeTempDir();
    await expect(runMigrationDryRun({ root: empty, configHome: home })).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
    });

    const dir = await makeTempDir();
    await writeV1Workspace(dir);
    await writeV2Workspace(dir, { definition: null });
    await writeMigrationJournal(dir, await journalForV2(dir));
    await expect(runMigrationDryRun({ root: dir, configHome: home })).rejects.toMatchObject({
      code: 'WORKSPACE_DUAL_CONFIG',
      exitCode: 5,
    });
  });
});

describe('workspace migrate --apply', () => {
  it('成功后为 MIGRATED：v1 归档为 .bak、v2 生效、索引更新、旧命令按 v2 读取', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir, { repositoryId: REPOSITORY });
    const v1Raw = await readFile(join(dir, '.workmesh', 'config.json'), 'utf8');

    const result = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(result.mode).toBe('apply');
    expect(result.state).toBe('MIGRATED');
    expect(result.journalPhase).toBe('COMMITTED');
    expect(result.alreadyMigrated).toBe(false);
    expect(result.backupFile).toBeTruthy();

    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v1.exists).toBe(false);
    expect(snapshot.backups).toHaveLength(1);
    const backupPath = workspaceBackupPath(dir, result.backupFile ?? '');
    expect(await readFile(backupPath, 'utf8')).toBe(v1Raw);
    const backupMode = (await stat(backupPath)).mode & 0o777;
    if (process.platform !== 'win32') expect(backupMode).toBe(0o600);

    const v2 = await loadWorkspaceConfigV2(dir, { allowNullDefinition: true });
    expect(v2.projectId).toBe(PROJECT);
    expect(v2.definition).toBeNull();
    expect(v2.defaults.roleKey).toBe(ROLE);

    const active = await resolveActiveWorkspace(dir);
    expect(active.kind).toBe('V2');
    if (active.kind === 'V2') {
      expect(active.state).toBe('MIGRATED');
      const legacy = legacyWorkspaceView(active.config);
      expect(legacy.projectId).toBe(PROJECT);
      expect(legacy.roleKey).toBe(ROLE);
      expect(legacy.platform).toEqual(PLATFORM);
    }

    const index = await loadUserIndex(home);
    expect(index.workspaces[v2.workspaceId]).toMatchObject({
      projectId: PROJECT,
      platform: PLATFORM,
    });
  });

  it('重复执行幂等（零写入），dry-run 显示已迁移', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    await runMigrationApply({ root: dir, configHome: home });
    const before = await snapshotTree(dir);
    const second = await runMigrationApply({ root: dir, configHome: home });
    expect(second.alreadyMigrated).toBe(true);
    expect(second.writes).toEqual([]);
    expect(await snapshotTree(dir)).toEqual(before);
    const dry = await runMigrationDryRun({ root: dir, configHome: home });
    expect(dry.alreadyMigrated).toBe(true);
    expect(dry.writes).toEqual([]);
  });

  it('V2_WRITTEN 检查点中断时保留活动文件，journal 记录 FAILED 且可恢复', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const v1Raw = await readFile(join(dir, '.workmesh', 'config.json'), 'utf8');
    await expect(
      runMigrationApply({ root: dir, configHome: home, deps: { failAt: 'V2', now: () => NOW } }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED', exitCode: 9 });
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('DUAL_ACTIVE');
    expect(snapshot.v1.exists).toBe(true);
    expect(await readFile(join(dir, '.workmesh', 'config.json'), 'utf8')).toBe(v1Raw);
    expect(snapshot.v2.valid).toBe(true);
    expect(snapshot.journal?.phase).toBe('FAILED');
    // 修复后重试成功，并复用同一个备份
    const retried = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(retried.state).toBe('MIGRATED');
    expect(await backupFiles(dir)).toHaveLength(1);
  });

  it('归档后用户索引写入失败时保留有效状态，索引无新条目且可恢复重试', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const unrelatedId = PROJECT_B;
    await saveUserIndex(
      home,
      upsertUserWorkspace(emptyUserIndex(), {
        workspaceId: unrelatedId,
        root: join(home, 'other-workspace'),
        projectId: PROJECT_B,
        platform: PLATFORM,
        updatedAt: NOW.toISOString(),
      }),
    );
    await expect(
      runMigrationApply({
        root: dir,
        configHome: home,
        deps: {
          now: () => NOW,
          saveIndex: async () => {
            throw new Error('disk full');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED', exitCode: 9 });
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v2.valid).toBe(true);
    expect(snapshot.v1.exists).toBe(false);
    expect(snapshot.backups).toHaveLength(1);
    const migratedWorkspaceId = snapshot.v2.value?.workspaceId as string;
    expect(snapshot.journal?.phase).toBe('FAILED');
    expect((await loadUserIndex(home)).workspaces).not.toHaveProperty(migratedWorkspaceId);
    const retried = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(retried.state).toBe('MIGRATED');
    const index = await loadUserIndex(home);
    expect(index.workspaces).toHaveProperty(migratedWorkspaceId);
    expect(index.workspaces).toHaveProperty(unrelatedId);
  });

  it('原子 rename 失败不覆盖备份、不写索引，保留两份活动配置供重试', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const v1Raw = await readFile(join(dir, '.workmesh', 'config.json'));
    await expect(
      runMigrationApply({
        root: dir,
        configHome: home,
        deps: {
          now: () => NOW,
          rename: async () => {
            throw Object.assign(new Error('access denied'), { code: 'EACCES' });
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('DUAL_ACTIVE');
    expect(await readFile(join(dir, '.workmesh', 'config.json'))).toEqual(v1Raw);
    expect(snapshot.journal?.phase).toBe('FAILED');
    expect((await loadUserIndex(home)).workspaces).not.toHaveProperty(WORKSPACE);
    const retried = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(retried.state).toBe('MIGRATED');
  });

  it('rename 成功后立即中断时保留完整备份，重试补齐索引与最终 journal', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const v1Raw = await readFile(join(dir, '.workmesh', 'config.json'));
    await expect(
      runMigrationApply({
        root: dir,
        configHome: home,
        deps: { now: () => NOW, failAt: 'ARCHIVE' },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v1.exists).toBe(false);
    expect(await readFile(snapshot.backups[0] as string)).toEqual(v1Raw);
    const workspaceId = snapshot.v2.value?.workspaceId as string;
    expect((await loadUserIndex(home)).workspaces).not.toHaveProperty(workspaceId);
    expect(snapshot.journal?.phase).toBe('FAILED');

    const retried = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(retried.journalPhase).toBe('COMMITTED');
    expect((await loadUserIndex(home)).workspaces).toHaveProperty(workspaceId);
    expect((await detectWorkspaceState(dir)).journal?.phase).toBe('COMMITTED');
  });

  it('v2 已写入但 journal 仍为 PLANNED 时按预先记录的摘要安全恢复', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const v1 = await writeV1Workspace(dir);
    await writeV2Workspace(dir, { workspaceId: WORKSPACE, definition: null });
    const v2Raw = await readFile(workspaceV2Path(dir));
    const planned = journal({
      phase: 'PLANNED',
      workspaceId: WORKSPACE,
      backupFile: '20261105T120000000Z',
      v2Digest: digest(v2Raw),
    });
    await writeMigrationJournal(dir, planned);
    expect(v1.projectId).toBe(PROJECT);
    const result = await runMigrationApply({ root: dir, configHome: home });
    expect(result.state).toBe('MIGRATED');
    expect((await readFile(workspaceV2Path(dir))).equals(v2Raw)).toBe(true);
    expect((await detectWorkspaceState(dir)).journal?.phase).toBe('COMMITTED');
  });

  it('keep-v2 在摘要不匹配、旧 journal 或错误阶段时拒绝并保留活动文件', async () => {
    const { dir, home } = await dualActive();
    const path = workspaceV2Path(dir);
    const original = await readFile(path, 'utf8');
    const modified = JSON.parse(original) as Record<string, unknown>;
    modified.defaults = { profile: 'changed', host: 'codex', roleKey: ROLE };
    await writeFile(path, `${JSON.stringify(modified, null, 2)}\n`, 'utf8');
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    expect(await stat(join(dir, '.workmesh', 'config.json'))).toBeTruthy();
    await writeFile(path, original, 'utf8');

    await writeMigrationJournal(dir, await journalForV2(dir, { v2Digest: null }));
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    await writeMigrationJournal(dir, await journalForV2(dir, { phase: 'PLANNED' }));
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG' });
    expect((await detectWorkspaceState(dir)).state).toBe('DUAL_ACTIVE');
  });

  it('keep-v2 索引写入失败后保留归档与 v2，重试补齐索引且保留其他 workspace', async () => {
    const { dir, home } = await dualActive();
    await saveUserIndex(
      home,
      upsertUserWorkspace(emptyUserIndex(), {
        workspaceId: PROJECT_B,
        root: join(home, 'other'),
        projectId: PROJECT_B,
        platform: PLATFORM,
        updatedAt: NOW.toISOString(),
      }),
    );
    const v2Raw = await readFile(workspaceV2Path(dir));
    await expect(
      runMigrationResolve({
        root: dir,
        configHome: home,
        mode: 'keep-v2',
        deps: {
          saveIndex: async () => {
            throw new Error('disk full');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    expect((await detectWorkspaceState(dir)).state).toBe('MIGRATED');
    expect(await readFile(workspaceV2Path(dir))).toEqual(v2Raw);
    expect((await loadUserIndex(home)).workspaces).not.toHaveProperty(WORKSPACE);
    const result = await runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' });
    expect(result.state).toBe('MIGRATED');
    const index = await loadUserIndex(home);
    expect(index.workspaces).toHaveProperty(WORKSPACE);
    expect(index.workspaces).toHaveProperty(PROJECT_B);
  });

  it('从 rename 后 journal 未提交的中断恢复索引与 COMMITTED 阶段', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV2Workspace(dir, { workspaceId: WORKSPACE, definition: null });
    const backup = workspaceBackupPath(dir, '20261105T120000000Z');
    await mkdir(join(dir, '.workmesh'), { recursive: true });
    await writeFile(backup, 'archived v1 bytes', 'utf8');
    await writeMigrationJournal(
      dir,
      await journalForV2(dir, { phase: 'INDEX_WRITTEN', backupFile: '20261105T120000000Z' }),
    );
    expect((await detectWorkspaceState(dir)).state).toBe('MIGRATED');

    const result = await runMigrationApply({
      root: dir,
      configHome: home,
      deps: { now: () => NOW },
    });
    expect(result.state).toBe('MIGRATED');
    expect(result.journalPhase).toBe('COMMITTED');
    expect(result.writes).toContainEqual({ path: userIndexLabel(), action: 'REPLACE' });
    expect((await detectWorkspaceState(dir)).journal?.phase).toBe('COMMITTED');
    const index = await loadUserIndex(home);
    expect(index.workspaces[WORKSPACE]).toMatchObject({ projectId: PROJECT, platform: PLATFORM });
  });
});

describe('workspace migrate --inspect / --resolve（DUAL_ACTIVE 只读例外）', () => {
  it('--inspect 报告两文件摘要/journal/一致性且零写入零删除', async () => {
    const { dir } = await dualActive();
    const before = await snapshotTree(dir);
    const result = await runMigrationInspect({ root: dir });
    expect(result.state).toBe('DUAL_ACTIVE');
    expect(result.files.v1.exists).toBe(true);
    expect(result.files.v2.exists).toBe(true);
    expect(result.files.v1.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.files.v2.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.journal.phase).toBe('V2_WRITTEN');
    expect(result.consistency.projectIdsMatch).toBe(true);
    expect(result.consistency.platformsMatch).toBe(true);
    expect(result.writes).toEqual([]);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('--resolve keep-v2：只归档 v1、不读 .bak，v2 保持不变', async () => {
    const { dir, home } = await dualActive();
    const priorIndex = upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: PROJECT_B,
      root: join(home, 'other-workspace'),
      projectId: PROJECT_B,
      platform: PLATFORM,
      updatedAt: NOW.toISOString(),
    });
    await saveUserIndex(home, priorIndex);
    const v1Raw = await readFile(join(dir, '.workmesh', 'config.json'), 'utf8');
    const v2Raw = await readFile(workspaceV2Path(dir), 'utf8');
    const result = await runMigrationResolve({
      root: dir,
      configHome: home,
      mode: 'keep-v2',
      deps: { now: () => NOW },
    });
    expect(result.resolution).toBe('KEEP_V2');
    expect(result.state).toBe('MIGRATED');
    expect(result.writes.map((write) => write.action)).toContain('ARCHIVE');
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v1.exists).toBe(false);
    expect(snapshot.backups).toHaveLength(1);
    expect(await readFile(snapshot.backups[0] as string, 'utf8')).toBe(v1Raw);
    expect(await readFile(workspaceV2Path(dir), 'utf8')).toBe(v2Raw);
    expect(snapshot.journal?.resolution).toBe('KEEP_V2');
    expect(snapshot.journal?.phase).toBe('COMMITTED');
    const index = await loadUserIndex(home);
    expect(index.workspaces[WORKSPACE]).toMatchObject({ projectId: PROJECT, platform: PLATFORM });
    expect(index.workspaces[PROJECT_B]).toMatchObject({ projectId: PROJECT_B });
  });

  it('v2 无效时 keep-v2 拒绝且不删除活动配置', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    const { writeFile, mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, '.workmesh'), { recursive: true });
    await writeFile(
      join(dir, '.workmesh', 'workspace.json'),
      JSON.stringify({ schemaVersion: '2.0' }),
      'utf8',
    );
    const before = await snapshotTree(dir);
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('缺少迁移 journal 时 keep-v2 拒绝（不自动收敛手工冲突）', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    await writeV2Workspace(dir, { definition: null });
    const before = await snapshotTree(dir);
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('v2 的 projectId 与 v1 不一致时 keep-v2 拒绝', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    await writeV2Workspace(dir, { definition: null, projectId: PROJECT_B });
    await writeMigrationJournal(dir, await journalForV2(dir));
    const before = await snapshotTree(dir);
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('v2 的定义引用与本地 revision 缓存摘要不一致时 keep-v2 拒绝', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV1Workspace(dir);
    // v2 带 definition 引用（默认 sha256 为 a*64）。
    await writeV2Workspace(dir);
    const fixture = await makeDefinitionFixture({
      revisionId: String((v2Config().definition as Record<string, unknown>).revisionId),
      layoutKind: 'NONE',
    });
    await writeDefinitionCache(dir, fixture);
    await writeMigrationJournal(dir, await journalForV2(dir));
    const before = await snapshotTree(dir);
    await expect(
      runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('定义缓存缺失时不作为活动配置来源；缓存损坏时拒绝 keep-v2', async () => {
    const { dir, home } = await dualActive();
    // 双配置中缺少可选派生缓存不会改变 v2 配置本身的摘要验证。
    const accepted = await runMigrationResolve({ root: dir, configHome: home, mode: 'keep-v2' });
    expect(accepted.state).toBe('MIGRATED');

    const damaged = await makeTempDir();
    const damagedHome = await makeTempDir('wm-home-');
    await writeV1Workspace(damaged);
    await writeV2Workspace(damaged);
    await mkdir(join(damaged, '.workmesh', 'definitions'), { recursive: true });
    await writeFile(
      join(damaged, '.workmesh', 'definitions', `${REVISION}.json`),
      '{broken json',
      'utf8',
    );
    await writeMigrationJournal(damaged, await journalForV2(damaged));
    const before = await snapshotTree(damaged);
    await expect(
      runMigrationResolve({ root: damaged, configHome: damagedHome, mode: 'keep-v2' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    expect(await snapshotTree(damaged)).toEqual(before);
  });

  it('--resolve keep-v1 只给指引，零写入零删除', async () => {
    const { dir, home } = await dualActive();
    const before = await snapshotTree(dir);
    const result = await runMigrationResolve({
      root: dir,
      configHome: home,
      mode: 'keep-v1',
      deps: { now: () => NOW },
    });
    expect(result.resolution).toBe('KEEP_V1');
    expect(result.writes).toEqual([]);
    expect(result.nextAction).toContain('未删除任何活动配置');
    expect(await snapshotTree(dir)).toEqual(before);
  });
});

describe('.bak 永不作为活动配置', () => {
  it('只有 v2 与一个“可解析 v1”的 .bak 时仍是 MIGRATED，不进入 DUAL_ACTIVE', async () => {
    const dir = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV2Workspace(dir, { definition: null });
    await writeV1Workspace(dir, { projectId: PROJECT_B });
    const { readFile: read, unlink } = await import('node:fs/promises');
    const v1Raw = await read(join(dir, '.workmesh', 'config.json'), 'utf8');
    await unlink(join(dir, '.workmesh', 'config.json'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(dir, '.workmesh', 'config.v1.20261105T120000000Z.json.bak'),
      v1Raw,
      'utf8',
    );
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v1.exists).toBe(false);
    const active = await resolveActiveWorkspace(dir);
    expect(active.kind).toBe('V2');
    // .bak 中的旧 projectId 不参与任何解析
    await expect(loadUserIndex(home)).resolves.toBeTruthy();
    expect(v2Config().projectId).toBe(PROJECT);
  });
});
