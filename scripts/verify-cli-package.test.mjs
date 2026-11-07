import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BUILTIN_ROLES, verifyCliPackage } from './verify-cli-package.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'workmesh-cli-inventory-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'runtime'), { recursive: true });
  mkdirSync(join(directory, 'app', 'cli'), { recursive: true });
  writeFileSync(join(directory, 'runtime', 'node.exe'), 'placeholder');
  writeFileSync(join(directory, 'app', 'cli', 'index.js'), 'placeholder');
  writeFileSync(join(directory, 'workmesh.cmd'), 'placeholder');
  cpSync(
    fileURLToPath(new URL('../packages/role-packages/roles', import.meta.url)),
    join(directory, 'roles'),
    { recursive: true },
  );
  return directory;
}

test('staged distribution contains all six built-in roles and matching resource bytes', (t) => {
  const result = verifyCliPackage(fixture(t), { smoke: false });
  assert.equal(result.roles, BUILTIN_ROLES.length);
  assert.ok(result.resources > BUILTIN_ROLES.length);
});

test('an omitted frontend manifest prevents publishing the CLI', (t) => {
  const directory = fixture(t);
  unlinkSync(join(directory, 'roles', 'frontend', 'manifest.json'));
  assert.throws(() => verifyCliPackage(directory, { smoke: false }), /missing.*frontend.*manifest/);
});

test('a changed resource is rejected even when its byte length remains the same', (t) => {
  const directory = fixture(t);
  const manifest = JSON.parse(
    readFileSync(join(directory, 'roles', 'frontend', 'manifest.json'), 'utf8'),
  );
  const path = join(directory, 'roles', 'frontend', manifest.resources[0].path);
  const bytes = readFileSync(path);
  bytes[0] ^= 1;
  writeFileSync(path, bytes);
  assert.throws(() => verifyCliPackage(directory, { smoke: false }), /differs from manifest/);
});

test('resource paths cannot escape the role package', (t) => {
  const directory = fixture(t);
  const path = join(directory, 'roles', 'frontend', 'manifest.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.resources[0].path = '../backend/guide.md';
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyCliPackage(directory, { smoke: false }), /invalid resource path/);
});
