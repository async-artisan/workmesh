import { describe, expect, it } from 'vitest';
import { changeGuidanceOf, type ChangeGuidanceTask } from './v1-change-guidance';
import type { V1ChangeEventSnapshot, V1ChangeRecipientSnapshot } from './v1-change.repository';

const recipient: V1ChangeRecipientSnapshot = {
  id: 'rec',
  projectId: 'p1',
  eventId: 'e1',
  userId: 'u1',
  roleId: 'backend',
  version: 1,
  ackedAt: null,
  createdAt: '2026-11-09T00:00:00Z',
};
const event: V1ChangeEventSnapshot = {
  id: 'e1',
  projectId: 'p1',
  requirementId: 'req',
  sourceKind: 'DOCUMENT_PUBLICATION',
  sourceId: 'pub',
  changedFields: ['generation'],
  targets: { taskIds: ['t1'], requirementGeneration: 2 },
  createdAt: recipient.createdAt,
};
function task(overrides: Partial<ChangeGuidanceTask> = {}): ChangeGuidanceTask {
  return {
    id: 't1',
    projectId: 'p1',
    stepKey: 'impl',
    roleId: 'backend',
    responsibleUserId: 'u1',
    version: 4,
    generation: 2,
    acceptanceKeys: ['cancel'],
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentSnapshotId: null,
    role: { id: 'backend', key: 'backend', title: '后端' },
    instance: {
      requirementId: 'req',
      retiredAt: null,
      workStatus: 'ACTIVE',
      revision: { steps: [{ key: 'impl', displayName: '后端实现' }] },
      requirement: { code: 'KEY-001', generation: 2 },
    },
    ...overrides,
  };
}
const access = { activeRoleIds: ['backend'] };

describe('recipient change guidance', () => {
  it('keeps only event tasks related to the recipient and provides an input inspection and deep link', () => {
    const result = changeGuidanceOf(
      recipient,
      event,
      [task(), task({ id: 't2' }), task({ projectId: 'foreign' })],
      new Map(),
      access,
    );
    expect(result).toMatchObject({
      scope: 'EVENT_TASKS',
      eventBaseline: 'CURRENT',
      tasks: [
        {
          taskId: 't1',
          taskCode: 'KEY-001/impl',
          stepDisplayName: '后端实现',
          reason: 'NO_CONTEXT',
          action: 'INSPECT_AND_CLAIM',
          inspectCommand: 'workmesh context --task t1 --inspect',
          href: '/requirements/req?projectId=p1&taskId=t1',
        },
      ],
    });
    expect(result.tasks).toHaveLength(1);
  });

  it('keeps current user roles apart, and never recommends claiming another member task', () => {
    const ownRole = task({ responsibleUserId: 'u2' });
    expect(changeGuidanceOf(recipient, event, [ownRole], new Map(), access).tasks[0]).toMatchObject(
      { relation: 'ROLE', action: 'CONTACT_OWNER' },
    );
    expect(
      changeGuidanceOf(recipient, event, [ownRole], new Map(), { activeRoleIds: [] }).tasks,
    ).toEqual([]);
    expect(
      changeGuidanceOf(recipient, event, [task({ roleId: 'frontend' })], new Map(), access).tasks,
    ).toEqual([]);
    expect(
      changeGuidanceOf({ ...recipient, roleId: null }, event, [task()], new Map(), {
        ...access,
        credentialRoleId: 'frontend',
      }).tasks,
    ).toEqual([]);
  });

  it('distinguishes a superseded event from the current snapshot generation mismatch', () => {
    const current = task({
      currentSnapshotId: 's1',
      currentClaimId: 'c1',
      instance: { ...task().instance, requirement: { code: 'KEY-001', generation: 3 } },
    });
    const result = changeGuidanceOf(
      recipient,
      event,
      [current],
      new Map([
        ['s1', { projectId: 'p1', taskId: 't1', taskGeneration: 1, requirementGeneration: 2 }],
      ]),
      access,
    );
    expect(result).toMatchObject({
      eventBaseline: 'SUPERSEDED',
      tasks: [{ reason: 'STALE_CONTEXT', action: 'INSPECT_AND_REFRESH' }],
    });
    expect(
      changeGuidanceOf(
        recipient,
        event,
        [current],
        new Map([
          [
            's1',
            { projectId: 'foreign', taskId: 't1', taskGeneration: 2, requirementGeneration: 3 },
          ],
        ]),
        access,
      ).tasks[0].reason,
    ).toBe('STALE_CONTEXT');
  });

  it.each([
    ['PAUSED', 'PAUSED', 'RESUME_TASK'],
    ['BLOCKED', 'BLOCKED', 'RESOLVE_BLOCK'],
    ['CANCELLED', 'CANCELLED', 'CONTACT_OWNER'],
  ])(
    'reports %s without claiming that the notification caused it',
    (workStatus, reason, action) => {
      expect(
        changeGuidanceOf(recipient, event, [task({ workStatus })], new Map(), access).tasks[0],
      ).toMatchObject({ reason, action });
    },
  );

  it('preserves retired tasks as history, role withdrawal and archived project limits', () => {
    expect(
      changeGuidanceOf(
        recipient,
        event,
        [task({ instance: { ...task().instance, retiredAt: new Date() } })],
        new Map(),
        access,
      ).tasks[0],
    ).toMatchObject({ reason: 'RETIRED', action: 'CONTACT_OWNER' });
    expect(
      changeGuidanceOf(recipient, event, [task()], new Map(), { activeRoleIds: [] }).tasks[0],
    ).toMatchObject({ reason: 'ROLE_INACTIVE', action: 'CONTACT_OWNER' });
    expect(
      changeGuidanceOf(recipient, event, [task()], new Map(), { ...access, projectArchived: true })
        .tasks[0],
    ).toMatchObject({ reason: 'PROJECT_ARCHIVED', action: 'CONTACT_OWNER' });
  });

  it('marks accepted change requests without explicit task IDs as current acceptance scope, not historical invalidation', () => {
    const change = {
      ...event,
      sourceKind: 'CHANGE_REQUEST',
      targets: { acceptanceKeys: ['cancel'] },
    };
    const result = changeGuidanceOf(
      { ...recipient, roleId: null },
      change,
      [
        task(),
        task({ id: 'other', acceptanceKeys: ['pay'] }),
        task({ id: 'retired', instance: { ...task().instance, retiredAt: new Date() } }),
        task({ id: 'other-user', responsibleUserId: 'u2' }),
      ],
      new Map(),
      access,
    );
    expect(result).toMatchObject({
      scope: 'CURRENT_ACCEPTANCE_SCOPE',
      eventBaseline: 'NOT_SPECIFIED',
      tasks: [{ taskId: 't1' }, { taskId: 'other-user' }],
    });
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.find((item) => item.taskId === 'other-user')).toMatchObject({
      relation: 'ROLE',
      action: 'CONTACT_OWNER',
    });
    expect(
      changeGuidanceOf(
        recipient,
        { ...change, targets: { taskIds: [] } },
        [task()],
        new Map(),
        access,
      ).tasks,
    ).toEqual([]);
    expect(
      changeGuidanceOf(
        recipient,
        { ...change, sourceKind: 'UNKNOWN' },
        [task()],
        new Map(),
        access,
      ),
    ).toMatchObject({ scope: 'UNKNOWN', tasks: [] });
  });

  it.each([
    ['REVIEW_PENDING', 'REVIEW_PENDING', 'FOLLOW_REVIEW'],
    ['DONE', 'DELIVERED', 'CHECK_DELIVERY'],
  ])('uses the actual %s delivery state', (executionStatus, reason, action) => {
    expect(
      changeGuidanceOf(recipient, event, [task({ executionStatus })], new Map(), access).tasks[0],
    ).toMatchObject({ reason, action });
  });
});
