import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CliError } from './errors';
import { isUuid } from './config';
import { ensurePrivateDir, writePrivateFile } from './private-fs';
import { platformFromParts, type Platform } from './platform';

export const USER_INDEX_SCHEMA_VERSION = '1.0';

export type UserWorkspaceEntry = {
  /** 绝对根目录；只允许保存在本机用户索引中，不进入共享/导出物。 */
  root: string;
  projectId: string;
  platform: Platform;
  updatedAt: string;
};

export type UserIndex = {
  schemaVersion: '1.0';
  workspaces: Record<string, UserWorkspaceEntry>;
  /** canonical real Git root → workspaceId 的精确映射。 */
  gitRoots: Record<string, string>;
};

export function userIndexPath(home: string): string {
  return join(resolve(home), 'workspaces', 'index.json');
}

export function emptyUserIndex(): UserIndex {
  return { schemaVersion: USER_INDEX_SCHEMA_VERSION, workspaces: {}, gitRoots: {} };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', message);
  return value as Record<string, unknown>;
}

function rejectUnknown(record: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${where} 含未知字段 ${key}`);
}

function parseEntry(value: unknown, workspaceId: string): UserWorkspaceEntry {
  const record = asRecord(value, `用户索引 workspaces.${workspaceId} 必须是对象`);
  rejectUnknown(
    record,
    ['root', 'projectId', 'platform', 'updatedAt'],
    `workspaces.${workspaceId}`,
  );
  if (typeof record.root !== 'string' || !isAbsolute(record.root))
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `workspaces.${workspaceId}.root 必须是绝对路径`,
    );
  if (!isUuid(record.projectId))
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `workspaces.${workspaceId}.projectId 必须是 UUID`,
    );
  const platformRecord = asRecord(record.platform, `workspaces.${workspaceId}.platform 必须是对象`);
  rejectUnknown(platformRecord, ['origin', 'apiBasePath'], `workspaces.${workspaceId}.platform`);
  if (typeof platformRecord.origin !== 'string' || typeof platformRecord.apiBasePath !== 'string')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `workspaces.${workspaceId}.platform 非法`);
  const platform = platformFromParts(platformRecord.origin, platformRecord.apiBasePath);
  if (typeof record.updatedAt !== 'string' || Number.isNaN(Date.parse(record.updatedAt)))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `workspaces.${workspaceId}.updatedAt 非法`);
  return {
    root: resolve(record.root),
    projectId: record.projectId,
    platform,
    updatedAt: record.updatedAt,
  };
}

export function parseUserIndex(value: unknown): UserIndex {
  const record = asRecord(value, '用户索引必须是 JSON 对象');
  rejectUnknown(record, ['schemaVersion', 'workspaces', 'gitRoots'], '用户索引');
  if (record.schemaVersion !== USER_INDEX_SCHEMA_VERSION)
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `用户索引 schemaVersion 必须为 ${USER_INDEX_SCHEMA_VERSION}`,
    );
  const workspacesRecord = asRecord(record.workspaces, '用户索引 workspaces 必须是对象');
  const workspaces: Record<string, UserWorkspaceEntry> = {};
  for (const [workspaceId, entry] of Object.entries(workspacesRecord)) {
    if (!isUuid(workspaceId))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `用户索引 workspaceId 非法：${workspaceId}`);
    workspaces[workspaceId] = parseEntry(entry, workspaceId);
  }
  const gitRootsRecord =
    record.gitRoots === undefined ? {} : asRecord(record.gitRoots, '用户索引 gitRoots 必须是对象');
  const gitRoots: Record<string, string> = {};
  for (const [gitRoot, workspaceId] of Object.entries(gitRootsRecord)) {
    if (typeof workspaceId !== 'string' || !isUuid(workspaceId))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `用户索引 gitRoots.${gitRoot} 目标非法`);
    gitRoots[gitRoot] = workspaceId;
  }
  return { schemaVersion: USER_INDEX_SCHEMA_VERSION, workspaces, gitRoots };
}

export async function loadUserIndex(home: string): Promise<UserIndex> {
  const path = userIndexPath(home);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyUserIndex();
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无法读取用户索引 ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 不是合法 JSON`);
  }
  return parseUserIndex(parsed);
}

function sortedIndex(index: UserIndex): UserIndex {
  const workspaces: Record<string, UserWorkspaceEntry> = {};
  for (const workspaceId of Object.keys(index.workspaces).sort())
    workspaces[workspaceId] = index.workspaces[workspaceId] as UserWorkspaceEntry;
  const gitRoots: Record<string, string> = {};
  for (const gitRoot of Object.keys(index.gitRoots).sort())
    gitRoots[gitRoot] = index.gitRoots[gitRoot] as string;
  return { schemaVersion: USER_INDEX_SCHEMA_VERSION, workspaces, gitRoots };
}

/** 原子写入 0600 用户索引（父目录 0700）。 */
export async function saveUserIndex(home: string, index: UserIndex): Promise<string> {
  const path = userIndexPath(home);
  await ensurePrivateDir(join(resolve(home), 'workspaces'));
  await writePrivateFile(path, `${JSON.stringify(sortedIndex(index), null, 2)}\n`);
  return path;
}

/** Serialize index read/modify/write across CLI processes sharing a config home. */
export async function updateUserIndex(
  home: string,
  update: (index: UserIndex) => UserIndex | Promise<UserIndex>,
  save: (home: string, index: UserIndex) => Promise<string> = saveUserIndex,
  lockOptions: UserIndexLockOptions = {},
): Promise<string> {
  const directory = join(resolve(home), 'workspaces');
  await ensurePrivateDir(directory);
  const lockPath = join(directory, 'index.lock');
  const lockLabel = `${userIndexLabel()}.lock`;
  const lock = await acquireFileLock(lockPath, {
    waitMs: lockOptions.waitMs ?? 10_000,
    pollMs: lockOptions.pollMs,
    busyMessage:
      '用户索引仍被另一个进程更新，或上次进程中断留下锁；索引未被覆盖。确认没有相关 CLI 进程运行后，再移除锁文件并重试。',
    lockLabel,
  });

  let savedPath: string | undefined;
  let updateFailure: unknown;
  let updateFailed = false;
  try {
    const current = await loadUserIndex(home);
    savedPath = await save(home, await update(current));
  } catch (error) {
    updateFailure = error;
    updateFailed = true;
  }

  let releaseFailure: unknown;
  let releaseFailed = false;
  try {
    await (lockOptions.releaseLock ?? ((heldLock) => heldLock.release()))(lock);
  } catch (error) {
    releaseFailure = error;
    releaseFailed = true;
  }
  if (releaseFailed)
    throw new UserIndexLockReleaseError(savedPath !== undefined, lockLabel, releaseFailure);
  if (updateFailed) throw updateFailure;
  return savedPath as string;
}

export type FileLock = { release(): Promise<void> };

export type UserIndexLockOptions = {
  waitMs?: number;
  pollMs?: number;
  /** 测试注入：模拟提交后的锁释放失败。 */
  releaseLock?: (lock: FileLock) => Promise<void>;
};

export class UserIndexLockReleaseError extends CliError {
  constructor(
    readonly indexCommitted: boolean,
    lockLabel: string,
    cause?: unknown,
  ) {
    const causeMessage = cause instanceof Error ? cause.message : undefined;
    super(
      'WORKSPACE_WRITE_FAILED',
      indexCommitted
        ? `用户索引已提交，但索引锁释放失败；依赖此索引的 workspace.json 已保留，不会回滚。确认锁状态后再运行后续写入。${causeMessage ? `（${causeMessage}）` : ''}`
        : `用户索引未提交，且索引锁释放失败；确认没有相关 CLI 进程运行后，再移除锁文件并重试。${causeMessage ? `（${causeMessage}）` : ''}`,
      {
        details: {
          indexCommitted,
          lockReleaseFailed: true,
          lock: lockLabel,
          ...(causeMessage ? { lockReleaseError: causeMessage } : {}),
        },
      },
    );
  }
}

export function isUserIndexCommittedError(error: unknown): error is UserIndexLockReleaseError {
  return error instanceof UserIndexLockReleaseError && error.indexCommitted;
}

/**
 * Acquire an exclusive cross-process lock by creating the lock path with `wx`.
 * If a process stops while writing owner metadata, the partial lock is still treated as
 * occupied and requires manual cleanup after confirming no CLI writer is active. We fail
 * closed on any existing lock: automatically unlinking a stale lock has no portable atomic
 * compare-and-delete primitive and could otherwise remove a new process's active lock.
 */
export async function acquireFileLock(
  lockPath: string,
  options: { waitMs?: number; pollMs?: number; busyMessage?: string; lockLabel?: string } = {},
): Promise<FileLock> {
  const waitMs = options.waitMs ?? 10_000;
  const pollMs = options.pollMs ?? 25;
  const deadline = Date.now() + waitMs;
  while (true) {
    const token = randomUUID();
    let ownerFile: Awaited<ReturnType<typeof open>> | undefined;
    let lockCreated = false;
    try {
      ownerFile = await open(lockPath, 'wx', 0o600);
      lockCreated = true;
      await ownerFile.writeFile(
        `${JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() })}\n`,
      );
      await ownerFile.sync();
      await ownerFile.close();
      ownerFile = undefined;
    } catch (error) {
      await ownerFile?.close().catch(() => undefined);
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode !== 'EEXIST') {
        // The exclusive create may already have succeeded. Keep any partial lock in place:
        // deleting by pathname here could race with manual repair and remove a replacement.
        throw new CliError(
          'WORKSPACE_WRITE_FAILED',
          lockCreated
            ? `无法完整写入本机锁文件；锁可能仍存在，确认没有相关 CLI 进程运行后再手动清理。${options.lockLabel ?? basename(lockPath)}`
            : `无法创建本机锁文件 ${options.lockLabel ?? basename(lockPath)}；请检查目录权限和文件系统状态。`,
          {
            details: {
              lock: options.lockLabel ?? basename(lockPath),
              reasonCode: errorCode,
            },
          },
        );
      }
      if (Date.now() >= deadline)
        throw new CliError(
          'WORKSPACE_WRITE_FAILED',
          options.busyMessage ?? '本机配置仍被另一个进程更新。',
          {
            details: { lock: options.lockLabel ?? basename(lockPath) },
          },
        );
      await new Promise((resolveWait) => setTimeout(resolveWait, pollMs));
      continue;
    }
    return {
      async release() {
        const ownerToken = await readFileLockToken(lockPath);
        // Refuse to claim success if the lock was removed, corrupted, or replaced.
        if (ownerToken !== token) throw new Error('lock ownership changed before release');
        await rm(lockPath);
      },
    };
  }
}

async function readFileLockToken(path: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return typeof record.token === 'string' ? record.token : null;
  } catch {
    return null;
  }
}

/** Windows 路径大小写等价；POSIX 保持原样。仅用于本机索引键，不做跨盘猜测。 */
export function gitRootKey(absolutePath: string): string {
  const resolved = resolve(absolutePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** 解析真实 Git root；存在时必须经 realpath（展开符号链接与 8.3 短名）。 */
export async function canonicalGitRoot(absolutePath: string): Promise<string> {
  return canonicalLocalPath(absolutePath);
}

/** Resolve existing aliases; for a missing tail, resolve its nearest existing ancestor. */
export async function canonicalLocalPath(absolutePath: string): Promise<string> {
  const resolved = resolve(absolutePath);
  try {
    return await realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  let ancestor = resolved;
  const missing: string[] = [];
  while (true) {
    let exists = false;
    try {
      await lstat(ancestor);
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.push(relative(parent, ancestor));
      ancestor = parent;
    }
    if (exists) {
      // lstat succeeds on a dangling symlink; realpath must then propagate ENOENT instead
      // of turning that unresolved alias into a lexical path identity.
      const canonicalAncestor = await realpath(ancestor);
      return resolve(canonicalAncestor, ...missing.reverse());
    }
  }
}

/** 解析工作区根：存在时 realpath，避免路径别名产生第二份映射。 */
export async function canonicalWorkspaceRoot(absolutePath: string): Promise<string> {
  return canonicalGitRoot(absolutePath);
}

export function findWorkspaceEntry(
  index: UserIndex,
  workspaceId: string,
): UserWorkspaceEntry | null {
  return index.workspaces[workspaceId] ?? null;
}

/** 精确匹配 real Git root；不做字符串前缀、父目录或 basename 匹配。 */
export function findWorkspaceByGitRoot(
  index: UserIndex,
  gitRoot: string,
): { workspaceId: string; entry: UserWorkspaceEntry } | null {
  const workspaceId = index.gitRoots[gitRootKey(gitRoot)];
  if (!workspaceId) return null;
  const entry = index.workspaces[workspaceId];
  return entry ? { workspaceId, entry } : null;
}

export function findWorkspacesByProject(
  index: UserIndex,
  projectId: string,
): Array<{ workspaceId: string; entry: UserWorkspaceEntry }> {
  return Object.keys(index.workspaces)
    .sort()
    .map((workspaceId) => ({
      workspaceId,
      entry: index.workspaces[workspaceId] as UserWorkspaceEntry,
    }))
    .filter((item) => item.entry.projectId === projectId);
}

export type UpsertWorkspaceInput = {
  workspaceId: string;
  root: string;
  projectId: string;
  platform: Platform;
  updatedAt: string;
  /** 显式给出的精确 Git root 集合；未给出的旧映射保持不变，传空数组表示清空。 */
  gitRoots?: string[];
};

export function upsertUserWorkspace(index: UserIndex, input: UpsertWorkspaceInput): UserIndex {
  if (!isUuid(input.workspaceId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspaceId 必须是 UUID');
  if (!isUuid(input.projectId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'projectId 必须是 UUID');
  const workspaces: Record<string, UserWorkspaceEntry> = {
    ...index.workspaces,
    [input.workspaceId]: {
      root: resolve(input.root),
      projectId: input.projectId,
      platform: { origin: input.platform.origin, apiBasePath: input.platform.apiBasePath },
      updatedAt: input.updatedAt,
    },
  };
  const gitRoots: Record<string, string> = {};
  for (const [gitRoot, workspaceId] of Object.entries(index.gitRoots)) {
    if (workspaceId === input.workspaceId) continue;
    gitRoots[gitRoot] = workspaceId;
  }
  if (input.gitRoots) {
    for (const gitRoot of input.gitRoots) {
      const key = gitRootKey(gitRoot);
      const existingWorkspaceId = gitRoots[key];
      if (existingWorkspaceId && existingWorkspaceId !== input.workspaceId)
        throw new CliError(
          'WORKSPACE_AMBIGUOUS',
          '同一个 Git root 已登记到另一个工作区；为避免静默改绑，原有索引保持不变。请显式选择或处理冲突后重试。',
          {
            details: { gitRoot: key, existingWorkspaceId, requestedWorkspaceId: input.workspaceId },
          },
        );
      gitRoots[key] = input.workspaceId;
    }
  } else {
    for (const [gitRoot, workspaceId] of Object.entries(index.gitRoots))
      if (workspaceId === input.workspaceId) gitRoots[gitRoot] = workspaceId;
  }
  return { schemaVersion: USER_INDEX_SCHEMA_VERSION, workspaces, gitRoots };
}

/** 绑定成功后追加一条精确 Git root 映射；不修改其他工作区条目。 */
export function addGitRootMapping(
  index: UserIndex,
  gitRoot: string,
  workspaceId: string,
): UserIndex {
  const key = gitRootKey(gitRoot);
  const existingWorkspaceId = index.gitRoots[key];
  if (existingWorkspaceId && existingWorkspaceId !== workspaceId)
    throw new CliError(
      'WORKSPACE_AMBIGUOUS',
      '同一个 Git root 已登记到另一个工作区；为避免静默改绑，原有索引保持不变。请显式选择或处理冲突后重试。',
      { details: { gitRoot: key, existingWorkspaceId, requestedWorkspaceId: workspaceId } },
    );
  const gitRoots = { ...index.gitRoots, [key]: workspaceId };
  return {
    schemaVersion: USER_INDEX_SCHEMA_VERSION,
    workspaces: { ...index.workspaces },
    gitRoots,
  };
}

/** 迁移/配置状态诊断用的路径标签；输出中不暴露绝对路径。 */
export function userIndexLabel(): string {
  return '~/.workmesh/workspaces/index.json';
}
