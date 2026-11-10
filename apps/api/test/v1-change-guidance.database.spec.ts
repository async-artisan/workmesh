import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import type { PrismaService } from '../src/prisma/prisma.service';
import { V1ChangePrismaRepository } from '../src/tasks/v1-change.prisma-repository';
import { V1ChangeService } from '../src/tasks/v1-change.service';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL recipient-specific change guidance', () => {
  let db: PrismaClient;
  let service: V1ChangeService;
  let projectId: string;
  let userId: string;
  let otherUserId: string;
  let roleId: string;
  let secondRoleId: string;
  let requirementId: string;
  let taskId: string;
  let secondTaskId: string;
  let principal: Principal;

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    expect(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name,
    ).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@change-guidance.test`, passwordHash: 'fixture' },
      })
    ).id;
    otherUserId = (
      await db.user.create({
        data: { email: `${randomUUID()}@change-guidance.test`, passwordHash: 'fixture' },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { key: randomUUID().slice(0, 6), name: 'Change guidance', createdById: userId },
      })
    ).id;
    await db.projectMember.create({ data: { projectId, userId, role: 'MEMBER' } });
    roleId = (
      await db.projectRole.create({ data: { projectId, key: 'backend', title: 'Backend' } })
    ).id;
    secondRoleId = (await db.projectRole.create({ data: { projectId, key: 'qa', title: 'QA' } }))
      .id;
    await db.projectRoleAssignment.createMany({
      data: [
        { projectId, userId, roleId },
        { projectId, userId, roleId: secondRoleId },
      ],
    });
    requirementId = (
      await db.requirement.create({
        data: { projectId, seq: 1, code: 'CHANGE-1', title: 'Change guidance', generation: 2 },
      })
    ).id;
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: 'change-guidance' },
    });
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest: 'c'.repeat(64),
        definition: {
          steps: [{ key: 'impl', displayName: 'Backend implementation' }, { key: 'qa' }],
        },
        compiledRules: {},
      },
    });
    const instance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: definition.id,
        definitionRevisionId: revision.id,
        requirementId,
      },
    });
    taskId = (
      await db.task.create({
        data: {
          projectId,
          workflowInstanceId: instance.id,
          stepKey: 'impl',
          roleId,
          responsibleUserId: userId,
          acceptanceKeys: ['cancel'],
          generation: 2,
        },
      })
    ).id;
    secondTaskId = (
      await db.task.create({
        data: {
          projectId,
          workflowInstanceId: instance.id,
          stepKey: 'qa',
          roleId: secondRoleId,
          responsibleUserId: userId,
          acceptanceKeys: ['pay'],
        },
      })
    ).id;
    const prisma = db as PrismaService;
    service = new V1ChangeService(
      new V1ChangePrismaRepository(prisma),
      new V1AuthorizationService(new V1AuthorizationPrismaRepository(prisma)),
      new V1IdempotencyPrismaRepository(prisma),
    );
    principal = { kind: 'HUMAN', userId, scopes: [] };
  });

  async function event(
    role: string | null,
    targets: object,
    sourceKind = 'DOCUMENT_PUBLICATION',
    offset = 0,
    acked = false,
  ) {
    const createdAt = new Date(Date.UTC(2026, 10, 10, 0, 0, offset));
    const value = await db.changeEvent.create({
      data: {
        projectId,
        requirementId,
        sourceKind,
        sourceId: randomUUID(),
        changedFields: ['generation'],
        targets,
        createdAt,
      },
    });
    return db.changeRecipient.create({
      data: {
        projectId,
        eventId: value.id,
        userId,
        roleId: role,
        createdAt,
        ackedAt: acked ? createdAt : null,
      },
    });
  }

  it('filters Agent role before pagination, retains role-less messages, and returns exact current task action', async () => {
    const previous = await event(
      roleId,
      { taskIds: [taskId, secondTaskId], requirementGeneration: 1 },
      'DOCUMENT_PUBLICATION',
      1,
    );
    await event(secondRoleId, { taskIds: [taskId, secondTaskId] }, 'REQUIREMENT_UPDATE', 2);
    const latest = await event(null, { acceptanceKeys: ['cancel'] }, 'CHANGE_REQUEST', 3);
    const agent: Principal = {
      kind: 'AGENT',
      userId,
      agentCredentialId: randomUUID(),
      projectId,
      roleIds: [roleId],
      scopes: ['change:read'],
    };
    const first = await service.listRecipients(agent, { projectId, limit: 1, ackedOnly: false });
    expect(first.items.map((row) => row.id)).toEqual([latest.id]);
    expect(first.items[0].guidance).toMatchObject({
      scope: 'CURRENT_ACCEPTANCE_SCOPE',
      tasks: [{ taskId, action: 'INSPECT_AND_CLAIM' }],
    });
    expect(first.items[0].guidance?.tasks).toHaveLength(1);
    expect(first.nextCursor).toBe(latest.id);
    const second = await service.listRecipients(agent, {
      projectId,
      limit: 1,
      cursor: first.nextCursor!,
      ackedOnly: false,
    });
    expect(second.items.map((row) => row.id)).toEqual([previous.id]);
    expect(second.items[0]).toMatchObject({
      event: { sourceKind: 'DOCUMENT_PUBLICATION' },
      guidance: {
        eventBaseline: 'SUPERSEDED',
        tasks: [
          {
            taskId,
            taskCode: 'CHANGE-1/impl',
            stepDisplayName: 'Backend implementation',
            reason: 'NO_CONTEXT',
          },
        ],
      },
    });
    expect(second.items[0].guidance?.tasks).toHaveLength(1);
    expect(second.items[0].event).not.toHaveProperty('targets');
    expect(second.nextCursor).toBeNull();
    await expect(
      service.listRecipients(agent, { projectId, limit: 1, cursor: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('keeps current-scope matching distinct from explicit empty events and filters acknowledgement pages', async () => {
    const empty = await event(roleId, { taskIds: [] }, 'REQUIREMENT_UPDATE', 10);
    const acked = await event(roleId, { taskIds: [taskId] }, 'REQUIREMENT_UPDATE', 11, true);
    const pending = await service.listRecipients(principal, {
      projectId,
      limit: 200,
      ackedOnly: false,
    });
    expect(pending.items.some((row) => row.id === acked.id)).toBe(false);
    expect(pending.items.find((row) => row.id === empty.id)?.guidance).toMatchObject({
      scope: 'EVENT_TASKS',
      tasks: [],
    });
    const known = await service.listRecipients(principal, {
      projectId,
      limit: 200,
      ackedOnly: true,
    });
    expect(known.items.map((row) => row.id)).toEqual([acked.id]);
    expect(known.items[0].guidance?.tasks[0].taskId).toBe(taskId);
  });

  it('rejects cross-user cursors and returns history without inventing actions for retired tasks', async () => {
    const row = await event(roleId, { taskIds: [taskId] }, 'DOCUMENT_PUBLICATION', 15);
    const other = await db.changeRecipient.create({
      data: { projectId, eventId: row.eventId, userId: otherUserId },
    });
    await expect(
      service.listRecipients(principal, { projectId, limit: 1, cursor: other.id }),
    ).rejects.toMatchObject({ status: 404 });
    const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
    await db.workflowInstance.update({
      where: { id: task.workflowInstanceId },
      data: { retiredAt: new Date() },
    });
    const current = await service.listRecipients(principal, { projectId, limit: 200 });
    expect(current.items.find((item) => item.id === row.id)?.guidance?.tasks[0]).toMatchObject({
      reason: 'RETIRED',
      action: 'CONTACT_OWNER',
    });
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { revokedAt: new Date() },
    });
    await expect(service.listRecipients(principal, { projectId, limit: 20 })).rejects.toMatchObject(
      { status: 404 },
    );
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        const where = { projectId };
        await db.changeRecipient.deleteMany({ where });
        await db.changeEvent.deleteMany({ where });
        await db.task.deleteMany({ where });
        await db.workflowInstance.deleteMany({ where });
        await db.workflowRevision.deleteMany({ where });
        await db.workflowDefinition.deleteMany({ where });
        await db.requirement.deleteMany({ where });
        await db.projectRoleAssignment.deleteMany({ where });
        await db.projectRole.deleteMany({ where });
        await db.projectMember.deleteMany({ where });
        await db.project.delete({ where: { id: projectId } });
      }
      await db.user.deleteMany({ where: { id: { in: [userId, otherUserId].filter(Boolean) } } });
    } finally {
      await db.$disconnect();
    }
  });
});
