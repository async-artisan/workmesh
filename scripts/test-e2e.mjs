import { spawnSync } from 'node:child_process';
import { refuseAndExit, resolveTestDatabase } from './lib/test-database-guard.mjs';

// 入口级门禁：不合格目标在创建任何连接之前拒绝，不做整串正则匹配。
const resolved = await resolveTestDatabase();
if (!resolved.ok) refuseAndExit(resolved.rejection);

const runner = spawnSync(
  'corepack',
  [
    'pnpm',
    '--filter',
    '@workmesh/api',
    'exec',
    'vitest',
    'run',
    '--config',
    'vitest.integration.config.ts',
  ],
  { stdio: 'inherit', env: process.env },
);

process.exit(runner.status ?? 1);
