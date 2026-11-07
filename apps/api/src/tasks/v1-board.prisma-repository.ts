import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { workflowStepDisplayNameOf } from '@workmesh/shared';
import { type V1BoardCard, type V1BoardRepository } from './v1-board.repository';

@Injectable()
export class V1BoardPrismaRepository implements V1BoardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCards(projectId: string): Promise<V1BoardCard[]> {
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ generation: 'desc' }, { id: 'asc' }],
      include: {
        role: { select: { key: true, title: true } },
        instance: {
          select: {
            definitionRevisionId: true,
            requirement: { select: { id: true, code: true, title: true } },
          },
        },
        responsibleUser: { select: { email: true } },
      },
    });
    const claims = await this.prisma.taskClaim.findMany({
      where: { taskId: { in: tasks.map((t) => t.id) }, releasedAt: null },
      include: { user: { select: { email: true } } },
    });
    const claimByTask = new Map(claims.map((c) => [c.taskId, c]));
    const revisionIds = [
      ...new Set(
        tasks.flatMap((task) =>
          task.instance.definitionRevisionId ? [task.instance.definitionRevisionId] : [],
        ),
      ),
    ];
    const revisions = revisionIds.length
      ? await this.prisma.workflowRevision.findMany({
          where: { id: { in: revisionIds }, projectId },
          select: { id: true, definition: true },
        })
      : [];
    const definitionByRevision = new Map(
      revisions.map((revision) => [revision.id, revision.definition]),
    );
    return tasks.map((task) => {
      const claim = claimByTask.get(task.id);
      return {
        taskId: task.id,
        projectId: task.projectId,
        stepKey: task.stepKey,
        stepDisplayName: task.instance.definitionRevisionId
          ? workflowStepDisplayNameOf(
              definitionByRevision.get(task.instance.definitionRevisionId),
              task.stepKey,
            )
          : null,
        roleId: task.roleId,
        requirementId: task.instance.requirement.id,
        requirementCode: task.instance.requirement.code,
        requirementTitle: task.instance.requirement.title,
        roleKey: task.role.key,
        roleTitle: task.role.title,
        responsibleUserEmail: task.responsibleUser.email,
        claimedUserEmail: claim?.user.email,
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
