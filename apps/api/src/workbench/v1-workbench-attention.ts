import type {
  WorkbenchReviewAttention,
  WorkbenchStream,
  WorkbenchStreamCoverage,
} from '@workmesh/shared';

function errorCodeOf(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/** Only already-authorized page metadata is projected; this performs no further reads. */
export function workbenchPageCoverage(input: {
  stream: WorkbenchStream;
  projectIds: string[];
  projectKey: string | null;
  loadedCount: number;
  checkedAt: string;
  page: PromiseSettledResult<{ nextCursor?: string | null; hasMore?: boolean }>;
  enrichmentError?: unknown;
  permissionsUnavailable?: boolean;
}): WorkbenchStreamCoverage {
  const { stream, projectIds, projectKey, loadedCount, checkedAt } = input;
  const base = { stream, projectIds, projectKey, loadedCount, checkedAt };
  if (input.page.status === 'rejected' || 'enrichmentError' in input) {
    return {
      ...base,
      status: 'ERROR',
      hasMore: null,
      nextCursor: null,
      reason: 'LOAD_FAILED',
      errorCode: errorCodeOf(
        input.page.status === 'rejected' ? input.page.reason : input.enrichmentError,
      ),
    };
  }
  const page = input.page.value;
  const nextCursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
  const hasMore = nextCursor !== null || page.hasMore === true;
  const complete = !hasMore && (page.hasMore === false || page.nextCursor === null);
  return {
    ...base,
    status: hasMore || input.permissionsUnavailable ? 'PARTIAL' : complete ? 'COMPLETE' : 'UNKNOWN',
    hasMore: hasMore ? true : complete ? false : null,
    nextCursor,
    reason: hasMore
      ? 'MORE_AVAILABLE'
      : input.permissionsUnavailable
        ? 'PERMISSIONS_UNAVAILABLE'
        : complete
          ? null
          : 'PAGINATION_UNCONFIRMED',
    errorCode: null,
  };
}

/** Artifact checks are submitter reports, never independent execution or approval facts. */
export function workbenchReviewAttention(input: {
  reviewId: string;
  reviewVersion: number;
  checkedAt: string;
  checks: { total: number; failed: number };
  role: { id: string; key: string; title: string } | null;
}): WorkbenchReviewAttention {
  const reason = (code: WorkbenchReviewAttention['reasons'][number]['code']) => ({
    code,
    responsibleRole: input.role,
    nextAction: { kind: 'OPEN_REVIEW' as const, reviewId: input.reviewId },
  });
  return {
    reviewId: input.reviewId,
    reviewVersion: input.reviewVersion,
    checkedAt: input.checkedAt,
    status: 'PARTIAL',
    reportedChecks: { source: 'ARTIFACT_CHECKS', ...input.checks },
    reasons: [
      ...(input.checks.failed > 0 ? [reason('REPORTED_CHECK_FAILED')] : []),
      reason('DETAILS_NOT_QUERIED'),
    ],
    qualityReport: 'NOT_QUERIED',
    codeReview: 'NOT_QUERIED',
    discussion: 'NOT_QUERIED',
    basis: 'UNKNOWN',
  };
}
