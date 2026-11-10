#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  releaseVersion,
  verifyWorkspaceVersions,
  verifyWorkflowCi,
  RELEASE_WORKFLOWS,
} from './verify-release.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = /^[a-f0-9]{40}$/;
const MANUAL_GATES = [
  ['B0', '维护者发布授权及完整制品安全与许可验收'],
  ['B1', '生产迁移、恢复、升级回滚及运维窗口'],
  ['B2', '真实 GitHub PR 与 Webhook 联调'],
  ['B3', '完整代码交付发布链及浏览器验收'],
  ['B4', '新机、升级卸载、跨平台和长期稳定性'],
  ['B5', '外部真实团队的正式签字证据'],
  ['B6', '尚未完成产品协议的范围及验收决定'],
];

export function parseReadinessArguments(args) {
  const normalized = args[0] === '--' ? args.slice(1) : args;
  if (normalized.length === 1 && normalized[0] === '--help') return { help: true };
  const options = {};
  for (let index = 0; index < normalized.length; index++) {
    const name = normalized[index];
    if (name === '--verify-ci' && options.verifyCi === undefined) options.verifyCi = true;
    else if (
      ['--tag', '--sha', '--repository', '--artifact'].includes(name) &&
      options[name.slice(2)] === undefined &&
      normalized[index + 1] &&
      !normalized[index + 1].startsWith('--')
    )
      options[name.slice(2)] = normalized[++index];
    else throw new Error('INVALID_ARGUMENTS');
  }
  releaseVersion(options.tag);
  if (!SHA.test(options.sha ?? '')) throw new Error('FULL_CANDIDATE_SHA_REQUIRED');
  if (
    options.repository &&
    (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
      options.repository.split('/').some((part) => part === '.' || part === '..'))
  )
    throw new Error('INVALID_REPOSITORY');
  return options;
}

export function readSource(directory) {
  const git = (args) =>
    execFileSync('git', ['-C', directory, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    }).trim();
  return {
    head: git(['rev-parse', 'HEAD']),
    dirty: Boolean(git(['status', '--porcelain=v1', '--untracked-files=normal'])),
  };
}

export async function artifactIdentity(path) {
  const absolutePath = resolve(path);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error('ARTIFACT_NOT_A_FILE');
  const digest = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(absolutePath)) {
    digest.update(chunk);
    bytes += chunk.length;
  }
  return {
    path: absolutePath,
    bytes,
    sha256: digest.digest('hex'),
    candidateBinding: 'NOT_VERIFIED',
  };
}

/** Reports observations only; neither local success nor a complete report signs a release. */
export async function releaseReadiness(options, dependencies = {}) {
  releaseVersion(options.tag);
  if (!SHA.test(options.sha ?? '')) throw new Error('FULL_CANDIDATE_SHA_REQUIRED');
  const directory = dependencies.directory ?? ROOT;
  const now = dependencies.now ?? (() => new Date());
  const checkedAt = now().toISOString();
  const checks = [];
  const record = (id, status, reason, details) =>
    checks.push({
      id,
      status,
      reason,
      checkedAt: now().toISOString(),
      ...(details ? { details } : {}),
    });
  let source = { head: null, dirty: null };
  try {
    const observed = await (dependencies.readSource ?? readSource)(directory);
    if (!observed || !SHA.test(observed.head ?? '') || typeof observed.dirty !== 'boolean') throw new Error();
    source = { head: observed.head, dirty: observed.dirty };
    record(
      'CANDIDATE_SOURCE',
      source.head === options.sha && !source.dirty ? 'PASS' : 'FAIL',
      source.head !== options.sha
        ? 'HEAD_DIFFERS_FROM_CANDIDATE'
        : source.dirty
          ? 'WORKTREE_DIRTY'
          : 'EXACT_CLEAN_HEAD',
    );
  } catch {
    record('CANDIDATE_SOURCE', 'ERROR', 'SOURCE_IDENTITY_UNAVAILABLE');
  }
  let candidateBound = source.head === options.sha && source.dirty === false;
  try {
    const versions = (dependencies.verifyVersions ?? verifyWorkspaceVersions)(
      options.tag,
      directory,
    );
    record('WORKSPACE_VERSIONS', 'PASS', 'MANIFEST_VERSIONS_MATCH', {
      ...versions,
      evidenceScope: 'WORKTREE',
      candidateBound,
    });
  } catch (error) {
    const unavailable = typeof error?.code === 'string' || error instanceof SyntaxError;
    record(
      'WORKSPACE_VERSIONS',
      unavailable ? 'ERROR' : 'FAIL',
      unavailable ? 'VERSION_INVENTORY_UNAVAILABLE' : 'VERSION_INVENTORY_OR_MATCH_FAILED',
      { candidateBound },
    );
  }
  const env = dependencies.env ?? process.env;
  const ciOptions = {
    repository: options.repository ?? env.GITHUB_REPOSITORY,
    sha: options.sha,
    token: env.GH_TOKEN,
    apiUrl: env.GITHUB_API_URL,
  };
  const ciResults = await Promise.all(
    RELEASE_WORKFLOWS.map(async (workflow) => {
      const id = `REMOTE_CI:${workflow}`;
      if (!options.verifyCi)
        return { id, status: 'NOT_CHECKED', reason: 'REMOTE_QUERY_NOT_REQUESTED' };
      if (!ciOptions.token || !ciOptions.repository)
        return { id, status: 'NOT_CHECKED', reason: 'REMOTE_QUERY_CONFIGURATION_MISSING' };
      try {
        const run = await (dependencies.verifyWorkflow ?? verifyWorkflowCi)(ciOptions, workflow);
        return { id, status: 'PASS', reason: 'LATEST_EXACT_SHA_MAIN_PUSH_SUCCEEDED', details: run };
      } catch (error) {
        // A thrown network error can contain authorization details; expose only fixed reasons.
        return error?.gateStatus === 'FAIL'
          ? { id, status: 'FAIL', reason: 'LATEST_EXACT_SHA_MAIN_PUSH_NOT_SUCCESSFUL' }
          : { id, status: 'ERROR', reason: 'REMOTE_QUERY_FAILED' };
      }
    }),
  );
  for (const check of ciResults) record(check.id, check.status, check.reason, check.details);
  let artifact = null;
  if (options.artifact) {
    try {
      artifact = await (dependencies.artifactIdentity ?? artifactIdentity)(options.artifact);
      record('ARTIFACT_IDENTITY', 'PASS', 'BYTES_HASHED_SOURCE_BINDING_NOT_VERIFIED', artifact);
    } catch {
      record('ARTIFACT_IDENTITY', 'ERROR', 'ARTIFACT_IDENTITY_UNAVAILABLE');
    }
  } else record('ARTIFACT_IDENTITY', 'NOT_CHECKED', 'ARTIFACT_NOT_SELECTED');
  record('ARTIFACT_PROVENANCE_AND_ACCEPTANCE', 'NOT_CHECKED', 'REQUIRES_EXISTING_RELEASE_EVIDENCE');
  // File and network reads can outlive a checkout change. A clean preflight cannot bind
  // worktree observations to the candidate after HEAD or local bytes have moved.
  let finalSource = { head: null, dirty: null };
  const sourceCheck = checks.find((check) => check.id === 'CANDIDATE_SOURCE');
  try {
    const observed = await (dependencies.readSource ?? readSource)(directory);
    if (!observed || !SHA.test(observed.head ?? '') || typeof observed.dirty !== 'boolean') throw new Error();
    finalSource = { head: observed.head, dirty: observed.dirty };
    if (finalSource.head !== source.head || finalSource.dirty !== source.dirty) {
      sourceCheck.status = 'FAIL';
      sourceCheck.reason = 'SOURCE_CHANGED_DURING_CHECKS';
    }
    candidateBound = candidateBound && finalSource.head === options.sha && finalSource.dirty === false;
  } catch {
    candidateBound = false;
    sourceCheck.status = 'ERROR';
    sourceCheck.reason = 'SOURCE_IDENTITY_UNAVAILABLE';
  }
  sourceCheck.checkedAt = now().toISOString();
  const versionCheck = checks.find((check) => check.id === 'WORKSPACE_VERSIONS');
  versionCheck.details.candidateBound = candidateBound;
  const machineChecksPassed = checks
    .filter(
      (check) =>
        ['CANDIDATE_SOURCE', 'WORKSPACE_VERSIONS'].includes(check.id) ||
        check.id.startsWith('REMOTE_CI:') ||
        (options.artifact && check.id === 'ARTIFACT_IDENTITY'),
    )
    .every((check) => check.status === 'PASS');
  return {
    schemaVersion: '1.0',
    authority: 'READ_ONLY_DIAGNOSTIC',
    checkedAt,
    candidate: { tag: options.tag, sha: options.sha, repository: ciOptions.repository ?? null },
    source: { ...source, final: finalSource, candidateBound },
    artifact,
    checks,
    machineChecksPassed,
    status: machineChecksPassed ? 'MANUAL_REVIEW_REQUIRED' : 'MACHINE_CHECKS_INCOMPLETE',
    releaseApproved: false,
    manualGates: MANUAL_GATES.map(([id, text]) => ({
      id,
      text,
      status: 'PENDING',
      evidenceSource: 'BLOCKED.md / docs/releasing.md',
    })),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseReadinessArguments(process.argv.slice(2));
    if (options.help)
      process.stdout.write(
        'pnpm release:readiness -- --tag v1.0.0 --sha <full-sha> [--verify-ci] [--repository owner/repo] [--artifact file]\n',
      );
    else {
      const report = await releaseReadiness(options);
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      if (!report.machineChecksPassed) process.exitCode = 1;
    }
  } catch {
    process.stderr.write(
      'READINESS_REPORT_FAILED: use --help and supply a valid tag and full candidate SHA.\n',
    );
    process.exitCode = 2;
  }
}
