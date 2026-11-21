import { describe, expect, it } from 'vitest';
import type { WorkbenchReviewAttention, WorkbenchCoverage } from '@workmesh/shared';
import type { WorkbenchReviewItem } from '../api/resources';
import {
  currentWorkbenchAttention,
  workbenchCoverageStatus,
  workbenchReviewMatchesReason,
  workbenchStreamDescription,
  workbenchStreamPath,
} from './workbenchAttention';

const attention: WorkbenchReviewAttention = {
  reviewId: 'r1',
  reviewVersion: 2,
  checkedAt: '2026-11-12T01:00:00Z',
  status: 'PARTIAL',
  reportedChecks: { source: 'ARTIFACT_CHECKS', total: 2, failed: 1 },
  reasons: [
    {
      code: 'REPORTED_CHECK_FAILED',
      responsibleRole: null,
      nextAction: { kind: 'OPEN_REVIEW', reviewId: 'r1' },
    },
    {
      code: 'DETAILS_NOT_QUERIED',
      responsibleRole: null,
      nextAction: { kind: 'OPEN_REVIEW', reviewId: 'r1' },
    },
  ],
  qualityReport: 'NOT_QUERIED',
  codeReview: 'NOT_QUERIED',
  discussion: 'NOT_QUERIED',
  basis: 'UNKNOWN',
};
const review = { reviewId: 'r1', version: 2, attention } as WorkbenchReviewItem;
const stream: WorkbenchCoverage['streams'][number] = {
  stream: 'REVIEWS',
  projectIds: ['p/1'],
  projectKey: 'DEMO',
  status: 'PARTIAL',
  loadedCount: 2,
  hasMore: true,
  nextCursor: 'next',
  checkedAt: attention.checkedAt,
  reason: 'MORE_AVAILABLE',
  errorCode: null,
};

describe('workbench attention presentation', () => {
  it('filters only same-version summaries and keeps missing or mismatched details unknown', () => {
    expect(workbenchReviewMatchesReason(review, 'REPORTED_CHECK_FAILED')).toBe(true);
    const changed = { ...review, version: 3 };
    expect(currentWorkbenchAttention(changed)).toBeNull();
    expect(workbenchReviewMatchesReason(changed, 'REPORTED_CHECK_FAILED')).toBe(false);
    expect(workbenchReviewMatchesReason(changed, 'DETAILS_NOT_QUERIED')).toBe(true);
    expect(
      workbenchReviewMatchesReason({ ...review, attention: undefined }, 'DETAILS_NOT_QUERIED'),
    ).toBe(true);
  });

  it('does not mistake missing metadata or stream errors for complete coverage', () => {
    expect(workbenchCoverageStatus()).toBe('UNKNOWN');
    const coverage = {
      countBasis: 'LOADED_ROWS' as const,
      checkedAt: attention.checkedAt,
      streams: [stream],
    };
    expect(workbenchCoverageStatus(coverage)).toBe('PARTIAL');
    expect(
      workbenchCoverageStatus({ ...coverage, streams: [{ ...stream, status: 'ERROR' }] }),
    ).toBe('ERROR');
    expect(
      workbenchCoverageStatus({ ...coverage, streams: [{ ...stream, status: 'COMPLETE' }] }),
    ).toBe('COMPLETE');
    expect(workbenchStreamDescription(stream)).toContain('仍有后续记录');
    expect(workbenchStreamPath(stream)).toBe('/reviews?projectId=p%2F1');
    expect(workbenchStreamPath({ ...stream, projectIds: ['p1', 'p2'] })).toBe('/reviews');
  });
});
