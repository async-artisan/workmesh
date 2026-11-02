import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { canonicalJson } from '@workmesh/shared';
import { CliError } from './errors';
import { credentialsDir, ensurePrivateDir, pendingAuthorizationsDir } from './config';

export type AgentCredential = {
  version: '1.0';
  origin: string;
  apiBasePath: string;
  userId: string;
  credentialId: string;
  secret: string;
  projectId: string;
  roleId: string;
  roleKey: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

export type CredentialMatch = {
  origin: string;
  apiBasePath: string;
  projectId: string;
  roleKey?: string;
};

export type PendingAuthorization = {
  version: '1.0';
  authorizationId: string | null;
  deviceCode: string | null;
  codeVerifier: string;
  credentialSecret: string;
  createdAt: string;
};

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SCOPE = /^[a-z][a-z0-9:-]{0,47}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** 同一平台的受限凭据索引：origin/apiBasePath/user/project/role 的 SHA-256。 */
export function credentialKey(parts: {
  origin: string;
  apiBasePath: string;
  userId: string;
  projectId: string;
  roleId: string;
}): string {
  return createHash('sha256')
    .update(canonicalJson({ ...parts }), 'utf8')
    .digest('hex');
}

export function credentialPath(home: string, credential: AgentCredential): string {
  return join(credentialsDir(home), `${credentialKey(credential)}.json`);
}

function assertCredential(value: unknown): asserts value is AgentCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据文件结构非法');
  const record = value as Record<string, unknown>;
  for (const forbidden of ['accessToken', 'refreshToken', 'password', 'token', 'webSession']) {
    if (forbidden in record)
      throw new CliError('CREDENTIAL_STORE_UNSAFE', `凭据文件包含被禁止的字段 ${forbidden}`);
  }
  if (record.version !== '1.0') throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据版本不受支持');
  if (typeof record.origin !== 'string' || typeof record.apiBasePath !== 'string')
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据平台字段非法');
  if (typeof record.userId !== 'string' || !UUID.test(record.userId))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 userId 非法');
  if (typeof record.credentialId !== 'string' || !UUID.test(record.credentialId))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 credentialId 非法');
  if (typeof record.secret !== 'string' || !SECRET.test(record.secret))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 secret 非法');
  if (typeof record.projectId !== 'string' || !UUID.test(record.projectId))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 projectId 非法');
  if (typeof record.roleId !== 'string' || !UUID.test(record.roleId))
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 roleId 非法');
  if (typeof record.roleKey !== 'string')
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 roleKey 非法');
  if (
    !Array.isArray(record.scopes) ||
    record.scopes.length === 0 ||
    record.scopes.some((scope) => typeof scope !== 'string' || !SCOPE.test(scope))
  )
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据 scopes 非法');
  if (typeof record.createdAt !== 'string' || typeof record.expiresAt !== 'string')
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '凭据时间字段非法');
}

/** 读之前先拒绝 symlink、非当前 UID 与过宽权限，不修复后继续。 */
async function readProtectedFile(path: string): Promise<string> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    throw new CliError('AUTH_REQUIRED', '本地 Agent 凭据不存在，请运行 workmesh auth login');
  }
  if (info.isSymbolicLink())
    throw new CliError('CREDENTIAL_STORE_UNSAFE', `${path} 是符号链接，拒绝读取`);
  if (!info.isFile()) throw new CliError('CREDENTIAL_STORE_UNSAFE', `${path} 不是普通文件`);
  const owner = typeof process.getuid === 'function' ? process.getuid() : info.uid;
  if (info.uid !== owner)
    throw new CliError('CREDENTIAL_STORE_UNSAFE', `${path} 不属于当前用户，拒绝读取`);
  if ((info.mode & 0o077) !== 0)
    throw new CliError('CREDENTIAL_STORE_UNSAFE', `${path} 权限过宽，应为 0600`);
  return readFile(path, 'utf8');
}

async function writeProtectedFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await chmod(dirname(path), 0o700);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** bearer 只在内存中拼装：wm_a1.<credentialId>.<secret>。 */
export function bearerOf(credential: AgentCredential): string {
  return `wm_a1.${credential.credentialId}.${credential.secret}`;
}

export async function saveCredential(home: string, credential: AgentCredential): Promise<string> {
  assertCredential(credential);
  const path = credentialPath(home, credential);
  await writeProtectedFile(path, `${JSON.stringify(credential)}\n`);
  return path;
}

export async function loadCredentialFile(path: string): Promise<AgentCredential> {
  const raw = await readProtectedFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CREDENTIAL_STORE_UNSAFE', `${path} 不是合法 JSON`);
  }
  assertCredential(parsed);
  return parsed;
}

export async function listCredentials(home: string): Promise<AgentCredential[]> {
  let entries;
  try {
    entries = await readdir(credentialsDir(home), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new CliError('CREDENTIAL_STORE_UNSAFE', '无法读取凭据目录');
  }
  const credentials: AgentCredential[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    if (entry.isSymbolicLink())
      throw new CliError('CREDENTIAL_STORE_UNSAFE', `${entry.name} 是符号链接，拒绝读取`);
    credentials.push(await loadCredentialFile(join(credentialsDir(home), entry.name)));
  }
  return credentials;
}

export function isExpired(credential: AgentCredential, now = Date.now()): boolean {
  return Date.parse(credential.expiresAt) <= now;
}

/** 按平台 + 项目 + 角色找唯一受限凭据；过期、跨平台或跨项目的都不匹配。 */
export async function findCredential(
  home: string,
  match: CredentialMatch,
  now = Date.now(),
): Promise<AgentCredential> {
  const credentials = (await listCredentials(home)).filter(
    (credential) =>
      credential.origin === match.origin &&
      credential.apiBasePath === match.apiBasePath &&
      credential.projectId === match.projectId &&
      (match.roleKey ? credential.roleKey === match.roleKey : true) &&
      !isExpired(credential, now),
  );
  if (credentials.length === 0)
    throw new CliError(
      'AUTH_REQUIRED',
      `当前平台/项目/角色没有有效凭据，请运行 workmesh auth login --credential-store file`,
    );
  const sorted = credentials.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return sorted[0];
}

export async function removeCredentialFile(path: string): Promise<void> {
  await rm(path, { force: true });
}

export function pendingProofPath(home: string, id: string): string {
  return join(pendingAuthorizationsDir(home), `${id}.json`);
}

export async function savePendingProof(
  home: string,
  id: string,
  proof: PendingAuthorization,
): Promise<string> {
  await ensurePrivateDir(pendingAuthorizationsDir(home));
  const path = pendingProofPath(home, id);
  await writeProtectedFile(path, `${JSON.stringify(proof)}\n`);
  return path;
}

export async function removePendingProof(home: string, id: string): Promise<void> {
  await rm(pendingProofPath(home, id), { force: true });
}
