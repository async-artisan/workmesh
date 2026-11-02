import { describe, expect, it } from 'vitest';
import { assertCanClaim, assertClaimForAction, assertDeliverableFresh, assertIdempotentReplay } from './v1-collaboration-policy';

describe('v1 collaboration policy', () => {
  const claim = { id: 'claim-1', taskGeneration: 2, principalScopeKey: 'agent:1', releasedAt: null };
  it('allows only the current claim owner and generation', () => {
    expect(() => assertClaimForAction({ currentGeneration: 2, currentClaim: claim, claimId: 'claim-1', principalScopeKey: 'agent:1' })).not.toThrow();
    expect(() => assertClaimForAction({ currentGeneration: 2, currentClaim: claim, claimId: 'claim-1', principalScopeKey: 'agent:2' })).toThrow('CLAIM_INVALID');
    expect(() => assertClaimForAction({ currentGeneration: 3, currentClaim: claim, claimId: 'claim-1', principalScopeKey: 'agent:1' })).toThrow('BASELINE_STALE');
    expect(() => assertClaimForAction({ currentGeneration: 2, currentClaim: { ...claim, releasedAt: 'now' }, claimId: 'claim-1', principalScopeKey: 'agent:1' })).toThrow('CLAIM_INVALID');
  });

  it('allows one active claim only', () => {
    expect(() => assertCanClaim({ currentClaim: null, taskGeneration: 1, principalScopeKey: 'agent:1' })).not.toThrow();
    expect(() => assertCanClaim({ currentClaim: claim, taskGeneration: 2, principalScopeKey: 'agent:2' })).toThrow('CLAIM_CONFLICT');
  });

  it('rejects stale snapshot or artifact generation', () => {
    expect(() => assertDeliverableFresh({ claim, taskGeneration: 2, snapshotGeneration: 2, artifactSetGeneration: 2 })).not.toThrow();
    expect(() => assertDeliverableFresh({ claim, taskGeneration: 3, snapshotGeneration: 2 })).toThrow('BASELINE_STALE');
  });

  it('replays same digest but rejects same key with changed intent', () => {
    expect(assertIdempotentReplay({ storedDigest: null, requestDigest: 'a' })).toBe('NEW');
    expect(assertIdempotentReplay({ storedDigest: 'a', requestDigest: 'a' })).toBe('REPLAY');
    expect(() => assertIdempotentReplay({ storedDigest: 'a', requestDigest: 'b' })).toThrow('IDEMPOTENCY_CONFLICT');
  });
});
