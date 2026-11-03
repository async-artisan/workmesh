import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { adminUrlOf, libpqUrlOf, withDatabase, type DatabaseTarget } from './config';

export type PgTools = {
  /** null 表示来自 PATH。 */
  binDir: string | null;
  pgDump: string;
  psql: string;
  source: 'env' | 'candidate' | 'path';
};

const IS_WINDOWS = process.platform === 'win32';

export function exeName(base: string): string {
  return IS_WINDOWS ? `${base}.exe` : base;
}

/** PG 客户端查找：WORKMESH_PG_BIN → 安装包 pgsql/bin → 数据目录 → PATH。 */
export function findPgTools(
  candidates: string[],
  env: NodeJS.ProcessEnv = process.env,
): PgTools | null {
  const explicit = env.WORKMESH_PG_BIN;
  const dirs = explicit ? [explicit, ...candidates] : candidates;
  for (const dir of dirs) {
    const pgDump = join(dir, exeName('pg_dump'));
    const psql = join(dir, exeName('psql'));
    if (existsSync(pgDump) && existsSync(psql))
      return {
        binDir: dir,
        pgDump,
        psql,
        source: explicit && dir === explicit ? 'env' : 'candidate',
      };
  }
  const probe = spawnSync(exeName('pg_dump'), ['--version'], { encoding: 'utf8' });
  if (probe.status === 0)
    return { binDir: null, pgDump: exeName('pg_dump'), psql: exeName('psql'), source: 'path' };
  return null;
}

type RunResult = { stdout: string; stderr: string };

function run(
  exe: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      windowsHide: true,
      env: options.env ?? process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(new Error(`${exe} 退出码 ${code}\n${stderr.trim() || stdout.trim() || '(无输出)'}`));
    });
  });
}

/**
 * dump 走 stdout 再由 Node 写文件：pg_dump 直接 --file 在受限环境里可能没有目标目录写权限，
 * 而应用进程（Node）在自己的数据目录里写是稳定的。流式处理，避免整库进内存。
 */
export async function dumpDatabase(input: {
  tools: PgTools;
  target: DatabaseTarget;
  outFile: string;
}): Promise<{ bytes: number }> {
  const { statSync } = await import('node:fs');
  const { createWriteStream } = await import('node:fs');
  return new Promise((resolve, reject) => {
    const child = spawn(
      input.tools.pgDump,
      ['--no-owner', '--no-privileges', '--format=plain', libpqUrlOf(input.target.url)],
      { windowsHide: true },
    );
    const out = createWriteStream(input.outFile);
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    out.on('error', reject);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        out.destroy();
        reject(new Error(`${input.tools.pgDump} 退出码 ${code}\n${stderr.trim() || '(无输出)'}`));
        return;
      }
      out.end(() => {
        try {
          resolve({ bytes: statSync(input.outFile).size });
        } catch (caught) {
          reject(caught);
        }
      });
    });
  });
}

export async function restoreDatabase(input: {
  tools: PgTools;
  targetUrl: string;
  file: string;
}): Promise<void> {
  await run(input.tools.psql, [
    '-v',
    'ON_ERROR_STOP=1',
    '--file',
    input.file,
    libpqUrlOf(input.targetUrl),
  ]);
}

export async function runSql(input: { tools: PgTools; url: string; sql: string }): Promise<string> {
  const result = await run(input.tools.psql, [
    '-v',
    'ON_ERROR_STOP=1',
    '--tuples-only',
    '--no-align',
    '--command',
    input.sql,
    libpqUrlOf(input.url),
  ]);
  return result.stdout.trim();
}

export async function queryScalar(input: {
  tools: PgTools;
  url: string;
  sql: string;
}): Promise<string | null> {
  try {
    const value = await runSql(input);
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

export async function databaseExists(input: {
  tools: PgTools;
  target: DatabaseTarget;
  name: string;
}): Promise<boolean> {
  const value = await queryScalar({
    tools: input.tools,
    url: adminUrlOf(input.target),
    sql: `SELECT 1 FROM pg_database WHERE datname = '${input.name.replace(/'/g, "''")}'`,
  });
  return value === '1';
}

export async function createDatabase(input: {
  tools: PgTools;
  target: DatabaseTarget;
  name: string;
}): Promise<void> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(input.name))
    throw new Error(`数据库名不合法：${input.name}（小写字母开头，仅含小写字母/数字/下划线）`);
  await runSql({
    tools: input.tools,
    url: adminUrlOf(input.target),
    sql: `CREATE DATABASE "${input.name}"`,
  });
}

export function databaseUrlFor(target: DatabaseTarget, name: string): string {
  return withDatabase(target.url, name);
}
