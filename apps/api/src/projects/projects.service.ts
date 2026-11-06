import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  principalScopeKey,
  projectScopeKey,
  type ActionBinding,
  type Confirmation,
} from '@workmesh/shared';
import { V1AuthorizationService, type V1ProjectContext } from '../auth/v1-authorization';
import type { V1Principal } from '../auth/v1-policy';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1TicketRecord,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import {
  assertReplayable,
  normalizeRoute,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { assertProjectWritable } from './project-archive';
import type {
  ArchiveProjectRepositoryDto,
  CreateProjectDto,
  CreateProjectRepositoryDto,
  UpdateProjectDto,
} from './dto';
import {
  PROJECT_ROLE_REPOSITORY,
  type ProjectRoleChangeInput,
  type ProjectRoleMutationView,
  type ProjectRoleRepository,
} from './project-role.repository';

/** 仓库声明/归档与发布共用的写上下文：幂等键、请求摘要来源与票据消费所需信息。 */
export type ProjectWriteContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  operationId: string;
  now: Date;
  webSessionId: string;
  userAuthVersion: number;
};

/** provider 仓库登记的高风险动作名（票据绑定）。 */
export const REPOSITORY_REGISTER = 'REPOSITORY_REGISTER';
/** 仓库归档的高风险动作名（票据绑定）。 */
export const REPOSITORY_ARCHIVE = 'REPOSITORY_ARCHIVE';
export const PROJECT_REPOSITORY_TARGET = 'PROJECT_REPOSITORY';

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

export type ProjectRoleChangeContext = ProjectWriteContext;

export type ProjectRoleChangeRequest = {
  expectedVersion: number;
  reason: string;
  confirmation: Confirmation;
};

export type ProjectRepositoryLocatorView = {
  id: string;
  canonicalLocator: string;
  source: string;
  declaredAt: string;
};

export type ProjectRepositoryView = {
  id: string;
  identityMode: string;
  adapter: string | null;
  externalId: string | null;
  owner: string;
  name: string;
  defaultBranch: string | null;
  archivedAt: string | null;
  lastVerifiedStatus: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  provider: { adapter: string; externalId: string } | null;
  locators: ProjectRepositoryLocatorView[];
};

export type RepositoryWriteResult = ProjectRepositoryView & {
  projectVersion: number;
  replayed: boolean;
};

export type RepositoryArchiveResult = {
  repositoryId: string;
  archivedAt: string;
  projectVersion: number;
  replayed: boolean;
};

type RepositoryRow = {
  id: string;
  identityMode: string;
  adapter: string | null;
  externalId: string | null;
  owner: string;
  name: string;
  defaultBranch: string | null;
  archivedAt: Date | null;
  lastVerifiedStatus: string | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  locators?: Array<{ id: string; canonicalLocator: string; source: string; declaredAt: Date }>;
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2034') return true;
  const message = (error as Error | null)?.message ?? '';
  return message.includes('40001') || message.includes('could not serialize');
}

export function projectVersionConflict(
  expectedVersion: number,
  currentVersion: number,
): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.PROJECT_VERSION_CONFLICT,
    'PROJECT_VERSION_CONFLICT',
    { expectedVersion, currentVersion },
    409,
  );
}

/** 工作区定义/仓库声明/接入码等新写路径共用的可序列化事务重试。 */
export async function runWithSerializableRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
    }
  }
}

function projectArchived(projectId: string, archivedAt: Date): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_CONFLICT,
    'PROJECT_ARCHIVED',
    { projectId, archivedAt: archivedAt.toISOString() },
    409,
  );
}

function managerRequired(projectId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.FORBIDDEN,
    'PROJECT_MANAGER_REQUIRED',
    { projectId },
    403,
  );
}

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
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PROJECT_ROLE_REPOSITORY) private readonly roleRepository: ProjectRoleRepository,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
    @Optional() private readonly authorization?: V1AuthorizationService,
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
    try {
      return await this.prisma.$transaction(async (tx) => {
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
            kind: 'BUSINESS',
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
    } catch (error) {
      // 项目 key 全局唯一：重复创建是客户端可纠正的冲突，必须给 409 而不是 Prisma 原生 500。
      if ((error as { code?: string })?.code === 'P2002')
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'PROJECT_KEY_CONFLICT',
          { key: dto.key },
          409,
        );
      throw error;
    }
  }

  async members(
    userId: string,
    projectId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      email: string;
      role: string;
      version: number;
      roles: Array<{ id: string; key: string; title: string }>;
    }>
  > {
    await this.membership(userId, projectId);
    const [rows, assignments] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { projectId, revokedAt: null },
        include: { user: { select: { id: true, email: true } } },
        orderBy: { grantedAt: 'asc' },
      }),
      this.prisma.projectRoleAssignment.findMany({
        where: { projectId, revokedAt: null },
        select: {
          userId: true,
          role: { select: { id: true, key: true, title: true } },
        },
      }),
    ]);
    const rolesByUser = new Map<string, Array<{ id: string; key: string; title: string }>>();
    for (const assignment of assignments) {
      const list = rolesByUser.get(assignment.userId) ?? [];
      list.push(assignment.role);
      rolesByUser.set(assignment.userId, list);
    }
    return rows.map((row) => ({
      id: row.user.id,
      name: row.user.email,
      email: row.user.email,
      role: row.role,
      version: row.version,
      roles: rolesByUser.get(row.user.id) ?? [],
    }));
  }

  /**
   * OWNER/ADMIN 按邮箱把已注册用户加入项目。不发送邀请；邮箱必须对应现有账号。
   * 已经是活动成员时幂等返回现有成员；曾被撤销的成员重新激活为 MEMBER。
   *
   * 这是「直接加人」的旁路，正式路径是邀请链接（带票据、项目版本 CAS 与审计）。
   * 它曾经连归档项目、被停用账号、审计记录都不管：ADMIN 一次普通请求就能把任意已注册
   * 账号（含被停用的、曾被移除的）悄悄加回项目，事后无处可查。这里补齐这三项；
   * 票据与版本 CAS 仍只有邀请路径具备，文档也不再把本接口当作入口。
   */
  async addMemberByEmail(
    userId: string,
    projectId: string,
    email: string,
  ): Promise<{ id: string; name: string; email: string; role: string; version: number }> {
    const member = await this.membership(userId, projectId, true);
    if (member.role !== 'OWNER' && member.role !== 'ADMIN')
      throw new NotFoundException('项目不存在');
    // 归档项目不再接受成员变更。
    await assertProjectWritable(this.prisma, projectId);

    const normalized = email.trim().toLowerCase();
    const target = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, isActive: true, authVersion: true },
    });
    if (!target) throw resourceNotFound('USER_NOT_FOUND', { email: normalized });
    // 停用账号不能被加回项目：成员资格是几乎所有读权限的门槛。
    if (!target.isActive)
      throw new WorkmeshError(
        V1_ERROR_CODES.MEMBER_INACTIVE,
        'MEMBER_INACTIVE',
        { email: normalized },
        422,
      );

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

    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { authVersion: true },
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = existing
        ? await tx.projectMember.update({
            where: { projectId_userId: { projectId, userId: target.id } },
            data: { role: 'MEMBER', revokedAt: null, version: { increment: 1 } },
          })
        : await tx.projectMember.create({
            data: { projectId, userId: target.id, role: 'MEMBER' },
          });
      // 审计：谁把谁加进来的、是不是复活了一个曾被移除的成员，必须留痕。
      const stamp = await tx.principalStamp.create({
        data: {
          kind: 'HUMAN',
          userId,
          projectId,
          userAuthVersion: actor?.authVersion ?? 1,
          scopeSnapshot: [],
        },
      });
      await tx.auditEvent.create({
        data: {
          projectId,
          actorStampId: stamp.id,
          action: 'PROJECT_MEMBER_ADD',
          targetType: 'PROJECT_MEMBER',
          targetId: target.id,
          targetVersion: row.version,
          outcome: 'APPLIED',
          details: { role: row.role, revived: Boolean(existing) },
        },
      });
      return row;
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

  /**
   * 不是项目成员时按项目不存在处理（不泄露存在性）；
   * 已是成员但没有管理权则返回 403 —— 成员本来就能看到项目，404 只会让
   * 「权限不足」被误读成「项目不存在」。
   */
  private async requireManager(projectId: string, userId: string): Promise<void> {
    const member = await this.roleRepository.findManager(projectId, userId);
    if (!member) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
    if (member.revokedAt || (member.role !== 'OWNER' && member.role !== 'ADMIN'))
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );
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

  /**
   * 仓库列表：读取权限沿用成员校验；DECLARED 行返回 locator 状态，
   * PROVIDER 行返回稳定 adapter 身份。`owner/name` 仅是展示字段，不是身份。
   */
  async repositories(userId: string, projectId: string) {
    await this.membership(userId, projectId);
    const rows = await this.prisma.projectRepository.findMany({
      where: { projectId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        identityMode: true,
        adapter: true,
        externalId: true,
        owner: true,
        name: true,
        defaultBranch: true,
        archivedAt: true,
        lastVerifiedStatus: true,
        lastVerifiedAt: true,
        createdAt: true,
        locators: {
          where: { revokedAt: null },
          orderBy: { declaredAt: 'asc' },
          select: { id: true, canonicalLocator: true, source: true, declaredAt: true },
        },
      },
    });
    return rows.map((row) => this.repositoryView(row));
  }

  private repositoryView(row: RepositoryRow): ProjectRepositoryView {
    return {
      id: row.id,
      identityMode: row.identityMode,
      adapter: row.adapter,
      externalId: row.externalId,
      owner: row.owner,
      name: row.name,
      defaultBranch: row.defaultBranch,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
      lastVerifiedStatus: row.lastVerifiedStatus,
      lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      provider:
        row.identityMode === 'PROVIDER' && row.adapter && row.externalId
          ? { adapter: row.adapter, externalId: row.externalId }
          : null,
      locators: (row.locators ?? []).map((locator) => ({
        id: locator.id,
        canonicalLocator: locator.canonicalLocator,
        source: locator.source,
        declaredAt: locator.declaredAt.toISOString(),
      })),
    };
  }

  /** 管理类仓库写操作的统一顺序：HUMAN 会话 → 项目上下文（归档 409/非成员 404）→ OWNER/ADMIN。 */
  private async requireRepositoryWriteAccess(
    principal: V1Principal,
    projectId: string,
  ): Promise<V1ProjectContext> {
    if (principal.kind !== 'HUMAN' || !principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    if (!this.authorization) throw new Error('AUTHORIZATION_SERVICE_UNAVAILABLE');
    const access = await this.authorization.resolveProjectContext(principal, projectId, 'write');
    if (access.membership.role !== 'OWNER' && access.membership.role !== 'ADMIN')
      throw managerRequired(projectId);
    return access;
  }

  /** 幂等回放先于版本/票据校验；同键异摘要单独使用 409 IDEMPOTENCY_DIGEST_CONFLICT。 */
  private async resolveOperationReplay(
    principal: V1Principal,
    projectId: string,
    context: ProjectWriteContext,
  ): Promise<{ requestDigest: string; record: V1OperationRecord | null }> {
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
    if (!record) return { requestDigest, record: null };
    if (
      record.method.toUpperCase() !== context.method.toUpperCase() ||
      normalizeRoute(record.route) !== normalizeRoute(context.route)
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'IDEMPOTENCY_ROUTE_CONFLICT',
        { operationId: record.id },
        409,
      );
    if (record.requestDigest !== requestDigest)
      throw new WorkmeshError(
        V1_ERROR_CODES.IDEMPOTENCY_DIGEST_CONFLICT,
        'IDEMPOTENCY_DIGEST_CONFLICT',
        { operationId: record.id },
        409,
      );
    return { requestDigest, record };
  }

  /**
   * 代码仓库登记（provider 身份）：身份用厂商稳定 ID，改名不影响引用。
   * 同一 (adapter, externalId) 重复登记返回 409；已归档的仓库重新登记即恢复。
   * T2 补齐：人审票据、Idempotency-Key、Project.version CAS、actorStamp 审计与 P2002→409。
   */
  async createRepository(
    principal: V1Principal,
    projectId: string,
    dto: CreateProjectRepositoryDto,
    context: ProjectWriteContext,
  ): Promise<RepositoryWriteResult> {
    const access = await this.requireRepositoryWriteAccess(principal, projectId);
    const replay = await this.resolveOperationReplay(principal, projectId, context);
    if (replay.record) {
      const refs = recordOf(replay.record.resultRefs);
      const view = recordOf(refs.repository) as unknown as ProjectRepositoryView;
      return {
        ...view,
        projectVersion: Number(refs.projectVersion ?? access.project.version),
        replayed: true,
      };
    }
    if (access.project.version !== dto.expectedProjectVersion)
      throw projectVersionConflict(dto.expectedProjectVersion, access.project.version);

    const ticket = await this.requireTicket(dto.confirmation, principal, context, {
      action: REPOSITORY_REGISTER,
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: dto.expectedProjectVersion,
      roleSlot: null,
      payload: {
        adapter: dto.adapter,
        externalId: dto.externalId,
        owner: dto.owner,
        name: dto.name,
        defaultBranch: dto.defaultBranch ?? null,
      },
    });

    try {
      return await this.runWithRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await this.lockProject(tx, projectId);
          const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { version: true, archivedAt: true },
          });
          if (!project) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
          if (project.archivedAt) throw projectArchived(projectId, project.archivedAt);
          if (project.version !== dto.expectedProjectVersion)
            throw projectVersionConflict(dto.expectedProjectVersion, project.version);

          const consumed = await this.consumeTicket(tx, ticket, context);
          if (!consumed)
            throw new WorkmeshError(
              V1_ERROR_CODES.CONFIRMATION_USED,
              'CONFIRMATION_CONSUME_CONFLICT',
              { ticketId: ticket.id },
              409,
            );

          const existing = await tx.projectRepository.findFirst({
            where: {
              projectId,
              identityMode: 'PROVIDER',
              adapter: dto.adapter,
              externalId: dto.externalId,
            },
          });
          let row: RepositoryRow;
          if (existing) {
            if (!existing.archivedAt)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_CONFLICT,
                'REPOSITORY_EXISTS',
                { repositoryId: existing.id },
                409,
              );
            row = await tx.projectRepository.update({
              where: { id: existing.id },
              data: {
                archivedAt: null,
                owner: dto.owner,
                name: dto.name,
                defaultBranch: dto.defaultBranch ?? existing.defaultBranch,
              },
            });
          } else {
            row = await tx.projectRepository.create({
              data: {
                projectId,
                identityMode: 'PROVIDER',
                adapter: dto.adapter,
                externalId: dto.externalId,
                owner: dto.owner,
                name: dto.name,
                defaultBranch: dto.defaultBranch ?? null,
              },
            });
          }

          const projectVersion = dto.expectedProjectVersion + 1;
          const bumped = await tx.project.updateMany({
            where: { id: projectId, version: dto.expectedProjectVersion, archivedAt: null },
            data: { version: { increment: 1 } },
          });
          if (bumped.count !== 1)
            throw projectVersionConflict(dto.expectedProjectVersion, project.version);

          const view = this.repositoryView({ ...row, locators: [] });
          await this.recordRepositoryAudit(tx, {
            principal,
            context,
            projectId,
            access,
            action: REPOSITORY_REGISTER,
            repositoryId: row.id,
            targetVersion: projectVersion,
            details: {
              identityMode: 'PROVIDER',
              adapter: dto.adapter,
              externalId: dto.externalId,
              reactivated: Boolean(existing),
            },
          });
          await tx.idempotentOperation.create({
            data: {
              id: context.operationId,
              projectId,
              projectScopeKey: projectScopeKey(projectId),
              principalScopeKey: principalScopeKey(principal),
              key: context.idempotencyKey,
              method: context.method,
              route: context.route,
              requestDigest: replay.requestDigest,
              resultRefs: { repository: view, projectVersion } as unknown as Prisma.InputJsonValue,
              responseMetadata: {},
            },
          });
          return { ...view, projectVersion, replayed: false };
        }, SERIALIZABLE),
      );
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'P2002')
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'REPOSITORY_EXISTS',
          { adapter: dto.adapter, externalId: dto.externalId },
          409,
        );
      throw error;
    }
  }

  /**
   * 既有 DELETE 归档接口补强：票据 + 幂等 + Project.version CAS + 审计。
   * 已归档仓库幂等返回原结果；跨项目 404；归档项目 409。
   */
  async archiveRepository(
    principal: V1Principal,
    projectId: string,
    repositoryId: string,
    dto: ArchiveProjectRepositoryDto,
    context: ProjectWriteContext,
  ): Promise<RepositoryArchiveResult> {
    const access = await this.requireRepositoryWriteAccess(principal, projectId);
    const replay = await this.resolveOperationReplay(principal, projectId, context);
    if (replay.record) {
      const refs = recordOf(replay.record.resultRefs);
      return {
        repositoryId: String(refs.repositoryId ?? repositoryId),
        archivedAt: String(refs.archivedAt ?? ''),
        projectVersion: Number(refs.projectVersion ?? access.project.version),
        replayed: true,
      };
    }
    if (access.project.version !== dto.expectedProjectVersion)
      throw projectVersionConflict(dto.expectedProjectVersion, access.project.version);

    const ticket = await this.requireTicket(dto.confirmation, principal, context, {
      action: REPOSITORY_ARCHIVE,
      projectId,
      targetType: PROJECT_REPOSITORY_TARGET,
      targetId: repositoryId,
      expectedVersion: dto.expectedProjectVersion,
      roleSlot: null,
      payload: { repositoryId },
    });

    return this.runWithRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockProject(tx, projectId);
        const project = await tx.project.findUnique({
          where: { id: projectId },
          select: { version: true, archivedAt: true },
        });
        if (!project) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
        if (project.archivedAt) throw projectArchived(projectId, project.archivedAt);
        if (project.version !== dto.expectedProjectVersion)
          throw projectVersionConflict(dto.expectedProjectVersion, project.version);

        const repository = await tx.projectRepository.findFirst({
          where: { id: repositoryId, projectId },
          select: { id: true, archivedAt: true },
        });
        if (!repository) throw resourceNotFound('REPOSITORY_NOT_FOUND', { repositoryId });

        // 已归档：幂等返回，不再递增项目版本、不重复消费票据、不重复审计。
        if (repository.archivedAt) {
          await tx.idempotentOperation.create({
            data: {
              id: context.operationId,
              projectId,
              projectScopeKey: projectScopeKey(projectId),
              principalScopeKey: principalScopeKey(principal),
              key: context.idempotencyKey,
              method: context.method,
              route: context.route,
              requestDigest: replay.requestDigest,
              resultRefs: {
                repositoryId,
                archivedAt: repository.archivedAt.toISOString(),
                projectVersion: project.version,
              },
              responseMetadata: {},
            },
          });
          return {
            repositoryId,
            archivedAt: repository.archivedAt.toISOString(),
            projectVersion: project.version,
            replayed: false,
          };
        }

        const consumed = await this.consumeTicket(tx, ticket, context);
        if (!consumed)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: ticket.id },
            409,
          );

        const archived = await tx.projectRepository.update({
          where: { id: repositoryId },
          data: { archivedAt: context.now },
          select: { id: true, archivedAt: true },
        });
        // 归档同时撤销活跃 locator：归档仓库不应再占用活跃 locator 唯一键，
        // 也不能让后续声明无声复用一条已归档仓库。
        await tx.projectRepositoryLocator.updateMany({
          where: { repositoryId, projectId, revokedAt: null },
          data: { revokedAt: context.now, revokedByUserId: principal.userId },
        });
        const projectVersion = dto.expectedProjectVersion + 1;
        const bumped = await tx.project.updateMany({
          where: { id: projectId, version: dto.expectedProjectVersion, archivedAt: null },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1)
          throw projectVersionConflict(dto.expectedProjectVersion, project.version);

        await this.recordRepositoryAudit(tx, {
          principal,
          context,
          projectId,
          access,
          action: REPOSITORY_ARCHIVE,
          repositoryId,
          targetVersion: projectVersion,
          details: { repositoryId, archivedAt: context.now.toISOString() },
        });
        await tx.idempotentOperation.create({
          data: {
            id: context.operationId,
            projectId,
            projectScopeKey: projectScopeKey(projectId),
            principalScopeKey: principalScopeKey(principal),
            key: context.idempotencyKey,
            method: context.method,
            route: context.route,
            requestDigest: replay.requestDigest,
            resultRefs: {
              repositoryId,
              archivedAt: (archived.archivedAt ?? context.now).toISOString(),
              projectVersion,
            },
            responseMetadata: {},
          },
        });
        return {
          repositoryId,
          archivedAt: (archived.archivedAt ?? context.now).toISOString(),
          projectVersion,
          replayed: false,
        };
      }, SERIALIZABLE),
    );
  }

  private async lockProject(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
    );
    if (locked.length === 0) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
  }

  /** 条件消费票据：只有未消费、未失效、未过期且属于同一 WebSession 的行才写入。 */
  private async consumeTicket(
    tx: Prisma.TransactionClient,
    ticket: V1TicketRecord,
    context: ProjectWriteContext,
  ): Promise<boolean> {
    const consumed = await tx.$executeRaw(
      Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
        SET "consumedAt" = ${context.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${context.operationId}::uuid
        WHERE "id" = ${ticket.id}::uuid
          AND "secretHash" = ${ticket.secretHash}
          AND "webSessionId" = ${context.webSessionId}::uuid
          AND "consumedAt" IS NULL
          AND "invalidatedAt" IS NULL
          AND "expiresAt" > ${context.now}`,
    );
    return consumed === 1;
  }

  /** 审计必须带 actorStamp：谁在哪个会话、以什么成员版本批准并执行了这次仓库写操作。 */
  private async recordRepositoryAudit(
    tx: Prisma.TransactionClient,
    input: {
      principal: V1Principal;
      context: ProjectWriteContext;
      projectId: string;
      access: V1ProjectContext;
      action: string;
      repositoryId: string;
      targetVersion: number;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const stamp = await tx.principalStamp.create({
      data: {
        kind: 'HUMAN',
        userId: input.principal.userId,
        webSessionId: input.context.webSessionId,
        projectId: input.projectId,
        userAuthVersion: input.context.userAuthVersion,
        memberVersion: input.access.membership.version,
        scopeSnapshot: [],
      },
    });
    await tx.auditEvent.create({
      data: {
        projectId: input.projectId,
        actorStampId: stamp.id,
        action: input.action,
        targetType: PROJECT_REPOSITORY_TARGET,
        targetId: input.repositoryId,
        targetVersion: input.targetVersion,
        outcome: 'SUCCESS',
        details: input.details as Prisma.InputJsonValue,
      },
    });
  }

  private async runWithRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
      }
    }
  }

  /**
   * 自定义业务角色：key 不可变，停用用 isActive，不物理删除。
   * 停用只要求没有在任成员；历史任务与工作流引用保留。
   */
  async createRole(userId: string, projectId: string, dto: { key: string; title: string }) {
    await this.membership(userId, projectId, true);
    const existing = await this.prisma.projectRole.findUnique({
      where: { projectId_key: { projectId, key: dto.key } },
    });
    if (existing) {
      if (existing.isActive)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'ROLE_KEY_EXISTS',
          { roleId: existing.id, key: dto.key },
          409,
        );
      return this.prisma.projectRole.update({
        where: { id: existing.id },
        data: { isActive: true, title: dto.title, version: { increment: 1 } },
      });
    }
    return this.prisma.projectRole.create({
      data: { projectId, key: dto.key, title: dto.title },
    });
  }

  async updateRole(
    userId: string,
    projectId: string,
    roleId: string,
    dto: { title: string; expectedVersion: number },
  ) {
    await this.membership(userId, projectId, true);
    const role = await this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
    });
    if (!role) throw resourceNotFound('角色不存在', { roleId });
    if (role.version !== dto.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'ROLE_VERSION_CONFLICT',
        { expectedVersion: dto.expectedVersion, currentVersion: role.version },
        409,
      );
    return this.prisma.projectRole.update({
      where: { id: role.id },
      data: { title: dto.title, version: { increment: 1 } },
    });
  }

  async deactivateRole(userId: string, projectId: string, roleId: string) {
    await this.membership(userId, projectId, true);
    const role = await this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
    });
    if (!role) throw resourceNotFound('角色不存在', { roleId });
    if (!role.isActive) return role;
    const activeAssignments = await this.prisma.projectRoleAssignment.count({
      where: { projectId, roleId, revokedAt: null },
    });
    if (activeAssignments > 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'ROLE_IN_USE',
        { roleId, activeAssignments },
        409,
      );
    return this.prisma.projectRole.update({
      where: { id: role.id },
      data: { isActive: false, version: { increment: 1 } },
    });
  }
}
