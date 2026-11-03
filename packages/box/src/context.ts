import { homedir } from 'node:os';
import { adapterFor, type BoxAdapter } from './adapters';
import {
  describeDatabase,
  findRepoRoot,
  resolveDatabaseUrl,
  type DatabaseTarget,
} from './lib/config';
import { findPgTools, type PgTools } from './lib/pg';

export type BoxOverrides = {
  dataDir?: string;
  installRoot?: string;
  databaseUrl?: string;
  apiPort?: number;
  webPort?: number;
};

export type BoxContext = {
  adapter: BoxAdapter;
  repoRoot: string | null;
  dataDir: string;
  installRoot: string;
  apiPort: number;
  webPort: number;
  databaseUrl: string | null;
  database: DatabaseTarget | null;
  pg: PgTools | null;
  env: NodeJS.ProcessEnv;
  now: Date;
};

/**
 * 一次解析所有运行参数：平台适配器、目录、端口、连接串、PG 客户端。
 * 命令只消费 ctx，不再各自读 process.env 或拼路径。
 */
export function buildContext(
  input: {
    env?: NodeJS.ProcessEnv;
    home?: string;
    platform?: NodeJS.Platform;
    overrides?: BoxOverrides;
    now?: Date;
  } = {},
): BoxContext {
  const env = input.env ?? process.env;
  const home = input.home ?? homedir();
  const adapter = adapterFor(input.platform ?? process.platform);
  const overrides = input.overrides ?? {};
  const dataDir = overrides.dataDir ?? adapter.dataDir({ home, env });
  const installRoot = overrides.installRoot ?? adapter.installRoot({ home, env });
  const repoRoot = findRepoRoot();
  const databaseUrl = overrides.databaseUrl ?? resolveDatabaseUrl({ env, repoRoot });
  const database = databaseUrl ? describeDatabase(databaseUrl) : null;
  const pg = findPgTools(adapter.pgCandidates({ installRoot, dataDir, repoRoot }), env);
  return {
    adapter,
    repoRoot,
    dataDir,
    installRoot,
    apiPort: overrides.apiPort ?? Number(env.PORT ?? 3000),
    webPort: overrides.webPort ?? 5173,
    databaseUrl,
    database,
    pg,
    env,
    now: input.now ?? new Date(),
  };
}
