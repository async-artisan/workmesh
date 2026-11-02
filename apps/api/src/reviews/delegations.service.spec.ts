import { describe, expect, it } from 'vitest';
import { DelegationsService } from './delegations.service';

function fakePrisma() {
  const members = [
    { projectId: 'p1', userId: 'owner', role: 'OWNER', revokedAt: null },
    { projectId: 'p1', userId: 'member', role: 'MEMBER', revokedAt: null },
    { projectId: 'p1', userId: 'approver', role: 'MEMBER', revokedAt: null },
  ];
  const slots = [
    {
      id: 'slot-1',
      projectId: 'p1',
      slotKey: 'release-approval',
      kind: 'RELEASE_ACCEPTANCE',
      reviewRequestId: 'review-1',
      requiredUserId: 'approver',
      requiredRoleId: null,
      dueAt: new Date('2026-10-01T00:00:00Z'),
      decisions: [] as unknown[],
    },
    {
      id: 'slot-2',
      projectId: 'p1',
      slotKey: 'task-acceptance',
      kind: 'TASK_ACCEPTANCE',
      reviewRequestId: 'review-2',
      requiredUserId: 'approver',
      requiredRoleId: null,
      dueAt: new Date('2026-10-01T00:00:00Z'),
      decisions: [{ id: 'decision-1' }],
    },
  ];
  const delegations: Array<Record<string, unknown> & { id: string }> = [];

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
    },
    approvalSlot: {
      findFirst: async (input: { where: { id: string; projectId: string } }) =>
        slots.find(
          (slot) => slot.id === input.where.id && slot.projectId === input.where.projectId,
        ) ?? null,
      findMany: async (input: {
        where: {
          projectId: string;
          dueAt: { lte: Date };
          decisions: { none: Record<string, never> };
        };
      }) =>
        slots
          .filter(
            (slot) =>
              slot.projectId === input.where.projectId &&
              slot.dueAt <= input.where.dueAt.lte &&
              slot.decisions.length === 0,
          )
          .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
          .map((slot) => ({
            id: slot.id,
            slotKey: slot.slotKey,
            kind: slot.kind,
            reviewRequestId: slot.reviewRequestId,
            requiredUserId: slot.requiredUserId,
            requiredRoleId: slot.requiredRoleId,
            dueAt: slot.dueAt,
          })),
    },
    approvalSlotDelegation: {
      findFirst: async (input: {
        where: { slotId: string; revokedAt: null; expiresAt: { gt: Date } };
      }) =>
        delegations.find(
          (delegation) =>
            delegation.slotId === input.where.slotId &&
            delegation.revokedAt === null &&
            (delegation.expiresAt as Date) > input.where.expiresAt.gt,
        ) ?? null,
      findMany: async (input: { where: { projectId: string } }) =>
        delegations.filter((delegation) => delegation.projectId === input.where.projectId),
      create: async (input: { data: Record<string, unknown> }) => {
        const row = {
          id: `delegation-${delegations.length + 1}`,
          revokedAt: null,
          createdAt: new Date(),
          ...input.data,
        } as Record<string, unknown> & { id: string };
        delegations.push(row);
        return row;
      },
      updateMany: async (input: {
        where: { id: string; projectId: string; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        const row = delegations.find(
          (delegation) =>
            delegation.id === input.where.id &&
            delegation.projectId === input.where.projectId &&
            delegation.revokedAt === null,
        );
        if (!row) return { count: 0 };
        row.revokedAt = input.data.revokedAt;
        return { count: 1 };
      },
    },
  };

  return { service: new DelegationsService(prisma as never), delegations };
}

const future = new Date(Date.now() + 86_400_000).toISOString();

describe('DelegationsService', () => {
  it('creates a delegation for an active member', async () => {
    const { service } = fakePrisma();
    const delegation = await service.create('p1', 'owner', {
      slotId: 'slot-1',
      delegateUserId: 'member',
      expiresAt: future,
    });
    expect(delegation).toMatchObject({
      slotId: 'slot-1',
      delegatorUserId: 'approver',
      delegateUserId: 'member',
    });
  });

  it('rejects delegating to the slot owner', async () => {
    const { service } = fakePrisma();
    await expect(
      service.create('p1', 'owner', {
        slotId: 'slot-1',
        delegateUserId: 'approver',
        expiresAt: future,
      }),
    ).rejects.toMatchObject({ message: 'DELEGATE_IS_OWNER' });
  });

  it('rejects delegates who are not active members', async () => {
    const { service } = fakePrisma();
    await expect(
      service.create('p1', 'owner', {
        slotId: 'slot-1',
        delegateUserId: 'stranger',
        expiresAt: future,
      }),
    ).rejects.toMatchObject({ message: 'DELEGATE_NOT_MEMBER' });
  });

  it('rejects expired timestamps', async () => {
    const { service } = fakePrisma();
    await expect(
      service.create('p1', 'owner', {
        slotId: 'slot-1',
        delegateUserId: 'member',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ message: 'INVALID_DELEGATION_EXPIRY' });
  });

  it('rejects a second active delegation for the same slot', async () => {
    const { service } = fakePrisma();
    await service.create('p1', 'owner', {
      slotId: 'slot-1',
      delegateUserId: 'member',
      expiresAt: future,
    });
    await expect(
      service.create('p1', 'owner', {
        slotId: 'slot-1',
        delegateUserId: 'member',
        expiresAt: future,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'DELEGATION_EXISTS' });
  });

  it('revokes a delegation and rejects unknown ids', async () => {
    const { service, delegations } = fakePrisma();
    const delegation = await service.create('p1', 'owner', {
      slotId: 'slot-1',
      delegateUserId: 'member',
      expiresAt: future,
    });
    await expect(service.revoke('p1', 'owner', delegation.id)).resolves.toEqual({ revoked: true });
    expect(delegations[0].revokedAt).toBeInstanceOf(Date);
    await expect(service.revoke('p1', 'owner', delegation.id)).rejects.toMatchObject({
      message: 'DELEGATION_NOT_FOUND',
    });
  });

  it('lists overdue slots without decisions', async () => {
    const { service } = fakePrisma();
    const overdue = await service.overdue('p1', 'member');
    expect(overdue.map((slot) => slot.id)).toEqual(['slot-1']);
  });
});
