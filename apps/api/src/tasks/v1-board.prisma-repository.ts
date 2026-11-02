import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClient as V1PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_BOARD_REPOSITORY, type V1BoardCard, type V1BoardRepository } from './v1-board.repository';

@Injectable()
export class V1BoardPrismaRepository implements V1BoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCards(projectId: string): Promise<V1BoardCard[]> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ generation: 'desc' }, { id: 'asc' }],
    });
    const claims = await this.prisma.taskClaim.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) }, releasedAt: null },
    });
    const claimByTask = new Map(claims.map((c) => [c.taskId, c]));
    return tasks.map((task) => {
      const claim = claimByTask.get(task.id);
      return {
        taskId: task.id,
        projectId: task.projectId,
        stepKey: task.stepKey,
        roleId: task.roleId,
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        currentClaimId: task.currentClaimId,
        currentArtifactSetId: task.currentArtifactSetId,
        claimedUserId: claim?.userId ?? null,
        claimedAt: claim?.claimedAt ? claim.claimedAt.toISOString() : null,
        generation: task.generation,
      };
    });
  }
}
