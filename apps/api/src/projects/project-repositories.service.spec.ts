import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectRepositoryDto } from './dto';
import { ProjectsService } from './projects.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-02T12:00:00.000Z');

type Row = {
  id: string;
  projectId: string;
  adapter: string;
  externalId: string;
  owner: string;
  name: string;
  defaultBranch: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

function dto(overrides: Partial<CreateProjectRepositoryDto> = {}): CreateProjectRepositoryDto {
  return {
    adapter: 'github',
    externalId: '123456789',
    owner: 'async-artisan',
    name: 'workmesh',
    defaultBranch: 'main',
    ...overrides,
  };
}

function build(role: 'OWNER' | 'ADMIN' | 'MEMBER' | null = 'OWNER') {
  const rows: Row[] = [];
  const prisma = {
    projectMember: {
      findUnique: async () => (role === null ? null : { role, revokedAt: null }),
    },
    projectRepository: {
      findMany: async ({ where }: { where: { projectId: string } }) =>
        rows.filter((row) => row.projectId === where.projectId && !row.archivedAt),
      findFirst: async ({
        where,
      }: {
        where: {
          projectId: string;
          id?: string;
          adapter?: string;
          externalId?: string;
        };
      }) =>
        rows.find(
          (row) =>
            row.projectId === where.projectId &&
            (where.id === undefined || row.id === where.id) &&
            (where.adapter === undefined || row.adapter === where.adapter) &&
            (where.externalId === undefined || row.externalId === where.externalId),
        ) ?? null,
      create: async ({ data }: { data: Omit<Row, 'id' | 'archivedAt'> }) => {
        const row: Row = { id: `repo-${rows.length + 1}`, archivedAt: null, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error('missing row');
        Object.assign(row, data);
        return row;
      },
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

describe('项目代码仓库登记', () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it('列表只返回未归档仓库', async () => {
    await ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW);
    const archived = await ctx.service.createRepository(
      'owner',
      PROJECT_ID,
      dto({ externalId: '987654321', name: 'legacy' }),
      NOW,
    );
    await ctx.service.archiveRepository('owner', PROJECT_ID, archived.id, NOW);

    const rows = await ctx.service.repositories('member', PROJECT_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: '123456789', name: 'workmesh' });
  });

  it('普通成员不能登记仓库', async () => {
    ctx = build('MEMBER');
    await expect(
      ctx.service.createRepository('member', PROJECT_ID, dto(), NOW),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('同一 externalId 重复登记返回 409', async () => {
    await ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW);
    await expect(
      ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('已归档仓库重新登记即恢复并更新展示信息', async () => {
    const created = await ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW);
    await ctx.service.archiveRepository('owner', PROJECT_ID, created.id, NOW);

    const restored = await ctx.service.createRepository(
      'owner',
      PROJECT_ID,
      dto({ owner: 'new-owner', name: 'renamed' }),
      NOW,
    );
    expect(restored.archivedAt).toBeNull();
    expect(restored).toMatchObject({ owner: 'new-owner', name: 'renamed' });
  });

  it('归档设置 archivedAt，重复归档保持幂等', async () => {
    const created = await ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW);
    const archived = await ctx.service.archiveRepository('owner', PROJECT_ID, created.id, NOW);
    expect(archived.archivedAt).toEqual(NOW);

    const again = await ctx.service.archiveRepository(
      'owner',
      PROJECT_ID,
      created.id,
      new Date('2026-11-03T00:00:00.000Z'),
    );
    expect(again.archivedAt).toEqual(NOW);
  });

  it('不能归档其他项目的仓库', async () => {
    const created = await ctx.service.createRepository('owner', PROJECT_ID, dto(), NOW);
    await expect(
      ctx.service.archiveRepository('owner', OTHER_PROJECT_ID, created.id, NOW),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
  });
});
