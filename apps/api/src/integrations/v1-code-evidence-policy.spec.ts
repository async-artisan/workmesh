import { describe, expect, it } from 'vitest';
import { evaluateCodeEvidenceSet, evaluateRepositoryEvidence } from './v1-code-evidence-policy';

describe('v1 code evidence policy', () => {
  const base = { repositoryId: 'repo-1', changeRequestId: 'cr-1', changeRequestHeadSha: 'head-2', authorExternalId: 'author', merged: true, artifactCommitSha: 'head-2' };
  it('requires current-head approval by another user', () => {
    expect(evaluateRepositoryEvidence({ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'author', reviewerKind: 'USER', state: 'APPROVED', commitSha: 'head-2', submittedAt: '1' }] }).decision).toBe('INVALID');
    expect(evaluateRepositoryEvidence({ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'bot', reviewerKind: 'BOT', state: 'APPROVED', commitSha: 'head-2', submittedAt: '1' }] }).decision).toBe('INVALID');
    expect(evaluateRepositoryEvidence({ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'reviewer', reviewerKind: 'USER', state: 'APPROVED', commitSha: 'head-2', submittedAt: '1' }] }).decision).toBe('VALID');
  });

  it('rejects stale approval and active changes requested', () => {
    const stale = evaluateRepositoryEvidence({ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'reviewer', reviewerKind: 'USER', state: 'APPROVED', commitSha: 'head-1', submittedAt: '1' }] });
    expect(stale.reasons).toContain('APPROVAL_HEAD_MISMATCH');
    const changes = evaluateRepositoryEvidence({ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'reviewer', reviewerKind: 'USER', state: 'CHANGES_REQUESTED', commitSha: 'head-2', submittedAt: '1' }] });
    expect(changes.reasons).toContain('CHANGES_REQUESTED_ACTIVE');
  });

  it('requires every repository in a multi-repository artifact set', () => {
    expect(evaluateCodeEvidenceSet([{ ...base, reviews: [{ reviewId: 'r1', reviewerId: 'reviewer', reviewerKind: 'USER', state: 'APPROVED', commitSha: 'head-2', submittedAt: '1' }] }, { ...base, repositoryId: 'repo-2', reviews: [] }])).toMatchObject({ decision: 'INVALID', reasons: ['REPOSITORY_EVIDENCE_REQUIRED'] });
  });
});
