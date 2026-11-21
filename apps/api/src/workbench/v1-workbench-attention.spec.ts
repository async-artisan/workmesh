import { describe, expect, it } from 'vitest';
import { workbenchPageCoverage, workbenchReviewAttention } from './v1-workbench-attention';

const scope = {
  stream: 'REVIEWS' as const,
  projectIds: ['project-1'],
  projectKey: 'DEMO',
  loadedCount: 3,
  checkedAt: '2026-11-12T01:00:00Z',
};

describe('workbench page coverage', () => {
  it('retains cursors and never calls a truncated page complete', () => {
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: { nextCursor: 'next-page', hasMore: false } },
      }),
    ).toMatchObject({ status: 'PARTIAL', nextCursor: 'next-page', hasMore: true, loadedCount: 3 });
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: { nextCursor: null, hasMore: true } },
      }),
    ).toMatchObject({ status: 'PARTIAL', nextCursor: null, hasMore: true });
  });

  it('distinguishes explicit exhaustion, unknown metadata, and failed reads', () => {
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: { nextCursor: null } },
      }).status,
    ).toBe('COMPLETE');
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: {} },
      }),
    ).toMatchObject({ status: 'UNKNOWN', reason: 'PAGINATION_UNCONFIRMED', hasMore: null });
    expect(
      workbenchPageCoverage({
        ...scope,
        loadedCount: 0,
        page: { status: 'rejected', reason: { code: 'SCOPE_DENIED' } },
      }),
    ).toMatchObject({ status: 'ERROR', errorCode: 'SCOPE_DENIED', hasMore: null });
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: { nextCursor: null } },
        enrichmentError: undefined,
      }).status,
    ).toBe('ERROR');
  });

  it('does not advertise complete actionable coverage when permissions were not loaded', () => {
    expect(
      workbenchPageCoverage({
        ...scope,
        page: { status: 'fulfilled', value: { nextCursor: null } },
        permissionsUnavailable: true,
      }),
    ).toMatchObject({ status: 'PARTIAL', reason: 'PERMISSIONS_UNAVAILABLE', hasMore: false });
  });
});

describe('workbench review attention', () => {
  it('retains the report source, review version, owner and entry without claiming detailed checks', () => {
    const attention = workbenchReviewAttention({
      reviewId: 'review/1',
      reviewVersion: 4,
      checkedAt: scope.checkedAt,
      checks: { total: 2, failed: 1 },
      role: { id: 'role-1', key: 'qa', title: 'QA' },
    });
    expect(attention).toMatchObject({
      reviewId: 'review/1',
      reviewVersion: 4,
      status: 'PARTIAL',
      reportedChecks: { source: 'ARTIFACT_CHECKS', total: 2, failed: 1 },
      qualityReport: 'NOT_QUERIED',
      codeReview: 'NOT_QUERIED',
      discussion: 'NOT_QUERIED',
      basis: 'UNKNOWN',
    });
    expect(attention.reasons).toEqual([
      {
        code: 'REPORTED_CHECK_FAILED',
        responsibleRole: { id: 'role-1', key: 'qa', title: 'QA' },
        nextAction: { kind: 'OPEN_REVIEW', reviewId: 'review/1' },
      },
      {
        code: 'DETAILS_NOT_QUERIED',
        responsibleRole: { id: 'role-1', key: 'qa', title: 'QA' },
        nextAction: { kind: 'OPEN_REVIEW', reviewId: 'review/1' },
      },
    ]);
  });

  it('does not turn zero reported failures into a verified pass or guess a responsible role', () => {
    const attention = workbenchReviewAttention({
      reviewId: 'review-1',
      reviewVersion: 1,
      checkedAt: scope.checkedAt,
      checks: { total: 0, failed: 0 },
      role: null,
    });
    expect(attention.status).toBe('PARTIAL');
    expect(attention.reasons).toEqual([
      {
        code: 'DETAILS_NOT_QUERIED',
        responsibleRole: null,
        nextAction: { kind: 'OPEN_REVIEW', reviewId: 'review-1' },
      },
    ]);
  });
});
