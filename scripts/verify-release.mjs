#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SemVer 2.0: numeric identifiers cannot have leading zeroes.
const numeric = '(?:0|[1-9][0-9]*)';
const prerelease = `(?:${numeric}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)`;
const semver = new RegExp(
  String.raw`^${numeric}\.${numeric}\.${numeric}(?:-${prerelease}(?:\.${prerelease})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$`,
);

export function releaseVersion(tag) {
  if (
    typeof tag !== 'string' ||
    tag.trim() !== tag ||
    !tag.startsWith('v') ||
    !semver.test(tag.slice(1))
  ) {
    throw new Error(`Release tag '${tag}' must be v followed by a valid SemVer 2.0 version.`);
  }
  return tag.slice(1);
}

export function verifyWorkspaceVersions(tag, directory = root) {
  const version = releaseVersion(tag);
  // These are the two package globs in this repository's workspace manifest.
  // Refuse a changed layout until the release inventory is updated explicitly.
  const workspace = readFileSync(join(directory, 'pnpm-workspace.yaml'), 'utf8');
  if (
    !/^packages:\s*\r?\n\s+- ['"]?apps[/]\*['"]?\s*\r?\n\s+- ['"]?packages[/]\*['"]?\s*$/.test(
      workspace,
    )
  ) {
    throw new Error('Update release workspace discovery for the changed pnpm-workspace.yaml.');
  }
  const manifests = [join(directory, 'package.json')];
  for (const group of ['apps', 'packages']) {
    for (const entry of readdirSync(join(directory, group), { withFileTypes: true })) {
      const manifest = join(directory, group, entry.name, 'package.json');
      if (entry.isDirectory() && existsSync(manifest)) manifests.push(manifest);
    }
  }
  for (const manifest of manifests) {
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    if (metadata.version !== version) {
      throw new Error(
        `${metadata.name ?? manifest} version ${metadata.version} does not match ${tag}.`,
      );
    }
  }
  return { version, packages: manifests.length };
}

export function successfulRun(runs, { sha, workflow }) {
  const eligible = runs.filter(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === 'main' &&
      run.event === 'push' &&
      run.path?.split('@')[0] === `.github/workflows/${workflow}`,
  );
  eligible.sort(
    (left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at) ||
      right.id - left.id ||
      right.run_attempt - left.run_attempt,
  );
  const latest = eligible[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(
      `${workflow} requires a successful latest main push run for ${sha}; got ${latest ? `${latest.status}/${latest.conclusion}` : 'no matching run'}.`,
    );
  }
  return { workflow, id: latest.id, attempt: latest.run_attempt, url: latest.html_url };
}

export async function verifyCi(
  { repository, sha, token, apiUrl = 'https://api.github.com' },
  request = fetch,
) {
  if (!/^[A-Za-z0-9_.-]+[/][A-Za-z0-9_.-]+$/.test(repository ?? '')) {
    throw new Error('GITHUB_REPOSITORY must identify owner/repository.');
  }
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error('GITHUB_SHA must be a full commit SHA.');
  if (!token) throw new Error('GH_TOKEN is required to verify release CI runs.');
  const base = new URL(apiUrl);
  if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) {
    throw new Error('GITHUB_API_URL must be an HTTPS API base URL.');
  }
  return Promise.all(
    ['ci.yml', 'platform-smoke.yml'].map(async (workflow) => {
      const runs = [];
      for (let page = 1; page <= 10; page += 1) {
        const url = new URL(
          `${base.href.endsWith('/') ? base.href.slice(0, -1) : base.href}/repos/${repository}/actions/workflows/${workflow}/runs`,
        );
        url.search = new URLSearchParams({
          head_sha: sha,
          branch: 'main',
          event: 'push',
          per_page: '100',
          page: String(page),
        }).toString();
        const response = await request(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok)
          throw new Error(`Cannot verify ${workflow}: GitHub API HTTP ${response.status}.`);
        const body = await response.json();
        if (!Array.isArray(body.workflow_runs))
          throw new Error(`Invalid GitHub API response for ${workflow}.`);
        runs.push(...body.workflow_runs);
        if (body.workflow_runs.length < 100) return successfulRun(runs, { sha, workflow });
      }
      throw new Error(`Too many ${workflow} runs to verify safely; narrow the release candidate.`);
    }),
  );
}

async function main(args) {
  if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== '--verify-ci')) {
    throw new Error('Usage: node scripts/verify-release.mjs v1.2.3 [--verify-ci]');
  }
  const result = verifyWorkspaceVersions(args[0]);
  if (args[1]) {
    result.ci = await verifyCi({
      repository: process.env.GITHUB_REPOSITORY,
      sha: process.env.GITHUB_SHA,
      token: process.env.GH_TOKEN,
      apiUrl: process.env.GITHUB_API_URL,
    });
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
