import { access, constants, mkdtemp, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CLI_VERSION, assertRoleKey } from './config';
import { findCredential } from './credential-store';
import { CliError } from './errors';
import { parsePlatform, type Platform } from './platform';
import {
  currentPrincipal,
  IS_WINDOWS,
  windowsSystemTool,
  writePrivateFile,
  verifyWindowsPath,
} from './private-fs';
import { readManifest, verifyResources } from './roles';
import { resolveRolePackageDir } from './setup';
import { detectWorkspaceState, type WorkspaceConfigV2 } from './workspace-config';
import type { FetchLike } from './client';

export type DoctorCheck = {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  nextAction?: string;
};
export type DoctorReport = {
  ok: boolean;
  cli: { version: string; executable: string; node: string; runtime: string };
  workspaceDir: string;
  platform: Platform | null;
  projectId: string | null;
  role: string | null;
  checks: DoctorCheck[];
  writes: string[];
};
export type DoctorOptions = {
  workspaceDir: string;
  configHome: string;
  api?: string;
  role?: string;
  packageDir?: string;
  /** Readiness is an unauthenticated GET; no login or one-time code is sent. */
  online?: boolean;
  /** Explicit temporary permission probe; removed before returning. */
  probeStorage?: boolean;
  checkPackage?: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
  nodeVersion?: string;
};

export function supportedNode(version: string): boolean {
  const match = /^v?(\d+)\.(\d+)\./.exec(version);
  if (!match) return false;
  return Number(match[1]) > 20 || (Number(match[1]) === 20 && Number(match[2]) >= 19);
}

async function writableAncestor(path: string): Promise<string> {
  let current = resolve(path);
  while (true) {
    try {
      const info = await stat(current);
      if (!info.isDirectory())
        throw new CliError('INVALID_REQUEST', '凭据目录的现有父路径不是目录');
      await access(current, constants.W_OK);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export function readinessUrl(platform: Platform): string {
  return `${platform.origin}${platform.apiBasePath.slice(0, -3)}/health/ready`;
}

/** Read-only by default. Each independent failure is retained in the same report. */
export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const root = resolve(options.workspaceDir);
  const node = options.nodeVersion ?? process.version;
  const report: DoctorReport = {
    ok: false,
    cli: {
      version: CLI_VERSION,
      executable: resolve(process.argv[1] ?? process.execPath),
      node,
      runtime: process.execPath,
    },
    workspaceDir: root,
    platform: null,
    projectId: null,
    role: options.role ?? null,
    checks,
    writes: [],
  };
  async function check(
    id: string,
    nextAction: string,
    action: () => Promise<DoctorCheck> | DoctorCheck,
  ): Promise<void> {
    try {
      checks.push(await action());
    } catch (error) {
      // Child output, response bodies and credential values never enter diagnostics.
      const code = error instanceof CliError ? error.code : (error as NodeJS.ErrnoException).code;
      checks.push({
        id,
        status: 'fail',
        message: `${id}检查失败${typeof code === 'string' ? `（${code}）` : ''}`,
        nextAction,
      });
    }
  }
  await Promise.all([
    check('runtime', '请使用发行包自带 Node，或安装 Node.js 20.19 及以上版本。', () => ({
      id: 'runtime',
      status: supportedNode(node) ? 'pass' : 'fail',
      message: `Node ${node}；CLI ${CLI_VERSION}；程序 ${report.cli.executable}`,
      ...(!supportedNode(node)
        ? { nextAction: '请使用发行包自带 Node，或安装 Node.js 20.19 及以上版本。' }
        : {}),
    })),
    check('directory', `确认目标业务目录存在且可写：${root}`, async () => {
      if (!(await stat(root)).isDirectory()) throw new CliError('INVALID_REQUEST', '目标不是目录');
      await access(root, constants.W_OK);
      return { id: 'directory', status: 'pass', message: `业务工作目录：${root}` };
    }),
    check('system-tools', '检查 Windows 系统工具是否完整；无需调整 Git Bash PATH。', async () => {
      if (!IS_WINDOWS)
        return { id: 'system-tools', status: 'pass', message: '使用 POSIX 文件权限。' };
      const identity = windowsSystemTool('whoami');
      const acl = windowsSystemTool('icacls');
      await Promise.all([access(identity, constants.X_OK), access(acl, constants.X_OK)]);
      await currentPrincipal();
      return {
        id: 'system-tools',
        status: 'pass',
        message: `Windows 原生工具：${identity}；${acl}`,
      };
    }),
    check(
      'credential-storage',
      '检查 --config-home 的父目录权限；可运行 doctor --check-storage 验证临时文件权限。',
      async () => {
        const parent = await writableAncestor(options.configHome);
        if (!options.probeStorage)
          return {
            id: 'credential-storage',
            status: 'warn',
            message: '凭据目录父路径可写；尚未实际创建私有文件。',
            nextAction: 'doctor --check-storage 可使用临时文件验证权限，不写入凭据。',
          };
        const temporary = await mkdtemp(join(parent, '.workmesh-permission-probe-'));
        try {
          const path = join(temporary, 'private', 'probe');
          await writePrivateFile(path, 'permission probe\n');
          if (IS_WINDOWS) await verifyWindowsPath(path);
          else if (((await stat(path)).mode & 0o777) !== 0o600)
            throw new CliError('CREDENTIAL_STORE_UNSAFE', '权限检查失败');
        } finally {
          await rm(temporary, { recursive: true, force: true });
        }
        report.writes.push('已移除的临时权限探针（未写入凭据或工作区）');
        return {
          id: 'credential-storage',
          status: 'pass',
          message: '临时私有文件权限检查通过；目标凭据文件仍在保存时收紧权限。',
        };
      },
    ),
  ]);
  let workspace: { platform: Platform; projectId: string; role: string | null } | null = null;
  await check(
    'workspace',
    '运行 workmesh workspace status；配置冲突请先 workspace migrate --inspect。',
    async () => {
      const snapshot = await detectWorkspaceState(root);
      if (snapshot.state === 'DUAL_ACTIVE')
        throw new CliError('WORKSPACE_DUAL_CONFIG', '存在双配置');
      if (snapshot.v1.exists && !snapshot.v1.valid)
        throw snapshot.v1.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'v1 配置无效');
      if (snapshot.v2.exists && !snapshot.v2.valid)
        throw snapshot.v2.error ?? new CliError('CONFIG_SCHEMA_UNSUPPORTED', 'v2 配置无效');
      const v2: WorkspaceConfigV2 | null = snapshot.v2.value;
      if (v2)
        workspace = { platform: v2.platform, projectId: v2.projectId, role: v2.defaults.roleKey };
      else if (snapshot.v1.value)
        workspace = {
          platform: snapshot.v1.value.platform,
          projectId: snapshot.v1.value.projectId,
          role: snapshot.v1.value.roleKey,
        };
      if (snapshot.journalError)
        return {
          id: 'workspace',
          status: 'warn',
          message: `工作区配置状态：${snapshot.state}；迁移记录无法解析。`,
          nextAction: '运行 workmesh workspace migrate --inspect 核对迁移记录。',
        };
      return {
        id: 'workspace',
        status: snapshot.state === 'NONE' || snapshot.state === 'V1_ONLY' ? 'warn' : 'pass',
        message: `工作区配置状态：${snapshot.state}`,
        ...(snapshot.state === 'V1_ONLY'
          ? { nextAction: '运行 workmesh workspace migrate --dry-run 查看迁移计划。' }
          : {}),
      };
    },
  );
  const active = workspace as { platform: Platform; projectId: string; role: string | null } | null;
  report.projectId = active?.projectId ?? null;
  report.role = options.role ?? active?.role ?? null;
  await check('platform', '使用项目接入页提供的 API 地址，通过 --api 显式指定。', () => {
    report.platform = options.api ? parsePlatform(options.api) : (active?.platform ?? null);
    if (
      active &&
      report.platform &&
      (active.platform.origin !== report.platform.origin ||
        active.platform.apiBasePath !== report.platform.apiBasePath)
    ) {
      report.platform = null;
      throw new CliError('AUTH_REQUIRED', '平台与已有绑定不一致');
    }
    return {
      id: 'platform',
      status: report.platform ? 'pass' : 'warn',
      message: report.platform
        ? `平台：${report.platform.origin}${report.platform.apiBasePath}`
        : '尚未指定平台；未执行服务连接检查。',
    };
  });
  await Promise.all([
    check(
      'role-package',
      '普通内置角色无需 --package；请确认发行包完整，自定义包请核对目录与 manifest。',
      async () => {
        if (options.checkPackage === false)
          return {
            id: 'role-package',
            status: 'warn',
            message: '当前接入只绑定工作区定义；角色包资源由后续角色安装流程检查。',
          };
        if (!report.role)
          return {
            id: 'role-package',
            status: 'warn',
            message: '尚未选择角色；可添加 --role frontend 检查内置资源。',
          };
        const role = assertRoleKey(report.role, '--role');
        const packageDir = await resolveRolePackageDir(role, { packageDir: options.packageDir });
        const manifest = await readManifest(packageDir);
        if (manifest.roleKey !== role)
          throw new CliError('PACKAGE_ROLE_MISMATCH', '角色与清单不一致');
        await verifyResources(packageDir, manifest);
        return {
          id: 'role-package',
          status: 'pass',
          message: `${role}：${manifest.id}@${manifest.version}；${packageDir}（资源摘要已校验）`,
        };
      },
    ),
    check(
      'service',
      '确认 WorkMesh 已启动且 --api 指向正确实例；服务依赖异常请联系平台维护者。',
      async () => {
        const platform = report.platform;
        if (!options.online || !platform)
          return {
            id: 'service',
            status: 'warn',
            message: '未执行联网检查；添加 --online 并提供 --api 可检查服务就绪状态。',
          };
        const timeoutMs = options.timeoutMs ?? 5000;
        const response = await (options.fetch ?? fetch)(readinessUrl(platform), {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json' },
        });
        if (!response.ok)
          return {
            id: 'service',
            status: 'fail',
            message: `服务就绪检查失败（HTTP ${response.status}）。`,
            nextAction: '核对 API 地址和反向代理；503 表示平台依赖尚未就绪。',
          };
        const payload: unknown = await response.json();
        const envelope =
          payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
        const data = envelope.data ?? envelope;
        if (!data || typeof data !== 'object' || (data as Record<string, unknown>).ok !== true)
          throw new CliError('PROTOCOL_INVALID', '服务未返回 WorkMesh readiness 格式');
        return {
          id: 'service',
          status: 'pass',
          message: 'WorkMesh 服务就绪；本检查不代表项目权限、角色或版本兼容性已验证。',
        };
      },
    ),
    check(
      'credential',
      '检查 --config-home 下凭据文件的完整性和私有权限；运行 workmesh auth status 查看授权。',
      async () => {
        if (!active || !active.role)
          return {
            id: 'credential',
            status: 'warn',
            message: '工作区尚无完整绑定；项目和角色权限将在设备授权时校验。',
          };
        try {
          const credential = await findCredential(options.configHome, {
            origin: active.platform.origin,
            apiBasePath: active.platform.apiBasePath,
            projectId: active.projectId,
            roleKey: report.role ?? active.role,
          });
          return {
            id: 'credential',
            status: 'pass',
            message: `本地授权有效期至 ${credential.expiresAt}；服务端撤销状态需在线授权检查。`,
          };
        } catch (error) {
          if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') throw error;
          return {
            id: 'credential',
            status: 'warn',
            message: '未找到可用的匹配凭据；接入或登录时仍需浏览器批准。',
            nextAction: '已有绑定运行 workmesh auth login；首次接入使用项目页的一次性接入码。',
          };
        }
      },
    ),
  ]);
  const order = [
    'runtime',
    'directory',
    'system-tools',
    'credential-storage',
    'workspace',
    'platform',
    'role-package',
    'service',
    'credential',
  ];
  checks.sort((left, right) => order.indexOf(left.id) - order.indexOf(right.id));
  report.ok = checks.every((item) => item.status !== 'fail');
  return report;
}

export function assertDoctorReady(report: DoctorReport): void {
  const failed = report.checks.filter((item) => item.status === 'fail');
  if (failed.length === 0) return;
  throw new CliError(
    'PREFLIGHT_FAILED',
    `接入前检查未通过；未开始授权或消费接入码。\n${failed.map((item) => `${item.message}\n下一步：${item.nextAction ?? '运行 workmesh doctor 查看诊断。'}`).join('\n')}`,
    { exitCode: 2, details: { checks: report.checks, enrollmentConsumed: false } },
  );
}

export function renderDoctor(report: DoctorReport): string[] {
  return [
    `WorkMesh ${report.cli.version}；工作目录 ${report.workspaceDir}`,
    ...report.checks.flatMap((item) => [
      `${item.status === 'pass' ? '✓' : item.status === 'warn' ? '!' : '✗'} ${item.message}`,
      ...(item.nextAction ? [`  下一步：${item.nextAction}`] : []),
    ]),
    report.ok
      ? '本次检查无阻塞项；授权与仓库身份以接入流程的实际校验为准。'
      : '请处理上述失败项后重试。',
  ];
}
