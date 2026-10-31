import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';

@Injectable()
export class DependencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}
  async list(userId: string, requirementId: string) {
    await this.access.assertRequirementMember(userId, requirementId);
    return this.prisma.requirementDependency.findMany({
      where: { OR: [{ fromId: requirementId }, { toId: requirementId }] },
      include: { from: true, to: true },
    });
  }
  async create(userId: string, fromId: string, toId: string, type = 'depends_on') {
    if (fromId === toId) throw new BadRequestException('需求不能依赖自身');
    const [from, to] = await Promise.all([
      this.prisma.requirement.findUnique({ where: { id: fromId }, select: { projectId: true } }),
      this.prisma.requirement.findUnique({ where: { id: toId }, select: { projectId: true } }),
    ]);
    if (!from || !to || from.projectId !== to.projectId)
      throw new NotFoundException('需求不存在或不属于同一项目');
    await this.access.assertMember(userId, from.projectId);
    if (await this.reaches(toId, fromId, new Set()))
      throw new BadRequestException('创建依赖会形成循环');
    return this.prisma.requirementDependency.upsert({
      where: { fromId_toId_type: { fromId, toId, type } },
      create: { fromId, toId, type },
      update: {},
    });
  }
  async remove(userId: string, id: string) {
    const dependency = await this.prisma.requirementDependency.findUnique({
      where: { id },
      select: { fromId: true },
    });
    if (!dependency) throw new NotFoundException('依赖不存在');
    await this.access.assertRequirementMember(userId, dependency.fromId);
    return this.prisma.requirementDependency.delete({ where: { id } });
  }
  private async reaches(current: string, target: string, seen: Set<string>): Promise<boolean> {
    if (current === target) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    const next = await this.prisma.requirementDependency.findMany({
      where: { fromId: current },
      select: { toId: true },
    });
    for (const edge of next) if (await this.reaches(edge.toId, target, seen)) return true;
    return false;
  }
}
