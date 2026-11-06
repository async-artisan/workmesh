import { isAbsolute, relative } from 'node:path';
import { CliError } from './errors';
import { canonicalizeLocator, discoverGitRepositories, type CheckoutKind } from './git';
import { findWorkspaceByGitRoot, loadUserIndex } from './user-index';
import {
  detectWorkspaceState,
  dualConfigError,
  resolveWorkspaceRoot,
  type WorkspaceState,
} from './workspace-config';

export type DiscoveredRemote = {
  name: string;
  /** 已去除凭据的规范化 locator；不输出原始 secret。 */
  canonicalLocator: string;
  redacted: boolean;
};

export type DiscoveredRepository = {
  /** 相对 --root 的展示路径；本机绝对路径不进入 stdin/stdout 共享报告。 */
  relativePath: string;
  insideRoot: boolean;
  checkoutKind: CheckoutKind;
  superprojectRelativePath: string | null;
  remotes: DiscoveredRemote[];
  head: string | null;
  branch: string | null;
  dirty: boolean | null;
  /** 仅当用户索引中存在 real Git root 的精确映射时给出；不做前缀/basename 猜测。 */
  knownWorkspaceId: string | null;
};

export type WorkspaceDiscoverResult = {
  mode: 'discover';
  state: WorkspaceState;
  rootLabel: '.';
  gitAvailable: boolean;
  scannedDirectories: number;
  truncated: boolean;
  workspace: {
    projectId: string | null;
    roleKey: string | null;
    definitionRevisionId: string | null;
  };
  candidates: DiscoveredRepository[];
  errors: Array<{ relativePath: string; reason: string }>;
  writes: [];
  nextActions: string[];
};

function sanitizeRemote(remote: { name: string; url: string }): DiscoveredRemote {
  let canonicalLocator: string;
  try {
    canonicalLocator = canonicalizeLocator(remote.url);
  } catch {
    canonicalLocator = '(invalid remote)';
  }
  const hasCredentials = /\/\/[^/@]+:[^/@]+@/.test(remote.url) || /\/\/[^/@]+@/.test(remote.url);
  return { name: remote.name, canonicalLocator, redacted: hasCredentials };
}

/**
 * `workspace discover`：只读发现 Git roots/remotes/branch/SHA/dirty。
 * 不绑定、不写用户索引、不刷新定义缓存、不上传源码；DUAL_ACTIVE 下直接拒绝。
 */
export async function runWorkspaceDiscover(input: {
  root: string;
  configHome?: string;
  maxDepth?: number;
  maxDirectories?: number;
}): Promise<WorkspaceDiscoverResult> {
  const root = resolveWorkspaceRoot(input.root);
  const snapshot = await detectWorkspaceState(root);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);

  const discovery = await discoverGitRepositories(root, {
    maxDepth: input.maxDepth,
    maxDirectories: input.maxDirectories,
  });
  const index = input.configHome
    ? await loadUserIndex(input.configHome).catch((error: unknown) => {
        if (error instanceof CliError) return null;
        throw error;
      })
    : null;

  const workspace = snapshot.v2.value
    ? {
        projectId: snapshot.v2.value.projectId,
        roleKey: snapshot.v2.value.defaults.roleKey,
        definitionRevisionId: snapshot.v2.value.definition?.revisionId ?? null,
      }
    : snapshot.v1.value
      ? {
          projectId: snapshot.v1.value.projectId,
          roleKey: snapshot.v1.value.roleKey,
          definitionRevisionId: null,
        }
      : { projectId: null, roleKey: null, definitionRevisionId: null };

  const candidates: DiscoveredRepository[] = discovery.candidates.map((candidate) => {
    const known = index && candidate.root ? findWorkspaceByGitRoot(index, candidate.root) : null;
    let superprojectRelativePath: string | null = null;
    if (candidate.superprojectRoot) {
      const rel = relative(discovery.searchRoot, candidate.superprojectRoot);
      superprojectRelativePath =
        rel === ''
          ? '.'
          : rel.startsWith('..') || isAbsolute(rel)
            ? '(outside --root)'
            : rel.split('\\').join('/');
    }
    return {
      relativePath: candidate.relativePath,
      insideRoot: candidate.insideRoot,
      checkoutKind: candidate.checkoutKind,
      superprojectRelativePath,
      remotes: candidate.remotes.map(sanitizeRemote),
      head: candidate.head,
      branch: candidate.branch,
      dirty: candidate.dirty,
      knownWorkspaceId: known?.workspaceId ?? null,
    };
  });

  const nextActions: string[] = [];
  if (snapshot.state === 'NONE')
    nextActions.push('workmesh workspace init --join <code> --root . --api <base> --role <role>');
  else if (snapshot.state === 'V1_ONLY') nextActions.push('workmesh workspace migrate --dry-run');
  else {
    if (candidates.length === 0)
      nextActions.push(
        '未发现 Git root；确认 --root 是工作区根目录，或该工作区为无代码产品工作区。',
      );
    else
      nextActions.push(
        'workmesh workspace bind --repository <projectRepositoryId> --path <relativePath>（先预览，确认后加 --yes 写入）',
      );
  }
  nextActions.push('discover 只读：不绑定仓库、不写用户索引、不上传源码。');

  return {
    mode: 'discover',
    state: snapshot.state,
    rootLabel: '.',
    gitAvailable: discovery.gitAvailable,
    scannedDirectories: discovery.scannedDirectories,
    truncated: discovery.truncated,
    workspace,
    candidates,
    errors: discovery.errors,
    writes: [],
    nextActions,
  };
}
