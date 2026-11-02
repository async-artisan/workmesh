import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type {
  ChangeRequestState,
  NormalizedReview,
  RepositoryIdentity,
} from './v1-code-host-adapter';

type ReviewEvidenceState = 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';

export type NormalizedPullRequest = {
  repository: RepositoryIdentity;
  externalId: string;
  numberLabel: string;
  title: string;
  authorExternalId: string;
  authorKind: 'USER' | 'BOT';
  headSha: string;
  baseSha: string;
  state: ChangeRequestState;
  merged: boolean;
  mergedCommitSha: string | null;
  mergedAt: string | null;
  providerUpdatedAt: string;
};

const REVIEW_STATES: Record<string, ReviewEvidenceState> = {
  approved: 'APPROVED',
  changes_requested: 'CHANGES_REQUESTED',
  dismissed: 'DISMISSED',
  commented: 'COMMENTED',
  pending: 'PENDING',
};

export function payloadInvalid(field: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
    'GITHUB_PAYLOAD_INVALID',
    { field },
    422,
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function repositoryStableKeyOf(
  identity: Pick<RepositoryIdentity, 'provider' | 'externalRepositoryId'>,
): string {
  return `${identity.provider}:${identity.externalRepositoryId}`;
}

/** 仓库身份以稳定数值 ID 为准；owner/name/fullName 可变，只用于展示与定位。 */
export function parseGithubRepository(
  raw: unknown,
  fallback?: { owner?: string; name?: string },
): RepositoryIdentity {
  const repository = asRecord(raw, 'repository');
  const externalRepositoryId = idToString(repository.id, 'repository.id');
  const name = optionalNonEmptyString(repository.name) ?? fallback?.name ?? '';
  const ownerRecord = isRecord(repository.owner) ? repository.owner : null;
  const owner = optionalNonEmptyString(ownerRecord?.login) ?? fallback?.owner ?? '';
  if (name.length === 0) throw payloadInvalid('repository.name');
  if (owner.length === 0) throw payloadInvalid('repository.owner.login');
  const fullName = optionalNonEmptyString(repository.full_name) ?? `${owner}/${name}`;
  const defaultBranch = optionalNonEmptyString(repository.default_branch);
  return {
    provider: 'GITHUB',
    externalRepositoryId,
    stableKey: repositoryStableKeyOf({ provider: 'GITHUB', externalRepositoryId }),
    owner,
    name,
    fullName,
    defaultBranch,
  };
}

export function parseGithubPullRequest(
  raw: unknown,
  repository: RepositoryIdentity,
): NormalizedPullRequest {
  const pullRequest = asRecord(raw, 'pull_request');
  const externalId = idToString(pullRequest.id, 'pull_request.id');
  const number = pullRequest.number;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0)
    throw payloadInvalid('pull_request.number');
  const user = asRecord(pullRequest.user, 'pull_request.user');
  const authorExternalId = idToString(user.id, 'pull_request.user.id');
  const head = asRecord(pullRequest.head, 'pull_request.head');
  const base = asRecord(pullRequest.base, 'pull_request.base');
  const headSha = asString(head.sha, 'pull_request.head.sha');
  const baseSha = asString(base.sha, 'pull_request.base.sha');
  const providerState = asString(pullRequest.state, 'pull_request.state').toLowerCase();
  const merged = pullRequest.merged === true;
  const state: ChangeRequestState = merged
    ? 'MERGED'
    : providerState === 'open'
      ? 'OPEN'
      : 'CLOSED';
  const providerUpdatedAt = asString(pullRequest.updated_at, 'pull_request.updated_at');
  return {
    repository,
    externalId,
    numberLabel: `#${number}`,
    title: optionalNonEmptyString(pullRequest.title) ?? '',
    authorExternalId,
    authorKind: userKindOf(user),
    headSha,
    baseSha,
    state,
    merged,
    mergedCommitSha: optionalNonEmptyString(pullRequest.merge_commit_sha),
    mergedAt: optionalNonEmptyString(pullRequest.merged_at),
    providerUpdatedAt,
  };
}

export function parseGithubReview(raw: unknown): NormalizedReview {
  const review = asRecord(raw, 'review');
  const reviewId = idToString(review.id, 'review.id');
  const user = asRecord(review.user, 'review.user');
  const reviewerId = idToString(user.id, 'review.user.id');
  const rawState = asString(review.state, 'review.state').toLowerCase();
  const state = REVIEW_STATES[rawState];
  if (!state) throw payloadInvalid('review.state');
  return {
    reviewId,
    reviewerId,
    reviewerKind: userKindOf(user),
    state,
    commitSha: optionalNonEmptyString(review.commit_id),
    submittedAt: optionalNonEmptyString(review.submitted_at),
  };
}

function userKindOf(user: Record<string, unknown>): 'USER' | 'BOT' {
  return typeof user.type === 'string' && user.type.toLowerCase() === 'bot' ? 'BOT' : 'USER';
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw payloadInvalid(field);
  return value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw payloadInvalid(field);
  return value;
}

function optionalNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** GitHub 数值 ID 转字符串，避免把外部身份转成会丢精度的本地数值。 */
function idToString(value: unknown, field: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  throw payloadInvalid(field);
}
