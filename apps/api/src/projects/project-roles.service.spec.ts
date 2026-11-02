import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { ProjectsService } from './projects.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';

type RoleRow = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  isActive: boolean;
  version: number;
  createdAt: Date;
};

function build(role: 'OWNER' | 'ADMIN' | 'MEMBER' | null = 'OWNER', activeAssignments = 0) {
  const rows: RoleRow[] = [];
  const prisma = {
    projectMember: {
      findUnique: async () => (role === null ? null : { role, revokedAt: null }),
    },
    projectRole: {
      findUnique: async ({
        where,
      }: {
        where: { projectId_key: { projectId: string; key: string } };
      }) =>
        rows.find(
          (row) =>
            row.projectId === where.projectId_key.projectId && row.key === where.projectId_key.key,
        ) ?? null,
      findFirst: async ({ where }: { where: { id: string; projectId: string } }) =>
        rows.find((row) => row.id === where.id && row.projectId === where.projectId) ?? null,
      create: async ({
        data,
      }: {
        data: Omit<RoleRow, 'id' | 'isActive' | 'version' | 'createdAt'>;
      }) => {
        const row: RoleRow = {
          id: `role-${rows.length + 1}`,
          isActive: true,
          version: 1,
          createdAt: new Date('2026-11-03T00:00:00.000Z'),
          ...data,
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing role');
        if (data.version && typeof data.version === 'object') {
          row.version += 1;
          delete data.version;
        }
        Object.assign(row, data);
        return row;
      },
    },
    projectRoleAssignment: {
      count: async () => activeAssignments,
    },
  };
  const service = new ProjectsService(
    prisma as unknown as PrismaService,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, rows };
}

describe('自定义业务角色', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('可以新增自定义角色', async () => {
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    expect(created).toMatchObject({ key: 'data', title: '数据', isActive: true });
  });

  it('普通成员不能新增角色', async () => {
    ctx = build('MEMBER');
    await expect(
      ctx.service.createRole('member', PROJECT_ID, { key: 'data', title: '数据' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('同名 key 活跃角色返回 409', async () => {
    await ctx.service.createRole('owner', PROJECT_ID, { key: 'data', title: '数据' });
    await expect(
      ctx.service.createRole('owner', PROJECT_ID, { key: 'data', title: '数据' }),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('停用后重新新增即恢复并更新标题', async () => {
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    const baseVersion = created.version;
    await ctx.service.deactivateRole('owner', PROJECT_ID, created.id);

    const restored = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据平台',
    });
    expect(restored).toMatchObject({ key: 'data', title: '数据平台', isActive: true });
    expect(restored.version).toBe(baseVersion + 2);
  });

  it('重命名按 expectedVersion 做并发校验', async () => {
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    const baseVersion = created.version;

    await expect(
      ctx.service.updateRole('owner', PROJECT_ID, created.id, {
        title: '数据平台',
        expectedVersion: baseVersion + 1,
      }),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });

    const updated = await ctx.service.updateRole('owner', PROJECT_ID, created.id, {
      title: '数据平台',
      expectedVersion: baseVersion,
    });
    expect(updated).toMatchObject({ title: '数据平台', version: baseVersion + 1 });
  });

  it('有在任成员时不能停用', async () => {
    ctx = build('OWNER', 2);
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    await expect(ctx.service.deactivateRole('owner', PROJECT_ID, created.id)).rejects.toMatchObject(
      { code: 'RESOURCE_CONFLICT', status: 409 },
    );
  });

  it('没有在任成员时停用成功且幂等', async () => {
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    const deactivated = await ctx.service.deactivateRole('owner', PROJECT_ID, created.id);
    expect(deactivated.isActive).toBe(false);

    const again = await ctx.service.deactivateRole('owner', PROJECT_ID, created.id);
    expect(again.isActive).toBe(false);
    expect(again.version).toBe(deactivated.version);
  });

  it('不能操作其他项目的角色', async () => {
    const created = await ctx.service.createRole('owner', PROJECT_ID, {
      key: 'data',
      title: '数据',
    });
    await expect(
      ctx.service.deactivateRole('owner', OTHER_PROJECT_ID, created.id),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });
});
