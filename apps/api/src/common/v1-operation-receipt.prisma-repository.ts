import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  V1_OPERATION_RECEIPT_REPOSITORY,
  type V1OperationReceiptRecord,
  type V1OperationReceiptRepository,
} from './v1-operation-receipt.repository';

function resultRefsOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

@Injectable()
export class V1OperationReceiptPrismaRepository implements V1OperationReceiptRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperations(input: { projectScopeKey: string; key: string }): Promise<V1OperationReceiptRecord[]> {
    const rows = await this.prisma.idempotentOperation.findMany({
      where: { projectScopeKey: input.projectScopeKey, key: input.key },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        projectId: true,
        projectScopeKey: true,
        principalScopeKey: true,
        key: true,
        method: true,
        route: true,
        requestDigest: true,
        resultRefs: true,
        committedAt: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      projectId: row.projectId,
      projectScopeKey: row.projectScopeKey,
      principalScopeKey: row.principalScopeKey,
      key: row.key,
      method: row.method,
      route: row.route,
      requestDigest: row.requestDigest,
      resultRefs: resultRefsOf(row.resultRefs),
      committedAt: row.committedAt,
    }));
  }

  async findAgentCredentialOwner(credentialId: string): Promise<string | null> {
    const row = await this.prisma.agentCredential.findUnique({
      where: { id: credentialId },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }
}
