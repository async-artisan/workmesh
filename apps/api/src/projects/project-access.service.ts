import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertMember(userId: string, projectId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new NotFoundException('项目不存在');
    return member;
  }

  async assertRequirementMember(userId: string, requirementId: string) {
    const item = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { projectId: true },
    });
    if (!item) throw new NotFoundException('需求不存在');
    return this.assertMember(userId, item.projectId);
  }

  async assertKnowledgeBaseMember(userId: string, knowledgeBaseId: string) {
    const item = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { projectId: true },
    });
    if (!item) throw new NotFoundException('知识库不存在');
    return this.assertMember(userId, item.projectId);
  }
}
