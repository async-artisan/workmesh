import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCATOR,
  makeCredential,
  makeDefinitionFixture,
  makeTempDir,
  markMigrated,
  PROJECT,
  REPOSITORY,
  REVISION_B,
  snapshotTree,
  writeDefinitionCache,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  parseWorkspaceRevision,
  writeMigrationJournal,
  type MigrationJournal,
} from './workspace-config';
import { loadUserIndex } from './user-index';
import { runWorkspaceStatus } from './workspace-status';

const run = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: dir, windowsHide: true });
  return stdout;
}

async function initRepo(dir: string, remote = DEFAULT_LOCATOR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await writeFile(join(dir, 'README.md'), 'hello\n', 'utf8');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  if (remote) await git(dir, ['remote', 'add', 'origin', remote]);
}

async function boundWorkspace(
  options: {
    remote?: string;
    withCache?: boolean;
  } = {},
): Promise<{
  root: string;
  home: string;
  fixture: Awaited<ReturnType<typeof makeDefinitionFixture>>;
  parsed: Awaited<ReturnType<typeof parseWorkspaceRevision>>;
}> {
  const root = await makeTempDir('wm-status-');
  await initRepo(root, options.remote ?? DEFAULT_LOCATOR);
  const home = await makeTempDir('wm-home-');
  const fixture = await makeDefinitionFixture({
    layoutKind: 'SINGLE_ROOT',
    repositories: [
      {
        key: 'web',
        projectRepositoryId: REPOSITORY,
        suggestedPath: '.',
        locators: [[DEFAULT_LOCATOR, 'HTTPS']],
      },
    ],
  });
  const parsed = await parseWorkspaceRevision(fixture.revisionData);
  await writeV2Workspace(root, {
    definition: fixture.definitionRef,
    layoutKind: 'SINGLE_ROOT',
    repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, path: '.', remote: 'origin' }],
  });
  if (options.withCache !== false) await writeDefinitionCache(root, fixture);
  return { root, home, fixture, parsed };
}

function onlineFactory(parsed: Awaited<ReturnType<typeof parseWorkspaceRevision>>) {
  const calls: Array<{ bearer?: string }> = [];
  const factory = (input: { platform: unknown; bearer?: string }) => {
    calls.push({ bearer: input.bearer });
    return {
      getWorkspaceDefinition: async () => ({
        definitionStatus: 'CONFIGURED',
        projectId: PROJECT,
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
        requestId: 'req',
      }),
    };
  };
  return { factory, calls };
}

describe('workspace status 本地只读诊断', () => {
  it('存在中断 pending 时报告恢复诊断，保持只读且不给重复消费建议', async () => {
    const root = await makeTempDir('wm-status-pending-');
    const home = await makeTempDir('wm-home-');
    await mkdir(join(root, '.workmesh', 'local'), { recursive: true });
    await writeFile(join(root, '.workmesh', 'local', 'pending-init.json'), '{interrupted');
    const before = await snapshotTree(root);
    const homeBefore = await snapshotTree(home);
    const report = await runWorkspaceStatus({ root, configHome: home });
    expect(report.initRecovery).toMatchObject({ state: 'INVALID_PENDING', cleanupAllowed: false });
    expect(report.nextAction).toContain('保留记录');
    expect(await snapshotTree(root)).toEqual(before);
    expect(await snapshotTree(home)).toEqual(homeBefore);
  });

  it('无 --online 时 freshness=LOCAL_ONLY，不宣称 online，零写入', async () => {
    const { root, home } = await boundWorkspace();
    const before = await snapshotTree(root);
    const beforeHome = await snapshotTree(home);
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.state).toBe('V2_ONLY');
    expect(result.freshness).toBe('LOCAL_ONLY');
    expect(result.online).toBeNull();
    expect(JSON.stringify(result)).not.toContain('"source":"ONLINE_DEFINITION"');
    expect(result.providerVerification).toBe('NOT_PERFORMED');
    expect(result.definitionCache).toMatchObject({ present: true, matchesBinding: true });
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      identityStatus: 'DECLARED_MATCH',
      providerVerified: false,
      matchedCanonicalLocator: DEFAULT_LOCATOR,
    });
    expect(result.writes).toEqual([]);
    expect(await snapshotTree(root)).toEqual(before);
    expect(await snapshotTree(home)).toEqual(beforeHome);
  });

  it('remote 不匹配时报告 MISMATCH，并给出修复动作', async () => {
    const { root, home } = await boundWorkspace({ remote: 'https://example.com/acme/other.git' });
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.repositories[0]).toMatchObject({
      identityStatus: 'MISMATCH',
      reasonCode: 'LOCATOR_MISMATCH',
    });
    expect(result.nextAction).toContain('MISMATCH');
  });

  it('缺少 revision 缓存时 UNAVAILABLE，不伪造 DECLARED_MATCH', async () => {
    const { root, home } = await boundWorkspace({ withCache: false });
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.repositories[0]).toMatchObject({
      identityStatus: 'UNAVAILABLE',
      reasonCode: 'DEFINITION_CACHE_MISSING',
    });
  });

  it('V1_ONLY：识别 v1 并提示迁移命令', async () => {
    const root = await makeTempDir('wm-status-');
    await writeV1Workspace(root);
    const home = await makeTempDir('wm-home-');
    const before = await snapshotTree(root);
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.state).toBe('V1_ONLY');
    expect(result.projectId).toBe(PROJECT);
    expect(result.v1Migration).toEqual({
      required: true,
      command: 'workmesh workspace migrate --dry-run',
    });
    expect(result.freshness).toBe('LOCAL_ONLY');
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('NONE：只读接入建议', async () => {
    const root = await makeTempDir('wm-status-');
    const home = await makeTempDir('wm-home-');
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.state).toBe('NONE');
    expect(result.nextAction).toContain('workspace init');
  });

  it('MIGRATED：展示备份且不读取 .bak；definition=null 提供在线刷新建议', async () => {
    const root = await makeTempDir('wm-status-');
    await writeV2Workspace(root, { definition: null });
    await markMigrated(root);
    const home = await makeTempDir('wm-home-');
    const before = await snapshotTree(root);
    const result = await runWorkspaceStatus({ root, configHome: home });
    expect(result.state).toBe('MIGRATED');
    expect(result.backups).toHaveLength(1);
    expect(result.definition).toBeNull();
    expect(result.nextAction).toContain('bind');
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('DUAL_ACTIVE：只读诊断并退出码 5，报告两个文件摘要与 nextAction，零写零删', async () => {
    const root = await makeTempDir('wm-status-');
    await writeV1Workspace(root);
    await writeV2Workspace(root, { definition: null });
    const journal: MigrationJournal = {
      schemaVersion: '1.0',
      migrationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      phase: 'V2_WRITTEN',
      workspaceId: '11111111-1111-4111-8111-111111111111',
      previousState: 'V1_ONLY',
      v1File: 'config.json',
      v2File: 'workspace.json',
      backupFile: '20261105T120000000Z',
      startedAt: '2026-11-05T12:00:00.000Z',
      updatedAt: '2026-11-05T12:00:00.000Z',
      resolution: null,
      error: null,
    };
    await writeMigrationJournal(root, journal);
    const home = await makeTempDir('wm-home-');
    const before = await snapshotTree(root);
    let failure: (Error & { details?: Record<string, unknown> }) | null = null;
    try {
      await runWorkspaceStatus({ root, configHome: home });
    } catch (error) {
      failure = error as Error & { details?: Record<string, unknown> };
    }
    expect(failure).toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG', exitCode: 5 });
    const status = (failure?.details as { status?: Record<string, unknown> })?.status as {
      state: string;
      files: { v1: { digest: string }; v2: { digest: string } };
      nextAction: string;
    };
    expect(status.state).toBe('DUAL_ACTIVE');
    expect(status.files.v1.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(status.files.v2.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(status.nextAction).toContain('migrate --inspect');
    expect(await snapshotTree(root)).toEqual(before);
  });
});

describe('workspace status --online（只读比对）', () => {
  it('成功比对时 freshness=ONLINE + source=ONLINE_DEFINITION，且不写缓存', async () => {
    const { root, home, fixture, parsed } = await boundWorkspace();
    const online = onlineFactory(parsed);
    const before = await snapshotTree(root);
    const result = await runWorkspaceStatus({
      root,
      configHome: home,
      online: true,
      credential: makeCredential() as never,
      clientFactory: online.factory as never,
    });
    expect(result.freshness).toBe('ONLINE');
    expect(result.online).toMatchObject({
      status: 'ONLINE',
      source: 'ONLINE_DEFINITION',
      currentRevisionId: fixture.revisionId,
      bindingRevisionMatches: true,
      digestMatches: true,
      digestVerified: true,
      definitionStatus: 'CONFIGURED',
    });
    expect(online.calls).toHaveLength(1);
    expect(online.calls[0]?.bearer).toMatch(/^wm_a1\./);
    // status 只读：不写用户索引/缓存。
    expect(await snapshotTree(root)).toEqual(before);
    await expect(
      (await import('node:fs/promises')).stat(join(home, 'workspaces', 'index.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('平台已发布新 revision 时报告 STALE，不自动切换绑定', async () => {
    const { root, home } = await boundWorkspace();
    const newer = await makeDefinitionFixture({
      revisionId: REVISION_B,
      layoutKind: 'MULTI_ROOT',
      repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, suggestedPath: 'apps/web' }],
    });
    const parsedNewer = await parseWorkspaceRevision(newer.revisionData);
    const online = onlineFactory(parsedNewer);
    const result = await runWorkspaceStatus({
      root,
      configHome: home,
      online: true,
      credential: makeCredential() as never,
      clientFactory: online.factory as never,
    });
    expect(result.online).toMatchObject({
      status: 'STALE',
      currentRevisionId: REVISION_B,
      bindingRevisionMatches: false,
      digestMatches: false,
    });
    expect(result.nextAction).toContain('不会自动切换');
  });

  it('--online 且没有本地凭据时明确 AUTH_REQUIRED，不退回离线谎报', async () => {
    const { root, home } = await boundWorkspace();
    await expect(
      runWorkspaceStatus({ root, configHome: home, online: true }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', exitCode: 3 });
  });

  it('MIGRATED（definition=null）--online 时报告 definition required，不伪造匹配', async () => {
    const { parsed } = await boundWorkspace();
    const migratedRoot = await makeTempDir('wm-status-');
    await writeV2Workspace(migratedRoot, { definition: null });
    await markMigrated(migratedRoot);
    const home = await makeTempDir('wm-home-');
    const online = onlineFactory(parsed);
    const result = await runWorkspaceStatus({
      root: migratedRoot,
      configHome: home,
      online: true,
      credential: makeCredential() as never,
      clientFactory: online.factory as never,
    });
    expect(result.definition).toBeNull();
    expect(result.online).toMatchObject({
      status: 'STALE',
      bindingRevisionMatches: false,
      reasonCode: 'WORKSPACE_DEFINITION_REQUIRED',
    });
    const index = await loadUserIndex(home).catch(() => null);
    expect(index?.workspaces).toEqual({});
    expect(index?.gitRoots).toEqual({});
  });
});
