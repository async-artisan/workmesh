/** Read-only workbench explanations. These never grant formal decision authority. */
export const WORKBENCH_ATTENTION_REASON_CODES = [
  'REPORTED_CHECK_FAILED',
  'DETAILS_NOT_QUERIED',
] as const;

export type WorkbenchAttentionReasonCode = (typeof WORKBENCH_ATTENTION_REASON_CODES)[number];

export type WorkbenchReviewAttention = {
  reviewId: string;
  reviewVersion: number;
  checkedAt: string;
  /** Detailed evidence has deliberately not been read by this aggregation. */
  status: 'PARTIAL';
  reportedChecks: { source: 'ARTIFACT_CHECKS'; total: number; failed: number };
  reasons: Array<{
    code: WorkbenchAttentionReasonCode;
    responsibleRole: { id: string; key: string; title: string } | null;
    nextAction: { kind: 'OPEN_REVIEW'; reviewId: string };
  }>;
  qualityReport: 'NOT_QUERIED';
  codeReview: 'NOT_QUERIED';
  discussion: 'NOT_QUERIED';
  basis: 'UNKNOWN';
};

export type WorkbenchStream = 'REVIEWS' | 'CHANGES' | 'READY_TASKS' | 'OVERDUE_APPROVALS';

export type WorkbenchStreamCoverage = {
  stream: WorkbenchStream;
  /** One project per domain page; the overdue cap applies to all selected projects together. */
  projectIds: string[];
  projectKey: string | null;
  status: 'COMPLETE' | 'PARTIAL' | 'ERROR' | 'UNKNOWN';
  loadedCount: number;
  hasMore: boolean | null;
  nextCursor: string | null;
  checkedAt: string;
  reason:
    'MORE_AVAILABLE' | 'PAGINATION_UNCONFIRMED' | 'LOAD_FAILED' | 'PERMISSIONS_UNAVAILABLE' | null;
  errorCode: string | null;
};

export type WorkbenchCoverage = {
  countBasis: 'LOADED_ROWS';
  checkedAt: string;
  streams: WorkbenchStreamCoverage[];
};
