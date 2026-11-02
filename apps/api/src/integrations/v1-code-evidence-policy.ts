export type ReviewEvidence = {
  reviewerId: string;
  reviewerKind: 'USER' | 'BOT';
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';
  commitSha: string | null;
  submittedAt: string | null;
  reviewId: string;
};

export type RepositoryEvidenceInput = {
  repositoryId: string;
  changeRequestId: string;
  changeRequestHeadSha: string | null;
  authorExternalId: string | null;
  merged: boolean;
  reviews: ReviewEvidence[];
  artifactCommitSha: string | null;
};

export function evaluateRepositoryEvidence(input: RepositoryEvidenceInput): { decision: 'VALID' | 'INVALID' | 'UNKNOWN'; reasons: string[] } {
  const reasons: string[] = [];
  if (!input.changeRequestHeadSha || !input.authorExternalId) return { decision: 'UNKNOWN', reasons: ['UPSTREAM_REQUIRED_FIELD_MISSING'] };
  if (!input.merged) reasons.push('CHANGE_REQUEST_NOT_MERGED');
  if (!input.artifactCommitSha || input.artifactCommitSha !== input.changeRequestHeadSha) reasons.push('ARTIFACT_HEAD_MISMATCH');
  const byReviewer = new Map<string, ReviewEvidence>();
  for (const review of [...input.reviews].sort((a, b) => (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') || a.reviewId.localeCompare(b.reviewId))) {
    if (review.reviewerKind === 'USER') byReviewer.set(review.reviewerId, review);
  }
  const current = [...byReviewer.values()].filter((review) => review.reviewerId !== input.authorExternalId);
  if (current.some((review) => review.state === 'CHANGES_REQUESTED')) reasons.push('CHANGES_REQUESTED_ACTIVE');
  if (!current.some((review) => review.state === 'APPROVED' && review.commitSha === input.changeRequestHeadSha)) reasons.push('OTHER_USER_APPROVAL_REQUIRED');
  if (current.some((review) => review.state === 'APPROVED' && review.commitSha !== input.changeRequestHeadSha)) reasons.push('APPROVAL_HEAD_MISMATCH');
  if (reasons.length > 0) return { decision: 'INVALID', reasons: [...new Set(reasons)] };
  return { decision: 'VALID', reasons: [] };
}

export function evaluateCodeEvidenceSet(inputs: RepositoryEvidenceInput[]): { decision: 'VALID' | 'INVALID' | 'UNKNOWN'; reasons: string[] } {
  if (inputs.length === 0) return { decision: 'INVALID', reasons: ['REPOSITORY_EVIDENCE_REQUIRED'] };
  const results = inputs.map((input) => input.reviews.length === 0 ? { decision: 'INVALID' as const, reasons: ['REPOSITORY_EVIDENCE_REQUIRED'] } : evaluateRepositoryEvidence(input));
  if (results.some((result) => result.decision === 'UNKNOWN')) return { decision: 'UNKNOWN', reasons: ['REPOSITORY_EVIDENCE_INCOMPLETE'] };
  const invalid = results.flatMap((result) => result.reasons);
  return invalid.length ? { decision: 'INVALID', reasons: [...new Set(invalid)] } : { decision: 'VALID', reasons: [] };
}
