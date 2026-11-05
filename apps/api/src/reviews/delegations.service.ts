import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDelegationDto } from './delegations.dto';

/**
 * 槽位级临时委托与超时视图。
 *
 * - 委托只追加记录，原 `requiredUserId` 不变；到期或撤销后自动失效。
 * - 只允许 OWNER/ADMIN 建立或撤销委托。
 * - 超时升级只提供「到期未决定」的只读视图，不自动批准；升级动作由调度器另行触发。
 */
@Injectable()
export class DelegationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async membership(projectId: string, userId: string, write: boolean): Promise<void> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member || member.revokedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'PROJECT_NOT_FOUND',
        undefined,
        404,
      );
    if (write && member.role === 'MEMBER')
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'FORBIDDEN', undefined, 403);
  }

  async list(projectId: string, userId: string) {
    await this.membership(projectId, userId, false);
    return this.prisma.approvalSlotDelegation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async create(projectId: string, userId: string, input: CreateDelegationDto) {
    await this.membership(projectId, userId, true);
    const slot = await this.prisma.approvalSlot.findFirst({
      where: { id: input.slotId, projectId },
      select: { id: true, requiredUserId: true, requiredRoleId: true, reviewRequestId: true },
    });
    if (!slot)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'APPROVAL_SLOT_NOT_FOUND',
        { slotId: input.slotId },
        404,
      );
    if (slot.requiredUserId === input.delegateUserId)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'DELEGATE_IS_OWNER',
        undefined,
        422,
      );

    const delegate = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: input.delegateUserId } },
    });
    if (!delegate || delegate.revokedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'DELEGATE_NOT_MEMBER',
        { delegateUserId: input.delegateUserId },
        422,
      );

    // 同角色资格限制：槽位绑定业务角色时，被委托人必须持有该角色（有效 assignment）。
    if (slot.requiredRoleId) {
      const assignment = await this.prisma.projectRoleAssignment.findFirst({
        where: {
          projectId,
          userId: input.delegateUserId,
          roleId: slot.requiredRoleId,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!assignment)
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'DELEGATE_ROLE_MISMATCH',
          { requiredRoleId: slot.requiredRoleId, delegateUserId: input.delegateUserId },
          422,
        );
    }

    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'INVALID_DELEGATION_EXPIRY',
        undefined,
        422,
      );

    const active = await this.prisma.approvalSlotDelegation.findFirst({
      where: { slotId: input.slotId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (active)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'DELEGATION_EXISTS',
        { delegationId: active.id },
        409,
      );

    return this.prisma.approvalSlotDelegation.create({
      data: {
        projectId,
        slotId: input.slotId,
        delegatorUserId: slot.requiredUserId ?? userId,
        delegateUserId: input.delegateUserId,
        expiresAt,
      },
    });
  }

  async revoke(projectId: string, userId: string, delegationId: string) {
    await this.membership(projectId, userId, true);
    const revoked = await this.prisma.approvalSlotDelegation.updateMany({
      where: { id: delegationId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DELEGATION_NOT_FOUND',
        { delegationId },
        404,
      );
    return { revoked: true };
  }

  /** 到期未决定且未升级的槽位标记为已升级；只发提醒与升级，不自动批准。 */
  async escalate(projectId: string, userId: string) {
    await this.membership(projectId, userId, true);
    const now = new Date();
    const result = await this.prisma.approvalSlot.updateMany({
      where: {
        projectId,
        dueAt: { lte: now },
        escalatedAt: null,
        decisions: { none: {} },
      },
      data: { escalatedAt: now },
    });
    return { escalated: result.count };
  }

  async overdue(projectId: string, userId: string) {
    await this.membership(projectId, userId, false);
    return this.prisma.approvalSlot.findMany({
      where: {
        projectId,
        dueAt: { lte: new Date() },
        decisions: { none: {} },
      },
      orderBy: { dueAt: 'asc' },
      take: 100,
      select: {
        id: true,
        slotKey: true,
        kind: true,
        reviewRequestId: true,
        requiredUserId: true,
        requiredRoleId: true,
        dueAt: true,
      },
    });
  }
}
