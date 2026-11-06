import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import type { ActionBinding } from '@workmesh/shared';
import { actionDigestOf, hashTicketSecret } from '../src/auth/v1-confirmation';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1ConfirmationPrismaRepository } from '../src/auth/v1-confirmation.prisma-repository';
import { V1AuthorizationService, type V1ProjectContext } from '../src/auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../src/auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../src/auth/v1-policy';
import { V1IdempotencyPrismaRepository } from '../src/common/v1-idempotency.prisma-repository';
import { verifiedTestDatabase, evaluateSuiteTestDatabase } from '../src/common/v1-test-database';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ProjectRepositoryDeclarationService } from '../src/projects/project-repository-declaration.service';
import type { ProjectWriteContext } from '../src/projects/projects.service';
import { WorkspaceDefinitionService } from '../src/projects/workspace-definition.service';
import { WorkspaceEnrollmentService } from '../src/projects/workspace-enrollment.service';
import {
  normalizeWorkspaceDefinition,
  workspaceDefinitionDigest,
} from '../src/projects/workspace-definition-validator';

type QueryBarrier = {
  client: PrismaClient;
  waitUntilReached(): Promise<void>;
  release(): void;
};

/**
 * Hold a real interactive transaction immediately before its selected raw SQL runs.
 * The service still uses PostgreSQL's transaction client and lock statement; this only
 * gives the test a deterministic point to commit a competing request on another pool
 * connection. Prisma.sql exposes the rendered SQL through `.sql`.
 */
function transactionQueryBarrier(
  client: PrismaClient,
  matches: (sql: string) => boolean,
  expectedArrivals = 1,
): QueryBarrier {
  let arrivals = 0;
  let resolveArrivals!: () => void;
  let resolveRelease!: () => void;
  let released = false;
  const reached = new Promise<void>((resolve) => {
    resolveArrivals = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resolveRelease = resolve;
  });

  const wrapped = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (property !== '$transaction' || typeof value !== 'function') {
        return typeof value === 'function' ? value.bind(target) : value;
      }

      return (callback: unknown, ...options: unknown[]) => {
        if (typeof callback !== 'function')
          return Reflect.apply(value, target, [callback, ...options]);
        const wrappedCallback = (tx: object) =>
          Reflect.apply(callback, undefined, [
            new Proxy(tx, {
              get(transaction, txProperty) {
                const txValue = Reflect.get(transaction, txProperty, transaction) as unknown;
                if (txProperty !== '$queryRaw' || typeof txValue !== 'function') {
                  return txValue;
                }
                return (...args: unknown[]) => {
                  const sql = (args[0] as { sql?: unknown } | undefined)?.sql;
                  if (typeof sql === 'string' && matches(sql) && !released) {
                    arrivals += 1;
                    if (arrivals >= expectedArrivals) resolveArrivals();
                    return gate.then(() => Reflect.apply(txValue, transaction, args));
                  }
                  return Reflect.apply(txValue, transaction, args);
                };
              },
            }),
          ]);
        return Reflect.apply(value, target, [wrappedCallback, ...options]);
      };
    },
  }) as PrismaClient;

  return {
    client: wrapped,
    async waitUntilReached() {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          reached,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('database query barrier timed out')),
              10_000,
            );
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    release() {
      released = true;
      resolveRelease();
    },
  };
}

function projectForUpdate(sql: string): boolean {
  return sql.includes('"workmesh_v1"."Project"') && sql.includes('FOR UPDATE');
}

async function waitThenRelease<T>(barrier: QueryBarrier, operation: Promise<T>): Promise<T> {
  try {
    await barrier.waitUntilReached();
  } catch (error) {
    barrier.release();
    await operation.catch(() => undefined);
    throw error;
  }
  barrier.release();
  return operation;
}

/**
 * T2/T3/T4 的隔离数据库集成测试：真实 PostgreSQL 上的唯一索引、Project.version CAS、
 * 票据消费、审计 actorStamp、revision 不可变与接入码一次性消费。
 *
 * 只在显式配置 `WORKMESH_TEST_DATABASE_URL`（workmesh_test_* 前缀）时运行；
 * 未配置时整个套件 skip，绝不回退 `WORKMESH_V1_DATABASE_URL` 或共享库。
 */
const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;

suite('workspace onboarding database integration', () => {
  let db: PrismaClient;
  let userId: string;
  let webSessionId: string;
  let projectId: string;
  let declarations: ProjectRepositoryDeclarationService;
  let enrollments: WorkspaceEnrollmentService;
  let principal: V1Principal;
  let authorization: {
    resolveProjectContext: (
      _principal: V1Principal,
      projectId: string,
      mode: 'read' | 'write',
    ) => Promise<V1ProjectContext>;
    resolveKnowledgeAccess: (
      _principal: V1Principal,
      knowledgeBaseId: string,
    ) => Promise<{ canRead: boolean }>;
  };

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const identity = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(identity[0]!.name).toBe(target.database);

    const user = await db.user.create({
      data: { email: `${randomUUID()}@workspace.test`, passwordHash: 'fixture' },
    });
    userId = user.id;
    const session = await db.webSession.create({
      data: {
        userId,
        tokenHash: hashTicketSecret(randomUUID()),
        csrfTokenHash: hashTicketSecret(randomUUID()),
        userAuthVersion: 1,
        idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    webSessionId = session.id;

    const project = await db.project.create({
      data: {
        key: randomUUID().replaceAll('-', '').slice(0, 6),
        name: 'Workspace fixture',
        createdById: userId,
      },
    });
    projectId = project.id;
    await db.projectMember.create({ data: { projectId, userId, role: 'OWNER' } });

    principal = {
      kind: 'HUMAN',
      userId,
      sessionId: webSessionId,
      authVersion: 1,
      scopes: [],
    };
    authorization = {
      resolveProjectContext: async (_principal, targetProjectId, mode) => {
        const row = await db.project.findUnique({
          where: { id: targetProjectId },
          select: { id: true, version: true, archivedAt: true },
        });
        if (!row) throw new Error('fixture project missing');
        if (mode === 'write' && row.archivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'PROJECT_ARCHIVED',
            { projectId: targetProjectId },
            409,
          );
        const member = await db.projectMember.findUnique({
          where: { projectId_userId: { projectId: targetProjectId, userId } },
          select: { role: true, version: true },
        });
        return {
          project: { id: row.id, version: row.version, archivedAt: row.archivedAt },
          membership: {
            projectId: targetProjectId,
            userId,
            role: member!.role,
            version: member!.version,
            revokedAt: null,
          },
          activeRoleIds: [],
          selectableRoleIds: [],
        };
      },
      resolveKnowledgeAccess: async () => ({ canRead: true }),
    };

    const tickets = new V1ConfirmationPrismaRepository(db as unknown as PrismaService);
    const operations = new V1IdempotencyPrismaRepository(db as unknown as PrismaService);
    declarations = new ProjectRepositoryDeclarationService(
      db as unknown as PrismaService,
      authorization as never,
      tickets,
      operations,
    );
    enrollments = new WorkspaceEnrollmentService(
      db as unknown as PrismaService,
      authorization as never,
      operations,
    );
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await db.projectWorkspaceDefinition.updateMany({
        where: { projectId },
        data: { currentRevisionId: null },
      });
      await db.auditEvent.deleteMany({ where: { projectId } });
      await db.principalStamp.deleteMany({ where: { projectId } });
      await db.idempotentOperation.deleteMany({ where: { projectId } });
      await db.projectWorkspaceEnrollment.deleteMany({ where: { projectId } });
      const revisionRows = await db.projectWorkspaceDefinitionRevision.findMany({
        where: { projectId },
        select: { id: true },
      });
      await db.projectWorkspaceDefinitionRevisionRepository.deleteMany({
        where: { revisionId: { in: revisionRows.map((row) => row.id) } },
      });
      await db.projectWorkspaceDefinitionRevision.deleteMany({ where: { projectId } });
      await db.projectWorkspaceDefinition.deleteMany({ where: { projectId } });
      await db.projectRepositoryLocator.deleteMany({ where: { projectId } });
      await db.projectRepository.deleteMany({ where: { projectId } });
      await db.confirmationTicket.deleteMany({ where: { projectId } });
      if (webSessionId) await db.webSession.delete({ where: { id: webSessionId } });
      await db.projectMember.deleteMany({ where: { projectId } });
      await db.project.delete({ where: { id: projectId } });
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });

  async function currentProjectVersion(): Promise<number> {
    const row = await db.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { version: true },
    });
    return row.version;
  }

  async function insertTicket(binding: ActionBinding) {
    const ticketSecret = randomUUID();
    const row = await db.confirmationTicket.create({
      data: {
        secretHash: hashTicketSecret(ticketSecret),
        userId,
        webSessionId,
        projectId: binding.projectId,
        userAuthVersion: 1,
        action: binding.action,
        targetType: binding.targetType,
        targetId: binding.targetId,
        expectedVersion: binding.expectedVersion,
        actionDigest: actionDigestOf(binding),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
      select: { id: true },
    });
    return { ticketId: row.id, ticketSecret };
  }

  function writeContext(
    route: string,
    body: Record<string, unknown>,
    method = 'POST',
    key = randomUUID(),
  ): ProjectWriteContext {
    return {
      idempotencyKey: key,
      method,
      route,
      body,
      operationId: randomUUID(),
      now: new Date(),
      webSessionId,
      userAuthVersion: 1,
    };
  }

  it('声明新 locator：DECLARED 行 adapter/externalId 为 NULL、写入审计 actorStamp、Project.version CAS 生效', async () => {
    const locator = 'https://github.com/acme/workmesh.git';
    const expectedVersion = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion,
      roleSlot: null,
      payload: { locator, targetRepositoryId: null, displayName: null },
    });
    const input = { expectedProjectVersion: expectedVersion, locator, confirmation };
    const requestContext = writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
      ...input,
      confirmation,
    });
    const result = await declarations.declare(principal, projectId, input, requestContext);

    expect(result.status).toBe(201);
    const repository = await db.projectRepository.findUniqueOrThrow({
      where: { id: result.view.repositoryId },
    });
    expect(repository).toMatchObject({ identityMode: 'DECLARED', adapter: null, externalId: null });
    const locatorRow = await db.projectRepositoryLocator.findFirstOrThrow({
      where: { repositoryId: repository.id, revokedAt: null },
    });
    expect(locatorRow.canonicalLocator).toBe(locator);
    expect(await currentProjectVersion()).toBe(expectedVersion + 1);

    const audit = await db.auditEvent.findFirstOrThrow({
      where: { projectId, action: 'REPOSITORY_DECLARE', targetId: repository.id },
    });
    expect(audit.actorStampId).toBeTruthy();
    const stamp = await db.principalStamp.findUniqueOrThrow({
      where: { id: audit.actorStampId! },
    });
    expect(stamp).toMatchObject({ kind: 'HUMAN', userId, projectId });
    const operation = await db.idempotentOperation.findFirstOrThrow({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
    expect(operation.resultRefs).toMatchObject({ repositoryId: repository.id });
    const consumedTicket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
    });
    expect(consumedTicket.consumedAt).toBeInstanceOf(Date);
    expect(consumedTicket.consumedOperationId).toBe(requestContext.operationId);
  });

  it('同 key 并发声明只提交一次并让败方回放原响应', async () => {
    const auditCountBefore = await db.auditEvent.count({
      where: { projectId, action: 'REPOSITORY_DECLARE' },
    });
    const locator = 'https://git.example.com/team/concurrent-same-key.git';
    const expectedVersion = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion,
      roleSlot: null,
      payload: { locator, targetRepositoryId: null, displayName: null },
    });
    const input = { expectedProjectVersion: expectedVersion, locator, confirmation };
    const route = `/api/v1/projects/${projectId}/repositories/declarations`;
    const body = { ...input, confirmation };
    const key = randomUUID();
    const leftContext = writeContext(route, body, 'POST', key);
    const rightContext = writeContext(route, body, 'POST', key);
    const barrier = transactionQueryBarrier(db, projectForUpdate, 2);
    const concurrentDeclarations = new ProjectRepositoryDeclarationService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const results = await waitThenRelease(
      barrier,
      Promise.all([
        concurrentDeclarations.declare(principal, projectId, input, leftContext),
        concurrentDeclarations.declare(principal, projectId, input, rightContext),
      ]),
    );

    expect(results.map((item) => item.view.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.view.repositoryId).toBe(results[1]!.view.repositoryId);
    expect(results[0]!.view.projectVersion).toBe(expectedVersion + 1);
    expect(results[1]!.view.projectVersion).toBe(expectedVersion + 1);
    expect(await currentProjectVersion()).toBe(expectedVersion + 1);
    expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(1);
    expect(await db.auditEvent.count({ where: { projectId, action: 'REPOSITORY_DECLARE' } })).toBe(
      auditCountBefore + 1,
    );
    const consumedTicket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
    });
    expect(consumedTicket.consumedAt).toBeInstanceOf(Date);
    expect([leftContext.operationId, rightContext.operationId]).toContain(
      consumedTicket.consumedOperationId,
    );
  });

  it('同 canonical locator 不同 key 复用同一 ProjectRepository（200 reused:true，不增加版本）', async () => {
    const locator = 'https://github.com/acme/workmesh.git';
    const repositoryCountBefore = await db.projectRepository.count({ where: { projectId } });
    const locatorCountBefore = await db.projectRepositoryLocator.count({
      where: { projectId, revokedAt: null },
    });
    const versionBefore = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: versionBefore,
      roleSlot: null,
      payload: { locator, targetRepositoryId: null, displayName: null },
    });
    const input = { expectedProjectVersion: versionBefore, locator, confirmation };
    const requestContext = writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
      ...input,
      confirmation,
    });
    const result = await declarations.declare(principal, projectId, input, requestContext);

    expect(result.status).toBe(200);
    expect(result.view.reused).toBe(true);
    expect(await db.projectRepository.count({ where: { projectId } })).toBe(repositoryCountBefore);
    expect(await db.projectRepositoryLocator.count({ where: { projectId, revokedAt: null } })).toBe(
      locatorCountBefore,
    );
    expect(await currentProjectVersion()).toBe(versionBefore);
    const consumedTicket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
    });
    expect(consumedTicket.consumedAt).toBeInstanceOf(Date);
    expect(consumedTicket.consumedOperationId).toBe(requestContext.operationId);
  });

  it('声明已有 PROVIDER locator 时返回并保留真实身份与 provider 展示字段', async () => {
    const suffix = randomUUID();
    const locator = `https://github.com/provider-${suffix}/repo-${suffix}.git`;
    const repository = await db.projectRepository.create({
      data: {
        projectId,
        identityMode: 'PROVIDER',
        adapter: 'GITHUB',
        externalId: `provider-${suffix}`,
        owner: 'provider-owner',
        name: 'provider-maintained-name',
        defaultBranch: 'trunk',
        lastVerifiedStatus: 'PROVIDER_VERIFIED',
      },
    });
    await db.projectRepositoryLocator.create({
      data: {
        projectId,
        repositoryId: repository.id,
        canonicalLocator: locator,
        source: 'HTTPS',
        declaredByUserId: userId,
      },
    });

    const expectedVersion = await currentProjectVersion();
    const displayName = 'human-supplied-alias';
    const confirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion,
      roleSlot: null,
      payload: { locator, targetRepositoryId: null, displayName },
    });
    const input = { expectedProjectVersion: expectedVersion, locator, displayName, confirmation };
    const requestContext = writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
      ...input,
      confirmation,
    });
    const result = await declarations.declare(principal, projectId, input, requestContext);

    expect(result.status).toBe(200);
    expect(result.view).toMatchObject({
      repositoryId: repository.id,
      identityMode: 'PROVIDER',
      owner: 'provider-owner',
      name: 'provider-maintained-name',
      projectVersion: expectedVersion,
      reused: true,
    });
    const unchanged = await db.projectRepository.findUniqueOrThrow({
      where: { id: repository.id },
    });
    expect(unchanged).toMatchObject({
      identityMode: 'PROVIDER',
      adapter: 'GITHUB',
      externalId: `provider-${suffix}`,
      owner: 'provider-owner',
      name: 'provider-maintained-name',
      defaultBranch: 'trunk',
      lastVerifiedStatus: 'PROVIDER_VERIFIED',
    });
    expect(await currentProjectVersion()).toBe(expectedVersion);
    const consumedTicket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
    });
    expect(consumedTicket.consumedAt).toBeInstanceOf(Date);
    expect(consumedTicket.consumedOperationId).toBe(requestContext.operationId);
  });

  it('显式 alias 到已绑定另一仓库的 locator 返回 409 LOCATOR_ALREADY_BOUND', async () => {
    const secondLocator = 'https://github.com/acme/api.git';
    const versionBefore = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: versionBefore,
      roleSlot: null,
      payload: { locator: secondLocator, targetRepositoryId: null, displayName: null },
    });
    const created = await declarations.declare(
      principal,
      projectId,
      { expectedProjectVersion: versionBefore, locator: secondLocator, confirmation },
      writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
        expectedProjectVersion: versionBefore,
        locator: secondLocator,
        confirmation,
      }),
    );

    const aliasLocator = 'https://github.com/acme/workmesh.git';
    const versionForAlias = await currentProjectVersion();
    const aliasConfirmation = await insertTicket({
      action: 'REPOSITORY_DECLARE',
      projectId,
      targetType: 'PROJECT',
      targetId: projectId,
      expectedVersion: versionForAlias,
      roleSlot: null,
      payload: {
        locator: aliasLocator,
        targetRepositoryId: created.view.repositoryId,
        displayName: null,
      },
    });
    const aliasInput = {
      expectedProjectVersion: versionForAlias,
      locator: aliasLocator,
      targetRepositoryId: created.view.repositoryId,
      confirmation: aliasConfirmation,
    };
    await expect(
      declarations.declare(
        principal,
        projectId,
        aliasInput,
        writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
          ...aliasInput,
          confirmation: aliasConfirmation,
        }),
      ),
    ).rejects.toMatchObject({
      code: 'LOCATOR_ALREADY_BOUND',
      details: { boundRepositoryId: expect.any(String) },
    });
  });

  it('并发两个声明使用同一 Project.version：只有一方成功，另一方 409 且无半写', async () => {
    const versionBefore = await currentProjectVersion();
    const existingRepositories = await db.projectRepository.count({ where: { projectId } });
    const locators = ['https://git.example.com/team/a.git', 'https://git.example.com/team/b.git'];
    const prepare = async (locator: string) => {
      const confirmation = await insertTicket({
        action: 'REPOSITORY_DECLARE',
        projectId,
        targetType: 'PROJECT',
        targetId: projectId,
        expectedVersion: versionBefore,
        roleSlot: null,
        payload: { locator, targetRepositoryId: null, displayName: null },
      });
      const input = { expectedProjectVersion: versionBefore, locator, confirmation };
      return () =>
        declarations.declare(
          principal,
          projectId,
          input,
          writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, {
            ...input,
            confirmation,
          }),
        );
    };
    const [left, right] = await Promise.allSettled([
      (await prepare(locators[0]!))(),
      (await prepare(locators[1]!))(),
    ]);
    const fulfilled = [left, right].filter((item) => item.status === 'fulfilled');
    const rejected = [left, right].filter(
      (item) => item.status === 'rejected',
    ) as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'PROJECT_VERSION_CONFLICT', status: 409 });
    expect(await currentProjectVersion()).toBe(versionBefore + 1);
    expect(await db.projectRepository.count({ where: { projectId } })).toBe(
      existingRepositories + 1,
    );
  });

  it('接入码：签发只存 hash，并发消费只有一个成功，且不授予成员权限', async () => {
    const payload = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: {},
      },
      projectId,
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    const digest = workspaceDefinitionDigest(payload.payload);
    const definition = await db.projectWorkspaceDefinition.create({
      data: { projectId, version: 1, draftDigest: digest },
      select: { id: true },
    });
    const revision = await db.projectWorkspaceDefinitionRevision.create({
      data: {
        definitionId: definition.id,
        projectId,
        revisionNo: 1,
        digest,
        payload: payload.payload as never,
        publishedByUserId: userId,
      },
      select: { id: true },
    });
    await db.projectWorkspaceDefinition.update({
      where: { projectId },
      data: { currentRevisionId: revision.id, currentRevisionNo: 1, version: 2, draftDigest: null },
    });

    const enrollmentRoute = `/api/v1/projects/${projectId}/workspace-enrollments`;
    const issueKey = randomUUID();
    const issueContext = () => writeContext(enrollmentRoute, {}, 'POST', issueKey);
    const issueBarrier = transactionQueryBarrier(db, projectForUpdate, 2);
    const concurrentEnrollments = new WorkspaceEnrollmentService(
      issueBarrier.client as unknown as PrismaService,
      authorization as never,
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const sameKeyIssues = await waitThenRelease(
      issueBarrier,
      Promise.allSettled([
        concurrentEnrollments.issue(principal, projectId, {}, issueContext()),
        concurrentEnrollments.issue(principal, projectId, {}, issueContext()),
      ]),
    );
    const issueSuccesses = sameKeyIssues.filter(
      (item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof enrollments.issue>>> =>
        item.status === 'fulfilled',
    );
    const issueFailures = sameKeyIssues.filter(
      (item): item is PromiseRejectedResult => item.status === 'rejected',
    );
    expect(issueSuccesses).toHaveLength(1);
    expect(issueFailures).toHaveLength(1);
    expect(issueFailures[0]!.reason).toMatchObject({
      code: 'ENROLLMENT_CODE_NOT_REPLAYABLE',
      status: 409,
    });
    const invalidated = await db.projectWorkspaceEnrollment.findUniqueOrThrow({
      where: { id: issueSuccesses[0]!.value.enrollmentId },
    });
    expect(invalidated.revokedAt).toBeInstanceOf(Date);

    // A fresh key is required after the one-time response was invalidated.
    const issued = await enrollments.issue(
      principal,
      projectId,
      {},
      writeContext(enrollmentRoute, {}),
    );
    const stored = await db.projectWorkspaceEnrollment.findUniqueOrThrow({
      where: { id: issued.enrollmentId },
    });
    expect(stored.definitionRevisionId).toBe(revision.id);
    expect(stored.definitionDigest).toBe(digest);
    expect(JSON.stringify(stored)).not.toContain(issued.code);

    const membershipBefore = await db.projectMember.count({ where: { projectId } });
    const consumeBarrier = transactionQueryBarrier(db, projectForUpdate, 2);
    const concurrentConsumers = new WorkspaceEnrollmentService(
      consumeBarrier.client as unknown as PrismaService,
      authorization as never,
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const results = await waitThenRelease(
      consumeBarrier,
      Promise.allSettled([
        concurrentConsumers.consume(issued.code, 'db-ip-1'),
        concurrentConsumers.consume(issued.code, 'db-ip-2'),
      ]),
    );
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    const rejected = results.filter(
      (item) => item.status === 'rejected',
    ) as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'ENROLLMENT_CONSUMED', status: 409 });
    const consumed = await db.projectWorkspaceEnrollment.findUniqueOrThrow({
      where: { id: issued.enrollmentId },
    });
    expect(consumed.consumedAt).toBeInstanceOf(Date);
    expect(await db.projectMember.count({ where: { projectId } })).toBe(membershipBefore);
    expect(
      await db.auditEvent.count({
        where: { projectId, action: 'WORKSPACE_ENROLLMENT_CONSUME' },
      }),
    ).toBe(1);
    expect(
      await db.auditEvent.count({ where: { projectId, action: 'WORKSPACE_ENROLLMENT_ISSUE' } }),
    ).toBe(2);
  });

  it('并发发布：只有一次成功，revision 只新增一条，definitionVersion/Project.version 各递增一次', async () => {
    const payload = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: {},
      },
      projectId,
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    const digest = workspaceDefinitionDigest(payload.payload);
    await db.projectWorkspaceDefinition.update({
      where: { projectId },
      data: {
        draftPayload: payload.payload as never,
        draftDigest: digest,
        version: 3,
      },
    });
    const projectVersionBefore = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: projectVersionBefore,
      roleSlot: null,
      payload: { expectedDefinitionVersion: 3, payloadDigest: digest },
    });
    const request = {
      expectedProjectVersion: projectVersionBefore,
      expectedDefinitionVersion: 3,
      payloadDigest: digest,
      confirmation,
    };
    const route = `/api/v1/projects/${projectId}/workspace-definition/publish`;
    const body = { ...request, confirmation };
    const key = randomUUID();
    const leftContext = writeContext(route, body, 'POST', key);
    const rightContext = writeContext(route, body, 'POST', key);
    const barrier = transactionQueryBarrier(db, projectForUpdate, 2);
    const concurrentDefinitions = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const [left, right] = await waitThenRelease(
      barrier,
      Promise.allSettled([
        concurrentDefinitions.publish(principal, projectId, request, leftContext),
        concurrentDefinitions.publish(principal, projectId, request, rightContext),
      ]),
    );
    const fulfilled = [left, right].filter(
      (
        item,
      ): item is PromiseFulfilledResult<
        Awaited<ReturnType<WorkspaceDefinitionService['publish']>>
      > => item.status === 'fulfilled',
    );
    const rejected = [left, right].filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(0);
    expect(fulfilled.map((item) => item.value.replayed).sort()).toEqual([false, true]);
    expect(fulfilled[0]!.value.revisionId).toBe(fulfilled[1]!.value.revisionId);
    const definition = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
    });
    expect(definition.version).toBe(4);
    expect(definition.draftPayload).toBeNull();
    expect(await currentProjectVersion()).toBe(projectVersionBefore + 1);
    expect(await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } })).toBe(2);
    expect(
      await db.auditEvent.count({ where: { projectId, action: 'WORKSPACE_DEFINITION_PUBLISH' } }),
    ).toBe(1);
    expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(1);
    const consumedTicket = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
    });
    expect(consumedTicket.consumedAt).toBeInstanceOf(Date);
    expect([leftContext.operationId, rightContext.operationId]).toContain(
      consumedTicket.consumedOperationId,
    );
  });

  it('同 key 并发保存草稿只写一次，败方回放原响应而非版本冲突', async () => {
    const normalized = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: {},
      },
      projectId,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const digest = workspaceDefinitionDigest(normalized.payload);
    const definitionBefore = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { version: true },
    });
    const request = {
      expectedDefinitionVersion: definitionBefore.version,
      payloadDigest: digest,
      definition: normalized.payload,
    };
    const route = `/api/v1/projects/${projectId}/workspace-definition/draft`;
    const key = randomUUID();
    const leftContext = writeContext(route, request, 'PUT', key);
    const rightContext = writeContext(route, request, 'PUT', key);
    const barrier = transactionQueryBarrier(db, projectForUpdate, 2);
    const concurrentDefinitions = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const results = await waitThenRelease(
      barrier,
      Promise.all([
        concurrentDefinitions.saveDraft(principal, projectId, request, leftContext),
        concurrentDefinitions.saveDraft(principal, projectId, request, rightContext),
      ]),
    );
    expect(results.map((item) => item.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.definitionVersion).toBe(definitionBefore.version + 1);
    expect(results[1]!.definitionVersion).toBe(definitionBefore.version + 1);
    expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(1);
  });

  it('项目归档先于事务锁提交时，草稿不能写入或留下幂等记录', async () => {
    const normalized = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: {},
      },
      projectId,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const definitionBefore = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { version: true, draftDigest: true, draftPayload: true },
    });
    const projectVersionBefore = await currentProjectVersion();
    const request = {
      expectedDefinitionVersion: definitionBefore.version,
      payloadDigest: workspaceDefinitionDigest(normalized.payload),
      definition: normalized.payload,
    };
    const route = `/api/v1/projects/${projectId}/workspace-definition/draft`;
    const key = randomUUID();
    const barrier = transactionQueryBarrier(db, projectForUpdate);
    const guardedDefinitions = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const saveResult = guardedDefinitions
      .saveDraft(principal, projectId, request, writeContext(route, request, 'PUT', key))
      .then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({ status: 'rejected' as const, error }),
      );
    const outcome = await (async () => {
      try {
        await barrier.waitUntilReached();
        await db.project.update({
          where: { id: projectId },
          data: { archivedAt: new Date(), version: { increment: 1 } },
        });
        barrier.release();
        return await saveResult;
      } finally {
        barrier.release();
        await saveResult;
        await db.project.update({
          where: { id: projectId },
          data: { archivedAt: null, version: { increment: 1 } },
        });
      }
    })();
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PROJECT_ARCHIVED',
      status: 409,
    });
    const definitionAfter = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { version: true, draftDigest: true, draftPayload: true },
    });
    expect(definitionAfter).toEqual(definitionBefore);
    expect(await currentProjectVersion()).toBe(projectVersionBefore + 2);
    expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(0);
  });

  it('项目归档先于消费事务锁提交时，接入码保持未消费且不写消费审计', async () => {
    const route = `/api/v1/projects/${projectId}/workspace-enrollments`;
    const issued = await enrollments.issue(principal, projectId, {}, writeContext(route, {}));
    const enrollmentBefore = await db.projectWorkspaceEnrollment.findUniqueOrThrow({
      where: { id: issued.enrollmentId },
      select: { consumedAt: true, version: true },
    });
    const projectVersionBefore = await currentProjectVersion();
    const consumeAuditCount = await db.auditEvent.count({
      where: { projectId, action: 'WORKSPACE_ENROLLMENT_CONSUME' },
    });
    const barrier = transactionQueryBarrier(db, projectForUpdate);
    const guardedEnrollments = new WorkspaceEnrollmentService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const consumeResult = guardedEnrollments.consume(issued.code, 'db-ip-archive-race').then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    const outcome = await (async () => {
      try {
        await barrier.waitUntilReached();
        await db.project.update({
          where: { id: projectId },
          data: { archivedAt: new Date(), version: { increment: 1 } },
        });
        barrier.release();
        return await consumeResult;
      } finally {
        barrier.release();
        await consumeResult;
        await db.project.update({
          where: { id: projectId },
          data: { archivedAt: null, version: { increment: 1 } },
        });
      }
    })();
    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.error).toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PROJECT_ARCHIVED',
      status: 409,
    });
    const enrollmentAfter = await db.projectWorkspaceEnrollment.findUniqueOrThrow({
      where: { id: issued.enrollmentId },
      select: { consumedAt: true, version: true },
    });
    expect(enrollmentAfter).toEqual(enrollmentBefore);
    expect(
      await db.auditEvent.count({
        where: { projectId, action: 'WORKSPACE_ENROLLMENT_CONSUME' },
      }),
    ).toBe(consumeAuditCount);
    expect(await currentProjectVersion()).toBe(projectVersionBefore + 2);
  });

  it('预检后文档归档会阻止发布，且不消费票据或写 revision/审计', async () => {
    const knowledgeBase = await db.knowledgeBase.create({
      data: {
        projectId,
        key: randomUUID(),
        name: 'Workspace race fixture',
        visibility: 'PROJECT',
        publicationApproverUserId: userId,
      },
      select: { id: true },
    });
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId: knowledgeBase.id, kind: 'KNOWLEDGE' },
      select: { id: true },
    });
    const normalized = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: { requiredDocumentIds: [document.id] },
      },
      projectId,
    );
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;

    const definitionBefore = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { id: true, version: true, currentRevisionNo: true },
    });
    const definitionVersion = definitionBefore.version + 1;
    const digest = workspaceDefinitionDigest(normalized.payload);
    await db.projectWorkspaceDefinition.update({
      where: { id: definitionBefore.id },
      data: {
        version: definitionVersion,
        draftPayload: normalized.payload as never,
        draftDigest: digest,
      },
    });
    const projectVersionBefore = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: projectVersionBefore,
      roleSlot: null,
      payload: { expectedDefinitionVersion: definitionVersion, payloadDigest: digest },
    });
    const request = {
      expectedProjectVersion: projectVersionBefore,
      expectedDefinitionVersion: definitionVersion,
      payloadDigest: digest,
      confirmation,
    };
    const route = `/api/v1/projects/${projectId}/workspace-definition/publish`;
    const key = randomUUID();
    const context = writeContext(route, { ...request, confirmation }, 'POST', key);
    const revisionCountBefore = await db.projectWorkspaceDefinitionRevision.count({
      where: { projectId },
    });
    const auditCountBefore = await db.auditEvent.count({
      where: { projectId, action: 'WORKSPACE_DEFINITION_PUBLISH' },
    });
    const barrier = transactionQueryBarrier(
      db,
      (sql) => sql.includes('"workmesh_v1"."KnowledgeDocument"') && sql.includes('FOR SHARE'),
    );
    const guardedDefinitions = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      authorization as never,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const publishResult = guardedDefinitions.publish(principal, projectId, request, context).then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (error: unknown) => ({ status: 'rejected' as const, error }),
    );
    const outcome = await (async () => {
      try {
        await barrier.waitUntilReached();
        await db.knowledgeDocument.update({
          where: { id: document.id },
          data: { archivedAt: new Date() },
        });
        barrier.release();
        return await publishResult;
      } finally {
        barrier.release();
        await publishResult;
        await db.knowledgeDocument.update({
          where: { id: document.id },
          data: { archivedAt: null },
        });
        await db.knowledgeDocument.delete({ where: { id: document.id } });
        await db.knowledgeBase.delete({ where: { id: knowledgeBase.id } });
      }
    })();

    expect(outcome.status).toBe('rejected');
    if (outcome.status !== 'rejected') return;
    expect(outcome.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'DEFINITION_INVALID',
      status: 422,
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ code: 'DOCUMENT_ARCHIVED' })]),
      },
    });
    const definitionAfter = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: {
        version: true,
        draftPayload: true,
        draftDigest: true,
        currentRevisionNo: true,
      },
    });
    expect(definitionAfter).toMatchObject({
      version: definitionVersion,
      draftPayload: normalized.payload,
      draftDigest: digest,
      currentRevisionNo: definitionBefore.currentRevisionNo,
    });
    expect(await currentProjectVersion()).toBe(projectVersionBefore);
    expect(await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } })).toBe(
      revisionCountBefore,
    );
    expect(
      await db.auditEvent.count({
        where: { projectId, action: 'WORKSPACE_DEFINITION_PUBLISH' },
      }),
    ).toBe(auditCountBefore);
    expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(0);
    const ticketAfter = await db.confirmationTicket.findUniqueOrThrow({
      where: { id: confirmation.ticketId },
      select: { consumedAt: true, consumedOperationId: true },
    });
    expect(ticketAfter).toEqual({ consumedAt: null, consumedOperationId: null });
  });

  it('发布最终权限复核前撤销文档读取 grant，不提交 revision 或消费票据', async () => {
    const kb = await db.knowledgeBase.create({
      data: {
        projectId,
        key: randomUUID(),
        name: 'Grant race',
        visibility: 'RESTRICTED',
        publicationApproverUserId: userId,
      },
    });
    const grant = await db.knowledgeBaseGrant.create({
      data: {
        projectId,
        knowledgeBaseId: kb.id,
        subjectKind: 'USER',
        subjectUserId: userId,
        permissions: ['READ'],
      },
    });
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId: kb.id, kind: 'KNOWLEDGE' },
    });
    const normalized = normalizeWorkspaceDefinition(
      {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'NONE' },
        repositories: [],
        contextPolicy: { requiredDocumentIds: [document.id] },
      },
      projectId,
    );
    if (!normalized.ok) throw new Error('invalid fixture');
    const digest = workspaceDefinitionDigest(normalized.payload);
    const previous = await db.projectWorkspaceDefinition.findUniqueOrThrow({
      where: { projectId },
      select: { id: true, version: true },
    });
    const definitionVersion = previous.version + 1;
    await db.projectWorkspaceDefinition.update({
      where: { id: previous.id },
      data: {
        version: definitionVersion,
        draftPayload: normalized.payload as never,
        draftDigest: digest,
      },
    });
    const projectVersion = await currentProjectVersion();
    const confirmation = await insertTicket({
      action: 'WORKSPACE_DEFINITION_PUBLISH',
      projectId,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      targetId: projectId,
      expectedVersion: projectVersion,
      roleSlot: null,
      payload: { expectedDefinitionVersion: definitionVersion, payloadDigest: digest },
    });
    const input = {
      expectedProjectVersion: projectVersion,
      expectedDefinitionVersion: definitionVersion,
      payloadDigest: digest,
      confirmation,
    };
    const key = randomUUID();
    const barrier = transactionQueryBarrier(
      db,
      (sql) => sql.includes('"workmesh_v1"."KnowledgeBaseGrant"') && sql.includes('FOR SHARE'),
    );
    const realAuth = new V1AuthorizationService(
      new V1AuthorizationPrismaRepository(db as unknown as PrismaService),
    );
    const service = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      realAuth,
      new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    const revisionCount = await db.projectWorkspaceDefinitionRevision.count({
      where: { projectId },
    });
    const auditCount = await db.auditEvent.count({
      where: { projectId, action: 'WORKSPACE_DEFINITION_PUBLISH' },
    });
    const attempt = service
      .publish(
        principal,
        projectId,
        input,
        writeContext(
          `/api/v1/projects/${projectId}/workspace-definition/publish`,
          input,
          'POST',
          key,
        ),
      )
      .then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
    try {
      await barrier.waitUntilReached();
      await db.knowledgeBaseGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date() },
      });
      barrier.release();
      const outcome = await attempt;
      expect(outcome.error).toMatchObject({
        code: 'VALIDATION_FAILED',
        status: 422,
        details: {
          issues: expect.arrayContaining([expect.objectContaining({ code: 'DOCUMENT_FORBIDDEN' })]),
        },
      });
      expect(await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } })).toBe(
        revisionCount,
      );
      expect(
        await db.auditEvent.count({ where: { projectId, action: 'WORKSPACE_DEFINITION_PUBLISH' } }),
      ).toBe(auditCount);
      expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(0);
      expect(
        await db.confirmationTicket.findUniqueOrThrow({
          where: { id: confirmation.ticketId },
          select: { consumedAt: true, consumedOperationId: true },
        }),
      ).toEqual({ consumedAt: null, consumedOperationId: null });
      expect(await currentProjectVersion()).toBe(projectVersion);
    } finally {
      barrier.release();
      await attempt;
      await db.knowledgeBaseGrant.delete({ where: { id: grant.id } });
      await db.knowledgeDocument.delete({ where: { id: document.id } });
      await db.knowledgeBase.delete({ where: { id: kb.id } });
    }
  }, 20_000);

  it('单连接池内声明、草稿、引用发布和签码均不申请第二连接', async () => {
    const url = new URL(verifiedTestDatabase().url);
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '2');
    const limited = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const realAuth = new V1AuthorizationService(
      new V1AuthorizationPrismaRepository(limited as unknown as PrismaService),
    );
    const tickets = new V1ConfirmationPrismaRepository(limited as unknown as PrismaService);
    const operations = new V1IdempotencyPrismaRepository(limited as unknown as PrismaService);
    const declarationService = new ProjectRepositoryDeclarationService(
      limited as unknown as PrismaService,
      realAuth,
      tickets,
      operations,
    );
    const definitionService = new WorkspaceDefinitionService(
      limited as unknown as PrismaService,
      realAuth,
      tickets,
      operations,
    );
    const enrollmentService = new WorkspaceEnrollmentService(
      limited as unknown as PrismaService,
      realAuth,
      operations,
    );
    const kb = await db.knowledgeBase.create({
      data: {
        projectId,
        key: randomUUID(),
        name: 'Pool fixture',
        visibility: 'PROJECT',
        publicationApproverUserId: userId,
      },
    });
    const document = await db.knowledgeDocument.create({
      data: { projectId, knowledgeBaseId: kb.id, kind: 'KNOWLEDGE' },
    });
    try {
      const projectVersion = await currentProjectVersion();
      const locator = `https://github.com/connection-pool/${randomUUID()}.git`;
      const confirmation = await insertTicket({
        action: 'REPOSITORY_DECLARE',
        projectId,
        targetType: 'PROJECT',
        targetId: projectId,
        expectedVersion: projectVersion,
        roleSlot: null,
        payload: { locator, targetRepositoryId: null, displayName: null },
      });
      const declaration = { expectedProjectVersion: projectVersion, locator, confirmation };
      const result = await declarationService.declare(
        principal,
        projectId,
        declaration,
        writeContext(`/api/v1/projects/${projectId}/repositories/declarations`, declaration),
      );
      expect(result.status).toBe(201);
      const normalized = normalizeWorkspaceDefinition(
        {
          schemaVersion: '1.0',
          projectId,
          layout: { kind: 'NONE' },
          repositories: [],
          contextPolicy: { requiredDocumentIds: [document.id] },
        },
        projectId,
      );
      if (!normalized.ok) throw new Error('invalid fixture');
      const digest = workspaceDefinitionDigest(normalized.payload);
      const row = await db.projectWorkspaceDefinition.findUniqueOrThrow({
        where: { projectId },
        select: { version: true },
      });
      const draft = {
        expectedDefinitionVersion: row.version,
        payloadDigest: digest,
        definition: normalized.payload,
      };
      const saved = await definitionService.saveDraft(
        principal,
        projectId,
        draft,
        writeContext(`/api/v1/projects/${projectId}/workspace-definition/draft`, draft, 'PUT'),
      );
      const currentVersion = await currentProjectVersion();
      const publishConfirmation = await insertTicket({
        action: 'WORKSPACE_DEFINITION_PUBLISH',
        projectId,
        targetType: 'PROJECT_WORKSPACE_DEFINITION',
        targetId: projectId,
        expectedVersion: currentVersion,
        roleSlot: null,
        payload: { expectedDefinitionVersion: saved.definitionVersion, payloadDigest: digest },
      });
      const publish = {
        expectedProjectVersion: currentVersion,
        expectedDefinitionVersion: saved.definitionVersion,
        payloadDigest: digest,
        confirmation: publishConfirmation,
      };
      const revision = await definitionService.publish(
        principal,
        projectId,
        publish,
        writeContext(`/api/v1/projects/${projectId}/workspace-definition/publish`, publish),
      );
      expect(revision.digest).toBe(digest);
      const issued = await enrollmentService.issue(
        principal,
        projectId,
        {},
        writeContext(`/api/v1/projects/${projectId}/workspace-enrollments`, {}),
      );
      expect(issued.definitionRevisionId).toBe(revision.revisionId);
    } finally {
      await limited.$disconnect();
      await db.knowledgeDocument.delete({ where: { id: document.id } });
      await db.knowledgeBase.delete({ where: { id: kb.id } });
    }
  }, 20_000);

  it('两个事务占满两连接池时，同 key 草稿仍可提交及回放', async () => {
    const url = new URL(verifiedTestDatabase().url);
    url.searchParams.set('connection_limit', '2');
    url.searchParams.set('pool_timeout', '2');
    const limited = new PrismaClient({ datasources: { db: { url: url.toString() } } });
    const barrier = transactionQueryBarrier(limited, projectForUpdate, 2);
    const realAuth = new V1AuthorizationService(
      new V1AuthorizationPrismaRepository(limited as unknown as PrismaService),
    );
    const service = new WorkspaceDefinitionService(
      barrier.client as unknown as PrismaService,
      realAuth,
      new V1ConfirmationPrismaRepository(limited as unknown as PrismaService),
      new V1IdempotencyPrismaRepository(limited as unknown as PrismaService),
    );
    try {
      const normalized = normalizeWorkspaceDefinition(
        {
          schemaVersion: '1.0',
          projectId,
          layout: { kind: 'NONE' },
          repositories: [],
          contextPolicy: {},
        },
        projectId,
      );
      if (!normalized.ok) throw new Error('invalid fixture');
      const row = await db.projectWorkspaceDefinition.findUniqueOrThrow({
        where: { projectId },
        select: { version: true },
      });
      const input = {
        expectedDefinitionVersion: row.version,
        payloadDigest: workspaceDefinitionDigest(normalized.payload),
        definition: normalized.payload,
      };
      const key = randomUUID();
      const route = `/api/v1/projects/${projectId}/workspace-definition/draft`;
      const results = await waitThenRelease(
        barrier,
        Promise.all([
          service.saveDraft(principal, projectId, input, writeContext(route, input, 'PUT', key)),
          service.saveDraft(principal, projectId, input, writeContext(route, input, 'PUT', key)),
        ]),
      );
      expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    } finally {
      barrier.release();
      await limited.$disconnect();
    }
  }, 20_000);

  it('声明竞争恢复不得用新版本覆盖旧版本的展示字段；无变化复用仍可完成', async () => {
    for (const changeName of [true, false]) {
      const expectedVersion = await currentProjectVersion();
      const locator = `https://github.com/recovery-race/${randomUUID()}.git`;
      const displayName = changeName ? 'request-name' : undefined;
      const confirmation = await insertTicket({
        action: 'REPOSITORY_DECLARE',
        projectId,
        targetType: 'PROJECT',
        targetId: projectId,
        expectedVersion,
        roleSlot: null,
        payload: { locator, targetRepositoryId: null, displayName: displayName ?? null },
      });
      const input = { expectedProjectVersion: expectedVersion, locator, displayName, confirmation };
      const key = randomUUID();
      const context = writeContext(
        `/api/v1/projects/${projectId}/repositories/declarations`,
        input,
        'POST',
        key,
      );
      let reached!: () => void;
      let release!: () => void;
      const atRace = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let first = true;
      const raced = new Proxy(db, {
        get(target, property) {
          const value = Reflect.get(target, property, target) as unknown;
          if (property === '$transaction' && typeof value === 'function') {
            return (...args: unknown[]) => {
              if (!first) return Reflect.apply(value, target, args);
              first = false;
              reached();
              return gate.then(() => {
                throw { code: 'P2002', meta: { target: ['projectId', 'canonicalLocator'] } };
              });
            };
          }
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const service = new ProjectRepositoryDeclarationService(
        raced as unknown as PrismaService,
        authorization as never,
        new V1ConfirmationPrismaRepository(db as unknown as PrismaService),
        new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
      );
      const auditBefore = await db.auditEvent.count({
        where: { projectId, action: 'REPOSITORY_DECLARE' },
      });
      const attempt = service.declare(principal, projectId, input, context).then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      await atRace;
      const repository = await db.$transaction(async (tx) => {
        const created = await tx.projectRepository.create({
          data: {
            projectId,
            identityMode: 'DECLARED',
            owner: 'recovery-race',
            name: 'winner-name',
          },
        });
        await tx.projectRepositoryLocator.create({
          data: { projectId, repositoryId: created.id, canonicalLocator: locator, source: 'HTTPS' },
        });
        await tx.project.update({ where: { id: projectId }, data: { version: { increment: 1 } } });
        return created;
      });
      release();
      const outcome = await attempt;
      const after = await db.projectRepository.findUniqueOrThrow({ where: { id: repository.id } });
      expect(after.name).toBe('winner-name');
      expect(await currentProjectVersion()).toBe(expectedVersion + 1);
      const ticket = await db.confirmationTicket.findUniqueOrThrow({
        where: { id: confirmation.ticketId },
      });
      if (changeName) {
        expect(outcome.error).toMatchObject({ status: 409 });
        expect(ticket.consumedAt).toBeNull();
        expect(ticket.consumedOperationId).toBeNull();
        expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(0);
        expect(
          await db.auditEvent.count({ where: { projectId, action: 'REPOSITORY_DECLARE' } }),
        ).toBe(auditBefore);
      } else {
        expect(outcome.value?.view).toMatchObject({
          reused: true,
          projectVersion: expectedVersion + 1,
        });
        expect(ticket.consumedOperationId).toBe(context.operationId);
        expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(1);
        expect(
          await db.auditEvent.count({ where: { projectId, action: 'REPOSITORY_DECLARE' } }),
        ).toBe(auditBefore + 1);
      }
    }
  }, 20_000);
  for (const [kind, change] of [
    ['draft', 'demote'],
    ['draft', 'revoke'],
    ['publish', 'demote'],
    ['publish', 'revoke'],
    ['declaration', 'demote'],
    ['declaration', 'revoke'],
    ['enrollment', 'revoke'],
    ['enrollment', 'demote'],
  ] as const) {
    it(`成员权限预检后变化：${kind} ${change} 遵守当前权限`, async () => {
      // These changes are constructed directly in the isolated database: the product
      // currently has no member revocation or management-role demotion endpoint.
      await db.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role: 'OWNER', revokedAt: null, version: { increment: 1 } },
      });
      const normalized = normalizeWorkspaceDefinition(
        {
          schemaVersion: '1.0',
          projectId,
          layout: { kind: 'NONE' },
          repositories: [],
          contextPolicy: { requiredDocumentIds: [] },
        },
        projectId,
      );
      if (!normalized.ok) throw new Error('invalid fixture');
      const digest = workspaceDefinitionDigest(normalized.payload);
      let definition = await db.projectWorkspaceDefinition.findUnique({ where: { projectId } });
      if (!definition)
        definition = await db.projectWorkspaceDefinition.create({ data: { projectId } });
      if (kind === 'enrollment' && !definition.currentRevisionId) {
        const revision = await db.projectWorkspaceDefinitionRevision.create({
          data: {
            definitionId: definition.id,
            projectId,
            revisionNo: 1,
            digest,
            payload: normalized.payload as never,
            publishedByUserId: userId,
          },
        });
        definition = await db.projectWorkspaceDefinition.update({
          where: { projectId },
          data: { currentRevisionId: revision.id, currentRevisionNo: 1 },
        });
      }
      if (kind === 'publish') {
        await db.projectWorkspaceDefinition.update({
          where: { projectId },
          data: {
            draftPayload: normalized.payload as never,
            draftDigest: digest,
          },
        });
      }
      const projectVersion = await currentProjectVersion();
      let confirmation: { ticketId: string; ticketSecret: string } | undefined;
      const locator = `https://github.com/member-race/${randomUUID()}.git`;
      if (kind === 'publish')
        confirmation = await insertTicket({
          action: 'WORKSPACE_DEFINITION_PUBLISH',
          projectId,
          targetType: 'PROJECT_WORKSPACE_DEFINITION',
          targetId: projectId,
          expectedVersion: projectVersion,
          roleSlot: null,
          payload: { expectedDefinitionVersion: definition.version, payloadDigest: digest },
        });
      if (kind === 'declaration')
        confirmation = await insertTicket({
          action: 'REPOSITORY_DECLARE',
          projectId,
          targetType: 'PROJECT',
          targetId: projectId,
          expectedVersion: projectVersion,
          roleSlot: null,
          payload: { locator, targetRepositoryId: null, displayName: null },
        });
      const key = randomUUID();
      const barrier = transactionQueryBarrier(db, projectForUpdate);
      const realAuth = new V1AuthorizationService(
        new V1AuthorizationPrismaRepository(db as unknown as PrismaService),
      );
      const tickets = new V1ConfirmationPrismaRepository(db as unknown as PrismaService);
      const operations = new V1IdempotencyPrismaRepository(db as unknown as PrismaService);
      const definitions = new WorkspaceDefinitionService(
        barrier.client as unknown as PrismaService,
        realAuth,
        tickets,
        operations,
      );
      const declaration = new ProjectRepositoryDeclarationService(
        barrier.client as unknown as PrismaService,
        realAuth,
        tickets,
        operations,
      );
      const enrollment = new WorkspaceEnrollmentService(
        barrier.client as unknown as PrismaService,
        realAuth,
        operations,
      );
      const before = {
        definition: await db.projectWorkspaceDefinition.findUniqueOrThrow({ where: { projectId } }),
        revisions: await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } }),
        audit: await db.auditEvent.count({ where: { projectId } }),
        enrollments: await db.projectWorkspaceEnrollment.count({ where: { projectId } }),
        repositories: await db.projectRepository.count({ where: { projectId } }),
      };
      let operation: Promise<unknown>;
      if (kind === 'draft') {
        const input = {
          expectedDefinitionVersion: definition.version,
          payloadDigest: digest,
          definition: normalized.payload,
        };
        operation = definitions.saveDraft(
          principal,
          projectId,
          input,
          writeContext(
            `/api/v1/projects/${projectId}/workspace-definition/draft`,
            input,
            'PUT',
            key,
          ),
        );
      } else if (kind === 'publish') {
        const input = {
          expectedProjectVersion: projectVersion,
          expectedDefinitionVersion: definition.version,
          payloadDigest: digest,
          confirmation: confirmation!,
        };
        operation = definitions.publish(
          principal,
          projectId,
          input,
          writeContext(
            `/api/v1/projects/${projectId}/workspace-definition/publish`,
            input,
            'POST',
            key,
          ),
        );
      } else if (kind === 'declaration') {
        const input = {
          expectedProjectVersion: projectVersion,
          locator,
          confirmation: confirmation!,
        };
        operation = declaration.declare(
          principal,
          projectId,
          input,
          writeContext(
            `/api/v1/projects/${projectId}/repositories/declarations`,
            input,
            'POST',
            key,
          ),
        );
      } else {
        operation = enrollment.issue(
          principal,
          projectId,
          {},
          writeContext(`/api/v1/projects/${projectId}/workspace-enrollments`, {}, 'POST', key),
        );
      }
      const attempt = operation.then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
      try {
        await barrier.waitUntilReached();
        await db.projectMember.update({
          where: { projectId_userId: { projectId, userId } },
          data: {
            ...(change === 'revoke' ? { revokedAt: new Date() } : { role: 'MEMBER' as const }),
            version: { increment: 1 },
          },
        });
        barrier.release();
        const outcome = await attempt;
        if (kind === 'enrollment' && change === 'demote') {
          expect(outcome.error).toBeNull();
          const issued = outcome.value as { enrollmentId: string };
          const member = await db.projectMember.findUniqueOrThrow({
            where: { projectId_userId: { projectId, userId } },
          });
          const audit = await db.auditEvent.findFirstOrThrow({
            where: { projectId, targetId: issued.enrollmentId },
            include: { actorStamp: true },
          });
          expect(audit.actorStamp.memberVersion).toBe(member.version);
          expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(1);
          expect(await currentProjectVersion()).toBe(projectVersion);
          return;
        }
        expect(outcome.error).toMatchObject({ status: change === 'revoke' ? 404 : 403 });
        expect(await currentProjectVersion()).toBe(projectVersion);
        expect(
          await db.projectWorkspaceDefinition.findUniqueOrThrow({ where: { projectId } }),
        ).toEqual(before.definition);
        expect(await db.projectWorkspaceDefinitionRevision.count({ where: { projectId } })).toBe(
          before.revisions,
        );
        expect(await db.auditEvent.count({ where: { projectId } })).toBe(before.audit);
        expect(await db.projectWorkspaceEnrollment.count({ where: { projectId } })).toBe(
          before.enrollments,
        );
        expect(await db.projectRepository.count({ where: { projectId } })).toBe(
          before.repositories,
        );
        expect(await db.idempotentOperation.count({ where: { projectId, key } })).toBe(0);
        if (confirmation)
          expect(
            await db.confirmationTicket.findUniqueOrThrow({
              where: { id: confirmation.ticketId },
              select: { consumedAt: true, consumedOperationId: true },
            }),
          ).toEqual({ consumedAt: null, consumedOperationId: null });
      } finally {
        barrier.release();
        await attempt;
        await db.projectMember.update({
          where: { projectId_userId: { projectId, userId } },
          data: { role: 'OWNER', revokedAt: null, version: { increment: 1 } },
        });
      }
    }, 20_000);
  }

  it('活动 MEMBER 可签发接入码且审计使用当前成员版本', async () => {
    await db.projectMember.update({
      where: { projectId_userId: { projectId, userId } },
      data: { role: 'MEMBER', revokedAt: null, version: { increment: 1 } },
    });
    const realAuth = new V1AuthorizationService(
      new V1AuthorizationPrismaRepository(db as unknown as PrismaService),
    );
    const service = new WorkspaceEnrollmentService(
      db as unknown as PrismaService,
      realAuth,
      new V1IdempotencyPrismaRepository(db as unknown as PrismaService),
    );
    try {
      const member = await db.projectMember.findUniqueOrThrow({
        where: { projectId_userId: { projectId, userId } },
      });
      const issued = await service.issue(
        principal,
        projectId,
        {},
        writeContext(`/api/v1/projects/${projectId}/workspace-enrollments`, {}),
      );
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { projectId, targetId: issued.enrollmentId },
        include: { actorStamp: true },
      });
      expect(audit.actorStamp.memberVersion).toBe(member.version);
    } finally {
      await db.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role: 'OWNER', revokedAt: null, version: { increment: 1 } },
      });
    }
  });
});
