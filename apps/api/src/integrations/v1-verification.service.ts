import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  canonicalJson,
  V1_ERROR_CODES,
  WorkmeshError,
  type VerificationCollection,
  type VerificationEvidenceView,
  type VerificationBindingView,
} from '@workmesh/shared';
import type { Prisma, VerificationObservation } from '../../../node_modules/.prisma/workmesh-v1-client';
import { PrismaService } from '../prisma/prisma.service';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import { assertReplayable, requestDigestOf } from '../common/v1-idempotency';
import { resolveActionsCredential } from './v1-actions-credentials';
import {
  evaluateVerificationApplicability,
  type VerificationDiagnosticsTarget,
} from './v1-verification-diagnostics';

export const V1_ACTIONS_ADAPTER = Symbol('V1_ACTIONS_ADAPTER');
export interface ActionsCollector {
  collect(input: {
    owner: string;
    name: string;
    repositoryId: string;
    runId: string;
    attempt: number;
    token: string;
  }): Promise<VerificationCollection>;
}
export type VerificationWriteContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
};
export type VerificationSyncInput = {
  projectRepositoryId: string;
  runId: string;
  attempt: number;
  expectedProjectVersion: number;
};
export type VerificationBindInput = {
  artifactSetId: string;
  expectedTaskVersion: number;
  expectedTaskGeneration: number;
  snapshotId: string;
  manifestDigest: string;
};

function failure(reason: string, status = 409): WorkmeshError {
  return new WorkmeshError(
    status === 404 ? V1_ERROR_CODES.RESOURCE_NOT_FOUND : V1_ERROR_CODES.RESOURCE_CONFLICT,
    reason,
    undefined,
    status,
  );
}

export function verificationView(row: VerificationObservation): VerificationEvidenceView {
  return {
    id: row.id,
    projectId: row.projectId,
    projectRepositoryId: row.projectRepositoryId,
    collectedAt: row.collectedAt.toISOString(),
    collection: row.payload as unknown as VerificationCollection,
    payloadDigest: row.payloadDigest,
  };
}

@Injectable()
export class V1VerificationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_ACTIONS_ADAPTER) private readonly adapter: ActionsCollector,
  ) {}

  async sync(
    principal: V1Principal,
    projectId: string,
    input: VerificationSyncInput,
    context: VerificationWriteContext,
  ): Promise<{ evidence: VerificationEvidenceView; replayed: boolean }> {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    this.requireHuman(principal);
    const scope = this.operationScope(principal, projectId, context);
    const prior = await this.prisma.idempotentOperation.findUnique({ where: scope.where });
    if (prior) {
      assertReplayable(this.operationRecord(prior), scope.request);
      const evidence = await this.prisma.verificationObservation.findFirst({
        where: { projectId, id: String((prior.resultRefs as Record<string, unknown>).evidenceId) },
      });
      if (!evidence) throw failure('VERIFICATION_REPLAY_MISSING');
      await this.authorization.resolveProjectContext(principal, projectId, 'write');
      return { evidence: verificationView(evidence), replayed: true };
    }
    const repository = await this.prisma.projectRepository.findFirst({
      where: { id: input.projectRepositoryId, projectId },
    });
    if (!repository) throw failure('PROJECT_REPOSITORY_NOT_FOUND', 404);
    if (
      repository.archivedAt ||
      repository.identityMode !== 'PROVIDER' ||
      repository.adapter !== 'GITHUB' ||
      !repository.externalId ||
      !/^[1-9][0-9]{0,19}$/.test(repository.externalId)
    )
      throw failure('ACTIONS_PROVIDER_REPOSITORY_REQUIRED');
    const token = resolveActionsCredential({
      projectId,
      projectRepositoryId: repository.id,
      providerRepositoryId: repository.externalId,
    });
    // Network work happens outside the transaction. The registration and authorization
    // are checked again before any immutable fact, operation or audit row is committed.
    const collection = await this.adapter.collect({
      owner: repository.owner,
      name: repository.name,
      repositoryId: repository.externalId,
      runId: input.runId,
      attempt: input.attempt,
      token,
    });
    if (
      collection.provider !== 'GITHUB_ACTIONS' ||
      collection.origin !== 'PROVIDER_OBSERVED' ||
      collection.repositoryId !== repository.externalId ||
      collection.runId !== input.runId ||
      collection.attempt !== input.attempt
    )
      throw failure('ACTIONS_COLLECTION_IDENTITY_CONFLICT');
    // Collected time identifies an observation, not a different upstream payload.
    const { collectedAt: _collectedAt, ...facts } = collection;
    const payloadDigest = createHash('sha256').update(canonicalJson(facts)).digest('hex');
    return this.transaction(async (tx) => {
      const access = await this.authorizeWrite(tx, principal, projectId);
      const replay = await tx.idempotentOperation.findUnique({ where: scope.where });
      if (replay) {
        assertReplayable(this.operationRecord(replay), scope.request);
        const evidence = await tx.verificationObservation.findFirst({
          where: { projectId, id: String((replay.resultRefs as Record<string, unknown>).evidenceId) },
        });
        if (!evidence) throw failure('VERIFICATION_REPLAY_MISSING');
        return { evidence: verificationView(evidence), replayed: true };
      }
      if (access.project.version !== input.expectedProjectVersion)
        throw new WorkmeshError(V1_ERROR_CODES.PROJECT_VERSION_CONFLICT, 'PROJECT_VERSION_CONFLICT', undefined, 409);
      const currentRepository = await tx.projectRepository.findFirst({
        where: { id: repository.id, projectId },
      });
      if (
        !currentRepository || currentRepository.archivedAt ||
        currentRepository.identityMode !== repository.identityMode ||
        currentRepository.adapter !== repository.adapter ||
        currentRepository.externalId !== repository.externalId ||
        currentRepository.owner !== repository.owner || currentRepository.name !== repository.name ||
        currentRepository.updatedAt.getTime() !== repository.updatedAt.getTime()
      ) throw failure('ACTIONS_REPOSITORY_CHANGED_DURING_COLLECTION');
      let observation = await tx.verificationObservation.findFirst({
        where: { projectId, projectRepositoryId: repository.id, runId: input.runId, attempt: input.attempt, payloadDigest },
      });
      const stamp = await this.stamp(tx, principal, projectId, access.membership.version);
      if (!observation) observation = await tx.verificationObservation.create({
        data: {
          projectId, projectRepositoryId: repository.id, providerRepositoryId: repository.externalId!,
          runId: input.runId, attempt: input.attempt, payloadDigest,
          payload: collection as unknown as Prisma.InputJsonValue,
          collectedAt: new Date(collection.collectedAt), createdByStampId: stamp.id,
        },
      });
      await tx.auditEvent.create({ data: {
        projectId, actorStampId: stamp.id, action: 'VERIFICATION_SYNC',
        targetType: 'VERIFICATION_OBSERVATION', targetId: observation.id, outcome: 'SUCCESS',
        details: { projectRepositoryId: repository.id, runId: input.runId, attempt: input.attempt, payloadDigest, authority: 'PROVIDER_METADATA_ONLY' },
      } });
      await tx.idempotentOperation.create({ data: {
        projectId, ...scope.keys, method: context.method, route: context.route,
        requestDigest: scope.request.digest, resultRefs: { evidenceId: observation.id }, responseMetadata: {},
      } });
      return { evidence: verificationView(observation), replayed: false };
    });
  }

  async list(principal: V1Principal, projectId: string, cursor?: string) {
    await this.authorizeRead(principal, projectId);
    const rows = await this.prisma.verificationObservation.findMany({
      where: { projectId, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' }, take: 51,
    });
    await this.authorizeRead(principal, projectId);
    return { items: rows.slice(0, 50).map(verificationView), checkedAt: new Date().toISOString(), nextCursor: rows.length > 50 ? rows[49].id : null };
  }

  async bind(
    principal: V1Principal,
    projectId: string,
    evidenceId: string,
    input: VerificationBindInput,
    context: VerificationWriteContext,
  ): Promise<{ binding: VerificationBindingView; replayed: boolean }> {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    this.requireHuman(principal);
    const scope = this.operationScope(principal, projectId, context);
    return this.transaction(async (tx) => {
      const access = await this.authorizeWrite(tx, principal, projectId);
      const replay = await tx.idempotentOperation.findUnique({ where: scope.where });
      if (replay) {
        assertReplayable(this.operationRecord(replay), scope.request);
        const binding = await tx.verificationBinding.findFirst({ where: {
          projectId, id: String((replay.resultRefs as Record<string, unknown>).bindingId),
        } });
        if (!binding) throw failure('VERIFICATION_REPLAY_MISSING');
        return { binding: this.bindingView(binding), replayed: true };
      }
      const observation = await tx.verificationObservation.findFirst({ where: { id: evidenceId, projectId } });
      if (!observation) throw failure('VERIFICATION_EVIDENCE_NOT_FOUND', 404);
      const state = await this.target(tx, projectId, input.artifactSetId, observation.projectRepositoryId);
      if (
        state.task.version !== input.expectedTaskVersion ||
        state.task.generation !== input.expectedTaskGeneration ||
        state.set.taskGeneration !== input.expectedTaskGeneration ||
        state.set.snapshotId !== input.snapshotId || state.set.manifestDigest !== input.manifestDigest ||
        state.task.currentArtifactSetId !== state.set.id || state.task.currentSnapshotId !== state.set.snapshotId
      ) throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'VERIFICATION_TARGET_CHANGED', undefined, 409);
      if (!state.repositoryPresent) throw failure('VERIFICATION_REPOSITORY_NOT_IN_ARTIFACT_SET');
      const diagnostics = evaluateVerificationApplicability({
        collection: verificationView(observation).collection, target: state.target, definition: { status: 'UNKNOWN' },
      });
      let binding = await tx.verificationBinding.findFirst({ where: { projectId, observationId: evidenceId, artifactSetId: input.artifactSetId } });
      const stamp = await this.stamp(tx, principal, projectId, access.membership.version);
      if (!binding) binding = await tx.verificationBinding.create({ data: {
        projectId, observationId: evidenceId, artifactSetId: input.artifactSetId,
        taskGeneration: state.set.taskGeneration, snapshotId: state.set.snapshotId,
        manifestDigest: state.set.manifestDigest, diagnostics: diagnostics as unknown as Prisma.InputJsonValue,
        createdByStampId: stamp.id,
      } });
      await tx.auditEvent.create({ data: {
        projectId, actorStampId: stamp.id, action: 'VERIFICATION_BIND', targetType: 'VERIFICATION_BINDING',
        targetId: binding.id, outcome: 'SUCCESS',
        details: { evidenceId, artifactSetId: input.artifactSetId, authority: 'ADVISORY' },
      } });
      await tx.idempotentOperation.create({ data: {
        projectId, ...scope.keys, method: context.method, route: context.route,
        requestDigest: scope.request.digest, resultRefs: { bindingId: binding.id }, responseMetadata: {},
      } });
      return { binding: this.bindingView(binding), replayed: false };
    });
  }

  async forArtifactSet(principal: V1Principal, projectId: string, artifactSetId: string, cursor?: string) {
    await this.authorizeRead(principal, projectId);
    // Repeatable-read keeps target versions and observations on the same read snapshot.
    const result = await this.prisma.$transaction(async (tx) => {
      const set = await tx.artifactSet.findFirst({ where: { id: artifactSetId, projectId }, select: { id: true } });
      if (!set) throw failure('ARTIFACT_SET_NOT_FOUND', 404);
      const rows = await tx.verificationBinding.findMany({
        where: { projectId, artifactSetId, ...(cursor ? { id: { lt: cursor } } : {}) },
        orderBy: { id: 'desc' }, take: 51, include: { observation: true },
      });
      const targets = new Map<string, Awaited<ReturnType<V1VerificationService['target']>>>();
      const items = [];
      for (const row of rows.slice(0, 50)) {
        const repositoryId = row.observation.projectRepositoryId;
        let state = targets.get(repositoryId);
        if (!state) {
          state = await this.target(tx, projectId, artifactSetId, repositoryId);
          targets.set(repositoryId, state);
        }
        const evidence = verificationView(row.observation);
        items.push({
          binding: this.bindingView(row), evidence,
          diagnostics: evaluateVerificationApplicability({ collection: evidence.collection, target: state.target, definition: { status: 'UNKNOWN' } }),
        });
      }
      return { items, checkedAt: new Date().toISOString(), nextCursor: rows.length > 50 ? rows[49].id : null };
    }, { isolationLevel: 'RepeatableRead' });
    await this.authorizeRead(principal, projectId);
    return result;
  }

  private bindingView(row: { id: string; observationId: string; artifactSetId: string; createdAt: Date; diagnostics: Prisma.JsonValue }): VerificationBindingView {
    return { id: row.id, evidenceId: row.observationId, artifactSetId: row.artifactSetId,
      createdAt: row.createdAt.toISOString(), diagnostics: row.diagnostics as unknown as VerificationBindingView['diagnostics'] };
  }

  private async target(tx: Prisma.TransactionClient, projectId: string, artifactSetId: string, repositoryId: string) {
    const set = await tx.artifactSet.findFirst({
      where: { id: artifactSetId, projectId },
      include: { task: { include: { instance: { include: { requirement: true } } } }, artifacts: true, items: { include: { artifact: true } } },
    });
    if (!set) throw failure('ARTIFACT_SET_NOT_FOUND', 404);
    const snapshot = await tx.contextSnapshot.findFirst({ where: { id: set.snapshotId, projectId, taskId: set.taskId } });
    if (!snapshot) throw failure('VERIFICATION_SNAPSHOT_NOT_FOUND', 404);
    const repository = await tx.projectRepository.findFirst({ where: { id: repositoryId, projectId, archivedAt: null, identityMode: 'PROVIDER', adapter: 'GITHUB' } });
    const artifacts = [...set.artifacts, ...set.items.flatMap((item) => item.artifact ? [item.artifact] : [])];
    const commits = [...new Set(artifacts.filter((item) => item.projectRepositoryId === repositoryId).map((item) => item.commitSha).filter((sha): sha is string => !!sha && /^[a-f0-9]{40}$/.test(sha)))];
    const task = set.task;
    const requirement = task.instance.requirement;
    const target: VerificationDiagnosticsTarget = {
      artifactSetId: set.id, currentArtifactSetId: task.currentArtifactSetId,
      taskGeneration: set.taskGeneration, currentTaskGeneration: task.generation,
      requirementGeneration: snapshot.requirementGeneration, currentRequirementGeneration: requirement.generation,
      workflowDefinitionRevisionId: set.workflowDefinitionRevisionId,
      currentWorkflowDefinitionRevisionId: task.instance.definitionRevisionId,
      snapshotId: set.snapshotId, currentSnapshotId: task.currentSnapshotId,
      prdRevisionId: requirement.currentPrdRevisionId,
      projectRepositoryId: repositoryId, providerRepositoryId: repository?.externalId ?? null,
      commitSha: commits.length === 1 ? commits[0] : null,
      // Existing CASES may contain free-form Markdown. An artifact digest alone
      // cannot prove which case IDs or assertions it contains.
      cases: null, casesContentVerified: false, requiredCaseIds: null,
    };
    return { set, task, target, repositoryPresent: artifacts.some((item) => item.projectRepositoryId === repositoryId) };
  }

  private requireHuman(principal: V1Principal): void {
    if (principal.kind !== 'HUMAN' || !principal.sessionId || !principal.authVersion)
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
  }

  private async authorizeRead(principal: V1Principal, projectId: string) {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    await this.authorization.requireScope(principal, projectId, 'task:read');
  }

  private async authorizeWrite(tx: Prisma.TransactionClient, principal: V1Principal, projectId: string) {
    this.requireHuman(principal);
    // Lock authentication and membership rows through commit. Revocation cannot
    // interleave between the final check and the append.
    await tx.$queryRaw`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${principal.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "userId" FROM "workmesh_v1"."ProjectMember" WHERE "projectId" = ${projectId}::uuid AND "userId" = ${principal.userId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "workmesh_v1"."WebSession" WHERE "id" = ${principal.sessionId}::uuid FOR UPDATE`;
    const access = await this.authorization.resolveProjectContext(principal, projectId, 'write', V1AuthorizationPrismaRepository.forTransaction(tx));
    const user = await tx.user.findUnique({ where: { id: principal.userId } });
    const session = await tx.webSession.findFirst({ where: { id: principal.sessionId, userId: principal.userId } });
    const now = Date.now();
    if (!user?.isActive || user.authVersion !== principal.authVersion || !session || session.revokedAt || session.userAuthVersion !== user.authVersion || session.expiresAt.getTime() <= now || session.idleExpiresAt.getTime() <= now)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_INVALID, 'VERIFICATION_SESSION_CHANGED', undefined, 401);
    return access;
  }

  private stamp(tx: Prisma.TransactionClient, principal: V1Principal, projectId: string, memberVersion: number) {
    return tx.principalStamp.create({ data: {
      kind: 'HUMAN', userId: principal.userId, webSessionId: principal.sessionId,
      projectId, userAuthVersion: principal.authVersion!, memberVersion, scopeSnapshot: [],
    } });
  }

  private operationScope(principal: V1Principal, projectId: string, context: VerificationWriteContext) {
    const keys = { projectScopeKey: `project:${projectId}`, principalScopeKey: `user:${principal.userId}`, key: context.idempotencyKey };
    return { keys, where: { projectScopeKey_principalScopeKey_key: keys }, request: { method: context.method, route: context.route, digest: requestDigestOf(context) } };
  }

  private operationRecord(row: { resultRefs: Prisma.JsonValue } & Omit<import('../common/v1-idempotency').V1OperationRecord, 'resultRefs'>) {
    return { ...row, resultRefs: row.resultRefs as Record<string, unknown> };
  }

  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' }); }
      catch (error) {
        if (attempt >= 2 || !error || typeof error !== 'object' || !('code' in error) || !['P2002', 'P2034'].includes(String(error.code))) throw error;
      }
    }
  }
}
