export type Claim = {
  id: string;
  taskGeneration: number;
  principalScopeKey: string;
  releasedAt: string | null;
};

export function assertClaimForAction(input: {
  currentGeneration: number;
  currentClaim: Claim | null;
  claimId: string;
  principalScopeKey: string;
}): void {
  const claim = input.currentClaim;
  if (!claim || claim.id !== input.claimId || claim.releasedAt !== null) throw new Error('CLAIM_INVALID');
  if (claim.taskGeneration !== input.currentGeneration) throw new Error('BASELINE_STALE');
  if (claim.principalScopeKey !== input.principalScopeKey) throw new Error('CLAIM_INVALID');
}

export function assertCanClaim(input: { currentClaim: Claim | null; taskGeneration: number; principalScopeKey: string }): void {
  if (input.currentClaim && input.currentClaim.releasedAt === null) throw new Error('CLAIM_CONFLICT');
  if (!Number.isInteger(input.taskGeneration) || input.taskGeneration < 1) throw new Error('BASELINE_STALE');
  if (!input.principalScopeKey) throw new Error('CLAIM_INVALID');
}

export function assertDeliverableFresh(input: {
  claim: Claim;
  taskGeneration: number;
  snapshotGeneration: number;
  artifactSetGeneration?: number;
}): void {
  if (input.claim.releasedAt !== null) throw new Error('CLAIM_INVALID');
  if (input.claim.taskGeneration !== input.taskGeneration || input.snapshotGeneration !== input.taskGeneration) throw new Error('BASELINE_STALE');
  if (input.artifactSetGeneration !== undefined && input.artifactSetGeneration !== input.taskGeneration) throw new Error('BASELINE_STALE');
}

export function assertIdempotentReplay(input: { storedDigest: string | null; requestDigest: string }): 'NEW' | 'REPLAY' {
  if (!input.storedDigest) return 'NEW';
  if (input.storedDigest !== input.requestDigest) throw new Error('IDEMPOTENCY_CONFLICT');
  return 'REPLAY';
}
