import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { CliError } from './errors';
import {
  assertRoleKey,
  isUuid,
  parseWorkspaceConfig,
  workspaceConfigPath,
  type WorkspaceConfig,
  type WorkspaceHost,
} from './config';
import { ensurePrivateDir, writePrivateFile } from './private-fs';
import { platformFromParts, type Platform } from './platform';

/** v2 工作区配置：`.workmesh/workspace.json`（§8.2.1）。 */
export const WORKSPACE_SCHEMA_VERSION = '2.0';
/** 服务端已发布定义的 layout.kind 枚举（T1/T3 冻结）。 */
export const WORKSPACE_LAYOUT_KINDS = ['SINGLE_ROOT', 'MULTI_ROOT', 'NONE'] as const;
export type WorkspaceLayoutKind = (typeof WORKSPACE_LAYOUT_KINDS)[number];

export type WorkspaceState = 'NONE' | 'V1_ONLY' | 'V2_ONLY' | 'MIGRATED' | 'DUAL_ACTIVE';

export type WorkspaceDefinitionRef = { revisionId: string; sha256: string };

/**
 * 本机工作区绑定。不保存绝对 root、不保存凭据、不保存 run 状态；
 * `definition` 为 null 只出现在 v1→v2 迁移产生的 MIGRATED 配置中（v1 没有
 * 已发布工作区定义可迁移），此时需要在线 bind/status 刷新定义引用。
 */
export type WorkspaceRepositoryBinding = {
  key: string;
  projectRepositoryId: string;
  /** 相对工作区根的 POSIX 路径；'.' 表示仓库根就是工作区根。 */
  path: string;
  remote: string;
  /** 迁移产生的待重新核验映射（v1 repositoryId）；bind 成功后可移除该提示。 */
  needsRevalidation?: boolean;
};

export type WorkspaceConfigV2 = {
  schemaVersion: '2.0';
  workspaceId: string;
  platform: Platform;
  projectId: string;
  definition: WorkspaceDefinitionRef | null;
  layout: { kind: WorkspaceLayoutKind };
  repositories: WorkspaceRepositoryBinding[];
  defaults: { profile: string; host: WorkspaceHost; roleKey: string | null };
};

export type WorkspaceFileState<T> = {
  path: string;
  exists: boolean;
  digest: string | null;
  valid: boolean;
  value: T | null;
  error: CliError | null;
};

export type MigrationPhase =
  | 'PLANNED'
  | 'BACKUP_WRITTEN'
  | 'V2_WRITTEN'
  | 'INDEX_WRITTEN'
  | 'V1_ARCHIVED'
  | 'COMMITTED'
  | 'FAILED';

/** 迁移 journal：只存安全元数据，不含凭据；供 --inspect 与 keep-v2 条件判断。 */
export type MigrationJournal = {
  schemaVersion: '1.0';
  migrationId: string;
  phase: MigrationPhase;
  workspaceId: string;
  previousState: 'V1_ONLY' | 'DUAL_ACTIVE';
  v1File: string;
  v2File: string;
  backupFile: string | null;
  /** v2 原始文件字节摘要；缺失/空值表示旧 journal，不能用于 keep-v2。 */
  v2Digest?: string | null;
  startedAt: string;
  updatedAt: string;
  resolution: 'KEEP_V2' | null;
  error: { code: string; message: string } | null;
};

export type WorkspaceSnapshot = {
  root: string;
  state: WorkspaceState;
  v1: WorkspaceFileState<WorkspaceConfig>;
  v2: WorkspaceFileState<WorkspaceConfigV2>;
  backups: string[];
  journal: MigrationJournal | null;
  journalError: CliError | null;
};

export type ActiveWorkspace =
  | { kind: 'V1'; state: 'V1_ONLY'; config: WorkspaceConfig }
  | { kind: 'V2'; state: 'V2_ONLY' | 'MIGRATED'; config: WorkspaceConfigV2 };

const PROFILE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const REPOSITORY_KEY = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const BACKUP = /^config\.v1\..+\.json\.bak$/;

export function workspaceV2Path(dir: string): string {
  return join(resolve(dir), '.workmesh', 'workspace.json');
}

export function workspaceConfigV1Path(dir: string): string {
  return join(resolve(dir), '.workmesh', 'config.json');
}

export function workspaceWorkMeshDir(dir: string): string {
  return join(resolve(dir), '.workmesh');
}

export function workspaceLocalDir(dir: string): string {
  return join(workspaceWorkMeshDir(dir), 'local');
}

export function workspaceDefinitionsDir(dir: string): string {
  return join(workspaceWorkMeshDir(dir), 'definitions');
}

export function workspaceDefinitionCachePath(dir: string, revisionId: string): string {
  return join(workspaceDefinitionsDir(dir), `${revisionId}.json`);
}

export function migrationJournalPath(dir: string): string {
  return join(workspaceLocalDir(dir), 'migrate-journal.json');
}

export function pendingInitPath(dir: string): string {
  return join(workspaceLocalDir(dir), 'pending-init.json');
}

export function initLockPath(dir: string): string {
  return join(workspaceLocalDir(dir), 'init.lock');
}

/** Windows 文件名不能包含 ':'，用紧凑 ISO 时间戳生成可恢复备份名。 */
export function backupTimestamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function workspaceBackupPath(dir: string, timestamp: string): string {
  return join(workspaceWorkMeshDir(dir), `config.v1.${timestamp}.json.bak`);
}

export function workspaceBackupLabel(): string {
  return 'config.v1.<ts>.json.bak';
}

/** 输出中的本机路径：只给相对 root 的展示名，避免导出/共享物泄露绝对路径。 */
export function workspaceRelativeLabel(root: string, absolutePath: string): string {
  const rel = relative(resolve(root), resolve(absolutePath));
  if (!rel) return '.';
  return rel.split('\\').join('/');
}

export function resolveWorkspaceRoot(input?: string): string {
  return resolve(input ?? process.cwd());
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', message);
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
): void {
  for (const key of Object.keys(record))
    if (!allowed.has(key))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${where} 含未知字段 ${key}`);
}

/** 相对 POSIX 路径；允许 '.' 表示工作区根本身，禁止绝对路径、反斜杠与 '..' 越界。 */
export function assertWorkspaceRelativePath(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${field} 必须是非空字符串`);
  if (value === '.') return value;
  if (value.startsWith('/') || isAbsolute(value) || value.includes('\\'))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${field} 必须是相对 POSIX 路径`);
  if (/^[A-Za-z]:/.test(value) || value.includes('\0'))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${field} 不能包含盘符或空字符`);
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${field} 不能包含空段、'.' 或 '..'`);
  return value;
}

function assertRepositoryKey(value: unknown, field: string): string {
  if (typeof value !== 'string' || !REPOSITORY_KEY.test(value))
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `${field} 必须是 1–64 位小写字母/数字/'.'/'_'/'-'`,
    );
  return value;
}

function assertSha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SHA256.test(value))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${field} 必须是 64 位小写十六进制 SHA-256`);
  return value;
}

const V2_KEYS = new Set([
  'schemaVersion',
  'workspaceId',
  'platform',
  'projectId',
  'definition',
  'layout',
  'repositories',
  'defaults',
]);
const V2_REPOSITORY_KEYS = new Set([
  'key',
  'projectRepositoryId',
  'path',
  'remote',
  'needsRevalidation',
]);
const V2_DEFINITION_KEYS = new Set(['revisionId', 'sha256']);
const V2_DEFAULTS_KEYS = new Set(['profile', 'host', 'roleKey']);
const V2_LAYOUT_KEYS = new Set(['kind']);

export type ParseWorkspaceConfigV2Options = {
  /**
   * 只允许 v1→v2 本地迁移产生的 MIGRATED 配置（没有可迁移的已发布定义引用）；
   * V2_ONLY（init/新接入）必须带完整 definition。
   */
  allowNullDefinition?: boolean;
};

export function parseWorkspaceConfigV2(
  value: unknown,
  options: ParseWorkspaceConfigV2Options = {},
): WorkspaceConfigV2 {
  const record = asRecord(value, '工作区配置必须是 JSON 对象');
  rejectUnknownKeys(record, V2_KEYS, 'workspace.json');
  if (record.schemaVersion !== WORKSPACE_SCHEMA_VERSION)
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `workspace.json schemaVersion 必须为 ${WORKSPACE_SCHEMA_VERSION}`,
    );
  if (!isUuid(record.workspaceId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'workspaceId 必须是 UUID');

  const platformRecord = asRecord(record.platform, 'platform 必须是对象');
  rejectUnknownKeys(platformRecord, new Set(['origin', 'apiBasePath']), 'platform');
  if (typeof platformRecord.origin !== 'string' || typeof platformRecord.apiBasePath !== 'string')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'platform.origin/apiBasePath 必须是字符串');
  let platform: Platform;
  try {
    platform = platformFromParts(platformRecord.origin, platformRecord.apiBasePath);
  } catch (error) {
    if (error instanceof CliError)
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `platform 非法：${error.message}`);
    throw error;
  }

  if (!isUuid(record.projectId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'projectId 必须是 UUID');

  let definition: WorkspaceDefinitionRef | null = null;
  if (record.definition !== null) {
    const definitionRecord = asRecord(record.definition, 'definition 必须是对象或 null');
    rejectUnknownKeys(definitionRecord, V2_DEFINITION_KEYS, 'definition');
    if (!isUuid(definitionRecord.revisionId))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'definition.revisionId 必须是 UUID');
    definition = {
      revisionId: definitionRecord.revisionId,
      sha256: assertSha256(definitionRecord.sha256, 'definition.sha256'),
    };
  } else if (!options.allowNullDefinition) {
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      'definition 不能为 null；只有 v1→v2 迁移产生的 MIGRATED 配置允许缺少定义引用',
    );
  }

  const layoutRecord = asRecord(record.layout, 'layout 必须是对象');
  rejectUnknownKeys(layoutRecord, V2_LAYOUT_KEYS, 'layout');
  if (!WORKSPACE_LAYOUT_KINDS.includes(layoutRecord.kind as WorkspaceLayoutKind))
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `layout.kind 必须是 ${WORKSPACE_LAYOUT_KINDS.join(' | ')}`,
    );
  const layoutKind = layoutRecord.kind as WorkspaceLayoutKind;

  if (!Array.isArray(record.repositories))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'repositories 必须是数组');
  const repositories: WorkspaceRepositoryBinding[] = [];
  const keys = new Set<string>();
  const repositoryIds = new Set<string>();
  const paths = new Set<string>();
  for (const [index, item] of record.repositories.entries()) {
    const repository = asRecord(item, `repositories[${index}] 必须是对象`);
    rejectUnknownKeys(repository, V2_REPOSITORY_KEYS, `repositories[${index}]`);
    const key = assertRepositoryKey(repository.key, `repositories[${index}].key`);
    if (keys.has(key))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `repositories key 重复：${key}`);
    keys.add(key);
    if (!isUuid(repository.projectRepositoryId))
      throw new CliError(
        'CONFIG_SCHEMA_UNSUPPORTED',
        `repositories[${index}].projectRepositoryId 必须是 UUID`,
      );
    if (repositoryIds.has(repository.projectRepositoryId))
      throw new CliError(
        'CONFIG_SCHEMA_UNSUPPORTED',
        `repositories projectRepositoryId 重复：${repository.projectRepositoryId}`,
      );
    repositoryIds.add(repository.projectRepositoryId);
    const path = assertWorkspaceRelativePath(repository.path, `repositories[${index}].path`);
    if (paths.has(path))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `repositories path 重复：${path}`);
    paths.add(path);
    if (typeof repository.remote !== 'string' || !repository.remote.trim())
      throw new CliError(
        'CONFIG_SCHEMA_UNSUPPORTED',
        `repositories[${index}].remote 必须是非空字符串`,
      );
    if (
      repository.needsRevalidation !== undefined &&
      typeof repository.needsRevalidation !== 'boolean'
    )
      throw new CliError(
        'CONFIG_SCHEMA_UNSUPPORTED',
        `repositories[${index}].needsRevalidation 必须是布尔值`,
      );
    repositories.push({
      key,
      projectRepositoryId: repository.projectRepositoryId,
      path,
      remote: repository.remote,
      ...(repository.needsRevalidation === true ? { needsRevalidation: true } : {}),
    });
  }
  if (layoutKind === 'NONE' && repositories.length > 0)
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'layout.kind NONE 时 repositories 必须为空');

  const defaultsRecord = asRecord(record.defaults, 'defaults 必须是对象');
  rejectUnknownKeys(defaultsRecord, V2_DEFAULTS_KEYS, 'defaults');
  if (typeof defaultsRecord.profile !== 'string' || !PROFILE.test(defaultsRecord.profile))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'defaults.profile 非法');
  if (defaultsRecord.host !== 'codex' && defaultsRecord.host !== 'claude-code')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'defaults.host 必须是 codex 或 claude-code');
  let roleKey: string | null = null;
  if (defaultsRecord.roleKey !== null)
    roleKey = assertRoleKey(defaultsRecord.roleKey, 'defaults.roleKey');

  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    workspaceId: record.workspaceId,
    platform,
    projectId: record.projectId,
    definition,
    layout: { kind: layoutKind },
    repositories,
    defaults: { profile: defaultsRecord.profile, host: defaultsRecord.host, roleKey },
  };
}

/** 序列化顺序固定，便于 review 与摘要稳定；不写入任何绝对路径。 */
export function serializeWorkspaceConfigV2(config: WorkspaceConfigV2): string {
  return `${JSON.stringify(
    {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      workspaceId: config.workspaceId,
      platform: { origin: config.platform.origin, apiBasePath: config.platform.apiBasePath },
      projectId: config.projectId,
      definition: config.definition
        ? { revisionId: config.definition.revisionId, sha256: config.definition.sha256 }
        : null,
      layout: { kind: config.layout.kind },
      repositories: config.repositories.map((repository) => ({
        key: repository.key,
        projectRepositoryId: repository.projectRepositoryId,
        path: repository.path,
        remote: repository.remote,
        ...(repository.needsRevalidation ? { needsRevalidation: true } : {}),
      })),
      defaults: {
        profile: config.defaults.profile,
        host: config.defaults.host,
        roleKey: config.defaults.roleKey,
      },
    },
    null,
    2,
  )}\n`;
}

export async function loadWorkspaceConfigV2(
  dir: string,
  options: ParseWorkspaceConfigV2Options = {},
): Promise<WorkspaceConfigV2> {
  const path = workspaceV2Path(dir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT')
      throw new CliError(
        'CONFIG_NOT_FOUND',
        `未找到 ${path}；请先运行 workmesh workspace init --join`,
      );
    if (code === 'EACCES') throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无权读取 ${path}`);
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无法读取 ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 不是合法 JSON`);
  }
  return parseWorkspaceConfigV2(parsed, options);
}

/** 原子写入 v2 配置：0600 文件 + 0700 目录（temp+rename 由 writePrivateFile 保证）。 */
export async function saveWorkspaceConfigV2(
  dir: string,
  config: WorkspaceConfigV2,
): Promise<string> {
  const path = workspaceV2Path(dir);
  await ensurePrivateDir(workspaceWorkMeshDir(dir));
  await writePrivateFile(path, serializeWorkspaceConfigV2(config));
  return path;
}

async function digestOfBytes(raw: string): Promise<string> {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function readFileState<T>(
  path: string,
  parse: (value: unknown) => T,
): Promise<WorkspaceFileState<T>> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT')
      return { path, exists: false, digest: null, valid: false, value: null, error: null };
    const failure = new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无法读取 ${path}`);
    return { path, exists: true, digest: null, valid: false, value: null, error: failure };
  }
  const digest = await digestOfBytes(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      path,
      exists: true,
      digest,
      valid: false,
      value: null,
      error: new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 不是合法 JSON`),
    };
  }
  try {
    return { path, exists: true, digest, valid: true, value: parse(parsed), error: null };
  } catch (error) {
    const failure =
      error instanceof CliError
        ? error
        : new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 结构非法`);
    return { path, exists: true, digest, valid: false, value: null, error: failure };
  }
}

function parseJournal(value: unknown): MigrationJournal {
  const record = asRecord(value, '迁移 journal 必须是 JSON 对象');
  const phases: MigrationPhase[] = [
    'PLANNED',
    'BACKUP_WRITTEN',
    'V2_WRITTEN',
    'INDEX_WRITTEN',
    'V1_ARCHIVED',
    'COMMITTED',
    'FAILED',
  ];
  if (record.schemaVersion !== '1.0')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal schemaVersion 必须是 1.0');
  if (!phases.includes(record.phase as MigrationPhase))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal phase 非法');
  if (!isUuid(record.migrationId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal migrationId 必须是 UUID');
  if (!isUuid(record.workspaceId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal workspaceId 必须是 UUID');
  if (record.previousState !== 'V1_ONLY' && record.previousState !== 'DUAL_ACTIVE')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal previousState 非法');
  return {
    schemaVersion: '1.0',
    migrationId: record.migrationId,
    phase: record.phase as MigrationPhase,
    workspaceId: record.workspaceId,
    previousState: record.previousState,
    v1File: typeof record.v1File === 'string' ? record.v1File : 'config.json',
    v2File: typeof record.v2File === 'string' ? record.v2File : 'workspace.json',
    backupFile: typeof record.backupFile === 'string' ? record.backupFile : null,
    v2Digest:
      record.v2Digest === undefined || record.v2Digest === null
        ? null
        : typeof record.v2Digest === 'string' && SHA256.test(record.v2Digest)
          ? record.v2Digest
          : (() => {
              throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '迁移 journal v2Digest 非法');
            })(),
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : '',
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
    resolution: record.resolution === 'KEEP_V2' ? 'KEEP_V2' : null,
    error:
      record.error && typeof record.error === 'object' && !Array.isArray(record.error)
        ? {
            code: String((record.error as Record<string, unknown>).code ?? 'UNKNOWN'),
            message: String((record.error as Record<string, unknown>).message ?? ''),
          }
        : null,
  };
}

export async function readMigrationJournal(
  dir: string,
): Promise<{ journal: MigrationJournal | null; error: CliError | null; exists: boolean }> {
  const path = migrationJournalPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { journal: null, error: null, exists: false };
    return {
      journal: null,
      error: new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无法读取 ${path}`),
      exists: true,
    };
  }
  try {
    return {
      journal: parseJournal(JSON.parse(raw) as unknown),
      error: null,
      exists: true,
    };
  } catch (error) {
    return {
      journal: null,
      error:
        error instanceof CliError
          ? error
          : new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 结构非法`),
      exists: true,
    };
  }
}

export async function writeMigrationJournal(
  dir: string,
  journal: MigrationJournal,
): Promise<string> {
  const path = migrationJournalPath(dir);
  await ensurePrivateDir(workspaceLocalDir(dir));
  await writePrivateFile(path, `${JSON.stringify(journal, null, 2)}\n`);
  return path;
}

function defaultV1File(dir: string): string {
  return workspaceConfigPath(dir);
}

async function listBackups(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(workspaceWorkMeshDir(dir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '无法读取 .workmesh 目录');
  }
  return entries
    .filter((name) => BACKUP.test(name))
    .sort()
    .map((name) => join(workspaceWorkMeshDir(dir), name));
}

/**
 * 五态识别（§14.3）。损坏文件不静默跳过：状态仍按“文件存在”归类，
 * 并在 resolveActiveWorkspace 中把解析错误直接抛出。
 */
export async function detectWorkspaceState(dir: string): Promise<WorkspaceSnapshot> {
  const root = resolve(dir);
  const v1Path = defaultV1File(root);
  const v2Path = workspaceV2Path(root);
  const backups = await listBackups(root);
  const journalResult = await readMigrationJournal(root);
  const journal = journalResult.journal;
  const allowNullDefinition =
    backups.length > 0 || (journal !== null && journal.previousState === 'V1_ONLY');

  const v1 = await readFileState(v1Path, (value) => parseWorkspaceConfig(value));
  const v2 = await readFileState(v2Path, (value) =>
    parseWorkspaceConfigV2(value, { allowNullDefinition }),
  );

  let state: WorkspaceState;
  if (v1.exists && v1.valid && v2.exists && v2.valid) state = 'DUAL_ACTIVE';
  else if (v2.exists && v2.valid)
    state = v1.exists ? 'V2_ONLY' : backups.length > 0 ? 'MIGRATED' : 'V2_ONLY';
  else if (v1.exists) state = 'V1_ONLY';
  else if (v2.exists) state = 'V2_ONLY';
  else state = 'NONE';

  return { root, state, v1, v2, backups, journal, journalError: journalResult.error };
}

export function configNotFoundError(): CliError {
  return new CliError(
    'CONFIG_NOT_FOUND',
    '当前目录没有工作区绑定；运行 workmesh workspace init --join <code> --root <dir> --api <base> --role <role> 接入项目',
    { details: { nextAction: 'workspace init --join' } },
  );
}

export function dualConfigError(snapshot: WorkspaceSnapshot): CliError {
  const nextAction =
    '先运行 workmesh workspace migrate --inspect 诊断；确认 v2 有效且 journal 处于可收敛阶段后运行 workmesh workspace migrate --resolve keep-v2';
  const v1Digest = snapshot.v1.digest ?? '(无法读取)';
  const v2Digest = snapshot.v2.digest ?? '(无法读取)';
  return new CliError(
    'WORKSPACE_DUAL_CONFIG',
    [
      '检测到硬冲突 DUAL_ACTIVE：.workmesh/workspace.json 与 .workmesh/config.json 同时存在且可解析。',
      `  v1: ${snapshot.v1.path}（sha256 ${v1Digest}）`,
      `  v2: ${snapshot.v2.path}（sha256 ${v2Digest}）`,
      '不会自动选择权威配置。',
      nextAction,
    ].join('\n'),
    {
      details: {
        state: 'DUAL_ACTIVE',
        v1Path: snapshot.v1.path,
        v2Path: snapshot.v2.path,
        v1Digest,
        v2Digest,
        nextAction,
        safeCommands: [
          'workmesh workspace status',
          'workmesh workspace migrate --inspect',
          'workmesh workspace migrate --resolve keep-v2',
        ],
      },
    },
  );
}

export function v1MigrationRequiredError(action: string): CliError {
  return new CliError(
    'WORKSPACE_V1_MIGRATION_REQUIRED',
    `当前工作区仍是 v1 配置（.workmesh/config.json）；${action} 属于 v2 写命令，必须先运行 workmesh workspace migrate --dry-run 查看映射，再运行 --apply 迁移。`,
    {
      details: {
        nextAction: 'workmesh workspace migrate --dry-run && workmesh workspace migrate --apply',
      },
    },
  );
}

export function workspaceNotConfiguredError(action: string): CliError {
  return new CliError(
    'WORKSPACE_NOT_CONFIGURED',
    `没有可用的 v2 工作区绑定，${action} 被拒绝；先运行 workmesh workspace init --join 接入项目。`,
    { details: { nextAction: 'workmesh workspace init --join' } },
  );
}

export function definitionRequiredError(action: string): CliError {
  return new CliError(
    'WORKSPACE_DEFINITION_REQUIRED',
    `当前 v2 配置没有已发布定义引用（v1→v2 迁移的本地绑定），${action} 需要定义 revision/digest；请先在线运行 workmesh workspace bind 以刷新定义，或重新执行 workspace init --join。`,
    {
      details: {
        nextAction: 'workmesh workspace bind --repository <id> --path <dir>（在线）',
      },
    },
  );
}

/** 普通命令（旧数据命令、auth、setup/roles install）统一走这里：DUAL_ACTIVE 直接拒绝。 */
export async function resolveActiveWorkspace(dir: string): Promise<ActiveWorkspace> {
  const snapshot = await detectWorkspaceState(dir);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.v2.exists && !snapshot.v2.valid)
    throw (
      snapshot.v2.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${snapshot.v2.path} 结构非法`)
    );
  if (snapshot.v2.valid && snapshot.v2.value) {
    const state = snapshot.state === 'MIGRATED' ? 'MIGRATED' : 'V2_ONLY';
    return { kind: 'V2', state, config: snapshot.v2.value };
  }
  if (snapshot.v1.exists && !snapshot.v1.valid)
    throw (
      snapshot.v1.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${snapshot.v1.path} 结构非法`)
    );
  if (snapshot.v1.valid && snapshot.v1.value)
    return { kind: 'V1', state: 'V1_ONLY', config: snapshot.v1.value };
  throw configNotFoundError();
}

/** v2 → 旧命令读取视图：旧命令只依赖 platform/projectId/roleKey 等字段。 */
export function legacyWorkspaceView(config: WorkspaceConfigV2): WorkspaceConfig {
  return {
    schemaVersion: '1.0',
    profile: config.defaults.profile,
    platform: config.platform,
    projectId: config.projectId,
    roleKey: config.defaults.roleKey ?? '',
    repositoryId: config.repositories[0]?.projectRepositoryId ?? null,
    host: config.defaults.host,
    workflowDefinitionRevisionId: null,
  };
}

// ---------------------------------------------------------------------------
// 已发布工作区定义（T3 契约）与本地 revision 缓存（§9.4）
// ---------------------------------------------------------------------------

export type DefinitionLocator = {
  id: string | null;
  canonicalLocator: string;
  source: string | null;
  declaredAt: string | null;
  revokedAt: string | null;
};

export type DefinitionRepository = {
  key: string;
  projectRepositoryId: string;
  suggestedPath: string | null;
  defaultRef: string | null;
  description: string | null;
  identityMode: 'DECLARED' | 'PROVIDER' | null;
  adapter: string | null;
  externalId: string | null;
  owner: string | null;
  name: string | null;
  archivedAt: string | null;
  provider: { adapter: string; externalId: string } | null;
  locators: DefinitionLocator[];
};

export type DefinitionValidationIssue = { path: string; code: string; message: string };

export type WorkspaceDefinitionPayload = {
  schemaVersion: string | null;
  projectId: string | null;
  layoutKind: WorkspaceLayoutKind;
  repositories: Array<{ key: string; projectRepositoryId: string; suggestedPath: string | null }>;
  raw: unknown;
};

export type ResolvedWorkspaceDefinition = {
  revisionId: string;
  revisionNo: number | null;
  digest: string;
  publishedAt: string | null;
  payload: WorkspaceDefinitionPayload;
  repositories: DefinitionRepository[];
  validation: { valid: boolean; issues: DefinitionValidationIssue[] };
  definitionVersion: number | null;
  projectVersion: number | null;
};

export type EnrolledProject = {
  projectId: string;
  projectName: string | null;
  definitionRevisionId: string;
  definitionDigest: string;
};

function isUuidOrNull(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

export async function definitionDigestOf(payload: unknown): Promise<string> {
  try {
    return await sha256Bytes(new TextEncoder().encode(canonicalJson(payload)));
  } catch {
    throw new CliError('PROTOCOL_INVALID', '定义 payload 无法规范化计算摘要');
  }
}

export function parseConsumedEnrollment(value: unknown): EnrolledProject {
  const record = asProtocolRecord(value, '接入码消费响应必须是对象');
  if (!isUuid(record.projectId))
    throw new CliError('PROTOCOL_INVALID', '接入码消费响应 projectId 不是 UUID');
  if (!isUuid(record.definitionRevisionId))
    throw new CliError('PROTOCOL_INVALID', '接入码消费响应 definitionRevisionId 不是 UUID');
  if (typeof record.definitionDigest !== 'string' || !SHA256.test(record.definitionDigest))
    throw new CliError('PROTOCOL_INVALID', '接入码消费响应 definitionDigest 非法');
  return {
    projectId: record.projectId,
    projectName: stringOrNull(record.projectName),
    definitionRevisionId: record.definitionRevisionId,
    definitionDigest: record.definitionDigest,
  };
}

function asProtocolRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', message);
  return value as Record<string, unknown>;
}

export function parseDefinitionPayload(value: unknown): WorkspaceDefinitionPayload {
  const record = asProtocolRecord(value, '定义 payload 必须是对象');
  const layout = asProtocolRecord(record.layout, '定义 payload.layout 必须是对象');
  if (!WORKSPACE_LAYOUT_KINDS.includes(layout.kind as WorkspaceLayoutKind))
    throw new CliError('PROTOCOL_INVALID', '定义 payload.layout.kind 非法');
  if (!isUuid(record.projectId))
    throw new CliError('PROTOCOL_INVALID', '定义 payload.projectId 非法');
  const repositoryList = record.repositories;
  if (!Array.isArray(repositoryList))
    throw new CliError('PROTOCOL_INVALID', '定义 payload.repositories 必须是数组');
  const repositories: WorkspaceDefinitionPayload['repositories'] = [];
  const keys = new Set<string>();
  for (const [index, item] of repositoryList.entries()) {
    const repository = asProtocolRecord(item, `定义 payload.repositories[${index}] 必须是对象`);
    if (typeof repository.key !== 'string' || !REPOSITORY_KEY.test(repository.key))
      throw new CliError('PROTOCOL_INVALID', `定义 payload.repositories[${index}].key 非法`);
    if (!isUuid(repository.projectRepositoryId))
      throw new CliError(
        'PROTOCOL_INVALID',
        `定义 payload.repositories[${index}].projectRepositoryId 不是 UUID`,
      );
    if (keys.has(repository.key))
      throw new CliError('PROTOCOL_INVALID', `定义 payload.repository key 重复：${repository.key}`);
    keys.add(repository.key);
    let suggestedPath: string | null = null;
    if (repository.suggestedPath !== null && repository.suggestedPath !== undefined) {
      try {
        suggestedPath = assertWorkspaceRelativePath(
          repository.suggestedPath,
          `定义 payload.repositories[${index}].suggestedPath`,
        );
      } catch {
        throw new CliError(
          'PROTOCOL_INVALID',
          `定义 payload.repositories[${index}].suggestedPath 必须是相对 POSIX 路径`,
        );
      }
    }
    repositories.push({
      key: repository.key,
      projectRepositoryId: repository.projectRepositoryId,
      suggestedPath,
    });
  }
  if (layout.kind === 'NONE') {
    if (repositories.length > 0)
      throw new CliError('PROTOCOL_INVALID', '定义 payload layout NONE 时 repositories 必须为空');
  }
  return {
    schemaVersion: stringOrNull(record.schemaVersion),
    projectId: isUuid(record.projectId) ? record.projectId : null,
    layoutKind: layout.kind as WorkspaceLayoutKind,
    repositories,
    raw: value,
  };
}

export function parseDefinitionRepositories(value: unknown): DefinitionRepository[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new CliError('PROTOCOL_INVALID', '定义响应 repositories 必须是数组');
  return value.map((item, index) => {
    const record = asProtocolRecord(item, `定义响应 repositories[${index}] 必须是对象`);
    if (typeof record.key !== 'string' || !REPOSITORY_KEY.test(record.key))
      throw new CliError('PROTOCOL_INVALID', `定义响应 repositories[${index}].key 非法`);
    if (!isUuid(record.projectRepositoryId))
      throw new CliError(
        'PROTOCOL_INVALID',
        `定义响应 repositories[${index}].projectRepositoryId 不是 UUID`,
      );
    const locatorsValue = record.locators;
    if (locatorsValue !== undefined && locatorsValue !== null && !Array.isArray(locatorsValue))
      throw new CliError('PROTOCOL_INVALID', `定义响应 repositories[${index}].locators 非法`);
    const locators: DefinitionLocator[] = (locatorsValue ?? []).map(
      (locator: unknown, locatorIndex: number) => {
        const entry = asProtocolRecord(
          locator,
          `定义响应 repositories[${index}].locators[${locatorIndex}] 非法`,
        );
        if (typeof entry.canonicalLocator !== 'string' || !entry.canonicalLocator)
          throw new CliError('PROTOCOL_INVALID', '定义响应 locator.canonicalLocator 非法');
        return {
          id: isUuid(entry.id) ? entry.id : null,
          canonicalLocator: entry.canonicalLocator,
          source: stringOrNull(entry.source),
          declaredAt: stringOrNull(entry.declaredAt),
          revokedAt: stringOrNull(entry.revokedAt),
        };
      },
    );
    const provider =
      record.provider && typeof record.provider === 'object' && !Array.isArray(record.provider)
        ? (() => {
            const record2 = record.provider as Record<string, unknown>;
            return typeof record2.adapter === 'string' && typeof record2.externalId === 'string'
              ? { adapter: record2.adapter, externalId: record2.externalId }
              : null;
          })()
        : null;
    const identityMode =
      record.identityMode === 'DECLARED' || record.identityMode === 'PROVIDER'
        ? record.identityMode
        : null;
    const suggestedPath = (() => {
      if (record.suggestedPath === null || record.suggestedPath === undefined) return null;
      try {
        return assertWorkspaceRelativePath(record.suggestedPath, 'suggestedPath');
      } catch {
        return null;
      }
    })();
    return {
      key: record.key,
      projectRepositoryId: record.projectRepositoryId,
      suggestedPath,
      defaultRef: stringOrNull(record.defaultRef),
      description: stringOrNull(record.description),
      identityMode,
      adapter: stringOrNull(record.adapter),
      externalId: stringOrNull(record.externalId),
      owner: stringOrNull(record.owner),
      name: stringOrNull(record.name),
      archivedAt: stringOrNull(record.archivedAt),
      provider,
      locators,
    };
  });
}

/** The server digest covers payload, not the separately returned locator snapshot. */
export function assertRevisionRepositoryAssociation(
  payload: WorkspaceDefinitionPayload,
  repositories: DefinitionRepository[],
): void {
  const expected = new Map(payload.repositories.map((entry) => [entry.key, entry]));
  const seen = new Set<string>();
  if (expected.size !== payload.repositories.length || repositories.length !== expected.size)
    throw new CliError('CONTENT_INTEGRITY_FAILED', '定义仓库列表与 payload 不一致');
  for (const repository of repositories) {
    const entry = expected.get(repository.key);
    if (
      !entry ||
      seen.has(repository.key) ||
      entry.projectRepositoryId !== repository.projectRepositoryId ||
      entry.suggestedPath !== repository.suggestedPath
    )
      throw new CliError('CONTENT_INTEGRITY_FAILED', '定义仓库身份与 payload 不一致');
    seen.add(repository.key);
  }
}

function parseValidation(value: unknown): { valid: boolean; issues: DefinitionValidationIssue[] } {
  if (value === undefined || value === null) return { valid: true, issues: [] };
  const record = asProtocolRecord(value, '定义响应 validation 非法');
  const issues: DefinitionValidationIssue[] = Array.isArray(record.issues)
    ? record.issues.map((issue, index) => {
        const entry = asProtocolRecord(issue, `validation.issues[${index}] 非法`);
        return {
          path: typeof entry.path === 'string' ? entry.path : '/',
          code: typeof entry.code === 'string' ? entry.code : 'UNKNOWN',
          message: typeof entry.message === 'string' ? entry.message : '',
        };
      })
    : [];
  return { valid: record.valid !== false && issues.length === 0, issues };
}

/** GET /projects/:id/workspace-definition/revisions/:revisionId 响应。 */
export async function parseWorkspaceRevision(value: unknown): Promise<{
  revision: ResolvedWorkspaceDefinition;
  digestMatchesPayload: boolean;
  payloadPresent: boolean;
}> {
  const record = asProtocolRecord(value, 'revision 响应必须是对象');
  const nested =
    record.revision && typeof record.revision === 'object' && !Array.isArray(record.revision)
      ? (record.revision as Record<string, unknown>)
      : record;
  const revisionId = nested.revisionId ?? nested.definitionRevisionId;
  if (!isUuid(revisionId)) throw new CliError('PROTOCOL_INVALID', 'revisionId 不是 UUID');
  const digest = nested.digest ?? nested.payloadDigest;
  if (typeof digest !== 'string' || !SHA256.test(digest))
    throw new CliError('PROTOCOL_INVALID', 'revision digest 非法');
  if (!isUuidOrNull(nested.publishedByUserId ?? null))
    throw new CliError('PROTOCOL_INVALID', 'revision publishedByUserId 非法');
  const payloadPresent =
    nested.payload !== undefined && nested.payload !== null && typeof nested.payload === 'object';
  if (!payloadPresent) throw new CliError('PROTOCOL_INVALID', 'revision 缺少 payload');
  const payloadValue = nested.payload;
  const payload = parseDefinitionPayload(payloadValue);
  const payloadDigest = await definitionDigestOf(payloadValue);
  const repositories = parseDefinitionRepositories(nested.repositories ?? record.repositories);
  assertRevisionRepositoryAssociation(payload, repositories);
  return {
    revision: {
      revisionId,
      revisionNo: numberOrNull(nested.revisionNo),
      digest,
      publishedAt: stringOrNull(nested.publishedAt),
      payload,
      repositories,
      validation: parseValidation(nested.validation),
      definitionVersion: numberOrNull(nested.definitionVersion),
      projectVersion: numberOrNull(nested.projectVersion),
    },
    digestMatchesPayload: payloadDigest === digest,
    payloadPresent,
  };
}

/** GET /projects/:id/workspace-definition 响应（configured 或 NOT_CONFIGURED）。 */
export async function parseCurrentWorkspaceDefinition(value: unknown): Promise<{
  definitionStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
  projectId: string;
  revision: ResolvedWorkspaceDefinition | null;
  digestMatchesPayload: boolean;
}> {
  const record = asProtocolRecord(value, 'workspace-definition 响应必须是对象');
  if (!isUuid(record.projectId))
    throw new CliError('PROTOCOL_INVALID', 'workspace-definition projectId 不是 UUID');
  const status = record.definitionStatus;
  if (status === 'NOT_CONFIGURED')
    return {
      definitionStatus: 'NOT_CONFIGURED',
      projectId: record.projectId,
      revision: null,
      digestMatchesPayload: true,
    };
  if (status !== undefined && status !== 'CONFIGURED')
    throw new CliError('PROTOCOL_INVALID', `未知 definitionStatus：${String(status)}`);
  if (!isUuid(record.revisionId))
    throw new CliError('PROTOCOL_INVALID', 'workspace-definition revisionId 非法');
  const digest = record.digest;
  if (typeof digest !== 'string' || !SHA256.test(digest))
    throw new CliError('PROTOCOL_INVALID', 'workspace-definition digest 非法');
  const payloadPresent =
    record.payload !== undefined && record.payload !== null && typeof record.payload === 'object';
  if (!payloadPresent) throw new CliError('PROTOCOL_INVALID', 'workspace-definition 缺少 payload');
  const payload = parseDefinitionPayload(record.payload);
  const payloadDigest = await definitionDigestOf(record.payload);
  const repositories = parseDefinitionRepositories(record.repositories);
  assertRevisionRepositoryAssociation(payload, repositories);
  if (payload.projectId !== record.projectId)
    throw new CliError('CONTENT_INTEGRITY_FAILED', '定义 payload 项目与响应项目不一致');
  return {
    definitionStatus: 'CONFIGURED',
    projectId: record.projectId,
    revision: {
      revisionId: record.revisionId,
      revisionNo: numberOrNull(record.revisionNo),
      digest,
      publishedAt: stringOrNull(record.publishedAt),
      payload,
      repositories,
      validation: parseValidation(record.validation),
      definitionVersion: numberOrNull(record.definitionVersion),
      projectVersion: numberOrNull(record.projectVersion),
    },
    digestMatchesPayload: payloadDigest === digest,
  };
}

export type WorkspaceDefinitionCache = {
  schemaVersion: '1.0';
  revisionId: string;
  digest: string;
  fetchedAt: string;
  publishedAt: string | null;
  payload: unknown;
  repositories: DefinitionRepository[];
  validation: { valid: boolean; issues: DefinitionValidationIssue[] };
};

/** Local checksum detects accidental changes only; it is not an authenticated signature. */
export async function definitionCacheChecksum(cache: unknown): Promise<string> {
  return definitionDigestOf(cache);
}

export function definitionCacheFromRevision(
  revision: ResolvedWorkspaceDefinition,
  fetchedAt: string,
): WorkspaceDefinitionCache {
  return {
    schemaVersion: '1.0',
    revisionId: revision.revisionId,
    digest: revision.digest,
    fetchedAt,
    publishedAt: revision.publishedAt,
    payload: revision.payload.raw,
    repositories: revision.repositories,
    validation: revision.validation,
  };
}

export async function readDefinitionCache(
  dir: string,
  revisionId: string,
): Promise<{
  path: string;
  exists: boolean;
  cache: WorkspaceDefinitionCache | null;
  error: CliError | null;
}> {
  const path = workspaceDefinitionCachePath(dir, revisionId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { path, exists: false, cache: null, error: null };
    return {
      path,
      exists: true,
      cache: null,
      error: new CliError('CONFIG_SCHEMA_UNSUPPORTED', `无法读取定义缓存 ${path}`),
    };
  }
  try {
    const record = asProtocolRecord(JSON.parse(raw) as unknown, '定义缓存必须是对象');
    if (record.schemaVersion !== '1.0')
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '定义缓存 schemaVersion 必须是 1.0');
    if (record.revisionId !== revisionId || !isUuid(record.revisionId))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '定义缓存 revisionId 与文件名不一致');
    if (typeof record.digest !== 'string' || !SHA256.test(record.digest))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', '定义缓存 digest 非法');
    const { snapshotChecksum, ...snapshot } = record;
    if (
      typeof snapshotChecksum !== 'string' ||
      snapshotChecksum !== (await definitionCacheChecksum(snapshot))
    )
      throw new CliError(
        'CONTENT_INTEGRITY_FAILED',
        '定义缓存元数据校验失败或缺少校验；请在线刷新后再离线绑定',
      );
    const payloadDigest = await definitionDigestOf(record.payload);
    if (payloadDigest !== record.digest)
      return {
        path,
        exists: true,
        cache: null,
        error: new CliError(
          'CONTENT_INTEGRITY_FAILED',
          `定义缓存 ${path} 的 payload 摘要与 digest 不一致`,
        ),
      };
    const payload = parseDefinitionPayload(record.payload);
    const repositories = parseDefinitionRepositories(record.repositories);
    assertRevisionRepositoryAssociation(payload, repositories);
    const cache: WorkspaceDefinitionCache = {
      schemaVersion: '1.0',
      revisionId,
      digest: record.digest,
      fetchedAt: stringOrNull(record.fetchedAt) ?? '',
      publishedAt: stringOrNull(record.publishedAt),
      payload: record.payload,
      repositories,
      validation: parseValidation(record.validation),
    };
    return { path, exists: true, cache, error: null };
  } catch (error) {
    return {
      path,
      exists: true,
      cache: null,
      error:
        error instanceof CliError
          ? error
          : new CliError('CONFIG_SCHEMA_UNSUPPORTED', `定义缓存 ${path} 结构非法`),
    };
  }
}

export async function saveDefinitionCache(
  dir: string,
  cache: WorkspaceDefinitionCache,
): Promise<string> {
  const path = workspaceDefinitionCachePath(dir, cache.revisionId);
  await ensurePrivateDir(workspaceDefinitionsDir(dir));
  const snapshotChecksum = await definitionCacheChecksum(cache);
  await writePrivateFile(path, `${JSON.stringify({ ...cache, snapshotChecksum }, null, 2)}\n`);
  return path;
}

/** 普通文件的状态摘要（用于 status/inspect 展示，不读取为配置）。 */
export async function fileDigestIfExists(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    const raw = await readFile(path);
    return createHash('sha256').update(raw).digest('hex');
  } catch {
    return null;
  }
}
