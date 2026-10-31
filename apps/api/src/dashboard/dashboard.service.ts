import { Injectable } from '@nestjs/common';
import { RequirementStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, name: true },
    });
    const projectIds = projects.map((project) => project.id);
    const [requirements, prdCount, recent] = await Promise.all([
      this.prisma.requirement.groupBy({
        by: ['status'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.prd.count({ where: { requirement: { projectId: { in: projectIds } } } }),
      this.prisma.requirement.findMany({
        where: { projectId: { in: projectIds } },
        select: { id: true, title: true, status: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      }),
    ]);
    const statusCounts = Object.fromEntries(
      Object.values(RequirementStatus).map((status) => [
        status,
        requirements.find((item) => item.status === status)?._count._all ?? 0,
      ]),
    );
    const total = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
    const completed = statusCounts.RELEASED + statusCounts.ARCHIVED;
    return {
      projects,
      projectCount: projects.length,
      requirementCount: total,
      activeRequirementCount: total - completed,
      completedRequirementCount: completed,
      completionRate: total ? Math.round((completed / total) * 100) : 0,
      prdCount,
      statusCounts,
      recentRequirements: recent,
    };
  }
}
