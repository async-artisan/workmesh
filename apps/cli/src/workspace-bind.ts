import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { V1Client } from './client';
import { bearerOf, findCredential, type AgentCredential } from './credential-store';
import { CliError, asCliError } from './errors';
import { parsePlatform, type Platform } from './platform';
import { ensurePrivateDir } from './private-fs';
import {
  acquireFileLock,
  addGitRootMapping,
  canonicalWorkspaceRoot,
  isUserIndexCommittedError,
  updateUserIndex,
  upsertUserWorkspace,
  userIndexLabel,
  type FileLock,
} from './user-index';
import {
  canonicalizeLocator,
  detectGitRepository,
  gitRootKey,
  matchRemoteLocator,
  resolveRepositoryPath,
} from './git';
import {
  assertRevisionRepositoryAssociation,
  definitionCacheFromRevision,
  definitionRequiredError,
  detectWorkspaceState,
  dualConfigError,
  loadWorkspaceConfigV2,
  parseWorkspaceConfigV2,
  parseDefinitionPayload,
  readDefinitionCache,
  resolveWorkspaceRoot,
  saveDefinitionCache,
  saveWorkspaceConfigV2,
  serializeWorkspaceConfigV2,
  workspaceLocalDir,
  v1MigrationRequiredError,
  workspaceNotConfiguredError,
  workspaceRelativeLabel,
  type DefinitionRepository,
  type ResolvedWorkspaceDefinition,
  type WorkspaceConfigV2,
  type WorkspaceDefinitionCache,
  type WorkspaceRepositoryBinding,
} from './workspace-config';

type BindClient = {
  getWorkspaceDefinitionRevision: V1Client['getWorkspaceDefinitionRevision'];
  getWorkspaceDefinition: V1Client['getWorkspaceDefinition'];
};

export type WorkspaceBindOptions = {
  root: string;
  repositoryId: string;
  path: string;
  offline?: boolean;
  /** 预览后才写入：false 时零写入。 */
  apply: boolean;
  configHome: string;
  api?: string;
  now?: () => Date;
  clientFactory?: (options: { platform: Platform; bearer?: string }) => BindClient;
  /** 测试注入：跳过凭据文件读取。 */
  credential?: AgentCredential;
  /** 测试注入：模拟索引文件持久化失败；生产路径使用默认原子写入。 */
  indexSaver?: Parameters<typeof updateUserIndex>[2];
  /** 测试注入：模拟索引提交后的锁释放失败。 */
  indexLockRelease?: (lock: FileLock) => Promise<void>;
};

export type WorkspaceBindResult = {
  mode: 'bind';
  offline: boolean;
  applied: boolean;
  repository: {
    key: string;
    projectRepositoryId: string;
    path: string;
    remote: string;
  };
  local: {
    relativePath: string;
    checkoutKind: string;
    head: string | null;
    branch: string | null;
    dirty: boolean | null;
    localCanonicalLocators: string[];
  };
  definition: {
    revisionId: string;
    digest: string;
    source: 'PINNED_REVISION' | 'CURRENT_DEFINITION' | 'CACHED_DEFINITION';
    refreshed: boolean;
  };
  locator: { matchedCanonicalLocator: string; remoteName: string };
  identityStatus: 'DECLARED_MATCH';
  providerVerified: false;
  verificationText: string;
  checkedAt: string;
  writes: Array<{ path: string; action: string }>;
  wouldWrite: Array<{ path: string; action: string }>;
  warnings: string[];
  nextAction: string;
};

function defaultClientFactory(options: { platform: Platform; bearer?: string }): BindClient {
  return new V1Client({ platform: options.platform, bearer: options.bearer });
}

export function bindPlatform(configPlatform: Platform, api?: string): Platform {
  if (!api) return configPlatform;
  const platform = parsePlatform(api);
  if (
    platform.origin !== configPlatform.origin ||
    platform.apiBasePath !== configPlatform.apiBasePath
  )
    throw new CliError(
      'AUTH_REQUIRED',
      '显式 --api 与工作区平台不一致；跨平台需要匹配的新设备授权，不借用已有凭据',
    );
  return platform;
}

function offlineUnverified(
  reasonCode: string,
  message: string,
  details: Record<string, unknown> = {},
): CliError {
  return new CliError('WORKSPACE_OFFLINE_UNVERIFIED', message, {
    details: {
      reasonCode,
      nextAction: '联网执行 workspace bind，或先在线刷新定义缓存',
      ...details,
    },
  });
}

async function readLocalMismatchHistory(root: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(root, '.workmesh', 'local', 'state.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Set();
    const record = parsed as Record<string, unknown>;
    const mismatches =
      record.mismatches &&
      typeof record.mismatches === 'object' &&
      !Array.isArray(record.mismatches)
        ? (record.mismatches as Record<string, unknown>)
        : {};
    return new Set(Object.keys(mismatches));
  } catch {
    return new Set();
  }
}

function assertRepositoryDeclared(
  repositories: DefinitionRepository[],
  projectRepositoryId: string,
): DefinitionRepository {
  const repository = repositories.find((item) => item.projectRepositoryId === projectRepositoryId);
  if (!repository)
    throw new CliError(
      'WORKSPACE_REPO_NOT_FOUND',
      `已发布定义中没有 repositoryId ${projectRepositoryId}；只能绑定平台定义列出的仓库。`,
      { details: { projectRepositoryId } },
    );
  if (repository.archivedAt)
    throw new CliError(
      'WORKSPACE_REPO_MISMATCH',
      `仓库 ${repository.key} 已于 ${repository.archivedAt} 归档，拒绝绑定。`,
      { details: { projectRepositoryId, archivedAt: repository.archivedAt } },
    );
  return repository;
}

/**
 * `workspace bind`：在线读取已发布定义（或迁移配置的当前定义）确认仓库与 locator；
 * `--offline` 只允许“摘要有效的 revision 缓存 + 精确 canonical locator 匹配”。
 * 默认只预览；`--yes`（apply=true）才写 workspace.json 与用户索引。
 */
export async function runWorkspaceBind(
  options: WorkspaceBindOptions,
): Promise<WorkspaceBindResult> {
  const root = resolveWorkspaceRoot(options.root);
  const snapshot = await detectWorkspaceState(root);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.state === 'NONE') throw workspaceNotConfiguredError('workspace bind');
  if (snapshot.state === 'V1_ONLY') throw v1MigrationRequiredError('workspace bind');
  if (!snapshot.v2.valid || !snapshot.v2.value)
    throw (
      snapshot.v2.error ??
      new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspace.json 结构非法，无法 bind')
    );
  const config: WorkspaceConfigV2 = snapshot.v2.value;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.repositoryId))
    throw new CliError('VALIDATION_FAILED', '--repository 必须是 UUID');
  const projectRepositoryId = options.repositoryId.toLowerCase();

  const target = await resolveRepositoryPath(root, options.path);
  const local = await detectGitRepository(target.absolutePath);
  if (!local.isGitRepository || !local.root)
    throw new CliError(
      'WORKSPACE_REPO_NOT_FOUND',
      `--path 不是 Git 工作树：${options.path}；不能按目录名推断仓库身份。`,
      { details: { path: options.path } },
    );
  if (gitRootKey(local.root) !== gitRootKey(target.absolutePath))
    throw new CliError(
      'WORKSPACE_REPO_NOT_FOUND',
      `--path 必须是 Git 仓库根目录（${workspaceRelativeLabel(root, local.root)}），不能指向仓内子目录。`,
      { details: { path: options.path, gitRoot: workspaceRelativeLabel(root, local.root) } },
    );

  const now = options.now?.() ?? new Date();
  const checkedAt = now.toISOString();
  const warnings: string[] = [];
  let definition: ResolvedWorkspaceDefinition;
  let source: 'PINNED_REVISION' | 'CURRENT_DEFINITION' | 'CACHED_DEFINITION';
  let refreshed = false;
  let cacheForWrite: WorkspaceDefinitionCache | null = null;

  if (options.offline) {
    if (!config.definition) throw definitionRequiredError('workspace bind --offline');
    const cached = await readDefinitionCache(root, config.definition.revisionId);
    if (!cached.exists)
      throw offlineUnverified(
        'NO_DEFINITION_CACHE',
        `离线 bind 拒绝：缺少 revision 缓存（.workmesh/definitions/${config.definition.revisionId}.json）；不能按目录名、仓库名或路径猜测身份。`,
        { revisionId: config.definition.revisionId },
      );
    if (cached.error || !cached.cache)
      throw offlineUnverified(
        'DEFINITION_CACHE_INVALID',
        `离线 bind 拒绝：revision 缓存无效（${cached.error?.message ?? 'unknown'}）。`,
        { revisionId: config.definition.revisionId },
      );
    const cache = cached.cache;
    if (cache.revisionId !== config.definition.revisionId)
      throw offlineUnverified(
        'REVISION_MISMATCH',
        '离线 bind 拒绝：缓存 revisionId 与 workspace.json 的 definition.revisionId 不一致。',
        {
          cacheRevisionId: cache.revisionId,
          bindingRevisionId: config.definition.revisionId,
        },
      );
    if (cache.digest !== config.definition.sha256)
      throw offlineUnverified(
        'DIGEST_MISMATCH',
        '离线 bind 拒绝：缓存 digest 与 workspace.json 的 definition.sha256 不一致。',
        { cacheDigest: cache.digest, bindingDigest: config.definition.sha256 },
      );
    if (cache.publishedAt && Date.parse(cache.publishedAt) > now.getTime())
      warnings.push('缓存 publishedAt 晚于本机时间，请检查时钟；仍按精确 digest 匹配。');
    definition = {
      revisionId: cache.revisionId,
      revisionNo: null,
      digest: cache.digest,
      publishedAt: cache.publishedAt,
      payload: parseDefinitionPayload(cache.payload),
      repositories: cache.repositories,
      validation: cache.validation,
      definitionVersion: null,
      projectVersion: null,
    };
    source = 'CACHED_DEFINITION';
    warnings.push('离线 locator 快照无法确认撤销或归档是否已发生；请尽快在线重新核验。');
  } else {
    const platform = bindPlatform(config.platform, options.api);
    const credential =
      options.credential ??
      (await findCredential(options.configHome, {
        origin: platform.origin,
        apiBasePath: platform.apiBasePath,
        projectId: config.projectId,
        roleKey: config.defaults.roleKey ?? undefined,
      }));
    const client = (options.clientFactory ?? defaultClientFactory)({
      platform,
      bearer: bearerOf(credential),
    });
    if (config.definition) {
      const response = await client.getWorkspaceDefinitionRevision(
        config.projectId,
        config.definition.revisionId,
      );
      if (!response.payloadPresent || !response.digestMatchesPayload)
        throw new CliError(
          'CONTENT_INTEGRITY_FAILED',
          '服务端 revision payload 的规范化摘要与 digest 不一致，拒绝绑定。',
        );
      if (response.revision.revisionId !== config.definition.revisionId)
        throw new CliError(
          'WORKSPACE_CONTEXT_STALE',
          '服务端返回的 revisionId 与本机绑定不一致，拒绝隐式切换定义；请重新执行 workspace init --join。',
          {
            details: {
              bindingRevisionId: config.definition.revisionId,
              serverRevisionId: response.revision.revisionId,
            },
          },
        );
      if (response.revision.digest !== config.definition.sha256)
        throw new CliError(
          'WORKSPACE_CONTEXT_STALE',
          '精确 revision 的 digest 与本机绑定不一致，拒绝绑定；请重新执行 workspace init --join。',
          {
            details: {
              bindingDigest: config.definition.sha256,
              serverDigest: response.revision.digest,
            },
          },
        );
      definition = response.revision;
      source = 'PINNED_REVISION';
    } else {
      // 迁移配置（definition=null）允许在线 fetch 当前已发布定义并刷新绑定引用。
      const current = await client.getWorkspaceDefinition(config.projectId);
      if (current.projectId !== config.projectId)
        throw new CliError('CONTENT_INTEGRITY_FAILED', '当前定义响应的项目与工作区不一致。');
      if (current.definitionStatus === 'NOT_CONFIGURED' || !current.revision)
        throw new CliError(
          'PROJECT_UNCONFIGURED',
          '项目尚未发布工作区定义（NOT_CONFIGURED），无法 bind；请项目负责人先发布 layout.kind: NONE 或仓库定义。',
          { status: 409, details: { projectId: config.projectId } },
        );
      if (!current.digestMatchesPayload)
        throw new CliError(
          'CONTENT_INTEGRITY_FAILED',
          '当前定义 payload 的规范化摘要与 digest 不一致，拒绝绑定。',
        );
      definition = current.revision;
      source = 'CURRENT_DEFINITION';
      refreshed = true;
      warnings.push(
        '当前配置缺少定义引用（v1 迁移结果）；本次在线 bind 将把定义引用刷新为当前已发布 revision。',
      );
    }
    cacheForWrite = definitionCacheFromRevision(definition, checkedAt);
  }

  if (definition.payload.projectId !== config.projectId)
    throw new CliError(
      options.offline ? 'WORKSPACE_OFFLINE_UNVERIFIED' : 'CONTENT_INTEGRITY_FAILED',
      '定义 payload 的项目与本机工作区不一致，拒绝绑定。',
    );
  assertRevisionRepositoryAssociation(definition.payload, definition.repositories);
  const repository = assertRepositoryDeclared(definition.repositories, projectRepositoryId);
  if (options.offline) {
    const history = await readLocalMismatchHistory(root);
    if (history.has(projectRepositoryId))
      throw offlineUnverified(
        'MISMATCH_HISTORY',
        '离线 bind 拒绝：本机存在该仓库的 MISMATCH 历史，需在线重新核验后才能绑定。',
        { projectRepositoryId },
      );
  }
  const activeLocators = repository.locators.filter((locator) => !locator.revokedAt);
  if (activeLocators.length === 0)
    throw new CliError(
      options.offline ? 'WORKSPACE_OFFLINE_UNVERIFIED' : 'WORKSPACE_REPO_MISMATCH',
      '已发布定义中该仓库没有可用的 canonical locator；无法验证本机 remote，拒绝绑定。',
      { details: { projectRepositoryId, reasonCode: 'NO_ACTIVE_LOCATOR' } },
    );
  const locatorMatch = matchRemoteLocator(local.remotes, activeLocators);
  if (!locatorMatch.match) {
    const expected = activeLocators.map((locator) => locator.canonicalLocator);
    throw new CliError(
      options.offline ? 'WORKSPACE_OFFLINE_UNVERIFIED' : 'WORKSPACE_REPO_MISMATCH',
      options.offline
        ? '离线 bind 拒绝：本地 remote 与缓存中的 canonical locator 不精确匹配（不做 HTTPS/SSH、大小写或 .git 猜测）。'
        : '本地 remote 与已发布声明的 canonical locator 不匹配；不按目录名、仓库名或 basename 认领身份。',
      {
        details: {
          reasonCode: 'LOCATOR_MISMATCH',
          projectRepositoryId,
          localCanonicalLocators: locatorMatch.localCanonicals,
          expectedCanonicalLocators: expected,
        },
      },
    );
  }
  const match = locatorMatch.match;

  const nextRepositories: WorkspaceRepositoryBinding[] = config.repositories.map((item) => ({
    ...item,
  }));
  const sameIdIndex = nextRepositories.findIndex(
    (item) => item.projectRepositoryId === projectRepositoryId,
  );
  const sameKey = nextRepositories.find(
    (item) => item.key === repository.key && item.projectRepositoryId !== projectRepositoryId,
  );
  if (sameKey)
    throw new CliError(
      'RESOURCE_CONFLICT',
      `仓库 key ${repository.key} 已绑定到另一个 projectRepositoryId；需显式解绑后才能改绑。`,
      { details: { key: repository.key, boundRepositoryId: sameKey.projectRepositoryId } },
    );
  const samePath = nextRepositories.find(
    (item) => item.path === target.relativePath && item.projectRepositoryId !== projectRepositoryId,
  );
  if (samePath)
    throw new CliError(
      'RESOURCE_CONFLICT',
      `路径 ${target.relativePath} 已绑定到另一个仓库；一个本机路径不能同时代表两个仓库身份。`,
      { details: { path: target.relativePath, boundRepositoryId: samePath.projectRepositoryId } },
    );

  const binding: WorkspaceRepositoryBinding = {
    key: repository.key,
    projectRepositoryId,
    path: target.relativePath,
    remote: match.remoteName,
  };
  if (sameIdIndex >= 0) nextRepositories[sameIdIndex] = binding;
  else nextRepositories.push(binding);
  const nextDefinition = refreshed
    ? { revisionId: definition.revisionId, sha256: definition.digest }
    : config.definition;
  const nextConfig: WorkspaceConfigV2 = {
    ...config,
    definition: nextDefinition,
    repositories: nextRepositories,
  };
  parseWorkspaceConfigV2(JSON.parse(serializeWorkspaceConfigV2(nextConfig)) as unknown);

  const wouldWrite = [
    { path: '.workmesh/workspace.json', action: sameIdIndex >= 0 ? 'REPLACE' : 'CREATE' },
    { path: `${userIndexLabel()}（gitRoots 精确映射）`, action: 'REPLACE' },
    ...(cacheForWrite
      ? [
          {
            path: `.workmesh/definitions/${definition.revisionId}.json`,
            action: 'CREATE',
          },
        ]
      : []),
  ];
  const base = {
    mode: 'bind' as const,
    offline: options.offline === true,
    repository: {
      key: binding.key,
      projectRepositoryId,
      path: binding.path,
      remote: binding.remote,
    },
    local: {
      relativePath: target.relativePath,
      checkoutKind: local.checkoutKind,
      head: local.head,
      branch: local.branch,
      dirty: local.dirty,
      localCanonicalLocators: locatorMatch.localCanonicals,
    },
    definition: {
      revisionId: definition.revisionId,
      digest: definition.digest,
      source,
      refreshed,
    },
    locator: {
      matchedCanonicalLocator: match.matchedCanonical,
      remoteName: match.remoteName,
    },
    identityStatus: 'DECLARED_MATCH' as const,
    providerVerified: false as const,
    verificationText:
      '未由托管方核验（DECLARED）：仅代表 HUMAN 声明的 locator 与本机 remote 精确匹配。',
    checkedAt,
    warnings,
  };
  if (!options.apply)
    return {
      ...base,
      applied: false,
      writes: [],
      wouldWrite,
      nextAction:
        '预览：未写入任何文件；确认后重新运行并加 --yes 才写入 workspace.json 与用户索引。',
    };

  // Refuse an in-flight bind instead of replacing another process's successful config.
  const localDir = workspaceLocalDir(root);
  const lockPath = join(localDir, 'bind.lock');
  await ensurePrivateDir(localDir);
  const lock = await acquireFileLock(lockPath, {
    waitMs: 0,
    busyMessage: '另一个 bind 正在更新此工作区；本次未写入，请稍后重试。',
    lockLabel: '.workmesh/local/bind.lock',
  });

  const writes: Array<{ path: string; action: string }> = [];
  let configWritten = false;
  let indexWritten = false;
  try {
    const current = await loadWorkspaceConfigV2(root, {
      allowNullDefinition: config.definition === null,
    });
    if (serializeWorkspaceConfigV2(current) !== serializeWorkspaceConfigV2(config))
      throw new CliError(
        'WORKSPACE_CONTEXT_STALE',
        '工作区配置在 bind 预览后已被其他进程更新；为避免覆盖新绑定，请重新运行 bind。',
      );
    await saveWorkspaceConfigV2(root, nextConfig);
    configWritten = true;
    writes.push({
      path: '.workmesh/workspace.json',
      action: sameIdIndex >= 0 ? 'REPLACE' : 'CREATE',
    });
    const canonicalRoot = await canonicalWorkspaceRoot(root);
    await updateUserIndex(
      options.configHome,
      (index) => {
        const withWorkspace = upsertUserWorkspace(index, {
          workspaceId: config.workspaceId,
          root: canonicalRoot,
          projectId: config.projectId,
          platform: config.platform,
          updatedAt: checkedAt,
        });
        return local.root
          ? addGitRootMapping(withWorkspace, local.root, config.workspaceId)
          : withWorkspace;
      },
      options.indexSaver,
      { releaseLock: options.indexLockRelease },
    );
    indexWritten = true;
    writes.push({ path: userIndexLabel(), action: 'REPLACE' });
    if (cacheForWrite) {
      try {
        await saveDefinitionCache(root, cacheForWrite);
        writes.push({
          path: `.workmesh/definitions/${definition.revisionId}.json`,
          action: 'CREATE',
        });
      } catch (error) {
        warnings.push(`定义缓存写入失败（不影响绑定有效性）：${asCliError(error).message}`);
      }
    }
  } catch (error) {
    if (isUserIndexCommittedError(error)) indexWritten = true;
    if (configWritten && !indexWritten) {
      try {
        await saveWorkspaceConfigV2(root, config);
      } catch {
        // 回滚失败时 details 明确提示人工检查。
      }
    }
    const failure = asCliError(error);
    const stateMessage = indexWritten
      ? 'workspace.json 与用户索引均已提交并保持一致；不会回滚。索引锁清理失败，确认锁状态后再执行后续写入。'
      : 'bind 写入失败；workspace.json 已回滚到写入前内容（若可回滚），请检查本机权限后重试。';
    throw new CliError('WORKSPACE_WRITE_FAILED', `${failure.message}\n${stateMessage}`, {
      details: {
        ...(failure.details ?? {}),
        workspaceCommitted: configWritten && indexWritten,
        indexCommitted: indexWritten,
        rollback: configWritten && !indexWritten ? 'attempted' : 'not-needed',
      },
    });
  } finally {
    try {
      await lock.release();
    } catch {
      // Preserve the bind result; abandoned locks fail closed and require manual cleanup.
    }
  }

  return {
    ...base,
    applied: true,
    writes,
    wouldWrite,
    nextAction:
      '绑定完成：DECLARED_MATCH（未由托管方核验）；运行 workmesh workspace status 查看本机状态。',
  };
}

export { canonicalizeLocator };
