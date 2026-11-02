import { describe, expect, it } from 'vitest';
import fixture from './fixtures/github-evidence.fixture.json';
import {
  normalizeGithubPullRequestEvidence,
  normalizeGithubWebhookPayload,
} from './v1-github-evidence-normalizer';

type ScenarioOptions = {
  signatureValid?: boolean;
  artifactCommitSha?: string | null;
};

type Scenario = { reviewsKey: string; options: ScenarioOptions };

const reviewsByKey = fixture.reviews as Record<string, unknown>;
const scenarios = fixture.scenarios as Record<string, Scenario>;

const expected: Record<string, { decision: 'VALID' | 'INVALID'; reason: string | null }> = {
  valid: { decision: 'VALID', reason: null },
  author_self_review: { decision: 'INVALID', reason: 'AUTHOR_SELF_REVIEW' },
  bot_reviewer: { decision: 'INVALID', reason: 'BOT_REVIEWER' },
  stale_commit: { decision: 'INVALID', reason: 'STALE_COMMIT' },
  dismissed: { decision: 'INVALID', reason: 'REVIEW_DISMISSED' },
  changes_requested: { decision: 'INVALID', reason: 'CHANGES_REQUESTED' },
  head_changed: { decision: 'INVALID', reason: 'HEAD_CHANGED' },
  bad_signature: { decision: 'INVALID', reason: 'SIGNATURE_INVALID' },
};

describe('github commit-level evidence normalization', () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    it(`fixture scenario: ${name}`, () => {
      const rawReviews = reviewsByKey[scenario.reviewsKey];
      if (!Array.isArray(rawReviews))
        throw new Error(`fixture reviews missing: ${scenario.reviewsKey}`);
      const result = normalizeGithubPullRequestEvidence(
        { repository: fixture.repository, pullRequest: fixture.pullRequest, reviews: rawReviews },
        scenario.options,
      );

      const expectation = expected[name];
      expect(expectation).toBeDefined();
      expect(result.decision).toBe(expectation.decision);
      if (expectation.reason === null) {
        expect(result.reasons).toEqual([]);
      } else {
        expect(result.reasons).toContain(expectation.reason);
      }
      expect(result.evidence.repositoryId).toBe('GITHUB:1296269');
      expect(result.evidence.changeRequestId).toBe('987654');
      expect(result.evidence.changeRequestHeadSha).toBe('head-sha-current');
    });
  }

  it('uses stable numeric repository identity rather than mutable full name', () => {
    const first = normalizeGithubPullRequestEvidence({
      repository: fixture.repository,
      pullRequest: fixture.pullRequest,
      reviews: reviewsByKey.valid as readonly unknown[],
    });
    const renamed = normalizeGithubPullRequestEvidence({
      repository: fixture.repositoryRenamed,
      pullRequest: fixture.pullRequest,
      reviews: reviewsByKey.valid as readonly unknown[],
    });
    expect(first.evidence.repositoryId).toBe(renamed.evidence.repositoryId);
    expect(first.repository.fullName).not.toBe(renamed.repository.fullName);
    expect(first.repository.externalRepositoryId).toBe('1296269');
  });

  it('normalizes a pull_request_review webhook payload', () => {
    const result = normalizeGithubWebhookPayload(fixture.webhookReviewPayload, {
      signatureValid: true,
      artifactCommitSha: 'head-sha-current',
    });
    expect(result.decision).toBe('VALID');
    expect(result.reasons).toEqual([]);
    expect(result.evidence.authorExternalId).toBe('1001');
    expect(result.evidence.reviews).toEqual([
      {
        reviewId: '501',
        reviewerId: '2001',
        reviewerKind: 'USER',
        state: 'APPROVED',
        commitSha: 'head-sha-current',
        submittedAt: '2026-10-31T09:00:00Z',
      },
    ]);
  });

  it('rejects an unsigned webhook payload', () => {
    const result = normalizeGithubWebhookPayload(fixture.webhookReviewPayload, {
      signatureValid: false,
      artifactCommitSha: 'head-sha-current',
    });
    expect(result.decision).toBe('INVALID');
    expect(result.reasons).toContain('SIGNATURE_INVALID');
  });
});
