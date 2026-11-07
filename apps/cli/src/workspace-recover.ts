import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isUuid } from './config';
import { CliError } from './errors';
import { platformFromParts, type Platform } from './platform';
import {
  acquireFileLock,
  canonicalWorkspaceRoot,
  gitRootKey,
  loadUserIndex,
  userIndexPath,
  type FileLock,
} from './user-index';
import {
  detectWorkspaceState,
  initLockPath,
  pendingInitPath,
  resolveWorkspaceRoot,
  serializeWorkspaceConfigV2,
  workspaceLocalDir,
  workspaceV2Path,
  type WorkspaceConfigV2,
} from './workspace-config';

export type PendingWorkspaceInit = {
  schemaVersion: '1.0';
  workspaceId: string;
  projectId: string;
  platform: Platform;
  definitionRevisionId: string;
  definitionDigest: string;
  planDigest: string;
  createdAt: string;
};

export type WorkspaceRecoverState =
  | 'NO_PENDING'
  | 'COMMITTED_PENDING'
  | 'INCOMPLETE'
  | 'MISMATCH'
  | 'INVALID_PENDING'
  | 'LOCKED'
  | 'CLEANED';

export type WorkspaceRecoverReport = {
  mode: 'preview' | 'applied';
  state: WorkspaceRecoverState;
  root: '.';
  pending: { exists: boolean; valid: boolean; label: '.workmesh/local/pending-init.json' };
  workspaceId: string | null;
  projectId: string | null;
  checks: { workspace: boolean; userIndex: boolean; planDigest: boolean };
  locks: { init: boolean; bind: boolean; userIndex: boolean };
  cleanupAllowed: boolean;
  reasonCodes: string[];
  writes: string[];
  nextAction: string;
};

export type WorkspaceRecoverOptions = {
  root: string;
  configHome: string;
  /** Default is strictly read-only. Apply only removes a proven committed pending record. */
  apply?: boolean;
};

/** Hash the exact normalized workspace plan written by init; no join code or credential is stored. */
export async function workspaceInitPlanDigestOf(
  config: WorkspaceConfigV2,
  revisionId: string,
): Promise<string> {
  const configDigest = await sha256Bytes(
    new TextEncoder().encode(serializeWorkspaceConfigV2(config)),
  );
  return sha256Bytes(
    new TextEncoder().encode(
      canonicalJson({
        workspaceId: config.workspaceId,
        projectId: config.projectId,
        definitionRevisionId: revisionId,
        configDigest,
      }),
    ),
  );
}

function parsePending(value: unknown): PendingWorkspaceInit {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid pending');
  const record = value as Record<string, unknown>;
  const allowed = [
    'schemaVersion',
    'workspaceId',
    'projectId',
    'platform',
    'definitionRevisionId',
    'definitionDigest',
    'planDigest',
    'createdAt',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw new Error('invalid pending');
  const platform = record.platform as Record<string, unknown> | undefined;
  if (
    record.schemaVersion !== '1.0' ||
    !isUuid(record.workspaceId) ||
    !isUuid(record.projectId) ||
    !isUuid(record.definitionRevisionId) ||
    typeof record.definitionDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.definitionDigest) ||
    typeof record.planDigest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(record.planDigest) ||
    typeof record.createdAt !== 'string' ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    !platform ||
    Array.isArray(platform) ||
    typeof platform !== 'object' ||
    Object.keys(platform).some((key) => !['origin', 'apiBasePath'].includes(key)) ||
    typeof platform.origin !== 'string' ||
    typeof platform.apiBasePath !== 'string'
  )
    throw new Error('invalid pending');
  const parsedPlatform = platformFromParts(platform.origin, platform.apiBasePath);
  if (
    parsedPlatform.origin !== platform.origin ||
    parsedPlatform.apiBasePath !== platform.apiBasePath
  )
    throw new Error('invalid pending');
  return {
    schemaVersion: '1.0',
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    platform: parsedPlatform,
    definitionRevisionId: record.definitionRevisionId,
    definitionDigest: record.definitionDigest,
    planDigest: record.planDigest,
    createdAt: record.createdAt,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new CliError(
      'WORKSPACE_WRITE_FAILED',
      '无法读取恢复检查所需的本机文件；请检查目录权限。',
    );
  }
}

function samePlatform(a: Platform, b: Platform): boolean {
  return a.origin === b.origin && a.apiBasePath === b.apiBasePath;
}

type Inspection = { report: WorkspaceRecoverReport; pendingRaw?: string };

async function inspect(
  root: string,
  configHome: string,
  ignoreOwnedLocks = false,
): Promise<Inspection> {
  const paths = {
    init: initLockPath(root),
    bind: join(workspaceLocalDir(root), 'bind.lock'),
    userIndex: join(configHome, 'workspaces', 'index.lock'),
  };
  const report: WorkspaceRecoverReport = {
    mode: 'preview',
    state: 'NO_PENDING',
    root: '.',
    pending: {
      exists: await exists(pendingInitPath(root)),
      valid: false,
      label: '.workmesh/local/pending-init.json',
    },
    workspaceId: null,
    projectId: null,
    checks: { workspace: false, userIndex: false, planDigest: false },
    locks: {
      init: !ignoreOwnedLocks && (await exists(paths.init)),
      bind: !ignoreOwnedLocks && (await exists(paths.bind)),
      userIndex: !ignoreOwnedLocks && (await exists(paths.userIndex)),
    },
    cleanupAllowed: false,
    reasonCodes: [],
    writes: [],
    nextAction: '没有 pending 初始化记录；运行 workmesh workspace status 查看当前绑定。',
  };
  const locked = Object.values(report.locks).some(Boolean);
  if (!report.pending.exists) {
    if (locked) {
      report.state = 'LOCKED';
      report.reasonCodes = ['LOCK_PRESENT'];
      report.nextAction =
        '发现 init/bind/用户索引锁；等待持锁命令结束。若进程已中断，请先核实进程与锁的归属；恢复命令不会删除残留锁。';
    }
    return { report };
  }
  let pending: PendingWorkspaceInit;
  let pendingRaw: string;
  try {
    const info = await lstat(pendingInitPath(root));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('not a regular file');
    pendingRaw = await readFile(pendingInitPath(root), 'utf8');
    pending = parsePending(JSON.parse(pendingRaw));
  } catch {
    report.state = 'INVALID_PENDING';
    report.reasonCodes = ['PENDING_INVALID_OR_LEGACY'];
    report.nextAction =
      'pending 记录损坏、为链接或缺少平台证明（旧版本）；保留记录与配置，人工核对工作区和用户索引。本命令不能自动恢复授权或重新消费一次性码。';
    return { report };
  }
  report.pending.valid = true;
  report.workspaceId = pending.workspaceId;
  report.projectId = pending.projectId;
  const snapshot = await detectWorkspaceState(root);
  if (snapshot.state !== 'V2_ONLY' && snapshot.state !== 'MIGRATED') {
    report.state = snapshot.state === 'NONE' ? 'INCOMPLETE' : 'MISMATCH';
    report.reasonCodes.push(
      snapshot.state === 'NONE' ? 'WORKSPACE_NOT_COMMITTED' : 'WORKSPACE_STATE_CONFLICT',
    );
  } else if (
    !snapshot.v2.value ||
    !(await lstat(workspaceV2Path(root))).isFile() ||
    (await lstat(workspaceV2Path(root))).isSymbolicLink()
  ) {
    report.state = 'MISMATCH';
    report.reasonCodes.push('WORKSPACE_INVALID');
  } else {
    const config = snapshot.v2.value;
    report.checks.workspace =
      config.workspaceId === pending.workspaceId &&
      config.projectId === pending.projectId &&
      samePlatform(config.platform, pending.platform) &&
      config.definition?.revisionId === pending.definitionRevisionId &&
      config.definition.sha256 === pending.definitionDigest;
    report.checks.planDigest =
      pending.planDigest ===
      (await workspaceInitPlanDigestOf(config, pending.definitionRevisionId));
    if (!report.checks.workspace) report.reasonCodes.push('WORKSPACE_PENDING_MISMATCH');
    if (!report.checks.planDigest) report.reasonCodes.push('PLAN_DIGEST_MISMATCH');
    try {
      const indexInfo = await lstat(userIndexPath(configHome));
      if (!indexInfo.isFile() || indexInfo.isSymbolicLink()) throw new Error('index not regular');
      const index = await loadUserIndex(configHome);
      const entry = index.workspaces[pending.workspaceId];
      const canonicalRoot = await canonicalWorkspaceRoot(root);
      report.checks.userIndex =
        !!entry &&
        gitRootKey(entry.root) === gitRootKey(canonicalRoot) &&
        entry.projectId === pending.projectId &&
        samePlatform(entry.platform, pending.platform);
      if (!report.checks.userIndex) report.reasonCodes.push('USER_INDEX_PENDING_MISMATCH');
    } catch {
      report.reasonCodes.push('USER_INDEX_MISSING_OR_INVALID');
    }
    report.state = Object.values(report.checks).every(Boolean) ? 'COMMITTED_PENDING' : 'MISMATCH';
  }
  report.cleanupAllowed = report.state === 'COMMITTED_PENDING' && !locked;
  report.nextAction = report.cleanupAllowed
    ? '配置和用户索引与 pending 精确一致；运行 workmesh workspace recover --root . --apply，仅清理已提交的 pending 记录，无需接入码。'
    : '初始化未完成或提交证据不一致；保留 pending、workspace.json 和用户索引，运行 workspace status 核对。本命令不自动续接授权；一次性码不可重用，人工确认后从 Web 生成新码处理。';
  if (locked) {
    report.state = 'LOCKED';
    report.reasonCodes.push('LOCK_PRESENT');
    report.nextAction =
      '发现 init/bind/用户索引锁；等待持锁命令结束。若进程已中断，请先核实进程与锁的归属；恢复命令不会删除残留锁。';
  }
  return { report, pendingRaw };
}

/** Local-only recovery: preview by default, never resumes login or consumes a join code. */
export async function runWorkspaceRecover(
  options: WorkspaceRecoverOptions,
): Promise<WorkspaceRecoverReport> {
  const root = resolveWorkspaceRoot(options.root);
  const initial = await inspect(root, options.configHome);
  if (!options.apply || !initial.report.cleanupAllowed) return initial.report;
  const locks: Array<{ lock: FileLock; path: string; owner: string }> = [];
  let result = initial.report;
  const applyWithLocks = async (): Promise<WorkspaceRecoverReport> => {
    // Same lock paths and ownership-token discipline as init/bind/index writers.
    for (const path of [
      initLockPath(root),
      join(workspaceLocalDir(root), 'bind.lock'),
      join(options.configHome, 'workspaces', 'index.lock'),
    ]) {
      try {
        const lock = await acquireFileLock(path, { waitMs: 0, lockLabel: path });
        const held = { lock, path, owner: '' };
        locks.push(held);
        held.owner = await readFile(path, 'utf8');
      } catch {
        return {
          ...result,
          state: 'LOCKED',
          cleanupAllowed: false,
          reasonCodes: ['LOCK_ACQUISITION_FAILED'],
          nextAction:
            '恢复未取得全部写锁；pending 保留。等待持锁命令结束或人工核对残留锁；不会删除其他进程的锁。',
        };
      }
    }
    const checked = await inspect(root, options.configHome, true);
    result = checked.report;
    if (!result.cleanupAllowed || checked.pendingRaw !== initial.pendingRaw)
      return {
        ...result,
        state: 'MISMATCH',
        cleanupAllowed: false,
        reasonCodes: [...result.reasonCodes, 'RECOVERY_EVIDENCE_CHANGED'],
        nextAction: '恢复检查期间本机证据变化；未清理 pending，请重新运行 workspace recover 预览。',
      };
    for (const held of locks)
      if ((await readFile(held.path, 'utf8')) !== held.owner)
        throw new CliError(
          'WORKSPACE_WRITE_FAILED',
          '恢复锁所有权发生变化；pending 保留，不删除其他进程的锁。',
        );
    await rm(pendingInitPath(root));
    result = {
      ...result,
      mode: 'applied',
      state: 'CLEANED',
      cleanupAllowed: false,
      pending: { ...result.pending, exists: false },
      writes: ['.workmesh/local/pending-init.json（已清理）'],
      nextAction:
        '已清理提交后遗留的 pending；工作区配置和用户索引保持原样，运行 workmesh workspace status 继续。',
    };
    return result;
  };
  let operationFailed = false;
  let operationError: unknown;
  try {
    result = await applyWithLocks();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }
  let releaseFailed = false;
  for (const { lock } of locks.reverse()) {
    try {
      await lock.release();
    } catch {
      releaseFailed = true;
    }
  }
  if (releaseFailed)
    throw new CliError(
      'WORKSPACE_WRITE_FAILED',
      '恢复锁释放失败或所有权发生变化；未删除不属于本命令的锁。请核对本机进程与锁。',
      { details: { recovery: result, lockReleaseFailed: true, operationFailed } },
    );
  if (operationFailed) throw operationError;
  return result;
}
