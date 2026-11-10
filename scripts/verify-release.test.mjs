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

test('CI API checks quality, platform and security workflows and paginates before selecting the latest run', async () => {
  const calls = [];
  const result = await verifyCi(
    { repository: 'example/repo', sha, token: 'test-token' },
    async (url, options) => {
      calls.push(url.href);
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      assert.equal(url.searchParams.get('head_sha'), sha);
      assert.equal(url.searchParams.get('event'), 'push');
      assert.equal(url.searchParams.get('branch'), 'main');
      const workflow = url.pathname.split('/').at(-2);
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
  assert.equal(calls.length, 6);
  assert.deepEqual(
    result.map(({ workflow }) => workflow),
    ['ci.yml', 'platform-smoke.yml', 'security.yml'],
  );
});

const settings = { repository: 'example/repo', sha, token: 'test-token' };
const workflowRun = (workflow, overrides = {}) =>
  run({ path: '.github/workflows/' + workflow, ...overrides });
function workflowResponse(overrides = {}) {
  return async (url) => {
    const workflow = url.pathname.split('/').at(-2);
    return {
      ok: true,
      json: async () => ({
        workflow_runs: overrides[workflow] ?? [workflowRun(workflow)],
      }),
    };
  };
}

for (const workflow of ['ci.yml', 'platform-smoke.yml', 'security.yml']) {
  test(`release still requires ${workflow} when the other workflows succeed`, async () => {
    await assert.rejects(
      verifyCi(settings, workflowResponse({ [workflow]: [] })),
      new RegExp(workflow.replaceAll('.', '\\.') + '.*no matching run'),
    );
  });
}

test('security gate cannot reuse a different SHA, branch, workflow or event', async () => {
  for (const overrides of [
    { head_sha: 'b'.repeat(40) },
    { head_branch: 'feature' },
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { event: 'schedule' },
    { event: 'workflow_dispatch' },
  ]) {
    await assert.rejects(
      verifyCi(
        settings,
        workflowResponse({ 'security.yml': [workflowRun('security.yml', overrides)] }),
      ),
      /security\.yml.*no matching run/,
    );
  }
});

for (const state of [
  { status: 'in_progress', conclusion: null },
  { status: 'queued', conclusion: null },
  { status: 'completed', conclusion: 'failure' },
  { status: 'completed', conclusion: 'cancelled' },
  { status: 'completed', conclusion: 'skipped' },
]) {
  test(`newer security ${state.status}/${state.conclusion} prevents reuse of an older success`, async () => {
    const old = workflowRun('security.yml');
    const latest = workflowRun('security.yml', {
      id: 11,
      created_at: '2026-01-02T00:00:00Z',
      ...state,
    });
    for (const runs of [
      [old, latest],
      [latest, old],
    ]) {
      await assert.rejects(
        verifyCi(settings, workflowResponse({ 'security.yml': runs })),
        /security\.yml requires a successful latest/,
      );
    }
  });
}

test('security gate accepts the latest success while preserving earlier failure evidence', async () => {
  const old = workflowRun('security.yml', { conclusion: 'failure' });
  const latest = workflowRun('security.yml', { id: 11, created_at: '2026-01-02T00:00:00Z' });
  const result = await verifyCi(settings, workflowResponse({ 'security.yml': [latest, old] }));
  assert.deepEqual(result.at(-1), {
    workflow: 'security.yml',
    id: 11,
    attempt: 1,
    url: latest.html_url,
  });
});

test('a failed security rerun cannot reuse a successful earlier attempt of the same run', async () => {
  const first = workflowRun('security.yml');
  const rerun = workflowRun('security.yml', { run_attempt: 2, conclusion: 'failure' });
  await assert.rejects(
    verifyCi(settings, workflowResponse({ 'security.yml': [first, rerun] })),
    /security\.yml.*completed\/failure/,
  );
});

test('security API errors fail the release even when quality and platform checks succeed', async () => {
  const good = workflowResponse();
  await assert.rejects(
    verifyCi(settings, async (url) =>
      url.pathname.includes('/security.yml/') ? { ok: false, status: 403 } : good(url),
    ),
    /Cannot verify security\.yml: GitHub API HTTP 403/,
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
