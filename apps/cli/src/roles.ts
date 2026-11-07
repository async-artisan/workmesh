import { lstat, readFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  canonicalJson,
  compareSemver,
  isStrictSemver,
  sha256Bytes,
  validateRolePackageManifest,
  PROTOCOL_VERSION,
  type RolePackageManifest,
} from '@workmesh/shared';
import { CliError } from './errors';
import {
  CLI_VERSION,
  assertRoleKey,
  ensurePrivateDir,
  lockPath,
  packagesDir,
  parseWorkspaceConfig,
  resolvePlatform,
  saveWorkspace,
  type WorkspaceConfig,
  type WorkspaceHost,
} from './config';
import { writePrivateFile } from './private-fs';
import {
  detectWorkspaceState,
  dualConfigError,
  legacyWorkspaceView,
  v1MigrationRequiredError,
} from './workspace-config';

export type InstalledFile = { path: string; sha256: string; kind: string };

export type InstallResult = {
  packageId: string;
  version: string;
  roleKey: string;
  manifestDigest: string;
  packagePath: string;
  lockPath: string;
  workspaceConfigPath?: string;
  files: string[];
  reused: boolean;
};

export type RoleLock = {
  schemaVersion: '1.0';
  protocolVersion: typeof PROTOCOL_VERSION;
  packageLocks: Array<{
    roleKey: string;
    packageId: string;
    version: string;
    packageDigest: string;
  }>;
  workflowDefinitionRevisionId: string | null;
  projectResourceDigests: Record<string, string>;
  hostAdapters: Record<string, string>;
  managedFiles: InstalledFile[];
};

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('PACKAGE_MANIFEST_INVALID', message);
  return value as Record<string, unknown>;
}

function safeRelativePath(value: string): string {
  if (!value || value.startsWith('/') || isAbsolute(value) || value.includes('\\'))
    throw new CliError('PACKAGE_MANIFEST_INVALID', `资源路径非法：${value}`);
  const segments = value.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..'))
    throw new CliError('PACKAGE_MANIFEST_INVALID', `资源路径不能是绝对路径或包含点段：${value}`);
  if (/(?:^|\/)(?:\.env|env_private|tempConfig)/i.test(value))
    throw new CliError('PACKAGE_MANIFEST_INVALID', `资源路径不允许包含环境或临时配置：${value}`);
  return segments.join('/');
}

function validateManifest(value: unknown): RolePackageManifest {
  if (!validateRolePackageManifest(value)) {
    const issues = (validateRolePackageManifest.errors ?? []).map((error) => ({
      path: error.instancePath || '/',
      message: error.message ?? 'invalid',
    }));
    throw new CliError('PACKAGE_MANIFEST_INVALID', '角色包 manifest 校验失败', {
      details: { issues },
    });
  }
  const manifest = value as RolePackageManifest;
  if (manifest.protocolVersion !== PROTOCOL_VERSION)
    throw new CliError(
      'PACKAGE_INCOMPATIBLE',
      `协议版本 ${manifest.protocolVersion} 与 CLI 不一致`,
    );
  if (!isStrictSemver(manifest.version) || !isStrictSemver(manifest.compatibility.minCliVersion))
    throw new CliError('PACKAGE_MANIFEST_INVALID', '版本号必须是严格 SemVer');
  try {
    if (
      compareSemver(CLI_VERSION, manifest.compatibility.minCliVersion) < 0 ||
      compareSemver(CLI_VERSION, manifest.compatibility.maxCliVersionExclusive) >= 0
    )
      throw new CliError(
        'PACKAGE_INCOMPATIBLE',
        `CLI ${CLI_VERSION} 不在角色包允许范围 [${manifest.compatibility.minCliVersion}, ${manifest.compatibility.maxCliVersionExclusive})`,
      );
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('PACKAGE_MANIFEST_INVALID', '角色包兼容版本号非法');
  }
  assertRoleKey(manifest.roleKey, 'manifest.roleKey');
  return manifest;
}

export async function readManifest(packageDir: string): Promise<RolePackageManifest> {
  let raw: string;
  try {
    raw = await readFile(join(packageDir, 'manifest.json'), 'utf8');
  } catch {
    throw new CliError('PACKAGE_MANIFEST_INVALID', `未找到 ${join(packageDir, 'manifest.json')}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('PACKAGE_MANIFEST_INVALID', 'manifest.json 不是合法 JSON');
  }
  return validateManifest(parsed);
}

type VerifiedResource = {
  id: string;
  path: string;
  sha256: string;
  byteLength: number;
  bytes: Buffer;
};

export async function verifyResources(
  packageDir: string,
  manifest: RolePackageManifest,
): Promise<VerifiedResource[]> {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const verified: VerifiedResource[] = [];
  for (const resource of manifest.resources) {
    if (ids.has(resource.id))
      throw new CliError('PACKAGE_MANIFEST_INVALID', `资源 id 重复：${resource.id}`);
    if (paths.has(resource.path))
      throw new CliError('PACKAGE_MANIFEST_INVALID', `资源 path 重复：${resource.path}`);
    ids.add(resource.id);
    const path = safeRelativePath(resource.path);
    paths.add(path);
    const absolute = join(packageDir, path);
    let info;
    try {
      info = await lstat(absolute);
    } catch {
      throw new CliError('PACKAGE_TAMPERED', `资源缺失：${resource.path}`);
    }
    if (info.isSymbolicLink())
      throw new CliError('PACKAGE_TAMPERED', `资源是符号链接：${resource.path}`);
    if (!info.isFile())
      throw new CliError('PACKAGE_TAMPERED', `资源不是普通文件：${resource.path}`);
    const bytes = Buffer.from(await readFile(absolute));
    const digest = await sha256Bytes(new Uint8Array(bytes));
    if (bytes.length !== resource.byteLength || digest !== resource.sha256)
      throw new CliError('PACKAGE_TAMPERED', `资源长度或摘要不匹配：${resource.path}`, {
        details: { expected: resource.sha256, actual: digest },
      });
    verified.push({
      id: resource.id,
      path,
      sha256: resource.sha256,
      byteLength: resource.byteLength,
      bytes,
    });
  }
  return verified;
}

function emptyLock(): RoleLock {
  return {
    schemaVersion: '1.0',
    protocolVersion: PROTOCOL_VERSION,
    packageLocks: [],
    workflowDefinitionRevisionId: null,
    projectResourceDigests: {},
    hostAdapters: {},
    managedFiles: [],
  };
}

async function readLock(path: string): Promise<RoleLock> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLock();
    throw new CliError('CONTENT_INTEGRITY_FAILED', `无法读取 ${path}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CliError('CONTENT_INTEGRITY_FAILED', `${path} 不是合法 JSON`);
  }
  const record = asRecord(parsed, `${path} 结构非法`);
  if (record.schemaVersion !== '1.0')
    throw new CliError('CONFIG_SCHEMA_UNSUPPORTED', `${path} 版本不受支持`);
  if (!Array.isArray(record.packageLocks))
    throw new CliError('CONTENT_INTEGRITY_FAILED', `${path} 缺少 packageLocks`);
  return {
    ...emptyLock(),
    ...(record as unknown as RoleLock),
    workflowDefinitionRevisionId:
      typeof record.workflowDefinitionRevisionId === 'string'
        ? record.workflowDefinitionRevisionId
        : null,
  };
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await writePrivateFile(path, content, { flag: 'wx' });
}

async function assertInstalledCopy(target: string, resources: VerifiedResource[]): Promise<void> {
  for (const resource of resources) {
    let info;
    try {
      info = await lstat(join(target, resource.path));
    } catch {
      throw new CliError('LOCAL_MANAGED_FILE_MODIFIED', `受管文件缺失：${resource.path}`);
    }
    if (info.isSymbolicLink())
      throw new CliError('LOCAL_MANAGED_FILE_MODIFIED', `受管文件是符号链接：${resource.path}`);
    const digest = await sha256Bytes(new Uint8Array(await readFile(join(target, resource.path))));
    if (digest !== resource.sha256)
      throw new CliError(
        'LOCAL_MANAGED_FILE_MODIFIED',
        `受管文件 ${resource.path} 已被本地修改；请导出修改或换目录安装，不能静默覆盖`,
      );
  }
}

function hostOf(manifest: RolePackageManifest, requested?: string): WorkspaceHost {
  if (requested === 'codex' || requested === 'claude-code') return requested;
  if (requested) throw new CliError('VALIDATION_FAILED', '--host 必须是 codex 或 claude-code');
  const first = manifest.agentEntries[0]?.host;
  if (first === 'codex' || first === 'claude-code') return first;
  throw new CliError('PACKAGE_MANIFEST_INVALID', '角色包没有支持的宿主入口');
}

/**
 * 完整校验后才构建 staging，最后原子 rename；同版本同摘要重复安装不改 bytes/mtime，
 * 本地受管文件被修改或同版本换摘要都拒绝覆盖。
 */
export async function installRolePackage(options: {
  packageDir: string;
  workspaceDir: string;
  projectId?: string;
  host?: string;
  api?: string;
  now?: Date;
}): Promise<InstallResult> {
  const packageDir = resolve(options.packageDir);
  const workspaceDir = resolve(options.workspaceDir);
  // v1→v2 五态先判定：V1_ONLY 的写命令要求先迁移，DUAL_ACTIVE 拒绝自动选择。
  const snapshot = await detectWorkspaceState(workspaceDir);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.state === 'V1_ONLY') throw v1MigrationRequiredError('roles install');
  const existingWorkspace: WorkspaceConfig | undefined = snapshot.v2.value
    ? legacyWorkspaceView(snapshot.v2.value)
    : undefined;
  const manifest = await readManifest(packageDir);
  const resources = await verifyResources(packageDir, manifest);
  const manifestDigest = await sha256Bytes(new TextEncoder().encode(canonicalJson(manifest)));

  const lock = await readLock(lockPath(workspaceDir));
  const existing = lock.packageLocks.find(
    (entry) => entry.packageId === manifest.id && entry.version === manifest.version,
  );
  if (existing && existing.packageDigest !== manifestDigest)
    throw new CliError(
      'PACKAGE_TAMPERED',
      `已登记 ${manifest.id}@${manifest.version} 的摘要不同；同版本不能替换内容`,
    );

  // 首次安装/角色一致性与目标目录检查都在写入前完成，失败不留下半装状态。
  let pendingWorkspace: WorkspaceConfig | undefined;
  if (!existingWorkspace) {
    if (!options.projectId) throw new CliError('INVALID_REQUEST', '首次安装需要 --project <uuid>');
    if (!options.api) throw new CliError('INVALID_REQUEST', '首次安装需要 --api <base>');
    pendingWorkspace = parseWorkspaceConfig({
      schemaVersion: '1.0',
      profile: 'default',
      platform: resolvePlatform(undefined, options.api),
      projectId: options.projectId,
      roleKey: manifest.roleKey,
      repositoryId: null,
      host: hostOf(manifest, options.host),
      workflowDefinitionRevisionId: null,
    });
  } else if (existingWorkspace.roleKey !== manifest.roleKey) {
    throw new CliError(
      'LOCAL_INPUT_INVALID',
      `工作区角色 ${existingWorkspace.roleKey} 与角色包 ${manifest.roleKey} 不一致；请安装匹配的角色包`,
    );
  }

  const root = packagesDir(workspaceDir);
  await ensurePrivateDir(root);
  const target = join(root, manifest.id, manifest.version);
  let reused = false;
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink())
      throw new CliError('LOCAL_MANAGED_FILE_MODIFIED', `${target} 是符号链接，拒绝覆盖`);
    await assertInstalledCopy(target, resources);
    reused = true;
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (!reused) {
    const staging = join(root, `.staging-${randomUUID()}`);
    try {
      for (const resource of resources) {
        const path = join(staging, resource.path);
        await writePrivateFile(path, resource.bytes);
      }
      await ensurePrivateDir(dirname(target));
      await rename(staging, target);
    } catch (error) {
      await rm(staging, { recursive: true, force: true });
      throw error;
    }
  }

  const packageLocks = [
    ...lock.packageLocks.filter(
      (entry) => !(entry.packageId === manifest.id && entry.version === manifest.version),
    ),
    {
      roleKey: manifest.roleKey,
      packageId: manifest.id,
      version: manifest.version,
      packageDigest: manifestDigest,
    },
  ].sort((left, right) =>
    `${left.packageId}@${left.version}`.localeCompare(`${right.packageId}@${right.version}`),
  );

  const files = resources.map((resource) => ({
    path: relative(workspaceDir, join(target, resource.path)).split('\\').join('/'),
    sha256: resource.sha256,
    kind: 'ROLE_PACKAGE_RESOURCE',
  }));
  const managedFiles = [
    ...lock.managedFiles.filter(
      (entry) => !entry.path.startsWith(`.workmesh/packages/${manifest.id}/`),
    ),
    ...files,
  ];
  const nextLock: RoleLock = {
    ...lock,
    packageLocks,
    managedFiles,
  };
  await writeAtomic(lockPath(workspaceDir), `${JSON.stringify(nextLock, null, 2)}\n`);

  let workspaceConfigPath: string | undefined;
  if (pendingWorkspace) workspaceConfigPath = await saveWorkspace(workspaceDir, pendingWorkspace);

  return {
    packageId: manifest.id,
    version: manifest.version,
    roleKey: manifest.roleKey,
    manifestDigest,
    packagePath: target,
    lockPath: lockPath(workspaceDir),
    ...(workspaceConfigPath ? { workspaceConfigPath } : {}),
    files: resources.map((resource) => join(target, resource.path)),
    reused,
  };
}
