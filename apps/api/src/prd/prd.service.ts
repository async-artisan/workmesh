import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { ProjectAccessService } from '../projects/project-access.service';
import { KnowledgeService } from '../knowledge/knowledge.service';

@Injectable()
export class PrdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly access: ProjectAccessService,
    private readonly knowledge: KnowledgeService,
  ) {}
  async generate(
    userId: string,
    requirementId: string,
    options: { templateId?: string; knowledgeBaseId?: string } = {},
  ) {
    const context = await this.prepare(userId, requirementId, options);
    const content = await this.ai.complete(context.messages);
    return this.save(context, userId, content);
  }

  async *generateStream(
    userId: string,
    requirementId: string,
    options: { templateId?: string; knowledgeBaseId?: string } = {},
  ) {
    const context = await this.prepare(userId, requirementId, options);
    let content = '';
    for await (const chunk of this.ai.stream(context.messages)) {
      content += chunk;
      yield { content: chunk, done: false };
    }
    const prd = await this.save(context, userId, content);
    yield { content: '', done: true, prd };
  }

  private async prepare(
    userId: string,
    requirementId: string,
    options: { templateId?: string; knowledgeBaseId?: string },
  ) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      include: { prds: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!requirement) throw new NotFoundException('需求不存在');
    await this.access.assertMember(userId, requirement.projectId);
    const template = options.templateId
      ? await this.prisma.prdTemplate.findUnique({
          where: { id: options.templateId },
          select: { id: true, projectId: true, content: true },
        })
      : await this.prisma.prdTemplate.findFirst({
          where: { projectId: requirement.projectId, isDefault: true },
          select: { id: true, projectId: true, content: true },
        });
    if (template && template.projectId !== requirement.projectId)
      throw new BadRequestException('模板不属于当前项目');
    if (options.templateId && !template) throw new NotFoundException('模板不存在');
    if (options.knowledgeBaseId) {
      const base = await this.prisma.knowledgeBase.findUnique({
        where: { id: options.knowledgeBaseId },
        select: { projectId: true },
      });
      if (!base) throw new NotFoundException('知识库不存在');
      if (base.projectId !== requirement.projectId)
        throw new BadRequestException('知识库不属于当前项目');
    }
    const context = options.knowledgeBaseId
      ? await this.knowledge.buildContext(userId, options.knowledgeBaseId, requirement.description)
      : '';
    const prompt = `${context ? `相关知识库：\n${context}\n\n` : ''}${template ? `模板：\n${template.content}\n\n` : ''}标题：${requirement.title}\n描述：${requirement.description}\n用户故事：${JSON.stringify(requirement.userStories)}\n验收标准：${JSON.stringify(requirement.acceptanceCriteria)}`;
    return {
      requirement,
      template,
      messages: [
        { role: 'system' as const, content: '你是产品经理，输出结构化 Markdown PRD。' },
        { role: 'user' as const, content: prompt },
      ],
    };
  }

  private async save(
    context: Awaited<ReturnType<PrdService['prepare']>>,
    userId: string,
    content: string,
  ) {
    const version = (context.requirement.prds[0]?.version ?? 0) + 1;
    return this.prisma.prd.create({
      data: {
        requirementId: context.requirement.id,
        version,
        title: context.requirement.title,
        content,
        templateId: context.template?.id,
        createdById: userId,
      },
    });
  }
  async list(userId: string, requirementId: string) {
    await this.access.assertRequirementMember(userId, requirementId);
    return this.prisma.prd.findMany({ where: { requirementId }, orderBy: { version: 'desc' } });
  }
}
