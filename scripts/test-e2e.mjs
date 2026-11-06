import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { refuseAndExit, resolveTestDatabase } from './lib/test-database-guard.mjs';
import { resolvePnpmEntry } from './lib/pnpm-runner.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function runPnpm(args) {
  try {
    return spawnSync(process.execPath, [resolvePnpmEntry(resolve(root, 'package.json')), ...args], {
      stdio: 'inherit',
      env: process.env,
      cwd: root,
      windowsHide: true,
    });
  } catch (error) {
    console.error(error.message);
    return { status: 2 };
  }
}

// Build the shared guard dependency without opening a database connection.
const build = runPnpm(['--filter', '@workmesh/shared', 'build']);
if (build.error || build.status !== 0) process.exit(build.status ?? 1);

// 入口级门禁：不合格目标在创建任何连接之前拒绝，不做整串正则匹配。
const resolved = await resolveTestDatabase();
if (!resolved.ok) refuseAndExit(resolved.rejection);
const runner = runPnpm([
  '--filter',
  '@workmesh/api',
  'exec',
  'vitest',
  'run',
  '--config',
  'vitest.integration.config.mts',
]);

process.exit(runner.error ? 1 : (runner.status ?? 1));
