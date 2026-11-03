import { spawnSync } from 'node:child_process';
import { refuseAndExit, resolveTestDatabase } from './lib/test-database-guard.mjs';

const target = await resolveTestDatabase();
if (!target.ok) refuseAndExit(target.rejection);
if (!process.env.npm_execpath) {
  console.error('Run pnpm test:browser to select the package manager explicitly.');
  process.exit(2);
}
const runner = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'exec', 'playwright', 'test'],
  {
    stdio: 'inherit',
    env: { ...process.env, WORKMESH_V1_DATABASE_URL: target.target.url },
  },
);
process.exit(runner.status ?? 1);
