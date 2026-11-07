import { realpath, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { V1Client } from './client';
import { bearerOf, findCredential, type AgentCredential } from './credential-store';
import { CliError } from './errors';
import type { Platform } from './platform';
import type { WorkspaceConfig } from './config';
import { findWorkspaceByGitRoot, loadUserIndex } from './user-index';
import { detectGitRepository, gitRootKey, matchRemoteLocator, type CheckoutKind } from './git';
import { bindPlatform, canonicalizeLocator } from './workspace-bind';
import { runWorkspaceRecover, type WorkspaceRecoverReport } from './workspace-recover';
import {
  detectWorkspaceState,
  dualConfigError,
  readDefinitionCache,
  resolveWorkspaceRoot,
  workspaceConfigV1Path,
  workspaceDefinitionCachePath,
  workspaceRelativeLabel,
  workspaceV2Path,
  type DefinitionRepository,
  type WorkspaceConfigV2,
  type WorkspaceState,
} from './workspace-config';

type StatusClient = {
  getWorkspaceDefinition: V1Client['getWorkspaceDefinition'];
};

export type StatusFileReport = {
  label: string;
  path: string;
  exists: boolean;
  valid: boolean;
  digest: string | null;
  error: { code: string; message: string } | null;
};

export type RepositoryStatus = {
  key: string;
  projectRepositoryId: string;
  path: string;
  remote: string;
  needsRevalidation: boolean;
  exists: boolean;
  isGitRepository: boolean;
  checkoutKind: CheckoutKind | null;
  branch: string | null;
  head: string | null;
  dirty: boolean | null;
  identityStatus:
    'LOCAL_ONLY' | 'DECLARED_MATCH' | 'PROVIDER_VERIFIED' | 'MISMATCH' | 'UNAVAILABLE';
  reasonCode: string | null;
  providerVerified: false;
  matchedCanonicalLocator: string | null;
  expectedCanonicalLocators: string[];
  localCanonicalLocators: string[];
  definitionCached: boolean;
  lastCheckedAt: string;
};

export type WorkspaceOnlineStatus = {
  status: 'ONLINE' | 'STALE';
  checkedAt: string;
  source: 'ONLINE_DEFINITION';
  definitionStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
  currentRevisionId: string | null;
  currentDigest: string | null;
  bindingRevisionId: string | null;
  bindingDigest: string | null;
  bindingRevisionMatches: boolean;
  digestMatches: boolean;
  digestVerified: boolean;
  reasonCode: string | null;
};

export type WorkspaceStatusReport = {
  mode: 'status';
  state: WorkspaceState;
  rootLabel: '.';
  generatedAt: string;
  files: { v1: StatusFileReport; v2: StatusFileReport };
  backups: string[];
  journal: { phase: string; updatedAt: string | null; resolution: string | null } | null;
  projectId: string | null;
  platform: Platform | null;
  workspaceId: string | null;
  roleKey: string | null;
  definition: { revisionId: string; digest: string; present: true } | null;
  layoutKind: string | null;
  directWorkspaceMatch: { workspaceId: string; label: string } | null;
  repositories: RepositoryStatus[];
  definitionCache: {
    label: string;
    present: boolean;
    revisionId: string | null;
    digest: string | null;
    fetchedAt: string | null;
    matchesBinding: boolean | null;
    error: { code: string; message: string } | null;
  } | null;
  v1Migration: { required: true; command: string } | null;
  initRecovery: WorkspaceRecoverReport | null;
  online: WorkspaceOnlineStatus | null;
  /** 无 --online 时必须是 LOCAL_ONLY；不得把缓存状态写成 online。 */
  freshness: 'LOCAL_ONLY' | 'ONLINE';
  providerVerification: 'NOT_PERFORMED';
  writes: [];
  nextAction: string;
};

export type WorkspaceStatusOptions = {
  root: string;
  configHome: string;
  online?: boolean;
  api?: string;
  now?: () => Date;
  clientFactory?: (options: { platform: Platform; bearer?: string }) => StatusClient;
  credential?: AgentCredential;
};

function fileReport(
  absolutePath: string,
  label: string,
  state: { exists: boolean; valid: boolean; digest: string | null; error: CliError | null },
): StatusFileReport {
  return {
    label,
    path: absolutePath,
    exists: state.exists,
    valid: state.valid,
    digest: state.digest,
    error: state.error ? { code: state.error.code, message: state.error.message } : null,
  };
}

function backupLabels(backups: string[]): string[] {
  return backups.map((path) => `.workmesh/${basename(path)}`);
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function repositoryStatus(
  root: string,
  binding: WorkspaceConfigV2['repositories'][number],
  definitionRepositories: DefinitionRepository[] | null,
  definitionCached: boolean,
  checkedAt: string,
): Promise<RepositoryStatus> {
  const absolutePath = resolve(root, binding.path);
  const exists = await directoryExists(absolutePath);
  const base: RepositoryStatus = {
    key: binding.key,
    projectRepositoryId: binding.projectRepositoryId,
    path: binding.path,
    remote: binding.remote,
    needsRevalidation: binding.needsRevalidation === true,
    exists,
    isGitRepository: false,
    checkoutKind: null,
    branch: null,
    head: null,
    dirty: null,
    identityStatus: 'UNAVAILABLE',
    reasonCode: null,
    providerVerified: false,
    matchedCanonicalLocator: null,
    expectedCanonicalLocators: [],
    localCanonicalLocators: [],
    definitionCached,
    lastCheckedAt: checkedAt,
  };
  if (!exists) return { ...base, reasonCode: 'PATH_MISSING' };
  const local = await detectGitRepository(absolutePath);
  if (!local.isGitRepository || !local.root) return { ...base, reasonCode: 'NOT_A_GIT_REPOSITORY' };
  base.isGitRepository = true;
  base.checkoutKind = local.checkoutKind;
  base.branch = local.branch;
  base.head = local.head;
  base.dirty = local.dirty;
  let realAbsolutePath: string;
  try {
    realAbsolutePath = await realpath(absolutePath);
  } catch {
    realAbsolutePath = absolutePath;
  }
  if (gitRootKey(local.root) !== gitRootKey(realAbsolutePath))
    return {
      ...base,
      identityStatus: 'UNAVAILABLE',
      reasonCode: 'PATH_CHANGED',
    };
  if (!definitionCached || !definitionRepositories)
    return {
      ...base,
      identityStatus: 'UNAVAILABLE',
      reasonCode: binding.needsRevalidation ? 'NEEDS_REVALIDATION' : 'DEFINITION_CACHE_MISSING',
    };
  const repository = definitionRepositories.find(
    (item) => item.projectRepositoryId === binding.projectRepositoryId,
  );
  if (!repository)
    return { ...base, identityStatus: 'UNAVAILABLE', reasonCode: 'REPOSITORY_NOT_IN_DEFINITION' };
  if (repository.archivedAt)
    return { ...base, identityStatus: 'MISMATCH', reasonCode: 'REPOSITORY_ARCHIVED' };
  const active = repository.locators.filter((locator) => !locator.revokedAt);
  base.expectedCanonicalLocators = active.map((locator) => locator.canonicalLocator);
  if (active.length === 0)
    return { ...base, identityStatus: 'UNAVAILABLE', reasonCode: 'NO_ACTIVE_LOCATOR' };
  const match = matchRemoteLocator(local.remotes, active);
  base.localCanonicalLocators = match.localCanonicals;
  if (!match.match) return { ...base, identityStatus: 'MISMATCH', reasonCode: 'LOCATOR_MISMATCH' };
  return {
    ...base,
    identityStatus: 'DECLARED_MATCH',
    reasonCode: null,
    matchedCanonicalLocator: match.match.matchedCanonical,
  };
}

function v2NextAction(
  repositories: RepositoryStatus[],
  online: WorkspaceOnlineStatus | null,
  hasDefinition: boolean,
  definitionCacheMatches: boolean | null,
): string {
  if (repositories.some((repository) => repository.identityStatus === 'MISMATCH'))
    return '存在 MISMATCH：修正 remote 或让管理员声明正确的 canonical locator 后重新运行 workspace bind；不得按目录名/仓库名改绑。';
  if (!hasDefinition)
    return '配置缺少已发布定义引用（v1 迁移结果）：运行在线 workspace bind 刷新定义。';
  if (definitionCacheMatches === false)
    return '本机 revision 缓存摘要与绑定不一致：运行在线 workspace bind 或重新接入刷新缓存。';
  if (!definitionCacheMatches)
    return '缺少可用的 revision 缓存：运行在线 workspace bind 以写入缓存（离线 bind/status 只读缓存）。';
  if (repositories.some((repository) => repository.needsRevalidation))
    return '存在待重新核验的迁移仓库映射：运行 workspace bind --repository <id> --path <dir>。';
  if (online?.status === 'STALE')
    return '平台已发布新定义，本机仍绑定旧 revision；不会自动切换，请按管理员发布说明重新接入。';
  if (repositories.length === 0)
    return '当前没有仓库映射（无代码工作区合法）；如需仓库运行 workspace bind。';
  return '本机状态就绪（仅本机只读视角；未做 provider 核验）。';
}

async function onlineCheck(options: {
  config: WorkspaceConfigV2;
  root: string;
  configHome: string;
  api?: string;
  checkedAt: string;
  clientFactory?: WorkspaceStatusOptions['clientFactory'];
  credential?: AgentCredential;
}): Promise<WorkspaceOnlineStatus> {
  const platform = bindPlatform(options.config.platform, options.api);
  const credential =
    options.credential ??
    (await findCredential(options.configHome, {
      origin: platform.origin,
      apiBasePath: platform.apiBasePath,
      projectId: options.config.projectId,
      roleKey: options.config.defaults.roleKey ?? undefined,
    }));
  const client = (options.clientFactory ?? ((input) => new V1Client(input)))({
    platform,
    bearer: bearerOf(credential),
  });
  const response = await client.getWorkspaceDefinition(options.config.projectId);
  const bindingRevisionId = options.config.definition?.revisionId ?? null;
  const bindingDigest = options.config.definition?.sha256 ?? null;
  if (response.definitionStatus === 'NOT_CONFIGURED')
    return {
      status: 'STALE',
      checkedAt: options.checkedAt,
      source: 'ONLINE_DEFINITION',
      definitionStatus: 'NOT_CONFIGURED',
      currentRevisionId: null,
      currentDigest: null,
      bindingRevisionId,
      bindingDigest,
      bindingRevisionMatches: false,
      digestMatches: false,
      digestVerified: true,
      reasonCode: 'PROJECT_NOT_CONFIGURED',
    };
  const revision = response.revision;
  if (!revision) throw new CliError('PROTOCOL_INVALID', 'configured 定义响应缺少 revision');
  const bindingRevisionMatches = bindingRevisionId === revision.revisionId;
  const digestMatches = bindingDigest === revision.digest;
  return {
    status: bindingRevisionMatches && digestMatches ? 'ONLINE' : 'STALE',
    checkedAt: options.checkedAt,
    source: 'ONLINE_DEFINITION',
    definitionStatus: 'CONFIGURED',
    currentRevisionId: revision.revisionId,
    currentDigest: revision.digest,
    bindingRevisionId,
    bindingDigest,
    bindingRevisionMatches,
    digestMatches,
    digestVerified: response.digestMatchesPayload,
    reasonCode: !bindingRevisionId ? 'WORKSPACE_DEFINITION_REQUIRED' : null,
  };
}

/**
 * `workspace status`：默认纯本地只读诊断；`--online` 才额外做只读服务端比对。
 * DUAL_ACTIVE 是只读诊断例外：报告两个活动文件/摘要/nextAction 并以退出码 5 抛出。
 * 全部路径都只读；status 不写 state.json / 缓存 / 用户索引。
 */
export async function runWorkspaceStatus(
  options: WorkspaceStatusOptions,
): Promise<WorkspaceStatusReport> {
  const root = resolveWorkspaceRoot(options.root);
  const snapshot = await detectWorkspaceState(root);
  const now = options.now?.() ?? new Date();
  const generatedAt = now.toISOString();
  const recovery = await runWorkspaceRecover({ root, configHome: options.configHome });
  const initRecovery = recovery.pending.exists || recovery.state === 'LOCKED' ? recovery : null;
  const base: WorkspaceStatusReport = {
    mode: 'status',
    state: snapshot.state,
    rootLabel: '.',
    generatedAt,
    files: {
      v1: fileReport(workspaceConfigV1Path(root), '.workmesh/config.json', snapshot.v1),
      v2: fileReport(workspaceV2Path(root), '.workmesh/workspace.json', snapshot.v2),
    },
    backups: backupLabels(snapshot.backups),
    journal: snapshot.journal
      ? {
          phase: snapshot.journal.phase,
          updatedAt: snapshot.journal.updatedAt || null,
          resolution: snapshot.journal.resolution,
        }
      : null,
    projectId: null,
    platform: null,
    workspaceId: null,
    roleKey: null,
    definition: null,
    layoutKind: null,
    directWorkspaceMatch: null,
    repositories: [],
    definitionCache: null,
    v1Migration: null,
    initRecovery,
    online: null,
    freshness: 'LOCAL_ONLY',
    providerVerification: 'NOT_PERFORMED',
    writes: [],
    nextAction: '',
  };

  if (snapshot.state === 'DUAL_ACTIVE') {
    const status: WorkspaceStatusReport = {
      ...base,
      nextAction:
        '先运行 workmesh workspace migrate --inspect 诊断；确认 v2 有效且 journal 可收敛后运行 workmesh workspace migrate --resolve keep-v2（只归档 v1，不读 .bak）。',
    };
    const dual = dualConfigError(snapshot);
    throw new CliError(dual.code, dual.message, {
      details: { ...(dual.details ?? {}), status },
    });
  }

  if (snapshot.state === 'NONE')
    return {
      ...base,
      nextAction:
        initRecovery?.nextAction ??
        '未接入：运行 workmesh workspace init --join <code> --root . --api <base> --role <role>。',
    };

  if (snapshot.state === 'V1_ONLY') {
    const v1 = snapshot.v1.value as WorkspaceConfig | null;
    return {
      ...base,
      projectId: v1?.projectId ?? null,
      platform: v1?.platform ?? null,
      roleKey: v1?.roleKey ?? null,
      v1Migration: { required: true, command: 'workmesh workspace migrate --dry-run' },
      nextAction:
        '仍是 v1 配置：运行 workmesh workspace migrate --dry-run 查看映射，再运行 --apply；旧数据命令继续按 v1 读取。',
    };
  }

  const config = snapshot.v2.value;
  if (!config)
    return {
      ...base,
      nextAction: `workspace.json 损坏或不受支持：${snapshot.v2.error?.message ?? '结构非法'}；请修复文件或重新执行 workspace init --join。本命令不会自动选择其他配置。`,
    };
  const definitionCached = config.definition !== null;
  const cached = config.definition
    ? await readDefinitionCache(root, config.definition.revisionId)
    : null;
  const cacheMatchesBinding =
    cached && cached.cache && config.definition
      ? cached.cache.digest === config.definition.sha256 &&
        cached.cache.revisionId === config.definition.revisionId
      : null;
  const repositories: RepositoryStatus[] = [];
  for (const binding of config.repositories) {
    repositories.push(
      await repositoryStatus(
        root,
        binding,
        cached?.cache?.repositories ?? null,
        definitionCached && cacheMatchesBinding !== false && cached?.cache !== null,
        generatedAt,
      ),
    );
  }
  const online = options.online
    ? await onlineCheck({
        config,
        root,
        configHome: options.configHome,
        api: options.api,
        checkedAt: generatedAt,
        clientFactory: options.clientFactory,
        credential: options.credential,
      })
    : null;
  const nextAction = v2NextAction(repositories, online, definitionCached, cacheMatchesBinding);
  return {
    ...base,
    projectId: config.projectId,
    platform: config.platform,
    workspaceId: config.workspaceId,
    roleKey: config.defaults.roleKey,
    definition: config.definition
      ? {
          revisionId: config.definition.revisionId,
          digest: config.definition.sha256,
          present: true,
        }
      : null,
    layoutKind: config.layout.kind,
    repositories,
    definitionCache: config.definition
      ? {
          label: workspaceRelativeLabel(
            root,
            workspaceDefinitionCachePath(root, config.definition.revisionId),
          ),
          present: cached?.exists === true,
          revisionId: config.definition.revisionId,
          digest: cached?.cache?.digest ?? null,
          fetchedAt: cached?.cache?.fetchedAt ?? null,
          matchesBinding: cacheMatchesBinding,
          error: cached?.error ? { code: cached.error.code, message: cached.error.message } : null,
        }
      : null,
    online,
    freshness: online ? 'ONLINE' : 'LOCAL_ONLY',
    nextAction: initRecovery?.nextAction ?? nextAction,
  };
}

/** 用户索引中的精确 workspace 匹配（只读）；不做前缀/basename 推断。 */
export async function directWorkspaceMatch(
  root: string,
  configHome: string,
): Promise<{ workspaceId: string; label: string } | null> {
  try {
    const index = await loadUserIndex(configHome);
    const match = findWorkspaceByGitRoot(index, root);
    return match ? { workspaceId: match.workspaceId, label: '.' } : null;
  } catch {
    return null;
  }
}

export { canonicalizeLocator };
