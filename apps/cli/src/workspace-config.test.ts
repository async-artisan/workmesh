import { mkdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  API,
  DEFAULT_LOCATOR,
  makeDefinitionFixture,
  makeTempDir,
  PLATFORM,
  PROJECT,
  PROJECT_B,
  readJson,
  REPOSITORY,
  REPOSITORY_B,
  REVISION,
  REVISION_B,
  ROLE,
  USER_ID,
  v2Config,
  WORKSPACE,
  WORKSPACE_B,
  writeDefinitionCache,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  definitionDigestOf,
  detectWorkspaceState,
  dualConfigError,
  legacyWorkspaceView,
  loadWorkspaceConfigV2,
  parseConsumedEnrollment,
  parseCurrentWorkspaceDefinition,
  parseWorkspaceConfigV2,
  parseWorkspaceRevision,
  readDefinitionCache,
  resolveActiveWorkspace,
  saveWorkspaceConfigV2,
  workspaceBackupPath,
  workspaceV2Path,
} from './workspace-config';
import {
  addGitRootMapping,
  canonicalWorkspaceRoot,
  emptyUserIndex,
  findWorkspaceByGitRoot,
  gitRootKey,
  loadUserIndex,
  saveUserIndex,
  updateUserIndex,
  upsertUserWorkspace,
  userIndexPath,
} from './user-index';

const POSIX = process.platform !== 'win32';

afterEach(() => {
  // no shared mutable state
});

describe('v2 workspace config', () => {
  it('round-trip：原子写入后按原值读回，不含绝对路径/凭据', async () => {
    const dir = await makeTempDir();
    const parsed = parseWorkspaceConfigV2(v2Config());
    const path = await saveWorkspaceConfigV2(dir, parsed);
    expect(path).toBe(workspaceV2Path(dir));
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toMatch(/token|secret|password/i);
    expect(raw).not.toContain(dir);
    const loaded = await loadWorkspaceConfigV2(dir);
    expect(loaded.workspaceId).toBe(WORKSPACE);
    expect(loaded.projectId).toBe(PROJECT);
    expect(loaded.definition).toEqual({ revisionId: REVISION, sha256: 'a'.repeat(64) });
    expect(loaded.layout.kind).toBe('NONE');
  });

  it.each([
    ['apiUrl', 'legacy'],
    ['accessToken', 'x'],
    ['root', '/tmp/x'],
    ['schemaVersion', '1.0'],
  ])('拒绝未知/旧字段 %s', (key, value) => {
    expect(() => parseWorkspaceConfigV2({ ...v2Config(), [key]: value })).toThrow(
      /未知字段|schemaVersion/,
    );
  });

  it('拒绝嵌套未知字段与非法 layout/repository path', () => {
    expect(() =>
      parseWorkspaceConfigV2({
        ...v2Config(),
        defaults: { ...(v2Config().defaults as Record<string, unknown>), extra: true },
      }),
    ).toThrow(/未知字段/);
    expect(() =>
      parseWorkspaceConfigV2({ ...v2Config(), layout: { kind: 'SINGLE_REPO' } }),
    ).toThrow(/layout\.kind/);
    expect(() =>
      parseWorkspaceConfigV2({
        ...v2Config({
          layoutKind: 'SINGLE_ROOT',
          repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, path: '../escape' }],
        }),
      }),
    ).toThrow(/相对 POSIX|空段/);
    expect(() =>
      parseWorkspaceConfigV2({
        ...v2Config({
          layoutKind: 'SINGLE_ROOT',
          repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, path: 'C:/abs' }],
        }),
      }),
    ).toThrow(/相对 POSIX|盘符/);
  });

  it('layout NONE 时 repositories 必须为空；重复 key/path 拒绝', () => {
    expect(() =>
      parseWorkspaceConfigV2(
        v2Config({
          layoutKind: 'NONE',
          repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, path: '.' }],
        }),
      ),
    ).toThrow(/repositories 必须为空/);
    expect(() =>
      parseWorkspaceConfigV2(
        v2Config({
          layoutKind: 'MULTI_ROOT',
          repositories: [
            { key: 'web', projectRepositoryId: REPOSITORY, path: 'apps/web' },
            { key: 'web', projectRepositoryId: REPOSITORY_B, path: 'apps/api' },
          ],
        }),
      ),
    ).toThrow(/key 重复/);
  });

  it('definition=null 只允许 MIGRATED 迁移配置（allowNullDefinition）', async () => {
    expect(() => parseWorkspaceConfigV2(v2Config({ definition: null }))).toThrow(
      /definition 不能为 null/,
    );
    expect(() =>
      parseWorkspaceConfigV2(v2Config({ definition: null }), { allowNullDefinition: true }),
    ).not.toThrow();
    const dir = await makeTempDir();
    await writeV2Workspace(dir, { definition: null });
    await expect(loadWorkspaceConfigV2(dir)).rejects.toMatchObject({
      code: 'CONFIG_SCHEMA_UNSUPPORTED',
    });
    const state = await detectWorkspaceState(dir);
    expect(state.state).toBe('V2_ONLY');
    expect(state.v2.valid).toBe(false);
  });

  it.runIf(POSIX)('v2 配置写 0600、目录 0700', async () => {
    const dir = await makeTempDir();
    await saveWorkspaceConfigV2(dir, parseWorkspaceConfigV2(v2Config()));
    const file = await stat(workspaceV2Path(dir));
    const folder = await stat(join(dir, '.workmesh'));
    expect(file.mode & 0o777).toBe(0o600);
    expect(folder.mode & 0o777).toBe(0o700);
  });
});

describe('五态识别（NONE/V1_ONLY/V2_ONLY/MIGRATED/DUAL_ACTIVE）', () => {
  it('NONE：无配置', async () => {
    const dir = await makeTempDir();
    expect((await detectWorkspaceState(dir)).state).toBe('NONE');
    await expect(resolveActiveWorkspace(dir)).rejects.toMatchObject({
      code: 'CONFIG_NOT_FOUND',
      exitCode: 2,
    });
  });

  it('V1_ONLY：只读适配返回 v1', async () => {
    const dir = await makeTempDir();
    await writeV1Workspace(dir);
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('V1_ONLY');
    const active = await resolveActiveWorkspace(dir);
    expect(active.kind).toBe('V1');
    if (active.kind === 'V1') expect(active.config.projectId).toBe(PROJECT);
  });

  it('V2_ONLY：定义必需，旧命令读取视图按 v2 映射', async () => {
    const dir = await makeTempDir();
    await writeV2Workspace(dir, {
      repositories: [{ key: 'web', projectRepositoryId: REPOSITORY, path: 'apps/web' }],
      layoutKind: 'SINGLE_ROOT',
    });
    expect((await detectWorkspaceState(dir)).state).toBe('V2_ONLY');
    const active = await resolveActiveWorkspace(dir);
    expect(active.kind).toBe('V2');
    if (active.kind === 'V2') {
      const legacy = legacyWorkspaceView(active.config);
      expect(legacy.projectId).toBe(PROJECT);
      expect(legacy.roleKey).toBe(ROLE);
      expect(legacy.platform).toEqual(PLATFORM);
      expect(legacy.repositoryId).toBe(REPOSITORY);
    }
  });

  it('MIGRATED：v1 已归档为 .bak，适配层只读 v2 且忽略 .bak', async () => {
    const dir = await makeTempDir();
    // 迁移后的 v2（definition=null）与一个看起来可解析的 .bak；任何命令都不读 .bak。
    await writeV2Workspace(dir, { definition: null });
    await writeV1Workspace(dir);
    const { rename } = await import('node:fs/promises');
    await rename(
      join(dir, '.workmesh', 'config.json'),
      workspaceBackupPath(dir, '20261105T000000000Z'),
    );
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('MIGRATED');
    expect(snapshot.v1.exists).toBe(false);
    expect(snapshot.backups).toHaveLength(1);
    const active = await resolveActiveWorkspace(dir);
    expect(active.kind).toBe('V2');
    if (active.kind === 'V2') {
      expect(active.state).toBe('MIGRATED');
      expect(active.config.definition).toBeNull();
      const legacy = legacyWorkspaceView(active.config);
      expect(legacy.projectId).toBe(PROJECT);
      expect(legacy.roleKey).toBe(ROLE);
    }
  });

  it('DUAL_ACTIVE：两个活动文件都可解析时硬冲突，普通命令退出码 5', async () => {
    const dir = await makeTempDir();
    await writeV1Workspace(dir);
    await writeV2Workspace(dir);
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('DUAL_ACTIVE');
    expect(snapshot.v1.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.v2.digest).toMatch(/^[0-9a-f]{64}$/);
    const error = dualConfigError(snapshot);
    expect(error.code).toBe('WORKSPACE_DUAL_CONFIG');
    expect(error.exitCode).toBe(5);
    expect(error.details?.v1Path).toBe(snapshot.v1.path);
    expect(error.details?.v2Path).toBe(snapshot.v2.path);
    expect(String(error.details?.nextAction)).toContain('migrate --inspect');
    await expect(resolveActiveWorkspace(dir)).rejects.toMatchObject({
      code: 'WORKSPACE_DUAL_CONFIG',
      exitCode: 5,
    });
  });

  it('损坏的 v2 不被静默跳过，也不回退到 v1', async () => {
    const dir = await makeTempDir();
    await writeV1Workspace(dir);
    await mkdir(join(dir, '.workmesh'), { recursive: true });
    await writeFile(join(dir, '.workmesh', 'workspace.json'), '{ not json', 'utf8');
    const snapshot = await detectWorkspaceState(dir);
    expect(snapshot.state).toBe('V1_ONLY');
    await expect(resolveActiveWorkspace(dir)).rejects.toMatchObject({
      code: 'CONFIG_SCHEMA_UNSUPPORTED',
    });
  });
});

describe('用户索引（~/.workmesh/workspaces/index.json）', () => {
  it('round-trip，且只保存绝对 root 与精确 gitRoots', async () => {
    const home = await makeTempDir('wm-home-');
    const workspaceRoot = '/tmp/workspace-a';
    const index = upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: WORKSPACE,
      root: workspaceRoot,
      projectId: PROJECT,
      platform: PLATFORM,
      updatedAt: '2026-11-05T00:00:00.000Z',
      gitRoots: ['/tmp/workspace-a/repo'],
    });
    const path = await saveUserIndex(home, index);
    expect(path).toBe(userIndexPath(home));
    const loaded = await loadUserIndex(home);
    expect(loaded.workspaces[WORKSPACE]).toMatchObject({
      root: expect.stringMatching(/workspace-a$/),
      projectId: PROJECT,
    });
    expect(Object.values(loaded.gitRoots)).toEqual([WORKSPACE]);
    expect(findWorkspaceByGitRoot(loaded, '/tmp/workspace-a/repo')?.workspaceId).toBe(WORKSPACE);
    // 精确匹配：不做前缀、basename 或大小写猜测。
    expect(findWorkspaceByGitRoot(loaded, '/tmp/workspace-a/repo-other')).toBeNull();
    expect(findWorkspaceByGitRoot(loaded, '/tmp/other/workspace-a/repo')).toBeNull();
    expect(gitRootKey('/tmp/x/../x')).toBe(gitRootKey('/tmp/x'));
  });

  it('工作区身份以 realpath 统一目录符号链接别名', async ({ skip }) => {
    const root = await makeTempDir('wm-root-');
    const alias = `${root}-alias`;
    try {
      await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      skip(`当前运行账户不能创建目录链接：${String(error)}`);
    }
    expect(await canonicalWorkspaceRoot(alias)).toBe(await canonicalWorkspaceRoot(root));
  });

  it('未知字段拒绝；跨工作区映射保留', async () => {
    const home = await makeTempDir('wm-home-');
    await mkdir(join(home, 'workspaces'), { recursive: true });
    await writeFile(
      join(home, 'workspaces', 'index.json'),
      JSON.stringify({ schemaVersion: '1.0', workspaces: {}, gitRoots: {}, extra: true }),
      'utf8',
    );
    await expect(loadUserIndex(home)).rejects.toMatchObject({
      code: 'CONFIG_SCHEMA_UNSUPPORTED',
    });

    let index = upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: WORKSPACE,
      root: '/tmp/a',
      projectId: PROJECT,
      platform: PLATFORM,
      updatedAt: '2026-11-05T00:00:00.000Z',
      gitRoots: ['/tmp/a/repo'],
    });
    index = upsertUserWorkspace(index, {
      workspaceId: WORKSPACE_B,
      root: '/tmp/b',
      projectId: PROJECT_B,
      platform: PLATFORM,
      updatedAt: '2026-11-05T00:00:00.000Z',
      gitRoots: ['/tmp/b/repo'],
    });
    expect(Object.keys(index.workspaces)).toHaveLength(2);
    expect(findWorkspaceByGitRoot(index, '/tmp/a/repo')?.workspaceId).toBe(WORKSPACE);
    expect(findWorkspaceByGitRoot(index, '/tmp/b/repo')?.workspaceId).toBe(WORKSPACE_B);
    index = addGitRootMapping(index, '/tmp/a/second', WORKSPACE);
    expect(findWorkspaceByGitRoot(index, '/tmp/a/second')?.workspaceId).toBe(WORKSPACE);
    try {
      addGitRootMapping(index, '/tmp/a/repo', WORKSPACE_B);
      throw new Error('expected ambiguous Git root to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'WORKSPACE_AMBIGUOUS' });
    }
    expect(index.gitRoots[gitRootKey('/tmp/a/repo')]).toBe(WORKSPACE);
  });

  it('并发更新共享用户索引会串行合并，不丢失另一个工作区', async () => {
    const home = await makeTempDir('wm-home-');
    const makeEntry = (workspaceId: string, projectId: string, root: string) =>
      updateUserIndex(home, (index) =>
        upsertUserWorkspace(index, {
          workspaceId,
          root,
          projectId,
          platform: PLATFORM,
          updatedAt: '2026-11-05T00:00:00.000Z',
        }),
      );
    await Promise.all([
      makeEntry(WORKSPACE, PROJECT, '/tmp/concurrent-a'),
      makeEntry(WORKSPACE_B, PROJECT_B, '/tmp/concurrent-b'),
    ]);
    const loaded = await loadUserIndex(home);
    expect(Object.keys(loaded.workspaces).sort()).toEqual([WORKSPACE, WORKSPACE_B].sort());
  });

  it.runIf(POSIX)('索引文件 0600、目录 0700', async () => {
    const home = await makeTempDir('wm-home-');
    await saveUserIndex(home, emptyUserIndex());
    const file = await stat(userIndexPath(home));
    const folder = await stat(join(home, 'workspaces'));
    expect(file.mode & 0o777).toBe(0o600);
    expect(folder.mode & 0o777).toBe(0o700);
  });
});

describe('定义契约解析（T3 响应）', () => {
  it('consume 响应严格校验并拒绝 null revision', () => {
    expect(
      parseConsumedEnrollment({
        projectId: PROJECT,
        projectName: '示例',
        definitionRevisionId: REVISION,
        definitionDigest: 'a'.repeat(64),
      }),
    ).toMatchObject({ projectId: PROJECT, definitionRevisionId: REVISION });
    expect(() =>
      parseConsumedEnrollment({
        projectId: PROJECT,
        definitionRevisionId: null,
        definitionDigest: null,
      }),
    ).toThrow(/PROTOCOL_INVALID|definitionRevisionId/);
  });

  it('revision 响应：本地重算 digest，并解析 locator/identityMode', async () => {
    const fixture = await makeDefinitionFixture({
      layoutKind: 'SINGLE_ROOT',
      repositories: [
        { key: 'web', projectRepositoryId: REPOSITORY, locators: [[DEFAULT_LOCATOR, 'HTTPS']] },
      ],
    });
    const parsed = await parseWorkspaceRevision(fixture.revisionData);
    expect(parsed.digestMatchesPayload).toBe(true);
    expect(parsed.revision.digest).toBe(fixture.digest);
    expect(parsed.revision.repositories[0]).toMatchObject({
      key: 'web',
      projectRepositoryId: REPOSITORY,
      identityMode: 'DECLARED',
      archivedAt: null,
    });
    expect(parsed.revision.repositories[0]?.locators[0]).toMatchObject({
      canonicalLocator: DEFAULT_LOCATOR,
      revokedAt: null,
    });
    expect(await definitionDigestOf(fixture.payload)).toBe(fixture.digest);

    const tampered = {
      ...fixture.revisionData,
      payload: {
        ...(fixture.payload as Record<string, unknown>),
        roleHints: { backend: { recommendedRepositoryKeys: ['web'] } },
      },
    };
    const mismatch = await parseWorkspaceRevision(tampered);
    expect(mismatch.digestMatchesPayload).toBe(false);
    const { payload: _payload, ...missingPayload } = fixture.revisionData;
    await expect(parseWorkspaceRevision(missingPayload)).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID',
    });
    await expect(
      parseWorkspaceRevision({
        ...fixture.revisionData,
        repositories: [
          {
            ...(fixture.revisionData.repositories as Array<Record<string, unknown>>)[0],
            projectRepositoryId: REPOSITORY_B,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
  });

  it('当前定义 NOT_CONFIGURED 是展示状态，不带 revision', async () => {
    const parsed = await parseCurrentWorkspaceDefinition({
      definitionStatus: 'NOT_CONFIGURED',
      projectId: PROJECT,
      projectVersion: 1,
      definitionVersion: 0,
      revisionId: null,
      revisionNo: null,
      digest: null,
      publishedAt: null,
      payload: null,
      repositories: [],
      draft: null,
      validation: { valid: true, issues: [] },
    });
    expect(parsed.definitionStatus).toBe('NOT_CONFIGURED');
    expect(parsed.revision).toBeNull();
  });

  it('本地 revision 缓存被篡改时拒绝（payload 摘要不符）', async () => {
    const dir = await makeTempDir();
    const fixture = await makeDefinitionFixture({ revisionId: REVISION_B, layoutKind: 'NONE' });
    await writeDefinitionCache(dir, fixture, {
      payload: { ...(fixture.payload as Record<string, unknown>), projectId: PROJECT_B },
    });
    const cached = await readDefinitionCache(dir, REVISION_B);
    expect(cached.exists).toBe(true);
    expect(cached.cache).toBeNull();
    expect(cached.error?.code).toBe('CONTENT_INTEGRITY_FAILED');
  });
});

describe('fixtures sanity', () => {
  it('v2Config 与用户索引不与真实 home 混用', async () => {
    const dir = await makeTempDir();
    await writeV2Workspace(dir);
    const raw = await readJson(join(dir, '.workmesh', 'workspace.json'));
    expect(raw.projectId).toBe(PROJECT);
    expect(await stat(join(dir, '.workmesh', 'workspace.json'))).toMatchObject({
      isFile: expect.any(Function),
    });
    expect(API).toContain('/api/v1');
    expect(USER_ID).toMatch(/-/);
  });
});
