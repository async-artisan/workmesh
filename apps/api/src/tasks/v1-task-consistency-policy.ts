import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

export type TaskConsistencyRef = {
  taskId: string;
  workflowInstanceId: string;
};

/** retired 工作流实例上的任务不得再被认领、交付或验收；历史数据仍可读取。 */
export function assertWorkflowInstanceActive(
  retiredAt: Date | null | undefined,
  ref: TaskConsistencyRef,
): void {
  if (retiredAt)
    throw new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_CONFLICT,
      'WORKFLOW_INSTANCE_RETIRED',
      { taskId: ref.taskId, workflowInstanceId: ref.workflowInstanceId },
      409,
    );
}

/** 快照的需求代次必须与当前需求代次一致，否则旧基线交付/验收一律版本冲突。 */
export function isCurrentRequirementGeneration(
  snapshotGeneration: number,
  requirementGeneration: number | null | undefined,
): boolean {
  return requirementGeneration != null && snapshotGeneration === requirementGeneration;
}

export function assertCurrentRequirementGeneration(input: {
  taskId: string;
  snapshotId: string;
  snapshotGeneration: number;
  requirementGeneration: number | null | undefined;
}): void {
  if (!isCurrentRequirementGeneration(input.snapshotGeneration, input.requirementGeneration))
    throw new WorkmeshError(
      V1_ERROR_CODES.BASELINE_STALE,
      'SNAPSHOT_STALE',
      {
        taskId: input.taskId,
        snapshotId: input.snapshotId,
        snapshotGeneration: input.snapshotGeneration,
        requirementGeneration: input.requirementGeneration ?? null,
      },
      409,
    );
}

/**
 * 释放认领时同一事务内更新任务：只有仍指向被释放认领的 currentClaimId 才清除，
 * 让任务重新进入 ready；版本自增保证并发写可检测。
 */
export function taskReleasePatch(
  taskCurrentClaimId: string | null,
  releasedClaimId: string,
): { currentClaimId: null; version: { increment: number } } | null {
  if (taskCurrentClaimId !== releasedClaimId) return null;
  return { currentClaimId: null, version: { increment: 1 } };
}
