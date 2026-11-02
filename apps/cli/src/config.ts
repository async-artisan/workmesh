import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CliError } from './errors';
import { parsePlatform, platformFromParts, type Platform } from './platform';

export const CONFIG_SCHEMA_VERSION = '1.0';
export const CLI_VERSION = '1.0.0';

export type WorkspaceHost = 'codex' | 'claude-code';

export type WorkspaceConfig = {
  schemaVersion: '1.0';
  profile: string;
  platform: Platform;
  projectId: string;
  roleKey: string;
  repositoryId: string | null;
  host: WorkspaceHost;
  workflowDefinitionRevisionId: string | null;
};

const ALLOWED_KEYS = new Set([
  'schemaVersion',
  'profile',
  'platform',
  'projectId',
  'roleKey',
  'repositoryId',
  'host',
  'workflowDefinitionRevisionId',
]);

const FORBIDDEN_KEYS = new Set([
  'apiUrl',
  'role',
  'specVersion',
  'accessToken',
  'refreshToken',
  'password',
  'secret',
  'token',
]);

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PROFILE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ROLE_KEY = /^[a-z][a-z0-9-]{0,47}$/;

export function assertUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new CliError('VALIDATION_FAILED', `${field} 必须是 UUID`);
  return value;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export function assertRoleKey(value: unknown, field = 'roleKey'): string {
  if (typeof value !== 'string' || !ROLE_KEY.test(value))
    throw new CliError('VALIDATION_FAILED', `${field} 必须匹配 ${ROLE_KEY.source}`);
  return value;
}

export function workspaceConfigPath(dir: string): string {
  return join(resolve(dir), '.workmesh', 'config.json');
}

/** 用户配置根默认 ~/.workmesh；显式 --config-home 必须为绝对路径，不从 workspace 改变。 */
export function configHome(explicit?: string): string {
  const value = explicit ?? process.env.WORKMESH_CONFIG_HOME ?? join(homedir(), '.workmesh');
  if (!isAbsolute(value)) throw new CliError('INVALID_REQUEST', '--config-home 必须是绝对路径');
  return resolve(value);
}

export function credentialsDir(home: string): string {
  return join(home, 'credentials');
}

export function pendingAuthorizationsDir(home: string): string {
  return join(home, 'pending-authorizations');
}

export function receiptsDir(workspaceDir: string): string {
  return join(resolve(workspaceDir), '.workmesh', 'local', 'receipts');
}

export function contextDir(workspaceDir: string): string {
  return join(resolve(workspaceDir), '.workmesh', 'context');
}

export function packagesDir(workspaceDir: string): string {
  return join(resolve(workspaceDir), '.workmesh', 'packages');
}

export function lockPath(workspaceDir: string): string {
  return join(resolve(workspaceDir), '.workmesh', 'lock.json');
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', message);
  return value as Record<string, unknown>;
}

/** 只接受固定字段；任何 token、apiUrl、旧 role/specVersion 字段都视为不支持。 */
export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  const record = asRecord(value, '工作区配置必须是 JSON 对象');
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_KEYS.has(key))
      throw new CliError(
        'CONFIG_SCHEMA_UNSUPPORTED',
        `旧配置字段 ${key} 不再受支持，请重新安装工作区`,
      );
    if (!ALLOWED_KEYS.has(key))
      throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `未知配置字段 ${key}`);
  }
  if (record.schemaVersion !== CONFIG_SCHEMA_VERSION)
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      `schemaVersion 必须为 ${CONFIG_SCHEMA_VERSION}`,
    );
  if (typeof record.profile !== 'string' || !PROFILE.test(record.profile))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'profile 必须是 1–48 位小写字母/数字/连字符');
  const platformRecord = asRecord(record.platform, 'platform 必须是对象');
  if (!('origin' in platformRecord) || !('apiBasePath' in platformRecord))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'platform 必须包含 origin 与 apiBasePath');
  if (typeof platformRecord.origin !== 'string' || typeof platformRecord.apiBasePath !== 'string')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'platform.origin/apiBasePath 必须是字符串');
  const platform = platformFromParts(platformRecord.origin, platformRecord.apiBasePath);
  const projectId = assertUuid(record.projectId, 'projectId');
  const roleKey = assertRoleKey(record.roleKey);
  if (record.repositoryId !== null && !isUuid(record.repositoryId))
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'repositoryId 必须是 UUID 或 null');
  if (record.host !== 'codex' && record.host !== 'claude-code')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'host 必须是 codex 或 claude-code');
  if (record.workflowDefinitionRevisionId !== null && !isUuid(record.workflowDefinitionRevisionId))
    throw new CliError(
      'CONFIG_SCHEMA_UNSUPPORTED',
      'workflowDefinitionRevisionId 必须是 UUID 或 null',
    );
  return {
    schemaVersion: '1.0',
    profile: record.profile,
    platform,
    projectId,
    roleKey,
    repositoryId: (record.repositoryId as string | null) ?? null,
    host: record.host,
    workflowDefinitionRevisionId: (record.workflowDefinitionRevisionId as string | null) ?? null,
  };
}

/** 读取工作区配置；不存在、权限不足与 JSON 无效分别报错，不静默回退 localhost。 */
export async function loadWorkspace(dir: string): Promise<WorkspaceConfig> {
  const path = workspaceConfigPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT')
      throw new CliError(
        'CONFIG_NOT_FOUND',
        `未找到 ${path}；请先运行 workmesh roles install --package <dir> --project <uuid> --host <codex|claude-code> --api <base>`,
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
  return parseWorkspaceConfig(parsed);
}

/** 原子写入工作区配置：临时文件 + 同目录 rename。 */
export async function saveWorkspace(dir: string, config: WorkspaceConfig): Promise<string> {
  const path = workspaceConfigPath(dir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o644 });
  await rename(temporary, path);
  return path;
}

/** 平台必须来自显式 --api 或工作区配置；缺失时明确失败。 */
export function resolvePlatform(config: WorkspaceConfig | undefined, api?: string): Platform {
  if (api) return parsePlatform(api);
  if (config) return config.platform;
  throw new CliError('INVALID_REQUEST', '缺少平台地址：请传 --api 或先安装工作区配置');
}

export function hostSupported(): boolean {
  return osPlatform() !== 'win32';
}

export async function ensurePrivateDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
