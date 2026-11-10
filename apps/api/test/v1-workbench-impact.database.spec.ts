import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { attachDependencyImpact } from '../src/workbench/v1-workbench-dependency-impact';
import type { WorkbenchReadyTaskItem } from '../src/workbench/v1-workbench.service';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
suite('PostgreSQL complete workflow impact graph', () => {
  let db: PrismaClient;
  let projectId: string;
  let userId: string;
  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    expect(
      (await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name,
    ).toBe(target.database);
    userId = (
      await db.user.create({
        data: { email: `${randomUUID()}@impact.test`, passwordHash: 'fixture' },
      })
    ).id;
    projectId = (
      await db.project.create({
        data: { key: 'IMPACT', name: 'Impact fixture', createdById: userId },
      })
    ).id;
  });
  it('counts tasks outside the displayed page, respects joins and does not modify facts', async () => {
    const requirement = await db.requirement.create({
      data: { projectId, seq: 1, code: 'IMPACT-001', title: 'Impact' },
    });
    const role = await db.projectRole.create({
      data: { projectId, key: 'dev', title: 'Developer' },
    });
    const definition = await db.workflowDefinition.create({
      data: { projectId, workflowKey: 'impact' },
    });
    const steps = Array.from({ length: 70 }, (_, index) => ({
      key: `s${index}`,
      deps: index ? [`s${index - 1}`] : [],
    }));
    const revision = await db.workflowRevision.create({
      data: {
        projectId,
        definitionId: definition.id,
        revision: 1,
        digest: createHash('sha256').update('impact').digest('hex'),
        definition: { steps },
        compiledRules: {},
      },
    });
    const instance = await db.workflowInstance.create({
      data: {
        projectId,
        definitionId: definition.id,
        definitionRevisionId: revision.id,
        requirementId: requirement.id,
      },
    });
    await db.task.createMany({
      data: steps.map((step) => ({
        projectId,
        workflowInstanceId: instance.id,
        stepKey: step.key,
        roleId: role.id,
        responsibleUserId: userId,
      })),
    });
    const root = await db.task.findFirstOrThrow({
      where: { workflowInstanceId: instance.id, stepKey: 's0' },
    });
    const item = {
      taskId: root.id,
      claimEligibility: { canClaim: true, reason: null },
    } as unknown as WorkbenchReadyTaskItem;
    const before = await db.task.findMany({ where: { projectId }, orderBy: { stepKey: 'asc' } });
    await attachDependencyImpact(
      db as PrismaService,
      projectId,
      { reviews: [], changes: [], readyTasks: [item] },
      async () => undefined,
    );
    expect(item).toMatchObject({
      blocking: 69,
      dependencyImpact: { status: 'AVAILABLE', readyAfterAction: 1, scenario: 'TASK_COMPLETION' },
    });
    expect(await db.task.findMany({ where: { projectId }, orderBy: { stepKey: 'asc' } })).toEqual(
      before,
    );
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (projectId) {
        await db.task.deleteMany({ where: { projectId } });
        await db.workflowInstance.deleteMany({ where: { projectId } });
        await db.workflowRevision.deleteMany({ where: { projectId } });
        await db.workflowDefinition.deleteMany({ where: { projectId } });
        await db.requirement.deleteMany({ where: { projectId } });
        await db.projectRole.deleteMany({ where: { projectId } });
        await db.project.delete({ where: { id: projectId } });
      }
      if (userId) await db.user.delete({ where: { id: userId } });
    } finally {
      await db.$disconnect();
    }
  });
});
