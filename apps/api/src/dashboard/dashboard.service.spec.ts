import { describe, expect, it, vi } from 'vitest';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  it('limits dashboard counts to projects accessible by the current user', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'project-1', name: 'Project One' }]);
    const groupBy = vi.fn().mockResolvedValue([
      { status: 'DRAFT', _count: { _all: 2 } },
      { status: 'DONE', _count: { _all: 1 } },
    ]);
    const count = vi.fn().mockResolvedValue(3);
    const recent = vi.fn().mockResolvedValue([]);
    const service = new DashboardService({
      project: { findMany },
      requirement: { groupBy, findMany: recent },
      prd: { count },
    } as never);
    const result = await service.summary('user-1');
    expect(findMany).toHaveBeenCalledWith({
      where: { members: { some: { userId: 'user-1' } } },
      select: { id: true, name: true },
    });
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: { in: ['project-1'] } } }),
    );
    expect(count).toHaveBeenCalledWith({
      where: { requirement: { projectId: { in: ['project-1'] } } },
    });
    expect(result).toMatchObject({
      projectCount: 1,
      requirementCount: 3,
      completionRate: 33,
      prdCount: 3,
    });
  });
});
