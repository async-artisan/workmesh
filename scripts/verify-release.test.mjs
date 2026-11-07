import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  releaseVersion,
  successfulRun,
  verifyCi,
  verifyWorkspaceVersions,
} from './verify-release.mjs';

test('release tags enforce SemVer including prerelease and build metadata', () => {
  for (const version of ['0.0.0', '1.2.3', '1.2.3-rc.1', '1.2.3-0', '1.2.3-alpha-2+build.01']) {
    assert.equal(releaseVersion('v' + version), version);
  }
  for (const tag of [
    '1.2.3',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2.3.4',
    'v1x2x3',
    'v1.2.3-01',
    'v1.2.3-rc..1',
    'v1.2.3-',
    'v1.2.3+',
    'v1.2.3\n',
  ]) {
    assert.throws(() => releaseVersion(tag), /valid SemVer/);
  }
});

test('all workspace packages must match the release version', () => {
  const directory = mkdtempSync(join(tmpdir(), 'workmesh-release-version-'));
  try {
    mkdirSync(join(directory, 'apps', 'api'), { recursive: true });
    mkdirSync(join(directory, 'packages', 'shared'), { recursive: true });
    writeFileSync(
      join(directory, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\n',
    );
    for (const [file, name] of [
      ['package.json', 'root'],
      ['apps/api/package.json', 'api'],
      ['packages/shared/package.json', 'shared'],
    ]) {
      writeFileSync(join(directory, file), JSON.stringify({ name, version: '1.2.3' }));
    }
    assert.deepEqual(verifyWorkspaceVersions('v1.2.3', directory), {
      version: '1.2.3',
      packages: 3,
    });
    writeFileSync(
      join(directory, 'packages/shared/package.json'),
      JSON.stringify({ name: 'shared', version: '1.2.2' }),
    );
    assert.throws(() => verifyWorkspaceVersions('v1.2.3', directory), /shared version 1.2.2/);
    writeFileSync(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - services/*\n');
    assert.throws(() => verifyWorkspaceVersions('v1.2.3', directory), /changed pnpm-workspace/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const sha = 'a'.repeat(40);
const run = (overrides = {}) => ({
  id: 10,
  run_attempt: 1,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  created_at: '2026-01-01T00:00:00Z',
  status: 'completed',
  conclusion: 'success',
  html_url: 'https://github.com/example/repo/actions/runs/10',
  ...overrides,
});

test('release CI gate accepts only the exact SHA main push workflow', () => {
  assert.equal(successfulRun([run()], { sha, workflow: 'ci.yml' }).id, 10);
  for (const overrides of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { path: '.github/workflows/other.yml' },
  ]) {
    assert.throws(
      () => successfulRun([run(overrides)], { sha, workflow: 'ci.yml' }),
      /no matching run/,
    );
  }
});

test('newer failing or pending runs cannot reuse an older successful run', () => {
  for (const state of [
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
  ]) {
    assert.throws(
      () =>
        successfulRun([run(), run({ id: 11, created_at: '2026-01-02T00:00:00Z', ...state })], {
          sha,
          workflow: 'ci.yml',
        }),
      /requires a successful latest/,
    );
  }
  assert.throws(
    () =>
      successfulRun([run(), run({ run_attempt: 2, conclusion: 'failure' })], {
        sha,
        workflow: 'ci.yml',
      }),
    /completed\/failure/,
  );
});

test('CI API checks both workflows and paginates before selecting the latest run', async () => {
  const calls = [];
  const result = await verifyCi(
    { repository: 'example/repo', sha, token: 'test-token' },
    async (url, options) => {
      calls.push(url.href);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(url.searchParams.get('head_sha'), sha);
      assert.equal(url.searchParams.get('event'), 'push');
      const workflow = url.pathname.includes('platform-smoke') ? 'platform-smoke.yml' : 'ci.yml';
      const page = Number(url.searchParams.get('page'));
      return {
        ok: true,
        json: async () => ({
          workflow_runs:
            page === 1
              ? Array.from({ length: 100 }, () => run({ head_sha: 'b'.repeat(40) }))
              : [run({ path: '.github/workflows/' + workflow })],
        }),
      };
    },
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(
    result.map(({ workflow }) => workflow),
    ['ci.yml', 'platform-smoke.yml'],
  );
});

test('release CI gate fails closed on unavailable or malformed API responses', async () => {
  const settings = { repository: 'example/repo', sha, token: 'test-token' };
  await assert.rejects(
    verifyCi(settings, async () => ({ ok: false, status: 403 })),
    /HTTP 403/,
  );
  await assert.rejects(
    verifyCi(settings, async () => ({ ok: true, json: async () => ({}) })),
    /Invalid GitHub API/,
  );
  await assert.rejects(
    verifyCi(settings, async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) })),
    /no matching run/,
  );
  for (const invalid of [
    { token: '' },
    { repository: '../repo' },
    { sha: 'short' },
    { apiUrl: 'http://example.test' },
  ]) {
    await assert.rejects(
      verifyCi({ ...settings, ...invalid }, () => {
        throw new Error('must not request');
      }),
      /required|must/,
    );
  }
});
