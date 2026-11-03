import { spawnSync } from 'node:child_process';
import { refuseAndExit, resolveTestDatabase } from './lib/test-database-guard.mjs';

// 入口级门禁：不合格目标在创建任何连接之前拒绝，不做整串正则匹配。
const resolved = await resolveTestDatabase();
if (!resolved.ok) refuseAndExit(resolved.rejection);
if (!process.env.npm_execpath) {
  console.error('Run this entry point with pnpm test:e2e so the package manager is explicit.');
  process.exit(2);
}

const runner = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    '--filter',
    '@workmesh/api',
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.mts',
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(runner.status ?? 1);
