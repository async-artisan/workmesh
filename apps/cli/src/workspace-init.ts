import { access, constants, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deviceLogin } from './auth';
import { V1Client, type FetchLike } from './client';
import { bearerOf } from './credential-store';
import { findReusableCredential } from './credential-session';
import { assertRoleKey, type WorkspaceHost } from './config';
import { confirmFileStore } from './consent';
import { CliError, asCliError } from './errors';
import { parsePlatform, type Platform } from './platform';
import { ensurePrivateDir, writePrivateFile } from './private-fs';
import { workspaceInitPlanDigestOf } from './workspace-recover';
import {
  updateUserIndex,
  upsertUserWorkspace,
  userIndexLabel,
  canonicalWorkspaceRoot,
  acquireFileLock,
  isUserIndexCommittedError,
} from './user-index';
import {
  definitionCacheFromRevision,
  detectWorkspaceState,
  dualConfigError,
  initLockPath,
  parseWorkspaceConfigV2,
  pendingInitPath,
  resolveWorkspaceRoot,
  saveDefinitionCache,
  saveWorkspaceConfigV2,
  serializeWorkspaceConfigV2,
  v1MigrationRequiredError,
  workspaceLocalDir,
  workspaceRelativeLabel,
  workspaceV2Path,
  type EnrolledProject,
  type ResolvedWorkspaceDefinition,
  type WorkspaceConfigV2,
  type WorkspaceLayoutKind,
  type WorkspaceRepositoryBinding,
} from './workspace-config';

type InitClient = {
  consumeEnrollmentCode: V1Client['consumeEnrollmentCode'];
  getWorkspaceDefinitionRevision: V1Client['getWorkspaceDefinitionRevision'];
  getWorkspaceDefinition: V1Client['getWorkspaceDefinition'];
};

export type WorkspaceInitClientFactory = (options: {
  platform: Platform;
  bearer?: string;
}) => InitClient;

export type WorkspaceInitLogin = typeof deviceLogin;

export type WorkspaceInitStage =
  | 'PREFLIGHT'
  | 'CONSENT'
  | 'LOCK'
  | 'ENROLLMENT'
  | 'AUTHORIZATION'
  | 'DEFINITION'
  | 'WORKSPACE'
  | 'INDEX'
  | 'CACHE'
  | 'COMPLETE';

export type WorkspaceInitOptions = {
  root: string;
  joinCode: string;
  /** 首次接入没有配置，必须显式给出 --api（§13.5 第 1 步）。 */
  api: string;
  role: string;
  host?: string;
  configHome: string;
  /** 默认只做本机前置检查 + 计划展示；--apply 才消费码并写入。 */
  apply: boolean;
  /** 非交互自动化显式同意本地凭据文件存储。 */
  yes?: boolean;
  clientName?: string;
  timeoutMs?: number;
  now?: () => Date;
  fetch?: FetchLike;
  login?: WorkspaceInitLogin;
  findReusableCredential?: typeof findReusableCredential;
  consent?: () => Promise<void>;
  /** Local capability checks run after arguments/state validation and before consent or code consumption. */
  preflight?: () => Promise<void>;
  /** Notices only; callers choose stderr or another sink so JSON stdout stays clean. */
  onStage?: (stage: WorkspaceInitStage) => void;
  clientFactory?: WorkspaceInitClientFactory;
  onPrompt?: (prompt: { url: string; userCode: string; expiresAt: string }) => void;
  onNotice?: (text: string) => void;
  /** 仅测试注入：模拟写入阶段失败（验证无半份配置与 pending 保留）。 */
  __testFailAt?: 'WORKSPACE' | 'INDEX' | 'CACHE' | 'INDEX_LOCK_RELEASE' | 'PENDING_REMOVE';
};

export type WorkspaceInitPreflight = {
  rootExists: boolean;
  rootWritable: boolean;
  state: 'NONE';
};

export type WorkspaceInitPlan = {
  mode: 'plan';
  state: 'NONE';
  root: '.';
  platform: Platform;
  role: string;
  host: WorkspaceHost;
  consumesEnrollmentCode: false;
  applyRequired: true;
  writes: string[];
  wouldWrite: string[];
  preflight: WorkspaceInitPreflight;
  nextAction: string;
};

export type WorkspaceInitApplied = {
  mode: 'applied';
  workspaceId: string;
  projectId: string;
  projectName: string | null;
  platform: Platform;
  definition: { revisionId: string; digest: string };
  layoutKind: WorkspaceLayoutKind;
  repositories: Array<{ key: string; projectRepositoryId: string; path: string }>;
  repositoryVerification: 'NOT_VERIFIED';
  verificationText: string;
  credential: { credentialId: string; scopes: string[]; expiresAt: string };
  files: string[];
  userIndex: string;
  warnings: string[];
  nextActions: string[];
};

export type WorkspaceInitResult = WorkspaceInitPlan | WorkspaceInitApplied;

const HOSTS: WorkspaceHost[] = ['codex', 'claude-code'];

function defaultClientFactory(options: {
  platform: Platform;
  bearer?: string;
  fetch?: FetchLike;
}): InitClient {
  return new V1Client({ platform: options.platform, bearer: options.bearer, fetch: options.fetch });
}

export function normalizeJoinCode(value: string): string {
  const code = value.trim();
  if (!code) throw new CliError('INVALID_REQUEST', '--join 接入码不能为空');
  if (code.length > 512) throw new CliError('INVALID_REQUEST', '--join 接入码过长');
  // Join codes cannot contain whitespace or control characters.
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(code))
    throw new CliError('INVALID_REQUEST', '--join 接入码不能包含空白或控制字符');
  return code;
}

export function resolveInitHost(value?: string): WorkspaceHost {
  if (value === undefined) return 'codex';
  if (!HOSTS.includes(value as WorkspaceHost))
    throw new CliError('VALIDATION_FAILED', '--host 必须是 codex 或 claude-code');
  return value as WorkspaceHost;
}

async function inspectRoot(root: string, mustBeWritable: boolean): Promise<WorkspaceInitPreflight> {
  let info;
  try {
    info = await stat(root);
  } catch {
    throw new CliError('INVALID_REQUEST', `--root 目录不存在：${root}`);
  }
  if (!info.isDirectory()) throw new CliError('INVALID_REQUEST', `--root 不是目录：${root}`);
  const writable = true;
  if (mustBeWritable) {
    try {
      await access(root, constants.W_OK);
    } catch {
      throw new CliError('INVALID_REQUEST', `--root 目录不可写：${root}`);
    }
  }
  return { rootExists: true, rootWritable: writable, state: 'NONE' };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function assertRootAvailable(
  root: string,
  requested: { platform: Platform; role: string; host: WorkspaceHost },
): Promise<void> {
  const snapshot = await detectWorkspaceState(root);
  if (snapshot.state === 'V1_ONLY') throw v1MigrationRequiredError('workspace init --join');
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.v2.exists) {
    const current = snapshot.v2.value;
    const mismatch = current
      ? [
          ...(current.platform.origin !== requested.platform.origin ||
          current.platform.apiBasePath !== requested.platform.apiBasePath
            ? ['platform']
            : []),
          ...(current.defaults.roleKey !== requested.role ? ['role'] : []),
          ...(current.defaults.host !== requested.host ? ['host'] : []),
        ]
      : ['invalidConfig'];
    throw new CliError(
      'WORKSPACE_ALREADY_BOUND',
      `工作区已绑定（${workspaceV2Path(root)} 已存在）；本次未消费接入码、未改写配置。${mismatch.length ? '请求的平台、角色或宿主与现状不一致（或配置无效），请核对工作区。' : '无需重复 init；运行 workspace status 查看现状，若有 pending 运行 workspace recover 预览。'}`,
      {
        details: {
          state: snapshot.state,
          enrollmentConsumed: false,
          workspaceId: current?.workspaceId ?? null,
          projectId: current?.projectId ?? null,
          platform: current?.platform ?? null,
          role: current?.defaults.roleKey ?? null,
          host: current?.defaults.host ?? null,
          mismatch,
          workspacePath: workspaceRelativeLabel(root, workspaceV2Path(root)),
          nextAction: 'workmesh workspace status',
        },
      },
    );
  }
  if (await pathExists(pendingInitPath(root)))
    throw new CliError(
      'WORKSPACE_INIT_IN_PROGRESS',
      '发现先前 init 的 pending 记录；本次未消费接入码。先运行 workmesh workspace recover 只读检查提交状态；本命令不会重复消费旧码或删除诊断记录。',
      {
        details: {
          enrollmentConsumed: false,
          pendingInit: '.workmesh/local/pending-init.json',
          nextAction: 'workmesh workspace recover --root .',
        },
      },
    );
}

/** 接入码失败的可恢复原因；明文码不落盘、不回显。 */
export function enrollmentFailure(error: unknown): CliError {
  const failure = asCliError(error);
  const map: Record<string, string> = {
    ENROLLMENT_CONSUMED:
      '接入码已使用（可能已被本机或其他终端消费），请回 Web 重新生成接入码后重试。',
    ENROLLMENT_EXPIRED: '接入码已过期，请回 Web 重新生成接入码后重试。',
    ENROLLMENT_NOT_FOUND: '接入码无效，请核对后重新输入，或回 Web 重新生成。',
    ENROLLMENT_REVOKED: '接入码已被撤销，请回 Web 重新生成接入码后重试。',
    PROJECT_UNCONFIGURED:
      '项目尚未发布工作区定义，无法签发接入码；请项目负责人在 Web 发布定义后重新生成。',
    RATE_LIMITED: '请求过于频繁，请稍后重试；接入码未被消费。',
  };
  const message = map[failure.code];
  if (!message) return failure;
  return new CliError(failure.code, message, {
    status: failure.status,
    details: {
      ...(failure.details ?? {}),
      enrollmentConsumed: failure.code === 'ENROLLMENT_CONSUMED',
    },
    requestId: failure.requestId,
  });
}

function bindingsFromRevision(
  revision: ResolvedWorkspaceDefinition,
  warnings: string[],
): WorkspaceRepositoryBinding[] {
  if (revision.payload.layoutKind === 'NONE') return [];
  const resolvedById = new Map(
    revision.repositories.map((repository) => [repository.projectRepositoryId, repository]),
  );
  const bindings: WorkspaceRepositoryBinding[] = [];
  for (const repository of revision.payload.repositories) {
    const resolved = resolvedById.get(repository.projectRepositoryId);
    if (resolved?.archivedAt) {
      warnings.push(`仓库 ${repository.key} 在已发布定义中已归档，未写入本机映射`);
      continue;
    }
    const path = repository.suggestedPath ?? resolved?.suggestedPath ?? null;
    if (!path) {
      warnings.push(
        `仓库 ${repository.key} 没有定义中的相对路径建议，未写入映射；请用 workspace bind --path 显式绑定`,
      );
      continue;
    }
    bindings.push({
      key: repository.key,
      projectRepositoryId: repository.projectRepositoryId,
      path,
      remote: 'origin',
    });
  }
  return bindings;
}

function assertRevisionMatchesEnrollment(
  revision: ResolvedWorkspaceDefinition,
  digestMatchesPayload: boolean,
  enrolled: EnrolledProject,
): void {
  if (revision.payload.projectId !== enrolled.projectId)
    throw new CliError(
      'PROJECT_MISMATCH',
      'revision payload 的 projectId 缺失或与接入码项目不一致；拒绝写入本机配置。接入码已消费，请回 Web 重新生成。',
      {
        details: {
          expectedProjectId: enrolled.projectId,
          actualProjectId: revision.payload.projectId ?? null,
          enrollmentConsumed: true,
        },
      },
    );
  if (revision.revisionId !== enrolled.definitionRevisionId)
    throw new CliError(
      'CONTENT_INTEGRITY_FAILED',
      '服务端返回的 revisionId 与接入码绑定的 revision 不一致；接入码已消费，请回 Web 重新生成。',
      {
        details: {
          expectedRevisionId: enrolled.definitionRevisionId,
          actualRevisionId: revision.revisionId,
          enrollmentConsumed: true,
        },
      },
    );
  if (revision.digest !== enrolled.definitionDigest)
    throw new CliError(
      'CONTENT_INTEGRITY_FAILED',
      '精确 revision 的 digest 与接入码绑定值不一致；接入码已消费，请回 Web 重新生成。',
      {
        details: {
          expectedDigest: enrolled.definitionDigest,
          actualDigest: revision.digest,
          enrollmentConsumed: true,
        },
      },
    );
  if (!digestMatchesPayload)
    throw new CliError(
      'CONTENT_INTEGRITY_FAILED',
      'revision payload 的本地规范化重算摘要与服务端 digest 不一致，拒绝写入本机配置。接入码已消费，请回 Web 重新生成。',
      { details: { digest: revision.digest, enrollmentConsumed: true } },
    );
}

/**
 * `workspace init --join`：消费码 → 设备授权 → 按 revisionId 取精确 revision →
 * 校验摘要 → 原子写 workspace.json + 用户索引（§13.5 八步）。
 * 不存在 NOT_CONFIGURED / null revision 分支：接入码只能对已发布定义签发。
 */
export async function runWorkspaceInit(
  options: WorkspaceInitOptions,
): Promise<WorkspaceInitResult> {
  const root = resolveWorkspaceRoot(options.root);
  const platform = parsePlatform(options.api);
  const role = assertRoleKey(options.role, '--role');
  const host = resolveInitHost(options.host);
  const joinCode = normalizeJoinCode(options.joinCode);

  const preflight = await inspectRoot(root, options.apply);
  await assertRootAvailable(root, { platform, role, host });
  if (await pathExists(initLockPath(root)))
    throw new CliError(
      'WORKSPACE_INIT_IN_PROGRESS',
      '检测到另一个 init 正在进行（.workmesh/local/init.lock）；本次未消费接入码，请稍后重试。',
      {
        details: {
          enrollmentConsumed: false,
          nextAction: '等待另一个 init 结束；若进程中断，确认没有相关 CLI 进程运行后人工删除锁文件',
        },
      },
    );
  const plan: WorkspaceInitPlan = {
    mode: 'plan',
    state: 'NONE',
    root: '.',
    platform,
    role,
    host,
    consumesEnrollmentCode: false,
    applyRequired: true,
    writes: [],
    wouldWrite: [
      '.workmesh/local/pending-init.json（瞬时）',
      '.workmesh/workspace.json',
      '~/.workmesh/workspaces/index.json',
      '.workmesh/definitions/<revisionId>.json',
    ],
    preflight,
    nextAction:
      '本步骤不消费接入码、不写文件；确认计划后运行 workspace init ... --apply（非交互环境再加 --yes）。',
  };
  if (!options.apply) return plan;
  options.onStage?.('PREFLIGHT');
  await options.preflight?.();

  const consent =
    options.consent ??
    (async () => {
      if (!options.yes) await confirmFileStore();
    });
  options.onStage?.('CONSENT');
  await consent();

  // Serialize the entire consume/authorize/write sequence for this root. A process
  // that did not acquire the token must never release another process's lock.
  options.onStage?.('LOCK');
  await ensurePrivateDir(workspaceLocalDir(root));
  const rootLock = await acquireFileLock(initLockPath(root), {
    waitMs: 0,
    lockLabel: '.workmesh/local/init.lock',
    busyMessage:
      '另一个 init 持有锁或中断后留下锁；本次未消费接入码。确认没有相关 CLI 进程运行后，才可人工清理残留锁。',
  }).catch((error: unknown) => {
    const failure = asCliError(error);
    if (failure.details?.reasonCode) throw failure;
    throw new CliError('WORKSPACE_INIT_IN_PROGRESS', failure.message, {
      details: { ...(failure.details ?? {}), enrollmentConsumed: false },
    });
  });
  let rootOperationFailure: CliError | undefined;
  let rootOperationResult: WorkspaceInitApplied | undefined;
  let enrollmentConsumed = false;
  try {
    // Another process could have completed after the initial preflight.
    await assertRootAvailable(root, { platform, role, host });

    const createClient = options.clientFactory ?? defaultClientFactory;
    const anonymous = createClient({ platform });
    let enrolled: EnrolledProject;
    try {
      // 匿名消费：不带任何 bearer；接入码一次性、不授予额外权限。
      options.onStage?.('ENROLLMENT');
      enrolled = (await anonymous.consumeEnrollmentCode(joinCode)).data;
      enrollmentConsumed = true;
    } catch (error) {
      const failure = enrollmentFailure(error);
      if (typeof failure.details?.enrollmentConsumed === 'boolean') throw failure;
      throw new CliError(
        failure.code,
        `${failure.message}\n无法确认接入码是否已被服务端消费；请回 Web 重新生成接入码后重试。`,
        {
          exitCode: failure.exitCode,
          status: failure.status,
          details: { ...(failure.details ?? {}), enrollmentConsumptionUnknown: true },
          requestId: failure.requestId,
        },
      );
    }

    const login = options.login ?? deviceLogin;
    let granted: Awaited<ReturnType<typeof login>>;
    const loginAbort = new AbortController();
    const onSigint = () =>
      loginAbort.abort(new CliError('USER_INTERRUPTED', '设备授权已中断', { exitCode: 130 }));
    // Node exits immediately on SIGINT when no listener owns the signal. During device login,
    // convert it to a typed cancellation so the consumed one-time enrollment can be reported.
    process.once('SIGINT', onSigint);
    try {
      options.onStage?.('AUTHORIZATION');
      const reusable = await (options.findReusableCredential ?? findReusableCredential)({
        platform,
        configHome: options.configHome,
        projectId: enrolled.projectId,
        roleKey: role,
        fetch: options.fetch,
        now: (options.now?.() ?? new Date()).getTime(),
      });
      if (reusable)
        options.onNotice?.('已在线验证并复用当前平台、项目和角色的有效凭据，无需重复浏览器授权。');
      granted = reusable
        ? { credential: reusable, credentialPath: '', requestId: '' }
        : await login({
            platform,
            configHome: options.configHome,
            projectId: enrolled.projectId,
            roleKey: role,
            clientName: options.clientName ?? 'workmesh-workspace-init',
            timeoutMs: options.timeoutMs,
            fetch: options.fetch,
            signal: loginAbort.signal,
            onPrompt:
              options.onPrompt ??
              ((prompt) => {
                process.stderr.write(`在浏览器打开：${prompt.url}\n输入代码：${prompt.userCode}\n`);
                process.stderr.write(`有效期至 ${prompt.expiresAt}；CLI 会每 5 秒检查一次。\n`);
              }),
            onNotice: options.onNotice ?? ((text) => process.stderr.write(`${text}\n`)),
          });
    } catch (error) {
      const failure = asCliError(error);
      throw new CliError(
        failure.code,
        `${failure.message}\n接入码已消费且不可复用；请回 Web 重新生成接入码后重试。`,
        {
          exitCode: failure.exitCode,
          status: failure.status,
          details: { ...(failure.details ?? {}), enrollmentConsumed: true },
          requestId: failure.requestId,
        },
      );
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
    if (granted.credential.projectId !== enrolled.projectId)
      throw new CliError(
        'PROJECT_MISMATCH',
        `浏览器批准的项目 ${granted.credential.projectId} 与接入码项目 ${enrolled.projectId} 不一致；已中止，接入码已消费，请回 Web 重新生成。`,
        {
          details: {
            expectedProjectId: enrolled.projectId,
            actualProjectId: granted.credential.projectId,
            enrollmentConsumed: true,
          },
        },
      );
    if (granted.credential.roleKey !== role)
      throw new CliError(
        'ROLE_MISMATCH',
        `授权角色与 --role ${role} 不一致；请重新接入并选择目标角色。`,
      );

    const authed = createClient({ platform, bearer: bearerOf(granted.credential) });
    let revision: ResolvedWorkspaceDefinition;
    let digestMatchesPayload: boolean;
    try {
      // 按接入码绑定的 revisionId 取精确 revision；绝不回退当前 revision。
      options.onStage?.('DEFINITION');
      const response = await authed.getWorkspaceDefinitionRevision(
        enrolled.projectId,
        enrolled.definitionRevisionId,
      );
      if (response.payloadPresent !== true)
        throw new CliError(
          'CONTENT_INTEGRITY_FAILED',
          'revision 缺少 payload，拒绝将其视为已验证；接入码已消费，请回 Web 重新生成。',
          {
            details: { enrollmentConsumed: true },
          },
        );
      revision = response.revision;
      digestMatchesPayload = response.digestMatchesPayload;
    } catch (error) {
      const failure = asCliError(error);
      if (failure.code === 'PROJECT_MISMATCH' || failure.code === 'CONTENT_INTEGRITY_FAILED')
        throw failure;
      throw new CliError(
        failure.code === 'RESOURCE_NOT_FOUND' || failure.status === 404 || failure.status === 410
          ? 'CONTENT_UNAVAILABLE'
          : failure.code,
        `无法读取接入码绑定的精确 revision（${enrolled.definitionRevisionId}）；接入码已消费，请回 Web 重新生成。${failure.message}`,
        {
          status: failure.status,
          details: { revisionId: enrolled.definitionRevisionId, enrollmentConsumed: true },
          requestId: failure.requestId,
        },
      );
    }
    assertRevisionMatchesEnrollment(revision, digestMatchesPayload, enrolled);

    const now = options.now?.() ?? new Date();
    const nowIso = now.toISOString();
    const workspaceId = randomUUID();
    const warnings = revision.validation.issues.map(
      (issue) => `定义读取校验 ${issue.code} @ ${issue.path}：${issue.message}`,
    );
    if (!revision.validation.valid)
      warnings.push('已发布定义存在读取期校验问题；本机写入绑定但不宣称仓库已验证。');
    const repositories = bindingsFromRevision(revision, warnings);
    const config: WorkspaceConfigV2 = {
      schemaVersion: '2.0',
      workspaceId,
      platform,
      projectId: enrolled.projectId,
      definition: { revisionId: revision.revisionId, sha256: revision.digest },
      layout: { kind: revision.payload.layoutKind },
      repositories,
      defaults: { profile: 'default', host, roleKey: role },
    };
    // 写前自校验：schema、路径与摘要均为服务端返回值，不含本机绝对路径。
    parseWorkspaceConfigV2(JSON.parse(serializeWorkspaceConfigV2(config)) as unknown);
    const planDigest = await workspaceInitPlanDigestOf(config, revision.revisionId);

    const pendingPath = pendingInitPath(root);
    let configWritten = false;
    let indexWritten = false;
    try {
      await writePrivateFile(
        pendingPath,
        `${JSON.stringify(
          {
            schemaVersion: '1.0',
            workspaceId,
            projectId: enrolled.projectId,
            platform,
            definitionRevisionId: revision.revisionId,
            definitionDigest: revision.digest,
            planDigest,
            createdAt: nowIso,
          },
          null,
          2,
        )}\n`,
      );

      options.onStage?.('WORKSPACE');
      await saveWorkspaceConfigV2(root, config);
      configWritten = true;
      if (options.__testFailAt === 'WORKSPACE')
        throw new CliError('WORKSPACE_WRITE_FAILED', '注入的写盘失败（workspace.json 之后）');

      if (options.__testFailAt === 'INDEX')
        throw new CliError('WORKSPACE_WRITE_FAILED', '注入的写盘失败（用户索引）');
      const canonicalRoot = await canonicalWorkspaceRoot(root);
      options.onStage?.('INDEX');
      await updateUserIndex(
        options.configHome,
        (index) =>
          upsertUserWorkspace(index, {
            workspaceId,
            root: canonicalRoot,
            projectId: config.projectId,
            platform,
            updatedAt: nowIso,
          }),
        undefined,
        options.__testFailAt === 'INDEX_LOCK_RELEASE'
          ? {
              releaseLock: async () => {
                throw new Error('注入的索引锁释放失败');
              },
            }
          : undefined,
      );
      indexWritten = true;

      // 定义缓存是派生数据：失败只告警，不产生半份 workspace.json。
      let cacheWritten = false;
      try {
        options.onStage?.('CACHE');
        if (options.__testFailAt === 'CACHE')
          throw new CliError('WORKSPACE_WRITE_FAILED', '注入的定义缓存写入失败');
        await saveDefinitionCache(root, definitionCacheFromRevision(revision, nowIso));
        cacheWritten = true;
      } catch (error) {
        warnings.push(
          `离线能力未就绪：定义缓存写入失败（在线运行 workspace bind 可刷新缓存）：${asCliError(error).message}`,
        );
      }

      if (options.__testFailAt === 'PENDING_REMOVE')
        throw Object.assign(new Error('注入的 pending 删除失败'), { code: 'EACCES' });
      await rm(pendingPath, { force: true });
      rootOperationResult = {
        mode: 'applied',
        workspaceId,
        projectId: config.projectId,
        projectName: enrolled.projectName,
        platform,
        definition: { revisionId: revision.revisionId, digest: revision.digest },
        layoutKind: config.layout.kind,
        repositories: config.repositories.map((repository) => ({
          key: repository.key,
          projectRepositoryId: repository.projectRepositoryId,
          path: repository.path,
        })),
        repositoryVerification: 'NOT_VERIFIED',
        verificationText:
          '仓库身份为 HUMAN 声明（DECLARED），未由托管方核验；bind 前不宣称已就绪。',
        credential: {
          credentialId: granted.credential.credentialId,
          scopes: granted.credential.scopes,
          expiresAt: granted.credential.expiresAt,
        },
        files: [
          '.workmesh/workspace.json',
          ...(cacheWritten ? [`.workmesh/definitions/${revision.revisionId}.json`] : []),
        ],
        userIndex: userIndexLabel(),
        warnings,
        nextActions: [
          '请先进入 --root 指定的本地工作区根目录，再执行以下命令。',
          'workmesh workspace status',
          ...(config.layout.kind !== 'NONE'
            ? [
                'workmesh workspace discover --root .',
                '根据 discover 的仓库 ID 与真实代码目录执行 workmesh workspace bind --repository <projectRepositoryId> --path <dir>，完成仓库绑定验证。',
              ]
            : []),
          `workmesh setup --role ${role} --host ${host}（安装角色资源；有效凭据将复用）`,
          `workmesh doctor --role ${role} --online`,
        ],
      };
    } catch (error) {
      const failure = asCliError(error);
      if (isUserIndexCommittedError(error)) {
        indexWritten = true;
        throw new CliError(
          'WORKSPACE_WRITE_FAILED',
          `${failure.message}\n接入码已消费；workspace.json 和用户索引已提交并保留，无需重新执行 init。请检查索引锁及 pending 记录后继续。`,
          {
            details: {
              ...(failure.details ?? {}),
              enrollmentConsumed: true,
              rollback: 'none',
              pendingInit: '.workmesh/local/pending-init.json',
              recovery:
                'workspace.json 和用户索引已提交并保留；请检查残留锁及 pending 记录后继续。',
            },
          },
        );
      }
      if (configWritten && indexWritten) {
        // Both authoritative files are already committed. A later cleanup failure is
        // recoverable without re-consuming a one-time code or replacing the workspace.
        const originalCode =
          error instanceof Error &&
          'code' in error &&
          typeof error.code === 'string' &&
          error.code.length > 0
            ? error.code
            : failure.code;
        throw new CliError(
          originalCode,
          `${failure.message}\nworkspace.json 和用户索引已提交并保留；无需重新生成接入码或重新执行 init。运行 workmesh workspace recover 预览；精确一致且取得全部写锁后，可用 --apply 清理 pending。`,
          {
            status: failure.status,
            exitCode: failure.exitCode,
            requestId: failure.requestId,
            details: {
              ...(failure.details ?? {}),
              enrollmentConsumed: true,
              workspaceCommitted: true,
              indexCommitted: true,
              rollback: 'none',
              pendingInit: '.workmesh/local/pending-init.json',
              recovery:
                '配置已提交；运行 workmesh workspace recover 预览，再用 --apply 清理精确匹配的已提交 pending（不会手动删除或自动删除活动锁）。',
            },
          },
        );
      }
      let rollback: 'none' | 'removed-half-config' | 'remove-failed' = 'none';
      if (configWritten && !indexWritten) {
        try {
          await rm(workspaceV2Path(root), { force: true });
          rollback = 'removed-half-config';
        } catch {
          rollback = 'remove-failed';
        }
      }
      if (failure.code === 'WORKSPACE_INIT_IN_PROGRESS' || failure.code === 'PROJECT_MISMATCH')
        throw failure;
      throw new CliError(
        'WORKSPACE_WRITE_FAILED',
        `${failure.message}\n接入码已使用且不可复用；请回 Web 重新生成接入码后重试。pending-init 保留用于诊断。`,
        {
          details: {
            ...(failure.details ?? {}),
            enrollmentConsumed: true,
            rollback,
            pendingInit: '.workmesh/local/pending-init.json',
            recovery:
              rollback === 'removed-half-config'
                ? '已清理半份 workspace.json；用户索引与既有配置未被覆盖。'
                : rollback === 'remove-failed'
                  ? '半份 workspace.json 未能自动清理；请人工检查后再重试。'
                  : indexWritten
                    ? 'workspace.json 和用户索引已提交并保留；请检查残留锁及 pending 记录后继续。'
                    : '尚未写入 workspace.json。',
          },
        },
      );
    }
  } catch (error) {
    const failure = asCliError(error);
    rootOperationFailure =
      enrollmentConsumed && failure.details?.enrollmentConsumed !== true
        ? new CliError(
            failure.code,
            `${failure.message}\n接入码已消费且不可复用；请回 Web 重新生成接入码后重试。`,
            {
              exitCode: failure.exitCode,
              status: failure.status,
              details: { ...(failure.details ?? {}), enrollmentConsumed: true },
              requestId: failure.requestId,
            },
          )
        : failure;
  } finally {
    try {
      await rootLock.release();
    } catch {
      if (!rootOperationFailure) {
        rootOperationFailure = new CliError(
          'WORKSPACE_WRITE_FAILED',
          '工作区已提交，但 init 锁释放失败；配置与索引已保留。确认没有相关 CLI 进程运行后人工检查锁。',
          {
            details: { enrollmentConsumed: true, lockReleaseFailed: true, indexCommitted: true },
          },
        );
      } else {
        // Preserve the original failure while reporting the additional lock issue.
        rootOperationFailure.message +=
          '\ninit 锁释放失败或所有权已变化；确认没有相关 CLI 进程运行后人工检查锁。';
      }
    }
  }
  if (rootOperationFailure) throw rootOperationFailure;
  if (!rootOperationResult)
    throw new CliError('WORKSPACE_WRITE_FAILED', '工作区初始化未返回结果。');
  options.onStage?.('COMPLETE');
  return rootOperationResult;
}

/** NONE 状态下给 status/discover 的接入建议。 */
export function initSuggestion(root: string): string {
  return `workmesh workspace init --join <code> --root ${workspaceRelativeLabel(root, root)} --api <base> --role <role>`;
}
