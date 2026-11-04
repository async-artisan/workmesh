import { describe, expect, it, vi } from 'vitest';
import { ChangeRequestsService } from './change-requests.service';

function fakePrisma() {
  const members = [
    { projectId: 'p1', userId: 'owner', role: 'OWNER', revokedAt: null },
    // 第二个 OWNER：提案人不得决定自己的变更，所以决定要用另一个人。
    { projectId: 'p1', userId: 'owner2', role: 'OWNER', revokedAt: null },
    { projectId: 'p1', userId: 'admin', role: 'ADMIN', revokedAt: null },
    { projectId: 'p1', userId: 'member', role: 'MEMBER', revokedAt: null },
  ];
  /** 业务角色指派：用来验证「等级审批人」是否真的按 Policy.levels 判定。 */
  const assignments: Array<{
    projectId: string;
    userId: string;
    role: { key: string; isActive: boolean };
  }> = [];
  /** 归档状态：用来验证归档项目拒绝一切写入。 */
  const projects = [{ id: 'p1', archivedAt: null as Date | null }];
  const requirements = [
    { id: 'req-1', projectId: 'p1', frozenAt: null as Date | null },
    { id: 'req-2', projectId: 'p1', frozenAt: new Date('2026-11-01T00:00:00Z') as Date | null },
  ];
  const tasks = [{ id: 't1', projectId: 'p1', acceptanceKeys: ['A1', 'A2'] }];
  const changes: Array<Record<string, unknown> & { id: string }> = [];
  const events: Array<Record<string, unknown> & { id: string }> = [];
  const recipients: Array<Record<string, unknown>> = [];
  const policies: Array<Record<string, unknown>> = [];

  const prisma = {
    projectMember: {
      findUnique: async (input: {
        where: { projectId_userId: { projectId: string; userId: string } };
      }) =>
        members.find(
          (member) =>
            member.projectId === input.where.projectId_userId.projectId &&
            member.userId === input.where.projectId_userId.userId,
        ) ?? null,
      findMany: async (input: { where: { projectId: string; revokedAt: null } }) =>
        members
          .filter(
            (member) => member.projectId === input.where.projectId && member.revokedAt === null,
          )
          .map((member) => ({ userId: member.userId })),
    },
    requirement: {
      findFirst: async (input: { where: { id: string; projectId: string } }) =>
        requirements.find(
          (requirement) =>
            requirement.id === input.where.id && requirement.projectId === input.where.projectId,
        ) ?? null,
    },
    task: {
      count: async (input: { where: { acceptanceKeys: { hasSome: string[] } } }) =>
        tasks.filter((task) =>
          task.acceptanceKeys.some((key) => input.where.acceptanceKeys.hasSome.includes(key)),
        ).length,
    },
    projectRoleAssignment: {
      findMany: async (input: { where: { projectId: string; userId: string } }) =>
        assignments.filter(
          (item) => item.projectId === input.where.projectId && item.userId === input.where.userId,
        ),
    },
    project: {
      findUnique: async (input: { where: { id: string } }) =>
        projects.find((project) => project.id === input.where.id) ?? null,
    },
    changeRequest: {
      create: async (input: { data: Record<string, unknown> }) => {
        const row = {
          id: `change-${changes.length + 1}`,
          createdAt: new Date(),
          decidedAt: null,
          decidedById: null,
          appliedAt: null,
          ...input.data,
        } as Record<string, unknown> & { id: string };
        changes.push(row);
        return row;
      },
      findMany: async (input: { where: { projectId: string; requirementId?: string } }) =>
        changes.filter(
          (change) =>
            change.projectId === input.where.projectId &&
            (!input.where.requirementId || change.requirementId === input.where.requirementId),
        ),
      findFirst: async (input: { where: { id: string; projectId: string } }) =>
        changes.find(
          (change) => change.id === input.where.id && change.projectId === input.where.projectId,
        ) ?? null,
      update: async (input: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = changes.find((change) => change.id === input.where.id)!;
        Object.assign(row, input.data);
        return row;
      },
      updateMany: async (input: {
        where: { id: string; projectId: string; decision: { in: string[] } };
        data: Record<string, unknown>;
      }) => {
        const row = changes.find(
          (change) =>
            change.id === input.where.id &&
            change.projectId === input.where.projectId &&
            input.where.decision.in.includes(String(change.decision)),
        );
        if (!row) return { count: 0 };
        Object.assign(row, input.data);
        return { count: 1 };
      },
      findFirstOrThrow: async (input: { where: { id: string; projectId: string } }) => {
        const row = changes.find(
          (change) => change.id === input.where.id && change.projectId === input.where.projectId,
        );
        if (!row) throw new Error('not found');
        return row;
      },
    },
    changeEvent: {
      create: async (input: { data: Record<string, unknown> }) => {
        const row = { id: `event-${events.length + 1}`, ...input.data } as Record<
          string,
          unknown
        > & {
          id: string;
        };
        events.push(row);
        return row;
      },
    },
    changeRecipient: {
      createMany: async (input: { data: Array<Record<string, unknown>> }) => {
        recipients.push(...input.data);
        return { count: input.data.length };
      },
    },
    projectChangePolicy: {
      findFirst: async (input: { where: { projectId: string; level: string } }) =>
        policies.find(
          (policy) =>
            policy.projectId === input.where.projectId && policy.level === input.where.level,
        ) ?? null,
      findMany: async (input: { where: { projectId: string } }) =>
        policies.filter((policy) => policy.projectId === input.where.projectId),
      deleteMany: async (input: { where: { projectId: string } }) => {
        const before = policies.length;
        for (let index = policies.length - 1; index >= 0; index -= 1) {
          if (policies[index].projectId === input.where.projectId) policies.splice(index, 1);
        }
        return { count: before - policies.length };
      },
      createMany: async (input: { data: Array<Record<string, unknown>> }) => {
        policies.push(...input.data);
        return { count: input.data.length };
      },
    },
    $transaction: async (
      operations: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>),
    ) => {
      if (typeof operations !== 'function') return Promise.all(operations);
      const snapshot = structuredClone({ changes, events, recipients });
      try {
        return await operations(prisma);
      } catch (error) {
        changes.splice(0, changes.length, ...snapshot.changes);
        events.splice(0, events.length, ...snapshot.events);
        recipients.splice(0, recipients.length, ...snapshot.recipients);
        throw error;
      }
    },
  };

  return {
    service: new ChangeRequestsService(prisma as never),
    changes,
    events,
    recipients,
    policies,
    assignments,
    projects,
    prisma,
  };
}

describe('ChangeRequestsService', () => {
  it('rolls back the decision and event when recipient creation fails', async () => {
    const { service, prisma, changes, events, recipients } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: 'copy',
    });
    vi.spyOn(prisma.changeRecipient, 'createMany').mockRejectedValueOnce(
      new Error('storage failure'),
    );
    await expect(
      service.decide('p1', 'owner2', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toThrow('storage failure');
    expect(changes[0].decision).toBe('PENDING');
    expect(events).toHaveLength(0);
    expect(recipients).toHaveLength(0);
    await service.decide('p1', 'owner2', change.id, { decision: 'ACCEPTED' });
    expect(events).toHaveLength(1);
    expect(recipients).toHaveLength(4);
  });

  it('rejects a decision when another writer wins the conditional update', async () => {
    const { service, prisma, events } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: 'copy',
    });
    vi.spyOn(prisma.changeRequest, 'updateMany').mockResolvedValueOnce({ count: 0 });
    await expect(
      service.decide('p1', 'owner2', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toMatchObject({ message: 'CHANGE_ALREADY_DECIDED', status: 409 });
    expect(events).toHaveLength(0);
  });

  it('computes the highest level from affected surfaces', () => {
    expect(ChangeRequestsService.levelOf(['COPY'])).toBe('L0');
    expect(ChangeRequestsService.levelOf(['COPY', 'ACCEPTANCE'])).toBe('L1');
    expect(ChangeRequestsService.levelOf(['SCOPE', 'CONTRACT'])).toBe('L2');
    expect(ChangeRequestsService.levelOf(['CONTRACT', 'GOAL'])).toBe('L3');
  });

  it('creates a pending change with impact preview', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'member', {
      requirementId: 'req-1',
      affected: ['ACCEPTANCE'],
      reason: '补一条验收',
      acceptanceKeys: ['A1'],
    });
    expect(change).toMatchObject({ level: 'L1', decision: 'PENDING', proposedById: 'member' });
    expect(change.impactPreview).toMatchObject({ taskCount: 1, frozen: false });
  });

  it('defers non-L3 changes while the requirement is frozen', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'member', {
      requirementId: 'req-2',
      affected: ['SCOPE'],
      reason: '冻结期改范围',
    });
    expect(change.decision).toBe('DEFERRED');
  });

  it('keeps L3 changes pending even when frozen', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'member', {
      requirementId: 'req-2',
      affected: ['GOAL'],
      reason: '目标调整',
    });
    expect(change).toMatchObject({ level: 'L3', decision: 'PENDING' });
  });

  it('rejects decisions from a plain member', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: '文案修正',
    });
    await expect(
      service.decide('p1', 'member', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('accepting a change emits an event and recipients with due dates', async () => {
    const { service, events, recipients } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['ACCEPTANCE'],
      reason: '新增验收',
      acceptanceKeys: ['A1'],
    });
    const decided = await service.decide('p1', 'owner2', change.id, { decision: 'ACCEPTED' });
    expect(decided).toMatchObject({ decision: 'ACCEPTED', decidedById: 'owner2' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceKind: 'CHANGE_REQUEST',
      sourceId: change.id,
      requirementId: 'req-1',
    });
    expect(recipients).toHaveLength(4);
    expect(recipients[0]).toHaveProperty('dueAt');
    expect(recipients[0]).toMatchObject({ action: 'ACK_ONLY' });
  });

  it('rejecting a change does not emit events', async () => {
    const { service, events } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: '不需要',
    });
    await service.decide('p1', 'owner2', change.id, { decision: 'REJECTED' });
    expect(events).toHaveLength(0);
  });

  it('refuses to decide twice', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: '文案',
    });
    await service.decide('p1', 'owner2', change.id, { decision: 'ACCEPTED' });
    await expect(
      service.decide('p1', 'owner2', change.id, { decision: 'REJECTED' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'CHANGE_ALREADY_DECIDED' });
  });

  it('returns the default policy when none is stored', async () => {
    const { service } = fakePrisma();
    const policy = await service.getPolicy('p1', 'member');
    expect(policy.freezeMode).toBe('BLOCK');
    expect(policy.levels.L3).toEqual(['owner']);
  });

  it('updates and reads back a custom policy', async () => {
    const { service } = fakePrisma();
    await service.updatePolicy('p1', 'owner', {
      freezeMode: 'WARN',
      levels: { L0: ['product'], L1: ['qa'] },
    });
    const policy = await service.getPolicy('p1', 'member');
    expect(policy).toEqual({ freezeMode: 'WARN', levels: { L0: ['product'], L1: ['qa'] } });
  });

  it('rejects unknown policy levels', async () => {
    const { service } = fakePrisma();
    await expect(
      service.updatePolicy('p1', 'owner', { freezeMode: 'BLOCK', levels: { L9: ['x'] } }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'INVALID_CHANGE_LEVEL',
    });
  });

  it('WARN freeze lets non-L3 changes stay pending with a warning', async () => {
    const { service } = fakePrisma();
    await service.updatePolicy('p1', 'owner', { freezeMode: 'WARN', levels: {} });
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-2',
      affected: ['SCOPE'],
      reason: '冻结期改范围',
    });
    expect(change.decision).toBe('PENDING');
    expect(change.impactPreview).toMatchObject({ warning: true, freezeMode: 'WARN' });
  });

  it('forbids a proposer from deciding their own change', async () => {
    const { service, changes, events } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: '自批',
    });
    await expect(
      service.decide('p1', 'owner', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: 'CHANGE_SELF_DECISION_FORBIDDEN' });
    // 必须在写库之前拒绝：变更仍是 PENDING，也没有产生变更事件。
    expect(changes[0].decision).toBe('PENDING');
    expect(events).toHaveLength(0);
  });

  it('requires the role configured for the change level instead of accepting any admin', async () => {
    const { service, assignments } = fakePrisma();
    // L1 需要 qa 角色；ADMIN 没有该业务角色，必须被拒。
    await service.updatePolicy('p1', 'owner', { freezeMode: 'ALLOW', levels: { L1: ['qa'] } });
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['ACCEPTANCE'],
      reason: '验收变更',
    });
    await expect(
      service.decide('p1', 'admin', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'CHANGE_LEVEL_APPROVER_REQUIRED',
      details: { level: 'L1', requiredRoleKeys: ['qa'] },
    });

    // 持有该等级配置的活动角色之后即可决定。
    assignments.push({ projectId: 'p1', userId: 'admin', role: { key: 'qa', isActive: true } });
    await expect(
      service.decide('p1', 'admin', change.id, { decision: 'ACCEPTED' }),
    ).resolves.toMatchObject({ decision: 'ACCEPTED' });
  });

  it('ignores an inactive role assignment when checking level eligibility', async () => {
    const { service, assignments } = fakePrisma();
    await service.updatePolicy('p1', 'owner', {
      freezeMode: 'ALLOW',
      levels: { L2: ['engineering-lead'] },
    });
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['CONTRACT'],
      reason: '契约变更',
    });
    assignments.push({
      projectId: 'p1',
      userId: 'admin',
      role: { key: 'engineering-lead', isActive: false },
    });
    await expect(
      service.decide('p1', 'admin', change.id, { decision: 'ACCEPTED' }),
    ).rejects.toMatchObject({ message: 'CHANGE_LEVEL_APPROVER_REQUIRED' });
  });

  it('keeps the project owner able to decide every level', async () => {
    const { service } = fakePrisma();
    await service.updatePolicy('p1', 'owner', { freezeMode: 'ALLOW', levels: { L3: ['owner'] } });
    const change = await service.create('p1', 'admin', {
      requirementId: 'req-1',
      affected: ['GOAL'],
      reason: '目标变更',
    });
    // 即使 levels 配错，OWNER 仍是最高权威——否则项目会再也改不动。
    await expect(
      service.decide('p1', 'owner', change.id, { decision: 'ACCEPTED' }),
    ).resolves.toMatchObject({ decision: 'ACCEPTED' });
  });

  it('rejects every write path once the project is archived', async () => {
    const { service, projects } = fakePrisma();
    projects[0].archivedAt = new Date('2026-11-04T00:00:00Z');

    // 提案、决定、策略调整都是写入，归档后一律拒绝。
    await expect(
      service.create('p1', 'owner', {
        requirementId: 'req-1',
        affected: ['COPY'],
        reason: '归档后新建',
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'PROJECT_ARCHIVED' });
    await expect(
      service.updatePolicy('p1', 'owner', { freezeMode: 'WARN', levels: { L1: ['qa'] } }),
    ).rejects.toMatchObject({ message: 'PROJECT_ARCHIVED' });
    // 读路径不受影响：归档项目仍然可以查看。
    await expect(service.getPolicy('p1', 'member')).resolves.toMatchObject({ freezeMode: 'BLOCK' });
    await expect(service.list('p1', 'member')).resolves.toHaveLength(0);
  });
});
