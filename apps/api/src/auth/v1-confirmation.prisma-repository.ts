import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { currentRequestId } from '../common/request-context.middleware';
import { PrismaService } from '../prisma/prisma.service';
import type {
  V1ConfirmationRepository,
  V1TicketCreateInput,
  V1TicketRecord,
} from './v1-confirmation';

@Injectable()
export class V1ConfirmationPrismaRepository implements V1ConfirmationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(input: V1TicketCreateInput): Promise<V1TicketRecord> {
    return this.prisma.$transaction(async (tx) => {
      await tx.confirmationTicket.updateMany({
        where: {
          userAuthVersion: input.userAuthVersion,
          userId: input.userId,
          webSessionId: input.webSessionId,
          action: input.action,
          targetId: input.targetId,
          projectId: input.projectId,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: input.now },
      });
      return tx.confirmationTicket.create({
        data: {
          id: input.id,
          secretHash: input.secretHash,
          userId: input.userId,
          webSessionId: input.webSessionId,
          projectId: input.projectId,
          userAuthVersion: input.userAuthVersion,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          expectedVersion: input.expectedVersion,
          actionDigest: input.actionDigest,
          roleId: input.roleId,
          approvalSlotId: input.approvalSlotId,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.prisma.confirmationTicket.findUnique({ where: { id: ticketId } });
  }

  /**
   * 条件消费：只有未消费、未失效、未过期且属于同一 WebSession 且 secretHash 相同的行才更新成功。
   * 并发两次消费只允许一次影响行数为 1。
   */
  async consumeTicket(input: {
    ticketId: string;
    secretHash: string;
    webSessionId: string;
    operationId: string;
    now: Date;
  }): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    const updated = await this.prisma.$executeRaw(
      Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
        SET "consumedAt" = ${input.now}, "consumedRequestId" = ${currentRequestId() ?? randomUUID()}::uuid, "consumedOperationId" = ${input.operationId}::uuid
        WHERE "id" = ${input.ticketId}::uuid
          AND "secretHash" = ${input.secretHash}
          AND "webSessionId" = ${input.webSessionId}::uuid
          AND "consumedAt" IS NULL
          AND "invalidatedAt" IS NULL
          AND "expiresAt" > ${input.now}`,
    );
    if (updated !== 1) return { consumed: false, ticket: await this.findTicket(input.ticketId) };
    return { consumed: true, ticket: await this.findTicket(input.ticketId) };
  }
}
