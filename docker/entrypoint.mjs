import { spawn } from 'node:child_process';
import { once } from 'node:events';

const env = { ...process.env };
const apiPort = String(env.PORT ?? '3000');
const webPort = String(env.WEB_PORT ?? '5173');
const webHost = env.WEB_HOST ?? '0.0.0.0';

if (!env.WORKMESH_V1_DATABASE_URL) {
  console.error('WORKMESH_V1_DATABASE_URL is required');
  process.exit(78);
}

// Migrations are intentionally NOT run here. Run docker/migrate.mjs as a
// separate one-shot job (compose service or Kubernetes Job) before starting
// the app. This keeps migration and application lifecycle decoupled and
// prevents concurrent migration races when scaling horizontally.

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve([child.exitCode, child.signalCode]);
  }
  return once(child, 'exit');
}

const children = [
  spawn(process.execPath, ['apps/api/dist/main.js'], { env, stdio: 'inherit' }),
  spawn(
    process.execPath,
    [
      'scripts/box/web-server.mjs',
      '--root',
      'apps/web/dist',
      '--host',
      webHost,
      '--port',
      webPort,
      '--api-host',
      '127.0.0.1',
      '--api-port',
      apiPort,
    ],
    { env, stdio: 'inherit' },
  ),
];

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed && child.exitCode === null) child.kill(signal);
  }
  await Promise.allSettled(children.map((child) => waitForExit(child)));
}

process.once('SIGTERM', () => void stop('SIGTERM'));
process.once('SIGINT', () => void stop('SIGINT'));

const result = await Promise.race(
  children.map(async (child) => {
    const [code, signal] = await waitForExit(child);
    return { code, signal };
  }),
);

await stop('SIGTERM');
if (result.code !== 0) {
  console.error(
    `WorkMesh child exited with code ${result.code ?? 'null'} (${result.signal ?? 'no signal'})`,
  );
  process.exit(result.code ?? 1);
}
