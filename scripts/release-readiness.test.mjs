import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  artifactIdentity,
  parseReadinessArguments,
  readSource,
  releaseReadiness,
} from './release-readiness.mjs';
import { verifyWorkflowCi } from './verify-release.mjs';

const sha = 'a'.repeat(40);
const candidate = { tag: 'v1.2.3', sha, repository: 'example/repo', verifyCi: true };
const now = () => new Date('2026-11-10T08:00:00Z');
const dependencies = (overrides = {}) => ({
  now,
  env: { GH_TOKEN: 'private-test-token' },
  readSource: () => ({ head: sha, dirty: false }),
  verifyVersions: () => ({ version: '1.2.3', packages: 7 }),
  verifyWorkflow: async (_options, workflow) => ({
    workflow,
    id: 10,
    attempt: 1,
    url: 'https://example.test/runs/10',
  }),
  ...overrides,
});
const check = (report, id) => report.checks.find((entry) => entry.id === id);

test('readiness arguments require an explicit valid candidate and reject silent or duplicate options', () => {
  assert.deepEqual(
    parseReadinessArguments(['--', '--tag', 'v1.2.3', '--sha', sha, '--verify-ci']),
    {
      tag: 'v1.2.3',
      sha,
      verifyCi: true,
    },
  );
  assert.deepEqual(parseReadinessArguments(['--help']), { help: true });
  for (const args of [
    [],
    ['--tag', 'v01.2.3', '--sha', sha],
    ['--tag', 'v1.2.3'],
    ['--tag', 'v1.2.3', '--sha', 'main'],
    ['--tag', 'v1.2.3', '--sha', sha, '--approve'],
    ['--tag', 'v1.2.3', '--sha', sha, '--sha', sha],
    ['--tag', 'v1.2.3', '--sha', sha, '--repository', '../repo'],
  ])
    assert.throws(() => parseReadinessArguments(args));
});

test('machine success remains a dated diagnostic with all human gates pending', async () => {
  const report = await releaseReadiness(candidate, dependencies());
  assert.equal(report.machineChecksPassed, true);
  assert.equal(report.status, 'MANUAL_REVIEW_REQUIRED');
  assert.equal(report.releaseApproved, false);
  assert.equal(report.authority, 'READ_ONLY_DIAGNOSTIC');
  assert.equal(report.candidate.sha, sha);
  assert.ok(report.checks.every((entry) => entry.checkedAt === now().toISOString()));
  assert.ok(report.manualGates.every((entry) => entry.status === 'PENDING'));
  assert.equal(report.manualGates.length, 7);
  assert.equal(check(report, 'WORKSPACE_VERSIONS').details.candidateBound, true);
  assert.equal(check(report, 'ARTIFACT_PROVENANCE_AND_ACCEPTANCE').status, 'NOT_CHECKED');
  assert.doesNotMatch(JSON.stringify(report), /private-test-token/);
});

test('dirty source, different HEAD and failed source probes cannot bind local versions to the candidate', async () => {
  for (const read of [
    () => ({ head: sha, dirty: true }),
    () => ({ head: 'b'.repeat(40), dirty: false }),
    () => {
      throw new Error('git failed with private text');
    },
  ]) {
    const report = await releaseReadiness(candidate, dependencies({ readSource: read }));
    assert.equal(report.machineChecksPassed, false);
    assert.equal(report.source.candidateBound, false);
    assert.notEqual(check(report, 'CANDIDATE_SOURCE').status, 'PASS');
    assert.equal(check(report, 'WORKSPACE_VERSIONS').details.candidateBound, false);
  }
});

test('a version mismatch fails independently while missing CI access is explicitly not checked', async () => {
  const report = await releaseReadiness(
    candidate,
    dependencies({
      verifyVersions: () => {
        throw new Error('wrong package version');
      },
      env: {},
      verifyWorkflow: () => {
        throw new Error('must not request');
      },
    }),
  );
  assert.equal(check(report, 'WORKSPACE_VERSIONS').status, 'FAIL');
  for (const workflow of ['ci.yml', 'platform-smoke.yml', 'security.yml'])
    assert.equal(check(report, `REMOTE_CI:${workflow}`).status, 'NOT_CHECKED');
  assert.equal(report.machineChecksPassed, false);
  const local = await releaseReadiness({ ...candidate, verifyCi: false }, dependencies());
  assert.equal(check(local, 'REMOTE_CI:ci.yml').reason, 'REMOTE_QUERY_NOT_REQUESTED');
});

test('each remote gate reuses exact latest main push selection and preserves failure versus unavailable', async () => {
  const report = await releaseReadiness(
    candidate,
    dependencies({
      verifyWorkflow: (options, workflow) =>
        verifyWorkflowCi(options, workflow, async () => {
          if (workflow === 'security.yml') return { ok: false, status: 403 };
          return {
            ok: true,
            json: async () => ({
              workflow_runs: [
                {
                  id: 1,
                  run_attempt: 1,
                  head_sha: sha,
                  head_branch: 'main',
                  event: 'push',
                  path: `.github/workflows/${workflow}`,
                  created_at: '2026-11-09T00:00:00Z',
                  status: 'completed',
                  conclusion: 'success',
                },
                {
                  id: 2,
                  run_attempt: 1,
                  head_sha: sha,
                  head_branch: 'main',
                  event: 'push',
                  path: `.github/workflows/${workflow}`,
                  created_at: '2026-11-10T00:00:00Z',
                  status: 'completed',
                  conclusion: workflow === 'ci.yml' ? 'failure' : 'success',
                },
              ],
            }),
          };
        }),
    }),
  );
  assert.equal(check(report, 'REMOTE_CI:ci.yml').status, 'FAIL');
  assert.equal(check(report, 'REMOTE_CI:security.yml').status, 'ERROR');
  assert.equal(check(report, 'REMOTE_CI:platform-smoke.yml').status, 'PASS');
  assert.equal(check(report, 'REMOTE_CI:platform-smoke.yml').details.id, 2);
  const network = await releaseReadiness(
    candidate,
    dependencies({
      verifyWorkflow: async () => {
        throw new Error('private-test-token network authorization failed');
      },
    }),
  );
  assert.equal(check(network, 'REMOTE_CI:ci.yml').status, 'ERROR');
  assert.doesNotMatch(JSON.stringify(network), /private-test-token|authorization/);
});

test('selected artifact hash identifies bytes without claiming candidate provenance or approval', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wm-readiness-artifact-'));
  try {
    const artifact = join(directory, 'box.zip');
    writeFileSync(artifact, 'real test bytes');
    const identity = await artifactIdentity(artifact);
    assert.equal(identity.sha256, createHash('sha256').update('real test bytes').digest('hex'));
    assert.equal(identity.bytes, 15);
    const report = await releaseReadiness({ ...candidate, artifact }, dependencies());
    assert.equal(report.artifact.candidateBinding, 'NOT_VERIFIED');
    assert.equal(report.releaseApproved, false);
    const absent = await releaseReadiness(
      { ...candidate, artifact: join(directory, 'missing') },
      dependencies(),
    );
    assert.equal(check(absent, 'ARTIFACT_IDENTITY').status, 'ERROR');
    assert.equal(absent.machineChecksPassed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed matching run identity is a query error rather than a successful or failed run', async () => {
  const report = await releaseReadiness(
    candidate,
    dependencies({
      verifyWorkflow: (options, workflow) =>
        verifyWorkflowCi(options, workflow, async () => ({
          ok: true,
          json: async () => ({
            workflow_runs: [
              {
                head_sha: sha,
                head_branch: 'main',
                event: 'push',
                path: `.github/workflows/${workflow}`,
                created_at: 'not-a-date',
                status: 'completed',
                conclusion: 'success',
              },
            ],
          }),
        })),
    }),
  );
  assert.equal(check(report, 'REMOTE_CI:ci.yml').status, 'ERROR');
  assert.equal(report.machineChecksPassed, false);
});

test('real isolated checkout versions and tracked/untracked changes are observed without repository writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'wm-readiness-source-'));
  try {
    const git = (args) =>
      execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git(['init', '--quiet']);
    mkdirSync(join(directory, 'apps', 'cli'), { recursive: true });
    mkdirSync(join(directory, 'packages', 'shared'), { recursive: true });
    writeFileSync(
      join(directory, 'pnpm-workspace.yaml'),
      'packages:\n  - apps/*\n  - packages/*\n',
    );
    for (const path of ['package.json', 'apps/cli/package.json', 'packages/shared/package.json'])
      writeFileSync(join(directory, path), JSON.stringify({ name: path, version: '1.2.3' }));
    git(['add', '.']);
    git([
      '-c',
      'user.name=Readiness Test',
      '-c',
      'user.email=readiness@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ]);
    const head = git(['rev-parse', 'HEAD']);
    const deps = dependencies({ directory });
    delete deps.readSource;
    delete deps.verifyVersions;
    const clean = await releaseReadiness({ ...candidate, sha: head }, deps);
    assert.equal(clean.machineChecksPassed, true);
    assert.equal(check(clean, 'WORKSPACE_VERSIONS').details.packages, 3);
    writeFileSync(join(directory, 'extra.txt'), 'untracked');
    assert.equal(readSource(directory).dirty, true);
    const dirty = await releaseReadiness({ ...candidate, sha: head }, deps);
    assert.equal(dirty.machineChecksPassed, false);
    assert.equal(git(['status', '--porcelain']).split('\n').length, 1);
    writeFileSync(
      join(directory, 'packages/shared/package.json'),
      JSON.stringify({ version: '1.2.2' }),
    );
    const mismatch = await releaseReadiness({ ...candidate, sha: head }, deps);
    assert.equal(check(mismatch, 'WORKSPACE_VERSIONS').status, 'FAIL');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
