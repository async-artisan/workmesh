export type PlatformId = 'windows' | 'linux' | 'darwin';

export type ServiceManager = 'winsw' | 'systemd' | 'launchd';

export type ServiceCommands = {
  manager: ServiceManager;
  /** 服务定义文件路径（WinSW xml / systemd unit / launchd plist）。 */
  definitionPath: string;
  install: string[];
  start: string[];
  stop: string[];
  status: string[];
  uninstall: string[];
};

export type AdapterInput = {
  /** 用户 home，用于 macOS 的 ~/Library 路径；缺省时回退到环境变量。 */
  home?: string;
  env: NodeJS.ProcessEnv;
};

export type InstallInput = {
  installRoot: string;
  dataDir: string;
  port: number;
  /** 服务定义可能落在用户目录（launchd），缺省回退到 HOME。 */
  home?: string;
};

/**
 * 平台适配器：只放 OS 差异（路径、服务管理器、PG 二进制位置、TLS 提示）。
 * 业务逻辑（迁移、备份、健康检查）不允许出现 process.platform 分支。
 */
export type BoxAdapter = {
  id: PlatformId;
  label: string;
  dataDir(input: AdapterInput): string;
  installRoot(input: AdapterInput): string;
  service(input: InstallInput): ServiceCommands;
  /** PostgreSQL 客户端（pg_dump/psql）候选目录，按优先级排列。 */
  pgCandidates(input: { installRoot: string; dataDir: string; repoRoot: string | null }): string[];
  tlsHint(): string;
};
