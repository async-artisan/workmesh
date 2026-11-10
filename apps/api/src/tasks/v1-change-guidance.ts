import {
  workflowStepDisplayNameOf,
  type ChangeGuidance,
  type ChangeTaskGuidance,
} from '@workmesh/shared';
import type { V1ChangeEventSnapshot, V1ChangeRecipientSnapshot } from './v1-change.repository';

export interface ChangeGuidanceTask {
  id: string;
  projectId: string;
  stepKey: string;
  roleId: string;
  responsibleUserId: string;
  version: number;
  generation: number;
  acceptanceKeys: string[];
  executionStatus: string;
  workStatus: string;
  currentClaimId: string | null;
  currentSnapshotId: string | null;
  role: { id: string; key: string; title: string };
  instance: {
    requirementId: string;
    retiredAt: Date | null;
    workStatus: string;
    revision: unknown;
    requirement: { code: string; generation: number };
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function changeTargetTaskIds(targets: unknown): string[] | null {
  const value = recordOf(targets).taskIds;
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string'))]
    : null;
}

export function changeGuidanceOf(
  recipient: V1ChangeRecipientSnapshot,
  event: V1ChangeEventSnapshot,
  tasks: readonly ChangeGuidanceTask[],
  snapshots: ReadonlyMap<
    string,
    { taskId: string; projectId: string; taskGeneration: number; requirementGeneration: number }
  >,
  access: {
    credentialRoleId?: string;
    activeRoleIds?: readonly string[];
    projectArchived?: boolean;
  } = {},
  now = new Date(),
): ChangeGuidance {
  const { credentialRoleId } = access;
  const target = recordOf(event.targets);
  const ids = changeTargetTaskIds(event.targets);
  const acceptanceKeys = Array.isArray(target.acceptanceKeys)
    ? target.acceptanceKeys.filter((key): key is string => typeof key === 'string')
    : [];
  const scope =
    ids !== null
      ? 'EVENT_TASKS'
      : event.sourceKind === 'CHANGE_REQUEST' && event.requirementId
        ? 'CURRENT_ACCEPTANCE_SCOPE'
        : 'UNKNOWN';
  const candidates = tasks.filter((task) => {
    if (task.projectId !== event.projectId || recipient.projectId !== event.projectId) return false;
    if (event.requirementId && task.instance.requirementId !== event.requirementId) return false;
    if (credentialRoleId && task.roleId !== credentialRoleId) return false;
    if (recipient.roleId && task.roleId !== recipient.roleId) return false;
    const relatedRoleIds = credentialRoleId
      ? [credentialRoleId]
      : recipient.roleId
        ? [recipient.roleId]
        : (access.activeRoleIds ?? []);
    if (
      task.responsibleUserId !== recipient.userId &&
      (!relatedRoleIds.includes(task.roleId) || !access.activeRoleIds?.includes(task.roleId))
    )
      return false;
    if (ids !== null) return ids.includes(task.id);
    return (
      scope === 'CURRENT_ACCEPTANCE_SCOPE' &&
      !task.instance.retiredAt &&
      task.workStatus !== 'CANCELLED' &&
      task.instance.workStatus !== 'CANCELLED' &&
      (!acceptanceKeys.length || task.acceptanceKeys.some((key) => acceptanceKeys.includes(key)))
    );
  });
  const generations = new Set(candidates.map((task) => task.instance.requirement.generation));
  const eventGeneration = Number.isSafeInteger(target.requirementGeneration)
    ? Number(target.requirementGeneration)
    : null;
  const eventBaseline =
    eventGeneration === null
      ? 'NOT_SPECIFIED'
      : generations.size !== 1
        ? 'UNKNOWN'
        : [...generations][0] === eventGeneration
          ? 'CURRENT'
          : [...generations][0] > eventGeneration
            ? 'SUPERSEDED'
            : 'UNKNOWN';
  return {
    checkedAt: now.toISOString(),
    scope,
    eventBaseline,
    tasks: candidates.map((task) => {
      const snapshot = task.currentSnapshotId ? snapshots.get(task.currentSnapshotId) : null;
      let reason: ChangeTaskGuidance['reason'] = 'RECHECK_CHANGE';
      let action: ChangeTaskGuidance['action'] = 'COMPARE_CHANGE';
      if (access.projectArchived) {
        reason = 'PROJECT_ARCHIVED';
        action = 'CONTACT_OWNER';
      } else if (access.activeRoleIds && !access.activeRoleIds.includes(task.roleId)) {
        reason = 'ROLE_INACTIVE';
        action = 'CONTACT_OWNER';
      } else if (task.instance.retiredAt) {
        reason = 'RETIRED';
        action = 'CONTACT_OWNER';
      } else if (task.workStatus === 'CANCELLED' || task.instance.workStatus === 'CANCELLED') {
        reason = 'CANCELLED';
        action = 'CONTACT_OWNER';
      } else if (task.workStatus === 'PAUSED' || task.instance.workStatus === 'PAUSED') {
        reason = 'PAUSED';
        action = 'RESUME_TASK';
      } else if (task.workStatus === 'BLOCKED' || task.instance.workStatus === 'BLOCKED') {
        reason = 'BLOCKED';
        action = 'RESOLVE_BLOCK';
      } else if (
        task.currentSnapshotId &&
        (!snapshot ||
          snapshot.taskId !== task.id ||
          snapshot.projectId !== task.projectId ||
          snapshot.taskGeneration !== task.generation ||
          snapshot.requirementGeneration !== task.instance.requirement.generation)
      ) {
        reason = 'STALE_CONTEXT';
        action = task.currentClaimId ? 'INSPECT_AND_REFRESH' : 'INSPECT_AND_CLAIM';
      } else if (task.executionStatus === 'REVIEW_PENDING') {
        reason = 'REVIEW_PENDING';
        action = 'FOLLOW_REVIEW';
      } else if (task.executionStatus === 'DONE') {
        reason = 'DELIVERED';
        action = 'CHECK_DELIVERY';
      } else if (!task.currentSnapshotId) {
        reason = 'NO_CONTEXT';
        action = task.currentClaimId ? 'INSPECT_AND_REFRESH' : 'INSPECT_AND_CLAIM';
      }
      if (task.responsibleUserId !== recipient.userId) action = 'CONTACT_OWNER';
      return {
        taskId: task.id,
        requirementId: task.instance.requirementId,
        taskCode: `${task.instance.requirement.code}/${task.stepKey}`,
        stepKey: task.stepKey,
        stepDisplayName: workflowStepDisplayNameOf(task.instance.revision, task.stepKey),
        role: task.role,
        responsibleUserId: task.responsibleUserId,
        relation: task.responsibleUserId === recipient.userId ? 'RESPONSIBLE' : 'ROLE',
        version: task.version,
        generation: task.generation,
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        reason,
        action,
        href: `/requirements/${encodeURIComponent(task.instance.requirementId)}?projectId=${encodeURIComponent(task.projectId)}&taskId=${encodeURIComponent(task.id)}`,
        inspectCommand: `workmesh context --task ${task.id} --inspect`,
      };
    }),
  };
}
