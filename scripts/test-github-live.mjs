import { createRequire } from 'node:module';

const report = (status, detail) =>
  console.log(JSON.stringify({ suite: 'github-live', status, ...detail }));
const enabled = process.env.WORKMESH_GITHUB_LIVE === '1';
if (!enabled) {
  console.log(
    JSON.stringify({
      suite: 'github-live',
      status: 'SKIPPED',
      reason: 'WORKMESH_GITHUB_LIVE=1 and an independently authorized test repository are required',
    }),
  );
  process.exit(0);
}
if (!process.env.WORKMESH_GITHUB_TEST_REPOSITORY) {
  console.error(
    JSON.stringify({
      suite: 'github-live',
      status: 'BLOCKED',
      reason: 'WORKMESH_GITHUB_TEST_REPOSITORY is missing',
    }),
  );
  process.exit(2);
}
const repository = process.env.WORKMESH_GITHUB_TEST_REPOSITORY;
const number = Number(process.env.WORKMESH_GITHUB_TEST_PR);
if (
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
  !Number.isSafeInteger(number) ||
  number <= 0
) {
  report('BLOCKED', { reason: 'Set an owner/repository and positive WORKMESH_GITHUB_TEST_PR' });
  process.exit(2);
}

// Only this fixed HTTPS origin receives credentials. Never follow redirects or
// log response bodies, raw reviews, author identities, tokens or request headers.
async function read(path) {
  const token = process.env.WORKMESH_GITHUB_TEST_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GITHUB_HTTP_${response.status}`);
  return response.json();
}

try {
  // Load before any request so a missing build fails without network access.
  const require = createRequire(import.meta.url);
  const {
    normalizeGithubPullRequestEvidence,
  } = require('../apps/api/dist/integrations/v1-github-evidence-normalizer.js');
  const repo = await read('');
  const pullRequest = await read(`/pulls/${number}`);
  const reviews = [];
  let complete = false;
  for (let page = 1; page <= 100; page += 1) {
    const batch = await read(`/pulls/${number}/reviews?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('GITHUB_REVIEWS_INVALID');
    reviews.push(...batch);
    if (batch.length < 100) {
      complete = true;
      break;
    }
  }
  if (!complete) throw new Error('GITHUB_REVIEW_PAGINATION_LIMIT');
  const latest = await read(`/pulls/${number}`);
  if (latest.head?.sha !== pullRequest.head?.sha || latest.updated_at !== pullRequest.updated_at)
    throw new Error('GITHUB_PR_CHANGED_DURING_READ');
  const result = normalizeGithubPullRequestEvidence(
    { repository: repo, pullRequest, reviews },
    { artifactCommitSha: pullRequest.head?.sha },
  );
  const expected = process.env.WORKMESH_GITHUB_EXPECT_DECISION;
  if (expected && !['VALID', 'INVALID', 'UNKNOWN'].includes(expected))
    throw new Error('EXPECTED_DECISION_INVALID');
  if (expected && result.decision !== expected) throw new Error('EVIDENCE_DECISION_MISMATCH');
  report('PASSED', {
    scope:
      'read-only GitHub API and production evidence normalizer; webhook delivery not exercised',
    reviewCount: reviews.length,
    decision: result.decision,
    reasons: result.reasons,
    expectedDecisionAsserted: Boolean(expected),
  });
} catch (error) {
  // Upstream/network errors may include URLs or credentials; emit only known codes.
  const message =
    typeof error?.message === 'string' && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'LIVE_CHECK_FAILED';
  report('FAILED', { reason: message });
  process.exitCode = 1;
}
