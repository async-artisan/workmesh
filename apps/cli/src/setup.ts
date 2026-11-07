import { stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deviceLogin } from './auth';
import { assertRoleKey, hostSupported, resolvePlatform } from './config';
import { CliError } from './errors';
import { installRolePackage, readManifest, type InstallResult } from './roles';
import {
  detectWorkspaceState,
  dualConfigError,
  legacyWorkspaceView,
  v1MigrationRequiredError,
} from './workspace-config';

type Platform = ReturnType<typeof resolvePlatform>;
type Login = typeof deviceLogin;
type Install = typeof installRolePackage;
type ReadManifest = typeof readManifest;

export type SetupOptions = {
  workspaceDir: string;
  configHome: string;
  /** 业务角色 key，例如 backend */
  role: string;
  host?: string;
  api?: string;
  projectId?: string;
  packageDir?: string;
  rolesRoot?: string;
  clientName?: string;
  timeoutMs?: number;
  consent?: () => Promise<void>;
  preflight?: () => Promise<void>;
  onPrompt?: (prompt: { url: string; userCode: string; expiresAt: string }) => void;
  onNotice?: (text: string) => void;
  login?: Login;
  install?: Install;
  readManifest?: ReadManifest;
};

export type SetupResult = {
  roleKey: string;
  projectId: string;
  credentialId: string;
  packageId: string;
  version: string;
  packagePath: string;
  lockPath: string;
  workspaceConfigPath: string | null;
  files: string[];
  agentEntries: string[];
  reused: boolean;
};

/**
 * 角色包查找顺序：显式目录 → WORKMESH_ROLES_DIR → 发行包根目录的 roles/
 * → 仓库内 packages/role-packages/roles（开发态）→ 当前目录的 roles/。
 * 找不到就把搜过的路径全部列出来，避免“报错但不说去哪找”。
 */
export function defaultRoleRoots(
  execPath: string = process.execPath,
  modulePath: string = fileURLToPath(import.meta.url),
): string[] {
  const roots: string[] = [];
  const fromEnv = process.env.WORKMESH_ROLES_DIR;
  if (fromEnv) roots.push(resolve(fromEnv));
  // The Windows ZIP keeps node in runtime/ while role packages live at the
  // distribution root: runtime/node.exe, app/cli/index.js, roles/<role>/.
  roots.push(resolve(dirname(execPath), '..', 'roles'));
  roots.push(resolve(dirname(execPath), 'roles'));
  // Locate resources from the CLI as well as Node: users can run an extracted
  // CLI with their own Node, whose installation is unrelated to this release.
  const moduleDir = dirname(modulePath);
  roots.push(resolve(moduleDir, '..', 'roles'));
  roots.push(resolve(moduleDir, '..', '..', 'roles'));
  roots.push(resolve(moduleDir, '..', '..', '..', 'roles'));
  roots.push(resolve(moduleDir, '..', '..', '..', 'packages', 'role-packages', 'roles'));
  roots.push(resolve(process.cwd(), 'roles'));
  return [...new Set(roots)];
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return false;
    throw error;
  }
}

export async function resolveRolePackageDir(
  role: string,
  input: { packageDir?: string; rolesRoot?: string; roots?: string[] } = {},
): Promise<string> {
  const roots = input.roots ?? (input.rolesRoot ? [resolve(input.rolesRoot)] : defaultRoleRoots());
  if (input.packageDir) {
    const dir = resolve(input.packageDir);
    if (!(await isFile(join(dir, 'manifest.json')))) {
      let directoryExists = false;
      try {
        directoryExists = (await stat(dir)).isDirectory();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
      const candidates: string[] = [];
      for (const root of roots) {
        const candidate = join(root, role);
        if (await isFile(join(candidate, 'manifest.json'))) candidates.push(candidate);
      }
      const hint = candidates.length
        ? `；找到同角色包：${candidates[0]}。确认后修正 --package，或移除 --package 使用内置包`
        : '；请检查 --package，应指向包含 manifest.json 的角色包目录';
      throw new CliError(
        directoryExists ? 'PACKAGE_MANIFEST_INVALID' : 'PACKAGE_NOT_FOUND',
        (directoryExists ? `${dir} 下没有 manifest.json` : `角色包目录不存在：${dir}`) + hint,
      );
    }
    return dir;
  }
  const searched: string[] = [];
  for (const root of roots) {
    const dir = join(root, role);
    searched.push(dir);
    if (await isFile(join(dir, 'manifest.json'))) return dir;
  }
  throw new CliError(
    'PACKAGE_NOT_FOUND',
    `找不到角色包 ${role}（需要 ${role}/manifest.json）；已查找：\n${searched.map((item) => `  - ${item}`).join('\n')}`,
  );
}

async function loadWorkspaceIfPresent(
  dir: string,
): Promise<ReturnType<typeof legacyWorkspaceView> | undefined> {
  const snapshot = await detectWorkspaceState(dir);
  if (snapshot.state === 'DUAL_ACTIVE') throw dualConfigError(snapshot);
  if (snapshot.state === 'V1_ONLY') throw v1MigrationRequiredError('setup');
  return snapshot.v2.value ? legacyWorkspaceView(snapshot.v2.value) : undefined;
}

function agentEntryFiles(files: string[]): string[] {
  return files.filter(
    (path) =>
      path === 'AGENTS.md' ||
      path.startsWith('skills/') ||
      path.startsWith('.claude/') ||
      path.startsWith('.codex/'),
  );
}

/**
 * 一条命令完成“登录 + 装角色包 + 自检”。
 * 它只是把已有的 deviceLogin 与 installRolePackage 串起来，不新增协议：
 * 授权仍发生在浏览器，凭据仍落在本地文件，角色包仍做摘要校验。
 */
export async function runSetup(input: SetupOptions): Promise<SetupResult> {
  if (!hostSupported())
    throw new CliError('HOST_OS_UNSUPPORTED', '当前操作系统不支持安全的凭据文件存储');

  const role = assertRoleKey(input.role, '--role');
  // 先判定配置五态：DUAL_ACTIVE/V1_ONLY 在读/写角色包之前就拒绝。
  const workspace = await loadWorkspaceIfPresent(input.workspaceDir);
  const packageDir = await resolveRolePackageDir(role, {
    packageDir: input.packageDir,
    rolesRoot: input.rolesRoot,
  });
  const readManifestFn = input.readManifest ?? readManifest;
  const manifest = await readManifestFn(packageDir);
  if (manifest.roleKey !== role)
    throw new CliError(
      'PACKAGE_ROLE_MISMATCH',
      `角色包 ${packageDir} 的 roleKey 是 ${manifest.roleKey}，与 --role ${role} 不一致`,
    );

  const projectId = input.projectId ?? workspace?.projectId;
  if (!projectId)
    throw new CliError(
      'INVALID_REQUEST',
      '首次 setup 需要 --project <uuid>；项目 UUID 在项目页地址栏或邀请链接里',
    );
  const platform: Platform = resolvePlatform(workspace, input.api);

  if (input.preflight) await input.preflight();
  if (input.consent) await input.consent();
  const login = input.login ?? deviceLogin;
  const granted = await login({
    platform,
    configHome: input.configHome,
    projectId,
    roleKey: manifest.roleKey,
    clientName: input.clientName ?? 'workmesh-setup',
    timeoutMs: input.timeoutMs,
    onPrompt:
      input.onPrompt ??
      ((prompt) => {
        process.stderr.write(`在浏览器打开：${prompt.url}\n输入代码：${prompt.userCode}\n`);
        process.stderr.write(`有效期至 ${prompt.expiresAt}；CLI 会每 5 秒检查一次。\n`);
      }),
    onNotice: input.onNotice ?? ((text) => process.stderr.write(`${text}\n`)),
  });

  const credential = granted.credential;
  if (input.projectId && credential.projectId !== input.projectId)
    throw new CliError(
      'PROJECT_MISMATCH',
      `浏览器批准的是项目 ${credential.projectId}，与 --project ${input.projectId} 不一致；请重新授权并选择目标项目`,
    );
  if (credential.roleKey !== manifest.roleKey)
    throw new CliError(
      'ROLE_MISMATCH',
      `浏览器批准的角色是 ${credential.roleKey}，与角色包 ${manifest.roleKey} 不一致；请重新授权并选择「${manifest.roleKey}」`,
    );

  const install = input.install ?? installRolePackage;
  const installed: InstallResult = await install({
    packageDir,
    workspaceDir: input.workspaceDir,
    projectId: credential.projectId,
    host: input.host,
    api: input.api,
  });

  return {
    roleKey: installed.roleKey,
    projectId: credential.projectId,
    credentialId: credential.credentialId,
    packageId: installed.packageId,
    version: installed.version,
    packagePath: installed.packagePath,
    lockPath: installed.lockPath,
    workspaceConfigPath: installed.workspaceConfigPath ?? null,
    files: installed.files,
    agentEntries: agentEntryFiles(installed.files),
    reused: installed.reused,
  };
}
