/** Read-only claim authorization; it does not reserve a task or validate its context inputs. */
export type TaskClaimEligibility =
  | { canClaim: true; reason: null }
  | {
      canClaim: false;
      reason:
        | 'NOT_RESPONSIBLE'
        | 'ROLE_INACTIVE'
        | 'CREDENTIAL_ROLE_MISMATCH'
        | 'SCOPE_DENIED'
        | 'PROJECT_ARCHIVED';
    };
