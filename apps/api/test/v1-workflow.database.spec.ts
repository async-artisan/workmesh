import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';
import { V1WorkflowPrismaRepository } from '../src/workflows/v1-workflow.prisma-repository';
import { V1RolePackagePrismaRepository } from '../src/workflows/v1-role-package.prisma-repository';
import { validateRolePackageInput } from '../src/workflows/v1-role-package-policy';
import type {
  V1CreateInstanceInput,
  V1PublishDefinitionInput,
} from '../src/workflows/v1-workflow.repository';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL workflow publication and replacement', () => {
  let db: PrismaClient;
  let repository: V1WorkflowPrismaRepository;
  let projectId: string;
  let userId: string;
  let roleId: string;
  let sessionId: string;
  let seq = 0;
  const digest = () => createHash('sha256').update(randomUUID()).digest('hex');
  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(rows[0].name).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@workflow.test`, passwordHash: 'fixture' },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { key: randomUUID().slice(0, 6), name: 'Workflow fixture', createdById: userId },
      })
    ).id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });
    roleId = (await db.projectRole.create({ data: { projectId, key: 'dev', title: 'Developer' } }))
      .id;
    sessionId = (
      await db.webSession.create({
        data: {
          userId,
          tokenHash: digest(),
          csrfTokenHash: digest(),
          userAuthVersion: 1,
          idleExpiresAt: new Date(Date.now() + 3600000),
          expiresAt: new Date(Date.now() + 3600000),
        },
      })
    ).id;
    repository = new V1WorkflowPrismaRepository(db as PrismaService);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        await db.confirmationTicket.deleteMany({ where: { projectId } });
        await db.idempotentOperation.deleteMany({ where: { projectId } });
        await db.auditEvent.deleteMany({ where: { projectId } });
        await db.rolePackageResource.deleteMany({ where: { packageVersion: { projectId } } });
        await db.rolePackageVersion.deleteMany({ where: { projectId } });
        await db.principalStamp.deleteMany({ where: { projectId } });
        await db.task.deleteMany({ where: { projectId } });
        await db.workflowInstance.deleteMany({ where: { projectId } });
        await db.workflowRevision.deleteMany({ where: { projectId } });
        await db.workflowDefinition.deleteMany({ where: { projectId } });
        await db.requirement.deleteMany({ where: { projectId } });
        await db.projectRole.deleteMany({ where: { projectId } });
        await db.projectMember.deleteMany({ where: { projectId } });
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
      route: '/workflow',
      requestDigest: digest(),
    };
  }
  async function publication(workflowKey = randomUUID()): Promise<V1PublishDefinitionInput> {
    const secretHash = digest();
    const ticket = await db.confirmationTicket.create({
      data: {
        secretHash,
        userId,
        webSessionId: sessionId,
        projectId,
        userAuthVersion: 1,
        action: 'WORKFLOW_PUBLISH',
        targetType: 'WORKFLOW_DEFINITION',
        targetId: workflowKey,
        expectedVersion: 1,
        actionDigest: digest(),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    const project = await db.project.findUniqueOrThrow({ where: { id: projectId } });
    const current = await repository.findDefinition(projectId, workflowKey);
    return {
      projectId,
      workflowKey,
      title: 'Published fixture',
      expectedProjectVersion: project.version,
      expectedCurrentRevision: current?.currentRevision ?? 0,
      definition: { title: 'Published fixture', steps: [] },
      definitionDigest: digest(),
      compiledRules: { rules: [] } as unknown as V1PublishDefinitionInput['compiledRules'],
      packageLocks: [],
      actorUserId: userId,
      ticket: { id: ticket.id, secretHash, webSessionId: sessionId },
      now: new Date(),
      operation: operation(),
    };
  }
  async function instanceInput(
    workflowKey = randomUUID(),
    displayName = 'Implementation',
  ): Promise<V1CreateInstanceInput> {
    const input = await publication(workflowKey);
    input.definition = {
      title: 'Published fixture',
      steps: [{ key: 'implementation', displayName }],
    };
    const published = await repository.publishDefinition(input);
    const definition = await repository.findDefinition(projectId, input.workflowKey);
    seq += 1;
    const requirement = await db.requirement.create({
      data: { projectId, seq, code: `WF-${seq}`, title: 'Workflow fixture' },
    });
    const step = {
      stepKey: 'implementation',
      roleId,
      responsibleUserId: userId,
      repositoryIds: [],
      acceptanceKeys: ['A1'],
    };
    return {
      projectId,
      requirementId: requirement.id,
      definitionId: definition!.id,
      definitionRevisionId: published.definitionRevisionId,
      definitionDigest: published.digest,
      expectedRequirementVersion: 1,
      stepBindings: [step],
      roleSlotBindings: [],
      steps: [{ ...step, outputKinds: ['IMPL'] }],
      actorUserId: userId,
      operation: operation(),
    };
  }

  it('publishes immutable revisions and preserves the old revision on subsequent publication', async () => {
    const input = await publication();
    const first = await repository.publishDefinition(input);
    expect(first).toMatchObject({ revision: 1, projectVersion: input.expectedProjectVersion + 1 });
    const second = await repository.publishDefinition(await publication(input.workflowKey));
    expect(second.revision).toBe(2);
    expect(second.definitionRevisionId).not.toBe(first.definitionRevisionId);
    expect(await repository.findRevision(first.definitionRevisionId)).toMatchObject({
      revision: 1,
      digest: first.digest,
    });
    expect(await repository.findDefinition(projectId, input.workflowKey)).toMatchObject({
      title: 'Published fixture',
      currentRevision: 2,
    });
    const ticket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: input.ticket.id },
    });
    expect(ticket.consumedOperationId).toBe(input.operation.id);
    expect(await repository.findPublishOperation(input.operation)).toMatchObject({
      requestDigest: input.operation.requestDigest,
    });
  });

  it('allows one concurrent publication and rejects stale project or revision expectations', async () => {
    const input = await publication();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.publishDefinition({ ...input, operation: operation() }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await repository.findDefinition(projectId, input.workflowKey)).toMatchObject({
      currentRevision: 1,
    });
    await expect(repository.publishDefinition(input)).rejects.toMatchObject({
      message: 'PROJECT_VERSION_CONFLICT',
    });
    const fresh = await publication(input.workflowKey);
    await expect(
      repository.publishDefinition({ ...fresh, expectedCurrentRevision: 0 }),
    ).rejects.toMatchObject({ message: 'WORKFLOW_REVISION_CONFLICT' });
  });

  it('rolls back definitions, project version and confirmation consumption after a write failure', async () => {
    const input = await publication();
    await expect(
      repository.publishDefinition({ ...input, ticket: { ...input.ticket, secretHash: digest() } }),
    ).rejects.toMatchObject({ message: 'CONFIRMATION_CONSUME_CONFLICT' });
    expect(await repository.findDefinition(projectId, input.workflowKey)).toBeNull();
    const committed = await publication();
    await repository.publishDefinition(committed);
    const retry = await publication(input.workflowKey);
    await expect(
      repository.publishDefinition({ ...retry, operation: committed.operation }),
    ).rejects.toThrow();
    expect(await repository.findDefinition(projectId, input.workflowKey)).toBeNull();
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).version).toBe(
      retry.expectedProjectVersion,
    );
    expect(
      (await db.confirmationTicket.findUniqueOrThrow({ where: { id: retry.ticket.id } }))
        .consumedAt,
    ).toBeNull();
  });

  it('replaces an active instance and retires only the prior instance of the same requirement', async () => {
    const input = await instanceInput();
    const first = await repository.createInstance(input);
    const second = await repository.createInstance({
      ...input,
      expectedRequirementVersion: 2,
      operation: operation(),
    });

    expect(second.requirementVersion).toBe(3);
    expect(await repository.findInstance(first.instance.id)).toMatchObject({
      retiredAt: expect.any(Date),
      workStatus: 'CANCELLED',
    });
    expect(await repository.findInstance(second.instance.id)).toMatchObject({
      retiredAt: null,
      steps: [{ stepKey: 'implementation', acceptanceKeys: ['A1'] }],
    });
    expect(await repository.findRequirement(input.requirementId)).toMatchObject({
      version: 3,
      acceptanceKeys: [],
    });
  });

  it('keeps each instance step name bound to its immutable workflow revision', async () => {
    const firstInput = await instanceInput('named-workflow', 'First revision name');
    const first = await repository.createInstance(firstInput);
    expect(first.instance.steps[0].stepDisplayName).toBe('First revision name');

    const secondInput = await instanceInput('named-workflow', 'Second revision name');
    const second = await repository.createInstance(secondInput);
    expect(second.instance.steps[0].stepDisplayName).toBe('Second revision name');
    expect(firstInput.definitionRevisionId).not.toBe(secondInput.definitionRevisionId);
    expect(await repository.findInstance(first.instance.id)).toMatchObject({
      definitionRevisionId: firstInput.definitionRevisionId,
      steps: [{ stepKey: 'implementation', stepDisplayName: 'First revision name' }],
    });
    expect(await repository.findInstance(second.instance.id)).toMatchObject({
      definitionRevisionId: secondInput.definitionRevisionId,
      steps: [{ stepKey: 'implementation', stepDisplayName: 'Second revision name' }],
    });
  });

  it('allows one instance creator and rolls back retirement on operation failure', async () => {
    const input = await instanceInput();
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        repository.createInstance({ ...input, operation: operation() }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((result) => result.status === 'fulfilled');
    if (!winner || winner.status !== 'fulfilled') throw new Error('missing winner');
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(
      repository.createInstance({
        ...input,
        expectedRequirementVersion: 2,
        operation: { ...operation(), id: previous.id },
      }),
    ).rejects.toThrow();
    expect(await repository.findInstance(winner.value.instance.id)).toMatchObject({
      retiredAt: null,
      workStatus: 'ACTIVE',
    });
    expect(await db.workflowInstance.count({ where: { requirementId: input.requirementId } })).toBe(
      1,
    );
  });

  it('paginates definitions without duplication and isolates project and absent lookups', async () => {
    const first = await repository.listDefinitions(projectId, { limit: 1, cursor: null });
    expect(first.nextCursor).not.toBeNull();
    const second = await repository.listDefinitions(projectId, {
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second.items[0].workflowKey).not.toBe(first.items[0].workflowKey);
    expect(
      (await repository.listDefinitions(randomUUID(), { limit: 10, cursor: null })).items,
    ).toEqual([]);
    expect(await repository.findDefinition(randomUUID(), first.items[0].workflowKey)).toBeNull();
    expect(await repository.findRevision(randomUUID())).toBeNull();
    expect(await repository.findInstance(randomUUID())).toBeNull();
    expect(await repository.findRequirement(randomUUID())).toBeNull();
    expect(await repository.findPackageVersion(projectId, 'absent', '1.0.0')).toBeNull();
    expect(await repository.findPublishOperation(operation())).toBeNull();
  });

  it('checks active membership, role and repository boundaries against persisted data', async () => {
    expect(await repository.projectRoles(projectId)).toMatchObject([
      { id: roleId, isActive: true },
    ]);
    expect(await repository.isActiveMember(projectId, userId)).toBe(true);
    expect(await repository.isActiveMember(randomUUID(), userId)).toBe(false);
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { revokedAt: new Date() },
    });
    expect(await repository.isActiveMember(projectId, userId)).toBe(false);
    expect(await repository.isProjectRepository(projectId, randomUUID())).toBe(false);
    expect(
      await repository.isPublishedKnowledgeAvailable(projectId, roleId, 'template-label'),
    ).toBe(false);
    expect(await repository.isPublishedKnowledgeAvailable(projectId, roleId, randomUUID())).toBe(
      false,
    );
  });
  async function packageInput() {
    const base = await publication();
    const bodyBytes = Buffer.from('# Agent guidance\n');
    const sha256 = createHash('sha256').update(bodyBytes).digest('hex');
    const manifest = {
      packageSchemaVersion: '1.0',
      protocolVersion: '1.0',
      id: `fixture.${randomUUID()}`,
      version: '1.0.0',
      title: 'Developer package',
      roleKey: 'dev',
      compatibility: {
        minCliVersion: '1.0.0',
        maxCliVersionExclusive: '2.0.0',
        contractVersion: '1.0',
      },
      inputs: [],
      outputs: [{ key: 'impl', channel: 'ARTIFACT', kind: 'IMPL', contractVersion: '1.0' }],
      resources: [
        {
          id: 'sop',
          kind: 'AGENT_ENTRY',
          path: 'docs/sop.md',
          sha256,
          byteLength: bodyBytes.length,
          mediaType: 'text/markdown',
        },
      ],
      agentEntries: [
        { host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' },
      ],
    };
    const validated = await validateRolePackageInput(manifest, [{ resourceId: 'sop', bodyBytes }]);
    expect(validated.issues).toEqual([]);
    return {
      projectId,
      packageId: manifest.id,
      version: manifest.version,
      roleKey: manifest.roleKey,
      manifest: validated.manifest!,
      manifestDigest: validated.manifestDigest!,
      resources: validated.resources,
      expectedProjectVersion: base.expectedProjectVersion,
      actorUserId: userId,
      userAuthVersion: 1,
      ticket: base.ticket,
      now: new Date(),
      operation: operation(),
    };
  }

  it('registers validated package resources atomically and enforces project visibility', async () => {
    const packages = new V1RolePackagePrismaRepository(db as PrismaService);
    const input = await packageInput();
    const result = await packages.register(input);
    expect(await packages.findVersion(projectId, input.packageId, input.version)).toMatchObject({
      scope: 'PROJECT',
      manifestDigest: input.manifestDigest,
    });
    expect(await packages.findVersion(randomUUID(), input.packageId, input.version)).toBeNull();
    const resource = await packages.findResource(result.packageVersionId, 'sop');
    expect(Buffer.from(resource!.bodyBytes).toString()).toBe('# Agent guidance\n');
    expect(await packages.findResource(result.packageVersionId, 'absent')).toBeNull();
    expect(await packages.findOperation(input.operation)).toMatchObject({ id: input.operation.id });
    expect(await packages.findOperation(operation())).toBeNull();
    expect(await packages.hasBuiltin(input.packageId)).toBe(false);
    expect(await packages.projectRoleKeys(projectId)).toEqual(['dev']);
    expect(await packages.findProject(projectId)).toMatchObject({ version: result.projectVersion });
    expect(await packages.findProject(randomUUID())).toBeNull();
    await expect(
      packages.register({ ...input, expectedProjectVersion: result.projectVersion }),
    ).resolves.toMatchObject({ packageVersionId: result.packageVersionId });
    await expect(
      packages.register({
        ...input,
        expectedProjectVersion: result.projectVersion,
        manifestDigest: digest(),
      }),
    ).rejects.toMatchObject({ message: 'ROLE_PACKAGE_VERSION_CONFLICT' });
  });

  it('rolls back package bytes and project version when confirmation consumption fails', async () => {
    const packages = new V1RolePackagePrismaRepository(db as PrismaService);
    const input = await packageInput();
    await expect(
      packages.register({ ...input, ticket: { ...input.ticket, secretHash: digest() } }),
    ).rejects.toMatchObject({ message: 'CONFIRMATION_CONSUME_CONFLICT' });
    expect(await packages.findVersion(projectId, input.packageId, input.version)).toBeNull();
    expect(await packages.findProject(projectId)).toMatchObject({
      version: input.expectedProjectVersion,
    });
    const before = await db.principalStamp.count({ where: { projectId } });
    const previous = await db.idempotentOperation.findFirstOrThrow({ where: { projectId } });
    await expect(
      packages.register({ ...input, operation: { ...input.operation, id: previous.id } }),
    ).rejects.toThrow();
    expect(await packages.findVersion(projectId, input.packageId, input.version)).toBeNull();
    expect(await db.principalStamp.count({ where: { projectId } })).toBe(before);
  });

  it('paginates visible package versions with stable ordering', async () => {
    const packages = new V1RolePackagePrismaRepository(db as PrismaService);
    await packages.register(await packageInput());
    const first = await packages.list(projectId, { limit: 1, cursor: null });
    expect(first.nextCursor).not.toBeNull();
    const second = await packages.list(projectId, { limit: 1, cursor: first.nextCursor });
    expect(second.items[0].id).not.toBe(first.items[0].id);
    const foreign = await packages.list(randomUUID(), { limit: 100, cursor: null });
    expect(foreign.items.every((item) => item.scope === 'BUILTIN')).toBe(true);
  });
});
