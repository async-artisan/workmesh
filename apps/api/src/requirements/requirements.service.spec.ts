import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import { RequirementStatus } from '@prisma/client';
import { RequirementQueryDto } from './dto';
import { RequirementsService } from './requirements.service';

describe('requirement workflow', () => {
  it('rejects skipping gates in the documented lifecycle', () =>
    expect(['PRD_READY', 'ARCHIVED']).not.toContain('RELEASED'));

  it('requires a project scope in list queries', async () => {
    const errors = await validate(plainToInstance(RequirementQueryDto, {}));
    expect(errors.map((error) => error.property)).toContain('projectId');
  });

  it('scopes, sorts, and paginates requirement queries', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const assertMember = vi.fn();
    const service = new RequirementsService(
      { requirement: { findMany, count } } as never,
      { assertMember } as never,
    );

    await service.list('user-1', {
      projectId: '00000000-0000-4000-8000-000000000001',
      page: 2,
      limit: 10,
      status: undefined,
      sortBy: 'title',
      sortOrder: 'asc',
    });

    expect(assertMember).toHaveBeenCalledWith('user-1', '00000000-0000-4000-8000-000000000001');
    expect(findMany).toHaveBeenCalledWith({
      where: { projectId: '00000000-0000-4000-8000-000000000001' },
      orderBy: { title: 'asc' },
      skip: 10,
      take: 10,
    });
  });

  it('uses default paging, creates defaults, and enforces status transitions', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const findUnique = vi.fn().mockResolvedValue({
      id: 'r-1',
      projectId: 'p-1',
      status: RequirementStatus.DRAFT,
    });
    const create = vi.fn().mockResolvedValue({ id: 'r-2' });
    const update = vi.fn().mockResolvedValue({ id: 'r-1', status: RequirementStatus.PRD_READY });
    const remove = vi.fn().mockResolvedValue({ id: 'r-1' });
    const findFirst = vi.fn().mockResolvedValue({ seq: 7 });
    const service = new RequirementsService(
      {
        project: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', key: 'YFF' }) },
        requirement: { findMany, count, findUnique, findFirst, create, update, delete: remove },
      } as never,
      { assertMember: vi.fn() } as never,
    );
    const projectId = '00000000-0000-4000-8000-000000000001';
    await expect(service.list('user-1', { projectId } as never)).resolves.toMatchObject({
      page: 1,
      limit: 20,
    });
    await service.create('user-1', { projectId, title: 'Requirement' } as never);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        projectId,
        seq: 8,
        code: 'YFF-REQ-8',
        createdById: 'user-1',
        description: '',
        userStories: [],
        acceptanceCriteria: [],
      }),
    });
    await expect(
      service.update('user-1', 'r-1', { status: RequirementStatus.RELEASED } as never),
    ).rejects.toMatchObject({ status: 400 });
    await service.update('user-1', 'r-1', { status: RequirementStatus.DRAFT } as never);
    await service.update('user-1', 'r-1', { status: RequirementStatus.PRD_READY } as never);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('derives the first code of a project when it has no requirements yet', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'r-1' });
    const service = new RequirementsService(
      {
        project: { findUnique: vi.fn().mockResolvedValue({ id: 'p-1', key: 'YFF' }) },
        requirement: { findFirst: vi.fn().mockResolvedValue(null), create },
      } as never,
      { assertMember: vi.fn() } as never,
    );
    await service.create('user-1', { projectId: 'p-1', title: 'First' } as never);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ seq: 1, code: 'YFF-REQ-1' }),
    });
  });

  it('returns authorized requirements and deletes only existing items', async () => {
    const item = { id: 'r-1', projectId: 'p-1', status: RequirementStatus.DRAFT };
    const findUnique = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(item);
    const remove = vi.fn().mockResolvedValue(item);
    const assertMember = vi.fn();
    const service = new RequirementsService(
      {
        requirement: { findUnique, delete: remove, findMany: vi.fn(), count: vi.fn() },
      } as never,
      { assertMember } as never,
    );
    await expect(service.get('user-1', 'missing')).rejects.toMatchObject({ status: 404 });
    await expect(service.get('user-1', 'r-1')).resolves.toEqual(item);
    await expect(service.remove('user-1', 'r-1')).resolves.toEqual(item);
    expect(assertMember).toHaveBeenCalledWith('user-1', 'p-1');
    expect(remove).toHaveBeenCalledWith({ where: { id: 'r-1' } });
  });
});
