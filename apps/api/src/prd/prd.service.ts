import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';

@Injectable()
export class PrdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}
  async create(
    userId: string,
    requirementId: string,
    options: { title?: string; content: string; templateId?: string },
  ) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { prds: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!requirement) throw new NotFoundException('需求不存在');
    await this.access.assertMember(userId, requirement.projectId);
    const content = options.content?.trim();
    if (!content) throw new BadRequestException('PRD 正文不能为空');
    if (options.templateId) {
      const template = await this.prisma.prdTemplate.findUnique({
        where: { id: options.templateId },
        select: { id: true, projectId: true },
      });
      if (!template) throw new NotFoundException('模板不存在');
      if (template.projectId !== requirement.projectId)
        throw new BadRequestException('模板不属于当前项目');
    }
    const version = (requirement.prds[0]?.version ?? 0) + 1;
    return this.prisma.prd.create({
      data: {
        requirementId: requirement.id,
        version,
        title: options.title?.trim() || requirement.title,
        content,
        templateId: options.templateId,
        createdById: userId,
      },
    });
  }
  async list(userId: string, requirementId: string) {
    await this.access.assertRequirementMember(userId, requirementId);
    return this.prisma.prd.findMany({ where: { requirementId }, orderBy: { version: 'desc' } });
  }
}
