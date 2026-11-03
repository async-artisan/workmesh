import { Inject, Injectable } from '@nestjs/common';
import {
  canonicalJson,
  principalScopeKey,
  sha256Bytes,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { isCodeEvidenceAcceptable, needsCodeEvidence } from '../reviews/v1-review-policy';
import { assertClaimForAction, type Claim } from './v1-collaboration-policy';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  V1_TASK_REPOSITORY,
  type V1TaskRepository,
  type V1TaskSnapshot,
  type V1WorkflowStepContract,
} from './v1-task.repository';
import {
  V1_ARTIFACT_REPOSITORY,
  type V1ArtifactCheck,
  type V1ArtifactKind,
  type V1ArtifactRepository,
  type V1ArtifactSetSnapshot,
  type V1ArtifactStorage,
  type V1DeliverItem,
} from './v1-artifact.repository';

export type V1DeliverContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
  webSessionId: string;
  userAuthVersion: number;
};

export type V1RawDeliverItem = {
  kind: V1ArtifactKind;
  schemaVersion: string;
  storage: V1ArtifactStorage;
  mediaType: string;
  sha256: string;
  byteLength: number;
  bodyBase64?: string | null;
  projectRepositoryId?: string | null;
  commitSha?: string | null;
  repoPath?: string | null;
  summary?: string | null;
  checks: V1ArtifactCheck[];
};

export type V1DeliverBody = {
  expectedVersion: number;
  claimId: string;
  snapshotId: string;
  workflowDefinitionRevisionId: string;
  localRunId: string;
  candidateRevisionIds: string[];
  items: V1RawDeliverItem[];
};

export type V1DeliverResult = {
  artifactSet: V1ArtifactSetSnapshot;
  task: V1TaskSnapshot;
  reviewRequestId: string;
  replayed: boolean;
};

const DIGEST = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const KINDS = new Set<V1ArtifactKind>(['PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE']);

/**
 * v1 工件交付服务。交付必须引用既有上下文快照：不得在交付时临时拼造 manifest，
 * 也不得只提交摘要在服务端凭空生成正文。HOSTED 的摘要与长度由服务端按原始字节重算。
 */
@Injectable()
export class V1ArtifactService {
  constructor(
    @Inject(V1_ARTIFACT_REPOSITORY) private readonly artifacts: V1ArtifactRepository,
    @Inject(V1_TASK_REPOSITORY) private readonly tasks: V1TaskRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async getArtifactSet(principal: Principal, id: string): Promise<V1ArtifactSetSnapshot> {
    const set = await this.artifacts.findArtifactSet(id);
    if (!set)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'ARTIFACT_SET_NOT_FOUND',
        { id },
        404,
      );
    const task = await this.tasks.findTask(set.taskId);
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: set.taskId },
        404,
      );
    await this.authorization.resolveProjectContext(principal, task.projectId);
    const evidence = (await this.artifacts.findCodeReviewEvidence?.(task.projectId, set.id)) ?? [];
    const required = needsCodeEvidence(set.artifacts);
    return {
      ...set,
      codeReview: {
        required,
        acceptable: !required || isCodeEvidenceAcceptable(evidence),
        evidence,
      },
    };
  }

  async deliver(
    principal: Principal,
    taskId: string,
    body: V1DeliverBody,
    context: V1DeliverContext,
  ): Promise<V1DeliverResult> {
    const task = await this.tasks.findTask(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    const resolved = await this.authorization.resolveProjectContext(principal, task.projectId);
    await this.authorization.requireScope(principal, resolved.project.id, 'task:deliver');

    const ownerScopeKey = principalScopeKey(principal);
    const projectScopeKey = `project:${task.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    // 幂等重放：已提交则返回既有 ArtifactSet 与当前任务，不产生重复。
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
      const setId = String(existing.resultRefs.artifactSetId ?? '');
      const set = await this.artifacts.findArtifactSet(setId);
      if (!set)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'ARTIFACT_SET_NOT_FOUND',
          { id: setId },
          404,
        );
      const current = await this.tasks.findTask(taskId);
      if (!current)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'TASK_NOT_FOUND',
          { taskId },
          404,
        );
      return {
        artifactSet: set,
        task: current,
        reviewRequestId: String(existing.resultRefs.reviewRequestId ?? ''),
        replayed: true,
      };
    }

    // 前置复核：认领必须有效且代次一致；并发真实拒绝仍由仓储事务内复核保证。
    this.applyCanDeliver(task, body.claimId, ownerScopeKey);

    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1)
      throw new WorkmeshError(
        V1_ERROR_CODES.EXPECTED_VERSION_REQUIRED,
        'EXPECTED_VERSION_REQUIRED',
        { taskId },
        400,
      );
    if (task.version !== body.expectedVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        { taskId, expectedVersion: body.expectedVersion, currentVersion: task.version },
        409,
      );

    const candidateRevisionIds = this.normalizeCandidates(body.candidateRevisionIds);
    const stepContract = this.tasks.findWorkflowStepContract
      ? await this.tasks.findWorkflowStepContract(taskId)
      : null;
    if (this.tasks.findWorkflowStepContract && !stepContract)
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        'WORKFLOW_STEP_CONTRACT_MISSING',
        { taskId },
        409,
      );
    if (stepContract && stepContract.workflowDefinitionRevisionId !== body.workflowDefinitionRevisionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.BASELINE_STALE,
        'WORKFLOW_REVISION_STALE',
        { taskId, workflowDefinitionRevisionId: body.workflowDefinitionRevisionId },
        409,
      );
    const items = await this.normalizeItems(taskId, body.items, stepContract);
    if (items.length === 0 && candidateRevisionIds.length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_SET_EMPTY',
        { taskId },
        422,
      );

    const subjectDigest = await this.subjectDigestOf(body, candidateRevisionIds, items);

    const result = await this.artifacts.deliver({
      taskId,
      expectedVersion: body.expectedVersion,
      claimId: body.claimId,
      snapshotId: body.snapshotId,
      workflowDefinitionRevisionId: body.workflowDefinitionRevisionId,
      principalScopeKey: ownerScopeKey,
      localRunId: body.localRunId,
      candidateRevisionIds,
      items,
      subjectDigest,
      actorUserId: principal.userId,
      actorStamp: {
        kind: principal.kind,
        webSessionId: principal.kind === 'HUMAN' ? context.webSessionId : null,
        agentCredentialId:
          principal.kind === 'AGENT' ? (principal.agentCredentialId ?? null) : null,
        roleId: task.roleId,
        roleKeySnapshot: null,
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
    });
    return { ...result, replayed: false };
  }

  private normalizeCandidates(value: unknown): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'CANDIDATE_REVISION_IDS_INVALID',
        undefined,
        422,
      );
    const ids: string[] = [];
    for (const entry of value) {
      if (typeof entry !== 'string' || !/^[0-9a-fA-F-]{36}$/.test(entry))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'CANDIDATE_REVISION_IDS_INVALID',
          { value: entry },
          422,
        );
      const normalized = entry.toLowerCase();
      if (!ids.includes(normalized)) ids.push(normalized);
    }
    return ids;
  }

  private async normalizeItems(
    taskId: string,
    raw: unknown,
    stepContract?: V1WorkflowStepContract | null,
  ): Promise<V1DeliverItem[]> {
    if (raw === undefined) return [];
    if (!Array.isArray(raw))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEMS_INVALID',
        { taskId },
        422,
      );
    const items: V1DeliverItem[] = [];
    for (const entry of raw) {
      const item = await this.normalizeItem(taskId, entry);
      if (stepContract && !stepContract.outputKinds.includes(item.kind))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_KIND_NOT_ALLOWED_FOR_STEP',
          {
            taskId,
            stepKey: stepContract.stepKey,
            kind: item.kind,
            allowedKinds: stepContract.outputKinds,
          },
          422,
        );
      items.push(item);
    }

    const seen = new Set<string>();
    for (const item of items) {
      const key = `${item.kind}:${item.projectRepositoryId ?? ''}:${item.repoPath ?? ''}`;
      if (seen.has(key))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_ITEM_DUPLICATE',
          { taskId, kind: item.kind },
          422,
        );
      seen.add(key);
    }
    return items;
  }

  private async normalizeItem(taskId: string, value: unknown): Promise<V1DeliverItem> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId },
        422,
      );
    const item = value as Record<string, unknown>;
    if (typeof item.kind !== 'string' || !KINDS.has(item.kind as V1ArtifactKind))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId, field: 'kind' },
        422,
      );
    if (item.schemaVersion !== '1.0')
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_SCHEMA_VERSION_UNSUPPORTED',
        { taskId },
        422,
      );
    if (
      typeof item.mediaType !== 'string' ||
      item.mediaType.length === 0 ||
      item.mediaType.length > 100
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId, field: 'mediaType' },
        422,
      );
    if (typeof item.sha256 !== 'string' || !DIGEST.test(item.sha256))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId, field: 'sha256' },
        422,
      );
    if (!Number.isSafeInteger(item.byteLength) || (item.byteLength as number) < 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId, field: 'byteLength' },
        422,
      );

    const checks = this.normalizeChecks(taskId, item.checks);
    const summary =
      item.summary === undefined || item.summary === null
        ? null
        : typeof item.summary === 'string' && item.summary.length <= 2000
          ? item.summary
          : null;
    if (item.summary !== undefined && item.summary !== null && summary === null)
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_ITEM_INVALID',
        { taskId, field: 'summary' },
        422,
      );

    if (item.storage === 'HOSTED') {
      if (typeof item.bodyBase64 !== 'string' || !BASE64.test(item.bodyBase64))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_BODY_REQUIRED',
          { taskId },
          422,
        );
      if (item.projectRepositoryId != null || item.commitSha != null || item.repoPath != null)
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_STORAGE_CONFLICT',
          { taskId },
          422,
        );
      const bytes = Buffer.from(item.bodyBase64, 'base64');
      if (bytes.toString('base64') !== item.bodyBase64)
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_BODY_INVALID',
          { taskId },
          422,
        );
      const sha256 = await sha256Bytes(new Uint8Array(bytes));
      // 服务端重算，客户端声明值仅用于发现传输/截断错误。
      if (sha256 !== item.sha256 || bytes.byteLength !== item.byteLength)
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_DIGEST_MISMATCH',
          {
            taskId,
            declaredSha256: item.sha256,
            computedSha256: sha256,
            declaredByteLength: item.byteLength,
            computedByteLength: bytes.byteLength,
          },
          422,
        );
      return {
        kind: item.kind as V1ArtifactKind,
        schemaVersion: '1.0',
        storage: 'HOSTED',
        mediaType: item.mediaType,
        bodyBytes: bytes,
        sha256,
        byteLength: bytes.byteLength,
        projectRepositoryId: null,
        commitSha: null,
        repoPath: null,
        summary,
        checks,
      };
    }

    if (item.storage !== 'GIT_REF')
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_STORAGE_UNSUPPORTED',
        { taskId },
        422,
      );
    if (item.bodyBase64 !== undefined && item.bodyBase64 !== null)
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_STORAGE_CONFLICT',
        { taskId },
        422,
      );
    if (
      typeof item.projectRepositoryId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(item.projectRepositoryId)
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_REPOSITORY_REQUIRED',
        { taskId },
        422,
      );
    if (typeof item.commitSha !== 'string' || !COMMIT_SHA.test(item.commitSha))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_COMMIT_SHA_INVALID',
        { taskId },
        422,
      );
    if (
      checks.some(
        (check) => check.evidence?.commitSha && check.evidence.commitSha !== item.commitSha,
      )
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_CHECK_EVIDENCE_COMMIT_MISMATCH',
        { taskId },
        422,
      );
    if (
      typeof item.repoPath !== 'string' ||
      item.repoPath.length === 0 ||
      item.repoPath.length > 500 ||
      item.repoPath.startsWith('/') ||
      item.repoPath.includes('\\')
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_REPO_PATH_INVALID',
        { taskId },
        422,
      );

    return {
      kind: item.kind as V1ArtifactKind,
      schemaVersion: '1.0',
      storage: 'GIT_REF',
      mediaType: item.mediaType,
      bodyBytes: null,
      sha256: item.sha256,
      byteLength: item.byteLength as number,
      projectRepositoryId: item.projectRepositoryId.toLowerCase(),
      commitSha: item.commitSha,
      repoPath: item.repoPath,
      summary,
      checks,
    };
  }

  private normalizeChecks(taskId: string, value: unknown): V1ArtifactCheck[] {
    if (value === undefined) return [];
    if (!Array.isArray(value))
      throw new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_CHECKS_INVALID',
        { taskId },
        422,
      );
    return value.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index },
          422,
        );
      const check = entry as Record<string, unknown>;
      if (typeof check.code !== 'string' || check.code.length === 0 || check.code.length > 100)
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index },
          422,
        );
      if (typeof check.passed !== 'boolean')
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index },
          422,
        );
      if (
        check.message !== undefined &&
        (typeof check.message !== 'string' || check.message.length > 500)
      )
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index },
          422,
        );
      if (check.verified !== undefined)
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index, field: 'verified' },
          422,
        );

      const evidence = this.normalizeCheckEvidence(taskId, index, check.evidence);
      const source = check.source ?? (evidence ? 'EXTERNAL_REFERENCE' : 'AGENT_REPORTED');
      if (
        source !== 'AGENT_REPORTED' &&
        source !== 'EXTERNAL_REFERENCE'
      )
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index, field: 'source' },
          422,
        );
      if ((source === 'EXTERNAL_REFERENCE') !== Boolean(evidence))
        throw new WorkmeshError(
          V1_ERROR_CODES.ARTIFACT_INVALID,
          'ARTIFACT_CHECKS_INVALID',
          { taskId, index, field: 'evidence' },
          422,
        );
      return {
        code: check.code,
        passed: check.passed,
        ...(typeof check.message === 'string' ? { message: check.message } : {}),
        source,
        ...(evidence ? { evidence } : {}),
      };
    });
  }

  private normalizeCheckEvidence(
    taskId: string,
    index: number,
    value: unknown,
  ): V1ArtifactCheck['evidence'] {
    if (value === undefined) return undefined;
    const invalid = () =>
      new WorkmeshError(
        V1_ERROR_CODES.ARTIFACT_INVALID,
        'ARTIFACT_CHECKS_INVALID',
        { taskId, index, field: 'evidence' },
        422,
      );
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
    const evidence = value as Record<string, unknown>;
    if (
      evidence.verified !== undefined ||
      (evidence.kind !== 'CI_RUN' && evidence.kind !== 'TEST_REPORT') ||
      typeof evidence.provider !== 'string' ||
      evidence.provider.trim().length === 0 ||
      evidence.provider.length > 100 ||
      typeof evidence.url !== 'string' ||
      evidence.url.length > 2048
    )
      throw invalid();
    let url: URL;
    try {
      url = new URL(evidence.url);
    } catch {
      throw invalid();
    }
    if (url.protocol !== 'https:' || url.username || url.password) throw invalid();
    if (
      evidence.runId !== undefined &&
      (typeof evidence.runId !== 'string' || evidence.runId.length === 0 || evidence.runId.length > 200)
    )
      throw invalid();
    if (
      evidence.commitSha !== undefined &&
      (typeof evidence.commitSha !== 'string' || !COMMIT_SHA.test(evidence.commitSha))
    )
      throw invalid();
    return {
      kind: evidence.kind,
      provider: evidence.provider,
      url: url.toString(),
      ...(typeof evidence.runId === 'string' ? { runId: evidence.runId } : {}),
      ...(typeof evidence.commitSha === 'string' ? { commitSha: evidence.commitSha } : {}),
    };
  }

  /** 交付内容摘要：快照、工作流修订、候选与工件定位按稳定顺序规范化。 */
  private async subjectDigestOf(
    body: V1DeliverBody,
    candidateRevisionIds: string[],
    items: V1DeliverItem[],
  ): Promise<string> {
    const descriptor = {
      snapshotId: body.snapshotId,
      workflowDefinitionRevisionId: body.workflowDefinitionRevisionId,
      candidateRevisionIds: [...candidateRevisionIds].sort(),
      items: [...items]
        .map((item) => ({
          kind: item.kind,
          schemaVersion: item.schemaVersion,
          storage: item.storage,
          mediaType: item.mediaType,
          sha256: item.sha256,
          byteLength: item.byteLength,
          projectRepositoryId: item.projectRepositoryId,
          commitSha: item.commitSha,
          repoPath: item.repoPath,
          summary: item.summary,
          checks: item.checks,
        }))
        .sort((left, right) =>
          `${left.kind}:${left.sha256}:${left.projectRepositoryId ?? ''}:${left.repoPath ?? ''}` <
          `${right.kind}:${right.sha256}:${right.projectRepositoryId ?? ''}:${right.repoPath ?? ''}`
            ? -1
            : 1,
        ),
    };
    return sha256Bytes(new TextEncoder().encode(canonicalJson(descriptor)));
  }

  private applyCanDeliver(task: V1TaskSnapshot, claimId: string, ownerScopeKey: string): void {
    try {
      assertClaimForAction({
        currentGeneration: task.generation,
        currentClaim: this.toPolicyClaim(task.currentClaim),
        claimId,
        principalScopeKey: ownerScopeKey,
      });
    } catch (error) {
      if (error instanceof WorkmeshError) throw error;
      if (error instanceof Error) {
        switch (error.message) {
          case 'CLAIM_CONFLICT':
            throw new WorkmeshError(
              V1_ERROR_CODES.CLAIM_CONFLICT,
              'CLAIM_CONFLICT',
              { taskId: task.id, claimId },
              409,
            );
          case 'CLAIM_INVALID':
            throw new WorkmeshError(
              V1_ERROR_CODES.CLAIM_INVALID,
              'CLAIM_INVALID',
              { taskId: task.id, claimId },
              409,
            );
          case 'BASELINE_STALE':
            throw new WorkmeshError(
              V1_ERROR_CODES.BASELINE_STALE,
              'BASELINE_STALE',
              { taskId: task.id, claimId },
              409,
            );
          default:
            throw error;
        }
      }
      throw error;
    }
  }

  private toPolicyClaim(claim: V1TaskSnapshot['currentClaim']): Claim | null {
    if (!claim) return null;
    return {
      id: claim.id,
      taskGeneration: claim.taskGeneration,
      principalScopeKey: claim.principalScopeKey,
      releasedAt: claim.releasedAt,
    };
  }
}
