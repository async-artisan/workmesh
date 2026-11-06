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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`${command} exited with code ${code ?? 'null'} (${signal ?? 'no signal'})`),
        );
    });
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve([child.exitCode, child.signalCode]);
  }
  return once(child, 'exit');
}

await run('pnpm', [
  '--filter',
  '@workmesh/api',
  'exec',
  'prisma',
  'migrate',
  'deploy',
  '--schema',
  'prisma/schema.prisma',
]);

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
