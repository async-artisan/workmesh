import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { prismaClientLinkType, repoRootFromModuleUrl } from './isolated-prisma-paths.mjs';

test('repository path resolution decodes spaces and non-ASCII file URLs', () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'WorkMesh 路径 test '));
  try {
    const scriptDirectory = join(temporaryRoot, 'scripts', 'lib');
    mkdirSync(scriptDirectory, { recursive: true });
    const scriptUrl = pathToFileURL(join(scriptDirectory, 'isolated-prisma-paths.mjs'));
    assert.equal(repoRootFromModuleUrl(scriptUrl), temporaryRoot + sep);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('Windows uses junctions for isolated @prisma/client links', () => {
  assert.equal(prismaClientLinkType('win32'), 'junction');
  assert.equal(prismaClientLinkType('linux'), 'dir');
  assert.equal(prismaClientLinkType('darwin'), 'dir');
});
