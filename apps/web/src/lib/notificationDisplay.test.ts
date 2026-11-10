import { describe, expect, it } from 'vitest';
import type { ActivityItem, WorkbenchSnapshot } from '../api/resources';
import { actionableNotificationCounts, activityDestination } from './notificationDisplay';

describe('notification meaning and destinations', () => {
  it('counts only viewer-assigned open slots and explicitly claimable tasks', () => {
    const snapshot = {
      reviews: [
        { kind: 'TASK_ACCEPTANCE', slots: [{ viewerCanDecide: true, decided: false }] },
        {
          kind: 'TASK_ARTIFACT_SET',
          slots: [
            { viewerCanDecide: true, decided: false },
            { viewerCanDecide: true, decided: false },
          ],
        },
        { kind: 'TASK_ACCEPTANCE', slots: [{ viewerCanDecide: false, decided: false }] },
        { kind: 'TASK_ACCEPTANCE', slots: [{ viewerCanDecide: true, decided: true }] },
      ],
      changes: [{}],
      readyTasks: [
        { claimEligibility: { canClaim: true } },
        { claimEligibility: { canClaim: false } },
        {},
      ],
      counts: { reviews: 4, changes: 5, readyTasks: 3, total: 12 },
    } as unknown as WorkbenchSnapshot;
    expect(actionableNotificationCounts(snapshot)).toEqual({
      signOffs: 1,
      approvals: 1,
      changes: 1,
      readyTasks: 1,
      total: 4,
    });
  });

  const event = (
    targetType: string,
    targetId = 'object/1',
    projectId: string | null = 'project/1',
  ) => ({ targetType, targetId, projectId }) as ActivityItem;

  it('preserves object and project context and labels collection destinations truthfully', () => {
    expect(activityDestination(event('REVIEW_REQUEST'))).toEqual({
      path: '/reviews/object%2F1?projectId=project%2F1',
      label: '打开该评审',
    });
    expect(activityDestination(event('PROJECT'))?.path).toBe('/projects/object%2F1');
    expect(activityDestination(event('REQUIREMENT'))?.path).toBe(
      '/requirements/object%2F1?projectId=project%2F1',
    );
    expect(activityDestination(event('KNOWLEDGE_DOCUMENT'))).toEqual({
      path: '/knowledge?projectId=project%2F1',
      label: '打开项目知识库',
    });
    expect(activityDestination(event('WORKSPACE_DEFINITION'))?.path).toBe(
      '/workspace?projectId=project%2F1',
    );
  });

  it('does not guess destinations for missing context or unsupported task targets', () => {
    expect(activityDestination(event('KNOWLEDGE_DOCUMENT', 'doc', null))).toBeNull();
    expect(activityDestination(event('TASK'))).toBeNull();
    expect(activityDestination(event('UNSUPPORTED_TARGET'))).toBeNull();
  });
});
