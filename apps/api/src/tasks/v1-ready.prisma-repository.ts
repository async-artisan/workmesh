import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { PrismaService } from '../prisma/prisma.service';
import {
  type V1ReadyCandidate,
  type V1ReadyCandidatePage,
  type V1ReadyInstanceStep,
  type V1ReadyOwnership,
  type V1ReadyRepository,
  type V1ReadyRevisionSteps,
} from './v1-ready.repository';

function ownershipFilter(ownership: V1ReadyOwnership): Prisma.TaskWhereInput[] {
  switch (ownership.kind) {
    case 'ALL':
      return [];
    case 'AGENT':
      return [{ roleId: ownership.roleId }];
    case 'HUMAN': {
      const filters: Prisma.TaskWhereInput[] = [
        { responsibleUserId: ownership.userId },
        ...(ownership.roleIds.length > 0 ? [{ roleId: { in: [...ownership.roleIds] } }] : []),
      ];
      return [{ OR: filters }];
    }
  }
}

function parseSteps(definition: unknown): Array<{ key: string; deps: string[] }> {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return [];
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const parsed: Array<{ key: string; deps: string[] }> = [];
  for (const raw of steps) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const key = (raw as { key?: unknown }).key;
    if (typeof key !== 'string') continue;
    const deps = (raw as { deps?: unknown }).deps;
    parsed.push({ key, deps: Array.isArray(deps) ? deps.filter((dep): dep is string => typeof dep === 'string') : [] });
  }
  return parsed;
}

@Injectable()
export class V1ReadyPrismaRepository implements V1ReadyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listCandidates(input: {
    projectId: string;
    roleId: string | null;
    ownership: V1ReadyOwnership;
    after: { stepKey: string; id: string } | null;
    take: number;
  }): Promise<V1ReadyCandidatePage> {
    const and: Prisma.TaskWhereInput[] = ownershipFilter(input.ownership);
    if (input.after) {
      and.push({
        OR: [
          { stepKey: { gt: input.after.stepKey } },
          { stepKey: input.after.stepKey, id: { gt: input.after.id } },
        ],
      });
    }

    const rows = await this.prisma.task.findMany({
      where: {
        projectId: input.projectId,
        executionStatus: 'OPEN',
        currentClaimId: null,
        workStatus: 'ACTIVE',
        instance: { retiredAt: null },
        ...(input.roleId ? { roleId: input.roleId } : {}),
        ...(and.length > 0 ? { AND: and } : {}),
      },
      orderBy: [{ stepKey: 'asc' }, { id: 'asc' }],
      take: input.take + 1,
      include: { instance: { select: { definitionRevisionId: true } } },
    });

    const items = rows.slice(0, input.take).map((row) => ({
      id: row.id,
      projectId: row.projectId,
      workflowInstanceId: row.workflowInstanceId,
      stepKey: row.stepKey,
      roleId: row.roleId,
      responsibleUserId: row.responsibleUserId,
      version: row.version,
      generation: row.generation,
      executionStatus: row.executionStatus,
      workStatus: row.workStatus,
      currentClaimId: row.currentClaimId,
      definitionRevisionId: row.instance.definitionRevisionId,
    }));
    return { items, hasMore: rows.length > input.take };
  }

  async findRevisionSteps(revisionIds: readonly string[]): Promise<V1ReadyRevisionSteps[]> {
    if (revisionIds.length === 0) return [];
    const rows = await this.prisma.workflowRevision.findMany({
      where: { id: { in: [...revisionIds] } },
      select: { id: true, projectId: true, definition: true },
    });
    return rows.map((row) => ({ revisionId: row.id, projectId: row.projectId, steps: parseSteps(row.definition) }));
  }

  async listInstanceTasks(instanceIds: readonly string[]): Promise<V1ReadyInstanceStep[]> {
    if (instanceIds.length === 0) return [];
    const rows = await this.prisma.task.findMany({
      where: { workflowInstanceId: { in: [...instanceIds] } },
      select: { workflowInstanceId: true, stepKey: true, executionStatus: true },
    });
    return rows.map((row) => ({
      workflowInstanceId: row.workflowInstanceId,
      stepKey: row.stepKey,
      executionStatus: row.executionStatus,
    }));
  }
}
