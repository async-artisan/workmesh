import { execFile } from 'node:child_process';
import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { canonicalizeRepositoryLocator } from '@workmesh/shared';
import { CliError } from './errors';
import { canonicalLocalPath, gitRootKey } from './user-index';

const run = promisify(execFile);

export const GIT_UNAVAILABLE_EXIT = 127;

export type GitRemote = { name: string; url: string };

export type CheckoutKind = 'GIT_ROOT' | 'WORKTREE' | 'SUBMODULE';

export type GitRepositoryState = {
  isGitRepository: boolean;
  /** 真实 absolute Git top-level；未在 Git 仓内时为 null。 */
  root: string | null;
  gitDir: string | null;
  commonDir: string | null;
  checkoutKind: CheckoutKind;
  superprojectRoot: string | null;
  remotes: GitRemote[];
  head: string | null;
  branch: string | null;
  dirty: boolean | null;
};

export type GitCommandResult = { code: number; stdout: string; stderr: string };

/** 统一 git 调用；git 不存在返回 127 而不是抛异常，便于 discovery 降级报告。 */
export async function git(args: string[], cwd?: string): Promise<GitCommandResult> {
  try {
    const result = await run('git', args, {
      cwd,
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number | string;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    if (failure.code === 'ENOENT')
      return { code: GIT_UNAVAILABLE_EXIT, stdout: '', stderr: 'git 不可用' };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? failure.message ?? '',
    };
  }
}

function trimOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function realpathOrResolve(path: string): Promise<string> {
  return canonicalLocalPath(path);
}

function emptyState(): GitRepositoryState {
  return {
    isGitRepository: false,
    root: null,
    gitDir: null,
    commonDir: null,
    checkoutKind: 'GIT_ROOT',
    superprojectRoot: null,
    remotes: [],
    head: null,
    branch: null,
    dirty: null,
  };
}

export async function detectGitRepository(dir: string): Promise<GitRepositoryState> {
  const absolute = resolve(dir);
  const inside = await git(['-C', absolute, 'rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return emptyState();
  if (inside.stdout.trim() !== 'true') return emptyState();
  const topLevel = await git(['-C', absolute, 'rev-parse', '--show-toplevel']);
  if (topLevel.code !== 0) return emptyState();
  const root = await realpathOrResolve(topLevel.stdout.trim());
  const absoluteGitDir = await git(['-C', root, 'rev-parse', '--absolute-git-dir']);
  const gitDir =
    absoluteGitDir.code === 0 ? await realpathOrResolve(absoluteGitDir.stdout.trim()) : null;
  const commonDirResult = await git(['-C', root, 'rev-parse', '--git-common-dir']);
  const commonDir =
    commonDirResult.code === 0
      ? await realpathOrResolve(resolve(root, commonDirResult.stdout.trim()))
      : gitDir;
  const superproject = await git(['-C', root, 'rev-parse', '--show-superproject-working-tree']);
  const superprojectRoot = superproject.code === 0 ? trimOrNull(superproject.stdout) : null;
  const isWorktree =
    gitDir !== null && commonDir !== null && gitRootKey(gitDir) !== gitRootKey(commonDir);

  const remotes = await readRemotes(root);
  const headResult = await git(['-C', root, 'rev-parse', '--verify', 'HEAD']);
  const branchResult = await git(['-C', root, 'symbolic-ref', '--short', '-q', 'HEAD']);
  const statusResult = await git(['-C', root, 'status', '--porcelain']);

  return {
    isGitRepository: true,
    root,
    gitDir,
    commonDir,
    checkoutKind: superprojectRoot ? 'SUBMODULE' : isWorktree ? 'WORKTREE' : 'GIT_ROOT',
    superprojectRoot: superprojectRoot ?? null,
    remotes,
    head: headResult.code === 0 ? trimOrNull(headResult.stdout) : null,
    branch: branchResult.code === 0 ? trimOrNull(branchResult.stdout) : null,
    dirty: statusResult.code === 0 ? statusResult.stdout.trim() !== '' : null,
  };
}

async function readRemotes(root: string): Promise<GitRemote[]> {
  const result = await git(['-C', root, 'config', '--get-regexp', '^remote\\..*\\.url$']);
  if (result.code !== 0) return [];
  const remotes: GitRemote[] = [];
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
    if (!match?.[1] || !match[2]) continue;
    remotes.push({ name: match[1], url: match[2].trim() });
  }
  return remotes.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * 保守规范化 locator：与 API 共用的 `@workmesh/shared` 纯函数保持一致
 * （去凭据、规范 host 大小写与明确默认端口；协议/.git/路径大小写不猜等价）。
 */
export function canonicalizeLocator(raw: string): string {
  try {
    return canonicalizeRepositoryLocator(raw).canonicalLocator;
  } catch (error) {
    throw new CliError(
      'LOCAL_INPUT_INVALID',
      `remote locator 不受支持：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export type LocatorMatch = {
  remoteName: string;
  localCanonical: string;
  matchedCanonical: string;
};

export type LocatorCandidate = {
  canonicalLocator: string;
  revokedAt?: string | null;
};

export { gitRootKey };

/** 精确匹配：本地 remote 规范化结果必须与某条未撤销 canonical locator 完全相等。 */
export function matchRemoteLocator(
  remotes: GitRemote[],
  locators: LocatorCandidate[],
): { match: LocatorMatch | null; localCanonicals: string[] } {
  const active = locators.filter((locator) => !locator.revokedAt);
  const localCanonicals: string[] = [];
  for (const remote of remotes) {
    let canonical: string;
    try {
      canonical = canonicalizeLocator(remote.url);
    } catch {
      continue;
    }
    localCanonicals.push(canonical);
    const matched = active.find((locator) => locator.canonicalLocator === canonical);
    if (matched)
      return {
        match: {
          remoteName: remote.name,
          localCanonical: canonical,
          matchedCanonical: matched.canonicalLocator,
        },
        localCanonicals,
      };
  }
  return { match: null, localCanonicals };
}

export function canonicalizeLocators(locators: LocatorCandidate[]): string[] {
  return locators
    .filter((locator) => !locator.revokedAt)
    .map((locator) => locator.canonicalLocator);
}

/** 把用户给的 --path 解析成 root 内路径；越界（含 '..' 与符号链接逃逸）拒绝。 */
export async function resolveRepositoryPath(
  root: string,
  inputPath: string,
): Promise<{ absolutePath: string; relativePath: string }> {
  const rootReal = await realpathOrResolve(root);
  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : resolve(rootReal, inputPath);
  const candidateReal = await realpathOrResolve(candidate);
  const rel = relative(rootReal, candidateReal);
  if (rel === '') return { absolutePath: candidateReal, relativePath: '.' };
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new CliError(
      'WORKSPACE_PATH_OUTSIDE_ROOT',
      `--path 必须位于工作区根目录内：${inputPath}`,
      { details: { rootLabel: '.', path: inputPath } },
    );
  return { absolutePath: candidateReal, relativePath: rel.split('\\').join('/') };
}

export type GitDiscovery = {
  gitAvailable: boolean;
  searchRoot: string;
  candidates: Array<GitRepositoryState & { relativePath: string; insideRoot: boolean }>;
  errors: Array<{ relativePath: string; reason: string }>;
  truncated: boolean;
  scannedDirectories: number;
};

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.workmesh',
  '.turbo',
  '.next',
  '.nuxt',
  '.cache',
  '.venv',
  'venv',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  'vendor',
  '__pycache__',
  'bin',
  'obj',
]);

/** 有限范围发现 Git roots；不跟随符号链接，不扫描整块磁盘。 */
export async function discoverGitRepositories(
  searchRoot: string,
  options: { maxDepth?: number; maxDirectories?: number } = {},
): Promise<GitDiscovery> {
  const root = await realpathOrResolve(searchRoot);
  const maxDepth = options.maxDepth ?? 3;
  const maxDirectories = options.maxDirectories ?? 200;
  const version = await git(['--version']);
  const gitAvailable = version.code !== GIT_UNAVAILABLE_EXIT;
  const discovery: GitDiscovery = {
    gitAvailable,
    searchRoot: root,
    candidates: [],
    errors: [],
    truncated: false,
    scannedDirectories: 0,
  };
  if (!gitAvailable) return discovery;

  const seen = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    if (discovery.scannedDirectories >= maxDirectories) {
      discovery.truncated = true;
      break;
    }
    discovery.scannedDirectories += 1;
    let entries;
    try {
      entries = await readdir(next.dir, { withFileTypes: true });
    } catch (error) {
      discovery.errors.push({
        relativePath: relative(root, next.dir).split('\\').join('/') || '.',
        reason: (error as Error).message,
      });
      continue;
    }
    const hasGitMarker = entries.some((entry) => entry.name === '.git');
    if (hasGitMarker || next.depth === 0) {
      const state = await detectGitRepository(next.dir);
      if (state.isGitRepository && state.root) {
        const key = gitRootKey(state.root);
        if (!seen.has(key)) {
          seen.add(key);
          const rel = relative(root, state.root);
          const insideRoot = rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
          discovery.candidates.push({
            ...state,
            relativePath: insideRoot ? rel.split('\\').join('/') || '.' : state.root,
            insideRoot,
          });
        }
      }
    }
    if (next.depth >= maxDepth) continue;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      queue.push({ dir: join(next.dir, entry.name), depth: next.depth + 1 });
    }
  }
  discovery.candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return discovery;
}

/** 判断目录是否 Git 仓根（用于 status 的路径诊断，不猜身份）。 */
export async function isGitWorkTree(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}
