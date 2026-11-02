import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { V1ActivityService } from './v1-activity.service';

const principal = { kind: 'HUMAN', userId: 'u-1' } as unknown as Principal;

describe('V1ActivityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只返回成员项目的审计事件，并补齐项目名与 actor', async () => {
    const prisma = {
      project: { findMany: vi.fn() },
      auditEvent: { findMany: vi.fn() },
    };
    prisma.project.findMany.mockResolvedValue([{ id: 'p1', key: 'DEMO', name: 'Demo' }]);
    prisma.auditEvent.findMany.mockResolvedValue([
      {
        id: 'a1',
        projectId: 'p1',
        action: 'REVIEW_DECIDE',
        targetType: 'REVIEW_REQUEST',
        targetId: 'r1',
        targetVersion: 3,
        outcome: 'SUCCESS',
        details: { decision: 'APPROVE' },
        createdAt: new Date('2026-11-02T00:00:00.000Z'),
        actorStamp: { user: { id: 'u-2', email: 'bob@example.com' } },
      },
    ]);

    const service = new V1ActivityService(prisma as unknown as PrismaService);
    const result = await service.list(principal, 10);

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: { in: ['p1'] } },
        take: 10,
      }),
    );
    expect(result.items[0]).toMatchObject({
      id: 'a1',
      projectName: 'Demo',
      action: 'REVIEW_DECIDE',
      actor: { id: 'u-2', email: 'bob@example.com' },
    });
  });
});
