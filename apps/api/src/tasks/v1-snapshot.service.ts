import { Inject, Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
  type Scope,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  assembleSnapshotManifest,
  deliveryScopeDigestOf,
  type V1SnapshotManifestResource,
} from './v1-snapshot-policy';
import {
  V1_SNAPSHOT_REPOSITORY,
  type V1CreateSnapshotInput,
  type V1CreateSnapshotResult,
  type V1SnapshotRepository,
  type V1SnapshotBindingRecord,
  type V1SnapshotResourceBody,
  type V1SnapshotTaskState,
  type V1SnapshotView,
} from './v1-snapshot.repository';

export type V1SnapshotContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  now: Date;
  operationId: string;
  webSessionId: string;
  userAuthVersion: number;
};

export type V1CreateSnapshotRequest = {
  expectedVersion: number;
  claimId: string;
  candidateRevisionIds?: string[];
};

export type V1CreateSnapshotResultView = {
  snapshot: V1SnapshotView;
  taskVersion: number;
  replayed: boolean;
};

const CONTEXT_READ: Scope = 'context:read';
const CONTEXT_CREATE: Scope = 'context:create';

@Injectable()
export class V1SnapshotService {
  constructor(
    @Inject(V1_SNAPSHOT_REPOSITORY) private readonly repository: V1SnapshotRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  /**
   * 创建上下文快照：当前认领、当前授权、准确版本与输入全部满足才落盘；
   * 输入中任一必需正文不可取得或已失权，整次拒绝，不返回部分 manifest。
   */
  async create(
    principal: Principal,
    taskId: string,
    request: V1CreateSnapshotRequest,
    context: V1SnapshotContext,
  ): Promise<V1CreateSnapshotResultView> {
    const task = await this.repository.findTaskState(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    await this.authorization.resolveProjectContext(principal, task.projectId, 'write');
    await this.authorization.requireScope(principal, task.projectId, CONTEXT_CREATE);

    const ownerScopeKey = principalScopeKey(principal);
    const projectScopeKey = `project:${task.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    // 合法重放在版本 CAS 之前返回已提交结果。
    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey: ownerScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const current = await this.repository.findSnapshot(
        String(existing.resultRefs.snapshotId ?? ''),
      );
      if (!current)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'SNAPSHOT_NOT_FOUND',
          undefined,
          404,
        );
      return {
        snapshot: current,
        taskVersion: Number(existing.resultRefs.taskVersion ?? current.taskGeneration),
        replayed: true,
      };
    }

    this.requireActiveClaim(task, request.claimId, ownerScopeKey);
    if (task.retiredAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'WORKFLOW_INSTANCE_RETIRED',
        { taskId, workflowInstanceId: task.workflowDefinitionRevisionId },
        409,
      );
    if (task.taskVersion !== request.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        { taskId, expectedVersion: request.expectedVersion, currentVersion: task.taskVersion },
        409,
      );

    const resources: V1SnapshotManifestResource[] = [];
    const refs: Array<
      V1SnapshotManifestResource & {
        documentRevisionId?: string | null;
        artifactId?: string | null;
        rolePackageResourceId?: string | null;
      }
    > = [];

    const addDocument = async (
      refId: string,
      revisionId: string,
      authority: 'PUBLISHED' | 'CANDIDATE',
      expected: { requirementId?: string; kinds?: string[] },
    ) => {
      const revision = await this.repository.findRevision(revisionId);
      if (!revision) return false;
      if (expected.requirementId && revision.requirementId !== expected.requirementId) return false;
      if (expected.kinds && !expected.kinds.includes(revision.documentKind)) return false;
      // 当前读取权在创建快照时校验；快照固定内容但不冻结未来权限。
      const access = await this.authorization.resolveKnowledgeAccess(
        principal,
        revision.knowledgeBaseId,
      );
      if (!access.canRead) return false;
      const resource: V1SnapshotManifestResource = {
        refId,
        kind: 'DOCUMENT_REVISION',
        targetId: revision.revisionId,
        sha256: revision.sha256,
        byteLength: revision.byteLength,
        mediaType: revision.mediaType,
        authority,
      };
      resources.push(resource);
      refs.push({ ...resource, documentRevisionId: revision.revisionId });
      return true;
    };

    let productBaseline: Awaited<ReturnType<typeof this.buildBaseline>> = null;
    if (task.baselinePolicy === 'PUBLISHED_PRD') {
      productBaseline = await this.buildBaseline(task, principal, addDocument);
      if (!productBaseline)
        throw new WorkmeshError(
          V1_ERROR_CODES.BASELINE_STALE,
          'SNAPSHOT_BASELINE_UNAVAILABLE',
          { taskId, currentPrdRevisionId: task.currentPrdRevisionId },
          409,
        );
    }

    const candidateIds = request.candidateRevisionIds ?? [];
    if (candidateIds.length > 0) {
      if (task.baselinePolicy !== 'NONE')
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'SNAPSHOT_CANDIDATE_NOT_ALLOWED',
          { taskId, baselinePolicy: task.baselinePolicy },
          422,
        );
      for (const candidate of await this.repository.findCandidateRevisions({
        projectId: task.projectId,
        requirementId: task.requirementId,
        revisionIds: candidateIds,
      })) {
        if (!candidateIds.includes(candidate.revisionId)) continue;
        const added = await addDocument(
          `candidate:${candidate.revisionId}`,
          candidate.revisionId,
          'CANDIDATE',
          {
            requirementId: task.requirementId,
            kinds: ['UNDERSTANDING', 'PRD'],
          },
        );
        if (!added)
          throw new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'SNAPSHOT_INPUT_UNAVAILABLE',
            { revisionId: candidate.revisionId },
            422,
          );
      }
      const resolvedIds = new Set(refs.map((ref) => ref.documentRevisionId));
      for (const id of candidateIds) {
        if (!resolvedIds.has(id))
          throw new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'SNAPSHOT_INPUT_UNAVAILABLE',
            { revisionId: id },
            422,
          );
      }
    }

    const knowledgeBindings = await this.repository.listRoleKnowledgeBindings(
      task.projectId,
      task.roleId,
    );
    const knowledgeInputs = task.knowledgeInputs ?? [];
    // Preserve every project/role-bound document. Workflow input bindings add
    // exact availability requirements; they do not replace the role policy.
    const bindingByDocumentId = new Map<string, V1SnapshotBindingRecord>();
    for (const binding of knowledgeBindings) {
      const existing = bindingByDocumentId.get(binding.documentId);
      bindingByDocumentId.set(
        binding.documentId,
        existing ? { ...existing, required: existing.required || binding.required } : binding,
      );
    }
    for (const input of knowledgeInputs) {
      const binding = bindingByDocumentId.get(input.documentId);
      if (!binding) {
        if (input.required !== false)
          throw new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
            { inputKey: input.inputKey, documentId: input.documentId },
            422,
          );
        continue;
      }
      if (input.required !== false && !binding.required)
        bindingByDocumentId.set(input.documentId, { ...binding, required: true });
    }

    for (const binding of bindingByDocumentId.values()) {
      if (!binding.currentPublishedRevisionId) {
        if (binding.required)
          throw new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
            { documentId: binding.documentId },
            422,
          );
        continue;
      }
      const added = await addDocument(
        `knowledge:${binding.documentId}`,
        binding.currentPublishedRevisionId,
        'PUBLISHED',
        {
          kinds: ['KNOWLEDGE', 'DECISION'],
        },
      );
      if (!added && binding.required)
        throw new WorkmeshError(
          V1_ERROR_CODES.INPUT_UNAVAILABLE,
          'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
          { documentId: binding.documentId },
          422,
        );
    }

    const prerequisiteArtifacts = await this.repository.listAcceptedPrerequisiteArtifacts(task.id);
    const requiredUpstreamInputs = (task.upstreamInputs ?? []).filter(
      (input) => input.required !== false,
    );
    for (const input of requiredUpstreamInputs) {
      const available = prerequisiteArtifacts.some(
        (artifact) => artifact.sourceStepKey === input.fromStepKey && artifact.kind === input.kind,
      );
      if (!available)
        throw new WorkmeshError(
          V1_ERROR_CODES.INPUT_UNAVAILABLE,
          'SNAPSHOT_INPUT_UNAVAILABLE',
          {
            inputKey: input.inputKey,
            fromStepKey: input.fromStepKey,
            kind: input.kind,
          },
          422,
        );
    }

    for (const artifact of prerequisiteArtifacts) {
      const resource: V1SnapshotManifestResource = {
        refId: `artifact:${artifact.artifactId}`,
        kind: 'ARTIFACT',
        targetId: artifact.artifactId,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        mediaType: artifact.mediaType,
        authority: 'PUBLISHED',
      };
      resources.push(resource);
      refs.push({ ...resource, artifactId: artifact.artifactId });
    }

    for (const roleResource of await this.repository.listRolePackageResources({
      projectId: task.projectId,
      roleKey: task.roleKey,
      revisionId: task.workflowDefinitionRevisionId,
    })) {
      const resource: V1SnapshotManifestResource = {
        refId: `role:${roleResource.refKey}`,
        kind: 'ROLE_RESOURCE',
        targetId: roleResource.rolePackageResourceId,
        sha256: roleResource.sha256,
        byteLength: roleResource.byteLength,
        mediaType: roleResource.mediaType,
        authority: 'PUBLISHED',
      };
      resources.push(resource);
      refs.push({ ...resource, rolePackageResourceId: roleResource.rolePackageResourceId });
    }

    const { manifest, manifestDigest } = await assembleSnapshotManifest({
      projectId: task.projectId,
      requirementId: task.requirementId,
      requirementGeneration: task.requirementGeneration,
      taskId: task.id,
      taskGeneration: task.taskGeneration,
      workflowDefinitionRevisionId: task.workflowDefinitionRevisionId,
      workflowDigest: task.workflowDigest,
      knowledgeBindingsVersion: task.knowledgeBindingsVersion,
      stepKey: task.stepKey,
      baselinePolicy: task.baselinePolicy,
      productBaseline,
      resources,
    });

    const input: V1CreateSnapshotInput = {
      snapshotId: context.operationId,
      projectId: task.projectId,
      requirementId: task.requirementId,
      taskId: task.id,
      taskGeneration: task.taskGeneration,
      requirementGeneration: task.requirementGeneration,
      workflowDefinitionRevisionId: task.workflowDefinitionRevisionId,
      claimId: request.claimId,
      manifest,
      manifestDigest,
      resources: refs,
      expectedTaskVersion: request.expectedVersion,
      actorUserId: principal.userId,
      actorStamp: {
        kind: principal.kind,
        webSessionId: principal.kind === 'HUMAN' ? context.webSessionId : null,
        agentCredentialId:
          principal.kind === 'AGENT' ? (principal.agentCredentialId ?? null) : null,
        roleId: task.roleId,
        roleKeySnapshot: task.roleKey,
        scopeSnapshot: [...principal.scopes].sort(),
        userAuthVersion: context.userAuthVersion,
      },
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey: ownerScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    };

    const created: V1CreateSnapshotResult = await this.repository.createSnapshot(input);
    return { ...created, replayed: false };
  }

  /** 读取快照：任一必需引用已失权则整个读取拒绝，不返回部分可误用 manifest。 */
  async getSnapshot(principal: Principal, snapshotId: string): Promise<V1SnapshotView> {
    const snapshot = await this.repository.findSnapshot(snapshotId);
    if (!snapshot)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_NOT_FOUND',
        { snapshotId },
        404,
      );
    await this.authorization.resolveProjectContext(principal, snapshot.projectId, 'read');
    await this.authorization.requireScope(principal, snapshot.projectId, CONTEXT_READ);

    for (const resource of snapshot.resources) {
      await this.assertResourceReadable(
        principal,
        resource.kind,
        resource.targetId,
        resource.sha256,
      );
    }
    return snapshot;
  }

  /**
   * 读取单个资源正文：只按 refId 定位 manifest 中已记录的目标，不接受客户端提供的文件路径；
   * 读取后再次核对摘要与长度，防止底层内容与 manifest 不一致。
   */
  async getResource(
    principal: Principal,
    snapshotId: string,
    refId: string,
  ): Promise<V1SnapshotResourceBody> {
    const snapshot = await this.repository.findSnapshot(snapshotId);
    if (!snapshot)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_NOT_FOUND',
        { snapshotId },
        404,
      );
    await this.authorization.resolveProjectContext(principal, snapshot.projectId, 'read');
    await this.authorization.requireScope(principal, snapshot.projectId, CONTEXT_READ);

    const declared = snapshot.resources.find((resource) => resource.refId === refId);
    if (!declared)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_REF_NOT_FOUND',
        { snapshotId, refId },
        404,
      );
    await this.assertResourceReadable(principal, declared.kind, declared.targetId, declared.sha256);

    const body = await this.repository.findSnapshotResource(snapshotId, refId);
    if (!body || body.sha256 !== declared.sha256 || body.byteLength !== declared.byteLength)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONTENT_UNAVAILABLE,
        'SNAPSHOT_RESOURCE_UNAVAILABLE',
        { snapshotId, refId },
        503,
      );
    return body;
  }

  private requireActiveClaim(task: V1SnapshotTaskState, claimId: string, ownerScopeKey: string) {
    const claim = task.currentClaim;
    if (
      !claim ||
      claim.id !== claimId ||
      claim.releasedAt ||
      claim.taskGeneration !== task.taskGeneration ||
      claim.principalScopeKey !== ownerScopeKey
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.CLAIM_INVALID,
        'CLAIM_INVALID',
        { taskId: task.id, claimId },
        409,
      );
  }

  private async buildBaseline(
    task: V1SnapshotTaskState,
    principal: Principal,
    addDocument: (
      refId: string,
      revisionId: string,
      authority: 'PUBLISHED' | 'CANDIDATE',
      expected: { requirementId?: string; kinds?: string[] },
    ) => Promise<boolean>,
  ) {
    if (!task.currentPrdRevisionId || !task.currentUnderstandingRevisionId) return null;
    const understandingAdded = await addDocument(
      'understanding',
      task.currentUnderstandingRevisionId,
      'PUBLISHED',
      {
        requirementId: task.requirementId,
        kinds: ['UNDERSTANDING'],
      },
    );
    const prdAdded = await addDocument('prd', task.currentPrdRevisionId, 'PUBLISHED', {
      requirementId: task.requirementId,
      kinds: ['PRD'],
    });
    if (!understandingAdded || !prdAdded) return null;
    const prd = await this.repository.findRevision(task.currentPrdRevisionId);
    if (!prd) return null;
    return {
      understandingRevisionId: task.currentUnderstandingRevisionId,
      prdRevisionId: task.currentPrdRevisionId,
      prdSha256: prd.sha256,
      deliveryScopeDigest: await deliveryScopeDigestOf(task.deliveryScope),
    };
  }

  private async assertResourceReadable(
    principal: Principal,
    kind: 'DOCUMENT_REVISION' | 'ARTIFACT' | 'ROLE_RESOURCE',
    targetId: string,
    sha256: string,
  ): Promise<void> {
    if (kind === 'DOCUMENT_REVISION') {
      const revision = await this.repository.findRevision(targetId);
      if (!revision || revision.sha256 !== sha256)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'SNAPSHOT_REF_UNREADABLE',
          { targetId },
          404,
        );
      const access = await this.authorization.resolveKnowledgeAccess(
        principal,
        revision.knowledgeBaseId,
      );
      if (!access.canRead)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'SNAPSHOT_REF_UNREADABLE',
          { targetId },
          404,
        );
      return;
    }
    if (kind === 'ROLE_RESOURCE') {
      // 项目私有包只在所属项目内读取；内置包 ownerProjectId=null，对所有项目可见。
      const ownerProjectId = await this.repository.findRoleResourceProjectId(targetId);
      if (ownerProjectId)
        await this.authorization.resolveProjectContext(principal, ownerProjectId, 'read');
    }
  }
}
