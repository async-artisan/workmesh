import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 从模块位置向上找 pnpm-workspace.yaml，兼容源码运行与 dist 运行。 */
export function findRepoRoot(start = dirname(fileURLToPath(import.meta.url))): string | null {
  let current = resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

/** 开发态从 apps/api/.env 读连接串；打包后由 config.env/env 提供。 */
export function readApiEnv(repoRoot: string | null): Record<string, string> {
  if (!repoRoot) return {};
  const file = join(repoRoot, 'apps', 'api', '.env');
  if (!existsSync(file)) return {};
  try {
    return parseEnvFile(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function resolveDatabaseUrl(input: {
  env: NodeJS.ProcessEnv;
  repoRoot: string | null;
}): string | null {
  if (input.env.WORKMESH_V1_DATABASE_URL) return input.env.WORKMESH_V1_DATABASE_URL;
  const apiEnv = readApiEnv(input.repoRoot);
  return apiEnv.WORKMESH_V1_DATABASE_URL ?? null;
}

export type DatabaseTarget = {
  url: string;
  maskedUrl: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  schema: string | null;
};

/** 解析连接串；输出只用于展示的 maskedUrl 永远不含密码。 */
export function describeDatabase(url: string): DatabaseTarget {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '')) || 'postgres';
  return {
    url,
    maskedUrl: maskUrl(url),
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 5432,
    database,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    schema: parsed.searchParams.get('schema'),
  };
}

export function maskUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid-url>';
  }
}

/** 管理连接：同一实例、同一凭据，换到 postgres 库执行 CREATE DATABASE。 */
export function adminUrlOf(target: DatabaseTarget, adminDatabase = 'postgres'): string {
  const parsed = new URL(target.url);
  parsed.pathname = `/${adminDatabase}`;
  parsed.searchParams.delete('schema');
  return parsed.toString();
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/**
 * libpq（pg_dump / psql）只认识自己的连接参数：Prisma 的 `?schema=` 会被判为
 * invalid URI query parameter，所以调用 PG 客户端前先去掉 schema，保留 sslmode 等参数。
 */
export function libpqUrlOf(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}
