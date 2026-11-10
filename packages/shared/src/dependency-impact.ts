/** Derived dependency counts are an explanation, never a task or approval gate. */
export interface DependencyImpact {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  checkedAt: string;
  blocking: number | null;
  /** Newly dependency-ready tasks if this action succeeds; inputs and claim authorization still apply. */
  readyAfterAction: number | null;
  scenario:
    'TASK_APPROVAL' | 'TASK_COMPLETION' | 'CHANGE_ACK' | 'BASELINE_PUBLICATION' | 'UNSUPPORTED';
  reason:
    | 'LAST_REQUIRED_SLOT'
    | 'OTHER_SLOTS_PENDING'
    | 'ACK_ONLY'
    | 'BASELINE_RECHECK'
    | 'COMPLETE_TASK'
    | 'STALE_SUBJECT'
    | 'NOT_ACTIONABLE'
    | 'GRAPH_UNAVAILABLE';
}
