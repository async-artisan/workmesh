import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { V1TaskPrismaRepository } from '../src/tasks/v1-task.prisma-repository';
import { V1TaskService } from '../src/tasks/v1-task.service';
import { V1AuthorizationService } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { V1GithubEvidencePrismaRepository } from '../src/integrations/v1-github-evidence.prisma-repository';
import { openTicketSecret, sealTicketSecret } from '../src/integrations/v1-ticket-secret';
import { V1SnapshotPrismaRepository } from '../src/tasks/v1-snapshot.prisma-repository';
import { V1ArtifactPrismaRepository } from '../src/tasks/v1-artifact.prisma-repository';
import { assembleSnapshotManifest } from '../src/tasks/v1-snapshot-policy';
import type { V1CreateSnapshotInput } from '../src/tasks/v1-snapshot.repository';
import type { V1DeliverInput } from '../src/tasks/v1-artifact.repository';
import { V1ReviewPrismaRepository } from '../src/reviews/v1-review.prisma-repository';
import type { V1CommitDecisionInput } from '../src/reviews/v1-review.repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;

suite('PostgreSQL task ownership and transactional writes', () => {
  let db: PrismaClient;
  let repository: V1TaskPrismaRepository;
  let projectId: string;
  let userId: string;
  let roleId: string;
  let instanceId: string;
  let revisionId: string;
  let definitionId: string;
  let requirementId: string;
  let sessionId: string;

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0].name).toBe(target.database);
    const user = await db.user.create({
      data: { email: `${randomUUID()}@task.test`, passwordHash: 'fixture' },
    });
    userId = user.id;
    sessionId = (
      await db.webSession.create({
        data: {
          userId,
          tokenHash: randomUUID(),
          csrfTokenHash: randomUUID(),
          userAuthVersion: 1,
          idleExpiresAt: new Date(Date.now() + 3600000),
          expiresAt: new Date(Date.now() + 3600000),
        },
      })
    ).id;
    const project = await db.project.create({
      data: { key: randomUUID().slice(0, 6), name: 'Task consistency', createdById: userId },
    });
    projectId = project.id;
    roleId = (await db.projectRole.create({ data: { projectId, key: 'dev', title: 'Developer' } }))
      .id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    await db.projectRoleAssignment.create({ data: { projectId, userId, roleId } });
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'TASK-1', title: 'Task fixture' },
    });
    requirementId = requirement.id;
    definitionId = (
      await db.workflowDefinition.create({ data: { projectId, workflowKey: 'test' } })
    ).id;
    revisionId = (
      await db.workflowRevision.create({
        data: {
          projectId,
          definitionId,
          revision: 1,
          digest: 'a'.repeat(64),
          compiledRules: {},
          definition: {
            steps: [{ key: 'implementation', kind: 'IMPLEMENTATION', outputKinds: ['CODE', 12] }],
          },
        },
      })
    ).id;
    instanceId = (
      await db.workflowInstance.create({
        data: {
          projectId,
          definitionId,
          definitionRevisionId: revisionId,
          requirementId: requirement.id,
        },
      })
    ).id;
    repository = new V1TaskPrismaRepository(db as PrismaService);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        await db.idempotentOperation.deleteMany({ where: { projectId } });
        await db.auditEvent.deleteMany({ where: { projectId } });
        await db.reviewDecisionRevocation.deleteMany({ where: { projectId } });
        await db.reviewDecision.deleteMany({ where: { projectId } });
        await db.confirmationTicket.deleteMany({ where: { projectId } });
        await db.approvalSlot.deleteMany({ where: { projectId } });
        await db.reviewRequest.deleteMany({ where: { projectId } });
        await db.artifactSetItem.deleteMany({ where: { projectId } });
        await db.artifact.deleteMany({ where: { projectId } });
        await db.snapshotResourceRef.deleteMany({ where: { projectId } });
        await db.contextSnapshot.deleteMany({ where: { projectId } });
        await db.projectKnowledgeBinding.deleteMany({ where: { projectId } });
        await db.documentRevision.deleteMany({ where: { projectId } });
        await db.knowledgeDocument.deleteMany({ where: { projectId } });
        await db.knowledgeBase.deleteMany({ where: { projectId } });
        await db.rolePackageResource.deleteMany({ where: { packageVersion: { projectId } } });
        await db.rolePackageVersion.deleteMany({ where: { projectId } });
        await db.codeReviewEvidence.deleteMany({ where: { projectId } });
        await db.artifactSet.deleteMany({ where: { projectId } });
        await db.principalStamp.deleteMany({ where: { projectId } });
        await db.taskClaim.deleteMany({ where: { projectId } });
        await db.task.deleteMany({ where: { projectId } });
        await db.workflowInstance.deleteMany({ where: { projectId } });
        await db.workflowRevision.deleteMany({ where: { projectId } });
        await db.workflowDefinition.deleteMany({ where: { projectId } });
        await db.requirement.deleteMany({ where: { projectId } });
        await db.agentCredential.deleteMany({ where: { projectId } });
        await db.projectRoleAssignment.deleteMany({ where: { projectId } });
        await db.projectMember.deleteMany({ where: { projectId } });
        await db.projectRole.deleteMany({ where: { projectId } });
        await db.project.delete({ where: { id: projectId } });
      }
      if (userId) {
        await db.webSession.deleteMany({ where: { userId } });
        await db.user.delete({ where: { id: userId } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  function operation() {
    return {
      id: randomUUID(),
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: `user:${userId}`,
      key: randomUUID(),
      method: 'POST',
      route: '/tasks/claim',
      requestDigest: 'b'.repeat(64),
    };
  }
  async function task(stepKey = randomUUID()) {
    return db.task.create({
      data: {
        projectId,
        workflowInstanceId: instanceId,
        stepKey,
        roleId,
        responsibleUserId: userId,
      },
    });
  }
  async function claim(taskId: string, op = operation()) {
    // Fixtures use arbitrary step keys; bind them explicitly before exercising the production guard.
    const row = await db.task.findUnique({ where: { id: taskId } });
    if (row && row.workflowInstanceId === instanceId) {
      const revision = await db.workflowRevision.findUniqueOrThrow({ where: { id: revisionId } });
      const definition = revision.definition as { steps?: Array<Record<string, unknown>> };
      const steps = definition.steps ?? [];
      const step = steps.find((entry) => entry.key === row.stepKey);
      if (step) step.deps ??= [];
      else steps.push({ key: row.stepKey, deps: [], kind: 'DELIVERY', outputKinds: ['IMPL'] });
      await db.workflowRevision.update({
        where: { id: revisionId },
        data: { definition: { ...definition, steps } as never },
      });
    }
    return repository.claim({
      taskId,
      expectedGeneration: 1,
      principalScopeKey: `user:${userId}`,
      userId,
      credentialId: null,
      now: new Date(),
      operation: op,
    });
  }
  async function declareSteps(entries: Array<{ key: string; deps: string[] }>) {
    const revision = await db.workflowRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const definition = revision.definition as { steps?: Array<Record<string, unknown>> };
    const replaced = new Set(entries.map((entry) => entry.key));
    await db.workflowRevision.update({
      where: { id: revisionId },
      data: {
        definition: {
          ...definition,
          steps: [
            ...(definition.steps ?? []).filter((entry) => !replaced.has(String(entry.key))),
            ...entries,
          ],
        } as never,
      },
    });
  }
  function rawClaim(taskId: string, credentialId: string | null = null) {
    return repository.claim({
      taskId,
      expectedGeneration: 1,
      principalScopeKey: credentialId ? `agent:${credentialId}` : `user:${userId}`,
      userId,
      credentialId,
      now: new Date(),
      operation: operation(),
    });
  }
  async function owned() {
    const row = await task();
    const snapshot = await claim(row.id);
    return {
      taskId: row.id,
      expectedGeneration: snapshot.generation,
      claimId: snapshot.currentClaim!.id,
      principalScopeKey: `user:${userId}`,
      now: new Date(),
      operation: operation(),
    };
  }

  const actorStamp = {
    kind: 'HUMAN' as const,
    webSessionId: null,
    agentCredentialId: null,
    roleId: null,
    roleKeySnapshot: null,
    scopeSnapshot: [],
    userAuthVersion: 1,
  };
  async function snapshotInput(stepKey = randomUUID()): Promise<V1CreateSnapshotInput> {
    const row = await task(stepKey);
    const claimed = await claim(row.id);
    const assembled = await assembleSnapshotManifest({
      projectId,
      requirementId,
      requirementGeneration: 1,
      taskId: row.id,
      taskGeneration: claimed.generation,
      workflowDefinitionRevisionId: revisionId,
      workflowDigest: 'a'.repeat(64),
      knowledgeBindingsVersion: 1,
      stepKey,
      baselinePolicy: 'NONE',
      productBaseline: null,
      resources: [],
    });
    return {
      snapshotId: randomUUID(),
      projectId,
      requirementId,
      taskId: row.id,
      taskGeneration: claimed.generation,
      requirementGeneration: 1,
      workflowDefinitionRevisionId: revisionId,
      claimId: claimed.currentClaim!.id,
      ...assembled,
      resources: [],
      expectedTaskVersion: claimed.version,
      actorUserId: userId,
      actorStamp,
      now: new Date(),
      operation: operation(),
    };
  }

  async function deliveryInput(): Promise<V1DeliverInput> {
    const stepKey = randomUUID();
    const revision = await db.workflowRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const definition = revision.definition as { steps: unknown[]; roleSlots?: unknown[] };
    await db.workflowRevision.update({
      where: { id: revisionId },
      data: {
        definition: {
          ...definition,
          roleSlots: [{ key: 'accept', kind: 'TASK_ACCEPTANCE' }],
          steps: [
            ...definition.steps,
            {
              key: stepKey,
              kind: 'IMPLEMENTATION',
              outputKinds: ['IMPL'],
              baselinePolicy: 'NONE',
              gates: [{ reviewerSlots: ['accept'] }],
            },
          ],
        },
      },
    });
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { bindings: { roleSlotBindings: [{ slotKey: 'accept', roleId, userId }] } },
    });
    const input = await snapshotInput(stepKey);
    const result = await new V1SnapshotPrismaRepository(db as PrismaService).createSnapshot(input);
    return {
      taskId: input.taskId,
      expectedVersion: result.taskVersion,
      claimId: input.claimId,
      snapshotId: input.snapshotId,
      workflowDefinitionRevisionId: revisionId,
      principalScopeKey: `user:${userId}`,
      localRunId: randomUUID(),
      candidateRevisionIds: [],
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/plain',
          bodyBytes: Buffer.from('implementation'),
          sha256: 'b'.repeat(64),
          byteLength: 14,
          projectRepositoryId: null,
          commitSha: null,
          repoPath: null,
          summary: 'fixture',
          checks: [{ code: 'tests', passed: true }],
        },
      ],
      subjectDigest: 'c'.repeat(64),
      actorUserId: userId,
      actorStamp,
      now: new Date(),
      operation: operation(),
    };
  }

  it('allows one concurrent claimant and persists the matching generation and operation', async () => {
    const row = await task();
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => claim(row.id)));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await repository.findTask(row.id);
    expect(stored).toMatchObject({
      generation: 2,
      currentClaim: { taskGeneration: 2, userId, releasedAt: null },
    });
    expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(1);
    const op = await db.idempotentOperation.findFirst({
      where: { projectId, resultRefs: { path: ['claimId'], equals: stored!.currentClaim!.id } },
    });
    expect(op).not.toBeNull();
    expect(op!.resultRefs).toMatchObject({
      taskId: row.id,
      claimId: stored!.currentClaim!.id,
      taskVersion: stored!.version,
      taskGeneration: stored!.generation,
    });
  });

  it('does not let the project owner claim another responsible user task', async () => {
    const row = await task();
    const otherUser = await db.user.create({
      data: { email: `${randomUUID()}@task.test`, passwordHash: 'fixture' },
    });
    try {
      await db.task.update({ where: { id: row.id }, data: { responsibleUserId: otherUser.id } });
      await expect(rawClaim(row.id)).rejects.toMatchObject({
        message: 'TASK_NOT_IN_RESPONSIBILITY',
        status: 403,
      });
    } finally {
      await db.task.update({ where: { id: row.id }, data: { responsibleUserId: userId } });
      await db.user.delete({ where: { id: otherUser.id } });
    }
    expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(0);
    expect(await repository.findTask(row.id)).toMatchObject({
      version: 1,
      generation: 1,
      currentClaim: null,
    });
  });

  it('rejects an archive committed after service authorization before the claim transaction writes', async () => {
    const row = await task();
    await declareSteps([{ key: row.stepKey, deps: [] }]);
    const op = operation();
    const operations = new V1IdempotencyPrismaRepository(db as PrismaService);
    const service = new V1TaskService(
      repository,
      new V1AuthorizationService(new V1AuthorizationPrismaRepository(db as PrismaService)),
      {
        async findOperation(input) {
          const existing = await operations.findOperation(input);
          // Interleave the real archive after the service has checked write access.
          await db.project.update({
            where: { id: projectId },
            data: { archivedAt: new Date(), version: { increment: 1 } },
          });
          return existing;
        },
      },
    );
    try {
      await expect(
        service.claim({ kind: 'HUMAN', userId, scopes: [] }, row.id, {
          idempotencyKey: op.key,
          method: op.method,
          route: `/api/v1/tasks/${row.id}/claims`,
          body: {},
          requestId: randomUUID(),
          now: new Date(),
          operationId: op.id,
        }),
      ).rejects.toMatchObject({ message: 'PROJECT_ARCHIVED', status: 409 });
      expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(0);
      expect(await db.idempotentOperation.findUnique({ where: { id: op.id } })).toBeNull();
      expect(await db.task.findUnique({ where: { id: row.id } })).toMatchObject({
        version: row.version,
        generation: row.generation,
        currentClaimId: null,
      });
    } finally {
      await db.project.update({
        where: { id: projectId },
        data: { archivedAt: null, version: { increment: 1 } },
      });
    }
  });

  it('rejects a same-user wrong-role Agent and accepts its matching role credential', async () => {
    const row = await task();
    await declareSteps([{ key: row.stepKey, deps: [] }]);
    const otherRole = await db.projectRole.create({
      data: { projectId, key: `wrong-${randomUUID()}`, title: 'Other role' },
    });
    await db.projectRoleAssignment.create({ data: { projectId, userId, roleId: otherRole.id } });
    const credential = await db.agentCredential.create({
      data: {
        userId,
        projectId,
        roleId: otherRole.id,
        name: 'claim regression',
        tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
        scopes: ['task:claim'],
        userAuthVersion: 1,
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await expect(rawClaim(row.id, credential.id)).rejects.toMatchObject({
      message: 'TASK_NOT_IN_RESPONSIBILITY',
      status: 403,
    });
    expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(0);
    await db.agentCredential.update({ where: { id: credential.id }, data: { roleId } });
    await expect(rawClaim(row.id, credential.id)).resolves.toMatchObject({
      generation: 2,
      currentClaim: { principalScopeKey: `agent:${credential.id}`, userId },
    });
  });

  it('rechecks current role assignment under the transaction before claiming', async () => {
    const row = await task();
    await declareSteps([{ key: row.stepKey, deps: [] }]);
    await db.projectRoleAssignment.update({
      where: { projectId_userId_roleId: { projectId, userId, roleId } },
      data: { revokedAt: new Date() },
    });
    try {
      await expect(rawClaim(row.id)).rejects.toMatchObject({
        message: 'TASK_NOT_IN_RESPONSIBILITY',
        status: 403,
      });
      expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(0);
    } finally {
      await db.projectRoleAssignment.update({
        where: { projectId_userId_roleId: { projectId, userId, roleId } },
        data: { revokedAt: null },
      });
    }
    await expect(rawClaim(row.id)).resolves.toMatchObject({ generation: 2 });
  });

  it('requires all declared predecessor tasks to exist and be DONE', async () => {
    const before = await task();
    const row = await task();
    const missing = randomUUID();
    await declareSteps([
      { key: before.stepKey, deps: [] },
      { key: row.stepKey, deps: [before.stepKey, missing] },
    ]);
    await expect(rawClaim(row.id)).rejects.toMatchObject({
      message: 'TASK_DEPENDENCIES_NOT_DONE',
      status: 409,
    });
    await db.task.update({ where: { id: before.id }, data: { executionStatus: 'REVIEW_PENDING' } });
    await declareSteps([{ key: row.stepKey, deps: [before.stepKey] }]);
    await expect(rawClaim(row.id)).rejects.toMatchObject({
      message: 'TASK_DEPENDENCIES_NOT_DONE',
      status: 409,
    });
    await db.task.update({ where: { id: before.id }, data: { executionStatus: 'DONE' } });
    await expect(rawClaim(row.id)).resolves.toMatchObject({ generation: 2 });
  });

  it('projects the optional step display name from the task instance revision', async () => {
    const stepKey = 'named-step';
    const namedDefinition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: `named-${randomUUID()}` },
    });
    const original = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: namedDefinition.id,
        revision: 1,
        digest: 'e'.repeat(64),
        compiledRules: {},
        definition: { steps: [{ key: stepKey, kind: 'DELIVERY', outputKinds: ['IMPL'] }] },
      },
    });
    const legacyInstance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: namedDefinition.id,
        definitionRevisionId: original.id,
        requirementId,
        retiredAt: new Date(),
      },
    });
    const row = await db.task.create({
      data: {
        projectId,
        workflowInstanceId: legacyInstance.id,
        stepKey,
        roleId,
        responsibleUserId: userId,
      },
    });
    const stored = await repository.findTask(row.id);
    // The legacy revision has no displayName, so callers keep their existing key/label fallback.
    expect(stored?.stepDisplayName).toBeNull();

    const namedRevision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: namedDefinition.id,
        revision: 2,
        digest: 'd'.repeat(64),
        compiledRules: {},
        definition: {
          steps: [
            {
              key: stepKey,
              displayName: '实现工作',
              kind: 'DELIVERY',
              outputKinds: ['IMPL'],
            },
          ],
        },
      },
    });
    const namedInstance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: namedDefinition.id,
        definitionRevisionId: namedRevision.id,
        requirementId,
        retiredAt: new Date(),
      },
    });
    const namedTask = await db.task.create({
      data: {
        projectId,
        workflowInstanceId: namedInstance.id,
        stepKey,
        roleId,
        responsibleUserId: userId,
      },
    });
    expect(await repository.findTask(namedTask.id)).toMatchObject({
      stepKey,
      stepDisplayName: '实现工作',
    });
    expect((await repository.findTask(row.id))?.stepDisplayName).toBeNull();
    expect(
      await db.workflowRevision.findUniqueOrThrow({ where: { id: original.id } }),
    ).toMatchObject({
      definition: original.definition,
      digest: original.digest,
    });
  });

  it('rejects stale generations and an already active claim without another write', async () => {
    const input = await owned();
    await expect(claim(input.taskId)).rejects.toMatchObject({ message: 'BASELINE_STALE' });
    await expect(
      repository.claim({ ...input, expectedGeneration: 2, userId, credentialId: null }),
    ).rejects.toMatchObject({ message: 'CLAIM_CONFLICT' });
    expect(await db.taskClaim.count({ where: { taskId: input.taskId } })).toBe(1);
  });

  it('rolls back a claim when its operation cannot be recorded', async () => {
    const op = operation();
    await claim((await task()).id, op);
    const row = await task();
    await expect(claim(row.id, op)).rejects.toThrow();
    expect(await repository.findTask(row.id)).toMatchObject({
      generation: 1,
      version: 1,
      currentClaim: null,
    });
    expect(await db.taskClaim.count({ where: { taskId: row.id } })).toBe(0);
    await expect(claim(row.id)).resolves.toMatchObject({ generation: 2 });
  });

  it('rejects a different owner for status and release, preserving the active claim', async () => {
    const input = await owned();
    const foreign = { ...input, principalScopeKey: `user:${randomUUID()}` };
    await expect(repository.release(foreign)).rejects.toMatchObject({ message: 'CLAIM_INVALID' });
    await expect(
      repository.setWorkStatus({ ...foreign, workStatus: 'PAUSED' }),
    ).rejects.toMatchObject({ message: 'CLAIM_INVALID' });
    expect(await repository.findTask(input.taskId)).toMatchObject({
      workStatus: 'ACTIVE',
      currentClaim: { releasedAt: null },
    });
  });

  it('updates work status and releases ownership once, then permits a fresh generation', async () => {
    const input = await owned();
    await expect(
      repository.setWorkStatus({ ...input, workStatus: 'BLOCKED' }),
    ).resolves.toMatchObject({ workStatus: 'BLOCKED', generation: 2 });
    await expect(
      repository.release({ ...input, operation: operation(), releaseReason: 'handoff' }),
    ).resolves.toMatchObject({ currentClaim: null });
    expect(await db.taskClaim.findUnique({ where: { id: input.claimId } })).toMatchObject({
      releaseReason: 'handoff',
      releasedAt: expect.any(Date),
    });
    await expect(repository.release({ ...input, operation: operation() })).rejects.toMatchObject({
      message: 'CLAIM_INVALID',
    });
    await expect(
      repository.claim({ ...input, operation: operation(), userId, credentialId: null }),
    ).rejects.toMatchObject({ message: 'TASK_NOT_READY', status: 409 });
    // A released BLOCKED task needs an explicit management recovery before another claim.
    await db.task.update({ where: { id: input.taskId }, data: { workStatus: 'ACTIVE' } });
    await expect(
      repository.claim({ ...input, operation: operation(), userId, credentialId: null }),
    ).resolves.toMatchObject({ generation: 3, currentClaim: { taskGeneration: 3 } });
  });

  it('rolls back work status and release on an idempotency constraint failure', async () => {
    const input = await owned();
    await repository.setWorkStatus({ ...input, workStatus: 'BLOCKED' });
    await expect(repository.setWorkStatus({ ...input, workStatus: 'PAUSED' })).rejects.toThrow();
    await expect(repository.release(input)).rejects.toThrow();
    expect(await repository.findTask(input.taskId)).toMatchObject({
      workStatus: 'BLOCKED',
      currentClaim: { releasedAt: null },
    });
  });

  it('rejects invalid state, missing tasks, stale writes and retired instances', async () => {
    const input = await owned();
    await expect(
      repository.setWorkStatus({ ...input, workStatus: 'UNKNOWN' }),
    ).rejects.toMatchObject({ message: 'WORK_STATUS_INVALID' });
    await expect(
      repository.setWorkStatus({ ...input, workStatus: 'ACTIVE', expectedGeneration: 1 }),
    ).rejects.toMatchObject({ message: 'BASELINE_STALE' });
    await expect(repository.release({ ...input, expectedGeneration: 1 })).rejects.toMatchObject({
      message: 'BASELINE_STALE',
    });
    await expect(claim(randomUUID())).rejects.toMatchObject({ message: 'TASK_NOT_FOUND' });
    expect(await repository.findTask(randomUUID())).toBeNull();
    await db.workflowInstance.update({
      where: { id: instanceId },
      data: { retiredAt: new Date() },
    });
    try {
      await expect(claim((await task()).id)).rejects.toMatchObject({
        message: 'WORKFLOW_INSTANCE_RETIRED',
      });
    } finally {
      await db.workflowInstance.update({ where: { id: instanceId }, data: { retiredAt: null } });
    }
  });

  it('reads the immutable step contract without accepting non-string output kinds', async () => {
    const row = await task('implementation');
    expect(await repository.findWorkflowStepContract(row.id)).toEqual({
      workflowDefinitionRevisionId: revisionId,
      stepKey: 'implementation',
      kind: 'IMPLEMENTATION',
      outputKinds: ['CODE'],
    });
    expect(await repository.findWorkflowStepContract((await task()).id)).toBeNull();
    expect(await repository.findWorkflowStepContract(randomUUID())).toBeNull();
  });

  it('atomically prepares one encrypted replay ticket under competing idempotent requests', async () => {
    const row = await task();
    const stamp = await db.principalStamp.create({
      data: { kind: 'HUMAN', userId, projectId, scopeSnapshot: [], userAuthVersion: 1 },
    });
    const artifact = await db.artifactSet.create({
      data: {
        projectId,
        taskId: row.id,
        taskGeneration: 1,
        snapshotId: randomUUID(),
        workflowDefinitionRevisionId: revisionId,
        manifestDigest: 'a'.repeat(64),
        localRunId: randomUUID(),
        createdByStampId: stamp.id,
      },
    });
    const evidence = new V1GithubEvidencePrismaRepository(db as PrismaService);
    const input = {
      projectId,
      repositoryId: 'repo',
      changeRequestId: randomUUID(),
      headSha: 'a'.repeat(40),
      artifactSetId: artifact.id,
      generation: 1,
      evidenceId: randomUUID(),
      now: new Date(),
      expiresInMs: 60000,
    };
    const op = operation();
    const key = 'a'.repeat(64);
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        evidence.createVersionedTicket(input, (ticket) => ({
          ...op,
          now: input.now,
          resultRefs: {
            ticketId: ticket.ticketId,
            encryptedSecret: sealTicketSecret(ticket.secret, key, ticket.ticketId),
          },
        })),
      ),
    );
    const winners = results.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    const ticket = winners[0].status === 'fulfilled' ? winners[0].value : null;
    expect(
      await db.codeReviewEvidence.count({
        where: { projectId, changeRequestId: input.changeRequestId },
      }),
    ).toBe(1);
    const stored = await db.idempotentOperation.findUniqueOrThrow({ where: { id: op.id } });
    const refs = stored.resultRefs as { ticketId: string; encryptedSecret: string };
    expect(refs.ticketId).toBe(ticket!.ticketId);
    expect(openTicketSecret(refs.encryptedSecret, key, refs.ticketId)).toBe(ticket!.secret);
    expect(JSON.stringify(refs)).not.toContain(ticket!.secret);
    await expect(
      evidence.createVersionedTicket({ ...input, changeRequestId: 'rollback' }, () => {
        throw new Error('seal failed');
      }),
    ).rejects.toThrow('seal failed');
    expect(
      await db.codeReviewEvidence.count({ where: { projectId, changeRequestId: 'rollback' } }),
    ).toBe(0);
  });

  it('creates one immutable current snapshot under concurrent requests', async () => {
    const snapshots = new V1SnapshotPrismaRepository(db as PrismaService);
    const input = await snapshotInput();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        snapshots.createSnapshot({ ...input, snapshotId: randomUUID(), operation: operation() }),
      ),
    );
    const winner = results.find((result) => result.status === 'fulfilled');
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing snapshot');
    expect(await snapshots.findSnapshot(winner.value.snapshot.id)).toMatchObject({
      manifestDigest: input.manifestDigest,
    });
    expect(await snapshots.findTaskState(input.taskId)).toMatchObject({
      currentSnapshotId: winner.value.snapshot.id,
      taskGeneration: 2,
      currentClaim: { userId },
    });
    expect(await db.contextSnapshot.count({ where: { taskId: input.taskId } })).toBe(1);
    expect(await snapshots.findSnapshotResource(winner.value.snapshot.id, 'absent')).toBeNull();
  });

  it('rejects stale or foreign snapshot claims and rolls back a failed operation write', async () => {
    const snapshots = new V1SnapshotPrismaRepository(db as PrismaService);
    const input = await snapshotInput();
    await expect(
      snapshots.createSnapshot({ ...input, expectedTaskVersion: 1 }),
    ).rejects.toMatchObject({ message: 'BASELINE_STALE' });
    await expect(
      snapshots.createSnapshot({ ...input, claimId: randomUUID() }),
    ).rejects.toMatchObject({ message: 'CLAIM_INVALID' });
    await expect(
      snapshots.createSnapshot({
        ...input,
        operation: { ...input.operation, principalScopeKey: `user:${randomUUID()}` },
      }),
    ).rejects.toMatchObject({ message: 'CLAIM_INVALID' });
    const prior = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(
      snapshots.createSnapshot({ ...input, operation: { ...input.operation, id: prior.id } }),
    ).rejects.toThrow();
    expect(await snapshots.findSnapshot(input.snapshotId)).toBeNull();
    expect(await repository.findTask(input.taskId)).toMatchObject({
      version: input.expectedTaskVersion,
    });
    await expect(snapshots.createSnapshot(input)).resolves.toMatchObject({
      taskVersion: input.expectedTaskVersion + 1,
    });
  });

  it('delivers once under competition and derives the acceptance review without marking the task done', async () => {
    const artifacts = new V1ArtifactPrismaRepository(db as PrismaService);
    const input = await deliveryInput();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => artifacts.deliver({ ...input, operation: operation() })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing delivery');
    expect(winner.value.task.executionStatus).toBe('REVIEW_PENDING');
    const set = await artifacts.findArtifactSet(winner.value.artifactSet.id);
    expect(set).toMatchObject({
      snapshotId: input.snapshotId,
      artifacts: [{ contentPreview: { text: 'implementation', truncated: false } }],
    });
    expect(
      await db.reviewRequest.findUnique({ where: { id: winner.value.reviewRequestId } }),
    ).toMatchObject({
      kind: 'TASK_ACCEPTANCE',
      status: 'OPEN',
      subjectDigest: input.subjectDigest,
    });
    expect(
      await db.approvalSlot.count({ where: { reviewRequestId: winner.value.reviewRequestId } }),
    ).toBe(1);
    expect(await db.artifactSet.count({ where: { taskId: input.taskId } })).toBe(1);
    const deliveryOp = await db.idempotentOperation.findFirst({
      where: {
        projectId,
        resultRefs: { path: ['artifactSetId'], equals: winner.value.artifactSet.id },
      },
    });
    expect(deliveryOp!.resultRefs).toMatchObject({
      taskId: input.taskId,
      claimId: input.claimId,
      snapshotId: input.snapshotId,
      taskVersion: winner.value.task.version,
      taskGeneration: winner.value.task.generation,
      reviewRequestId: winner.value.reviewRequestId,
    });
    const replacement = await artifacts.deliver({
      ...input,
      expectedVersion: winner.value.task.version,
      operation: operation(),
    });
    expect(
      await db.reviewRequest.findUnique({ where: { id: winner.value.reviewRequestId } }),
    ).toMatchObject({ status: 'INVALIDATED' });
    expect(replacement.reviewRequestId).not.toBe(winner.value.reviewRequestId);
  });

  it('rejects stale snapshots, foreign claims and candidates added outside the snapshot', async () => {
    const artifacts = new V1ArtifactPrismaRepository(db as PrismaService);
    const input = await deliveryInput();
    await expect(artifacts.deliver({ ...input, expectedVersion: 1 })).rejects.toMatchObject({
      message: 'VERSION_CONFLICT',
    });
    await expect(
      artifacts.deliver({ ...input, principalScopeKey: `user:${randomUUID()}` }),
    ).rejects.toMatchObject({ message: 'CLAIM_INVALID' });
    await expect(artifacts.deliver({ ...input, snapshotId: randomUUID() })).rejects.toMatchObject({
      message: 'SNAPSHOT_STALE',
    });
    await expect(
      artifacts.deliver({ ...input, candidateRevisionIds: [randomUUID()] }),
    ).rejects.toMatchObject({ message: 'CANDIDATE_NOT_IN_SNAPSHOT' });
    await expect(
      artifacts.deliver({
        ...input,
        items: [{ ...input.items[0], projectRepositoryId: randomUUID() }],
      }),
    ).rejects.toMatchObject({ message: 'ARTIFACT_REPOSITORY_UNKNOWN' });
    expect(await db.artifactSet.count({ where: { taskId: input.taskId } })).toBe(0);
    await db.requirement.update({
      where: { id: requirementId },
      data: { generation: { increment: 1 } },
    });
    try {
      await expect(artifacts.deliver(input)).rejects.toMatchObject({ message: 'SNAPSHOT_STALE' });
    } finally {
      await db.requirement.update({
        where: { id: requirementId },
        data: { generation: { decrement: 1 } },
      });
    }
  });

  it('rolls back every delivery side effect when its operation write fails', async () => {
    const artifacts = new V1ArtifactPrismaRepository(db as PrismaService);
    const input = await deliveryInput();
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    const counts = {
      stamps: await db.principalStamp.count({ where: { projectId } }),
      audits: await db.auditEvent.count({ where: { projectId } }),
    };
    await expect(
      artifacts.deliver({ ...input, operation: { ...input.operation, id: previous.id } }),
    ).rejects.toThrow();
    expect(await db.artifactSet.count({ where: { taskId: input.taskId } })).toBe(0);
    expect(await db.reviewRequest.count({ where: { taskId: input.taskId } })).toBe(0);
    expect(await db.principalStamp.count({ where: { projectId } })).toBe(counts.stamps);
    expect(await db.auditEvent.count({ where: { projectId } })).toBe(counts.audits);
    expect(await repository.findTask(input.taskId)).toMatchObject({
      version: input.expectedVersion,
      executionStatus: 'OPEN',
    });
  });

  async function reviewInput(decision: V1CommitDecisionInput['decision'] = 'APPROVE') {
    const delivered = await new V1ArtifactPrismaRepository(db as PrismaService).deliver(
      await deliveryInput(),
    );
    const reviews = new V1ReviewPrismaRepository(db as PrismaService);
    const review = await reviews.findReview(delivered.reviewRequestId);
    const secretHash = createHash('sha256').update(randomUUID()).digest('hex');
    const ticket = await db.confirmationTicket.create({
      data: {
        secretHash,
        userId,
        webSessionId: sessionId,
        projectId,
        userAuthVersion: 1,
        action: 'REVIEW_DECIDE',
        targetType: 'REVIEW_REQUEST',
        targetId: review!.id,
        expectedVersion: review!.version,
        actionDigest: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const op = operation();
    const input: V1CommitDecisionInput = {
      reviewId: review!.id,
      expectedVersion: review!.version,
      slotId: review!.slots[0].id,
      decision,
      subjectDigest: review!.subjectDigest,
      comment: 'Database review',
      actorUserId: userId,
      roleSlot: { roleId, approvalSlotId: review!.slots[0].id },
      operationId: op.id,
      ticket: { id: ticket.id, secretHash, webSessionId: sessionId },
      principalScopeKey: op.principalScopeKey,
      projectScopeKey: op.projectScopeKey,
      operationKey: op.key,
      method: op.method,
      route: op.route,
      requestDigest: op.requestDigest,
      now: new Date(),
    };
    return { input, delivered, reviews };
  }

  it('accepts once under competing decisions and releases the live task claim', async () => {
    const { input, delivered, reviews } = await reviewInput();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reviews.commitDecision({ ...input, operationId: randomUUID(), operationKey: randomUUID() }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing acceptance');
    expect(winner.value.subjectResult).toMatchObject({
      kind: 'ACCEPTED',
      taskId: delivered.task.id,
    });
    expect(await repository.findTask(delivered.task.id)).toMatchObject({
      executionStatus: 'DONE',
      currentClaim: null,
    });
    expect(await reviews.findReview(input.reviewId)).toMatchObject({
      status: 'APPROVED',
      decisions: [{ decision: 'APPROVE', actor: { id: userId } }],
    });
    expect(await reviews.findDecisionContext(winner.value.decisionId)).toMatchObject({
      revoked: false,
      createdById: userId,
    });
  });

  it('keeps all review effects and the confirmation uncommitted when operation persistence fails', async () => {
    const { input, delivered, reviews } = await reviewInput();
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(reviews.commitDecision({ ...input, operationId: previous.id })).rejects.toThrow();
    expect(await reviews.findReview(input.reviewId)).toMatchObject({
      status: 'OPEN',
      decisions: [],
    });
    expect(await repository.findTask(delivered.task.id)).toMatchObject({
      executionStatus: 'REVIEW_PENDING',
      currentClaim: { releasedAt: null },
    });
    expect(
      (await db.confirmationTicket.findUniqueOrThrow({ where: { id: input.ticket.id } }))
        .consumedAt,
    ).toBeNull();
    await expect(reviews.commitDecision(input)).resolves.toMatchObject({
      subjectResult: { kind: 'ACCEPTED' },
    });
  });

  it('returns rework and rejection effects with fresh generations or blocked work respectively', async () => {
    const rework = await reviewInput('CHANGES_REQUESTED');
    const changed = await rework.reviews.commitDecision(rework.input);
    expect(changed.subjectResult).toMatchObject({
      kind: 'REWORK',
      affectedTaskIds: [rework.delivered.task.id],
    });
    expect(await repository.findTask(rework.delivered.task.id)).toMatchObject({
      executionStatus: 'OPEN',
      generation: 3,
      currentClaim: null,
    });
    const rejected = await reviewInput('REJECT');
    expect((await rejected.reviews.commitDecision(rejected.input)).subjectResult).toMatchObject({
      kind: 'REJECTED',
      affectedTaskIds: [rejected.delivered.task.id],
    });
    expect(await repository.findTask(rejected.delivered.task.id)).toMatchObject({
      workStatus: 'BLOCKED',
      executionStatus: 'OPEN',
    });
  });

  it('rejects changed digests, stale versions, invalid slots and invalid confirmations before committing a decision', async () => {
    const { input, reviews } = await reviewInput();
    await expect(
      reviews.commitDecision({ ...input, subjectDigest: 'd'.repeat(64) }),
    ).rejects.toMatchObject({ message: 'REVISION_DIGEST_CHANGED' });
    await expect(reviews.commitDecision({ ...input, expectedVersion: 0 })).rejects.toMatchObject({
      message: 'VERSION_CONFLICT',
    });
    await expect(reviews.commitDecision({ ...input, slotId: randomUUID() })).rejects.toMatchObject({
      message: 'REVIEW_SLOT_NOT_FOUND',
    });
    await expect(
      reviews.commitDecision({ ...input, ticket: { ...input.ticket, secretHash: 'e'.repeat(64) } }),
    ).rejects.toMatchObject({ message: 'CONFIRMATION_CONSUME_CONFLICT' });
    expect((await reviews.findReview(input.reviewId))!.decisions).toEqual([]);
    expect(await reviews.findReview(randomUUID())).toBeNull();
    expect(await reviews.findDecisionContext(randomUUID())).toBeNull();
    expect(await reviews.findArtifactReviewSubject(randomUUID())).toBeNull();
    expect(await reviews.findDocumentReviewSubject(randomUUID())).toBeNull();
    expect(await reviews.hasActiveDelegation(input.slotId, userId)).toBe(false);
  });

  it('returns an existing open artifact review and preserves idempotency route and digest binding', async () => {
    const { delivered, reviews } = await reviewInput();
    const op = operation();
    const input = {
      projectId,
      subject: { kind: 'TASK_ARTIFACT_SET' as const, id: delivered.artifactSet.id },
      expectedVersion: delivered.task.version,
      taskId: delivered.task.id,
      actor: { ...actorStamp, userId },
      operation: { ...op, now: new Date() },
    };
    const result = await reviews.createReviewRequest(input);
    expect(result).toMatchObject({ created: false, review: { id: delivered.reviewRequestId } });
    expect(await reviews.createReviewRequest(input)).toMatchObject({
      created: false,
      review: { id: delivered.reviewRequestId },
    });
    await expect(
      reviews.createReviewRequest({ ...input, operation: { ...input.operation, route: '/other' } }),
    ).rejects.toMatchObject({ message: 'IDEMPOTENCY_ROUTE_CONFLICT' });
    await expect(
      reviews.createReviewRequest({
        ...input,
        operation: { ...input.operation, requestDigest: 'f'.repeat(64) },
      }),
    ).rejects.toMatchObject({ message: 'IDEMPOTENCY_DIGEST_CONFLICT' });
    expect(await reviews.findArtifactReviewSubject(delivered.artifactSet.id)).toMatchObject({
      projectId,
      taskId: delivered.task.id,
    });
  });

  it('paginates assigned reviews in the database and excludes another project', async () => {
    const { reviews } = await reviewInput();
    const query = {
      projectId,
      userId,
      principalKind: 'HUMAN' as const,
      agentRoleId: null,
      activeRoleIds: [roleId],
      knowledgeReadAllowed: true,
      assignedToMe: true,
      status: null,
      limit: 1,
      cursor: null,
    };
    const first = await reviews.listReviews(query);
    expect(first.hasMore).toBe(true);
    const second = await reviews.listReviews({ ...query, cursor: first.nextCursor });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    expect((await reviews.listReviews({ ...query, projectId: randomUUID() })).items).toEqual([]);
  });

  async function revocationInput() {
    const fixture = await reviewInput();
    const accepted = await fixture.reviews.commitDecision(fixture.input);
    const secretHash = createHash('sha256').update(randomUUID()).digest('hex');
    const ticket = await db.confirmationTicket.create({
      data: {
        secretHash,
        userId,
        webSessionId: sessionId,
        projectId,
        userAuthVersion: 1,
        action: 'REVIEW_REVOKE',
        targetType: 'REVIEW_DECISION',
        targetId: accepted.decisionId,
        expectedVersion: accepted.review.version,
        actionDigest: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    return {
      ...fixture,
      accepted,
      revoke: {
        ...fixture.input,
        decisionId: accepted.decisionId,
        expectedVersion: accepted.review.version,
        reason: 'Approval no longer valid',
        operationId: randomUUID(),
        operationKey: randomUUID(),
        ticket: { id: ticket.id, secretHash, webSessionId: sessionId },
      },
    };
  }

  it('revokes approval once and invalidates the accepted task without deleting review history', async () => {
    const { reviews, revoke, delivered, accepted } = await revocationInput();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        reviews.revokeDecision({
          ...revoke,
          operationId: randomUUID(),
          operationKey: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.findTask(delivered.task.id)).toMatchObject({
      generation: 3,
      executionStatus: 'OPEN',
      currentClaim: null,
    });
    expect(await reviews.findDecisionContext(accepted.decisionId)).toMatchObject({ revoked: true });
    expect(await reviews.findReview(revoke.reviewId)).toMatchObject({
      status: 'INVALIDATED',
      decisions: [{ id: accepted.decisionId }],
    });
    expect(await db.reviewDecision.count({ where: { reviewRequestId: revoke.reviewId } })).toBe(1);
    expect(
      await db.reviewDecisionRevocation.count({ where: { decisionId: accepted.decisionId } }),
    ).toBe(1);
  });

  it('rolls back revocation and task invalidation when recording the operation fails', async () => {
    const { reviews, revoke, delivered } = await revocationInput();
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(reviews.revokeDecision({ ...revoke, operationId: previous.id })).rejects.toThrow();
    expect(await reviews.findReview(revoke.reviewId)).toMatchObject({ status: 'APPROVED' });
    expect(await repository.findTask(delivered.task.id)).toMatchObject({
      executionStatus: 'DONE',
      generation: 2,
    });
    expect(
      (await db.confirmationTicket.findUniqueOrThrow({ where: { id: revoke.ticket.id } }))
        .consumedAt,
    ).toBeNull();
    await expect(reviews.revokeDecision({ ...revoke, expectedVersion: 0 })).rejects.toMatchObject({
      message: 'VERSION_CONFLICT',
    });
    await expect(
      reviews.revokeDecision({ ...revoke, decisionId: randomUUID() }),
    ).rejects.toMatchObject({ message: 'REVIEW_DECISION_NOT_FOUND' });
  });
  it('persists snapshot resource references and reads exact document, artifact and role bytes', async () => {
    const snapshots = new V1SnapshotPrismaRepository(db as PrismaService);
    const kb = await db.knowledgeBase.create({
      data: {
        projectId,
        key: randomUUID(),
        name: 'Snapshot knowledge',
        visibility: 'PROJECT',
        publicationApproverUserId: userId,
      },
    });
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId: kb.id, requirementId, kind: 'KNOWLEDGE' },
    });
    expect(await snapshots.findInputDocument(document.id)).toEqual({
      documentId: document.id,
      projectId,
      knowledgeBaseId: kb.id,
      documentKind: 'KNOWLEDGE',
    });
    expect(await snapshots.findInputDocument(randomUUID())).toBeNull();
    const body = Buffer.from('immutable snapshot source');
    const sha256 = createHash('sha256').update(body).digest('hex');
    const revision = await db.documentRevision.create({
      data: {
        projectId,
        documentId: document.id,
        seq: 1,
        title: 'Snapshot source',
        mimeType: 'text/plain',
        bodyBytes: body,
        byteLength: body.length,
        sha256,
        createdById: userId,
      },
    });
    await db.knowledgeDocument.update({
      where: { id: document.id },
      data: { currentPublishedRevisionId: revision.id },
    });
    await db.projectKnowledgeBinding.create({
      data: { projectId, documentId: document.id, roleId, required: true },
    });
    const fixture = await reviewInput();
    await fixture.reviews.commitDecision(fixture.input);
    const sourceArtifact = fixture.delivered.artifactSet.artifacts[0];
    const packageVersion = await db.rolePackageVersion.create({
      data: {
        projectId,
        packageId: `fixture.${randomUUID()}`,
        version: '1.0.0',
        roleKey: 'dev',
        manifest: {},
        manifestDigest: sha256,
      },
    });
    const roleResource = await db.rolePackageResource.create({
      data: {
        rolePackageVersionId: packageVersion.id,
        resourceKey: 'sop',
        path: 'sop.md',
        mediaType: 'text/plain',
        byteLength: body.length,
        sha256,
        bodyBytes: body,
      },
    });
    const input = await snapshotInput();
    const resources: V1CreateSnapshotInput['resources'] = [
      {
        refId: 'doc',
        kind: 'DOCUMENT_REVISION',
        targetId: revision.id,
        documentRevisionId: revision.id,
        sha256,
        byteLength: body.length,
        mediaType: 'text/plain',
        authority: 'PUBLISHED',
      },
      {
        refId: 'artifact',
        kind: 'ARTIFACT',
        targetId: sourceArtifact.id,
        artifactId: sourceArtifact.id,
        sha256: sourceArtifact.sha256,
        byteLength: sourceArtifact.byteLength,
        mediaType: sourceArtifact.mediaType,
        authority: 'PUBLISHED',
      },
      {
        refId: 'role',
        kind: 'ROLE_RESOURCE',
        targetId: roleResource.id,
        rolePackageResourceId: roleResource.id,
        sha256,
        byteLength: body.length,
        mediaType: 'text/plain',
        authority: 'PUBLISHED',
      },
    ];
    const assembled = await assembleSnapshotManifest({ ...input.manifest, resources });
    await snapshots.createSnapshot({ ...input, ...assembled, resources });
    const stored = await snapshots.findSnapshot(input.snapshotId);
    expect(stored!.resources).toHaveLength(3);
    expect(
      Buffer.from(
        (await snapshots.findSnapshotResource(input.snapshotId, 'doc'))!.bodyBytes,
      ).toString(),
    ).toBe(body.toString());
    expect(
      Buffer.from(
        (await snapshots.findSnapshotResource(input.snapshotId, 'artifact'))!.bodyBytes,
      ).toString(),
    ).toBe('implementation');
    expect(
      Buffer.from(
        (await snapshots.findSnapshotResource(input.snapshotId, 'role'))!.bodyBytes,
      ).toString(),
    ).toBe(body.toString());
    expect(await snapshots.findRoleResourceProjectId(roleResource.id)).toBe(projectId);
    expect(await snapshots.findRevision(revision.id)).toMatchObject({
      isCurrentPublished: true,
      knowledgeBaseId: kb.id,
    });
    expect(
      await snapshots.findCandidateRevisions({
        projectId,
        requirementId,
        revisionIds: [revision.id],
      }),
    ).toHaveLength(1);
    expect(
      await snapshots.findCandidateRevisions({
        projectId: randomUUID(),
        requirementId,
        revisionIds: [revision.id],
      }),
    ).toEqual([]);
    expect(await snapshots.listRoleKnowledgeBindings(projectId, roleId)).toMatchObject([
      { documentId: document.id, required: true },
    ]);
    const workflow = await db.workflowRevision.findUniqueOrThrow({ where: { id: revisionId } });
    const definition = workflow.definition as { steps: Array<{ key: string }> };
    const source = await db.task.findUniqueOrThrow({ where: { id: fixture.delivered.task.id } });
    await db.workflowRevision.update({
      where: { id: revisionId },
      data: {
        definition: {
          ...definition,
          steps: definition.steps.concat([
            { key: input.manifest.stepKey, deps: [source.stepKey] },
          ] as unknown as Array<{ key: string }>),
        },
        compiledRules: {
          packageLocks: [{ roleKey: 'dev', packageId: packageVersion.packageId, version: '1.0.0' }],
          inputSources: [
            {
              stepKey: input.manifest.stepKey,
              source: 'UPSTREAM_ARTIFACT',
              inputKey: 'impl',
              fromStepKey: source.stepKey,
              reference: 'IMPL',
            },
            {
              stepKey: input.manifest.stepKey,
              source: 'PUBLISHED_KNOWLEDGE',
              inputKey: 'knowledge',
              reference: document.id,
            },
          ],
        },
      },
    });
    expect(await snapshots.listAcceptedPrerequisiteArtifacts(input.taskId)).toMatchObject([
      { artifactId: sourceArtifact.id },
    ]);
    expect(
      await snapshots.listRolePackageResources({ projectId, roleKey: 'dev', revisionId }),
    ).toMatchObject([{ rolePackageResourceId: roleResource.id }]);
    expect(await snapshots.findTaskState(input.taskId)).toMatchObject({
      upstreamInputs: [{ fromStepKey: source.stepKey }],
      knowledgeInputs: [{ documentId: document.id }],
    });
  });
});
