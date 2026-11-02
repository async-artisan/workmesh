import { describe, expect, it } from 'vitest';
import { ChangeRequestsService } from './change-requests.service';

function fakePrisma() {
  const members = [
    { projectId: 'p1', userId: 'owner', role: 'OWNER', revokedAt: null },
    { projectId: 'p1', userId: 'member', role: 'MEMBER', revokedAt: null },
  ];
  const requirements = [
    { id: 'req-1', projectId: 'p1', frozenAt: null as Date | null },
    { id: 'req-2', projectId: 'p1', frozenAt: new Date('2026-11-01T00:00:00Z') as Date | null },
  ];
  const tasks = [{ id: 't1', projectId: 'p1', acceptanceKeys: ['A1', 'A2'] }];
  const changes: Array<Record<string, unknown> & { id: string }> = [];
  const events: Array<Record<string, unknown> & { id: string }> = [];
  const recipients: Array<Record<string, unknown>> = [];

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
  };

  return { service: new ChangeRequestsService(prisma as never), changes, events, recipients };
}

describe('ChangeRequestsService', () => {
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
    const decided = await service.decide('p1', 'owner', change.id, { decision: 'ACCEPTED' });
    expect(decided).toMatchObject({ decision: 'ACCEPTED', decidedById: 'owner' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sourceKind: 'CHANGE_REQUEST',
      sourceId: change.id,
      requirementId: 'req-1',
    });
    expect(recipients).toHaveLength(2);
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
    await service.decide('p1', 'owner', change.id, { decision: 'REJECTED' });
    expect(events).toHaveLength(0);
  });

  it('refuses to decide twice', async () => {
    const { service } = fakePrisma();
    const change = await service.create('p1', 'owner', {
      requirementId: 'req-1',
      affected: ['COPY'],
      reason: '文案',
    });
    await service.decide('p1', 'owner', change.id, { decision: 'ACCEPTED' });
    await expect(
      service.decide('p1', 'owner', change.id, { decision: 'REJECTED' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'CHANGE_ALREADY_DECIDED' });
  });
});
