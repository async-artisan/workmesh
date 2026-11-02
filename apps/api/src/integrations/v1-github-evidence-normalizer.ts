import {
  evaluateRepositoryEvidence,
  type RepositoryEvidenceInput,
  type ReviewEvidence,
} from './v1-code-evidence-policy';
import {
  isRecord,
  parseGithubPullRequest,
  parseGithubRepository,
  parseGithubReview,
  payloadInvalid,
  repositoryStableKeyOf,
} from './v1-github-payload';
import type {
  NormalizedChangeRequest,
  NormalizedReview,
  RepositoryIdentity,
} from './v1-code-host-adapter';

/** 提交级证据中与 GitHub 厂商语义相关的独立拒绝原因。 */
export const GITHUB_EVIDENCE_REJECTION_REASONS = [
  'SIGNATURE_INVALID',
  'AUTHOR_SELF_REVIEW',
  'BOT_REVIEWER',
  'STALE_COMMIT',
  'REVIEW_DISMISSED',
  'CHANGES_REQUESTED',
  'HEAD_CHANGED',
] as const;

export type GithubEvidenceRejectionReason = (typeof GITHUB_EVIDENCE_REJECTION_REASONS)[number];

export type GithubEvidenceOptions = {
  signatureValid?: boolean;
  artifactCommitSha?: string | null;
  expectedHeadSha?: string | null;
};

export type GithubEvidenceResult = {
  repository: RepositoryIdentity;
  evidence: RepositoryEvidenceInput;
  decision: 'VALID' | 'INVALID' | 'UNKNOWN';
  reasons: string[];
};

/**
 * 把归一化的 GitHub change request 转成提交级证据输入并执行拒绝规则：
 * 作者自审 / Bot / 旧提交批准 / dismissed / changes_requested / head 变化 / 坏签名。
 */
export function evaluateGithubChangeRequestEvidence(
  changeRequest: NormalizedChangeRequest,
  options: GithubEvidenceOptions = {},
): GithubEvidenceResult {
  const headSha = changeRequest.headSha;
  const authorExternalId = changeRequest.authorExternalId;
  const reasons: string[] = [];

  if (options.signatureValid === false) reasons.push('SIGNATURE_INVALID');
  if (
    options.expectedHeadSha !== undefined &&
    options.expectedHeadSha !== null &&
    options.expectedHeadSha !== headSha
  )
    reasons.push('HEAD_CHANGED');
  if (
    options.artifactCommitSha !== undefined &&
    options.artifactCommitSha !== null &&
    options.artifactCommitSha !== headSha
  )
    reasons.push('HEAD_CHANGED');

  for (const review of changeRequest.reviews) {
    if (review.reviewerId === authorExternalId) reasons.push('AUTHOR_SELF_REVIEW');
    if (review.reviewerKind === 'BOT') reasons.push('BOT_REVIEWER');
    if (review.state === 'DISMISSED') reasons.push('REVIEW_DISMISSED');
    if (review.state === 'CHANGES_REQUESTED') reasons.push('CHANGES_REQUESTED');
    if (review.state === 'APPROVED' && review.commitSha !== headSha) reasons.push('STALE_COMMIT');
  }

  const evidence: RepositoryEvidenceInput = {
    repositoryId: repositoryStableKeyOf(changeRequest.repository),
    changeRequestId: changeRequest.externalId,
    changeRequestHeadSha: headSha,
    authorExternalId,
    merged: changeRequest.merged,
    artifactCommitSha: options.artifactCommitSha ?? null,
    reviews: changeRequest.reviews.map(toPolicyReview),
  };

  const policy = evaluateRepositoryEvidence(evidence);
  const mergedReasons = dedupeReasons([...reasons, ...policy.reasons]);
  return {
    repository: changeRequest.repository,
    evidence,
    decision: reasons.length > 0 ? 'INVALID' : policy.decision,
    reasons: mergedReasons,
  };
}

/** fixture / webhook 场景入口：从原始 GitHub repository/pull_request/reviews 归一化。 */
export function normalizeGithubPullRequestEvidence(
  source: { repository: unknown; pullRequest: unknown; reviews: readonly unknown[] },
  options: GithubEvidenceOptions = {},
): GithubEvidenceResult {
  const repository = parseGithubRepository(source.repository);
  const pullRequest = parseGithubPullRequest(source.pullRequest, repository);
  const reviews = source.reviews.map((review) => parseGithubReview(review));
  return evaluateGithubChangeRequestEvidence({ ...pullRequest, reviews }, options);
}

/** 解析 pull_request / pull_request_review webhook payload，review 事件单条或数组均可。 */
export function normalizeGithubWebhookPayload(
  payload: unknown,
  options: GithubEvidenceOptions = {},
): GithubEvidenceResult {
  if (!isRecord(payload)) throw payloadInvalid('webhook');
  const repository = parseGithubRepository(payload.repository);
  const pullRequest = parseGithubPullRequest(payload.pull_request, repository);
  const reviews: NormalizedReview[] = [];
  if (isRecord(payload.review)) reviews.push(parseGithubReview(payload.review));
  if (Array.isArray(payload.reviews)) {
    for (const review of payload.reviews) reviews.push(parseGithubReview(review));
  }
  return evaluateGithubChangeRequestEvidence({ ...pullRequest, reviews }, options);
}

function toPolicyReview(review: NormalizedChangeRequest['reviews'][number]): ReviewEvidence {
  return {
    reviewId: review.reviewId,
    reviewerId: review.reviewerId,
    reviewerKind: review.reviewerKind,
    state: review.state,
    commitSha: review.commitSha,
    submittedAt: review.submittedAt,
  };
}

function dedupeReasons(reasons: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    result.push(reason);
  }
  return result;
}
