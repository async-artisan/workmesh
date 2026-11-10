import { describe, expect, it, vi } from 'vitest';
import { buildStandardWorkflowTemplate } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import { V1SnapshotPrismaRepository } from './v1-snapshot.prisma-repository';

const PROJECT_ID = 'p-1';
const INSTANCE_ID = 'inst-1';
const REVISION_ID = 'rev-1';
const TASK_ID = 'task-cases';

/** 已发布修订：正文里有 steps，compiledRules 里只有服务端派生规则（真实形状）。 */
function revision() {
  return {
    id: REVISION_ID,
    projectId: PROJECT_ID,
    digest: 'd'.repeat(64),
    definition: buildStandardWorkflowTemplate(),
    compiledRules: { resolvedRoles: [], packageLocks: [], systemGates: [] },
  };
}

function task(stepKey: string) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    workflowInstanceId: INSTANCE_ID,
    version: 2,
    generation: 3,
    stepKey,
    roleId: 'r-frontend',
    responsibleUserId: 'u-1',
    currentClaimId: null,
    currentSnapshotId: null,
    retiredAt: null,
    role: { key: 'frontend' },
    instance: {
      definitionRevisionId: REVISION_ID,
      retiredAt: null,
      requirement: {
        id: 'req-1',
        generation: 1,
        version: 5,
        phase: 'DISCOVERY',
        currentUnderstandingRevisionId: null,
        currentPrdRevisionId: null,
        deliveryScope: null,
      },
    },
  };
}

function build(
  options: { stepKey?: string; dependencyTasks?: unknown[]; artifacts?: unknown[] } = {},
) {
  const prisma = {
    task: {
      findUnique: vi.fn(async () => task(options.stepKey ?? 'impl')),
      findMany: vi.fn(async () => options.dependencyTasks ?? []),
    },
    workflowInstance: {
      findUnique: vi.fn(async () => ({ definitionRevisionId: REVISION_ID })),
    },
    workflowRevision: { findUnique: vi.fn(async () => revision()) },
    project: { findUnique: vi.fn(async () => ({ knowledgeBindingsVersion: 1 })) },
    taskClaim: { findUnique: vi.fn(async () => null) },
    reviewRequest: { findFirst: vi.fn(async () => ({ id: 'review-1' })) },
    artifact: { findMany: vi.fn(async () => options.artifacts ?? []) },
  };
  return {
    repository: new V1SnapshotPrismaRepository(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('V1SnapshotPrismaRepository 步骤语义来源', () => {
  it('impl 步骤从已发布定义拿到 PRD 基线，而不是恒为 NONE', async () => {
    const { repository, prisma } = build({ stepKey: 'impl' });
    const state = await repository.findTaskState(TASK_ID);
    expect(state?.baselinePolicy).toBe('PUBLISHED_PRD');
    // 快照读取必须拿整条修订（含 definition）；compiledRules 里没有 steps。
    expect(prisma.workflowRevision.findUnique).toHaveBeenCalledWith({
      where: { id: REVISION_ID },
    });
  });

  it('prd 步骤保持 NONE，不被其它步骤的基线策略污染', async () => {
    const { repository } = build({ stepKey: 'prd' });
    const state = await repository.findTaskState(TASK_ID);
    expect(state?.baselinePolicy).toBe('NONE');
  });

  it('下游步骤按定义里的 deps 查询上游任务，并只取已验收的工件', async () => {
    const { repository, prisma } = build({
      stepKey: 'cases',
      dependencyTasks: [{ id: 'task-impl', generation: 3, currentArtifactSetId: 'set-1' }],
      artifacts: [
        { id: 'art-1', sha256: 'a'.repeat(64), byteLength: 12, mediaType: 'text/markdown' },
      ],
    });

    const artifacts = await repository.listAcceptedPrerequisiteArtifacts(TASK_ID);

    expect(prisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: PROJECT_ID,
          workflowInstanceId: INSTANCE_ID,
          stepKey: { in: ['impl'] },
          executionStatus: 'DONE',
          workStatus: 'ACTIVE',
        },
      }),
    );
    expect(prisma.reviewRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          taskId: 'task-impl',
          taskGeneration: 3,
          artifactSetId: 'set-1',
          status: 'APPROVED',
          kind: 'TASK_ACCEPTANCE',
        }),
      }),
    );
    expect(artifacts).toEqual([
      { artifactId: 'art-1', sha256: 'a'.repeat(64), byteLength: 12, mediaType: 'text/markdown' },
    ]);
    expect(prisma.artifact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: PROJECT_ID,
          artifactSet: { OR: [{ id: 'set-1', taskId: 'task-impl', taskGeneration: 3 }] },
        }),
      }),
    );
  });

  it('返回上游步骤与工件类型，支持输入绑定按来源精确匹配', async () => {
    const { repository } = build({
      stepKey: 'cases',
      dependencyTasks: [{ id: 'task-prd', stepKey: 'prd', currentArtifactSetId: 'set-prd' }],
      artifacts: [
        {
          id: 'art-prd',
          artifactSetId: 'set-prd',
          kind: 'PRD',
          sha256: 'a'.repeat(64),
          byteLength: 12,
          mediaType: 'text/markdown',
        },
      ],
    });

    await expect(repository.listAcceptedPrerequisiteArtifacts(TASK_ID)).resolves.toEqual([
      expect.objectContaining({
        artifactId: 'art-prd',
        sourceStepKey: 'prd',
        kind: 'PRD',
      }),
    ]);
  });

  it('没有依赖的步骤不产生任何上游查询', async () => {
    const { repository, prisma } = build({ stepKey: 'understanding' });
    await expect(repository.listAcceptedPrerequisiteArtifacts(TASK_ID)).resolves.toEqual([]);
    expect(prisma.task.findMany).not.toHaveBeenCalled();
  });
});
