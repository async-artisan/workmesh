import { describe, expect, it, vi } from 'vitest';
import { DependencyService } from './dependency.service';

describe('DependencyService', () => {
  it('rejects self dependencies before touching persistence', async () => {
    const prisma = { requirement: { findUnique: vi.fn() } };
    const service = new DependencyService(prisma as never, {} as never);
    await expect(service.create('user', 'same', 'same')).rejects.toThrow('不能依赖自身');
    expect(prisma.requirement.findUnique).not.toHaveBeenCalled();
  });

  it('lists and creates same-project dependencies with cycle detection', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const upsert = vi.fn().mockResolvedValue({ id: 'dependency-1' });
    const findUnique = vi
      .fn()
      .mockImplementation(({ where }) => Promise.resolve({ projectId: 'project-1', id: where.id }));
    const assertRequirementMember = vi.fn();
    const service = new DependencyService(
      {
        requirement: { findUnique },
        requirementDependency: { findMany, upsert },
      } as never,
      { assertRequirementMember, assertMember: vi.fn() } as never,
    );

    await expect(service.list('user-1', 'from')).resolves.toEqual([]);
    await service.create('user-1', 'from', 'to');
    expect(assertRequirementMember).toHaveBeenCalledWith('user-1', 'from');
    expect(upsert).toHaveBeenCalledWith({
      where: { fromId_toId_type: { fromId: 'from', toId: 'to', type: 'depends_on' } },
      create: { fromId: 'from', toId: 'to', type: 'depends_on' },
      update: {},
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { fromId: 'to' },
      select: { toId: true },
    });
  });

  it('rejects missing, cross-project, and circular dependencies', async () => {
    const missing = new DependencyService(
      {
        requirement: { findUnique: vi.fn().mockResolvedValue(null) },
        requirementDependency: { findMany: vi.fn(), upsert: vi.fn() },
      } as never,
      { assertMember: vi.fn() } as never,
    );
    await expect(missing.create('user-1', 'from', 'to')).rejects.toMatchObject({ status: 404 });

    const crossProject = new DependencyService(
      {
        requirement: {
          findUnique: vi
            .fn()
            .mockResolvedValueOnce({ projectId: 'project-1' })
            .mockResolvedValueOnce({ projectId: 'project-2' }),
        },
        requirementDependency: { findMany: vi.fn(), upsert: vi.fn() },
      } as never,
      { assertMember: vi.fn() } as never,
    );
    await expect(crossProject.create('user-1', 'from', 'to', 'blocks')).rejects.toMatchObject({
      status: 404,
    });

    const cycle = new DependencyService(
      {
        requirement: {
          findUnique: vi.fn().mockResolvedValue({ projectId: 'project-1' }),
        },
        requirementDependency: {
          findMany: vi.fn().mockResolvedValue([{ toId: 'from' }]),
          upsert: vi.fn(),
        },
      } as never,
      { assertMember: vi.fn() } as never,
    );
    await expect(cycle.create('user-1', 'from', 'to')).rejects.toMatchObject({ status: 400 });
  });

  it('requires an existing dependency before removal', async () => {
    const remove = vi.fn().mockResolvedValue({ id: 'dependency-1' });
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ fromId: 'from' });
    const assertRequirementMember = vi.fn();
    const service = new DependencyService(
      {
        requirementDependency: { findUnique, delete: remove },
        requirement: {},
      } as never,
      { assertRequirementMember } as never,
    );
    await expect(service.remove('user-1', 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.remove('user-1', 'dependency-1')).resolves.toEqual({
      id: 'dependency-1',
    });
    expect(assertRequirementMember).toHaveBeenCalledWith('user-1', 'from');
  });
});
