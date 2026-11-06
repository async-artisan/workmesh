import { chmod, readFile, readdir, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { CliError, asCliError } from './errors';
import { workspaceConfigPath } from './config';
import type { Platform } from './platform';
import {
  saveUserIndex,
  canonicalWorkspaceRoot,
  updateUserIndex,
  upsertUserWorkspace,
  userIndexLabel,
  type UserIndex,
} from './user-index';
import { ensurePrivateDir } from './private-fs';
import {
  backupTimestamp,
  configNotFoundError,
  detectWorkspaceState,
  dualConfigError,
  loadWorkspaceConfigV2,
  migrationJournalPath,
  parseWorkspaceConfigV2,
  readDefinitionCache,
  saveWorkspaceConfigV2,
  serializeWorkspaceConfigV2,
  workspaceBackupPath,
  workspaceLocalDir,
  workspaceV2Path,
  writeMigrationJournal,
  type MigrationJournal,
  type MigrationPhase,
  type WorkspaceConfigV2,
  type WorkspaceLayoutKind,
  type WorkspaceRepositoryBinding,
  type WorkspaceSnapshot,
  type WorkspaceState,
} from './workspace-config';

export type MigrationWrite = {
  path: string;
  action: 'CREATE' | 'REPLACE' | 'ARCHIVE' | 'REMOVE';
};

export type MigrationDeps = {
  now?: () => Date;
  /** 测试注入：在对应步骤之后强制失败，验证恢复路径。 */
  failAt?: 'BACKUP' | 'V2' | 'ARCHIVE' | 'INDEX';
  saveIndex?: (home: string, index: UserIndex) => Promise<string>;
  /** 测试注入：模拟同目录原子 rename 的权限/文件系统错误。 */
  rename?: (source: string, target: string) => Promise<void>;
};

type MigrationContext = {
  root: string;
  configHome: string;
  deps: MigrationDeps;
  now: Date;
};

function context(input: {
  root: string;
  configHome: string;
  deps?: MigrationDeps;
}): MigrationContext {
  return {
    root: input.root,
    configHome: input.configHome,
    deps: input.deps ?? {},
    now: input.deps?.now?.() ?? new Date(),
  };
}

function journalLabel(): string {
  return '.workmesh/local/migrate-journal.json';
}

function backupLabelOf(path: string): string {
  return `.workmesh/${path.split(/[\\/]/).pop() ?? 'config.v1.bak.json.bak'}`;
}

function workspaceLabel(): string {
  return '.workmesh/workspace.json';
}

function v1Label(): string {
  return '.workmesh/config.json';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

function maybeFail(deps: MigrationDeps, stage: 'BACKUP' | 'V2' | 'ARCHIVE' | 'INDEX'): void {
  if (deps.failAt === stage)
    throw new CliError('WORKSPACE_WRITE_FAILED', `注入的写盘失败（阶段 ${stage}）`, {
      details: { stage },
    });
}

function bytesDigest(raw: Uint8Array): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function archiveV1Atomically(
  deps: MigrationDeps,
  source: string,
  target: string,
): Promise<void> {
  if (await pathExists(target))
    throw new CliError('WORKSPACE_WRITE_FAILED', 'v1 归档目标已存在；拒绝覆盖已有备份');
  await (deps.rename ?? rename)(source, target);
  // rename 保留原文件的模式；归档配置仍应保持私有权限。
  await chmod(target, 0o600);
}

/**
 * v1 只迁移 8 个字段：project/platform/profile/role/host 与单仓库映射。
 * 没有可迁移的已发布定义引用，因此 definition = null（MIGRATED 配置专用），
 * 不猜测 revision/digest，也不把目录名当作仓库身份。
 */
export function buildMigratedWorkspaceConfig(
  v1: NonNullable<WorkspaceSnapshot['v1']['value']>,
  workspaceId: string,
): WorkspaceConfigV2 {
  const repositories: WorkspaceRepositoryBinding[] = v1.repositoryId
    ? [
        {
          key: 'legacy-repository',
          projectRepositoryId: v1.repositoryId,
          path: '.',
          remote: 'origin',
          needsRevalidation: true,
        },
      ]
    : [];
  const layoutKind: WorkspaceLayoutKind = v1.repositoryId ? 'SINGLE_ROOT' : 'NONE';
  return {
    schemaVersion: '2.0',
    workspaceId,
    platform: v1.platform,
    projectId: v1.projectId,
    definition: null,
    layout: { kind: layoutKind },
    repositories,
    defaults: { profile: v1.profile, host: v1.host, roleKey: v1.roleKey },
  };
}

function assertPlanValid(config: WorkspaceConfigV2): WorkspaceConfigV2 {
  const serialized = serializeWorkspaceConfigV2(config);
  return parseWorkspaceConfigV2(JSON.parse(serialized) as unknown, {
    allowNullDefinition: true,
  });
}

async function ensureMigrationIndex(
  ctx: MigrationContext,
  config: WorkspaceConfigV2,
): Promise<void> {
  const canonicalRoot = await canonicalWorkspaceRoot(ctx.root);
  try {
    await updateUserIndex(
      ctx.configHome,
      (index) =>
        upsertUserWorkspace(index, {
          workspaceId: config.workspaceId,
          root: canonicalRoot,
          projectId: config.projectId,
          platform: config.platform,
          updatedAt: ctx.now.toISOString(),
        }),
      ctx.deps.saveIndex ?? saveUserIndex,
    );
  } catch (error) {
    const failure = asCliError(error);
    if (failure.code === 'INTERNAL_ERROR')
      throw new CliError('WORKSPACE_WRITE_FAILED', `写入用户索引失败：${failure.message}`, {
        details: failure.details,
      });
    throw failure;
  }
}

/**
 * Complete the recoverable tail of migration. The target name and v2 digest
 * are already journaled before this function is allowed to rename v1.
 */
async function finishMigration(
  ctx: MigrationContext,
  initialJournal: MigrationJournal,
  config: WorkspaceConfigV2,
  writes: MigrationWrite[],
): Promise<MigrationJournal> {
  if (!initialJournal.backupFile || !initialJournal.v2Digest)
    throw new CliError('WORKSPACE_CONTEXT_STALE', '迁移 journal 缺少备份位置或 v2 摘要，不能恢复');
  const backupPath = workspaceBackupPath(ctx.root, initialJournal.backupFile);
  const v1Path = workspaceConfigPath(ctx.root);
  let journal = initialJournal;
  const persistJournal = async (next: MigrationJournal): Promise<void> => {
    journal = next;
    await writeMigrationJournal(ctx.root, next);
  };

  if (await pathExists(v1Path)) {
    await archiveV1Atomically(ctx.deps, v1Path, backupPath);
    writes.push({ path: v1Label(), action: 'ARCHIVE' });
    maybeFail(ctx.deps, 'ARCHIVE');
  } else if (!(await pathExists(backupPath))) {
    throw new CliError('CONTENT_INTEGRITY_FAILED', '活动 v1 与 journal 指定的归档都不存在');
  }
  await chmod(backupPath, 0o600);

  await persistJournal({ ...journal, phase: 'V1_ARCHIVED', updatedAt: ctx.now.toISOString() });
  const afterArchive = await detectWorkspaceState(ctx.root);
  if (
    afterArchive.state !== 'MIGRATED' ||
    afterArchive.v2.digest !== initialJournal.v2Digest ||
    afterArchive.v2.value?.workspaceId !== config.workspaceId
  )
    throw new CliError('CONTENT_INTEGRITY_FAILED', '归档后 v2 或工作区状态与 journal 不一致');

  await ensureMigrationIndex(ctx, config);
  writes.push({ path: userIndexLabel(), action: 'REPLACE' });
  await persistJournal({ ...journal, phase: 'INDEX_WRITTEN', updatedAt: ctx.now.toISOString() });
  maybeFail(ctx.deps, 'INDEX');
  await persistJournal({
    ...journal,
    phase: 'COMMITTED',
    updatedAt: ctx.now.toISOString(),
    error: null,
  });
  writes.push({ path: journalLabel(), action: 'REPLACE' });
  return journal;
}

async function chooseBackupPath(
  root: string,
  now: Date,
  journal: MigrationJournal | null,
): Promise<{ path: string; label: string; reused: boolean }> {
  if (journal?.backupFile) {
    const candidate = workspaceBackupPath(root, journal.backupFile);
    if (!(await pathExists(candidate)))
      return { path: candidate, label: journal.backupFile, reused: true };
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const stamp = attempt === 0 ? backupTimestamp(now) : `${backupTimestamp(now)}-${attempt + 1}`;
    const candidate = workspaceBackupPath(root, stamp);
    if (!(await pathExists(candidate))) return { path: candidate, label: stamp, reused: false };
  }
  throw new CliError('WORKSPACE_WRITE_FAILED', '无法生成唯一的 v1 备份文件名');
}

async function listBackupLabels(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, '.workmesh')))
      .filter((name) => /^config\.v1\..+\.json\.bak$/.test(name))
      .sort()
      .map((name) => `.workmesh/${name}`);
  } catch {
    return [];
  }
}

export type MigrationPlanView = {
  workspaceId: string;
  projectId: string;
  platform: Platform;
  layoutKind: WorkspaceLayoutKind;
  repositories: WorkspaceRepositoryBinding[];
  defaults: { profile: string; host: string; roleKey: string | null };
  backupFile: string;
  definitionRequired: true;
};

export type MigrationDryRunResult = {
  mode: 'dry-run';
  state: WorkspaceState;
  alreadyMigrated: boolean;
  writes: MigrationWrite[];
  wouldWrite: MigrationWrite[];
  plan: MigrationPlanView | null;
  backupFile: string | null;
  nextAction: string;
};

export async function runMigrationDryRun(input: {
  root: string;
  configHome: string;
  deps?: MigrationDeps;
}): Promise<MigrationDryRunResult> {
  const ctx = context(input);
  const snapshot = await detectWorkspaceState(ctx.root);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.state === 'NONE') throw configNotFoundError();
  if (snapshot.v2.exists && !snapshot.v2.valid)
    throw snapshot.v2.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspace.json 结构非法');
  if (snapshot.v2.valid) {
    const backups = await listBackupLabels(ctx.root);
    return {
      mode: 'dry-run',
      state: snapshot.state,
      alreadyMigrated: true,
      writes: [],
      wouldWrite: [],
      plan: null,
      backupFile: backups[0] ?? null,
      nextAction:
        snapshot.state === 'MIGRATED'
          ? '已是 MIGRATED（v1 已归档为 .bak，适配层只读 v2）；无需再次迁移。'
          : '已是 v2 配置；无需迁移。',
    };
  }
  if (!snapshot.v1.valid || !snapshot.v1.value) throw snapshot.v1.error ?? configNotFoundError();
  const v1 = snapshot.v1.value;
  const workspaceId = snapshot.journal?.workspaceId ?? randomUUID();
  const config = assertPlanValid(buildMigratedWorkspaceConfig(v1, workspaceId));
  const backup = await chooseBackupPath(ctx.root, ctx.now, snapshot.journal);
  const plan: MigrationPlanView = {
    workspaceId: config.workspaceId,
    projectId: config.projectId,
    platform: config.platform,
    layoutKind: config.layout.kind,
    repositories: config.repositories,
    defaults: config.defaults,
    backupFile: backup.label,
    definitionRequired: true,
  };
  return {
    mode: 'dry-run',
    state: snapshot.state,
    alreadyMigrated: false,
    writes: [],
    wouldWrite: [
      { path: backupLabelOf(backup.path), action: 'CREATE' },
      { path: workspaceLabel(), action: 'CREATE' },
      { path: journalLabel(), action: 'CREATE' },
      { path: userIndexLabel(), action: 'REPLACE' },
      { path: v1Label(), action: 'ARCHIVE' },
    ],
    plan,
    backupFile: backup.label,
    nextAction: '确认映射无误后运行 workmesh workspace migrate --apply；dry-run 不改写任何文件。',
  };
}

export type MigrationApplyResult = {
  mode: 'apply';
  state: WorkspaceState;
  alreadyMigrated: boolean;
  writes: MigrationWrite[];
  backupFile: string | null;
  journalPhase: MigrationPhase | null;
  nextAction: string;
};

export async function runMigrationApply(input: {
  root: string;
  configHome: string;
  deps?: MigrationDeps;
}): Promise<MigrationApplyResult> {
  const ctx = context(input);
  const snapshot = await detectWorkspaceState(ctx.root);
  if (snapshot.state === 'NONE') throw configNotFoundError();
  if (snapshot.v2.exists && !snapshot.v2.valid)
    throw snapshot.v2.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspace.json 结构非法');
  if (snapshot.state === 'DUAL_ACTIVE') {
    const journal = snapshot.journal;
    const v1 = snapshot.v1.value;
    const v2 = snapshot.v2.value;
    const resumable =
      journal !== null &&
      journal.previousState === 'V1_ONLY' &&
      ['PLANNED', 'V2_WRITTEN', 'FAILED'].includes(journal.phase) &&
      !!journal.backupFile &&
      !!journal.v2Digest &&
      journal.workspaceId === v2?.workspaceId &&
      journal.v2Digest === snapshot.v2.digest &&
      !!v1 &&
      !!v2;
    if (!resumable || !journal || !v1 || !v2) throw dualConfigError(snapshot);
    const expected = assertPlanValid(buildMigratedWorkspaceConfig(v1, journal.workspaceId));
    const actualV2 = await readFile(workspaceV2Path(ctx.root));
    if (!actualV2.equals(Buffer.from(serializeWorkspaceConfigV2(expected), 'utf8')))
      throw dualConfigError(snapshot);

    const backup = await chooseBackupPath(ctx.root, ctx.now, journal);
    const resumedJournal: MigrationJournal = {
      ...journal,
      phase: 'V2_WRITTEN',
      backupFile: backup.label,
      v2Digest: snapshot.v2.digest,
      updatedAt: ctx.now.toISOString(),
      error: null,
    };
    await writeMigrationJournal(ctx.root, resumedJournal);
    const writes: MigrationWrite[] = [{ path: journalLabel(), action: 'REPLACE' }];
    const committed = await finishMigration(ctx, resumedJournal, v2, writes);
    return {
      mode: 'apply',
      state: 'MIGRATED',
      alreadyMigrated: true,
      writes,
      backupFile: committed.backupFile,
      journalPhase: 'COMMITTED',
      nextAction: '已从可验证的 V2_WRITTEN 状态恢复：v1 原子归档，索引与 journal 已补齐。',
    };
  }
  if (snapshot.v2.valid) {
    const journal = snapshot.journal;
    const archiveInterrupted =
      snapshot.state === 'MIGRATED' &&
      !snapshot.v1.exists &&
      journal !== null &&
      journal.previousState === 'V1_ONLY' &&
      journal.workspaceId === snapshot.v2.value?.workspaceId &&
      !!journal.backupFile &&
      !!journal.v2Digest &&
      journal.v2Digest === snapshot.v2.digest &&
      ['V2_WRITTEN', 'V1_ARCHIVED', 'INDEX_WRITTEN', 'FAILED'].includes(journal.phase) &&
      (await pathExists(workspaceBackupPath(ctx.root, journal.backupFile)));
    if (archiveInterrupted && journal && snapshot.v2.value) {
      const writes: MigrationWrite[] = [];
      const committed = await finishMigration(ctx, journal, snapshot.v2.value, writes);
      return {
        mode: 'apply',
        state: 'MIGRATED',
        alreadyMigrated: true,
        writes,
        backupFile: committed.backupFile,
        journalPhase: 'COMMITTED',
        nextAction: '已恢复中断的原子归档记录：v2 与归档 v1 保持不变，索引和 journal 已补齐。',
      };
    }
    return {
      mode: 'apply',
      state: snapshot.state,
      alreadyMigrated: true,
      writes: [],
      backupFile: snapshot.backups[0] ? backupLabelOf(snapshot.backups[0]) : null,
      journalPhase: snapshot.journal?.phase ?? null,
      nextAction:
        snapshot.state === 'MIGRATED'
          ? '已是 MIGRATED；未写入任何文件。'
          : '已是 v2 配置；未写入任何文件。',
    };
  }
  if (!snapshot.v1.valid || !snapshot.v1.value) throw snapshot.v1.error ?? configNotFoundError();
  const v1 = snapshot.v1.value;
  const v1Path = workspaceConfigPath(ctx.root);
  const v2Path = workspaceV2Path(ctx.root);
  const nowIso = ctx.now.toISOString();
  const previousJournal = snapshot.journal;
  const workspaceId = previousJournal?.workspaceId ?? randomUUID();
  const config = assertPlanValid(buildMigratedWorkspaceConfig(v1, workspaceId));
  const backup = await chooseBackupPath(ctx.root, ctx.now, previousJournal);
  const plannedV2Digest = bytesDigest(Buffer.from(serializeWorkspaceConfigV2(config), 'utf8'));
  const writes: MigrationWrite[] = [];
  let journal: MigrationJournal = {
    schemaVersion: '1.0',
    migrationId: previousJournal?.migrationId ?? randomUUID(),
    phase: 'PLANNED',
    workspaceId,
    previousState: 'V1_ONLY',
    v1File: 'config.json',
    v2File: 'workspace.json',
    backupFile: backup.label,
    v2Digest: plannedV2Digest,
    startedAt: previousJournal?.startedAt ?? nowIso,
    updatedAt: nowIso,
    resolution: null,
    error: null,
  };

  const persistJournal = async (next: MigrationJournal): Promise<void> => {
    journal = next;
    await writeMigrationJournal(ctx.root, next);
  };

  try {
    await ensurePrivateDir(workspaceLocalDir(ctx.root));
    await persistJournal(journal);
    writes.push({ path: journalLabel(), action: 'REPLACE' });
    maybeFail(ctx.deps, 'BACKUP');

    await saveWorkspaceConfigV2(ctx.root, config);
    const verified = await loadWorkspaceConfigV2(ctx.root, { allowNullDefinition: true });
    if (verified.workspaceId !== config.workspaceId || verified.projectId !== config.projectId)
      throw new CliError('CONTENT_INTEGRITY_FAILED', '写后校验 v2 配置不一致');
    writes.push({ path: workspaceLabel(), action: 'CREATE' });
    const v2Raw = await readFile(v2Path);
    await persistJournal({
      ...journal,
      phase: 'V2_WRITTEN',
      backupFile: backup.label,
      v2Digest: bytesDigest(v2Raw),
      updatedAt: nowIso,
    });
    maybeFail(ctx.deps, 'V2');

    await finishMigration(ctx, journal, config, writes);
    return {
      mode: 'apply',
      state: 'MIGRATED',
      alreadyMigrated: false,
      writes,
      backupFile: backup.label,
      journalPhase: 'COMMITTED',
      nextAction: '迁移完成：v1 已归档，旧命令通过 v2 适配层继续工作。',
    };
  } catch (error) {
    const failure = asCliError(error);
    const v1StillActive = await pathExists(v1Path);
    const v2Active = await pathExists(v2Path);
    try {
      await persistJournal({
        ...journal,
        phase: 'FAILED',
        backupFile: journal.backupFile ?? backup.label,
        error: { code: failure.code, message: failure.message },
        updatedAt: nowIso,
      });
    } catch {
      // journal 写入失败不覆盖原始错误；文件状态在 details 中报告。
    }
    const recovery =
      v1StillActive && v2Active
        ? 'v1 与有效 v2 均已保留；journal 绑定 v2 摘要，可修复写盘原因后重试 --apply 继续原子归档。'
        : v1StillActive
          ? 'v1 仍为活动配置；可修复写盘原因后重试 --apply。'
          : 'v1 已被原子归档，v2 保持活动；请重试 --apply 补齐索引与 journal。';
    throw new CliError(
      failure.code === 'INTERNAL_ERROR' ? 'WORKSPACE_WRITE_FAILED' : failure.code,
      `${failure.message}\n${recovery}`,
      {
        details: {
          ...(failure.details ?? {}),
          migration: {
            v1StillActive,
            v2Active,
            rolledBack: false,
            journalPhase: journal.phase,
            backupFile: backup.label,
            recovery,
          },
        },
      },
    );
  }
}

export type WorkspaceFileReport = {
  path: string;
  label: string;
  exists: boolean;
  valid: boolean;
  digest: string | null;
  error: { code: string; message: string } | null;
};

export type MigrationInspectResult = {
  mode: 'inspect';
  state: WorkspaceState;
  root: string;
  files: { v1: WorkspaceFileReport; v2: WorkspaceFileReport };
  backups: string[];
  journal: {
    path: string;
    exists: boolean;
    phase: MigrationPhase | null;
    updatedAt: string | null;
    resolution: string | null;
    error: { code: string; message: string } | null;
  };
  consistency: {
    projectIdsMatch: boolean | null;
    platformsMatch: boolean | null;
    v1ProjectId: string | null;
    v2ProjectId: string | null;
  };
  nextAction: string;
  writes: [];
};

function reportOf(
  path: string,
  label: string,
  state: { exists: boolean; valid: boolean; digest: string | null; error: CliError | null },
): WorkspaceFileReport {
  return {
    path,
    label,
    exists: state.exists,
    valid: state.valid,
    digest: state.digest,
    error: state.error ? { code: state.error.code, message: state.error.message } : null,
  };
}

function inspectNextAction(snapshot: WorkspaceSnapshot): string {
  switch (snapshot.state) {
    case 'NONE':
      return '当前没有配置；运行 workmesh workspace init --join 接入项目。';
    case 'V1_ONLY':
      return '运行 workmesh workspace migrate --dry-run 查看映射，再运行 --apply。';
    case 'V2_ONLY':
      return 'v2 配置有效；如需仓库映射运行 workmesh workspace bind。';
    case 'MIGRATED':
      return '迁移完成；v1 备份仅用于人工核对/回滚，任何命令都不读取 .bak。';
    case 'DUAL_ACTIVE':
      return snapshot.journal &&
        ['V2_WRITTEN', 'INDEX_WRITTEN', 'V1_ARCHIVED', 'COMMITTED'].includes(snapshot.journal.phase)
        ? 'journal 处于可收敛阶段：确认 v2 有效后可运行 workmesh workspace migrate --resolve keep-v2（只归档 v1，不读 .bak）。'
        : '缺少可收敛迁移 journal：不要自动收敛；按人工恢复指引处理（不得静默删除活动配置）。';
  }
}

/** 只读诊断：不修改、不删除任何文件。DUAL_ACTIVE 下唯一允许的 migrate 子命令之一。 */
export async function runMigrationInspect(input: {
  root: string;
}): Promise<MigrationInspectResult> {
  const root = input.root;
  const snapshot = await detectWorkspaceState(root);
  if (snapshot.state === 'NONE') throw configNotFoundError();
  const v1 = snapshot.v1.value;
  const v2 = snapshot.v2.value;
  const projectIdsMatch = v1 && v2 ? v1.projectId === v2.projectId : null;
  const platformsMatch =
    v1 && v2
      ? v1.platform.origin === v2.platform.origin &&
        v1.platform.apiBasePath === v2.platform.apiBasePath
      : null;
  return {
    mode: 'inspect',
    state: snapshot.state,
    root,
    files: {
      v1: reportOf(workspaceConfigPath(root), v1Label(), snapshot.v1),
      v2: reportOf(workspaceV2Path(root), workspaceLabel(), snapshot.v2),
    },
    backups: snapshot.backups.map(backupLabelOf),
    journal: {
      path: migrationJournalPath(root),
      exists: snapshot.journal !== null,
      phase: snapshot.journal?.phase ?? null,
      updatedAt: snapshot.journal?.updatedAt ?? null,
      resolution: snapshot.journal?.resolution ?? null,
      error: snapshot.journalError
        ? { code: snapshot.journalError.code, message: snapshot.journalError.message }
        : null,
    },
    consistency: {
      projectIdsMatch,
      platformsMatch,
      v1ProjectId: v1?.projectId ?? null,
      v2ProjectId: v2?.projectId ?? null,
    },
    nextAction: inspectNextAction(snapshot),
    writes: [],
  };
}

const CONVERGIBLE_PHASES: MigrationPhase[] = [
  'V2_WRITTEN',
  'INDEX_WRITTEN',
  'V1_ARCHIVED',
  'FAILED',
];

export type MigrationResolveResult = {
  mode: 'resolve';
  resolution: 'KEEP_V2' | 'KEEP_V1';
  state: WorkspaceState;
  writes: MigrationWrite[];
  archivedV1To: string | null;
  nextAction: string;
};

export async function runMigrationResolve(input: {
  root: string;
  configHome: string;
  mode: 'keep-v2' | 'keep-v1';
  deps?: MigrationDeps;
}): Promise<MigrationResolveResult> {
  const ctx = context(input);
  const snapshot = await detectWorkspaceState(ctx.root);
  if (snapshot.state === 'NONE') throw configNotFoundError();

  if (input.mode === 'keep-v1') {
    return {
      mode: 'resolve',
      resolution: 'KEEP_V1',
      state: snapshot.state,
      writes: [],
      archivedV1To: null,
      nextAction:
        'P0a 不执行破坏性 keep-v1：CLI 未删除任何活动配置。请先人工备份并按 --inspect 指引移除 v2，之后才会回到 V1_ONLY。',
    };
  }

  if (snapshot.v2.valid && !snapshot.v1.exists) {
    const journal = snapshot.journal;
    const recoverable =
      journal !== null &&
      journal.workspaceId === snapshot.v2.value?.workspaceId &&
      (journal.previousState === 'V1_ONLY' || journal.resolution === 'KEEP_V2') &&
      !!journal.backupFile &&
      !!journal.v2Digest &&
      journal.v2Digest === snapshot.v2.digest &&
      ['V2_WRITTEN', 'V1_ARCHIVED', 'INDEX_WRITTEN', 'FAILED'].includes(journal.phase) &&
      (await pathExists(workspaceBackupPath(ctx.root, journal.backupFile)));
    if (recoverable && journal && snapshot.v2.value) {
      const writes: MigrationWrite[] = [];
      const committed = await finishMigration(ctx, journal, snapshot.v2.value, writes);
      return {
        mode: 'resolve',
        resolution: 'KEEP_V2',
        state: 'MIGRATED',
        writes,
        archivedV1To: committed.backupFile ? `.workmesh/${committed.backupFile}` : null,
        nextAction: '已恢复 keep-v2 的中断提交：v2 未变，索引与 journal 已补齐。',
      };
    }
    return {
      mode: 'resolve',
      resolution: 'KEEP_V2',
      state: snapshot.state,
      writes: [],
      archivedV1To: snapshot.backups[0] ? backupLabelOf(snapshot.backups[0]) : null,
      nextAction: '已是单一 v2 配置；未写入任何文件。',
    };
  }
  if (snapshot.state !== 'DUAL_ACTIVE')
    throw new CliError(
      'WORKSPACE_DUAL_CONFIG',
      `当前状态为 ${snapshot.state}，不是 DUAL_ACTIVE；--resolve keep-v2 只用于收敛双配置冲突。`,
      { details: { state: snapshot.state } },
    );
  if (!snapshot.v2.valid || !snapshot.v2.value)
    throw (
      snapshot.v2.error ??
      new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspace.json 结构非法，keep-v2 被拒绝')
    );
  if (!snapshot.v1.valid || !snapshot.v1.value)
    throw snapshot.v1.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'config.json 结构非法');

  const v2 = snapshot.v2.value;
  const v1 = snapshot.v1.value;
  if (
    v1.projectId !== v2.projectId ||
    v1.platform.origin !== v2.platform.origin ||
    v1.platform.apiBasePath !== v2.platform.apiBasePath
  )
    throw new CliError(
      'WORKSPACE_CONTEXT_STALE',
      'keep-v2 被拒绝：v2 的 projectId/platform 与活动 v1 不一致，不能自动选择权威配置；请人工恢复。',
      {
        details: {
          v1ProjectId: v1.projectId,
          v2ProjectId: v2.projectId,
          v1Platform: v1.platform,
          v2Platform: v2.platform,
        },
      },
    );

  const journal = snapshot.journal;
  const journalUsable =
    journal !== null &&
    journal.workspaceId === v2.workspaceId &&
    journal.previousState === 'V1_ONLY' &&
    CONVERGIBLE_PHASES.includes(journal.phase);
  if (!journalUsable || !journal)
    throw new CliError(
      'WORKSPACE_DUAL_CONFIG',
      'keep-v2 被拒绝：缺少可收敛的迁移 journal（或 phase 不在可收敛阶段）；不删除任何活动配置，请人工恢复。',
      {
        details: {
          journalExists: journal !== null,
          journalPhase: journal?.phase ?? null,
          journalWorkspaceId: journal?.workspaceId ?? null,
          v2WorkspaceId: v2.workspaceId,
        },
      },
    );

  if (!journal.v2Digest || journal.v2Digest !== snapshot.v2.digest)
    throw new CliError(
      'WORKSPACE_CONTEXT_STALE',
      'keep-v2 被拒绝：活动 workspace.json 与 journal 记录的原始文件摘要不一致，可能已被修改；不删除任何活动配置。',
      {
        details: {
          expectedV2Digest: journal.v2Digest ?? null,
          actualV2Digest: snapshot.v2.digest,
        },
      },
    );

  // schema/digest 校验：若 v2 带定义引用且本机有 revision 缓存，二者摘要必须一致。
  if (v2.definition) {
    const cached = await readDefinitionCache(ctx.root, v2.definition.revisionId);
    if (cached.exists && (!cached.cache || cached.cache.digest !== v2.definition.sha256))
      throw new CliError(
        'WORKSPACE_CONTEXT_STALE',
        'keep-v2 被拒绝：v2 的定义引用与本地 revision 缓存摘要不一致；不删除任何活动配置，请人工恢复。',
        {
          details: {
            definitionRevisionId: v2.definition.revisionId,
            bindingDigest: v2.definition.sha256,
            cacheDigest: cached.cache?.digest ?? null,
            cacheError: cached.error?.code ?? null,
          },
        },
      );
  }

  const backup = await chooseBackupPath(ctx.root, ctx.now, journal);
  const writes: MigrationWrite[] = [];
  const resolvingJournal: MigrationJournal = {
    ...journal,
    phase: 'V2_WRITTEN',
    resolution: 'KEEP_V2',
    backupFile: backup.label,
    v2Digest: snapshot.v2.digest,
    updatedAt: ctx.now.toISOString(),
    error: null,
  };
  await writeMigrationJournal(ctx.root, resolvingJournal);
  writes.push({ path: journalLabel(), action: 'REPLACE' });
  const committed = await finishMigration(ctx, resolvingJournal, v2, writes);
  return {
    mode: 'resolve',
    resolution: 'KEEP_V2',
    state: 'MIGRATED',
    writes,
    archivedV1To: committed.backupFile
      ? `.workmesh/${committed.backupFile}`
      : backupLabelOf(backup.path),
    nextAction: '已收敛为单一 v2 配置（MIGRATED）；.bak 仅用于人工核对，任何命令都不读取。',
  };
}
