import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { V1AuthorizationPrismaRepository } from './v1-authorization.prisma-repository';

describe('V1AuthorizationPrismaRepository active roles', () => {
  it('活动角色上下文排除已撤销指派与停用角色，与正式领取事务一致', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const repository = new V1AuthorizationPrismaRepository({
      projectRoleAssignment: { findMany },
    } as unknown as PrismaService);
    await repository.findActiveRoleAssignments('project-1', 'user-1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: 'project-1',
          userId: 'user-1',
          revokedAt: null,
          role: { isActive: true },
        },
      }),
    );
  });
});
