import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { V1WorkflowPrismaRepository } from './v1-workflow.prisma-repository';

describe('V1WorkflowPrismaRepository instance step labels', () => {
  it('keeps the legacy name fallback null when the bound definition omits displayName', async () => {
    const prisma = {
      workflowInstance: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'legacy-instance',
          projectId: 'project-1',
          requirementId: 'req-1',
          definitionRevisionId: 'legacy-revision',
          definitionDigest: 'legacy-digest',
          version: 1,
          workStatus: 'ACTIVE',
          retiredAt: null,
          bindings: {},
          tasks: [
            {
              stepKey: 'build',
              roleId: 'role-1',
              responsibleUserId: 'user-1',
              executionStatus: 'OPEN',
              workStatus: 'ACTIVE',
              generation: 1,
              version: 1,
              acceptanceKeys: [],
            },
          ],
        }),
      },
      workflowRevision: {
        findFirst: vi.fn().mockResolvedValue({ definition: { steps: [{ key: 'build' }] } }),
      },
    };
    const repository = new V1WorkflowPrismaRepository(prisma as unknown as PrismaService);
    expect((await repository.findInstance('legacy-instance'))?.steps[0]).toMatchObject({
      stepKey: 'build',
      stepDisplayName: null,
    });
    expect(prisma.workflowRevision.findFirst).toHaveBeenCalledWith({
      where: { id: 'legacy-revision', projectId: 'project-1' },
      select: { definition: true },
    });
  });
  it('resolves each instance against its bound project revision, never a newer revision', async () => {
    const workflowInstance = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({
          id: 'instance-v1',
          projectId: 'project-1',
          requirementId: 'req-1',
          definitionRevisionId: 'revision-v1',
          definitionDigest: 'digest-v1',
          version: 1,
          workStatus: 'ACTIVE',
          retiredAt: null,
          bindings: {},
          tasks: [
            {
              stepKey: 'implementation',
              roleId: 'role-1',
              responsibleUserId: 'user-1',
              executionStatus: 'OPEN',
              workStatus: 'ACTIVE',
              generation: 1,
              version: 1,
              acceptanceKeys: [],
            },
          ],
        })
        .mockResolvedValueOnce({
          id: 'instance-v2',
          projectId: 'project-1',
          requirementId: 'req-2',
          definitionRevisionId: 'revision-v2',
          definitionDigest: 'digest-v2',
          version: 1,
          workStatus: 'ACTIVE',
          retiredAt: null,
          bindings: {},
          tasks: [
            {
              stepKey: 'implementation',
              roleId: 'role-1',
              responsibleUserId: 'user-1',
              executionStatus: 'OPEN',
              workStatus: 'ACTIVE',
              generation: 1,
              version: 1,
              acceptanceKeys: [],
            },
          ],
        }),
    };
    const workflowRevision = {
      findFirst: vi
        .fn()
        .mockResolvedValueOnce({
          definition: { steps: [{ key: 'implementation', displayName: '旧版步骤名' }] },
        })
        .mockResolvedValueOnce({
          definition: { steps: [{ key: 'implementation', displayName: '新版步骤名' }] },
        }),
    };
    const repository = new V1WorkflowPrismaRepository({
      workflowInstance,
      workflowRevision,
    } as unknown as PrismaService);

    expect((await repository.findInstance('instance-v1'))?.steps[0].stepDisplayName).toBe(
      '旧版步骤名',
    );
    expect((await repository.findInstance('instance-v2'))?.steps[0].stepDisplayName).toBe(
      '新版步骤名',
    );
    expect(workflowRevision.findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: 'revision-v1', projectId: 'project-1' },
      select: { definition: true },
    });
    expect(workflowRevision.findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: 'revision-v2', projectId: 'project-1' },
      select: { definition: true },
    });
  });
});
