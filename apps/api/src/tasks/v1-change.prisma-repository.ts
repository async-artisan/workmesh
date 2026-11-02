import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { V1OperationRecord } from '../common/v1-idempotency';

import {
  type V1AckInput,
  type V1AckResult,
  type V1ChangeEventSnapshot,
  type V1ChangeEventWithRecipients,
  type V1ChangeListQuery,
  type V1ChangeListResult,
  type V1ChangeRecipientSnapshot,
  type V1ChangeRepository,
  type V1RecordChangeInput,
  type V1RecordChangeResult,
} from './v1-change.repository';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

function toRecipientSnapshot(row: {
  id: string;
  projectId: string;
  eventId: string;
  userId: string;
  roleId: string | null;
  version: number;
  ackedAt: Date | null;
  createdAt: Date;
}): V1ChangeRecipientSnapshot {
  return {
    id: row.id,
    projectId: row.projectId,
    eventId: row.eventId,
    userId: row.userId,
    roleId: row.roleId,
    version: row.version,
    ackedAt: row.ackedAt ? row.ackedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toEventSnapshot(row: {
  id: string;
  projectId: string;
  requirementId: string | null;
  sourceKind: string;
  sourceId: string;
  changedFields: string[];
  targets: unknown;
  createdAt: Date;
}): V1ChangeEventSnapshot {
  return {
    id: row.id,
    projectId: row.projectId,
    requirementId: row.requirementId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    changedFields: row.changedFields,
    targets: row.targets,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class V1ChangePrismaRepository implements V1ChangeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async recordChange(input: V1RecordChangeInput): Promise<V1RecordChangeResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const project = await tx.project.findUnique({ where: { id: input.projectId } });
            if (!project)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'PROJECT_NOT_FOUND',
                { projectId: input.projectId },
                404,
              );
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
            );

            const event = await tx.changeEvent.create({
              data: {
                projectId: input.projectId,
                requirementId: input.requirementId,
                sourceKind: input.sourceKind,
                sourceId: input.sourceId,
                changedFields: input.changedFields,
                targets: input.targets as Prisma.InputJsonValue,
              },
            });

            const recipients: V1ChangeRecipientSnapshot[] = [];
            for (const r of input.recipients) {
              const created = await tx.changeRecipient.create({
                data: {
                  projectId: input.projectId,
                  eventId: event.id,
                  userId: r.userId,
                  roleId: r.roleId ?? null,
                },
              });
              recipients.push(toRecipientSnapshot(created));
            }

            const op = await tx.idempotentOperation.create({
              data: {
                id: input.operation.id,
                projectId: input.projectId,
                projectScopeKey: input.operation.projectScopeKey,
                principalScopeKey: input.operation.principalScopeKey,
                key: input.operation.key,
                method: input.operation.method,
                route: input.operation.route,
                requestDigest: input.operation.requestDigest,
                resultRefs: { eventId: event.id },
                responseMetadata: {},
                committedAt: input.operation.now,
              },
            });
            const idempotency = this.toOperationRecord(op);

            return {
              event: toEventSnapshot(event),
              recipients,
              idempotency,
            } satisfies V1RecordChangeResult;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  async findEvent(id: string): Promise<V1ChangeEventWithRecipients | null> {
    const event = await this.prisma.changeEvent.findUnique({ where: { id } });
    if (!event) return null;
    const recipients = await this.prisma.changeRecipient.findMany({ where: { eventId: id } });
    return {
      ...toEventSnapshot(event),
      recipients: recipients.map(toRecipientSnapshot),
    };
  }

  async findRecipient(id: string): Promise<V1ChangeRecipientSnapshot | null> {
    const row = await this.prisma.changeRecipient.findUnique({ where: { id } });
    return row ? toRecipientSnapshot(row) : null;
  }

  async ack(input: V1AckInput): Promise<V1AckResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const recipient = await tx.changeRecipient.findUnique({ where: { id: input.id } });
            if (!recipient)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'CHANGE_RECIPIENT_NOT_FOUND',
                { recipientId: input.id },
                404,
              );

            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${recipient.projectId}::uuid FOR UPDATE`,
            );

            // 已确认：幂等返回，无需重复写入。
            if (recipient.ackedAt !== null) {
              const op = await tx.idempotentOperation.create({
                data: {
                  id: input.operation.id,
                  projectId: recipient.projectId,
                  projectScopeKey: input.operation.projectScopeKey,
                  principalScopeKey: input.operation.principalScopeKey,
                  key: input.operation.key,
                  method: input.operation.method,
                  route: input.operation.route,
                  requestDigest: input.operation.requestDigest,
                  resultRefs: {
                    recipientId: recipient.id,
                    ackedAt: recipient.ackedAt.toISOString(),
                    replayed: true,
                  },
                  responseMetadata: {},
                  committedAt: input.operation.now,
                },
              });
              return {
                recipient: toRecipientSnapshot(recipient),
                idempotency: this.toOperationRecord(op),
              } satisfies V1AckResult;
            }

            // 乐观并发：expectedVersion 提供且与当前不一致时拒绝。
            if (input.expectedVersion !== undefined && input.expectedVersion !== recipient.version)
              throw new WorkmeshError(
                V1_ERROR_CODES.VERSION_CONFLICT,
                'CHANGE_RECIPIENT_VERSION_CONFLICT',
                {
                  recipientId: recipient.id,
                  expectedVersion: input.expectedVersion,
                  currentVersion: recipient.version,
                },
                409,
              );

            // 并发确认单胜：仅首个 ackedAt=null 的更新成功；其余读到 ackedAt 后幂等返回。
            const updated = await tx.changeRecipient.updateMany({
              where: { id: recipient.id, ackedAt: null },
              data: { ackedAt: input.operation.now, version: { increment: 1 } },
            });
            if (updated.count === 0) {
              const reloaded = await tx.changeRecipient.findUnique({ where: { id: recipient.id } });
              if (reloaded && reloaded.ackedAt !== null)
                return {
                  recipient: toRecipientSnapshot(reloaded),
                  idempotency: this.toOperationRecord(
                    await tx.idempotentOperation.create({
                      data: {
                        id: input.operation.id,
                        projectId: recipient.projectId,
                        projectScopeKey: input.operation.projectScopeKey,
                        principalScopeKey: input.operation.principalScopeKey,
                        key: input.operation.key,
                        method: input.operation.method,
                        route: input.operation.route,
                        requestDigest: input.operation.requestDigest,
                        resultRefs: {
                          recipientId: recipient.id,
                          ackedAt: reloaded.ackedAt.toISOString(),
                          replayed: true,
                        },
                        responseMetadata: {},
                        committedAt: input.operation.now,
                      },
                    }),
                  ),
                } satisfies V1AckResult;
              throw new WorkmeshError(
                V1_ERROR_CODES.VERSION_CONFLICT,
                'CHANGE_RECIPIENT_VERSION_CONFLICT',
                { recipientId: recipient.id },
                409,
              );
            }

            const acked = await tx.changeRecipient.findUnique({ where: { id: recipient.id } });
            if (!acked)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'CHANGE_RECIPIENT_NOT_FOUND',
                { recipientId: recipient.id },
                404,
              );

            const op = await tx.idempotentOperation.create({
              data: {
                id: input.operation.id,
                projectId: recipient.projectId,
                projectScopeKey: input.operation.projectScopeKey,
                principalScopeKey: input.operation.principalScopeKey,
                key: input.operation.key,
                method: input.operation.method,
                route: input.operation.route,
                requestDigest: input.operation.requestDigest,
                resultRefs: { recipientId: acked.id, ackedAt: acked.ackedAt!.toISOString() },
                responseMetadata: {},
                committedAt: input.operation.now,
              },
            });

            return {
              recipient: toRecipientSnapshot(acked),
              idempotency: this.toOperationRecord(op),
            } satisfies V1AckResult;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  async listRecipients(query: V1ChangeListQuery): Promise<V1ChangeListResult> {
    const where: Prisma.ChangeRecipientWhereInput = { userId: query.userId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.ackedOnly) where.ackedAt = { not: null };

    if (query.cursor) {
      const cursorRow = await this.prisma.changeRecipient.findUnique({
        where: { id: query.cursor },
      });
      if (cursorRow) {
        where.OR = [
          { createdAt: { lt: cursorRow.createdAt } },
          { createdAt: cursorRow.createdAt, id: { lt: cursorRow.id } },
        ];
      }
    }

    const rows = await this.prisma.changeRecipient.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].id : null;
    return { items: page.map(toRecipientSnapshot), nextCursor };
  }

  private toOperationRecord(op: {
    id: string;
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
    method: string;
    route: string;
    requestDigest: string;
    resultRefs: unknown;
    committedAt: Date | null;
  }): V1OperationRecord {
    return {
      id: op.id,
      projectScopeKey: op.projectScopeKey,
      principalScopeKey: op.principalScopeKey,
      key: op.key,
      method: op.method,
      route: op.route,
      requestDigest: op.requestDigest,
      resultRefs: op.resultRefs as Record<string, unknown>,
      committedAt: op.committedAt,
    };
  }
}
