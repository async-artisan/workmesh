import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { V1IdempotencyRepository, V1OperationRecord } from './v1-idempotency';

@Injectable()
export class V1IdempotencyPrismaRepository implements V1IdempotencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return this.prisma.idempotentOperation.findUnique({
      where: {
        projectScopeKey_principalScopeKey_key: {
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.key,
        },
      },
      select: {
        id: true,
        projectScopeKey: true,
        principalScopeKey: true,
        key: true,
        method: true,
        route: true,
        requestDigest: true,
        resultRefs: true,
        committedAt: true,
      },
    }) as Promise<V1OperationRecord | null>;
  }
}
