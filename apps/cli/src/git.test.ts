import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeLocator,
  detectGitRepository,
  discoverGitRepositories,
  matchRemoteLocator,
  resolveRepositoryPath,
} from './git';
import {
  canonicalGitRoot,
  canonicalWorkspaceRoot,
  gitRootKey,
  updateUserIndex,
} from './user-index';
import { makeTempDir, PLATFORM, PROJECT, WORKSPACE, WORKSPACE_B } from './workspace-fixtures';

const run = promisify(execFile);
// These cases create temporary repositories and invoke several real Git child processes. Under
// the full workspace test load, Windows process and filesystem scheduling can exceed Vitest's
// five-second default; this ceiling keeps the integration boundary finite without hiding a hang.
const REAL_GIT_TEST_TIMEOUT_MS = 15_000;

async function git(dir: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: dir, windowsHide: true });
  return stdout;
}

async function initRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await git(dir, ['init', '-b', 'main']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await writeFile(join(dir, 'README.md'), 'hello\n', 'utf8');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
}

describe('git 探测（真实 git 临时仓库）', () => {
  it(
    '单仓：root/remotes/branch/SHA/dirty',
    async () => {
      const root = await makeTempDir('wm-git-single-');
      await initRepo(root);
      await git(root, ['remote', 'add', 'origin', 'https://example.com/acme/web.git']);
      const state = await detectGitRepository(root);
      expect(state.isGitRepository).toBe(true);
      expect(gitRootKey(state.root ?? '')).toBe(gitRootKey(await realpath(root)));
      expect(state.checkoutKind).toBe('GIT_ROOT');
      expect(state.remotes).toEqual([{ name: 'origin', url: 'https://example.com/acme/web.git' }]);
      expect(state.branch).toBe('main');
      expect(state.head).toMatch(/^[0-9a-f]{40}$/);
      expect(state.dirty).toBe(false);
      await writeFile(join(root, 'untracked.txt'), 'x', 'utf8');
      expect((await detectGitRepository(root)).dirty).toBe(true);
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );

  it(
    'monorepo 子目录不是独立仓库，但 detect 可找到真实 root',
    async () => {
      const root = await makeTempDir('wm-git-mono-');
      await initRepo(root);
      const sub = join(root, 'packages', 'app');
      await mkdir(sub, { recursive: true });
      await writeFile(join(sub, 'index.ts'), 'export {};\n', 'utf8');
      const state = await detectGitRepository(sub);
      expect(state.isGitRepository).toBe(true);
      expect(gitRootKey(state.root ?? '')).toBe(gitRootKey(await realpath(root)));
      expect(state.checkoutKind).toBe('GIT_ROOT');
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );

  it(
    'siblings：多根工作区发现两个 Git root，不误报普通子目录',
    async () => {
      const root = await makeTempDir('wm-git-siblings-');
      await initRepo(join(root, 'web'));
      await initRepo(join(root, 'api'));
      await mkdir(join(root, 'docs', 'nested'), { recursive: true });
      const discovery = await discoverGitRepositories(root);
      expect(discovery.gitAvailable).toBe(true);
      expect(discovery.candidates.map((candidate) => candidate.relativePath)).toEqual([
        'api',
        'web',
      ]);
      expect(discovery.candidates.every((candidate) => candidate.insideRoot)).toBe(true);
      expect(discovery.candidates[0]?.branch).toBe('main');
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );

  it(
    'worktree：.git 文件形式被识别为 WORKTREE',
    async () => {
      const container = await makeTempDir('wm-git-wt-');
      const main = join(container, 'main');
      const worktree = join(container, 'feature-wt');
      await initRepo(main);
      await git(main, ['worktree', 'add', worktree, '-b', 'feature']);
      const state = await detectGitRepository(worktree);
      expect(state.isGitRepository).toBe(true);
      expect(state.checkoutKind).toBe('WORKTREE');
      expect(state.branch).toBe('feature');
      const discovery = await discoverGitRepositories(container);
      const kinds = discovery.candidates.map((candidate) => candidate.relativePath).sort();
      expect(kinds).toEqual(['feature-wt', 'main']);
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );

  it(
    'submodule：独立识别并给出 superproject，不并入父仓身份',
    async () => {
      const container = await makeTempDir('wm-git-sub-');
      const lib = join(container, 'lib-source');
      await initRepo(lib);
      const parent = join(container, 'parent');
      await initRepo(parent);
      await git(parent, ['-c', 'protocol.file.allow=always', 'submodule', 'add', lib, 'libs/lib']);
      await git(parent, ['commit', '-m', 'add submodule']);
      const state = await detectGitRepository(join(parent, 'libs', 'lib'));
      expect(state.isGitRepository).toBe(true);
      expect(state.checkoutKind).toBe('SUBMODULE');
      expect(state.superprojectRoot).toBeTruthy();
      expect(gitRootKey(state.superprojectRoot ?? '')).toBe(gitRootKey(await realpath(parent)));
      // 父仓仍是 GIT_ROOT，不因存在子模块而改变身份。
      expect((await detectGitRepository(parent)).checkoutKind).toBe('GIT_ROOT');
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );

  it(
    '无 git 目录：不猜测为仓库',
    async () => {
      const root = await makeTempDir('wm-git-none-');
      await mkdir(join(root, 'src'), { recursive: true });
      const state = await detectGitRepository(root);
      expect(state.isGitRepository).toBe(false);
      expect(state.root).toBeNull();
      const discovery = await discoverGitRepositories(root);
      expect(discovery.candidates).toEqual([]);
      expect(discovery.gitAvailable).toBe(true);
    },
    REAL_GIT_TEST_TIMEOUT_MS,
  );
});

describe('canonical locator 与路径边界', () => {
  it('host 大小写/默认端口/凭据规范化，但不猜测协议或 .git 等价', () => {
    expect(canonicalizeLocator('https://token:secret@WorkMesh.Example.com:443/acme/Web.git')).toBe(
      'https://workmesh.example.com/acme/Web.git',
    );
    expect(canonicalizeLocator('ssh://git@GitHub.com:22/acme/repo.git')).toBe(
      'ssh://git@github.com/acme/repo.git',
    );
    // scp 形式与 API 共享规范化一致：归一为 ssh://，仍属 SSH。
    expect(canonicalizeLocator('git@GitHub.com:acme/repo.git')).toBe(
      'ssh://git@github.com/acme/repo.git',
    );
    // HTTPS ≠ SSH；有/无 .git 后缀 ≠ 等价；路径大小写保留。
    expect(canonicalizeLocator('https://github.com/acme/repo.git')).not.toBe(
      canonicalizeLocator('git@github.com:acme/repo.git'),
    );
    expect(canonicalizeLocator('https://github.com/acme/repo')).not.toBe(
      canonicalizeLocator('https://github.com/acme/repo.git'),
    );
    expect(canonicalizeLocator('https://github.com/acme/Repo.git')).not.toBe(
      canonicalizeLocator('https://github.com/acme/repo.git'),
    );
  });

  it('精确匹配 locator：同名不同 locator 不匹配；revoked 忽略', () => {
    const remotes = [{ name: 'origin', url: 'https://github.com/acme/repo.git' }];
    expect(
      matchRemoteLocator(remotes, [
        { canonicalLocator: 'https://github.com/acme/other.git' },
        { canonicalLocator: 'https://github.com/acme/repo.git', revokedAt: null },
      ]).match?.matchedCanonical,
    ).toBe('https://github.com/acme/repo.git');
    expect(
      matchRemoteLocator(remotes, [{ canonicalLocator: 'https://github.com/acme/other.git' }])
        .match,
    ).toBeNull();
    expect(
      matchRemoteLocator(remotes, [
        { canonicalLocator: 'https://github.com/acme/repo.git', revokedAt: '2026-01-01T00:00:00Z' },
      ]).match,
    ).toBeNull();
  });

  it('resolveRepositoryPath 拒绝越界与根外绝对路径', async () => {
    const root = await makeTempDir('wm-git-path-');
    await mkdir(join(root, 'apps', 'web'), { recursive: true });
    const inside = await resolveRepositoryPath(root, 'apps/web');
    expect(inside.relativePath).toBe('apps/web');
    const rootPath = await resolveRepositoryPath(root, '.');
    expect(rootPath.relativePath).toBe('.');
    await expect(resolveRepositoryPath(root, '../outside')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_OUTSIDE_ROOT',
    });
    await expect(resolveRepositoryPath(root, '/etc')).rejects.toMatchObject({
      code: 'WORKSPACE_PATH_OUTSIDE_ROOT',
    });
  });

  it('路径别名通过真实路径归一，缺失尾段沿最近存在祖先解析，悬空符号链接拒绝降级', async () => {
    const container = await makeTempDir('wm-canonical-path-');
    const root = join(container, 'physical', 'repo');
    await mkdir(root, { recursive: true });
    const alias = join(container, 'alias');
    await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
    expect(await canonicalGitRoot(alias)).toBe(await canonicalGitRoot(root));
    expect(await canonicalWorkspaceRoot(alias)).toBe(await canonicalWorkspaceRoot(root));

    const missingTail = join(alias, 'new-directory', 'nested');
    expect(await canonicalGitRoot(missingTail)).toBe(
      join(await realpath(root), 'new-directory', 'nested'),
    );

    const dangling = join(container, 'dangling');
    await symlink(
      join(container, 'missing-target'),
      dangling,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(canonicalGitRoot(dangling)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.skipIf(process.platform !== 'win32')('Windows Git root key 将大小写等价路径归一', () => {
    const windowsPath = 'G:\\WorkMesh\\Projects\\Repo';
    expect(gitRootKey(windowsPath)).toBe(gitRootKey(windowsPath.toLowerCase()));
  });

  it('两个不同真实目录即使 basename 相同仍是不同身份', async () => {
    const container = await makeTempDir('wm-distinct-roots-');
    const left = join(container, 'left', 'repo');
    const right = join(container, 'right', 'repo');
    await Promise.all([mkdir(left, { recursive: true }), mkdir(right, { recursive: true })]);
    const leftCanonical = await canonicalGitRoot(left);
    const rightCanonical = await canonicalGitRoot(right);
    expect(leftCanonical).not.toBe(rightCanonical);
    expect(gitRootKey(leftCanonical)).not.toBe(gitRootKey(rightCanonical));
  });

  it('用户索引活动锁和可能遗留的锁都失败关闭，不会被并发进程自动删除', async () => {
    const home = await makeTempDir('wm-index-lock-');
    const lockPath = join(home, 'workspaces', 'index.lock');
    await mkdir(dirname(lockPath), { recursive: true });
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid, token: 'active' })}\n`, 'utf8');
    await expect(
      updateUserIndex(home, (index) => index, undefined, { waitMs: 5, pollMs: 1 }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    expect(JSON.parse(await readFile(lockPath, 'utf8'))).toMatchObject({
      pid: process.pid,
      token: 'active',
    });

    const orphanedLock = '{"pid":';
    await writeFile(lockPath, orphanedLock, 'utf8');
    await expect(
      updateUserIndex(home, (index) => index, undefined, { waitMs: 5, pollMs: 1 }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_WRITE_FAILED' });
    expect(await readFile(lockPath, 'utf8')).toBe(orphanedLock);
  });

  it('独立 Node 进程并发更新同一用户索引时，两边的 workspace 都保留', async () => {
    const home = await makeTempDir('wm-cross-process-index-');
    const rootA = await makeTempDir('wm-cross-process-root-a-');
    const rootB = await makeTempDir('wm-cross-process-root-b-');
    const readyA = join(home, 'writer-a.ready');
    const readyB = join(home, 'writer-b.ready');
    const moduleUrl = new URL('./user-index.ts', import.meta.url).href;
    const script = `
      import { writeFile } from 'node:fs/promises';
      const { updateUserIndex } = await import(${JSON.stringify(moduleUrl)});
      const [home, workspaceId, root, readyFile, holdMs] = process.argv.slice(1);
      await updateUserIndex(home, async (index) => {
        await writeFile(readyFile, 'locked');
        await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
        return {
          ...index,
          workspaces: {
            ...index.workspaces,
            [workspaceId]: {
              root,
              projectId: ${JSON.stringify(PROJECT)},
              platform: ${JSON.stringify(PLATFORM)},
              updatedAt: '2026-11-06T12:00:00.000Z',
            },
          },
        };
      });
    `;
    const startWriter = (workspaceId: string, root: string, readyFile: string, holdMs: number) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          script,
          home,
          workspaceId,
          root,
          readyFile,
          String(holdMs),
        ],
        { cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      let stderr = '';
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });
      const exited = once(child, 'exit').then(([code]) => {
        if (code !== 0) throw new Error(`index writer exited with ${String(code)}: ${stderr}`);
      });
      return { child, exited };
    };
    const waitForReady = async (path: string): Promise<void> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        try {
          await readFile(path, 'utf8');
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      throw new Error(`index writer did not acquire the lock: ${path}`);
    };

    const first = startWriter(WORKSPACE, rootA, readyA, 250);
    await waitForReady(readyA);
    const second = startWriter(WORKSPACE_B, rootB, readyB, 0);
    await Promise.all([first.exited, second.exited]);

    const { loadUserIndex } = await import('./user-index');
    const index = await loadUserIndex(home);
    expect(index.workspaces[WORKSPACE]?.root).toBe(rootA);
    expect(index.workspaces[WORKSPACE_B]?.root).toBe(rootB);
  });
});
