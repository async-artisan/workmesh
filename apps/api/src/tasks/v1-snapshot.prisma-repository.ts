import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  compareSemver,
  isStrictSemver,
  sha256Bytes,
  V1_ERROR_CODES,
  WorkmeshError,
  type TaskRolePackageStatus,
} from '@workmesh/shared';
import type {
  V1CreateSnapshotInput,
  V1CreateSnapshotResult,
  V1SnapshotBindingRecord,
  V1SnapshotDocumentRef,
  V1SnapshotPrerequisiteArtifact,
  V1SnapshotRepository,
  V1SnapshotResourceBody,
  V1SnapshotRoleResource,
  V1SnapshotTaskState,
  V1SnapshotView,
} from './v1-snapshot.repository';
import { snapshotBaselinePolicyOf, snapshotDependenciesOf } from './v1-snapshot-step';

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

/**
 * 步骤语义只存在于修订正文 `definition.steps`；`compiledRules` 只有服务端派生规则
 * （resolvedRoles / packageLocks / systemGates）。读错对象会让基线策略与依赖恒为空，
 * 因此解析集中在 `v1-snapshot-step` 里并被单测锁定。
 */
function packageLockOf(
  compiledRules: unknown,
  roleKey: string,
): { packageId: string; version: string; packageDigest?: string } | null {
  const rules = compiledRules as { packageLocks?: unknown } | null;
  const locks = rules?.packageLocks;
  if (!Array.isArray(locks)) return null;
  const lock = locks.find((item) => (item as { roleKey?: unknown }).roleKey === roleKey) as
    { packageId?: unknown; version?: unknown; packageDigest?: unknown } | undefined;
  if (!lock || typeof lock.packageId !== 'string' || typeof lock.version !== 'string') return null;
  return {
    packageId: lock.packageId,
    version: lock.version,
    ...(typeof lock.packageDigest === 'string' ? { packageDigest: lock.packageDigest } : {}),
  };
}

@Injectable()
export class V1SnapshotPrismaRepository implements V1SnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async verifyResourceContent(
    resource: { kind: string; targetId: string; sha256: string; byteLength: number },
    projectId: string,
  ): Promise<'VERIFIED' | 'EXTERNAL_REFERENCE' | 'UNAVAILABLE'> {
    const value =
      resource.kind === 'DOCUMENT_REVISION'
        ? await this.prisma.documentRevision.findUnique({
            where: { id: resource.targetId, projectId },
            select: { bodyBytes: true },
          })
        : resource.kind === 'ROLE_RESOURCE'
          ? await this.prisma.rolePackageResource.findUnique({
              where: {
                id: resource.targetId,
                packageVersion: { OR: [{ projectId }, { projectId: null }] },
              },
              select: { bodyBytes: true },
            })
          : await this.prisma.artifact.findUnique({
              where: { id: resource.targetId, projectId },
              select: {
                bodyBytes: true,
                storage: true,
                projectRepositoryId: true,
                commitSha: true,
                repoPath: true,
              },
            });
    if (!value) return 'UNAVAILABLE';
    if ('storage' in value && value.storage === 'GIT_REF') {
      if (!value.projectRepositoryId || !value.commitSha || !value.repoPath) return 'UNAVAILABLE';
      const repository = await this.prisma.projectRepository.findFirst({
        where: { id: value.projectRepositoryId, projectId, archivedAt: null },
        select: { id: true },
      });
      return repository ? 'EXTERNAL_REFERENCE' : 'UNAVAILABLE';
    }
    if (!value.bodyBytes || value.bodyBytes.byteLength !== resource.byteLength)
      return 'UNAVAILABLE';
    return (await sha256Bytes(value.bodyBytes)) === resource.sha256 ? 'VERIFIED' : 'UNAVAILABLE';
  }

  async findResourceScope(kind: 'ARTIFACT' | 'ROLE_RESOURCE', targetId: string) {
    if (kind === 'ARTIFACT')
      return this.prisma.artifact.findUnique({
        where: { id: targetId },
        select: { projectId: true, sha256: true, byteLength: true, mediaType: true },
      });
    const resource = await this.prisma.rolePackageResource.findUnique({
      where: { id: targetId },
      select: {
        sha256: true,
        byteLength: true,
        mediaType: true,
        packageVersion: { select: { projectId: true } },
      },
    });
    return resource
      ? {
          projectId: resource.packageVersion.projectId,
          sha256: resource.sha256,
          byteLength: resource.byteLength,
          mediaType: resource.mediaType,
        }
      : null;
  }

  private upstreamInputsOf(
    compiledRules: unknown,
    stepKey: string,
  ): Array<{ inputKey: string; fromStepKey: string; kind: string; required?: boolean }> {
    const sources = (compiledRules as { inputSources?: unknown } | null)?.inputSources;
    if (!Array.isArray(sources)) return [];
    return sources.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const value = entry as Record<string, unknown>;
      if (
        value.stepKey !== stepKey ||
        value.source !== 'UPSTREAM_ARTIFACT' ||
        typeof value.inputKey !== 'string' ||
        typeof value.fromStepKey !== 'string' ||
        typeof value.reference !== 'string'
      )
        return [];
      return [
        {
          inputKey: value.inputKey,
          fromStepKey: value.fromStepKey,
          kind: value.reference,
          required: value.required !== false,
        },
      ];
    });
  }

  private knowledgeInputsOf(
    compiledRules: unknown,
    stepKey: string,
  ): Array<{ inputKey: string; documentId: string; required?: boolean }> {
    const sources = (compiledRules as { inputSources?: unknown } | null)?.inputSources;
    if (!Array.isArray(sources)) return [];
    return sources.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
      const value = entry as Record<string, unknown>;
      if (
        value.stepKey !== stepKey ||
        value.source !== 'PUBLISHED_KNOWLEDGE' ||
        typeof value.inputKey !== 'string' ||
        typeof value.reference !== 'string'
      )
        return [];
      return [
        {
          inputKey: value.inputKey,
          documentId: value.reference,
          required: value.required !== false,
        },
      ];
    });
  }

  async findTaskState(taskId: string): Promise<V1SnapshotTaskState | null> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        instance: { include: { requirement: true, definition: true } },
        role: true,
      },
    });
    if (!task) return null;
    if (!task.instance.definitionRevisionId) return null;
    const revision = await this.prisma.workflowRevision.findUnique({
      where: { id: task.instance.definitionRevisionId },
    });
    if (!revision || revision.projectId !== task.projectId) return null;
    const project = await this.prisma.project.findUnique({
      where: { id: task.projectId },
      select: { knowledgeBindingsVersion: true },
    });
    const claim = task.currentClaimId
      ? await this.prisma.taskClaim.findUnique({ where: { id: task.currentClaimId } })
      : null;
    const requirement = task.instance.requirement;
    return {
      id: task.id,
      projectId: task.projectId,
      requirementId: requirement.id,
      requirementGeneration: requirement.generation,
      requirementVersion: requirement.version,
      requirementPhase: requirement.phase,
      currentUnderstandingRevisionId: requirement.currentUnderstandingRevisionId,
      currentPrdRevisionId: requirement.currentPrdRevisionId,
      deliveryScope: requirement.deliveryScope ?? null,
      knowledgeBindingsVersion: project?.knowledgeBindingsVersion ?? 1,
      taskVersion: task.version,
      taskGeneration: task.generation,
      stepKey: task.stepKey,
      roleId: task.roleId,
      roleKey: task.role.key,
      responsibleUserId: task.responsibleUserId,
      baselinePolicy: snapshotBaselinePolicyOf(revision.definition, task.stepKey),
      workflowDefinitionRevisionId: revision.id,
      workflowDigest: revision.digest,
      retiredAt: task.instance.retiredAt,
      currentClaim: claim
        ? {
            id: claim.id,
            taskGeneration: claim.taskGeneration,
            principalScopeKey: claimScopeKeyOf(claim.userId, claim.credentialId),
            releasedAt: claim.releasedAt,
            userId: claim.userId,
            credentialId: claim.credentialId,
          }
        : null,
      currentSnapshotId: task.currentSnapshotId,
      upstreamInputs: this.upstreamInputsOf(revision.compiledRules, task.stepKey),
      knowledgeInputs: this.knowledgeInputsOf(revision.compiledRules, task.stepKey),
    };
  }

  async findRevision(revisionId: string): Promise<V1SnapshotDocumentRef | null> {
    const revision = await this.prisma.documentRevision.findUnique({
      where: { id: revisionId },
      include: {
        document: {
          select: {
            id: true,
            archivedAt: true,
            knowledgeBaseId: true,
            kind: true,
            requirementId: true,
            currentPublishedRevisionId: true,
          },
        },
      },
    });
    if (!revision) return null;
    return {
      projectId: revision.projectId,
      revisionId: revision.id,
      documentId: revision.documentId,
      knowledgeBaseId: revision.document.knowledgeBaseId,
      documentKind: revision.document.kind as V1SnapshotDocumentRef['documentKind'],
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      mediaType: revision.mimeType,
      isCurrentPublished:
        !revision.document.archivedAt &&
        revision.document.currentPublishedRevisionId === revision.id,
      requirementId: revision.document.requirementId,
    };
  }

  async findInputDocument(documentId: string) {
    const document = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, archivedAt: null },
      select: { id: true, projectId: true, knowledgeBaseId: true, kind: true },
    });
    return document
      ? {
          documentId: document.id,
          projectId: document.projectId,
          knowledgeBaseId: document.knowledgeBaseId,
          documentKind: document.kind,
        }
      : null;
  }

  async findCandidateRevisions(input: {
    projectId: string;
    requirementId: string;
    revisionIds: string[];
  }): Promise<V1SnapshotDocumentRef[]> {
    const revisions = await this.prisma.documentRevision.findMany({
      where: {
        id: { in: input.revisionIds },
        projectId: input.projectId,
        document: { requirementId: input.requirementId, archivedAt: null },
      },
      include: {
        document: {
          select: {
            id: true,
            knowledgeBaseId: true,
            kind: true,
            requirementId: true,
            currentPublishedRevisionId: true,
          },
        },
      },
    });
    return revisions.map((revision) => ({
      projectId: revision.projectId,
      revisionId: revision.id,
      documentId: revision.documentId,
      knowledgeBaseId: revision.document.knowledgeBaseId,
      documentKind: revision.document.kind as V1SnapshotDocumentRef['documentKind'],
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      mediaType: revision.mimeType,
      isCurrentPublished: revision.document.currentPublishedRevisionId === revision.id,
      requirementId: revision.document.requirementId,
    }));
  }

  async listRoleKnowledgeBindings(
    projectId: string,
    roleId: string,
  ): Promise<V1SnapshotBindingRecord[]> {
    const bindings = await this.prisma.projectKnowledgeBinding.findMany({
      where: {
        projectId,
        OR: [{ roleId: null }, { roleId }],
      },
      include: {
        document: {
          select: {
            id: true,
            knowledgeBaseId: true,
            currentPublishedRevisionId: true,
            archivedAt: true,
          },
        },
      },
    });
    return bindings
      .filter((binding) => !binding.document.archivedAt)
      .map((binding) => ({
        bindingId: binding.id,
        documentId: binding.documentId,
        knowledgeBaseId: binding.document.knowledgeBaseId,
        roleId: binding.roleId,
        required: binding.required,
        currentPublishedRevisionId: binding.document.currentPublishedRevisionId,
      }));
  }

  async listAcceptedPrerequisiteArtifacts(
    taskId: string,
  ): Promise<V1SnapshotPrerequisiteArtifact[]> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, workflowInstanceId: true, projectId: true, stepKey: true },
    });
    if (!task) return [];
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: task.workflowInstanceId },
      select: { definitionRevisionId: true },
    });
    if (!instance?.definitionRevisionId) return [];
    const revision = await this.prisma.workflowRevision.findUnique({
      where: { id: instance.definitionRevisionId },
      select: { definition: true, compiledRules: true },
    });
    if (!revision) return [];
    const upstreamInputs = this.upstreamInputsOf(revision.compiledRules, task.stepKey);
    const deps = [
      ...new Set([
        ...snapshotDependenciesOf(revision.definition, task.stepKey),
        ...upstreamInputs.map((input) => input.fromStepKey),
      ]),
    ];
    if (deps.length === 0) return [];

    const dependencyTasks = await this.prisma.task.findMany({
      where: {
        projectId: task.projectId,
        workflowInstanceId: task.workflowInstanceId,
        stepKey: { in: deps },
        executionStatus: 'DONE',
        workStatus: 'ACTIVE',
      },
      select: { id: true, stepKey: true, generation: true, currentArtifactSetId: true },
    });
    const acceptedSetIds: string[] = [];
    const acceptedSetSources = new Map<string, string>();
    for (const dependency of dependencyTasks) {
      if (!dependency.currentArtifactSetId) continue;
      const approved = await this.prisma.reviewRequest.findFirst({
        where: {
          projectId: task.projectId,
          taskId: dependency.id,
          taskGeneration: dependency.generation,
          artifactSetId: dependency.currentArtifactSetId,
          status: 'APPROVED',
          kind: 'TASK_ACCEPTANCE',
        },
        select: { id: true },
      });
      if (approved) {
        acceptedSetIds.push(dependency.currentArtifactSetId);
        acceptedSetSources.set(dependency.currentArtifactSetId, dependency.stepKey);
      }
    }
    if (acceptedSetIds.length === 0) return [];

    const artifacts = await this.prisma.artifact.findMany({
      where: {
        projectId: task.projectId,
        artifactSetId: { in: acceptedSetIds },
        artifactSet: {
          OR: dependencyTasks
            .filter(
              (dependency) =>
                dependency.currentArtifactSetId &&
                acceptedSetIds.includes(dependency.currentArtifactSetId),
            )
            .map((dependency) => ({
              id: dependency.currentArtifactSetId!,
              taskId: dependency.id,
              taskGeneration: dependency.generation,
            })),
        },
        byteLength: { gt: 0 },
      },
      select: {
        id: true,
        artifactSetId: true,
        kind: true,
        sha256: true,
        byteLength: true,
        mediaType: true,
        storage: true,
      },
    });
    return artifacts.map((artifact) => ({
      artifactId: artifact.id,
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
      mediaType: artifact.mediaType,
      ...(artifact.storage ? { storage: artifact.storage } : {}),
      ...(artifact.kind ? { kind: String(artifact.kind) } : {}),
      ...(acceptedSetSources.get(artifact.artifactSetId)
        ? { sourceStepKey: acceptedSetSources.get(artifact.artifactSetId) }
        : {}),
    }));
  }

  async listRolePackageResources(input: {
    projectId: string;
    roleKey: string;
    revisionId: string;
  }): Promise<V1SnapshotRoleResource[]> {
    const revision = await this.prisma.workflowRevision.findUnique({
      where: { id: input.revisionId },
      select: { compiledRules: true },
    });
    if (!revision) return [];
    const lock = packageLockOf(revision.compiledRules, input.roleKey);
    if (!lock) return [];
    const packageVersion = await this.prisma.rolePackageVersion.findFirst({
      where: {
        packageId: lock.packageId,
        version: lock.version,
        roleKey: input.roleKey,
        ...(lock.packageDigest ? { manifestDigest: lock.packageDigest } : {}),
        OR: [{ projectId: input.projectId }, { projectId: null }],
      },
      orderBy: { projectId: { sort: 'asc', nulls: 'last' } },
      select: { id: true },
    });
    if (!packageVersion) return [];
    const resources = await this.prisma.rolePackageResource.findMany({
      where: { rolePackageVersionId: packageVersion.id },
      orderBy: { resourceKey: 'asc' },
      select: { id: true, resourceKey: true, sha256: true, byteLength: true, mediaType: true },
    });
    return resources.map((resource) => ({
      rolePackageResourceId: resource.id,
      refKey: resource.resourceKey,
      sha256: resource.sha256,
      byteLength: resource.byteLength,
      mediaType: resource.mediaType,
    }));
  }

  async inspectRolePackage(input: {
    projectId: string;
    roleKey: string;
    revisionId: string;
  }): Promise<TaskRolePackageStatus> {
    const result: TaskRolePackageStatus = {
      workflowDefinitionRevisionId: input.revisionId,
      roleKey: input.roleKey,
      status: 'UNAVAILABLE',
      locked: null,
      latestAvailable: null,
    };
    const revision = await this.prisma.workflowRevision.findUnique({
      where: { id: input.revisionId },
      select: { projectId: true, compiledRules: true },
    });
    if (!revision || revision.projectId !== input.projectId) return result;
    const lock = packageLockOf(revision.compiledRules, input.roleKey);
    if (!lock) return { ...result, status: 'NOT_CONFIGURED' };
    const versions = await this.prisma.rolePackageVersion.findMany({
      where: {
        packageId: lock.packageId,
        roleKey: input.roleKey,
        OR: [{ projectId: input.projectId }, { projectId: null }],
      },
      select: { id: true, projectId: true, packageId: true, version: true, manifestDigest: true },
    });
    // Project scope wins only for an otherwise identical SemVer. Ignore invalid old records.
    const ordered = versions
      .filter((version) => isStrictSemver(version.version))
      .sort(
        (a, b) =>
          compareSemver(b.version, a.version) ||
          Number(b.projectId !== null) - Number(a.projectId !== null),
      );
    const latest = ordered[0];
    if (latest)
      result.latestAvailable = {
        packageId: latest.packageId,
        version: latest.version,
        packageDigest: latest.manifestDigest,
        source: latest.projectId === null ? 'BUILTIN' : 'PROJECT',
      };
    const exact = ordered.find(
      (version) =>
        version.version === lock.version &&
        (lock.packageDigest === undefined || version.manifestDigest === lock.packageDigest),
    );
    if (!exact || !lock.packageDigest) return result;
    const resources = await this.prisma.rolePackageResource.findMany({
      where: { rolePackageVersionId: exact.id },
      orderBy: { resourceKey: 'asc' },
      select: { resourceKey: true, path: true, sha256: true, byteLength: true },
    });
    return {
      ...result,
      status: 'LOCKED',
      locked: {
        packageId: exact.packageId,
        version: exact.version,
        packageDigest: exact.manifestDigest,
        source: exact.projectId === null ? 'BUILTIN' : 'PROJECT',
        resources: resources.map((resource) => ({
          refId: `role:${resource.resourceKey}`,
          path: resource.path,
          sha256: resource.sha256,
          byteLength: resource.byteLength,
        })),
      },
    };
  }

  async findSnapshot(snapshotId: string): Promise<V1SnapshotView | null> {
    const snapshot = await this.prisma.contextSnapshot.findUnique({
      where: { id: snapshotId },
      include: { resources: true },
    });
    if (!snapshot) return null;
    return this.toView(snapshot);
  }

  async findSnapshotResource(
    snapshotId: string,
    refId: string,
  ): Promise<V1SnapshotResourceBody | null> {
    const ref = await this.prisma.snapshotResourceRef.findFirst({
      where: { snapshotId, refKey: refId },
    });
    if (!ref) return null;
    let bodyBytes: Uint8Array | null = null;
    if (ref.documentRevisionId) {
      const revision = await this.prisma.documentRevision.findUnique({
        where: { id: ref.documentRevisionId },
        select: { bodyBytes: true },
      });
      bodyBytes = revision?.bodyBytes ?? null;
    } else if (ref.artifactId) {
      const artifact = await this.prisma.artifact.findUnique({
        where: { id: ref.artifactId },
        select: { bodyBytes: true },
      });
      bodyBytes = artifact?.bodyBytes ?? null;
    } else if (ref.rolePackageResourceId) {
      const resource = await this.prisma.rolePackageResource.findUnique({
        where: { id: ref.rolePackageResourceId },
        select: { bodyBytes: true },
      });
      bodyBytes = resource?.bodyBytes ?? null;
    }
    if (!bodyBytes) return null;
    return {
      refId: ref.refKey,
      kind: ref.kind as V1SnapshotResourceBody['kind'],
      targetId: ref.documentRevisionId ?? ref.artifactId ?? ref.rolePackageResourceId ?? '',
      sha256: ref.sha256,
      byteLength: ref.byteLength,
      mediaType: ref.mediaType,
      authority: ref.authority as V1SnapshotResourceBody['authority'],
      bodyBytes,
    };
  }

  async findRoleResourceProjectId(rolePackageResourceId: string): Promise<string | null> {
    const resource = await this.prisma.rolePackageResource.findUnique({
      where: { id: rolePackageResourceId },
      select: { packageVersion: { select: { projectId: true } } },
    });
    return resource?.packageVersion.projectId ?? null;
  }

  async createSnapshot(input: V1CreateSnapshotInput): Promise<V1CreateSnapshotResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runCreate(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runCreate(input: V1CreateSnapshotInput): Promise<V1CreateSnapshotResult> {
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

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${task.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${input.actorUserId}::uuid FOR SHARE`,
        );

        // 版本与代次在事务内复核；任一变即 409 BASELINE_STALE，不基于事务外旧基线下注。
        if (task.version !== input.expectedTaskVersion || task.generation !== input.taskGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            {
              taskId: task.id,
              expectedVersion: input.expectedTaskVersion,
              currentVersion: task.version,
            },
            409,
          );

        const claim = await tx.taskClaim.findFirst({
          where: { taskId: task.id, releasedAt: null },
        });
        if (!claim || claim.id !== input.claimId || claim.taskGeneration !== input.taskGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (claimScopeKeyOf(claim.userId, claim.credentialId) !== input.operation.principalScopeKey)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );

        // 条件 CAS：并发创建同一 task 的另一快照会命中 0 行并被拒绝。
        const updated = await tx.task.updateMany({
          where: {
            id: task.id,
            version: input.expectedTaskVersion,
            generation: input.taskGeneration,
            currentClaimId: claim.id,
          },
          data: { version: { increment: 1 }, currentSnapshotId: input.snapshotId },
        });
        if (updated.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'SNAPSHOT_CONFLICT',
            { taskId: task.id },
            409,
          );

        const stamp = await tx.principalStamp.create({
          data: {
            kind: input.actorStamp.kind,
            userId: input.actorUserId,
            webSessionId: input.actorStamp.webSessionId,
            agentCredentialId: input.actorStamp.agentCredentialId,
            projectId: input.projectId,
            roleId: input.actorStamp.roleId,
            roleKeySnapshot: input.actorStamp.roleKeySnapshot,
            scopeSnapshot: input.actorStamp.scopeSnapshot,
            userAuthVersion: input.actorStamp.userAuthVersion,
          },
        });

        const snapshot = await tx.contextSnapshot.create({
          data: {
            id: input.snapshotId,
            projectId: input.projectId,
            requirementId: input.requirementId,
            taskId: input.taskId,
            requirementGeneration: input.requirementGeneration,
            taskGeneration: input.taskGeneration,
            workflowDefinitionRevisionId: input.workflowDefinitionRevisionId,
            claimId: input.claimId,
            manifest: input.manifest as unknown as Prisma.InputJsonValue,
            manifestDigest: input.manifestDigest,
            createdByStampId: stamp.id,
            createdAt: input.now,
          },
        });

        if (input.resources.length > 0) {
          await tx.snapshotResourceRef.createMany({
            data: input.resources.map((resource) => ({
              projectId: input.projectId,
              snapshotId: snapshot.id,
              refKey: resource.refId,
              kind: resource.kind as Prisma.SnapshotResourceRefCreateManyInput['kind'],
              documentRevisionId: resource.documentRevisionId ?? null,
              artifactId: resource.artifactId ?? null,
              rolePackageResourceId: resource.rolePackageResourceId ?? null,
              sha256: resource.sha256,
              byteLength: resource.byteLength,
              mediaType: resource.mediaType,
              authority:
                resource.authority as Prisma.SnapshotResourceRefCreateManyInput['authority'],
            })),
          });
        }

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            actorStampId: stamp.id,
            action: 'CONTEXT_SNAPSHOT_CREATE',
            targetType: 'TASK',
            targetId: input.taskId,
            targetVersion: input.expectedTaskVersion,
            outcome: 'SUCCESS',
            details: { snapshotId: snapshot.id, manifestDigest: input.manifestDigest },
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
            resultRefs: { snapshotId: snapshot.id, taskVersion: input.expectedTaskVersion + 1 },
            responseMetadata: { manifestDigest: input.manifestDigest },
            committedAt: input.now,
          },
        });

        return {
          snapshot: this.toView({
            ...snapshot,
            resources: input.resources.map((resource) => ({
              refKey: resource.refId,
              kind: resource.kind,
              sha256: resource.sha256,
              byteLength: resource.byteLength,
              mediaType: resource.mediaType,
              authority: resource.authority,
              documentRevisionId: resource.documentRevisionId ?? null,
              artifactId: resource.artifactId ?? null,
              rolePackageResourceId: resource.rolePackageResourceId ?? null,
            })),
          }),
          taskVersion: input.expectedTaskVersion + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private toView(snapshot: {
    id: string;
    projectId: string;
    requirementId: string;
    taskId: string;
    taskGeneration: number;
    requirementGeneration: number;
    manifest: unknown;
    manifestDigest: string;
    createdAt: Date;
    resources: Array<{
      refKey: string;
      kind: string;
      sha256: string;
      byteLength: number;
      mediaType: string;
      authority: string;
      documentRevisionId: string | null;
      artifactId: string | null;
      rolePackageResourceId: string | null;
    }>;
  }): V1SnapshotView {
    return {
      id: snapshot.id,
      projectId: snapshot.projectId,
      requirementId: snapshot.requirementId,
      taskId: snapshot.taskId,
      taskGeneration: snapshot.taskGeneration,
      requirementGeneration: snapshot.requirementGeneration,
      manifest: snapshot.manifest as V1SnapshotView['manifest'],
      manifestDigest: snapshot.manifestDigest,
      createdAt: snapshot.createdAt,
      resources: snapshot.resources.map((resource) => ({
        refId: resource.refKey,
        kind: resource.kind as V1SnapshotView['resources'][number]['kind'],
        targetId:
          resource.documentRevisionId ??
          resource.artifactId ??
          resource.rolePackageResourceId ??
          '',
        sha256: resource.sha256,
        byteLength: resource.byteLength,
        mediaType: resource.mediaType,
        authority: resource.authority as V1SnapshotView['resources'][number]['authority'],
      })),
    };
  }
}
