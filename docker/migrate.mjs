/**
 * Standalone database migration entry point.
 *
 * Run as a one-shot job before starting the app container:
 *   node docker/migrate.mjs
 *
 * Exits 0 on success, non-zero on failure. Designed to be used as a
 * docker-compose service or Kubernetes Job so migrations are decoupled
 * from the application startup lifecycle.
 */
import { spawn } from 'node:child_process';

if (!process.env.WORKMESH_V1_DATABASE_URL) {
  console.error('WORKMESH_V1_DATABASE_URL is required');
  process.exit(78);
}

console.log('Running Prisma migrations...');

const child = spawn(
  'pnpm',
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
  { stdio: 'inherit' },
);

child.once('error', (err) => {
  console.error('Migration process error:', err.message);
  process.exit(1);
});

child.once('exit', (code, signal) => {
  if (code === 0) {
    console.log('Migrations applied successfully.');
    process.exit(0);
  } else {
    console.error(`Migration failed with code ${code ?? 'null'} (${signal ?? 'no signal'})`);
    process.exit(code ?? 1);
  }
});
