import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import { V1TaskPrismaRepository } from './v1-task.prisma-repository';
import { V1TaskService } from './v1-task.service';

function fixture() {
  const project = { id: 'project-1', archivedAt: null as Date | null };
  const task = {
    id: 'task-1',
    projectId: 'project-1',
    workflowInstanceId: 'instance-1',
    stepKey: 'verify',
    roleId: 'qa',
    responsibleUserId: 'user-1',
    version: 1,
    generation: 1,
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
  };
  const credential = {
    id: 'credential-1',
    userId: 'user-1',
    projectId: 'project-1',
    roleId: 'qa',
    revokedAt: null as Date | null,
    expiresAt: new Date('2099-01-01'),
    userAuthVersion: 1,
    scopes: ['task:claim'],
  };
  const tx = {
    $queryRaw: vi.fn().mockImplementation(async () => [{ ...project }]),
    task: {
      findUnique: vi.fn().mockImplementation(async () => ({ ...task })),
      findMany: vi
        .fn()
        .mockResolvedValue([{ stepKey: 'impl', executionStatus: 'DONE', workStatus: 'ACTIVE' }]),
      update: vi.fn().mockImplementation(async ({ data }: { data: { currentClaimId: string } }) => {
        task.currentClaimId = data.currentClaimId as never;
        task.version += 1;
        task.generation += 1;
        return { ...task };
      }),
    },
    workflowInstance: {
      findUnique: vi.fn().mockResolvedValue({ definitionRevisionId: 'revision-1' }),
      findFirst: vi.fn().mockResolvedValue({
        retiredAt: null,
        definitionRevisionId: 'revision-1',
        workStatus: 'ACTIVE',
        requirementId: 'requirement-1',
      }),
    },
    projectMember: { findFirst: vi.fn().mockResolvedValue({ role: 'MEMBER' }) },
    projectRoleAssignment: { findFirst: vi.fn().mockResolvedValue({ roleId: task.roleId }) },
    user: { findUnique: vi.fn().mockResolvedValue({ isActive: true, authVersion: 1 }) },
    agentCredential: { findUnique: vi.fn().mockImplementation(async () => ({ ...credential })) },
    requirement: { findUnique: vi.fn().mockResolvedValue({ workStatus: 'ACTIVE' }) },
    workflowRevision: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ definition: { steps: [{ key: 'verify', deps: ['impl'] }] } }),
      findUnique: vi.fn().mockResolvedValue({
        projectId: task.projectId,
        definition: { steps: [{ key: 'verify', deps: ['impl'] }] },
      }),
    },
    taskClaim: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'claim-1' }),
      findUnique: vi.fn().mockResolvedValue({
        id: 'claim-1',
        taskGeneration: 2,
        userId: 'user-1',
        credentialId: 'credential-1',
        releasedAt: null,
      }),
    },
    idempotentOperation: { create: vi.fn().mockResolvedValue({}) },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const repository = new V1TaskPrismaRepository(db as unknown as PrismaService);
  const input = {
    taskId: task.id,
    expectedGeneration: 1,
    principalScopeKey: 'agent:credential-1',
    userId: 'user-1',
    credentialId: 'credential-1' as string | null,
    now: new Date('2026-11-07'),
    operation: {
      id: 'operation-1',
      projectScopeKey: 'project:project-1',
      principalScopeKey: 'agent:credential-1',
      key: 'key-1',
      method: 'POST',
      route: '/tasks/task-1/claims',
      requestDigest: 'a'.repeat(64),
    },
  };
  return { project, task, credential, tx, db, repository, input };
}

describe('task claim transaction authorization and dependencies', () => {
  it('rejects an archive that wins after the service write precheck without any claim writes', async () => {
    const f = fixture();
    const authorization = {
      resolveProjectContext: vi.fn().mockResolvedValue({
        project: { id: f.project.id, archivedAt: null },
        activeRoleIds: [f.task.roleId],
      }),
      requireScope: vi.fn().mockResolvedValue(undefined),
    };
    const operations = {
      findOperation: vi.fn().mockImplementation(async () => {
        // The request passed authorization while the project was writable.
        f.project.archivedAt = new Date('2026-11-07T01:00:00Z');
        return null;
      }),
    };
    const service = new V1TaskService(
      f.repository,
      authorization as unknown as V1AuthorizationService,
      operations,
    );
    await expect(
      service.claim(
        {
          kind: 'AGENT',
          userId: f.input.userId,
          agentCredentialId: f.credential.id,
          projectId: f.project.id,
          roleIds: [f.task.roleId],
          scopes: ['task:claim'],
        },
        f.task.id,
        {
          idempotencyKey: f.input.operation.key,
          method: f.input.operation.method,
          route: f.input.operation.route,
          body: {},
          requestId: 'request-1',
          now: f.input.now,
          operationId: f.input.operation.id,
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
      message: 'PROJECT_ARCHIVED',
      details: { projectId: f.project.id, archivedAt: '2026-11-07T01:00:00.000Z' },
    });
    expect(authorization.resolveProjectContext).toHaveBeenCalledWith(
      expect.anything(),
      f.project.id,
      'write',
    );
    expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
    expect(f.tx.task.update).not.toHaveBeenCalled();
    expect(f.tx.idempotentOperation.create).not.toHaveBeenCalled();
  });

  it('allows the responsible member own current role credential after locked reads', async () => {
    const f = fixture();
    await expect(f.repository.claim(f.input)).resolves.toMatchObject({
      generation: 2,
      currentClaim: { id: 'claim-1' },
    });
    expect(f.tx.task.findUnique.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(f.tx.taskClaim.create).toHaveBeenCalledOnce();
  });

  it('allows a responsible HUMAN with a current role assignment', async () => {
    const f = fixture();
    f.input.credentialId = null;
    f.input.principalScopeKey = 'user:user-1';
    await expect(f.repository.claim(f.input)).resolves.toMatchObject({ generation: 2 });
    expect(f.tx.agentCredential.findUnique).not.toHaveBeenCalled();
  });

  for (const scenario of [
    'wrong-role',
    'other-user',
    'revoked',
    'expired',
    'scope-removed',
    'auth-version-changed',
  ] as const)
    it(`rejects credential ${scenario} without creating a claim or operation`, async () => {
      const f = fixture();
      if (scenario === 'wrong-role') f.credential.roleId = 'frontend';
      if (scenario === 'other-user') f.credential.userId = 'other';
      if (scenario === 'revoked') f.credential.revokedAt = f.input.now;
      if (scenario === 'expired') f.credential.expiresAt = f.input.now;
      if (scenario === 'scope-removed') f.credential.scopes = [];
      if (scenario === 'auth-version-changed') f.credential.userAuthVersion = 0;
      await expect(f.repository.claim(f.input)).rejects.toMatchObject({
        status: 403,
        message: 'TASK_NOT_IN_RESPONSIBILITY',
      });
      expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
      expect(f.tx.idempotentOperation.create).not.toHaveBeenCalled();
    });

  it('rechecks responsibility after acquiring the project lock', async () => {
    const f = fixture();
    f.tx.$queryRaw.mockImplementation(async () => {
      f.task.responsibleUserId = 'other';
      return [{ ...f.project }];
    });
    await expect(f.repository.claim(f.input)).rejects.toMatchObject({ status: 403 });
    expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
  });

  it('rechecks the active role assignment inside the transaction', async () => {
    const f = fixture();
    f.tx.projectRoleAssignment.findFirst.mockResolvedValue(null);
    await expect(f.repository.claim(f.input)).rejects.toMatchObject({ status: 403 });
    expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
  });

  for (const state of ['OPEN', 'REVIEW_PENDING'])
    it(`refuses a predecessor that is ${state} rather than DONE`, async () => {
      const f = fixture();
      f.tx.task.findMany.mockResolvedValue([
        { stepKey: 'impl', executionStatus: state, workStatus: 'ACTIVE' },
      ]);
      await expect(f.repository.claim(f.input)).rejects.toMatchObject({
        status: 409,
        message: 'TASK_DEPENDENCIES_NOT_DONE',
      });
      expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
    });

  it('fails closed when an expected predecessor is missing', async () => {
    const f = fixture();
    f.tx.task.findMany.mockResolvedValue([]);
    await expect(f.repository.claim(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'TASK_DEPENDENCIES_NOT_DONE',
    });
  });

  it('rejects task and parent states that cannot be claimed', async () => {
    const f = fixture();
    f.task.executionStatus = 'DONE';
    await expect(f.repository.claim(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'TASK_NOT_READY',
    });
    expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
  });

  it('preserves double-claim exclusion after authorization succeeds', async () => {
    const f = fixture();
    f.tx.taskClaim.findFirst.mockResolvedValue({ id: 'other-claim' });
    await expect(f.repository.claim(f.input)).rejects.toMatchObject({
      status: 409,
      message: 'CLAIM_CONFLICT',
    });
    expect(f.tx.taskClaim.create).not.toHaveBeenCalled();
  });
});
