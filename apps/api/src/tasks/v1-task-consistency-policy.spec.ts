import { describe, expect, it } from 'vitest';
import { V1_ERROR_CODES } from '@workmesh/shared';
import {
  assertCurrentRequirementGeneration,
  assertWorkflowInstanceActive,
  isCurrentRequirementGeneration,
  taskReleasePatch,
} from './v1-task-consistency-policy';

const REF = { taskId: 'task-1', workflowInstanceId: 'instance-1' };

describe('task consistency policy', () => {
  it('blocks retired workflow instances for claim/deliver/accept', () => {
    expect(() => assertWorkflowInstanceActive(null, REF)).not.toThrow();
    expect(() => assertWorkflowInstanceActive(undefined, REF)).not.toThrow();
    expect(() => assertWorkflowInstanceActive(new Date('2026-10-01T00:00:00Z'), REF)).toThrowError(
      expect.objectContaining({
        code: V1_ERROR_CODES.RESOURCE_CONFLICT,
        message: 'WORKFLOW_INSTANCE_RETIRED',
        status: 409,
      }),
    );
  });

  it('treats a changed requirement generation as a stale baseline', () => {
    expect(isCurrentRequirementGeneration(4, 4)).toBe(true);
    expect(isCurrentRequirementGeneration(4, 5)).toBe(false);
    expect(isCurrentRequirementGeneration(4, null)).toBe(false);

    expect(() =>
      assertCurrentRequirementGeneration({
        taskId: 'task-1',
        snapshotId: 'snapshot-1',
        snapshotGeneration: 4,
        requirementGeneration: 5,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: V1_ERROR_CODES.BASELINE_STALE,
        message: 'SNAPSHOT_STALE',
        status: 409,
      }),
    );
    expect(() =>
      assertCurrentRequirementGeneration({
        taskId: 'task-1',
        snapshotId: 'snapshot-1',
        snapshotGeneration: 4,
        requirementGeneration: 4,
      }),
    ).not.toThrow();
  });

  it('clears currentClaimId only when it still matches the released claim', () => {
    expect(taskReleasePatch('claim-1', 'claim-1')).toEqual({
      currentClaimId: null,
      version: { increment: 1 },
    });
    expect(taskReleasePatch('claim-2', 'claim-1')).toBeNull();
    expect(taskReleasePatch(null, 'claim-1')).toBeNull();
  });
});
