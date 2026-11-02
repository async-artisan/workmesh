import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  principalScopeKey,
  projectScopeKey,
  type ActionBinding,
  type Confirmation,
} from '@workmesh/shared';
import type { V1Principal } from '../auth/v1-policy';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectDto, UpdateProjectDto } from './dto';
import {
  PROJECT_ROLE_REPOSITORY,
  type ProjectRoleChangeInput,
  type ProjectRoleMutationView,
  type ProjectRoleRepository,
} from './project-role.repository';

/** 预置六个业务角色 key 是初始数据，不是运行时全局枚举。 */
export const DEFAULT_PROJECT_ROLES: ReadonlyArray<{ key: string; title: string }> = [
  { key: 'product', title: '产品' },
  { key: 'ui', title: 'UI 设计' },
  { key: 'frontend', title: '前端' },
  { key: 'backend', title: '后端' },
  { key: 'qa', title: '测试' },
  { key: 'ops', title: '运维' },
];

export const DEFAULT_KNOWLEDGE_BASE_KEY = 'product-knowledge';

export const PROJECT_ROLE_ASSIGN = 'PROJECT_ROLE_ASSIGN';
export const PROJECT_ROLE_UNASSIGN = 'PROJECT_ROLE_UNASSIGN';
export const PROJECT_MEMBER_TARGET = 'PROJECT_MEMBER';

export type ProjectRoleChangeContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  operationId: string;
  now: Date;
  webSessionId: string;
  userAuthVersion: number;
};

export type ProjectRoleChangeRequest = {
  expectedVersion: number;
  reason: string;
  confirmation: Confirmation;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function resourceNotFound(message: string, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, message, details, 404);
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PROJECT_ROLE_REPOSITORY) private readonly roleRepository: ProjectRoleRepository,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { archivedAt: null, members: { some: { userId, revokedAt: null } } },
      orderBy: { updatedAt: 'desc' },
    });
    if (projects.length === 0) return [];
    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        projectId: { in: projects.map((project) => project.id) },
        key: DEFAULT_KNOWLEDGE_BASE_KEY,
        archivedAt: null,
      },
      select: { id: true, projectId: true },
    });
    const defaultKnowledgeBaseIds = new Map(
      knowledgeBases.map((item) => [item.projectId, item.id]),
    );
    return projects.map((project) => ({
      ...project,
      defaultKnowledgeBaseId: defaultKnowledgeBaseIds.get(project.id) ?? null,
    }));
  }

  /**
   * 项目初始化是一个事务：项目、六个预置角色、OWNER membership、创建者显式内容 grant、默认 KB。
   * 创建者只有在被显式授予时才持有业务角色，不因 OWNER 自动获得。
   */
  async create(userId: string, dto: CreateProjectDto) {
    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          key: dto.key,
          description: dto.description ?? null,
          createdById: userId,
        },
      });
      const roles = await Promise.all(
        DEFAULT_PROJECT_ROLES.map((role) =>
          tx.projectRole.create({
            data: { projectId: project.id, key: role.key, title: role.title },
          }),
        ),
      );
      await tx.projectMember.create({
        data: { projectId: project.id, userId, role: 'OWNER' },
      });
      await tx.projectRoleAssignment.createMany({
        data: roles.map((role) => ({ projectId: project.id, userId, roleId: role.id })),
      });
      const knowledgeBase = await tx.knowledgeBase.create({
        data: {
          projectId: project.id,
          key: DEFAULT_KNOWLEDGE_BASE_KEY,
          name: '产品知识库',
          visibility: 'PROJECT',
          publicationApproverUserId: userId,
        },
      });
      await tx.knowledgeBaseGrant.create({
        data: {
          projectId: project.id,
          knowledgeBaseId: knowledgeBase.id,
          subjectKind: 'USER',
          subjectUserId: userId,
          permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
        },
      });
      return { ...project, defaultKnowledgeBaseId: knowledgeBase.id };
    });
  }

  async members(userId: string, projectId: string) {
    await this.membership(userId, projectId);
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId, revokedAt: null },
      include: { user: { select: { id: true, email: true } } },
      orderBy: { grantedAt: 'asc' },
    });
    return rows.map((row) => ({
      id: row.user.id,
      name: row.user.email,
      email: row.user.email,
      role: row.role,
      version: row.version,
    }));
  }

  /**
   * OWNER/ADMIN 按邮箱把已注册用户加入项目。不发送邀请；邮箱必须对应现有账号。
   * 已经是活动成员时幂等返回现有成员；曾被撤销的成员重新激活为 MEMBER。
   */
  async addMemberByEmail(userId: string, projectId: string, email: string) {
    const member = await this.membership(userId, projectId, true);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN')
      throw new NotFoundException('项目不存在');

    const normalized = email.trim().toLowerCase();
    const target = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true },
    });
    if (!target) throw resourceNotFound('USER_NOT_FOUND', { email: normalized });

    const existing = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: target.id } },
    });
    if (existing && !existing.revokedAt) {
      return {
        id: target.id,
        name: target.email,
        email: target.email,
        role: existing.role,
        version: existing.version,
      };
    }

    const saved = existing
      ? await this.prisma.projectMember.update({
          where: { projectId_userId: { projectId, userId: target.id } },
          data: { role: 'MEMBER', revokedAt: null, version: { increment: 1 } },
        })
      : await this.prisma.projectMember.create({
          data: { projectId, userId: target.id, role: 'MEMBER' },
        });
    return {
      id: target.id,
      name: target.email,
      email: target.email,
      role: saved.role,
      version: saved.version,
    };
  }

  async roles(userId: string, projectId: string) {
    await this.membership(userId, projectId);
    return this.prisma.projectRole.findMany({
      where: { projectId },
      orderBy: { key: 'asc' },
    });
  }

  private async membership(userId: string, projectId: string, manageOnly = false) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member || member.revokedAt) throw new NotFoundException('项目不存在');
    if (manageOnly && member.role === 'MEMBER') throw new NotFoundException('项目不存在');
    return member;
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const member = await this.membership(userId, projectId, true);
    if (member.role !== 'OWNER') throw new NotFoundException('项目不存在');
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        version: { increment: 1 },
      },
    });
    return { ...project, defaultKnowledgeBaseId: await this.defaultKnowledgeBaseId(projectId) };
  }

  async archive(userId: string, projectId: string, now = new Date()) {
    const member = await this.membership(userId, projectId, true);
    if (member.role !== 'OWNER') throw new NotFoundException('项目不存在');
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: now, version: { increment: 1 } },
    });
    return { ...project, defaultKnowledgeBaseId: await this.defaultKnowledgeBaseId(projectId) };
  }

  private async defaultKnowledgeBaseId(projectId: string): Promise<string | null> {
    const knowledgeBase = await this.prisma.knowledgeBase.findFirst({
      where: { projectId, key: DEFAULT_KNOWLEDGE_BASE_KEY, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return knowledgeBase?.id ?? null;
  }

  async assignRole(
    principal: V1Principal,
    projectId: string,
    userId: string,
    roleId: string,
    input: ProjectRoleChangeRequest,
    context: ProjectRoleChangeContext,
  ): Promise<ProjectRoleMutationView> {
    await this.requireHumanSession(principal, context);
    await this.requireManager(projectId, principal.userId);
    const replay = await this.resolveReplay(principal, projectId, context);
    if (replay.result) return replay.result;

    await this.requireTargetMember(projectId, userId, input.expectedVersion);
    await this.requireRole(projectId, roleId, true);
    const ticket = await this.requireTicket(input.confirmation, principal, context, {
      action: PROJECT_ROLE_ASSIGN,
      projectId,
      targetType: PROJECT_MEMBER_TARGET,
      targetId: userId,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: { userId, roleId, reason: input.reason },
    });
    return this.roleRepository.assign(
      this.mutationInput(
        principal,
        projectId,
        userId,
        roleId,
        input,
        context,
        ticket.id,
        ticket.secretHash,
        replay.requestDigest,
      ),
    );
  }

  async revokeRole(
    principal: V1Principal,
    projectId: string,
    userId: string,
    roleId: string,
    input: ProjectRoleChangeRequest,
    context: ProjectRoleChangeContext,
  ): Promise<ProjectRoleMutationView> {
    await this.requireHumanSession(principal, context);
    await this.requireManager(projectId, principal.userId);
    const replay = await this.resolveReplay(principal, projectId, context);
    if (replay.result) return replay.result;

    await this.requireTargetMember(projectId, userId, input.expectedVersion);
    await this.requireRole(projectId, roleId, false);
    await this.requireAssignment(projectId, userId, roleId);
    const ticket = await this.requireTicket(input.confirmation, principal, context, {
      action: PROJECT_ROLE_UNASSIGN,
      projectId,
      targetType: PROJECT_MEMBER_TARGET,
      targetId: userId,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload: { userId, roleId, reason: input.reason },
    });
    return this.roleRepository.revoke(
      this.mutationInput(
        principal,
        projectId,
        userId,
        roleId,
        input,
        context,
        ticket.id,
        ticket.secretHash,
        replay.requestDigest,
      ),
    );
  }

  private async requireHumanSession(
    principal: V1Principal,
    context: ProjectRoleChangeContext,
  ): Promise<void> {
    if (principal.kind !== 'HUMAN' || !principal.sessionId || !context.webSessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
  }

  /** 非 OWNER/ADMIN 一律按项目不存在处理，不泄露项目或成员存在性。 */
  private async requireManager(projectId: string, userId: string): Promise<void> {
    const member = await this.roleRepository.findManager(projectId, userId);
    if (!member || member.revokedAt || (member.role !== 'OWNER' && member.role !== 'ADMIN'))
      throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
  }

  private async requireTargetMember(
    projectId: string,
    userId: string,
    expectedVersion: number,
  ): Promise<void> {
    const member = await this.roleRepository.findTargetMember(projectId, userId);
    if (!member || member.revokedAt)
      throw resourceNotFound('TARGET_MEMBER_NOT_ACTIVE', { projectId, userId });
    if (member.version !== expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        { projectId, userId, expectedVersion, currentVersion: member.version },
        409,
      );
  }

  private async requireRole(
    projectId: string,
    roleId: string,
    mustBeActive: boolean,
  ): Promise<void> {
    const role = await this.roleRepository.findRole(projectId, roleId);
    if (!role || (mustBeActive && !role.isActive))
      throw resourceNotFound('PROJECT_ROLE_NOT_FOUND', { projectId, roleId });
  }

  private async requireAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<void> {
    const assignment = await this.roleRepository.findAssignment(projectId, userId, roleId);
    if (!assignment || assignment.revokedAt)
      throw resourceNotFound('ASSIGNMENT_NOT_FOUND', { projectId, userId, roleId });
  }

  private async requireTicket(
    confirmation: Confirmation,
    principal: V1Principal,
    context: ProjectRoleChangeContext,
    binding: ActionBinding,
  ) {
    const ticket = await this.tickets.findTicket(confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding,
      now: context.now,
    });
    return ticket;
  }

  /** 合法重放先于目标版本 CAS 与票据消费；同键异语义按 409 拒绝。 */
  private async resolveReplay(
    principal: V1Principal,
    projectId: string,
    context: ProjectRoleChangeContext,
  ): Promise<{ requestDigest: string; result: ProjectRoleMutationView | null }> {
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const record = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(projectId),
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    });
    if (!record) return { requestDigest, result: null };
    assertReplayable(record, {
      method: context.method,
      route: context.route,
      digest: requestDigest,
    });
    return { requestDigest, result: this.replayView(record) };
  }

  private replayView(record: V1OperationRecord): ProjectRoleMutationView {
    const member = recordOf(record.resultRefs.member);
    const assignment = recordOf(record.resultRefs.assignment);
    const role = member.role === 'OWNER' || member.role === 'ADMIN' ? member.role : 'MEMBER';
    return {
      member: {
        id: String(member.id ?? ''),
        email: String(member.email ?? ''),
        name: String(member.name ?? ''),
        role,
        version: Number(member.version ?? 0),
      },
      assignment: {
        id: String(assignment.id ?? ''),
        userId: String(assignment.userId ?? ''),
        roleId: String(assignment.roleId ?? ''),
        version: Number(assignment.version ?? 0),
        revokedAt: typeof assignment.revokedAt === 'string' ? assignment.revokedAt : null,
      },
    };
  }

  private mutationInput(
    principal: V1Principal,
    projectId: string,
    userId: string,
    roleId: string,
    input: ProjectRoleChangeRequest,
    context: ProjectRoleChangeContext,
    ticketId: string,
    secretHash: string,
    requestDigest: string,
  ): ProjectRoleChangeInput {
    return {
      projectId,
      userId,
      roleId,
      reason: input.reason,
      expectedVersion: input.expectedVersion,
      actorUserId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      ticket: { id: ticketId, secretHash },
      operation: {
        id: context.operationId,
        projectScopeKey: projectScopeKey(projectId),
        principalScopeKey: principalScopeKey(principal),
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
      now: context.now,
    };
  }
}
