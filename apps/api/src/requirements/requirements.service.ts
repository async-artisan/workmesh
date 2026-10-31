import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRequirementDto, RequirementQueryDto, UpdateRequirementDto } from './dto';
import { RequirementStatus } from '@prisma/client';
import { ProjectAccessService } from '../projects/project-access.service';

const transitions: Record<RequirementStatus, RequirementStatus[]> = {
  DRAFT: ['IN_REVIEW', 'ARCHIVED'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['IN_PROGRESS', 'DRAFT'],
  IN_PROGRESS: ['DONE', 'APPROVED'],
  DONE: ['ARCHIVED'],
  ARCHIVED: [],
};

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}
  async list(userId: string, query: RequirementQueryDto) {
    await this.access.assertMember(userId, query.projectId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { projectId: query.projectId, ...(query.status ? { status: query.status } : {}) };
    const orderBy = { [query.sortBy ?? 'updatedAt']: query.sortOrder ?? 'desc' };
    const [items, total] = await Promise.all([
      this.prisma.requirement.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.requirement.count({ where }),
    ]);
    return { items, total, page, limit };
  }
  async get(userId: string, id: string) {
    const item = await this.prisma.requirement.findUnique({
      where: { id },
      include: { prds: true },
    });
    if (!item) throw new NotFoundException('需求不存在');
    await this.access.assertMember(userId, item.projectId);
    return item;
  }
  async create(userId: string, dto: CreateRequirementDto) {
    await this.access.assertMember(userId, dto.projectId);
    return this.prisma.requirement.create({
      data: {
        projectId: dto.projectId,
        createdById: userId,
        title: dto.title,
        description: dto.description ?? '',
        priority: dto.priority,
        userStories: dto.userStories ?? [],
        acceptanceCriteria: dto.acceptanceCriteria ?? [],
      },
    });
  }
  async update(userId: string, id: string, dto: UpdateRequirementDto) {
    const current = await this.get(userId, id);
    if (
      dto.status &&
      dto.status !== current.status &&
      !transitions[current.status].includes(dto.status)
    )
      throw new BadRequestException(`不允许从 ${current.status} 流转到 ${dto.status}`);
    return this.prisma.requirement.update({ where: { id }, data: dto });
  }
  async remove(userId: string, id: string) {
    await this.get(userId, id);
    return this.prisma.requirement.delete({ where: { id } });
  }
}
