import { Injectable } from '@nestjs/common';
import type { Principal } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** 最近活动流：只读审计事件，按当前用户是成员的项目过滤。 */
@Injectable()
export class V1ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(principal: Principal, limit?: number) {
    const take = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const projects = await this.prisma.project.findMany({
      where: { members: { some: { userId: principal.userId, revokedAt: null } } },
      select: { id: true, key: true, name: true },
    });
    if (projects.length === 0) return { items: [] };

    const rows = await this.prisma.auditEvent.findMany({
      where: { projectId: { in: projects.map((project) => project.id) } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        projectId: true,
        action: true,
        targetType: true,
        targetId: true,
        targetVersion: true,
        outcome: true,
        details: true,
        createdAt: true,
        actorStamp: { select: { user: { select: { id: true, email: true } } } },
      },
    });

    const projectById = new Map(projects.map((project) => [project.id, project]));
    return {
      items: rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        projectName: row.projectId ? (projectById.get(row.projectId)?.name ?? null) : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        targetVersion: row.targetVersion,
        outcome: row.outcome,
        details: row.details,
        createdAt: row.createdAt,
        actor: row.actorStamp?.user ?? null,
      })),
    };
  }
}
