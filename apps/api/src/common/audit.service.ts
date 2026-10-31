import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  constructor(private readonly prisma: PrismaService) {}
  async log(data: {
    actorId?: string;
    action: string;
    target: string;
    targetId?: string;
    metadata?: unknown;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: data.actorId,
          action: data.action,
          target: data.target,
          targetId: data.targetId,
          metadata: data.metadata as any,
        },
      });
    } catch (error) {
      this.logger.warn(
        `audit log unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
