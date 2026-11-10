import { execFile } from 'node:child_process';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCATOR,
  makeCredential,
  makeDefinitionFixture,
  makeTempDir,
  markMigrated,
  PLATFORM,
  PROJECT,
  WORKSPACE,
  WORKSPACE_B,
  readJson,
  REPOSITORY,
  REPOSITORY_B,
  snapshotTree,
  writeDefinitionCache,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  detectWorkspaceState,
  parseWorkspaceRevision,
  readDefinitionCache,
  workspaceV2Path,
} from './workspace-config';
import {
  emptyUserIndex,
  findWorkspaceByGitRoot,
  loadUserIndex,
  saveUserIndex,
  upsertUserWorkspace,
} from './user-index';
import { runWorkspaceBind } from './workspace-bind';

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

async function parsedFixture(options: Parameters<typeof makeDefinitionFixture>[0] = {}) {
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
    ...options,
  });
  const parsed = await parseWorkspaceRevision(fixture.revisionData);
  return { fixture, parsed };
}

function onlineClient(options: {
  fixture: Awaited<ReturnType<typeof parsedFixture>>['fixture'];
  parsed: Awaited<ReturnType<typeof parsedFixture>>['parsed'];
  payloadPresent?: boolean;
}): {
  factory: (input: { platform: unknown; bearer?: string }) => Record<string, unknown>;
  revisionCalls: Array<{ projectId: string; revisionId: string }>;
  currentCalls: number;
} {
  const revisionCalls: Array<{ projectId: string; revisionId: string }> = [];
  const state = { currentCalls: 0 };
  const factory = (input: { platform: unknown; bearer?: string }) => {
    expect(input.bearer).toMatch(/^wm_a1\./);
    return {
      getWorkspaceDefinitionRevision: async (projectId: string, revisionId: string) => {
        revisionCalls.push({ projectId, revisionId });
        return {
          revision: options.parsed.revision,
          digestMatchesPayload: options.parsed.digestMatchesPayload,
          payloadPresent: options.payloadPresent ?? true,
          requestId: 'req-rev',
        };
      },
      getWorkspaceDefinition: async () => {
        state.currentCalls += 1;
        return {
          definitionStatus: 'CONFIGURED',
          projectId: PROJECT,
          revision: options.parsed.revision,
          digestMatchesPayload: true,
          requestId: 'req-current',
        };
      },
    };
  };
  return {
    factory,
    revisionCalls,
    get currentCalls() {
      return state.currentCalls;
    },
  };
}

async function singleRepoWorkspace(): Promise<{
  root: string;
  home: string;
  fixture: Awaited<ReturnType<typeof parsedFixture>>['fixture'];
  parsed: Awaited<ReturnType<typeof parsedFixture>>['parsed'];
}> {
  const root = await makeTempDir('wm-bind-');
  await initRepo(root);
  const home = await makeTempDir('wm-home-');
  const { fixture, parsed } = await parsedFixture();
  await writeV2Workspace(root, {
    definition: fixture.definitionRef,
    layoutKind: 'SINGLE_ROOT',
    repositories: [],
  });
  return { root, home, fixture, parsed };
}

async function waitForBoundConfig(root: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const config = await readJson<{ repositories: unknown[] }>(workspaceV2Path(root));
      if (config.repositories.length > 0) return;
    } catch {
      // The config exists before bind starts, but keep polling if the atomic write is in flight.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`bind did not write a repository mapping under ${root}`);
}

describe('workspace bind 在线（预览后才写）', () => {
  it('预览零写入，身份只到 DECLARED_MATCH，不宣称 provider 核验', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    const client = onlineClient({ fixture, parsed });
    const before = await snapshotTree(root);
    const result = await runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      apply: false,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
      now: () => new Date('2026-11-05T12:00:00.000Z'),
    });
    expect(result.applied).toBe(false);
    expect(result.identityStatus).toBe('DECLARED_MATCH');
    expect(result.providerVerified).toBe(false);
    expect(result.verificationText).toContain('未由托管方核验');
    expect(result.locator.matchedCanonicalLocator).toBe(DEFAULT_LOCATOR);
    expect(result.definition.source).toBe('PINNED_REVISION');
    expect(result.writes).toEqual([]);
    expect(result.wouldWrite.map((write) => write.path).join('\n')).toContain('workspace.json');
    expect(await snapshotTree(root)).toEqual(before);
    expect(await snapshotTree(home)).toEqual([]);
    // 仍未写入绑定
    const v2 = await readJson<{ repositories: unknown[] }>(workspaceV2Path(root));
    expect(v2.repositories).toEqual([]);
  });

  // Each bind probes Git through multiple child processes; allow headroom when the full suite
  // runs alongside API/Web workers while keeping a finite ceiling for a genuinely stuck bind.
  it('--yes 后写入 workspace 映射 + 用户索引 gitRoots + 定义缓存；重复 bind 幂等', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    const client = onlineClient({ fixture, parsed });
    const result = await runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
      now: () => new Date('2026-11-05T12:00:00.000Z'),
    });
    expect(result.applied).toBe(true);
    expect(result.repository).toEqual({
      key: 'web',
      projectRepositoryId: REPOSITORY,
      path: '.',
      remote: 'origin',
    });
    const v2 = await readJson<{
      repositories: Array<{ key: string; path: string; remote: string }>;
      workspaceId: string;
    }>(workspaceV2Path(root));
    expect(v2.repositories).toEqual([
      { key: 'web', projectRepositoryId: REPOSITORY, path: '.', remote: 'origin' },
    ]);
    const index = await loadUserIndex(home);
    expect(findWorkspaceByGitRoot(index, await realpath(root))?.workspaceId).toBe(v2.workspaceId);
    const cached = await readDefinitionCache(root, fixture.revisionId);
    expect(cached.cache?.digest).toBe(fixture.digest);

    // 幂等重复 bind：同一 projectRepositoryId 不产生第二条映射。
    await runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
    });
    const again = await readJson<{ repositories: unknown[] }>(workspaceV2Path(root));
    expect(again.repositories).toHaveLength(1);
  }, 15_000);

  // This exercises two real Git repositories plus serialized index persistence under contention.
  it('不同工作区并发 bind 共用 configHome 时保留双方索引条目和 Git root 映射', async () => {
    const { root: rootA, home, fixture, parsed } = await singleRepoWorkspace();
    const rootB = await makeTempDir('wm-bind-parallel-');
    await initRepo(rootB);
    await writeV2Workspace(rootB, {
      workspaceId: WORKSPACE_B,
      definition: fixture.definitionRef,
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    const client = onlineClient({ fixture, parsed });
    let notifySaver!: () => void;
    const saverEntered = new Promise<void>((resolve) => {
      notifySaver = resolve;
    });
    let releaseSaver!: () => void;
    const holdSaver = new Promise<void>((resolve) => {
      releaseSaver = resolve;
    });
    const indexSaver = async (saveHome: string, index: Parameters<typeof saveUserIndex>[1]) => {
      notifySaver();
      await holdSaver;
      return saveUserIndex(saveHome, index);
    };

    const first = runWorkspaceBind({
      root: rootA,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
      indexSaver,
    });
    // Observe rejections immediately while the assertions wait for a barrier.
    // Promise.all below still verifies failures after releasing that barrier.
    void first.catch(() => undefined);
    let second: Promise<unknown> | undefined;
    try {
      await saverEntered;
      second = runWorkspaceBind({
        root: rootB,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      });
      void second.catch(() => undefined);
      await waitForBoundConfig(rootB);
      releaseSaver();
      await Promise.all([first, second]);
    } finally {
      // Always unblock the injected saver so a failed assertion cannot strand the first bind.
      releaseSaver();
      await Promise.allSettled(second ? [first, second] : [first]);
    }

    const index = await loadUserIndex(home);
    expect(index.workspaces[WORKSPACE]?.projectId).toBe(PROJECT);
    expect(index.workspaces[WORKSPACE_B]?.projectId).toBe(PROJECT);
    expect(findWorkspaceByGitRoot(index, await realpath(rootA))?.workspaceId).toBe(WORKSPACE);
    expect(findWorkspaceByGitRoot(index, await realpath(rootB))?.workspaceId).toBe(WORKSPACE_B);
  }, 15_000);

  it('一个工作区索引写入失败时，等待中的另一个 bind 成功结果不会被回滚或覆盖', async () => {
    const { root: rootA, home, fixture, parsed } = await singleRepoWorkspace();
    const rootB = await makeTempDir('wm-bind-index-failure-');
    await initRepo(rootB);
    await writeV2Workspace(rootB, {
      workspaceId: WORKSPACE_B,
      definition: fixture.definitionRef,
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    const client = onlineClient({ fixture, parsed });
    let notifySaver!: () => void;
    const saverEntered = new Promise<void>((resolve) => {
      notifySaver = resolve;
    });
    let releaseSaver!: () => void;
    const holdSaver = new Promise<void>((resolve) => {
      releaseSaver = resolve;
    });
    const failingSaver = async () => {
      notifySaver();
      await holdSaver;
      throw new Error('injected index persistence failure');
    };

    const failedBind = runWorkspaceBind({
      root: rootA,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
      indexSaver: failingSaver,
    });
    void failedBind.catch(() => undefined);
    await saverEntered;
    const successfulBind = runWorkspaceBind({
      root: rootB,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
    });
    void successfulBind.catch(() => undefined);
    await waitForBoundConfig(rootB);
    releaseSaver();
    const [failed, succeeded] = await Promise.allSettled([failedBind, successfulBind]);
    expect(failed.status).toBe('rejected');
    if (failed.status === 'rejected')
      expect(failed.reason).toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    expect(succeeded.status).toBe('fulfilled');

    const configA = await readJson<{ repositories: unknown[] }>(workspaceV2Path(rootA));
    const configB = await readJson<{ repositories: unknown[] }>(workspaceV2Path(rootB));
    expect(configA.repositories).toEqual([]);
    expect(configB.repositories).toHaveLength(1);
    const index = await loadUserIndex(home);
    expect(index.workspaces[WORKSPACE]).toBeUndefined();
    expect(index.workspaces[WORKSPACE_B]?.projectId).toBe(PROJECT);
    expect(findWorkspaceByGitRoot(index, await realpath(rootA))).toBeNull();
    expect(findWorkspaceByGitRoot(index, await realpath(rootB))?.workspaceId).toBe(WORKSPACE_B);
  });

  it('当前进程持有 bind 锁时不覆盖锁或 workspace 配置', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    const lockPath = join(root, '.workmesh', 'local', 'bind.lock');
    await mkdir(join(root, '.workmesh', 'local'), { recursive: true });
    const activeLock = `${JSON.stringify({ pid: process.pid, token: 'active-bind' })}\n`;
    await writeFile(lockPath, activeLock, 'utf8');
    const beforeConfig = await readJson(workspaceV2Path(root));
    const client = onlineClient({ fixture, parsed });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    expect(await readFile(lockPath, 'utf8')).toBe(activeLock);
    expect(await readJson(workspaceV2Path(root))).toEqual(beforeConfig);
  });

  it('索引已保存但锁释放失败时保留 workspace 配置，报告两份状态已一致提交', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    const client = onlineClient({ fixture, parsed });
    const indexLockPath = join(home, 'workspaces', 'index.lock');
    const failure = runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
      indexLockRelease: async () => {
        throw new Error('injected lock release failure');
      },
    });
    await expect(failure).rejects.toMatchObject({
      code: 'WORKSPACE_WRITE_FAILED',
      message: expect.stringContaining('workspace.json 与用户索引均已提交并保持一致'),
      details: {
        indexCommitted: true,
        workspaceCommitted: true,
        lockReleaseFailed: true,
        rollback: 'not-needed',
      },
    });

    const config = await readJson<{ repositories: Array<{ projectRepositoryId: string }> }>(
      workspaceV2Path(root),
    );
    expect(config.repositories[0]?.projectRepositoryId).toBe(REPOSITORY);
    const index = await loadUserIndex(home);
    expect(findWorkspaceByGitRoot(index, await realpath(root))?.workspaceId).toBe(WORKSPACE);
    await expect(readFile(indexLockPath, 'utf8')).resolves.toContain('"token"');

    // The test deliberately leaves the injected lock behind; clear it after asserting the
    // fail-closed diagnostic so the temporary config home is not left with a fake owner.
    await rm(indexLockPath, { force: true });
  });

  it('并发 bind 锁定工作区配置且 Git root 冲突时保留旧索引映射', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    const otherWorkspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const index = upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: otherWorkspaceId,
      root: join(home, 'other'),
      projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      platform: PLATFORM,
      updatedAt: '2026-11-05T12:00:00.000Z',
      gitRoots: [await realpath(root)],
    });
    await saveUserIndex(home, index);
    const beforeConfig = await readJson(workspaceV2Path(root));
    const client = onlineClient({ fixture, parsed });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_WRITE_FAILED',
      details: { existingWorkspaceId: otherWorkspaceId },
    });
    expect(await readJson(workspaceV2Path(root))).toEqual(beforeConfig);
    expect(
      findWorkspaceByGitRoot(await loadUserIndex(home), await realpath(root))?.workspaceId,
    ).toBe(otherWorkspaceId);
  });

  it('remote 与已声明 canonical locator 不同 → MISMATCH，不按目录名/basename 认领', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    await git(root, ['remote', 'set-url', 'origin', 'https://example.com/acme/other.git']);
    const client = onlineClient({ fixture, parsed });
    const before = await snapshotTree(root);
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REPO_MISMATCH', exitCode: 5 });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('本机绑定 digest 与服务端精确 revision 不一致 → WORKSPACE_CONTEXT_STALE，零写入', async () => {
    const root = await makeTempDir('wm-bind-');
    await initRepo(root);
    const home = await makeTempDir('wm-home-');
    const { fixture, parsed } = await parsedFixture();
    await writeV2Workspace(root, {
      definition: { revisionId: fixture.revisionId, sha256: 'b'.repeat(64) },
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    const client = onlineClient({ fixture, parsed });
    const before = await snapshotTree(root);
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_CONTEXT_STALE' });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('已归档仓库拒绝绑定', async () => {
    const root = await makeTempDir('wm-bind-');
    await initRepo(root);
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({
      layoutKind: 'SINGLE_ROOT',
      repositories: [
        {
          key: 'web',
          projectRepositoryId: REPOSITORY,
          suggestedPath: '.',
          locators: [[DEFAULT_LOCATOR, 'HTTPS']],
          archivedAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
    const parsed = await parseWorkspaceRevision(fixture.revisionData);
    await writeV2Workspace(root, {
      definition: fixture.definitionRef,
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    const client = onlineClient({ fixture, parsed });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        apply: true,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REPO_MISMATCH' });
  });

  it.each(['project', 'digest', 'missing-payload'] as const)(
    '在线 revision %s 不一致时拒绝且不写配置',
    async (field) => {
      const { root, home, fixture, parsed } = await singleRepoWorkspace();
      const invalid = {
        ...parsed,
        digestMatchesPayload: field === 'digest' ? false : parsed.digestMatchesPayload,
        revision: {
          ...parsed.revision,
          payload: {
            ...parsed.revision.payload,
            projectId: field === 'project' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : PROJECT,
          },
        },
      };
      const client = onlineClient({
        fixture,
        parsed: invalid,
        payloadPresent: field !== 'missing-payload',
      });
      const before = await snapshotTree(root);
      await expect(
        runWorkspaceBind({
          root,
          repositoryId: REPOSITORY,
          path: '.',
          apply: true,
          configHome: home,
          credential: makeCredential() as never,
          clientFactory: client.factory as never,
        }),
      ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
      expect(await snapshotTree(root)).toEqual(before);
    },
  );

  it('--path 指向仓内子目录/根外路径被拒绝', async () => {
    const { root, home, fixture, parsed } = await singleRepoWorkspace();
    await mkdir(join(root, 'src'), { recursive: true });
    const client = onlineClient({ fixture, parsed });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: 'src',
        apply: false,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_REPO_NOT_FOUND' });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '../outside',
        apply: false,
        configHome: home,
        credential: makeCredential() as never,
        clientFactory: client.factory as never,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_PATH_OUTSIDE_ROOT' });
  });

  it('MIGRATED（definition=null）在线 bind 刷新当前已发布定义引用', async () => {
    const root = await makeTempDir('wm-bind-');
    await initRepo(root);
    const home = await makeTempDir('wm-home-');
    const { fixture, parsed } = await parsedFixture();
    await writeV2Workspace(root, {
      definition: null,
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    await markMigrated(root);
    const client = onlineClient({ fixture, parsed });
    const result = await runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      apply: true,
      configHome: home,
      credential: makeCredential() as never,
      clientFactory: client.factory as never,
    });
    expect(result.definition.source).toBe('CURRENT_DEFINITION');
    expect(result.definition.refreshed).toBe(true);
    expect(client.revisionCalls).toHaveLength(0);
    expect(client.currentCalls).toBe(1);
    const v2 = await readJson<{ definition: { revisionId: string; sha256: string } | null }>(
      workspaceV2Path(root),
    );
    expect(v2.definition).toEqual({ revisionId: fixture.revisionId, sha256: fixture.digest });
    expect((await readDefinitionCache(root, fixture.revisionId)).cache?.digest).toBe(
      fixture.digest,
    );
  });

  it('NONE/V1_ONLY/DUAL_ACTIVE 的 bind 行为符合五态矩阵', async () => {
    const home = await makeTempDir('wm-home-');
    const none = await makeTempDir();
    await expect(
      runWorkspaceBind({
        root: none,
        repositoryId: REPOSITORY,
        path: '.',
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_NOT_CONFIGURED', exitCode: 2 });

    const v1 = await makeTempDir();
    await writeV1Workspace(v1);
    await expect(
      runWorkspaceBind({
        root: v1,
        repositoryId: REPOSITORY,
        path: '.',
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_V1_MIGRATION_REQUIRED', exitCode: 2 });

    const dual = await makeTempDir();
    await writeV1Workspace(dual);
    await writeV2Workspace(dual);
    await expect(
      runWorkspaceBind({
        root: dual,
        repositoryId: REPOSITORY,
        path: '.',
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG', exitCode: 5 });
  });
});

describe('workspace bind --offline（仅摘要有效缓存 + 精确 locator）', () => {
  async function offlineWorkspace(
    options: {
      cache?: boolean;
      remote?: string;
      cacheOverrides?: Record<string, unknown>;
      definitionDigest?: string;
      stateFile?: unknown;
      definition?: null;
    } = {},
  ): Promise<{
    root: string;
    home: string;
    fixture: Awaited<ReturnType<typeof parsedFixture>>['fixture'];
  }> {
    const root = await makeTempDir('wm-bind-off-');
    await initRepo(root, options.remote ?? DEFAULT_LOCATOR);
    const home = await makeTempDir('wm-home-');
    const { fixture } = await parsedFixture();
    if (options.cache !== false)
      await writeDefinitionCache(root, fixture, options.cacheOverrides ?? {});
    await writeV2Workspace(root, {
      definition:
        options.definition === null
          ? null
          : {
              revisionId: fixture.revisionId,
              sha256: options.definitionDigest ?? fixture.digest,
            },
      layoutKind: 'SINGLE_ROOT',
      repositories: [],
    });
    if (options.definition === null) await markMigrated(root);
    if (options.stateFile) {
      await mkdir(join(root, '.workmesh', 'local'), { recursive: true });
      await writeFile(
        join(root, '.workmesh', 'local', 'state.json'),
        JSON.stringify(options.stateFile),
        'utf8',
      );
    }
    return { root, home, fixture };
  }

  it('无缓存拒绝 WORKSPACE_OFFLINE_UNVERIFIED（退出码 6），零写入、零网络', async () => {
    const { root, home } = await offlineWorkspace({ cache: false });
    const before = await snapshotTree(root);
    const factory = () => {
      throw new Error('offline 不应联网');
    };
    let failure: Error | null = null;
    try {
      await runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: true,
        configHome: home,
        clientFactory: factory as never,
      });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED', exitCode: 6 });
    expect((failure as { details?: { reasonCode?: string } }).details?.reasonCode).toBe(
      'NO_DEFINITION_CACHE',
    );
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('缓存 digest 与本机绑定不一致拒绝', async () => {
    const { root, home } = await offlineWorkspace({ definitionDigest: 'b'.repeat(64) });
    const before = await snapshotTree(root);
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: true,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED' });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('同名目录/仓库但 canonical locator 不同 → 拒绝，不按目录名猜测', async () => {
    // 目录仍叫 wm-bind-off-*，但 remote 指向另一个仓库；仓库 key=web 也不参与匹配。
    const { root, home } = await offlineWorkspace({
      remote: 'https://example.com/acme/other.git',
    });
    const before = await snapshotTree(root);
    let failure: Error | null = null;
    try {
      await runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: true,
        configHome: home,
      });
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED', exitCode: 6 });
    expect((failure as { details?: { reasonCode?: string } }).details?.reasonCode).toBe(
      'LOCATOR_MISMATCH',
    );
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('摘要有效缓存 + 精确 locator 匹配时成功，输出带 checkedAt 与 source: CACHED_DEFINITION', async () => {
    const { root, home, fixture } = await offlineWorkspace();
    const factory = () => {
      throw new Error('offline 不应联网');
    };
    const result = await runWorkspaceBind({
      root,
      repositoryId: REPOSITORY,
      path: '.',
      offline: true,
      apply: true,
      configHome: home,
      clientFactory: factory as never,
      now: () => new Date('2026-11-05T12:00:00.000Z'),
    });
    expect(result.applied).toBe(true);
    expect(result.offline).toBe(true);
    expect(result.definition.source).toBe('CACHED_DEFINITION');
    expect(result.checkedAt).toBe('2026-11-05T12:00:00.000Z');
    expect(result.identityStatus).toBe('DECLARED_MATCH');
    const v2 = await readJson<{ repositories: Array<{ projectRepositoryId: string }> }>(
      workspaceV2Path(root),
    );
    expect(v2.repositories[0]?.projectRepositoryId).toBe(REPOSITORY);
    const index = await loadUserIndex(home);
    expect(findWorkspaceByGitRoot(index, await realpath(root))).not.toBeNull();
    expect((await readDefinitionCache(root, fixture.revisionId)).cache?.digest).toBe(
      fixture.digest,
    );
  });

  it('迁移配置（definition=null）离线 bind 拒绝要求先在线刷新定义', async () => {
    const { root, home } = await offlineWorkspace({ definition: null });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DEFINITION_REQUIRED' });
  });

  it('本机存在 MISMATCH 历史时离线 bind 拒绝', async () => {
    const { root, home } = await offlineWorkspace({
      stateFile: { mismatches: { [REPOSITORY]: { reasonCode: 'LOCATOR_MISMATCH' } } },
    });
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED' });
  });

  it('缓存被篡改（payload 摘要不符）时拒绝', async () => {
    const { root, home, fixture } = await offlineWorkspace();
    const cachePath = join(root, '.workmesh', 'definitions', `${fixture.revisionId}.json`);
    const cached = await readJson<Record<string, unknown>>(cachePath);
    (cached.payload as Record<string, unknown>).schemaVersion = '9.9';
    await writeFile(cachePath, JSON.stringify(cached, null, 2), 'utf8');
    await expect(
      runWorkspaceBind({
        root,
        repositoryId: REPOSITORY,
        path: '.',
        offline: true,
        apply: false,
        configHome: home,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED' });
  });

  it.each(['locator', 'repository', 'project', 'repository-project', 'archived'] as const)(
    '缓存 %s 被单独更改时离线绑定失败',
    async (field) => {
      const { root, home, fixture } = await offlineWorkspace();
      const cachePath = join(root, '.workmesh', 'definitions', `${fixture.revisionId}.json`);
      const cache = await readJson<Record<string, any>>(cachePath);
      if (field === 'locator')
        cache.repositories[0].locators[0].canonicalLocator = 'https://other.example/repo';
      if (field === 'repository') cache.repositories[0].projectRepositoryId = REPOSITORY_B;
      if (field === 'project') cache.payload.projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      if (field === 'repository-project')
        cache.repositories[0].projectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      if (field === 'archived') cache.repositories[0].archivedAt = '2026-11-06T00:00:00.000Z';
      await writeFile(cachePath, JSON.stringify(cache), 'utf8');
      await expect(
        runWorkspaceBind({
          root,
          repositoryId: REPOSITORY,
          path: '.',
          offline: true,
          apply: false,
          configHome: home,
        }),
      ).rejects.toMatchObject({ code: 'WORKSPACE_OFFLINE_UNVERIFIED' });
    },
  );
});

describe('bind 不读取 DUAL_ACTIVE 配置推导状态', () => {
  it('DUAL_ACTIVE 下 discover/普通命令拒绝（由调用方保证）', async () => {
    const dir = await makeTempDir();
    await writeV1Workspace(dir);
    await writeV2Workspace(dir);
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('DUAL_ACTIVE');
  });
});
