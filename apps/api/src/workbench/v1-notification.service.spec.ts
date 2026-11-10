import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type { V1EmailService } from './v1-email.service';
import { V1NotificationService } from './v1-notification.service';
import type { V1WorkbenchService } from './v1-workbench.service';

const principal = { kind: 'HUMAN', userId: 'u-1', scopes: [] } as unknown as Principal;

function createHarness() {
  const prisma = { user: { findUnique: vi.fn() } };
  const workbench = { get: vi.fn() };
  const email = { send: vi.fn() };
  const service = new V1NotificationService(
    prisma as unknown as PrismaService,
    workbench as unknown as V1WorkbenchService,
    email as unknown as V1EmailService,
  );
  return { service, prisma, workbench, email };
}

describe('V1NotificationService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('把工作台待办整理成邮件摘要并发送到当前用户邮箱', async () => {
    const { service, prisma, workbench, email } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ email: 'alice@example.com' });
    workbench.get.mockResolvedValue({
      counts: { reviews: 2, changes: 1, readyTasks: 1, total: 4 },
      reviews: [
        {
          reviewId: 'r1',
          kind: 'TASK_ACCEPTANCE',
          version: 3,
          subjectLabel: 'backend-impl',
          requirement: { code: 'DEMO-001', title: '登录页改版' },
          slots: [{ viewerCanDecide: true, decided: false }],
        },
        {
          reviewId: 'r2',
          kind: 'PRD_PUBLICATION',
          version: 2,
          subjectLabel: 'PRD v2',
          requirement: { code: 'DEMO-001', title: '登录页改版' },
          slots: [{ viewerCanDecide: true, decided: false }],
        },
      ],
      changes: [
        {
          recipientId: 'c1',
          eventId: 'e1',
          version: 2,
          changedFields: ['acceptance'],
          requirement: { code: 'DEMO-002', title: '订单取消' },
        },
      ],
      readyTasks: [{ claimEligibility: { canClaim: true } }],
      warnings: [],
    });
    email.send.mockResolvedValue(undefined);

    const result = await service.sendEmailDigest(principal);

    expect(email.send).toHaveBeenCalledWith(
      'alice@example.com',
      '[WorkMesh] 待办 4 件',
      expect.stringContaining('待签字：1 件'),
    );
    expect(email.send).toHaveBeenCalledWith(
      'alice@example.com',
      '[WorkMesh] 待办 4 件',
      expect.stringContaining('DEMO-001 登录页改版'),
    );
    expect(result).toMatchObject({ sent: true, to: 'alice@example.com' });
  });

  it('excludes team-only claims and completed slots and labels partial data', async () => {
    const { service, prisma, workbench, email } = createHarness();
    prisma.user.findUnique.mockResolvedValue({ email: 'alice@example.com' });
    workbench.get.mockResolvedValue({
      counts: { reviews: 2, changes: 0, readyTasks: 3, total: 5 },
      reviews: [
        { kind: 'TASK_ACCEPTANCE', slots: [{ viewerCanDecide: true, decided: true }] },
        { kind: 'PRD_PUBLICATION', slots: [{ viewerCanDecide: false, decided: false }] },
      ],
      changes: [],
      readyTasks: [
        { claimEligibility: { canClaim: true } },
        { claimEligibility: { canClaim: false } },
        { claimEligibility: { canClaim: false } },
      ],
      warnings: ['DEMO：评审数据加载失败'],
    });
    expect(await service.sendEmailDigest(principal)).toMatchObject({
      counts: { reviews: 0, readyTasks: 1, total: 1 },
    });
    expect(email.send).toHaveBeenCalledWith(
      'alice@example.com',
      '[WorkMesh] 待办 1 件',
      expect.stringContaining('本人可领取：1 件'),
    );
    expect(email.send.mock.calls[0]![2]).toContain('以上数量仅包含已取得的个人行动');
    expect(email.send.mock.calls[0]![2]).not.toContain('可开工');
  });

  it('Agent 主体不能调用邮件摘要', async () => {
    const { service } = createHarness();
    const agent = { kind: 'AGENT', userId: 'a-1', scopes: [] } as unknown as Principal;

    await expect(service.sendEmailDigest(agent)).rejects.toMatchObject({
      code: 'HUMAN_SESSION_REQUIRED',
      status: 403,
    });
  });
});
