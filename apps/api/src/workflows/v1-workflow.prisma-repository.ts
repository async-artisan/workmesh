import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { workflowStepDisplayNameOf } from '@workmesh/shared';
import type { WorkflowCompiledRules } from '@workmesh/shared';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  V1CreateInstanceInput,
  V1CreateInstanceResult,
  V1PackageVersionRecord,
  V1PublishDefinitionInput,
  V1PublishDefinitionResult,
  V1RequirementWorkflowView,
  V1WorkflowDefinitionView,
  V1WorkflowInstanceView,
  V1WorkflowRepository,
  V1WorkflowRevisionView,
  V1WorkflowRole,
} from './v1-workflow.repository';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

function encodeCursor(value: string): string {
  return Buffer.from(JSON.stringify({ k: value }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): string | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { k?: unknown };
    return typeof parsed.k === 'string' ? parsed.k : null;
  } catch {
    return null;
  }
}

@Injectable()
export class V1WorkflowPrismaRepository implements V1WorkflowRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listDefinitions(
    projectId: string,
    query: { limit: number; cursor: string | null },
  ): Promise<{ items: V1WorkflowDefinitionView[]; nextCursor: string | null }> {
    const key = decodeCursor(query.cursor);
    const rows = await this.prisma.workflowDefinition.findMany({
      where: { projectId },
      orderBy: { workflowKey: 'asc' },
      take: query.limit + 1,
      ...(key
        ? { cursor: { projectId_workflowKey: { projectId, workflowKey: key } }, skip: 1 }
        : {}),
    });
    const page = rows.slice(0, query.limit);
    const revisions = await this.revisionNumbers(page);
    const items = page.map((row) => ({
      workflowKey: row.workflowKey,
      title: this.titleOf(row.currentRevisionId ? revisions.get(row.currentRevisionId) : undefined),
      version: row.version,
      currentPublishedRevisionId: row.currentRevisionId,
      currentRevision: row.currentRevisionId
        ? (revisions.get(row.currentRevisionId)?.revision ?? 0)
        : 0,
    }));
    const last = page.at(-1);
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.workflowKey) : null,
    };
  }

  async findDefinition(
    projectId: string,
    workflowKey: string,
  ): Promise<(V1WorkflowDefinitionView & { id: string }) | null> {
    const row = await this.prisma.workflowDefinition.findUnique({
      where: { projectId_workflowKey: { projectId, workflowKey } },
    });
    if (!row) return null;
    const revisions = await this.revisionNumbers([row]);
    const current = row.currentRevisionId ? revisions.get(row.currentRevisionId) : undefined;
    return {
      id: row.id,
      workflowKey: row.workflowKey,
      title: current?.title ?? row.workflowKey,
      version: row.version,
      currentPublishedRevisionId: row.currentRevisionId,
      currentRevision: current?.revision ?? 0,
    };
  }

  async findRevision(revisionId: string): Promise<V1WorkflowRevisionView | null> {
    const row = await this.prisma.workflowRevision.findUnique({
      where: { id: revisionId },
      include: { definitionRel: { select: { workflowKey: true } } },
    });
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      definitionId: row.definitionId,
      workflowKey: row.definitionRel.workflowKey,
      revision: row.revision,
      digest: row.digest,
      definition: row.definition as unknown,
      compiledRules: row.compiledRules as unknown as WorkflowCompiledRules,
      createdAt: row.createdAt,
    };
  }

  async projectRoles(projectId: string): Promise<V1WorkflowRole[]> {
    return this.prisma.projectRole.findMany({
      where: { projectId },
      select: { id: true, key: true, title: true, isActive: true, version: true },
      orderBy: { key: 'asc' },
    });
  }

  async findPackageVersion(
    projectId: string,
    packageId: string,
    version: string,
  ): Promise<V1PackageVersionRecord | null> {
    const row = await this.prisma.rolePackageVersion.findFirst({
      where: {
        packageId,
        version,
        OR: [{ projectId: null }, { projectId }],
      },
      orderBy: { projectId: 'desc' },
    });
    if (!row) return null;
    return {
      packageId: row.packageId,
      version: row.version,
      roleKey: row.roleKey,
      manifestDigest: row.manifestDigest,
      projectId: row.projectId,
      manifest: row.manifest as unknown as import('@workmesh/shared').RolePackageManifest,
    };
  }

  async isPublishedKnowledgeAvailable(
    projectId: string,
    roleId: string,
    documentId: string,
  ): Promise<boolean> {
    // KnowledgeDocument IDs are UUIDs. Reject template labels and malformed
    // references before Prisma builds a UUID-backed query.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentId))
      return false;
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: {
        id: documentId,
        projectId,
        archivedAt: null,
        currentPublishedRevisionId: { not: null },
        kind: { in: ['KNOWLEDGE', 'DECISION'] },
        knowledgeBindings: {
          some: {
            projectId,
            OR: [{ roleId: null }, { roleId }],
          },
        },
      },
      select: { id: true },
    });
    return Boolean(document);
  }

  async findRequirement(requirementId: string): Promise<V1RequirementWorkflowView | null> {
    const row = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        projectId: true,
        version: true,
        currentPrdRevisionId: true,
        deliveryScope: true,
      },
    });
    if (!row) return null;
    const acceptanceKeys = await this.acceptanceKeysOf(row.currentPrdRevisionId);
    return { ...row, deliveryScope: row.deliveryScope as unknown, acceptanceKeys };
  }

  /** PRD 修订的 acceptance 是 JSON 数组；只取其中带 key 的条目，非法条目忽略。 */
  private async acceptanceKeysOf(revisionId: string | null): Promise<string[]> {
    if (!revisionId) return [];
    const revision = await this.prisma.documentRevision.findUnique({
      where: { id: revisionId },
      select: { acceptance: true },
    });
    const raw = revision?.acceptance;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) =>
        item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string'
          ? (item as { key: string }).key
          : null,
      )
      .filter((key): key is string => Boolean(key));
  }

  async isActiveMember(projectId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { revokedAt: true },
    });
    return Boolean(row && !row.revokedAt);
  }

  async isProjectRepository(projectId: string, repositoryId: string): Promise<boolean> {
    const row = await this.prisma.projectRepository.findFirst({
      where: { id: repositoryId, projectId, archivedAt: null },
      select: { id: true },
    });
    return Boolean(row);
  }

  async findPublishOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }) {
    const record = await this.prisma.idempotentOperation.findUnique({
      where: {
        projectScopeKey_principalScopeKey_key: {
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.key,
        },
      },
    });
    if (!record) return null;
    return {
      id: record.id,
      projectScopeKey: record.projectScopeKey,
      principalScopeKey: record.principalScopeKey,
      key: record.key,
      method: record.method,
      route: record.route,
      requestDigest: record.requestDigest,
      resultRefs: record.resultRefs as unknown as Record<string, unknown>,
      committedAt: record.createdAt,
    };
  }

  async publishDefinition(input: V1PublishDefinitionInput): Promise<V1PublishDefinitionResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runPublish(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runPublish(input: V1PublishDefinitionInput): Promise<V1PublishDefinitionResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );

        const project = await tx.project.findUnique({
          where: { id: input.projectId },
          select: { version: true },
        });
        if (!project)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'PROJECT_NOT_FOUND',
            { projectId: input.projectId },
            404,
          );
        if (project.version !== input.expectedProjectVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'PROJECT_VERSION_CONFLICT',
            { expectedVersion: input.expectedProjectVersion, currentVersion: project.version },
            409,
          );

        const existing = await tx.workflowDefinition.findUnique({
          where: {
            projectId_workflowKey: { projectId: input.projectId, workflowKey: input.workflowKey },
          },
        });
        let currentRevision = 0;
        if (existing?.currentRevisionId) {
          const current = await tx.workflowRevision.findUnique({
            where: { id: existing.currentRevisionId },
            select: { revision: true },
          });
          currentRevision = current?.revision ?? 0;
        }
        if (currentRevision !== input.expectedCurrentRevision)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'WORKFLOW_REVISION_CONFLICT',
            { expectedCurrentRevision: input.expectedCurrentRevision, currentRevision },
            409,
          );

        const definition =
          existing ??
          (await tx.workflowDefinition.create({
            data: { projectId: input.projectId, workflowKey: input.workflowKey, version: 1 },
          }));

        const nextRevision = currentRevision + 1;
        const revision = await tx.workflowRevision.create({
          data: {
            projectId: input.projectId,
            definitionId: definition.id,
            revision: nextRevision,
            digest: input.definitionDigest,
            definition: input.definition as Prisma.InputJsonValue,
            compiledRules: input.compiledRules as unknown as Prisma.InputJsonValue,
          },
        });

        const pointed = await tx.workflowDefinition.updateMany({
          where: {
            id: definition.id,
            currentRevisionId: definition.currentRevisionId,
            version: definition.version,
          },
          data: { currentRevisionId: revision.id, version: { increment: 1 } },
        });
        if (pointed.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'WORKFLOW_POINTER_CONFLICT',
            { workflowKey: input.workflowKey },
            409,
          );

        const bumped = await tx.project.updateMany({
          where: { id: input.projectId, version: input.expectedProjectVersion },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'PROJECT_VERSION_CONFLICT',
            { projectId: input.projectId },
            409,
          );

        const consumed = await tx.$executeRaw(
          Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
            SET "consumedAt" = ${input.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${input.operation.id}::uuid
            WHERE "id" = ${input.ticket.id}::uuid
              AND "secretHash" = ${input.ticket.secretHash}
              AND "webSessionId" = ${input.ticket.webSessionId}::uuid
              AND "consumedAt" IS NULL
              AND "invalidatedAt" IS NULL
              AND "expiresAt" > ${input.now}`,
        );
        if (consumed !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            action: 'WORKFLOW_PUBLISH',
            targetType: 'WORKFLOW_DEFINITION',
            targetId: definition.id,
            targetVersion: nextRevision,
            outcome: 'SUCCESS',
            details: {
              workflowKey: input.workflowKey,
              digest: input.definitionDigest,
              ...((input.definition as { verificationExemption?: unknown })?.verificationExemption
                ? {
                    verificationExemption: (input.definition as { verificationExemption: unknown })
                      .verificationExemption,
                  }
                : {}),
            } as Prisma.InputJsonValue,
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: input.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: {
              definitionRevisionId: revision.id,
              revision: nextRevision,
              digest: input.definitionDigest,
              projectVersion: input.expectedProjectVersion + 1,
            },
            responseMetadata: { workflowKey: input.workflowKey },
          },
        });

        return {
          definitionRevisionId: revision.id,
          revision: nextRevision,
          digest: input.definitionDigest,
          projectVersion: input.expectedProjectVersion + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async createInstance(input: V1CreateInstanceInput): Promise<V1CreateInstanceResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runCreateInstance(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runCreateInstance(input: V1CreateInstanceInput): Promise<V1CreateInstanceResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Requirement" WHERE "id" = ${input.requirementId}::uuid FOR UPDATE`,
        );
        const requirement = await tx.requirement.findUnique({
          where: { id: input.requirementId },
          select: { version: true, projectId: true },
        });
        if (!requirement)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REQUIREMENT_NOT_FOUND',
            { requirementId: input.requirementId },
            404,
          );
        if (requirement.version !== input.expectedRequirementVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'REQUIREMENT_VERSION_CONFLICT',
            {
              expectedVersion: input.expectedRequirementVersion,
              currentVersion: requirement.version,
            },
            409,
          );

        const now = new Date();
        // 新实例接管该需求：旧实例与其 claim/snapshot 立即失效，不并行两套负责人。
        await tx.workflowInstance.updateMany({
          where: { requirementId: input.requirementId, retiredAt: null },
          data: { retiredAt: now, workStatus: 'CANCELLED', version: { increment: 1 } },
        });

        const instance = await tx.workflowInstance.create({
          data: {
            projectId: input.projectId,
            definitionId: input.definitionId,
            definitionRevisionId: input.definitionRevisionId,
            definitionDigest: input.definitionDigest,
            requirementId: input.requirementId,
            workStatus: 'ACTIVE',
            bindings: {
              stepBindings: input.stepBindings,
              roleSlotBindings: input.roleSlotBindings,
              actorUserId: input.actorUserId,
            } as Prisma.InputJsonValue,
          },
        });

        const tasks = await tx.task.createManyAndReturn({
          data: input.steps.map((step) => ({
            projectId: input.projectId,
            workflowInstanceId: instance.id,
            stepKey: step.stepKey,
            acceptanceKeys: step.acceptanceKeys,
            roleId: step.roleId,
            responsibleUserId: step.responsibleUserId,
          })),
        });
        const workflowRevision = await tx.workflowRevision.findFirst({
          where: { id: input.definitionRevisionId, projectId: input.projectId },
          select: { definition: true },
        });

        const bumped = await tx.requirement.updateMany({
          where: { id: input.requirementId, version: input.expectedRequirementVersion },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'REQUIREMENT_VERSION_CONFLICT',
            { requirementId: input.requirementId },
            409,
          );

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            action: 'WORKFLOW_INSTANCE_CREATE',
            targetType: 'WORKFLOW_INSTANCE',
            targetId: instance.id,
            targetVersion: instance.version,
            outcome: 'SUCCESS',
            details: {
              requirementId: input.requirementId,
              definitionRevisionId: input.definitionRevisionId,
            },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: input.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: {
              instanceId: instance.id,
              requirementVersion: input.expectedRequirementVersion + 1,
            },
            responseMetadata: { requirementId: input.requirementId },
          },
        });

        return {
          instance: {
            id: instance.id,
            projectId: instance.projectId,
            requirementId: instance.requirementId,
            definitionRevisionId: input.definitionRevisionId,
            definitionDigest: input.definitionDigest,
            version: instance.version,
            workStatus: instance.workStatus,
            retiredAt: instance.retiredAt,
            steps: tasks.map((task) => ({
              stepKey: task.stepKey,
              stepDisplayName: workflowStepDisplayNameOf(
                workflowRevision?.definition,
                task.stepKey,
              ),
              roleId: task.roleId,
              responsibleUserId: task.responsibleUserId,
              executionStatus: task.executionStatus,
              workStatus: task.workStatus,
              generation: task.generation,
              version: task.version,
              repositoryIds:
                input.stepBindings.find((binding) => binding.stepKey === task.stepKey)
                  ?.repositoryIds ?? [],
              acceptanceKeys: task.acceptanceKeys,
            })),
          },
          requirementVersion: input.expectedRequirementVersion + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findInstance(instanceId: string): Promise<V1WorkflowInstanceView | null> {
    const row = await this.prisma.workflowInstance.findUnique({
      where: { id: instanceId },
      include: { tasks: { orderBy: { stepKey: 'asc' } } },
    });
    if (!row) return null;
    const workflowRevision = row.definitionRevisionId
      ? await this.prisma.workflowRevision.findFirst({
          where: { id: row.definitionRevisionId, projectId: row.projectId },
          select: { definition: true },
        })
      : null;
    const bindings = (row.bindings ?? {}) as {
      stepBindings?: Array<{ stepKey: string; repositoryIds: string[] }>;
    };
    return {
      id: row.id,
      projectId: row.projectId,
      requirementId: row.requirementId,
      definitionRevisionId: row.definitionRevisionId ?? '',
      definitionDigest: row.definitionDigest ?? '',
      version: row.version,
      workStatus: row.workStatus,
      retiredAt: row.retiredAt,
      steps: row.tasks.map((task) => ({
        stepKey: task.stepKey,
        stepDisplayName: workflowStepDisplayNameOf(workflowRevision?.definition, task.stepKey),
        roleId: task.roleId,
        responsibleUserId: task.responsibleUserId,
        executionStatus: task.executionStatus,
        workStatus: task.workStatus,
        generation: task.generation,
        version: task.version,
        repositoryIds:
          bindings.stepBindings?.find((binding) => binding.stepKey === task.stepKey)
            ?.repositoryIds ?? [],
        acceptanceKeys: task.acceptanceKeys,
      })),
    };
  }

  private async revisionNumbers(
    rows: Array<{ currentRevisionId: string | null }>,
  ): Promise<Map<string, { revision: number; title: string }>> {
    const ids = rows.map((row) => row.currentRevisionId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return new Map();
    const revisions = await this.prisma.workflowRevision.findMany({
      where: { id: { in: ids } },
      select: { id: true, revision: true, definition: true },
    });
    const map = new Map<string, { revision: number; title: string }>();
    for (const revision of revisions) {
      const title = (revision.definition as { title?: unknown })?.title;
      map.set(revision.id, {
        revision: revision.revision,
        title: typeof title === 'string' ? title : '',
      });
    }
    return map;
  }

  private titleOf(entry: { revision: number; title: string } | undefined): string {
    return entry?.title ?? '';
  }
}
