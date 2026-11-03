import { Inject, Injectable } from '@nestjs/common';
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
import {
  INVITATION_DEFAULT_TTL_HOURS,
  assertInvitationEmailMatches,
  assertInvitationTtl,
  hashInvitationToken,
  invitationBindingPayload,
  invitationExpiryFrom,
  invitationStatus,
  newInvitationToken,
  normalizeInvitationEmail,
  type InvitationStatus,
} from './invitations.policy';

export const PROJECT_INVITATION_CREATE = 'PROJECT_INVITATION_CREATE';
export const PROJECT_INVITATION_REVOKE = 'PROJECT_INVITATION_REVOKE';
export const PROJECT_INVITATION_TARGET = 'PROJECT_INVITATION';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

export type InvitationRoleView = { id: string; key: string; title: string };

export type InvitationView = {
  id: string;
  status: InvitationStatus;
  project: { id: string; key: string; name: string };
  roles: InvitationRoleView[];
  email: string | null;
  expiresAt: string;
  createdAt: string;
};

export type CreatedInvitationView = {
  id: string;
  /** 明文 token 只在创建响应当次返回；丢失后只能重新生成。 */
  token: string | null;
  projectId: string;
  roleIds: string[];
  roleKeys: string[];
  email: string | null;
  expiresAt: string;
  replayed: boolean;
};

export type InvitationCreateInput = {
  /** 业务角色 key：请求体禁止自报 roleIds，服务端按项目解析成角色 id。 */
  roleKeys: string[];
  email?: string;
  expiresInHours?: number;
  expectedVersion: number;
  confirmation: Confirmation;
};

export type InvitationContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  operationId: string;
  now: Date;
  webSessionId: string;
  userAuthVersion: number;
};

export type JoinInvitationInput = {
  userId: string;
  webSessionId: string;
  now: Date;
};

export type JoinInvitationResult = {
  invitationId: string;
  projectId: string;
  roleIds: string[];
  roleKeys: string[];
};

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2034') return true;
  const message = (error as Error | null)?.message ?? '';
  return message.includes('40001') || message.includes('could not serialize');
}

function resourceNotFound(message: string, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, message, details, 404);
}

function conflict(code: string, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_CONFLICT, code, details, 409);
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  /**
   * 生成邀请：管理员 + 人类会话 + 一次性票据。
   * 票据绑定“项目 + 角色集合 + 邮箱 + 有效期”，接受时不再需要管理员在场。
   */
  async create(
    principal: V1Principal,
    projectId: string,
    input: InvitationCreateInput,
    context: InvitationContext,
  ): Promise<CreatedInvitationView> {
    await this.requireHumanSession(principal, context);
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: principal.userId } },
    });
    if (!member || member.revokedAt) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
    if (member.role !== 'OWNER' && member.role !== 'ADMIN')
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, version: true, archivedAt: true },
    });
    if (!project || project.archivedAt) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
    if (project.version !== input.expectedVersion)
      throw conflict('PROJECT_VERSION_CONFLICT', {
        expectedVersion: input.expectedVersion,
        currentVersion: project.version,
      });

    const requestedKeys = [...new Set(input.roleKeys)];
    const roles = await this.prisma.projectRole.findMany({
      where: { projectId, key: { in: requestedKeys }, isActive: true },
      select: { id: true, key: true },
    });
    if (roles.length !== requestedKeys.length)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'INVITATION_ROLE_INVALID',
        {
          requested: requestedKeys,
          active: roles.map((role) => role.key),
        },
        422,
      );
    const roleIds = roles.map((role) => role.id).sort();

    const email = normalizeInvitationEmail(input.email);
    const expiresInHours = assertInvitationTtl(
      input.expiresInHours ?? INVITATION_DEFAULT_TTL_HOURS,
    );
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const replay = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(projectId),
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    });
    if (replay) {
      assertReplayable(replay, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      return this.replayView(replay);
    }

    const payload = invitationBindingPayload({ roleIds, email, expiresInHours });
    const binding: ActionBinding = {
      action: PROJECT_INVITATION_CREATE,
      projectId,
      targetType: PROJECT_INVITATION_TARGET,
      targetId: projectId,
      expectedVersion: input.expectedVersion,
      roleSlot: null,
      payload,
    };
    const ticket = await this.tickets.findTicket(input.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: input.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: input.confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding,
      now: context.now,
    });

    const { token, tokenHash } = newInvitationToken();
    const expiresAt = invitationExpiryFrom(context.now, expiresInHours);
    const roleKeys = roles.map((role) => role.key).sort();

    return this.runWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const bumped = await tx.project.updateMany({
            where: { id: projectId, version: input.expectedVersion, archivedAt: null },
            data: { version: { increment: 1 } },
          });
          if (bumped.count !== 1) throw conflict('PROJECT_VERSION_CONFLICT', { projectId });

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
          if (consumed !== 1)
            throw new WorkmeshError(
              V1_ERROR_CODES.CONFIRMATION_USED,
              'CONFIRMATION_CONSUME_CONFLICT',
              { ticketId: ticket.id },
              409,
            );

          const invitation = await tx.projectInvitation.create({
            data: {
              id: randomUUID(),
              projectId,
              tokenHash,
              email,
              roleIds,
              invitedById: principal.userId,
              expiresAt,
            },
          });

          await tx.auditEvent.create({
            data: {
              projectId,
              action: PROJECT_INVITATION_CREATE,
              targetType: PROJECT_INVITATION_TARGET,
              targetId: invitation.id,
              targetVersion: invitation.version,
              outcome: 'SUCCESS',
              details: {
                roleIds,
                roleKeys,
                email,
                expiresAt: expiresAt.toISOString(),
              },
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
              requestDigest,
              resultRefs: {
                invitationId: invitation.id,
                projectId,
                roleIds,
                roleKeys,
                email,
                expiresAt: expiresAt.toISOString(),
              },
              responseMetadata: {},
            },
          });

          return {
            id: invitation.id,
            token,
            projectId,
            roleIds,
            roleKeys,
            email,
            expiresAt: expiresAt.toISOString(),
            replayed: false,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /** 公开解析：只返回项目名、角色名与状态，不返回任何凭据或成员信息。 */
  async resolve(token: string, now = new Date()): Promise<InvitationView> {
    const invitation = await this.findByToken(token);
    if (!invitation || invitation.project.archivedAt)
      throw resourceNotFound('INVITATION_NOT_FOUND', {});
    const roles = invitation.roleIds?.length
      ? await this.prisma.projectRole.findMany({
          where: { projectId: invitation.projectId, id: { in: invitation.roleIds } },
          select: { id: true, key: true, title: true },
          orderBy: { key: 'asc' },
        })
      : [];
    return {
      id: invitation.id,
      status: invitationStatus(invitation, now),
      project: {
        id: invitation.project.id,
        key: invitation.project.key,
        name: invitation.project.name,
      },
      roles,
      email: invitation.email,
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    };
  }

  /**
   * 匿名接受前的预检：确认邀请可用、邮箱可用，并把最终邮箱定下来。
   * 邀请绑定了邮箱就忽略访客输入，避免“链接转手后换邮箱注册”。
   */
  async prepareAnonymousAccept(token: string, emailInput: string | undefined, now = new Date()) {
    const view = await this.resolve(token, now);
    if (view.status === 'ACCEPTED') throw conflict('INVITATION_ALREADY_ACCEPTED', {});
    if (view.status === 'REVOKED')
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'INVITATION_REVOKED', {}, 410);
    if (view.status === 'EXPIRED')
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'INVITATION_EXPIRED', {}, 410);
    const email = view.email ?? normalizeInvitationEmail(emailInput);
    if (!email)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'INVITATION_EMAIL_REQUIRED',
        { invitationId: view.id },
        422,
      );
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) throw conflict('EMAIL_ALREADY_REGISTERED', { email });
    return { email, view };
  }

  /**
   * 接受邀请：CAS 抢占邀请（保证一次性），再补成员与角色。
   * 已存在的成员会被重新激活；已撤销的角色授予也会恢复，不产生重复行。
   */
  async join(token: string, input: JoinInvitationInput): Promise<JoinInvitationResult> {
    const invitation = await this.findByToken(token);
    if (!invitation || invitation.project.archivedAt)
      throw resourceNotFound('INVITATION_NOT_FOUND', {});
    const status = invitationStatus(invitation, input.now);
    if (status === 'ACCEPTED') throw conflict('INVITATION_ALREADY_ACCEPTED', {});
    if (status === 'REVOKED')
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'INVITATION_REVOKED', {}, 410);
    if (status === 'EXPIRED')
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'INVITATION_EXPIRED', {}, 410);

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, isActive: true },
    });
    if (!user || !user.isActive)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_INVALID, '账号不可用', undefined, 401);
    assertInvitationEmailMatches(invitation.email, user.email);

    const roleIds = invitation.roleIds ?? [];
    const roles = roleIds.length
      ? await this.prisma.projectRole.findMany({
          where: { projectId: invitation.projectId, id: { in: roleIds }, isActive: true },
          select: { id: true, key: true },
        })
      : [];
    const activeRoleIds = roles.map((role) => role.id);

    return this.runWithRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          const claimed = await tx.projectInvitation.updateMany({
            where: {
              id: invitation.id,
              acceptedAt: null,
              revokedAt: null,
              expiresAt: { gt: input.now },
            },
            data: {
              acceptedAt: input.now,
              acceptedByUserId: user.id,
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1) throw conflict('INVITATION_ALREADY_ACCEPTED', {});

          const existingMember = await tx.projectMember.findUnique({
            where: {
              projectId_userId: { projectId: invitation.projectId, userId: user.id },
            },
          });
          if (existingMember) {
            if (existingMember.revokedAt)
              await tx.projectMember.update({
                where: {
                  projectId_userId: { projectId: invitation.projectId, userId: user.id },
                },
                data: { revokedAt: null, version: { increment: 1 } },
              });
          } else {
            await tx.projectMember.create({
              data: { projectId: invitation.projectId, userId: user.id, role: 'MEMBER' },
            });
          }

          for (const roleId of activeRoleIds) {
            const existing = await tx.projectRoleAssignment.findUnique({
              where: {
                projectId_userId_roleId: {
                  projectId: invitation.projectId,
                  userId: user.id,
                  roleId,
                },
              },
            });
            if (existing) {
              if (existing.revokedAt)
                await tx.projectRoleAssignment.update({
                  where: { id: existing.id },
                  data: { revokedAt: null, version: { increment: 1 } },
                });
            } else {
              await tx.projectRoleAssignment.create({
                data: { projectId: invitation.projectId, userId: user.id, roleId },
              });
            }
          }

          await tx.auditEvent.create({
            data: {
              projectId: invitation.projectId,
              action: 'PROJECT_INVITATION_ACCEPT',
              targetType: PROJECT_INVITATION_TARGET,
              targetId: invitation.id,
              outcome: 'SUCCESS',
              details: { userId: user.id, roleIds: activeRoleIds },
            },
          });

          return {
            invitationId: invitation.id,
            projectId: invitation.projectId,
            roleIds: activeRoleIds,
            roleKeys: roles.map((role) => role.key).sort(),
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /** 管理员撤回未接受的邀请；已接受/已撤销的邀请不重复处理。 */
  async revoke(
    principal: V1Principal,
    projectId: string,
    invitationId: string,
    now = new Date(),
  ): Promise<{ id: string; revokedAt: string }> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: principal.userId } },
    });
    if (!member || member.revokedAt) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
    if (member.role !== 'OWNER' && member.role !== 'ADMIN')
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );

    const updated = await this.prisma.projectInvitation.updateMany({
      where: { id: invitationId, projectId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw conflict('INVITATION_NOT_REVOCABLE', { invitationId });

    await this.prisma.auditEvent.create({
      data: {
        projectId,
        action: PROJECT_INVITATION_REVOKE,
        targetType: PROJECT_INVITATION_TARGET,
        targetId: invitationId,
        outcome: 'SUCCESS',
      },
    });
    return { id: invitationId, revokedAt: now.toISOString() };
  }

  /** 管理员查看未接受、未撤销、未过期的邀请。 */
  async list(
    principal: V1Principal,
    projectId: string,
    now = new Date(),
  ): Promise<Array<Omit<InvitationView, 'project'>>> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: principal.userId } },
    });
    if (!member || member.revokedAt) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
    if (member.role !== 'OWNER' && member.role !== 'ADMIN')
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );

    const rows = await this.prisma.projectInvitation.findMany({
      where: { projectId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const roleIds = [...new Set(rows.flatMap((row) => row.roleIds ?? []))];
    const roles = roleIds.length
      ? await this.prisma.projectRole.findMany({
          where: { projectId, id: { in: roleIds } },
          select: { id: true, key: true, title: true },
        })
      : [];
    const roleById = new Map(roles.map((role) => [role.id, role]));
    return rows.map((row) => ({
      id: row.id,
      status: invitationStatus(row, now),
      roles: (row.roleIds ?? [])
        .map((roleId) => roleById.get(roleId))
        .filter((role): role is InvitationRoleView => Boolean(role)),
      email: row.email,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async findByToken(token: string) {
    if (!token) throw resourceNotFound('INVITATION_NOT_FOUND', {});
    return this.prisma.projectInvitation.findUnique({
      where: { tokenHash: hashInvitationToken(token) },
      include: { project: { select: { id: true, key: true, name: true, archivedAt: true } } },
    });
  }

  private replayView(record: V1OperationRecord): CreatedInvitationView {
    const refs = record.resultRefs ?? {};
    return {
      id: String(refs.invitationId ?? ''),
      token: null,
      projectId: String(refs.projectId ?? ''),
      roleIds: Array.isArray(refs.roleIds) ? refs.roleIds.map(String) : [],
      roleKeys: Array.isArray(refs.roleKeys) ? refs.roleKeys.map(String) : [],
      email: typeof refs.email === 'string' ? refs.email : null,
      expiresAt: String(refs.expiresAt ?? ''),
      replayed: true,
    };
  }

  private async requireHumanSession(
    principal: V1Principal,
    context: InvitationContext,
  ): Promise<void> {
    if (principal.kind !== 'HUMAN' || !principal.sessionId || !context.webSessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
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
}
