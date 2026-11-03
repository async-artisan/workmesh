import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvitationsService } from './invitations.service';

const principal = {
  kind: 'HUMAN',
  userId: 'u-1',
  sessionId: 's-1',
  authVersion: 1,
} as never;

const context = {
  idempotencyKey: 'key-1',
  method: 'POST',
  route: '/api/v1/projects/p1/invitations',
  body: {},
  operationId: 'op-1',
  now: new Date('2026-11-03T00:00:00.000Z'),
  webSessionId: 's-1',
  userAuthVersion: 1,
};

function invitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    projectId: 'p1',
    email: null,
    roleIds: ['r-1'],
    expiresAt: new Date('2026-11-06T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-11-03T00:00:00.000Z'),
    project: { id: 'p1', key: 'YFF', name: '易番番', archivedAt: null },
    ...overrides,
  };
}

function harness() {
  const prisma = {
    projectMember: { findUnique: vi.fn() },
    project: { findUnique: vi.fn() },
    projectRole: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    projectInvitation: { findUnique: vi.fn(), updateMany: vi.fn() },
  };
  const tickets = { findTicket: vi.fn() };
  const operations = { findOperation: vi.fn() };
  const service = new InvitationsService(prisma as never, tickets as never, operations as never);
  return { service, prisma, tickets, operations };
}

describe('InvitationsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('创建邀请：非管理员按项目不存在/无权限拒绝', async () => {
    const { service, prisma } = harness();
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'MEMBER', revokedAt: null });

    await expect(
      service.create(
        principal,
        'p1',
        { roleKeys: ['backend'], expectedVersion: 1, confirmation: {} as never },
        context,
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('创建邀请：项目版本过期返回 409', async () => {
    const { service, prisma } = harness();
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'OWNER', revokedAt: null });
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', version: 5, archivedAt: null });

    await expect(
      service.create(
        principal,
        'p1',
        { roleKeys: ['backend'], expectedVersion: 4, confirmation: {} as never },
        context,
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
  });

  it('创建邀请：角色 key 不存在时 422', async () => {
    const { service, prisma } = harness();
    prisma.projectMember.findUnique.mockResolvedValue({ role: 'OWNER', revokedAt: null });
    prisma.project.findUnique.mockResolvedValue({ id: 'p1', version: 1, archivedAt: null });
    prisma.projectRole.findMany.mockResolvedValue([{ id: 'r-1', key: 'backend' }]);

    await expect(
      service.create(
        principal,
        'p1',
        { roleKeys: ['backend', 'ghost'], expectedVersion: 1, confirmation: {} as never },
        context,
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('匿名接受：过期邀请直接拒绝', async () => {
    const { service, prisma } = harness();
    prisma.projectInvitation.findUnique.mockResolvedValue(
      invitationRow({ expiresAt: new Date('2026-11-01T00:00:00.000Z') }),
    );

    await expect(service.prepareAnonymousAccept('wmi_x', 'a@b.com')).rejects.toThrow(
      /INVITATION_EXPIRED/,
    );
  });

  it('匿名接受：邮箱已注册返回 409', async () => {
    const { service, prisma } = harness();
    prisma.projectInvitation.findUnique.mockResolvedValue(invitationRow());
    prisma.user.findUnique.mockResolvedValue({ id: 'u-9' });

    await expect(service.prepareAnonymousAccept('wmi_x', 'Old@B.com')).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'old@b.com' },
      select: { id: true },
    });
  });

  it('匿名接受：邀请绑定邮箱时忽略访客输入', async () => {
    const { service, prisma } = harness();
    prisma.projectInvitation.findUnique.mockResolvedValue(invitationRow({ email: 'bound@b.com' }));
    prisma.user.findUnique.mockResolvedValue(null);

    const prepared = await service.prepareAnonymousAccept('wmi_x', 'other@b.com');
    expect(prepared.email).toBe('bound@b.com');
  });

  it('接受邀请：已接受的邀请不能重复使用', async () => {
    const { service, prisma } = harness();
    prisma.projectInvitation.findUnique.mockResolvedValue(
      invitationRow({ acceptedAt: new Date('2026-11-03T00:00:00.000Z') }),
    );

    await expect(
      service.join('wmi_x', { userId: 'u-2', webSessionId: 's-2', now: context.now }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
  });

  it('接受邀请：绑定邮箱与登录账号不一致时 403', async () => {
    const { service, prisma } = harness();
    prisma.projectInvitation.findUnique.mockResolvedValue(invitationRow({ email: 'bound@b.com' }));
    prisma.user.findUnique.mockResolvedValue({
      id: 'u-2',
      email: 'other@b.com',
      isActive: true,
    });

    await expect(
      service.join('wmi_x', { userId: 'u-2', webSessionId: 's-2', now: context.now }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
