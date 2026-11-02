import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { ProjectManagementRole } from '../auth/v1-authorization';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ProjectMemberProfile,
  ProjectMemberRecord,
  ProjectRoleAssignmentRecord,
  ProjectRoleChangeInput,
  ProjectRoleMutationView,
  ProjectRoleRecord,
  ProjectRoleRepository,
} from './project-role.repository';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return message.includes('40001') || message.includes('40P01') || message.includes('could not serialize');
}

function assignmentRecordOf(row: {
  id: string;
  projectId: string;
  userId: string;
  roleId: string;
  version: number;
  revokedAt: Date | null;
}): ProjectRoleAssignmentRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    roleId: row.roleId,
    version: row.version,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class ProjectRolePrismaRepository implements ProjectRoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManager(projectId: string, userId: string): Promise<ProjectMemberRecord | null> {
    const row = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectId: true, userId: true, role: true, version: true, revokedAt: true },
    });
    if (!row) return null;
    return { ...row, role: row.role as ProjectManagementRole };
  }

  async findTargetMember(projectId: string, userId: string): Promise<ProjectMemberProfile | null> {
    const row = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: {
        projectId: true,
        userId: true,
        role: true,
        version: true,
        revokedAt: true,
        user: { select: { email: true } },
      },
    });
    if (!row) return null;
    return {
      projectId: row.projectId,
      userId: row.userId,
      role: row.role as ProjectManagementRole,
      version: row.version,
      revokedAt: row.revokedAt,
      email: row.user.email,
    };
  }

  async findRole(projectId: string, roleId: string): Promise<ProjectRoleRecord | null> {
    return this.prisma.projectRole.findFirst({
      where: { id: roleId, projectId },
      select: { id: true, projectId: true, isActive: true },
    });
  }

  async findAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<ProjectRoleAssignmentRecord | null> {
    const row = await this.prisma.projectRoleAssignment.findUnique({
      where: { projectId_userId_roleId: { projectId, userId, roleId } },
    });
    return row ? assignmentRecordOf(row) : null;
  }

  async assign(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView> {
    return this.runWithRetry(() => this.runMutation(input, 'ASSIGN'));
  }

  async revoke(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView> {
    return this.runWithRetry(() => this.runMutation(input, 'REVOKE'));
  }

  private async runWithRetry(run: () => Promise<ProjectRoleMutationView>): Promise<ProjectRoleMutationView> {
    let attempt = 0;
    for (;;) {
      try {
        return await run();
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  /**
   * 授予与撤销共用同一项目级串行写边界：Project 行 FOR UPDATE → 复核管理者/目标成员/角色/
   * assignment/成员版本 → 条件消费票据 → 写 assignment、成员版本、审计与幂等操作。
   */
  private async runMutation(
    input: ProjectRoleChangeInput,
    mode: 'ASSIGN' | 'REVOKE',
  ): Promise<ProjectRoleMutationView> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );

        const manager = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: input.projectId, userId: input.actorUserId } },
          select: { role: true, revokedAt: true },
        });
        if (!manager || manager.revokedAt || (manager.role !== 'OWNER' && manager.role !== 'ADMIN'))
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'PROJECT_NOT_FOUND',
            { projectId: input.projectId },
            404,
          );

        const target = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: input.projectId, userId: input.userId } },
          select: {
            role: true,
            version: true,
            revokedAt: true,
            user: { select: { id: true, email: true } },
          },
        });
        if (!target || target.revokedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'TARGET_MEMBER_NOT_ACTIVE',
            { projectId: input.projectId, userId: input.userId },
            404,
          );

        const role = await tx.projectRole.findFirst({
          where: { id: input.roleId, projectId: input.projectId },
          select: { id: true, isActive: true },
        });
        if (!role || (mode === 'ASSIGN' && !role.isActive))
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'PROJECT_ROLE_NOT_FOUND',
            { projectId: input.projectId, roleId: input.roleId },
            404,
          );

        const existing = await tx.projectRoleAssignment.findUnique({
          where: {
            projectId_userId_roleId: {
              projectId: input.projectId,
              userId: input.userId,
              roleId: input.roleId,
            },
          },
        });
        if (mode === 'REVOKE' && (!existing || existing.revokedAt))
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'ASSIGNMENT_NOT_FOUND',
            { projectId: input.projectId, userId: input.userId, roleId: input.roleId },
            404,
          );

        if (target.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            {
              projectId: input.projectId,
              userId: input.userId,
              expectedVersion: input.expectedVersion,
              currentVersion: target.version,
            },
            409,
          );

        const consumed = await tx.$executeRaw(
          Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
            SET "consumedAt" = ${input.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${input.operation.id}::uuid
            WHERE "id" = ${input.ticket.id}::uuid
              AND "secretHash" = ${input.ticket.secretHash}
              AND "webSessionId" = ${input.webSessionId}::uuid
              AND "consumedAt" IS NULL
              AND "invalidatedAt" IS NULL
              AND "expiresAt" > ${input.now}`,
        );
        if (consumed !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );

        let assignment: ProjectRoleAssignmentRecord;
        if (mode === 'ASSIGN') {
          if (existing && !existing.revokedAt) {
            // 已持有活动角色：保留原 assignment，不产生第二个活动行。
            assignment = assignmentRecordOf(existing);
          } else if (existing) {
            assignment = assignmentRecordOf(
              await tx.projectRoleAssignment.update({
                where: { id: existing.id },
                data: { revokedAt: null, grantedAt: input.now, version: { increment: 1 } },
              }),
            );
          } else {
            assignment = assignmentRecordOf(
              await tx.projectRoleAssignment.create({
                data: {
                  projectId: input.projectId,
                  userId: input.userId,
                  roleId: input.roleId,
                  grantedAt: input.now,
                },
              }),
            );
          }
        } else {
          if (!existing || existing.revokedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'ASSIGNMENT_NOT_FOUND',
              { projectId: input.projectId, userId: input.userId, roleId: input.roleId },
              404,
            );
          assignment = assignmentRecordOf(
            await tx.projectRoleAssignment.update({
              where: { id: existing.id },
              data: { revokedAt: input.now, version: { increment: 1 } },
            }),
          );
        }

        const bumped = await tx.projectMember.updateMany({
          where: {
            projectId: input.projectId,
            userId: input.userId,
            version: input.expectedVersion,
            revokedAt: null,
          },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            { projectId: input.projectId, userId: input.userId },
            409,
          );

        const stamp = await tx.principalStamp.create({
          data: {
            kind: 'HUMAN',
            userId: input.actorUserId,
            webSessionId: input.webSessionId,
            projectId: input.projectId,
            userAuthVersion: input.userAuthVersion,
            memberVersion: input.expectedVersion + 1,
            roleAssignmentVersion: assignment.version,
            scopeSnapshot: [],
          },
        });

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            actorStampId: stamp.id,
            action: mode === 'ASSIGN' ? 'PROJECT_ROLE_ASSIGN' : 'PROJECT_ROLE_UNASSIGN',
            targetType: 'PROJECT_MEMBER',
            targetId: input.userId,
            targetVersion: input.expectedVersion,
            outcome: 'SUCCESS',
            details: {
              roleId: input.roleId,
              assignmentId: assignment.id,
              assignmentVersion: assignment.version,
              reason: input.reason,
            },
          },
        });

        const view: ProjectRoleMutationView = {
          member: {
            id: target.user.id,
            email: target.user.email,
            name: target.user.email,
            role: target.role as ProjectManagementRole,
            version: input.expectedVersion + 1,
          },
          assignment: {
            id: assignment.id,
            userId: assignment.userId,
            roleId: assignment.roleId,
            version: assignment.version,
            revokedAt: assignment.revokedAt ? assignment.revokedAt.toISOString() : null,
          },
        };

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: input.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: {
              member: {
                id: view.member.id,
                email: view.member.email,
                name: view.member.name,
                role: view.member.role,
                version: view.member.version,
              },
              assignment: {
                id: view.assignment.id,
                userId: view.assignment.userId,
                roleId: view.assignment.roleId,
                version: view.assignment.version,
                revokedAt: view.assignment.revokedAt,
              },
            },
            responseMetadata: { memberVersion: input.expectedVersion + 1, assignmentVersion: assignment.version },
          },
        });

        return view;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
