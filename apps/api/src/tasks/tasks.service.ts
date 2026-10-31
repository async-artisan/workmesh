import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleType, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectAccessService } from '../projects/project-access.service';

// agent 提交的终态一律拒绝：AI 生产，人关门
const AGENT_FORBIDDEN_STATUS: TaskStatus[] = [TaskStatus.DONE];

export interface ContextPackage {
  code: string;
  status: string;
  source: {
    title: string;
    description: string;
    prdVersion: number | null;
    acceptance: string[];
    authority: 'product';
  };
  artifacts: Array<{
    kind: 'PRD' | 'SPEC';
    title: string;
    status: string | null;
    updatedAt: string | null;
  }>;
  tasks: Array<{
    code: string;
    title: string;
    role: RoleType;
    status: TaskStatus;
    blockedBy: string[];
  }>;
  localKnowledge: Array<{ externalId: string; title: string; path: string }>;
  evidence: Array<{ type: string; ref: string; task?: string }>;
  rules: {
    onConflict: string;
    mustIncludeAnchor: string;
    cannotSetDone: boolean;
  };
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(userId: string, requirementId: string) {
    const requirement = await this.requirementOf(userId, requirementId);
    return this.prisma.task.findMany({
      where: { requirementId: requirement.id },
      orderBy: { seq: 'asc' },
    });
  }

  async create(
    userId: string,
    requirementId: string,
    data: {
      title: string;
      role: RoleType;
      acceptance?: string[];
      assigneeType?: string;
      assigneeId?: string;
      blockedBy?: string[];
    },
  ) {
    const requirement = await this.requirementOf(userId, requirementId);
    const last = await this.prisma.task.findFirst({
      where: { requirementId: requirement.id },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    const created = await this.prisma.task.create({
      data: {
        requirementId: requirement.id,
        seq,
        code: `${requirement.code}-T${String(seq).padStart(2, '0')}`,
        title: data.title,
        role: data.role,
        acceptance: data.acceptance ?? [],
        assigneeType: data.assigneeType ?? 'HUMAN',
        assigneeId: data.assigneeId,
      },
    });
    if (data.blockedBy?.length) await this.linkDependencies(created.id, data.blockedBy);
    return created;
  }

  /**
   * 本角色的可执行队列：状态为 OPEN，且所有前置依赖任务都已 DONE。
   * 这是各角色 agent 开工时的第一个动作——平台告诉它该干什么，不需要人派活。
   */
  async ready(userId: string, role: RoleType, projectId?: string) {
    const open = await this.prisma.task.findMany({
      where: {
        role,
        status: TaskStatus.OPEN,
        ...(projectId ? { requirement: { projectId } } : {}),
      },
      include: {
        requirement: { select: { id: true, code: true, title: true, projectId: true } },
        blockedBy: { select: { fromId: true, from: { select: { status: true } } } },
      },
      orderBy: { updatedAt: 'asc' },
    });
    const accessible = await this.filterAccessible(userId, open);
    return accessible
      .filter((task) => task.blockedBy.every((edge) => edge.from.status === TaskStatus.DONE))
      .map(({ blockedBy, requirement, ...task }) => ({
        ...task,
        requirementCode: requirement.code,
        requirementTitle: requirement.title,
        projectId: requirement.projectId,
        blockedBy: blockedBy.map((edge) => edge.fromId),
      }));
  }

  /**
   * 装配上下文包。本地知识只给指针，正文由各角色自己的 agent 在本地读取。
   */
  async context(userId: string, code: string): Promise<ContextPackage> {
    const requirement = await this.prisma.requirement.findFirst({
      where: { code },
      include: {
        prds: { orderBy: { version: 'desc' }, take: 1, select: { version: true } },
        tasks: { orderBy: { seq: 'asc' } },
      },
    });
    if (!requirement) throw new NotFoundException('需求不存在');
    await this.access.assertMember(userId, requirement.projectId);

    const prdIds = await this.prisma.prd.findMany({
      where: { requirementId: requirement.id },
      select: { id: true },
    });
    const [specRows, dependencies] = await Promise.all([
      prdIds.length
        ? this.prisma.technicalSpec.findMany({
            where: { prdId: { in: prdIds.map((prd) => prd.id) } },
            select: { title: true, status: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
          })
        : Promise.resolve([]),
      this.prisma.taskDependency.findMany({
        where: { toId: { in: requirement.tasks.map((task) => task.id) } },
        select: { toId: true, from: { select: { code: true } } },
      }),
    ]);

    const blockedBy = new Map<string, string[]>();
    for (const edge of dependencies) {
      const list = blockedBy.get(edge.toId) ?? [];
      list.push(edge.from.code);
      blockedBy.set(edge.toId, list);
    }
    const tasks = requirement.tasks.map((task) => ({
      code: task.code,
      title: task.title,
      role: task.role,
      status: task.status,
      blockedBy: blockedBy.get(task.id) ?? [],
    }));

    return {
      code: requirement.code,
      status: requirement.status,
      source: {
        title: requirement.title,
        description: requirement.description,
        prdVersion: requirement.prds[0]?.version ?? null,
        acceptance: (requirement.acceptanceCriteria as string[] | null) ?? [],
        authority: 'product',
      },
      artifacts: [
        ...(requirement.prds[0]
          ? [
              {
                kind: 'PRD' as const,
                title: requirement.title,
                status: null,
                updatedAt: null,
              },
            ]
          : []),
        ...specRows.map((spec) => ({
          kind: 'SPEC' as const,
          title: spec.title,
          status: spec.status,
          updatedAt: spec.updatedAt.toISOString(),
        })),
      ],
      tasks,
      localKnowledge: [],
      evidence: [],
      rules: {
        onConflict: 'product source wins',
        mustIncludeAnchor: requirement.code,
        cannotSetDone: true,
      },
    };
  }

  async updateStatus(
    userId: string,
    taskId: string,
    status: TaskStatus,
    actor: { type: string } = { type: 'HUMAN' },
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { requirement: { select: { projectId: true } } },
    });
    if (!task) throw new NotFoundException('任务不存在');
    await this.access.assertMember(userId, task.requirement.projectId);
    if (actor.type === 'AGENT' && AGENT_FORBIDDEN_STATUS.includes(status))
      throw new BadRequestException('agent 不能将任务直接置为 DONE，只能提交为 REVIEW_PENDING');
    return this.prisma.task.update({ where: { id: taskId }, data: { status } });
  }

  private async linkDependencies(taskId: string, blockedBy: string[]) {
    const rows = await this.prisma.task.findMany({
      where: { id: { in: blockedBy } },
      select: { id: true, requirementId: true },
    });
    const self = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { requirementId: true },
    });
    if (!self) throw new NotFoundException('任务不存在');
    if (rows.some((row) => row.requirementId !== self.requirementId))
      throw new BadRequestException('依赖任务必须属于同一需求');
    await this.prisma.taskDependency.createMany({
      data: rows.map((row) => ({ fromId: row.id, toId: taskId, type: 'blocks' })),
      skipDuplicates: true,
    });
  }

  private async requirementOf(userId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: { id: true, code: true, projectId: true },
    });
    if (!requirement) throw new NotFoundException('需求不存在');
    await this.access.assertMember(userId, requirement.projectId);
    return requirement;
  }

  private async filterAccessible<T extends { requirement: { projectId: string } }>(
    userId: string,
    tasks: T[],
  ) {
    const projectIds = [...new Set(tasks.map((task) => task.requirement.projectId))];
    const allowed = new Set<string>();
    for (const projectId of projectIds) {
      try {
        await this.access.assertMember(userId, projectId);
        allowed.add(projectId);
      } catch {
        // 非成员项目的任务直接过滤掉，不暴露存在性
      }
    }
    return tasks.filter((task) => allowed.has(task.requirement.projectId));
  }
}
