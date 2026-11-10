import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { PrismaClient, type WorkStatus } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1BoardPrismaRepository } from '../src/tasks/v1-board.prisma-repository';
import { V1BoardService } from '../src/tasks/v1-board.service';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
const columns = ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'] as const;
type Column = (typeof columns)[number];
type ExpectedTask = {
  id: string;
  requirementCode: string;
  requirementTitle: string;
  roleTitle: string;
  column: Column;
  generation: number;
};

suite('PostgreSQL board pagination preserves complete counts and global filters', () => {
  let db: PrismaClient;
  let service: V1BoardService;
  const userId = randomUUID();
  const projectId = randomUUID();
  const definitionId = randomUUID();
  const revisionId = randomUUID();
  const roles = Array.from({ length: 12 }, (_, index) => ({
    id: randomUUID(),
    projectId,
    key: `worker-${index}`,
    title: index === 11 ? "Ops 100%_\\'" : `Worker ${String(index).padStart(2, '0')}`,
  }));
  const requirements = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(),
    projectId,
    seq: index + 1,
    code: `BP-${String(index + 1).padStart(3, '0')}`,
    title: index === 49 ? "Literal 100%_\\' needle" : `Requirement ${index + 1}`,
  }));
  const instances = requirements.map((requirement, index) => ({
    id: randomUUID(),
    projectId,
    definitionId,
    definitionRevisionId: revisionId,
    requirementId: requirement.id,
    // The historical board includes retired instances; pagination must retain them.
    retiredAt: index % 2 === 0 ? new Date('2026-01-01T00:00:00.000Z') : null,
  }));
  const expected: ExpectedTask[] = [];
  const tasks: Array<{
    id: string;
    projectId: string;
    workflowInstanceId: string;
    stepKey: string;
    roleId: string;
    responsibleUserId: string;
    generation: number;
    workStatus: WorkStatus;
    currentClaimId: string | null;
    currentArtifactSetId: string | null;
  }> = [];
  const claims: Array<{
    id: string;
    projectId: string;
    taskId: string;
    taskGeneration: number;
    userId: string;
    claimedAt: Date;
    releasedAt: Date | null;
  }> = [];
  function add(requirementIndex: number, column: Column, roleIndex: number, suffix = '') {
    const requirement = requirements[requirementIndex];
    const role = roles[roleIndex];
    const id = randomUUID();
    const generation = (requirementIndex % 3) + 1;
    const currentClaimId = ['BACKLOG', 'DELIVERED'].includes(column) ? null : randomUUID();
    const workStatus: WorkStatus =
      column === 'BACKLOG' || column === 'DELIVERED' ? 'BLOCKED' : column;
    tasks.push({
      id,
      projectId,
      workflowInstanceId: instances[requirementIndex].id,
      stepKey: `step_${column}${suffix}`,
      roleId: role.id,
      responsibleUserId: userId,
      generation,
      workStatus,
      currentClaimId,
      // Board classifies the persisted task pointers, independently of artifact loading.
      currentArtifactSetId: column === 'DELIVERED' ? randomUUID() : null,
    });
    expected.push({
      id,
      requirementCode: requirement.code,
      requirementTitle: requirement.title,
      roleTitle: role.title,
      column,
      generation,
    });
    if (currentClaimId)
      claims.push({
        id: currentClaimId,
        projectId,
        taskId: id,
        taskGeneration: generation,
        userId,
        claimedAt: new Date('2026-01-01T00:00:00.000Z'),
        releasedAt: requirementIndex === 0 && column === 'ACTIVE' ? new Date() : null,
      });
  }
  for (let index = 0; index < requirements.length; index++)
    for (const column of columns) add(index, column, index % roles.length);
  for (let index = 0; index < roles.length; index++) add(0, 'BACKLOG', index, `_${index}`);
  add(49, 'BLOCKED', 0, '_extra1');
  add(49, 'BLOCKED', 0, '_extra2');
  add(25, 'ACTIVE', 0, '_extra');
  const human: Principal = { kind: 'HUMAN', userId, scopes: [] };
  const agent: Principal = {
    kind: 'AGENT',
    userId,
    agentCredentialId: randomUUID(),
    projectId,
    roleIds: [roles[0].id],
    scopes: ['task:read'],
  };

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);
    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: { id: userId, email: `${userId}@board.test`, passwordHash: 'fixture' },
      });
      await tx.project.create({
        data: {
          id: projectId,
          key: randomUUID().slice(0, 6),
          name: 'Board pages',
          createdById: userId,
        },
      });
      await tx.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
      await tx.projectRole.createMany({ data: roles });
      await tx.projectRoleAssignment.create({ data: { projectId, userId, roleId: roles[0].id } });
      await tx.requirement.createMany({ data: requirements });
      await tx.workflowDefinition.create({
        data: { id: definitionId, projectId, workflowKey: 'board' },
      });
      await tx.workflowRevision.create({
        data: {
          id: revisionId,
          projectId,
          definitionId,
          revision: 1,
          digest: 'a'.repeat(64),
          definition: { steps: [{ key: 'step_BACKLOG', displayName: 'Board custom title' }] },
          compiledRules: {},
        },
      });
      await tx.workflowInstance.createMany({ data: instances });
      await tx.task.createMany({ data: tasks });
      await tx.taskClaim.createMany({ data: claims });
    });
    service = new V1BoardService(
      new V1BoardPrismaRepository(db as PrismaService),
      new V1AuthorizationService(new V1AuthorizationPrismaRepository(db as PrismaService)),
    );
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.$transaction(async (tx) => {
        await tx.taskClaim.deleteMany({
          where: { projectId, id: { in: claims.map(({ id }) => id) } },
        });
        await tx.task.deleteMany({ where: { projectId, id: { in: tasks.map(({ id }) => id) } } });
        await tx.workflowInstance.deleteMany({
          where: { projectId, id: { in: instances.map(({ id }) => id) } },
        });
        await tx.workflowRevision.deleteMany({ where: { projectId, id: revisionId } });
        await tx.workflowDefinition.deleteMany({ where: { projectId, id: definitionId } });
        await tx.requirement.deleteMany({
          where: { projectId, id: { in: requirements.map(({ id }) => id) } },
        });
        await tx.projectRoleAssignment.deleteMany({ where: { projectId, userId } });
        await tx.projectRole.deleteMany({
          where: { projectId, id: { in: roles.map(({ id }) => id) } },
        });
        await tx.projectMember.deleteMany({ where: { projectId, userId } });
        await tx.project.deleteMany({ where: { id: projectId, createdById: userId } });
        await tx.user.deleteMany({ where: { id: userId } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  function counts(rows = expected) {
    return Object.fromEntries(
      columns.map((key) => [key, rows.filter((task) => task.column === key).length]),
    );
  }

  it('returns bounded first columns with exact complete totals, including old instances and generations', async () => {
    const result = await service.board(human, projectId);
    expect(result.summary.total).toBe(315);
    expect(result.summary.matchedTotal).toBe(expected.length);
    expect(result.summary.requirementTotal).toBe(50);
    expect(
      Object.fromEntries(result.summary.columns.map(({ key, total }) => [key, total])),
    ).toEqual(counts());
    expect(result.columns.map(({ key }) => key)).toEqual([...columns]);
    for (const column of result.columns) {
      expect(column.cards).toHaveLength(20);
      expect(column.total).toBe(counts()[column.key]);
      expect(column.nextCursor).toEqual(expect.any(String));
    }
  });

  it('traverses all six columns without omissions or duplicates in generation/id order', async () => {
    for (const column of columns) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.column(human, projectId, column, { limit: 7, cursor });
        expect(page.cards.length).toBeLessThanOrEqual(7);
        expect(page.total).toBe(counts()[column]);
        seen.push(...page.cards.map(({ taskId }) => taskId));
        cursor = page.nextCursor ?? undefined;
        expect(seen.length).toBeLessThanOrEqual(expected.length);
      } while (cursor);
      const ordered = expected
        .filter((task) => task.column === column)
        .sort((a, b) => b.generation - a.generation || (a.id < b.id ? -1 : 1));
      expect(seen).toEqual(ordered.map(({ id }) => id));
      expect(new Set(seen).size).toBe(seen.length);
    }
    const active = await service.column(human, projectId, 'ACTIVE', { limit: 100 });
    expect(active.cards.some((card) => card.currentClaimId && card.claimedUserId === null)).toBe(
      true,
    );
  });

  it('applies literal case-insensitive search and exact role/requirement filters across the full project', async () => {
    for (const q of ["100%_\\' NEEDLE", '%', '_', '\\', "'"]) {
      const expectedRows = expected.filter((task) =>
        `${task.requirementCode} ${task.requirementTitle} step_${task.column} ${task.roleTitle}`
          .toLowerCase()
          .includes(q.toLowerCase()),
      );
      const result = await service.board(human, projectId, { q, limit: 100 });
      expect(result.summary.matchedTotal).toBe(expectedRows.length);
      expect(
        new Set(result.columns.flatMap(({ cards }) => cards.map(({ taskId }) => taskId))),
      ).toEqual(new Set(expectedRows.map(({ id }) => id)));
    }
    const result = await service.board(human, projectId, {
      roleTitle: roles[11].title,
      requirementCode: requirements[0].code,
      limit: 100,
    });
    expect(result.summary.total).toBe(315);
    expect(result.summary.matchedTotal).toBe(1);
    expect(result.columns.flatMap(({ cards }) => cards.map(({ roleTitle }) => roleTitle))).toEqual([
      roles[11].title,
    ]);
    const empty = await service.board(human, projectId, { q: 'no task can match this' });
    expect(empty.summary.matchedTotal).toBe(0);
    expect(
      empty.columns.every(({ cards, nextCursor }) => cards.length === 0 && nextCursor === null),
    ).toBe(true);
  });

  it('pages globally ranked requirement aggregates and continues the roles of a single group', async () => {
    const groups = [];
    let cursor: string | undefined;
    do {
      const page = await service.requirements(human, projectId, { limit: 7, cursor });
      expect(page.items.length).toBeLessThanOrEqual(7);
      expect(page.summary.requirementTotal).toBe(50);
      groups.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      expect(groups.length).toBeLessThanOrEqual(50);
    } while (cursor);
    expect(groups.map(({ code }) => code)).toEqual([
      requirements[49].code,
      requirements[25].code,
      ...requirements.filter((_, index) => index !== 49 && index !== 25).map(({ code }) => code),
    ]);
    for (const group of groups) {
      const members = expected.filter((task) => task.requirementCode === group.code);
      expect(group.total).toBe(members.length);
      expect(group.counts).toEqual(counts(members));
      expect(group.roleTotal).toBe(new Set(members.map(({ roleTitle }) => roleTitle)).size);
    }
    const firstRequirement = groups.find(({ code }) => code === requirements[0].code)!;
    expect(firstRequirement.roles).toHaveLength(10);
    expect(firstRequirement.roleTotal).toBe(12);
    const more = await service.filters(human, projectId, 'roles', {
      requirementCode: firstRequirement.code,
      limit: 10,
      cursor: firstRequirement.rolesNextCursor!,
    });
    expect(new Set([...firstRequirement.roles, ...more.items.map(({ value }) => value)])).toEqual(
      new Set(roles.map(({ title }) => title)),
    );
    expect(more.nextCursor).toBeNull();
  });

  it('pages all project facets and their literal searches independently of loaded cards', async () => {
    for (const kind of ['roles', 'requirements']) {
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await service.filters(human, projectId, kind, { limit: 5, cursor });
        expect(page.items.length).toBeLessThanOrEqual(5);
        expect(page.total).toBe(kind === 'roles' ? 12 : 50);
        seen.push(...page.items.map(({ value }) => value));
        cursor = page.nextCursor ?? undefined;
        expect(seen.length).toBeLessThanOrEqual(50);
      } while (cursor);
      const all =
        kind === 'roles' ? roles.map(({ title }) => title) : requirements.map(({ code }) => code);
      expect(seen).toEqual(all.sort());
      expect(new Set(seen).size).toBe(all.length);
    }
    expect(
      (await service.filters(human, projectId, 'roles', { search: '100%_' })).items.map(
        ({ value }) => value,
      ),
    ).toEqual([roles[11].title]);
    expect(
      (await service.filters(human, projectId, 'requirements', { search: 'NEEDLE' })).items.map(
        ({ value }) => value,
      ),
    ).toEqual([requirements[49].code]);
  });

  it('rejects reused cursors when their view, filter, column, project or facet search changes', async () => {
    const page = await service.column(human, projectId, 'BACKLOG', { limit: 5 });
    const cursor = page.nextCursor!;
    for (const read of [
      () => service.column(human, projectId, 'ACTIVE', { cursor }),
      () => service.column(human, projectId, 'BACKLOG', { cursor, q: 'changed' }),
      () => service.column(human, projectId, 'BACKLOG', { cursor, roleTitle: roles[0].title }),
      () =>
        service.column(human, projectId, 'BACKLOG', {
          cursor,
          requirementCode: requirements[0].code,
        }),
      () => service.requirements(human, projectId, { cursor }),
      () => service.filters(human, projectId, 'roles', { cursor }),
      () => service.column(human, projectId, 'BACKLOG', { cursor: 'malformed' }),
    ])
      await expect(read()).rejects.toMatchObject({ status: 400 });
    const facet = await service.filters(human, projectId, 'roles', { limit: 5 });
    await expect(
      service.filters(human, projectId, 'roles', { cursor: facet.nextCursor!, search: 'Worker' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps task:read authorization for every route without adding requirement:read', async () => {
    const readers = [
      (principal: Principal, target = projectId) => service.board(principal, target),
      (principal: Principal, target = projectId) => service.column(principal, target, 'BACKLOG'),
      (principal: Principal, target = projectId) => service.requirements(principal, target),
      (principal: Principal, target = projectId) =>
        service.filters(principal, target, 'requirements'),
    ];
    for (const read of readers) {
      await expect(read(agent)).resolves.toBeDefined();
      await expect(read({ ...agent, scopes: [] })).rejects.toMatchObject({ status: 403 });
      await expect(read({ ...human, userId: randomUUID() })).rejects.toMatchObject({ status: 404 });
      await expect(read(agent, randomUUID())).rejects.toMatchObject({ status: 404 });
    }
  });
});
