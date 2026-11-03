import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { randomUUID } from 'node:crypto';
import { PrismaClient as V1PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
type V1TransactionClient = Omit<
  V1PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

import {
  assertCurrentRequirementGeneration,
  assertWorkflowInstanceActive,
} from './v1-task-consistency-policy';
import {
  type V1ArtifactRepository,
  type V1ArtifactSetSnapshot,
  type V1ArtifactCheck,
  type V1CodeReviewEvidenceSnapshot,
  contentPreviewOf,
  type V1DeliverInput,
  type V1DeliverResultRow,
} from './v1-artifact.repository';
import type { V1TaskSnapshot } from './v1-task.repository';

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

function claimScopeKeyOf(userId: string, credentialId: string | null): string {
  return credentialId ? `agent:${credentialId}` : `user:${userId}`;
}

type CodeReviewEvidenceRow = {
  id: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  commitSha: string | null;
  authorExternalId: string;
  reviewerExternalId: string;
  reviewerKind: string;
  state: string;
  submittedAt: Date | null;
};

type ProjectRepositoryRow = {
  externalId: string;
  owner: string;
  name: string;
  adapter: string;
};

export function mapCodeReviewEvidence(
  evidence: readonly CodeReviewEvidenceRow[],
  repositories: readonly ProjectRepositoryRow[],
): V1CodeReviewEvidenceSnapshot[] {
  const repositoryByExternalId = new Map(repositories.map((item) => [item.externalId, item]));
  return evidence.map((item) => {
    const repository = repositoryByExternalId.get(item.repositoryId);
    return {
      id: item.id,
      repositoryId: item.repositoryId,
      repositoryOwner: repository?.owner ?? null,
      repositoryName: repository?.name ?? null,
      adapter: repository?.adapter ?? null,
      changeRequestId: item.changeRequestId,
      headSha: item.headSha,
      commitSha: item.commitSha,
      authorExternalId: item.authorExternalId,
      reviewerExternalId: item.reviewerExternalId,
      reviewerKind: item.reviewerKind,
      state: item.state,
      submittedAt: item.submittedAt?.toISOString() ?? null,
    };
  });
}

type DefinitionStep = {
  key?: unknown;
  gates?: Array<{ reviewerSlots?: unknown }>;
};

type SlotBinding = { slotKey: string; roleId: string; userId: string };

/**
 * 工件交付仓储。交付只引用既有 ContextSnapshot：在同一 Serializable 事务内复核
 * 任务版本、代次、当前认领与当前快照，创建不可变 ArtifactSet/Artifact 与
 * TASK_ACCEPTANCE 评审，不自行把任务置为 DONE。
 */
@Injectable()
export class V1ArtifactPrismaRepository implements V1ArtifactRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findArtifactSet(id: string): Promise<V1ArtifactSetSnapshot | null> {
    const set = await this.prisma.artifactSet.findUnique({
      where: { id },
      include: { artifacts: true, items: true },
    });
    if (!set) return null;
    return this.toSetSnapshot(set);
  }

  async findCodeReviewEvidence(
    projectId: string,
    artifactSetId: string,
  ): Promise<V1CodeReviewEvidenceSnapshot[]> {
    const evidence = await this.prisma.codeReviewEvidence.findMany({
      where: { projectId, artifactSetId },
      select: {
        id: true,
        repositoryId: true,
        changeRequestId: true,
        headSha: true,
        commitSha: true,
        authorExternalId: true,
        reviewerExternalId: true,
        reviewerKind: true,
        state: true,
        submittedAt: true,
      },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    });
    const repositoryIds = [...new Set(evidence.map((item) => item.repositoryId))];
    const repositories = await this.prisma.projectRepository.findMany({
      where: { projectId, externalId: { in: repositoryIds } },
      select: { externalId: true, owner: true, name: true, adapter: true },
    });
    return mapCodeReviewEvidence(evidence, repositories);
  }

  async deliver(input: V1DeliverInput): Promise<V1DeliverResultRow> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runDeliver(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runDeliver(input: V1DeliverInput): Promise<V1DeliverResultRow> {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({ where: { id: input.taskId } });
        if (!task)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'TASK_NOT_FOUND',
            { taskId: input.taskId },
            404,
          );

        // 项目级串行写边界。
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${task.projectId}::uuid FOR UPDATE`,
        );

        // retired workflow 的任务不得继续交付，历史交付仍可读取。
        const instance = await tx.workflowInstance.findFirst({
          where: { id: task.workflowInstanceId, projectId: task.projectId },
          select: { retiredAt: true },
        });
        assertWorkflowInstanceActive(instance?.retiredAt, {
          taskId: task.id,
          workflowInstanceId: task.workflowInstanceId,
        });

        if (task.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            {
              taskId: task.id,
              expectedVersion: input.expectedVersion,
              currentVersion: task.version,
            },
            409,
          );

        // 交付必须在有效认领下进行，且认领代次与当前任务代次一致。
        const activeClaim = await tx.taskClaim.findFirst({
          where: { taskId: task.id, releasedAt: null },
        });
        if (!activeClaim || activeClaim.id !== input.claimId || activeClaim.releasedAt !== null)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (
          claimScopeKeyOf(activeClaim.userId, activeClaim.credentialId) !== input.principalScopeKey
        )
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (activeClaim.taskGeneration !== task.generation)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            { taskId: task.id, claimId: input.claimId },
            409,
          );

        // 交付必须引用任务的当前快照；旧快照、旧需求代次或他人快照一律按基线过期拒绝。
        const snapshot = await tx.contextSnapshot.findUnique({
          where: { id: input.snapshotId },
          include: { resources: true },
        });
        const requirement = snapshot
          ? await tx.requirement.findUnique({
              where: { id: snapshot.requirementId },
              select: { generation: true },
            })
          : null;
        if (snapshot) {
          assertCurrentRequirementGeneration({
            taskId: task.id,
            snapshotId: snapshot.id,
            snapshotGeneration: snapshot.requirementGeneration,
            requirementGeneration: requirement?.generation,
          });
        }
        if (
          !snapshot ||
          !requirement ||
          snapshot.projectId !== task.projectId ||
          snapshot.taskId !== task.id ||
          snapshot.claimId !== input.claimId ||
          snapshot.taskGeneration !== task.generation ||
          snapshot.workflowDefinitionRevisionId !== input.workflowDefinitionRevisionId ||
          task.currentSnapshotId !== snapshot.id
        )
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'SNAPSHOT_STALE',
            {
              taskId: task.id,
              snapshotId: input.snapshotId,
              currentSnapshotId: task.currentSnapshotId,
            },
            409,
          );

        // 候选必须确实是该快照中显式选入的 CANDIDATE 文档修订，不能被交付时临时追加。
        const candidateRefs = snapshot.resources
          .filter(
            (resource) =>
              resource.kind === 'DOCUMENT_REVISION' && resource.authority === 'CANDIDATE',
          )
          .map((resource) => resource.documentRevisionId)
          .filter((id): id is string => Boolean(id));
        for (const candidateRevisionId of input.candidateRevisionIds) {
          if (!candidateRefs.includes(candidateRevisionId))
            throw new WorkmeshError(
              V1_ERROR_CODES.ARTIFACT_INVALID,
              'CANDIDATE_NOT_IN_SNAPSHOT',
              { taskId: task.id, candidateRevisionId },
              422,
            );
        }

        // GIT_REF 只允许本项目已登记的代码仓库，拒绝临时引入仓库。
        const repositoryIds = [
          ...new Set(
            input.items
              .map((item) => item.projectRepositoryId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        for (const repositoryId of repositoryIds) {
          const repository = await tx.projectRepository.findFirst({
            where: { id: repositoryId, projectId: task.projectId },
          });
          if (!repository)
            throw new WorkmeshError(
              V1_ERROR_CODES.ARTIFACT_INVALID,
              'ARTIFACT_REPOSITORY_UNKNOWN',
              { taskId: task.id, repositoryId },
              422,
            );
        }

        const stamp = await tx.principalStamp.create({
          data: {
            kind: input.actorStamp.kind,
            userId: input.actorUserId,
            webSessionId: input.actorStamp.webSessionId,
            agentCredentialId: input.actorStamp.agentCredentialId,
            projectId: task.projectId,
            roleId: input.actorStamp.roleId,
            roleKeySnapshot: input.actorStamp.roleKeySnapshot,
            scopeSnapshot: input.actorStamp.scopeSnapshot,
            userAuthVersion: input.actorStamp.userAuthVersion,
          },
        });

        const set = await tx.artifactSet.create({
          data: {
            projectId: task.projectId,
            taskId: task.id,
            taskGeneration: task.generation,
            snapshotId: snapshot.id,
            manifestDigest: snapshot.manifestDigest,
            workflowDefinitionRevisionId: snapshot.workflowDefinitionRevisionId,
            localRunId: input.localRunId,
            createdByStampId: stamp.id,
          },
        });

        const createdArtifacts = await tx.artifact.createManyAndReturn({
          data: input.items.map((item) => ({
            projectId: task.projectId,
            taskId: task.id,
            artifactSetId: set.id,
            kind: item.kind,
            schemaVersion: item.schemaVersion,
            storage: item.storage,
            mediaType: item.mediaType,
            byteLength: item.byteLength,
            sha256: item.sha256,
            bodyBytes: item.bodyBytes,
            projectRepositoryId: item.projectRepositoryId,
            commitSha: item.commitSha,
            repoPath: item.repoPath,
            summary: item.summary,
            checks: item.checks as unknown as Prisma.InputJsonValue,
            submittedByStampId: stamp.id,
          })),
        });

        const itemRows: Array<{
          id: string;
          projectId: string;
          artifactSetId: string;
          artifactId: string | null;
          candidateRevisionId: string | null;
        }> = createdArtifacts.map((artifact) => ({
          id: randomUUID(),
          projectId: task.projectId,
          artifactSetId: set.id,
          artifactId: artifact.id,
          candidateRevisionId: null,
        }));
        for (const candidateRevisionId of input.candidateRevisionIds) {
          itemRows.push({
            id: randomUUID(),
            projectId: task.projectId,
            artifactSetId: set.id,
            artifactId: null,
            candidateRevisionId,
          });
        }
        if (itemRows.length > 0) await tx.artifactSetItem.createMany({ data: itemRows });

        const slots = await this.acceptanceSlots(
          tx,
          task.id,
          task.workflowInstanceId,
          snapshot.workflowDefinitionRevisionId,
          task.stepKey,
        );
        if (slots.length === 0)
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
            'TASK_ACCEPTANCE_GATE_REQUIRED',
            { taskId: task.id, stepKey: task.stepKey },
            422,
          );

        // 同一任务同一时刻只保留一个 OPEN 的任务验收请求。
        await tx.reviewRequest.updateMany({
          where: {
            projectId: task.projectId,
            taskId: task.id,
            kind: 'TASK_ACCEPTANCE',
            status: 'OPEN',
          },
          data: { status: 'INVALIDATED' },
        });
        const review = await tx.reviewRequest.create({
          data: {
            projectId: task.projectId,
            kind: 'TASK_ACCEPTANCE',
            artifactSetId: set.id,
            taskId: task.id,
            taskGeneration: task.generation,
            subjectDigest: input.subjectDigest,
            version: 1,
            status: 'OPEN',
          },
        });
        await tx.approvalSlot.createMany({
          data: slots.map((slot) => ({
            projectId: task.projectId,
            reviewRequestId: review.id,
            slotKey: slot.slotKey,
            kind: 'TASK_ACCEPTANCE',
            requiredUserId: slot.userId,
            requiredRoleId: slot.roleId,
            sourceSlotBindingId: null,
          })),
        });

        const updated = await tx.task.updateMany({
          where: {
            id: task.id,
            version: input.expectedVersion,
            generation: task.generation,
            currentClaimId: activeClaim.id,
          },
          data: {
            version: { increment: 1 },
            executionStatus: 'REVIEW_PENDING',
            currentArtifactSetId: set.id,
          },
        });
        if (updated.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'TASK_VERSION_CONFLICT',
            { taskId: task.id },
            409,
          );

        await tx.auditEvent.create({
          data: {
            projectId: task.projectId,
            actorStampId: stamp.id,
            action: 'ARTIFACT_SET_DELIVER',
            targetType: 'TASK',
            targetId: task.id,
            targetVersion: input.expectedVersion,
            outcome: 'SUCCESS',
            details: {
              artifactSetId: set.id,
              reviewRequestId: review.id,
              snapshotId: snapshot.id,
              subjectDigest: input.subjectDigest,
            },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: task.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: {
              artifactSetId: set.id,
              snapshotId: snapshot.id,
              reviewRequestId: review.id,
            },
            responseMetadata: { subjectDigest: input.subjectDigest },
            committedAt: input.now,
          },
        });

        const created = await tx.artifactSet.findUniqueOrThrow({
          where: { id: set.id },
          include: { artifacts: true, items: true },
        });
        const taskSnapshot = await this.toTaskSnapshot(tx, task.id);
        return {
          artifactSet: this.toSetSnapshot(created),
          task: taskSnapshot,
          reviewRequestId: review.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** 从已发布工作流定义与本实例的角色槽绑定派生 TASK_ACCEPTANCE 审批槽。 */
  private async acceptanceSlots(
    tx: V1TransactionClient,
    taskId: string,
    instanceId: string,
    revisionId: string,
    stepKey: string,
  ): Promise<SlotBinding[]> {
    const revision = await tx.workflowRevision.findUnique({
      where: { id: revisionId },
      select: { definition: true },
    });
    const instance = await tx.workflowInstance.findUnique({
      where: { id: instanceId },
      select: { bindings: true },
    });
    if (!revision || !instance) return [];
    const definition = revision.definition as {
      steps?: DefinitionStep[];
      roleSlots?: Array<{ key?: unknown; kind?: unknown; roleKey?: unknown }>;
    };
    const bindings = (instance.bindings ?? {}) as { roleSlotBindings?: SlotBinding[] };
    const roleSlotBindings = bindings.roleSlotBindings ?? [];
    const step = (definition.steps ?? []).find((entry) => entry.key === stepKey);
    if (!step) return [];
    const slotKinds = new Map<string, string>();
    for (const slot of definition.roleSlots ?? []) {
      if (typeof slot.key === 'string' && typeof slot.kind === 'string')
        slotKinds.set(slot.key, slot.kind);
    }
    const reviewerSlots = new Set<string>();
    for (const gate of step.gates ?? []) {
      for (const reviewer of Array.isArray(gate.reviewerSlots) ? gate.reviewerSlots : []) {
        if (typeof reviewer === 'string' && slotKinds.get(reviewer) === 'TASK_ACCEPTANCE')
          reviewerSlots.add(reviewer);
      }
    }
    const resolved: SlotBinding[] = [];
    for (const slotKey of [...reviewerSlots].sort()) {
      const binding = roleSlotBindings.find((entry) => entry.slotKey === slotKey);
      if (!binding)
        throw new WorkmeshError(
          V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
          'TASK_ACCEPTANCE_BINDING_MISSING',
          { taskId, slotKey },
          422,
        );
      resolved.push({ slotKey, roleId: binding.roleId, userId: binding.userId });
    }
    return resolved;
  }

  private toSetSnapshot(set: {
    id: string;
    taskId: string;
    taskGeneration: number;
    snapshotId: string;
    manifestDigest: string;
    workflowDefinitionRevisionId: string;
    localRunId: string;
    createdAt: Date;
    artifacts?: Array<{
      id: string;
      kind: string;
      schemaVersion: string;
      storage: string;
      mediaType: string;
      byteLength: number;
      sha256: string;
      projectRepositoryId: string | null;
      commitSha: string | null;
      repoPath: string | null;
      summary: string | null;
      checks: unknown;
      bodyBytes?: Buffer | null;
    }>;
    items?: Array<{ artifactId: string | null; candidateRevisionId: string | null }>;
  }): V1ArtifactSetSnapshot {
    return {
      id: set.id,
      taskId: set.taskId,
      taskGeneration: set.taskGeneration,
      snapshotId: set.snapshotId,
      manifestDigest: set.manifestDigest,
      workflowDefinitionRevisionId: set.workflowDefinitionRevisionId,
      localRunId: set.localRunId,
      candidateRevisionIds: (set.items ?? [])
        .map((item) => item.candidateRevisionId)
        .filter((id): id is string => Boolean(id))
        .sort(),
      artifacts: (set.artifacts ?? []).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind as V1ArtifactSetSnapshot['artifacts'][number]['kind'],
        schemaVersion: artifact.schemaVersion,
        storage: artifact.storage as V1ArtifactSetSnapshot['artifacts'][number]['storage'],
        mediaType: artifact.mediaType,
        byteLength: artifact.byteLength,
        sha256: artifact.sha256,
        projectRepositoryId: artifact.projectRepositoryId,
        commitSha: artifact.commitSha,
        repoPath: artifact.repoPath,
        summary: artifact.summary,
        checks: this.checksOf(artifact.checks),
        contentPreview: contentPreviewOf(artifact.storage, artifact.mediaType, artifact.bodyBytes),
      })),
      createdAt: set.createdAt,
    };
  }

  private checksOf(value: unknown): V1ArtifactCheck[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
      .map((entry) => ({
        code: String(entry.code ?? ''),
        passed: entry.passed === true,
        ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
        source:
          entry.source === 'EXTERNAL_REFERENCE' && entry.evidence && typeof entry.evidence === 'object'
            ? ('EXTERNAL_REFERENCE' as const)
            : ('AGENT_REPORTED' as const),
        ...(entry.evidence && typeof entry.evidence === 'object'
          ? { evidence: entry.evidence as V1ArtifactCheck['evidence'] }
          : {}),
      }));
  }

  private async toTaskSnapshot(tx: V1TransactionClient, taskId: string): Promise<V1TaskSnapshot> {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    let currentClaim: V1TaskSnapshot['currentClaim'] = null;
    if (task.currentClaimId) {
      const claim = await tx.taskClaim.findUnique({ where: { id: task.currentClaimId } });
      if (claim) {
        currentClaim = {
          id: claim.id,
          taskGeneration: claim.taskGeneration,
          principalScopeKey: claimScopeKeyOf(claim.userId, claim.credentialId),
          releasedAt: claim.releasedAt ? claim.releasedAt.toISOString() : null,
          userId: claim.userId,
        };
      }
    }
    return {
      id: task.id,
      projectId: task.projectId,
      workflowInstanceId: task.workflowInstanceId,
      stepKey: task.stepKey,
      roleId: task.roleId,
      responsibleUserId: task.responsibleUserId,
      version: task.version,
      generation: task.generation,
      executionStatus: task.executionStatus,
      workStatus: task.workStatus,
      currentClaim,
    };
  }
}
