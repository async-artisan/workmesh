import { Inject, Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  sha256Bytes,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
  type Scope,
  type TaskInputIssue,
  type TaskInputStatusView,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { compareSnapshotInputs } from './v1-snapshot-comparison';
import { compareRoleResources } from './v1-role-package-comparison';
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

  /** Read-only preview shares input resolution with creation; it never claims or creates a snapshot. */
  async inspectInputs(principal: Principal, taskId: string): Promise<TaskInputStatusView> {
    const task = await this.repository.findTaskState(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', undefined, 404);
    await this.authorization.resolveProjectContext(principal, task.projectId, 'read');
    await this.authorization.requireScope(principal, task.projectId, CONTEXT_READ);
    const base = {
      taskId,
      taskVersion: task.taskVersion,
      snapshotId: null as string | null,
      checkedAt: new Date().toISOString(),
    };
    const resolved = await this.resolveInputs(principal, task, [], true);
    const rolePackage = await this.repository.inspectRolePackage?.({
      projectId: task.projectId,
      roleKey: task.roleKey,
      revisionId: task.workflowDefinitionRevisionId,
    });
    if (rolePackage)
      rolePackage.comparison = {
        status: task.currentSnapshotId ? 'UNAVAILABLE' : 'NO_SNAPSHOT',
        changes: [],
      };
    const issues = [...resolved.issues];
    const resources = await Promise.all(
      resolved.manifest.resources.map(async (ref) => ({
        ...ref,
        contentStatus: this.repository.verifyResourceContent
          ? await this.repository.verifyResourceContent(ref, task.projectId)
          : ('UNVERIFIED' as const),
      })),
    );
    let comparison: {
      status: 'NO_SNAPSHOT' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE';
      changes: ReturnType<typeof compareSnapshotInputs>['changes'];
      metadataChanges: string[];
    } = { status: 'NO_SNAPSHOT', changes: [], metadataChanges: [] };
    if (resolved.issueCode) {
      comparison = { status: 'UNAVAILABLE', changes: [], metadataChanges: [] };
    } else if (task.currentSnapshotId) {
      try {
        const stored = await this.repository.findSnapshot(task.currentSnapshotId);
        if (
          !stored ||
          stored.projectId !== task.projectId ||
          stored.taskId !== task.id ||
          stored.requirementId !== task.requirementId
        )
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'SNAPSHOT_NOT_FOUND',
            undefined,
            404,
          );
        const previous = await this.getSnapshot(principal, stored.id);
        base.snapshotId = previous.id;
        const difference = compareSnapshotInputs(previous.manifest, resolved.manifest);
        if (rolePackage?.status === 'LOCKED') {
          const previousPackage =
            previous.manifest.workflowDefinitionRevisionId === task.workflowDefinitionRevisionId
              ? rolePackage
              : await this.repository.inspectRolePackage?.({
                  projectId: task.projectId,
                  roleKey: task.roleKey,
                  revisionId: previous.manifest.workflowDefinitionRevisionId,
                });
          const paths = new Map(
            [
              ...(previousPackage?.locked?.resources ?? []),
              ...(rolePackage.locked?.resources ?? []),
            ].map((resource) => [resource.refId, resource.path]),
          );
          rolePackage.comparison = compareRoleResources(
            previous.manifest.resources,
            resolved.manifest.resources,
            paths,
          );
        }
        comparison = {
          status:
            difference.changes.length || difference.metadataChanges.length ? 'CHANGED' : 'CURRENT',
          ...difference,
        };
      } catch (error) {
        if (!(error instanceof WorkmeshError) || ![403, 404].includes(error.status)) throw error;
        comparison = { status: 'UNAVAILABLE', changes: [], metadataChanges: [] };
      }
    }
    for (const ref of resources) {
      if (ref.contentStatus === 'VERIFIED') continue;
      const external = ref.contentStatus === 'EXTERNAL_REFERENCE';
      const unverified = ref.contentStatus === 'UNVERIFIED';
      issues.push({
        kind:
          ref.kind === 'ARTIFACT'
            ? 'ARTIFACT'
            : ref.kind === 'ROLE_RESOURCE'
              ? 'ROLE_RESOURCE'
              : ref.refId === 'prd'
                ? 'PRD'
                : ref.refId === 'understanding'
                  ? 'UNDERSTANDING'
                  : 'KNOWLEDGE',
        reason: external ? 'EXTERNAL_REFERENCE' : unverified ? 'UNVERIFIED' : 'CONTENT_UNAVAILABLE',
        required: resolved.requiredByRef.get(ref.refId) ?? true,
        blocking: !unverified && (!external || resolved.requiredByRef.get(ref.refId) === true),
        refId: ref.refId,
        ...(ref.kind === 'DOCUMENT_REVISION' ? { revisionId: ref.targetId } : {}),
        action: external
          ? 'PROVIDE_HOSTED_INPUT'
          : unverified
            ? 'VERIFY_LOCALLY'
            : 'RESTORE_CONTENT',
        responsible: external ? 'UPSTREAM_OWNER' : unverified ? 'LOCAL_AGENT' : 'PROJECT_ADMIN',
      });
    }
    const availability =
      resolved.issueCode || resources.some((ref) => ref.contentStatus === 'UNAVAILABLE')
        ? 'UNAVAILABLE'
        : resources.some((ref) => ref.contentStatus !== 'VERIFIED')
          ? 'REQUIRES_LOCAL_CHECK'
          : 'VERIFIED';
    await this.authorization.resolveProjectContext(principal, task.projectId, 'read');
    await this.authorization.requireScope(principal, task.projectId, CONTEXT_READ);
    for (const resource of resolved.manifest.resources)
      await this.assertResourceReadable(
        principal,
        task.projectId,
        resource.kind,
        resource.targetId,
        resource.sha256,
      );
    for (const issue of issues)
      await this.assertDiagnosticReadable(principal, task.projectId, issue);
    return {
      ...base,
      availability,
      issue:
        resolved.issueCode ??
        (resources.some((ref) => ref.contentStatus === 'UNAVAILABLE')
          ? V1_ERROR_CODES.INPUT_UNAVAILABLE
          : resources.some((ref) => ref.contentStatus === 'EXTERNAL_REFERENCE')
            ? 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED'
            : null),
      issues,
      issuesComplete: true,
      ...(rolePackage ? { rolePackage } : {}),
      resources: resolved.issueCode ? [] : resources,
      comparison,
    };
  }

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
      const stored = await this.repository.findSnapshot(
        String(existing.resultRefs.snapshotId ?? ''),
      );
      if (
        !stored ||
        stored.projectId !== task.projectId ||
        stored.taskId !== task.id ||
        stored.requirementId !== task.requirementId
      )
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'SNAPSHOT_NOT_FOUND',
          undefined,
          404,
        );
      this.assertSnapshotIntegrity(stored);
      for (const resource of stored.resources)
        await this.assertResourceReadable(
          principal,
          stored.projectId,
          resource.kind,
          resource.targetId,
          resource.sha256,
        );
      const current = stored;
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

    const { manifest, manifestDigest, refs } = await this.resolveInputs(
      principal,
      task,
      request.candidateRevisionIds ?? [],
    );

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

  private async resolveInputs(
    principal: Principal,
    task: V1SnapshotTaskState,
    candidateRevisionIds: string[],
    preview = false,
  ) {
    const taskId = task.id;
    const issues: TaskInputIssue[] = [];
    let issueCode: string | null = null;
    const unavailable = async (
      error: WorkmeshError,
      issue: TaskInputIssue | (() => Promise<TaskInputIssue>),
    ) => {
      if (!preview) throw error;
      issueCode ??= error.code;
      issues.push(typeof issue === 'function' ? await issue() : issue);
    };
    const resources: V1SnapshotManifestResource[] = [];
    const requiredByRef = new Map<string, boolean>();
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
      expected: { requirementId?: string; documentId?: string; kinds?: string[] },
      required = true,
    ) => {
      const revision = await this.repository.findRevision(revisionId);
      if (!revision || revision.projectId !== task.projectId) return false;
      if (expected.documentId && revision.documentId !== expected.documentId) return false;
      if (authority === 'PUBLISHED' && !revision.isCurrentPublished) return false;
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
      requiredByRef.set(refId, required);
      refs.push({ ...resource, documentRevisionId: revision.revisionId });
      return true;
    };

    let productBaseline: Awaited<ReturnType<typeof this.buildBaseline>> = null;
    if (task.baselinePolicy === 'PUBLISHED_PRD') {
      productBaseline = await this.buildBaseline(task, principal, addDocument);
      if (!productBaseline) {
        const failure = new WorkmeshError(
          V1_ERROR_CODES.BASELINE_STALE,
          'SNAPSHOT_BASELINE_UNAVAILABLE',
          { taskId, currentPrdRevisionId: task.currentPrdRevisionId },
          409,
        );
        if (!preview) throw failure;
        for (const [refId, kind, revisionId] of [
          ['understanding', 'UNDERSTANDING', task.currentUnderstandingRevisionId],
          ['prd', 'PRD', task.currentPrdRevisionId],
        ] as const) {
          if (resources.some((ref) => ref.refId === refId)) continue;
          await unavailable(
            failure,
            revisionId
              ? await this.documentDiagnostic(
                  principal,
                  task,
                  {
                    kind,
                    reason: 'NOT_CURRENT_PUBLISHED',
                    required: true,
                    blocking: true,
                    action: 'REFRESH_BASELINE',
                    responsible: 'PRODUCT_OWNER',
                  },
                  { revisionId, requirementId: task.requirementId },
                )
              : {
                  kind,
                  reason: 'NOT_PUBLISHED',
                  required: true,
                  blocking: true,
                  action: 'PUBLISH_BASELINE',
                  responsible: 'PRODUCT_OWNER',
                },
          );
        }
        if (!issues.length)
          await unavailable(failure, {
            kind: 'PRD',
            reason: 'UNAVAILABLE_OR_UNREADABLE',
            required: true,
            blocking: true,
            action: 'CHECK_ACCESS',
            responsible: 'PROJECT_ADMIN',
          });
      }
    }

    const candidateIds = candidateRevisionIds;
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
          await unavailable(
            new WorkmeshError(
              V1_ERROR_CODES.INPUT_UNAVAILABLE,
              'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
              { inputKey: input.inputKey, documentId: input.documentId },
              422,
            ),
            () =>
              this.documentDiagnostic(
                principal,
                task,
                {
                  kind: 'KNOWLEDGE',
                  reason: 'NOT_BOUND',
                  required: true,
                  blocking: true,
                  inputKey: input.inputKey,
                  action: 'BIND_KNOWLEDGE',
                  responsible: 'KNOWLEDGE_MAINTAINER',
                },
                { documentId: input.documentId },
              ),
          );
        continue;
      }
      if (input.required !== false && !binding.required)
        bindingByDocumentId.set(input.documentId, { ...binding, required: true });
    }

    for (const binding of bindingByDocumentId.values()) {
      if (!binding.currentPublishedRevisionId) {
        if (binding.required)
          await unavailable(
            new WorkmeshError(
              V1_ERROR_CODES.INPUT_UNAVAILABLE,
              'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
              { documentId: binding.documentId },
              422,
            ),
            () =>
              this.documentDiagnostic(
                principal,
                task,
                {
                  kind: 'KNOWLEDGE',
                  reason: 'NOT_PUBLISHED',
                  required: true,
                  blocking: true,
                  action: 'PUBLISH_KNOWLEDGE',
                  responsible: 'KNOWLEDGE_MAINTAINER',
                },
                { documentId: binding.documentId },
              ),
          );
        continue;
      }
      const added = await addDocument(
        `knowledge:${binding.documentId}`,
        binding.currentPublishedRevisionId,
        'PUBLISHED',
        {
          documentId: binding.documentId,
          kinds: ['KNOWLEDGE', 'DECISION'],
        },
        binding.required,
      );
      if (!added && binding.required)
        await unavailable(
          new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            'SNAPSHOT_KNOWLEDGE_UNAVAILABLE',
            { documentId: binding.documentId },
            422,
          ),
          () =>
            this.documentDiagnostic(
              principal,
              task,
              {
                kind: 'KNOWLEDGE',
                reason: 'NOT_CURRENT_PUBLISHED',
                required: true,
                blocking: true,
                action: 'PUBLISH_KNOWLEDGE',
                responsible: 'KNOWLEDGE_MAINTAINER',
              },
              {
                documentId: binding.documentId,
                revisionId: binding.currentPublishedRevisionId ?? undefined,
              },
            ),
        );
    }

    const prerequisiteArtifacts = await this.repository.listAcceptedPrerequisiteArtifacts(task.id);
    const snapshotArtifacts = preview
      ? prerequisiteArtifacts
      : prerequisiteArtifacts.filter((artifact) => artifact.storage !== 'GIT_REF');
    const requiredUpstreamInputs = (task.upstreamInputs ?? []).filter(
      (input) => input.required !== false,
    );
    for (const input of requiredUpstreamInputs) {
      const available = snapshotArtifacts.some(
        (artifact) => artifact.sourceStepKey === input.fromStepKey && artifact.kind === input.kind,
      );
      if (!available) {
        const external = prerequisiteArtifacts.some(
          (artifact) =>
            artifact.sourceStepKey === input.fromStepKey &&
            artifact.kind === input.kind &&
            artifact.storage === 'GIT_REF',
        );
        await unavailable(
          new WorkmeshError(
            V1_ERROR_CODES.INPUT_UNAVAILABLE,
            external ? 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED' : 'SNAPSHOT_INPUT_UNAVAILABLE',
            {
              inputKey: input.inputKey,
              fromStepKey: input.fromStepKey,
              kind: input.kind,
            },
            422,
          ),
          {
            kind: 'ARTIFACT',
            reason: external ? 'EXTERNAL_REFERENCE' : 'ACCEPTED_ARTIFACT_MISSING',
            required: true,
            blocking: true,
            inputKey: input.inputKey,
            fromStepKey: input.fromStepKey,
            artifactKind: input.kind,
            action: external ? 'PROVIDE_HOSTED_INPUT' : 'DELIVER_UPSTREAM',
            responsible: 'UPSTREAM_OWNER',
          },
        );
      }
    }

    for (const artifact of snapshotArtifacts) {
      const resource: V1SnapshotManifestResource = {
        refId: `artifact:${artifact.artifactId}`,
        kind: 'ARTIFACT',
        targetId: artifact.artifactId,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
        mediaType: artifact.mediaType,
        authority: 'PUBLISHED',
      };
      await this.assertResourceReadable(
        principal,
        task.projectId,
        resource.kind,
        resource.targetId,
        resource.sha256,
      );
      resources.push(resource);
      requiredByRef.set(
        resource.refId,
        requiredUpstreamInputs.some(
          (input) => input.fromStepKey === artifact.sourceStepKey && input.kind === artifact.kind,
        ),
      );
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
      await this.assertResourceReadable(
        principal,
        task.projectId,
        resource.kind,
        resource.targetId,
        resource.sha256,
      );
      resources.push(resource);
      requiredByRef.set(resource.refId, true);
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

    return { manifest, manifestDigest, refs, issues, issueCode, requiredByRef };
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
    this.assertSnapshotIntegrity(snapshot);

    for (const resource of snapshot.resources) {
      await this.assertResourceReadable(
        principal,
        snapshot.projectId,
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
    this.assertSnapshotIntegrity(snapshot);

    const declared = snapshot.resources.find((resource) => resource.refId === refId);
    if (!declared)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_REF_NOT_FOUND',
        { snapshotId, refId },
        404,
      );
    await this.assertResourceReadable(
      principal,
      snapshot.projectId,
      declared.kind,
      declared.targetId,
      declared.sha256,
    );

    const body = await this.repository.findSnapshotResource(snapshotId, refId);
    if (
      !body ||
      body.kind !== declared.kind ||
      body.targetId !== declared.targetId ||
      body.sha256 !== declared.sha256 ||
      body.byteLength !== declared.byteLength ||
      body.mediaType !== declared.mediaType ||
      body.bodyBytes.byteLength !== declared.byteLength ||
      (await sha256Bytes(body.bodyBytes)) !== declared.sha256
    )
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

  private assertSnapshotIntegrity(snapshot: V1SnapshotView) {
    const manifest = snapshot.manifest;
    const refs = new Map(snapshot.resources.map((resource) => [resource.refId, resource]));
    if (
      !manifest ||
      manifest.projectId !== snapshot.projectId ||
      manifest.taskId !== snapshot.taskId ||
      manifest.requirementId !== snapshot.requirementId ||
      manifest.taskGeneration !== snapshot.taskGeneration ||
      manifest.requirementGeneration !== snapshot.requirementGeneration ||
      !Array.isArray(manifest.resources) ||
      refs.size !== snapshot.resources.length ||
      manifest.resources.length !== refs.size ||
      new Set(manifest.resources.map((resource) => resource.refId)).size !== refs.size ||
      manifest.resources.some((resource) => {
        const indexed = refs.get(resource.refId);
        return (
          !indexed ||
          (['kind', 'targetId', 'sha256', 'byteLength', 'mediaType', 'authority'] as const).some(
            (field) => indexed[field] !== resource[field],
          )
        );
      })
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_NOT_FOUND',
        undefined,
        404,
      );
  }

  private async buildBaseline(
    task: V1SnapshotTaskState,
    principal: Principal,
    addDocument: (
      refId: string,
      revisionId: string,
      authority: 'PUBLISHED' | 'CANDIDATE',
      expected: { requirementId?: string; documentId?: string; kinds?: string[] },
    ) => Promise<boolean>,
  ) {
    const understandingAdded = task.currentUnderstandingRevisionId
      ? await addDocument('understanding', task.currentUnderstandingRevisionId, 'PUBLISHED', {
          requirementId: task.requirementId,
          kinds: ['UNDERSTANDING'],
        })
      : false;
    const prdAdded = task.currentPrdRevisionId
      ? await addDocument('prd', task.currentPrdRevisionId, 'PUBLISHED', {
          requirementId: task.requirementId,
          kinds: ['PRD'],
        })
      : false;
    if (
      !understandingAdded ||
      !prdAdded ||
      !task.currentPrdRevisionId ||
      !task.currentUnderstandingRevisionId
    )
      return null;
    const prd = await this.repository.findRevision(task.currentPrdRevisionId);
    if (!prd) return null;
    return {
      understandingRevisionId: task.currentUnderstandingRevisionId,
      prdRevisionId: task.currentPrdRevisionId,
      prdSha256: prd.sha256,
      deliveryScopeDigest: await deliveryScopeDigestOf(task.deliveryScope),
    };
  }

  /** Only disclose identities after matching the configured input and current read scope. */
  private async documentDiagnostic(
    principal: Principal,
    task: V1SnapshotTaskState,
    issue: TaskInputIssue,
    input: { documentId?: string; revisionId?: string; requirementId?: string },
  ): Promise<TaskInputIssue> {
    const hidden: TaskInputIssue = {
      ...issue,
      reason: 'UNAVAILABLE_OR_UNREADABLE',
      action: 'CHECK_ACCESS',
      responsible: 'PROJECT_ADMIN',
    };
    const revision = input.revisionId ? await this.repository.findRevision(input.revisionId) : null;
    if (
      input.revisionId &&
      (!revision ||
        revision.projectId !== task.projectId ||
        (input.documentId && revision.documentId !== input.documentId) ||
        (input.requirementId && revision.requirementId !== input.requirementId) ||
        !(issue.kind === 'KNOWLEDGE' ? ['KNOWLEDGE', 'DECISION'] : [issue.kind]).includes(
          revision.documentKind,
        ))
    )
      return hidden;
    const document =
      revision ??
      (input.documentId ? await this.repository.findInputDocument?.(input.documentId) : null);
    if (
      !document ||
      document.projectId !== task.projectId ||
      !(issue.kind === 'KNOWLEDGE' ? ['KNOWLEDGE', 'DECISION'] : [issue.kind]).includes(
        document.documentKind,
      )
    )
      return hidden;
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
    );
    if (!access.canRead) return hidden;
    return {
      ...issue,
      documentId: document.documentId,
      ...(revision ? { revisionId: revision.revisionId } : {}),
    };
  }

  private async assertDiagnosticReadable(
    principal: Principal,
    projectId: string,
    issue: TaskInputIssue,
  ) {
    if (issue.revisionId) {
      const revision = await this.repository.findRevision(issue.revisionId);
      if (revision) {
        await this.assertResourceReadable(
          principal,
          projectId,
          'DOCUMENT_REVISION',
          revision.revisionId,
          revision.sha256,
        );
        return;
      }
    } else if (issue.documentId) {
      const document = await this.repository.findInputDocument?.(issue.documentId);
      if (
        document?.projectId === projectId &&
        (await this.authorization.resolveKnowledgeAccess(principal, document.knowledgeBaseId))
          .canRead
      )
        return;
    } else return;
    throw new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'SNAPSHOT_REF_UNREADABLE',
      undefined,
      404,
    );
  }

  private async assertResourceReadable(
    principal: Principal,
    projectId: string,
    kind: 'DOCUMENT_REVISION' | 'ARTIFACT' | 'ROLE_RESOURCE',
    targetId: string,
    sha256: string,
  ): Promise<void> {
    if (kind === 'DOCUMENT_REVISION') {
      const revision = await this.repository.findRevision(targetId);
      if (!revision || revision.projectId !== projectId || revision.sha256 !== sha256)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'SNAPSHOT_REF_UNREADABLE',
          undefined,
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
          undefined,
          404,
        );
      return;
    }
    const scope = await this.repository.findResourceScope(kind, targetId);
    if (
      !scope ||
      scope.sha256 !== sha256 ||
      (scope.projectId !== projectId && !(kind === 'ROLE_RESOURCE' && scope.projectId === null))
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'SNAPSHOT_REF_UNREADABLE',
        undefined,
        404,
      );
  }
}
