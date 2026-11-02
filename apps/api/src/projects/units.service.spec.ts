import { describe, expect, it } from 'vitest';
import { UnitsService } from './units.service';

type Row = Record<string, unknown> & { id: string };

function fakePrisma() {
  const members = [
    { projectId: 'p1', userId: 'owner', role: 'OWNER', revokedAt: null },
    { projectId: 'p1', userId: 'member', role: 'MEMBER', revokedAt: null },
  ];
  const repositories = [{ id: 'repo-1', projectId: 'p1', archivedAt: null as Date | null }];
  const units: Row[] = [];
  const dependencies: Row[] = [];

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
    projectRepository: {
      findFirst: async (input: { where: { id: string; projectId: string; archivedAt: null } }) =>
        repositories.find(
          (repository) =>
            repository.id === input.where.id &&
            repository.projectId === input.where.projectId &&
            repository.archivedAt === null,
        ) ?? null,
    },
    unit: {
      findMany: async (input: { where: { projectId: string } }) =>
        units
          .filter((unit) => unit.projectId === input.where.projectId)
          .sort((left, right) => String(left.key).localeCompare(String(right.key))),
      findFirst: async (input: { where: { id: string; projectId: string } }) =>
        units.find(
          (unit) => unit.id === input.where.id && unit.projectId === input.where.projectId,
        ) ?? null,
      create: async (input: { data: Record<string, unknown> }) => {
        if (
          units.some(
            (unit) => unit.projectId === input.data.projectId && unit.key === input.data.key,
          )
        )
          throw { code: 'P2002' };
        const row = {
          id: `unit-${units.length + 1}`,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...input.data,
        } as Row;
        units.push(row);
        return row;
      },
      update: async (input: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = units.find((unit) => unit.id === input.where.id)!;
        Object.assign(row, input.data);
        return row;
      },
    },
    unitDependency: {
      findMany: async (input: { where: { projectId: string } }) =>
        dependencies.filter((dependency) => dependency.projectId === input.where.projectId),
      create: async (input: { data: Record<string, unknown> }) => {
        if (
          dependencies.some(
            (dependency) =>
              dependency.projectId === input.data.projectId &&
              dependency.fromUnitId === input.data.fromUnitId &&
              dependency.toUnitId === input.data.toUnitId &&
              dependency.edgeKind === input.data.edgeKind,
          )
        )
          throw { code: 'P2002' };
        const row = {
          id: `dep-${dependencies.length + 1}`,
          createdAt: new Date(),
          ...input.data,
        } as Row;
        dependencies.push(row);
        return row;
      },
      deleteMany: async (input: { where: { id: string; projectId: string } }) => {
        const index = dependencies.findIndex(
          (dependency) =>
            dependency.id === input.where.id && dependency.projectId === input.where.projectId,
        );
        if (index < 0) return { count: 0 };
        dependencies.splice(index, 1);
        return { count: 1 };
      },
    },
  };

  return { service: new UnitsService(prisma as never), units, dependencies };
}

const baseUnit = { key: 'billing-api', name: '计费 API' };

describe('UnitsService', () => {
  it('creates units and lists them by key', async () => {
    const { service } = fakePrisma();
    await service.create('p1', 'owner', { ...baseUnit, kind: 'SERVICE' });
    await service.create('p1', 'owner', { key: 'auth-api', name: '鉴权 API' });

    const units = await service.list('p1', 'member');
    expect(units.map((unit) => unit.key)).toEqual(['auth-api', 'billing-api']);
  });

  it('rejects writes from a plain member but allows reads', async () => {
    const { service } = fakePrisma();
    await expect(service.create('p1', 'member', baseUnit)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(service.list('p1', 'member')).resolves.toEqual([]);
  });

  it('rejects unknown or archived repositories', async () => {
    const { service } = fakePrisma();
    await expect(
      service.create('p1', 'owner', { ...baseUnit, repositoryId: 'repo-404' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'REPOSITORY_NOT_FOUND' });
  });

  it('rejects duplicate unit keys', async () => {
    const { service } = fakePrisma();
    await service.create('p1', 'owner', baseUnit);
    await expect(service.create('p1', 'owner', baseUnit)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'UNIT_EXISTS',
    });
  });

  it('updates name and status without touching the key', async () => {
    const { service } = fakePrisma();
    const created = await service.create('p1', 'owner', baseUnit);
    const updated = await service.update('p1', 'owner', created.id, {
      name: '计费服务',
      status: 'DEPRECATED',
    });
    expect(updated).toMatchObject({ key: 'billing-api', name: '计费服务', status: 'DEPRECATED' });
  });

  it('records dependencies and rejects self edges', async () => {
    const { service } = fakePrisma();
    const from = await service.create('p1', 'owner', baseUnit);
    const to = await service.create('p1', 'owner', { key: 'ledger-api', name: '账务 API' });

    await service.createDependency('p1', 'owner', {
      fromUnitId: from.id,
      toUnitId: to.id,
      edgeKind: 'CALLS',
    });
    expect(await service.listDependencies('p1', 'member')).toHaveLength(1);
    await expect(
      service.createDependency('p1', 'owner', {
        fromUnitId: from.id,
        toUnitId: from.id,
        edgeKind: 'CALLS',
      }),
    ).rejects.toMatchObject({ message: 'SELF_DEPENDENCY' });
  });

  it('rejects duplicate edges with the same kind', async () => {
    const { service } = fakePrisma();
    const from = await service.create('p1', 'owner', baseUnit);
    const to = await service.create('p1', 'owner', { key: 'ledger-api', name: '账务 API' });
    const edge = { fromUnitId: from.id, toUnitId: to.id, edgeKind: 'CALLS' as const };
    await service.createDependency('p1', 'owner', edge);
    await expect(service.createDependency('p1', 'owner', edge)).rejects.toMatchObject({
      message: 'DEPENDENCY_EXISTS',
    });
  });

  it('returns not found when deleting an unknown edge', async () => {
    const { service } = fakePrisma();
    await expect(service.deleteDependency('p1', 'owner', 'dep-404')).rejects.toMatchObject({
      message: 'DEPENDENCY_NOT_FOUND',
    });
  });
});
