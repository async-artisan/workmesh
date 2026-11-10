export interface ProvenanceReview {
  id: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  commitSha: string | null;
  reviewerExternalId: string;
  authorExternalId: string;
  reviewerKind: string;
  state: string;
  submittedAt: Date | null;
  createdAt: Date;
  receipt: { signatureValid: boolean; status: string } | null;
}

/** One provenance rule for preparation, consumption, final acceptance and read views. */
export function codeEvidenceReviewReasons(
  row: ProvenanceReview,
  reviews: readonly ProvenanceReview[],
  expected: { repositoryId: string; headSha: string },
): string[] {
  const related = reviews.filter(
    (item) =>
      item.repositoryId === row.repositoryId && item.changeRequestId === row.changeRequestId,
  );
  const latest = new Map<string, ProvenanceReview>();
  for (const item of [...related].sort(
    (a, b) =>
      (a.submittedAt ?? a.createdAt).getTime() - (b.submittedAt ?? b.createdAt).getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  ))
    latest.set(item.reviewerExternalId, item);
  const reasons: string[] = [];
  if (!row.receipt?.signatureValid) reasons.push('TRUSTED_RECEIPT_MISSING');
  if (row.receipt?.status !== 'PROCESSED') reasons.push('DELIVERY_NOT_PROCESSED');
  if (row.state !== 'APPROVED') reasons.push('HUMAN_APPROVAL_REQUIRED');
  if (row.reviewerKind !== 'USER') reasons.push('BOT_REVIEW');
  if (
    !row.authorExternalId ||
    !row.reviewerExternalId ||
    row.authorExternalId === row.reviewerExternalId
  )
    reasons.push('OTHER_USER_APPROVAL_REQUIRED');
  if (
    row.repositoryId !== expected.repositoryId ||
    row.commitSha !== expected.headSha ||
    row.headSha !== expected.headSha
  )
    reasons.push('SHA_MISMATCH');
  if (
    [...latest.values()].some(
      (item) =>
        item.reviewerKind === 'USER' &&
        item.authorExternalId !== item.reviewerExternalId &&
        item.state === 'CHANGES_REQUESTED',
    )
  )
    reasons.push('CHANGES_REQUESTED_ACTIVE');
  if (latest.get(row.reviewerExternalId)?.id !== row.id) reasons.push('SUPERSEDED_REVIEW');
  return reasons;
}
