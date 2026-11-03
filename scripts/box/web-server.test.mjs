import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverScript = fileURLToPath(new URL('./web-server.mjs', import.meta.url));

function get(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, method: 'GET' }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) =>
    listener.once('error', reject).listen(0, '127.0.0.1', resolve),
  );
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

test('web server rejects malformed encoding and traversal, then remains healthy', async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'workmesh box web test '));
  const root = join(temp, 'public');
  const staticSibling = join(temp, 'public-evil');
  const downloads = join(temp, 'downloads');
  const downloadSibling = join(temp, 'downloads-evil');
  await Promise.all([mkdir(root), mkdir(staticSibling), mkdir(downloads), mkdir(downloadSibling)]);
  await Promise.all([
    writeFile(join(root, 'index.html'), '<main>WorkMesh home</main>'),
    writeFile(join(staticSibling, 'secret.txt'), 'static secret'),
    writeFile(join(downloads, 'index.html'), '<main>Downloads</main>'),
    writeFile(join(downloadSibling, 'secret.zip'), 'download secret'),
  ]);
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [serverScript, '--root', root, '--port', String(port), '--downloads-root', downloads],
    {
      cwd: dirname(serverScript),
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  t.after(async () => {
    if (child.exitCode === null) child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) resolve();
      else {
        child.once('exit', resolve);
        setTimeout(resolve, 1000);
      }
    });
    await rm(temp, { recursive: true, force: true });
  });

  let home;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      home = await get(port, '/');
      if (home.status === 200) break;
    } catch {
      /* Wait for the child server to start listening. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(home?.status, 200, 'server should serve its index on loopback');
  assert.match(home.body, /WorkMesh home/);

  assert.equal(
    (await get(port, '/%E0%A4%A')).status,
    400,
    'malformed percent encoding should be a client error',
  );
  assert.equal(
    (await get(port, '/%2e%2e/public-evil/secret.txt')).status,
    404,
    'static traversal into a sibling directory must be blocked',
  );
  assert.equal(
    (await get(port, '/download/%2e%2e/downloads-evil/secret.zip')).status,
    404,
    'download traversal into a sibling directory must be blocked',
  );
  const stillHealthy = await get(port, '/');
  assert.equal(
    stillHealthy.status,
    200,
    'server must remain alive after malformed and traversal requests',
  );
  assert.match(stillHealthy.body, /WorkMesh home/);
});
