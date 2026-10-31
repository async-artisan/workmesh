import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectDto, UpdateProjectDto } from './dto';
import { normalizeRepositoryUrl } from './repository-url';
@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}
  list(userId: string) {
    return this.prisma.project.findMany({
      where: { members: { some: { userId } } },
      orderBy: { updatedAt: 'desc' },
    });
  }
  async create(userId: string, dto: CreateProjectDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { organizationId: true },
    });
    if (!user?.organizationId) throw new NotFoundException('用户工作区不存在');
    return this.prisma.project.create({
      data: {
        organizationId: user.organizationId,
        createdById: userId,
        name: dto.name,
        key: dto.key,
        description: dto.description,
        repositoryUrl: normalizeRepositoryUrl(dto.repositoryUrl),
        members: { create: { userId, role: ProjectMemberRole.OWNER } },
      },
    });
  }
  async members(userId: string, projectId: string) {
    await this.membership(userId, projectId);
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map((row) => ({
      id: row.user.id,
      name: row.user.name,
      email: row.user.email,
      role: row.role,
    }));
  }
  private async membership(userId: string, projectId: string, ownerOnly = false) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new NotFoundException('项目不存在');
    if (ownerOnly && member.role === ProjectMemberRole.MEMBER)
      throw new ForbiddenException('无权管理此项目');
    return member;
  }
  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    await this.membership(userId, projectId, true);
    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...dto,
        ...(dto.repositoryUrl !== undefined
          ? { repositoryUrl: normalizeRepositoryUrl(dto.repositoryUrl) }
          : {}),
      },
    });
  }
  async remove(userId: string, projectId: string) {
    const member = await this.membership(userId, projectId, true);
    if (member.role !== ProjectMemberRole.OWNER)
      throw new ForbiddenException('仅项目所有者可删除项目');
    return this.prisma.project.delete({ where: { id: projectId } });
  }
}
