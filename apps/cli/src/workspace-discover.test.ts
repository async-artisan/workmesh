import { execFile } from 'node:child_process';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCATOR,
  makeTempDir,
  PLATFORM,
  PROJECT,
  ROLE,
  snapshotTree,
  v2Config,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import { saveUserIndex, upsertUserWorkspace, emptyUserIndex } from './user-index';
import { runWorkspaceDiscover } from './workspace-discover';

const run = promisify(execFile);

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: dir, windowsHide: true });
  return stdout;
}

async function initRepo(dir: string, remote: string | null = DEFAULT_LOCATOR): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await writeFile(join(dir, 'README.md'), 'hello\n', 'utf8');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  if (remote) await git(dir, ['remote', 'add', 'origin', remote]);
}

describe('workspace discover（只读）', () => {
  it('发现 sibling Git roots，零写入（root 与 home 都不变）', async () => {
    const root = await makeTempDir('wm-disc-');
    await initRepo(join(root, 'web'));
    await initRepo(join(root, 'api'), 'git@example.com:acme/api.git');
    await writeV2Workspace(root);
    const home = await makeTempDir('wm-home-');
    const beforeRoot = await snapshotTree(root);
    const beforeHome = await snapshotTree(home);
    const result = await runWorkspaceDiscover({ root, configHome: home });
    expect(result.mode).toBe('discover');
    expect(result.state).toBe('V2_ONLY');
    expect(result.writes).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.relativePath)).toEqual(['api', 'web']);
    expect(result.candidates[1]?.remotes[0]?.canonicalLocator).toBe(DEFAULT_LOCATOR);
    expect(result.candidates[1]?.branch).toBe('main');
    expect(result.candidates[1]?.head).toMatch(/^[0-9a-f]{40}$/);
    expect(await snapshotTree(root)).toEqual(beforeRoot);
    expect(await snapshotTree(home)).toEqual(beforeHome);
    // 不写用户索引
    await expect(
      (await import('node:fs/promises')).stat(join(home, 'workspaces', 'index.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('已知 workspace 只按 real Git root 精确映射提示，不按名称猜测', async () => {
    const root = await makeTempDir('wm-disc-');
    const web = join(root, 'web');
    await initRepo(web);
    await initRepo(join(root, 'web-copy'), DEFAULT_LOCATOR);
    await writeV2Workspace(root);
    const home = await makeTempDir('wm-home-');
    const index = upsertUserWorkspace(emptyUserIndex(), {
      workspaceId: v2Config().workspaceId as string,
      root,
      projectId: PROJECT,
      platform: PLATFORM,
      updatedAt: '2026-11-05T00:00:00.000Z',
      gitRoots: [await realpath(web)],
    });
    await saveUserIndex(home, index);
    const result = await runWorkspaceDiscover({ root, configHome: home });
    const byPath = new Map(
      result.candidates.map((candidate) => [candidate.relativePath, candidate]),
    );
    expect(byPath.get('web')?.knownWorkspaceId).toBe(v2Config().workspaceId);
    // 同名目录但不同 real Git root：不给出 workspace 提示。
    expect(byPath.get('web-copy')?.knownWorkspaceId).toBeNull();
  });

  it('DUAL_ACTIVE 下拒绝（不推导冲突配置状态）', async () => {
    const root = await makeTempDir('wm-disc-');
    await initRepo(root);
    await writeV1Workspace(root);
    await writeV2Workspace(root);
    const before = await snapshotTree(root);
    await expect(runWorkspaceDiscover({ root })).rejects.toMatchObject({
      code: 'WORKSPACE_DUAL_CONFIG',
      exitCode: 5,
    });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('NONE/无 git 时给出接入建议，零写入', async () => {
    const root = await makeTempDir('wm-disc-');
    await mkdir(join(root, 'docs'), { recursive: true });
    const home = await makeTempDir('wm-home-');
    const before = await snapshotTree(root);
    const result = await runWorkspaceDiscover({ root, configHome: home });
    expect(result.state).toBe('NONE');
    expect(result.candidates).toEqual([]);
    expect(result.nextActions.join('\n')).toContain('workspace init');
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('V1_ONLY 下仍可只读发现并报告 v1 项目信息', async () => {
    const root = await makeTempDir('wm-disc-');
    await initRepo(root);
    await writeV1Workspace(root);
    const result = await runWorkspaceDiscover({ root });
    expect(result.state).toBe('V1_ONLY');
    expect(result.workspace.projectId).toBe(PROJECT);
    expect(result.workspace.roleKey).toBe(ROLE);
    expect(result.candidates).toHaveLength(1);
  });
});
