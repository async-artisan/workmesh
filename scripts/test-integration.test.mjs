import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArguments } from './test-integration.mjs';
import { resolvePnpmEntry } from './lib/pnpm-runner.mjs';

test('integration runner accepts only the explicit migration flag', () => {
  assert.deepEqual(parseArguments([]), { applyMigrations: false });
  assert.deepEqual(parseArguments(['--apply-migrations']), { applyMigrations: true });
  assert.deepEqual(parseArguments(['--', '--apply-migrations']), { applyMigrations: true });
  assert.throws(
    () => parseArguments(['--apply-migrations', '--apply-migrations']),
    /Unknown or duplicate/,
  );
  assert.throws(() => parseArguments(['--skip-guard']), /Unknown or duplicate/);
});

test('integration runner refuses before database access when the test target is not explicitly selected', () => {
  const script = fileURLToPath(new URL('./test-integration.mjs', import.meta.url));
  const env = { ...process.env };
  delete env.WORKMESH_TEST_ENV;
  delete env.WORKMESH_TEST_DATABASE_URL;
  delete env.WORKMESH_TEST_DATABASE_USERS;
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /TEST_ENV_MISSING/);
  assert.doesNotMatch(result.stderr, /migrate deploy|Connecting to database/i);
});

test('pnpm resolver selects only the version pinned by the root package', () => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'workmesh-pnpm-runner-'));
  try {
    const pnpmDirectory = join(temporaryDirectory, 'node_modules', 'pnpm');
    const binDirectory = join(pnpmDirectory, 'bin');
    mkdirSync(binDirectory, { recursive: true });
    const fakePnpm = join(binDirectory, 'pnpm.cjs');
    writeFileSync(fakePnpm, 'process.exit(0);');
    const manifest = join(pnpmDirectory, 'package.json');
    writeFileSync(manifest, JSON.stringify({ name: 'pnpm', version: '10.28.2' }));
    const rootManifest = join(temporaryDirectory, 'root.json');
    writeFileSync(rootManifest, JSON.stringify({ packageManager: 'pnpm@10.28.2' }));
    assert.equal(resolvePnpmEntry(rootManifest, { npm_execpath: fakePnpm }), fakePnpm);

    writeFileSync(manifest, JSON.stringify({ name: 'pnpm', version: '9.0.0' }));
    assert.throws(
      () => resolvePnpmEntry(rootManifest, { npm_execpath: fakePnpm }),
      /Could not resolve the repository-pinned pnpm 10\.28\.2/,
    );
    writeFileSync(manifest, JSON.stringify({ name: 'pnpm', version: '10.28.2' }));
    writeFileSync(rootManifest, JSON.stringify({ packageManager: 'pnpm@latest' }));
    assert.throws(
      () => resolvePnpmEntry(rootManifest, { npm_execpath: fakePnpm }),
      /must pin pnpm/,
    );
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
