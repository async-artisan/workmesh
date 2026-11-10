import type { Principal, TaskClaimEligibility } from '@workmesh/shared';
import type { V1ProjectContext } from '../auth/v1-authorization';

/** Keep ready-list guidance and the claim preflight on the same authorization rules.
 * Claim still rechecks current membership, role, credential and workflow state in its transaction.
 */
export function taskClaimEligibilityOf(
  principal: Principal,
  task: { responsibleUserId: string; roleId: string },
  context: V1ProjectContext,
): TaskClaimEligibility {
  if (context.project.archivedAt) return { canClaim: false, reason: 'PROJECT_ARCHIVED' };
  if (task.responsibleUserId !== principal.userId)
    return { canClaim: false, reason: 'NOT_RESPONSIBLE' };
  if (!context.activeRoleIds.includes(task.roleId))
    return { canClaim: false, reason: 'ROLE_INACTIVE' };
  if (principal.kind === 'AGENT') {
    if (principal.roleIds?.length !== 1 || principal.roleIds[0] !== task.roleId)
      return { canClaim: false, reason: 'CREDENTIAL_ROLE_MISMATCH' };
    if (!principal.scopes.includes('task:claim'))
      return { canClaim: false, reason: 'SCOPE_DENIED' };
  }
  return { canClaim: true, reason: null };
}
