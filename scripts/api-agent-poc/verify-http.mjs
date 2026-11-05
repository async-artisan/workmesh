import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { resolveTestDatabase } from '../lib/test-database-guard.mjs';

const runFile = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const api = path.join(root, 'apps/api');
const require = createRequire(path.join(api, 'package.json'));
const { PrismaClient } = require(path.join(root, 'apps/node_modules/.prisma/workmesh-v1-client'));

function options(argv) {
  const result = { pgBin: process.env.WORKMESH_POC_PG_BIN, model: 'qwen2.5:14b', output: 'docs/testing/api-agent-poc/2026-11-04-http.json' };
  for (let i = 0; i < argv.length; i += 2) {
    const names = { '--pg-bin': 'pgBin', '--model': 'model', '--output': 'output' };
    if (!names[argv[i]] || !argv[i + 1]) throw new Error('Use --pg-bin <directory>, optional --model and --output.');
    result[names[argv[i]]] = argv[i + 1];
  }
  if (!result.pgBin && process.platform === 'win32' && process.env.LOCALAPPDATA) {
    result.pgBin = path.join(process.env.LOCALAPPDATA, 'workmesh-pg/node_modules/@embedded-postgres/windows-x64/native/bin');
  }
  if (!result.pgBin) throw new Error('Set --pg-bin to installed PostgreSQL binaries.');
  return result;
}

function environment() {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LOCALAPPDATA', 'USERPROFILE', 'LANG']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function command(file, args, env, cwd, timeout = 60_000) {
  return runFile(file, args, { env, cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', shell: false });
}

async function main() {
  const cli = options(process.argv.slice(2));
  const tempParent = await realpath(os.tmpdir());
  const work = await mkdtemp(path.join(tempParent, 'workmesh-api-agent-http-'));
  const data = path.join(work, 'data');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const pgctl = path.join(cli.pgBin, `pg_ctl${suffix}`);
  const port = await freePort();
  const database = `workmesh_test_api_agent_${randomBytes(6).toString('hex')}`;
  const user = 'workmesh_poc';
  const url = `postgresql://${user}@127.0.0.1:${port}/${database}?schema=workmesh_v1`;
  const env = {
    ...environment(), NODE_ENV: 'test', WORKMESH_TEST_ENV: 'local', WORKMESH_TEST_DATABASE_USERS: user,
    WORKMESH_TEST_DATABASE_URL: url, WORKMESH_V1_DATABASE_URL: url,
    WORKMESH_COOKIE_MODE: 'LOCAL_INSECURE', WORKMESH_PUBLIC_ORIGIN: 'http://127.0.0.1:5173',
    WORKMESH_POC_MODEL: cli.model, WORKMESH_POC_OUTPUT: path.resolve(root, cli.output),
    PRISMA_HIDE_UPDATE_MESSAGE: 'true', CHECKPOINT_DISABLE: '1',
  };
  let pgStarted = false;
  let stopped = true;
  let testExitCode = 1;
  try {
    const prior = Object.fromEntries(['WORKMESH_TEST_ENV', 'WORKMESH_TEST_DATABASE_URL', 'WORKMESH_TEST_DATABASE_USERS', 'DATABASE_URL'].map((key) => [key, process.env[key]]));
    let guard;
    try {
      for (const key of Object.keys(prior)) delete process.env[key];
      for (const key of ['WORKMESH_TEST_ENV', 'WORKMESH_TEST_DATABASE_URL', 'WORKMESH_TEST_DATABASE_USERS']) process.env[key] = env[key];
      guard = await resolveTestDatabase();
    } finally {
      for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    if (!guard.ok) throw new Error(`Isolated database guard refused: ${guard.rejection.code}`);
    process.stdout.write(`${JSON.stringify({ phase: 'isolated-postgres', database, host: '127.0.0.1', port })}\n`);
    await command(path.join(cli.pgBin, `initdb${suffix}`), ['-D', data, '--username', user, '--auth=trust', '--no-locale', '--encoding=UTF8'], env, work);
    // Mark before launch so failure cleanup also attempts to stop our own cluster.
    pgStarted = true;
    await command(pgctl, ['start', '-D', data, '-l', path.join(work, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', '-t', '30'], env, work);
    const admin = new PrismaClient({ datasources: { db: { url: `postgresql://${user}@127.0.0.1:${port}/postgres?schema=public` } } });
    try {
      const identity = await admin.$queryRawUnsafe('SELECT current_database() AS name, inet_server_port() AS port');
      if (identity[0]?.name !== 'postgres' || identity[0]?.port !== port) throw new Error('Fresh PostgreSQL identity mismatch.');
      // The identifier is generated above from a fixed prefix and hex bytes only.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    } finally { await admin.$disconnect(); }
    const prisma = path.join(work, 'prisma');
    await mkdir(prisma);
    await cp(path.join(api, 'prisma/migrations'), path.join(prisma, 'migrations'), { recursive: true });
    await writeFile(path.join(prisma, 'schema.prisma'), await readFile(path.join(api, 'prisma/schema.prisma')));
    const migration = await command(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(prisma, 'schema.prisma')], env, work, 120_000);
    process.stdout.write(`${JSON.stringify({ phase: 'migrations', applied: /successfully applied|No pending migrations/i.test(migration.stdout), isolatedSchema: true })}\n`);
    try {
      const result = await command(process.execPath, [path.join(api, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.integration.config.mts', 'test/v1-api-agent.database.spec.ts'], env, api, 300_000);
      process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      testExitCode = 0;
    } catch (error) {
      if (error.stdout) process.stdout.write(error.stdout);
      if (error.stderr) process.stderr.write(error.stderr);
      testExitCode = typeof error.code === 'number' ? error.code : 1;
    }
  } finally {
    if (pgStarted) {
      try { await command(pgctl, ['stop', '-D', data, '-m', 'fast', '-w', '-t', '30'], env, work); }
      catch { stopped = false; process.stderr.write(`Temporary PostgreSQL cleanup failed; retained ${work}\n`); }
    }
    if (stopped) {
      const canonical = await realpath(work);
      if (path.dirname(canonical) !== tempParent || !path.basename(canonical).startsWith('workmesh-api-agent-http-')) throw new Error('Refusing unexpected cleanup path.');
      await rm(canonical, { recursive: true, force: true });
    }
    process.stdout.write(`${JSON.stringify({ phase: 'cleanup', isolatedPostgresStopped: stopped, temporaryClusterRemoved: stopped, testExitCode })}\n`);
    process.exitCode = stopped ? testExitCode : 1;
  }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
