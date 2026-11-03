import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { collectDependencyLinks, restoreDependencyLinks } from './dependency-links.mjs';

test('dependencies resolve after extracting without junctions to a new path with spaces', () => {
  const temp = mkdtempSync(join(tmpdir(), 'wm-dependency-links-'));
  try {
    const source = join(temp, 'build');
    const output = join(temp, 'installed box');
    const real = join(source, 'node_modules', '.pnpm', 'parent', 'node_modules', 'parent');
    const leaf = join(source, 'node_modules', '.pnpm', 'leaf', 'node_modules', 'leaf');
    mkdirSync(real, { recursive: true });
    mkdirSync(leaf, { recursive: true });
    writeFileSync(join(source, 'package.json'), '{}');
    writeFileSync(join(real, 'index.js'), 'module.exports = require("leaf")');
    writeFileSync(join(leaf, 'index.js'), 'module.exports = "relocated dependency works"');
    symlinkSync(real, join(source, 'node_modules', 'parent'), 'junction');
    symlinkSync(leaf, join(real, '..', 'leaf'), 'junction');
    assert.equal(collectDependencyLinks(source).links, 2);
    cpSync(source, output, { recursive: true, filter: (path) => !lstatSync(path).isSymbolicLink() });
    assert.equal(restoreDependencyLinks(output).restored, 2);
    assert.equal(createRequire(join(output, 'package.json'))('parent'), 'relocated dependency works');
    assert.equal(restoreDependencyLinks(output).restored, 0);
    const manifest = readFileSync(join(output, 'dependency-links.json'), 'utf8');
    assert.equal(manifest.includes(source.replaceAll('\\', '\\\\')), false);
  } finally {
    assert.ok(relative(resolve(tmpdir()), temp).startsWith('wm-dependency-links-'));
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a manifest with a target outside the package is rejected before restoring', () => {
  const temp = mkdtempSync(join(tmpdir(), 'wm-dependency-links-'));
  try {
    writeFileSync(join(temp, 'dependency-links.json'), JSON.stringify({ schemaVersion: '1', links: [{ path: 'node_modules/bad', target: '../outside' }] }));
    assert.throws(() => restoreDependencyLinks(temp), /escapes package/);
  } finally {
    assert.ok(relative(resolve(tmpdir()), temp).startsWith('wm-dependency-links-'));
    rmSync(temp, { recursive: true, force: true });
  }
});

test('a missing target leaves no partially restored dependencies', () => {
  const temp = mkdtempSync(join(tmpdir(), 'wm-dependency-links-'));
  try {
    mkdirSync(join(temp, 'real'));
    writeFileSync(join(temp, 'dependency-links.json'), JSON.stringify({ schemaVersion: '1', links: [
      { path: 'node_modules/valid', target: 'real' },
      { path: 'node_modules/missing', target: 'missing' },
    ] }));
    assert.throws(() => restoreDependencyLinks(temp), /has no target/);
    assert.equal(existsSync(join(temp, 'node_modules')), false);
  } finally {
    assert.ok(relative(resolve(tmpdir()), temp).startsWith('wm-dependency-links-'));
    rmSync(temp, { recursive: true, force: true });
  }
});
