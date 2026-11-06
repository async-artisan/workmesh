#!/usr/bin/env node
// Cross-platform, guarded entry point for the API integration suite.
// WORKMESH_TEST_DATABASE_URL is explicitly selected and checked before any
// database connection or migration is started.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { refuseAndExit, resolveTestDatabase } from './lib/test-database-guard.mjs';
import { resolvePnpmEntry } from './lib/pnpm-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArguments(args) {
  const normalized = args[0] === '--' ? args.slice(1) : args;
  let applyMigrations = false;
  for (const arg of normalized) {
    if (arg === '--apply-migrations' && !applyMigrations) {
      applyMigrations = true;
      continue;
    }
    throw new Error(`Unknown or duplicate argument: ${arg}`);
  }
  return { applyMigrations };
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function runPnpm(args, env = process.env) {
  try {
    return run(process.execPath, [resolvePnpmEntry(resolve(root, 'package.json')), ...args], env);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
}

async function main(args) {
  let options;
  try {
    options = parseArguments(args);
  } catch (error) {
    process.stderr.write(`${error.message}\nUsage: pnpm test:integration [--apply-migrations]\n`);
    return 2;
  }

  let exitCode = runPnpm(['--filter', '@workmesh/shared', 'build']);
  if (exitCode !== 0) return exitCode;

  const target = await resolveTestDatabase();
  if (!target.ok) refuseAndExit(target.rejection);
  process.stdout.write(
    `${JSON.stringify({ suite: 'api-integration', databaseTarget: target.describe })}\n`,
  );

  exitCode = run(process.execPath, [resolve(root, 'scripts/lib/isolated-prisma.mjs')]);
  if (exitCode !== 0) return exitCode;

  const testUrl = target.target.url;
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    WORKMESH_V1_DATABASE_URL: testUrl,
  };

  if (options.applyMigrations) {
    process.stdout.write('Applying formal migrations to the verified test database.\n');
    exitCode = runPnpm(
      [
        '--filter',
        '@workmesh/api',
        'exec',
        'prisma',
        'migrate',
        'deploy',
        '--schema',
        'prisma/schema.prisma',
      ],
      env,
    );
    if (exitCode !== 0) return exitCode;
  } else {
    process.stdout.write(
      'Skipping migrations; pass --apply-migrations only after confirming the isolated target and backup.\n',
    );
  }

  return runPnpm(['--filter', '@workmesh/api', 'test:integration'], env);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
