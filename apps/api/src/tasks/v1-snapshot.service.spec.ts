import { describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal, type Scope } from '@workmesh/shared';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import { V1SnapshotService, type V1SnapshotContext } from './v1-snapshot.service';
import type { V1SnapshotManifestResource } from './v1-snapshot-policy';
import {
  type V1CreateSnapshotInput,
  type V1CreateSnapshotResult,
  type V1SnapshotBindingRecord,
  type V1SnapshotDocumentRef,
  type V1SnapshotRepository,
  type V1SnapshotResourceBody,
  type V1SnapshotRoleResource,
  type V1SnapshotTaskState,
  type V1SnapshotView,
} from './v1-snapshot.repository';
import {
  requestDigestOf,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';

const SHA = 'a'.repeat(64);
const UNDERSTANDING_ID = '11111111-1111-4111-8111-111111111111';
const PRD_ID = '22222222-2222-4222-8222-222222222222';
const KNOWLEDGE_ID = '33333333-3333-4333-8333-333333333333';
const ROLE_RESOURCE_ID = '44444444-4444-4444-8444-444444444444';

function humanPrincipal(scopes: readonly Scope[] = ['context:create', 'context:read']): Principal {
  return { kind: 'HUMAN', userId: 'user-1', scopes };
}

function taskState(over: Partial<V1SnapshotTaskState> = {}): V1SnapshotTaskState {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    requirementId: 'req-1',
    requirementGeneration: 3,
    requirementVersion: 5,
    requirementPhase: 'DELIVERY',
    currentUnderstandingRevisionId: UNDERSTANDING_ID,
    currentPrdRevisionId: PRD_ID,
    deliveryScope: { participatingRoleIds: ['role-1'], requiredOutputKinds: ['IMPL'] },
    knowledgeBindingsVersion: 7,
    taskVersion: 2,
    taskGeneration: 4,
    stepKey: 'impl',
    roleId: 'role-1',
    roleKey: 'impl-role',
    responsibleUserId: 'user-1',
    baselinePolicy: 'PUBLISHED_PRD',
    workflowDefinitionRevisionId: 'wf-rev-1',
    workflowDigest: 'b'.repeat(64),
    retiredAt: null,
    currentClaim: {
      id: 'claim-1',
      taskGeneration: 4,
      principalScopeKey: 'user:user-1',
      releasedAt: null,
      userId: 'user-1',
      credentialId: null,
    },
    currentSnapshotId: null,
    ...over,
  };
}

function revision(
  revisionId: string,
  kind: V1SnapshotDocumentRef['documentKind'],
  requirementId: string | null,
): V1SnapshotDocumentRef {
  return {
    revisionId,
    documentId: `doc-${revisionId}`,
    knowledgeBaseId: 'kb-1',
    documentKind: kind,
    sha256: SHA,
    byteLength: 10,
    mediaType: 'text/markdown',
    isCurrentPublished: true,
    requirementId,
  };
}

function snapshotContext(key = 'idem-1'): V1SnapshotContext {
  return {
    idempotencyKey: key,
    method: 'POST',
    route: '/api/v1/tasks/task-1/context-snapshots',
    body: { expectedVersion: 2, claimId: 'claim-1', candidateRevisionIds: [] },
    now: new Date('2026-01-01T00:00:00Z'),
    operationId: 'op-1',
    webSessionId: 'sess-1',
    userAuthVersion: 3,
  };
}

class InMemorySnapshotRepo implements V1SnapshotRepository {
  task = taskState();
  missing = false;
  revisions = new Map<string, V1SnapshotDocumentRef>();
  candidates: V1SnapshotDocumentRef[] = [];
  bindings: V1SnapshotBindingRecord[] = [];
  roleResources: V1SnapshotRoleResource[] = [];
  snapshots = new Map<string, V1SnapshotView>();
  bodies = new Map<string, V1SnapshotResourceBody>();
  roleResourceProjectId: string | null = null;
  createCalls: V1CreateSnapshotInput[] = [];
  prerequisiteArtifacts: Array<{
    artifactId: string;
    sha256: string;
    byteLength: number;
    mediaType: string;
    sourceStepKey?: string;
    kind?: string;
  }> = [];

  async findTaskState() {
    return this.missing ? null : this.task;
  }
  async findRevision(id: string) {
    return this.revisions.get(id) ?? null;
  }
  async findCandidateRevisions() {
    return this.candidates;
  }
  async listRoleKnowledgeBindings() {
    return this.bindings;
  }
  async listAcceptedPrerequisiteArtifacts() {
    return this.prerequisiteArtifacts;
  }
  async listRolePackageResources() {
    return this.roleResources;
  }
  async findSnapshot(id: string) {
    return this.snapshots.get(id) ?? null;
  }
  async findSnapshotResource(snapshotId: string, refId: string) {
    return this.bodies.get(`${snapshotId}/${refId}`) ?? null;
  }
  async findRoleResourceProjectId() {
    return this.roleResourceProjectId;
  }
  async createSnapshot(input: V1CreateSnapshotInput): Promise<V1CreateSnapshotResult> {
    this.createCalls.push(input);
    const view: V1SnapshotView = {
      id: input.snapshotId,
      projectId: input.projectId,
      requirementId: input.requirementId,
      taskId: input.taskId,
      taskGeneration: input.taskGeneration,
      requirementGeneration: input.requirementGeneration,
      manifest: input.manifest,
      manifestDigest: input.manifestDigest,
      createdAt: input.now,
      resources: input.manifest.resources,
    };
    this.snapshots.set(view.id, view);
    return { snapshot: view, taskVersion: input.expectedTaskVersion + 1 };
  }
}

class InMemoryAuthz {
  unreadableKnowledgeBaseIds: string[] = [];
  scopeToDeny?: string;
  async resolveProjectContext(_p: Principal, projectId: string) {
    return {
      project: { id: projectId },
      roleIds: ['role-1'],
      capabilities: [],
      scopes: [],
      isOwner: true,
    };
  }
  async requireScope(_p: Principal, _projectId: string, scope: string) {
    if (scope === this.scopeToDeny)
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'FORBIDDEN', { scope }, 403);
  }
  async resolveKnowledgeAccess(_p: Principal, knowledgeBaseId: string) {
    return { canRead: !this.unreadableKnowledgeBaseIds.includes(knowledgeBaseId) };
  }
}

class InMemoryIdempotency implements V1IdempotencyRepository {
  op: V1OperationRecord | null = null;
  async findOperation() {
    return this.op;
  }
}

function build(
  repo: InMemorySnapshotRepo,
  authz = new InMemoryAuthz(),
  idem = new InMemoryIdempotency(),
) {
  const service = new V1SnapshotService(repo, authz as unknown as V1AuthorizationService, idem);
  return { service, repo, authz, idem };
}

function seedBaseline(repo: InMemorySnapshotRepo) {
  repo.revisions.set(UNDERSTANDING_ID, revision(UNDERSTANDING_ID, 'UNDERSTANDING', 'req-1'));
  repo.revisions.set(PRD_ID, revision(PRD_ID, 'PRD', 'req-1'));
}

describe('V1SnapshotService.create', () => {
  it('404 when task missing', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.missing = true;
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 404, code: V1_ERROR_CODES.RESOURCE_NOT_FOUND });
  });

  it('rejects without an active claim (409)', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.currentClaim = null;
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 409, code: V1_ERROR_CODES.CLAIM_INVALID });
  });

  it('rejects stale task version (409)', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 1, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 409, code: V1_ERROR_CODES.VERSION_CONFLICT });
  });

  it('rejects missing PRD baseline for PUBLISHED_PRD steps (409)', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.task.currentPrdRevisionId = null;
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 409, code: V1_ERROR_CODES.BASELINE_STALE });
  });

  it('rejects candidates that are not readable (422 INPUT_UNAVAILABLE)', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.task.baselinePolicy = 'NONE';
    repo.task.currentPrdRevisionId = null;
    repo.candidates = [revision('cand-1', 'PRD', 'req-1')];
    repo.revisions.set('cand-1', repo.candidates[0]);
    const authz = new InMemoryAuthz();
    authz.unreadableKnowledgeBaseIds = ['kb-1'];
    const { service } = build(repo, authz);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1', candidateRevisionIds: ['cand-1'] },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.INPUT_UNAVAILABLE });
  });

  it('rejects required knowledge without a published revision (422)', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.bindings = [
      {
        bindingId: 'binding-1',
        documentId: 'doc-knowledge',
        knowledgeBaseId: 'kb-1',
        roleId: 'role-1',
        required: false,
        currentPublishedRevisionId: null,
      },
      {
        bindingId: 'binding-2',
        documentId: 'doc-knowledge',
        knowledgeBaseId: 'kb-1',
        roleId: null,
        required: true,
        currentPublishedRevisionId: null,
      },
    ];
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.INPUT_UNAVAILABLE });
  });

  it('rejects a compiled published-knowledge input whose document is not role-bound', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.knowledgeInputs = [
      { inputKey: 'contract', documentId: 'doc-required', required: true },
    ];
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.INPUT_UNAVAILABLE });
  });

  it('keeps all role-bound knowledge while adding the exact compiled input', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.knowledgeInputs = [
      { inputKey: 'contract', documentId: 'doc-contract', required: true },
    ];
    repo.bindings = [
      {
        bindingId: 'binding-contract',
        documentId: 'doc-contract',
        knowledgeBaseId: 'kb-1',
        roleId: 'role-1',
        required: false,
        currentPublishedRevisionId: 'rev-contract',
      },
      {
        bindingId: 'binding-policy',
        documentId: 'doc-policy',
        knowledgeBaseId: 'kb-1',
        roleId: null,
        required: true,
        currentPublishedRevisionId: 'rev-policy',
      },
    ];
    repo.revisions.set('rev-contract', revision('rev-contract', 'KNOWLEDGE', null));
    repo.revisions.set('rev-policy', revision('rev-policy', 'DECISION', null));
    const { service } = build(repo);

    const result = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );

    expect(result.snapshot.manifest.resources.map((resource) => resource.refId)).toEqual(
      expect.arrayContaining(['knowledge:doc-contract', 'knowledge:doc-policy']),
    );
  });

  it('rejects a required upstream artifact input when no accepted matching artifact is available', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.upstreamInputs = [
      { inputKey: 'prd', fromStepKey: 'prd', kind: 'PRD', required: true },
    ];
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.INPUT_UNAVAILABLE });
  });

  it('adds a matching accepted upstream artifact to the snapshot', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.upstreamInputs = [
      { inputKey: 'prd', fromStepKey: 'prd', kind: 'PRD', required: true },
    ];
    repo.prerequisiteArtifacts = [
      {
        artifactId: 'artifact-prd',
        sha256: SHA,
        byteLength: 4,
        mediaType: 'text/markdown',
        sourceStepKey: 'prd',
        kind: 'PRD',
      },
    ];
    const { service } = build(repo);
    const result = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );
    expect(result.snapshot.manifest.resources).toContainEqual(
      expect.objectContaining({ refId: 'artifact:artifact-prd', kind: 'ARTIFACT' }),
    );
  });

  it('accepts a matching artifact from a non-direct ancestor declared by inputSources', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.upstreamInputs = [
      { inputKey: 'prd', fromStepKey: 'define', kind: 'PRD', required: true },
    ];
    repo.prerequisiteArtifacts = [
      {
        artifactId: 'artifact-define',
        sha256: SHA,
        byteLength: 4,
        mediaType: 'text/markdown',
        sourceStepKey: 'define',
        kind: 'PRD',
      },
    ];
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).resolves.toMatchObject({ snapshot: { manifest: { resources: expect.any(Array) } } });
  });

  it('rejects an upstream artifact whose kind does not match the declared input', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.upstreamInputs = [
      { inputKey: 'prd', fromStepKey: 'prd', kind: 'PRD', required: true },
    ];
    repo.prerequisiteArtifacts = [
      {
        artifactId: 'artifact-design',
        sha256: SHA,
        byteLength: 4,
        mediaType: 'text/markdown',
        sourceStepKey: 'prd',
        kind: 'DESIGN',
      },
    ];
    const { service } = build(repo);
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.INPUT_UNAVAILABLE });
  });

  it('builds a deterministic, refId-sorted manifest and digest', async () => {
    const buildWithOrder = async (reverse: boolean) => {
      const repo = new InMemorySnapshotRepo();
      seedBaseline(repo);
      repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null));
      repo.bindings = [
        {
          bindingId: 'binding-1',
          documentId: 'doc-knowledge',
          knowledgeBaseId: 'kb-1',
          roleId: 'role-1',
          required: true,
          currentPublishedRevisionId: KNOWLEDGE_ID,
        },
      ];
      const resources: V1SnapshotRoleResource[] = [
        {
          rolePackageResourceId: ROLE_RESOURCE_ID,
          refKey: 'z-last.md',
          sha256: SHA,
          byteLength: 1,
          mediaType: 'text/markdown',
        },
        {
          rolePackageResourceId: 'rr-2',
          refKey: 'a-first.md',
          sha256: SHA,
          byteLength: 1,
          mediaType: 'text/markdown',
        },
      ];
      repo.roleResources = reverse ? [...resources].reverse() : resources;
      const { service } = build(repo);
      return service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      );
    };

    const first = await buildWithOrder(false);
    const second = await buildWithOrder(true);
    expect(first.snapshot.manifestDigest).toBe(second.snapshot.manifestDigest);
    const refIds = first.snapshot.manifest.resources.map((resource) => resource.refId);
    expect(refIds).toEqual([...refIds].sort());
    // refId 字典序：knowledge < prd < role:* < understanding。
    expect(refIds).toEqual([
      'knowledge:doc-knowledge',
      'prd',
      'role:a-first.md',
      'role:z-last.md',
      'understanding',
    ]);
    expect(first.snapshot.manifest.knowledgeBindingsVersion).toBe(7);
    // 相同输入、不同输入顺序必须产生逐字节相同的 manifest 与 digest。
    expect(first.snapshot.manifest.resources).toEqual(second.snapshot.manifest.resources);
  });

  it('replays a committed operation before version CAS', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const body = snapshotContext();
    const first = await build(repo).service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      body,
    );
    const idem = new InMemoryIdempotency();
    idem.op = {
      id: 'op-old',
      projectScopeKey: 'project:proj-1',
      principalScopeKey: 'user:user-1',
      key: 'idem-1',
      method: body.method,
      route: body.route,
      requestDigest: requestDigestOf(body),
      resultRefs: { snapshotId: first.snapshot.id, taskVersion: first.taskVersion },
      committedAt: new Date(),
    };
    repo.task.taskVersion = 9;
    const replayed = await build(repo, new InMemoryAuthz(), idem).service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      body,
    );
    expect(replayed.replayed).toBe(true);
    expect(replayed.snapshot.id).toBe(first.snapshot.id);
  });

  it('rejects AGENT without context:create (403)', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const authz = new InMemoryAuthz();
    authz.scopeToDeny = 'context:create';
    const { service } = build(repo, authz);
    const agent: Principal = {
      kind: 'AGENT',
      userId: 'agent-user',
      agentCredentialId: 'cred-1',
      projectId: 'proj-1',
      roleIds: ['role-1'],
      scopes: ['context:create'],
    };
    await expect(
      service.create(
        agent,
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: V1_ERROR_CODES.FORBIDDEN,
    });
  });
});

describe('V1SnapshotService.getSnapshot / getResource', () => {
  function storedView(): V1SnapshotView {
    const resources: V1SnapshotManifestResource[] = [
      {
        refId: 'knowledge:doc-knowledge',
        kind: 'DOCUMENT_REVISION',
        targetId: KNOWLEDGE_ID,
        sha256: SHA,
        byteLength: 10,
        mediaType: 'text/markdown',
        authority: 'PUBLISHED',
      },
    ];
    return {
      id: 'snap-1',
      projectId: 'proj-1',
      requirementId: 'req-1',
      taskId: 'task-1',
      taskGeneration: 4,
      requirementGeneration: 3,
      manifest: {
        schemaVersion: '1.0',
        projectId: 'proj-1',
        requirementId: 'req-1',
        requirementGeneration: 3,
        taskId: 'task-1',
        taskGeneration: 4,
        workflowDefinitionRevisionId: 'wf-rev-1',
        workflowDigest: 'b'.repeat(64),
        knowledgeBindingsVersion: 1,
        stepKey: 'impl',
        baselinePolicy: 'PUBLISHED_PRD',
        productBaseline: null,
        resources,
      },
      manifestDigest: 'c'.repeat(64),
      createdAt: new Date(),
      resources,
    };
  }

  it('rejects whole snapshot read when a referenced document is revoked (404)', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.snapshots.set('snap-1', storedView());
    repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null));
    const authz = new InMemoryAuthz();
    authz.unreadableKnowledgeBaseIds = ['kb-1'];
    const { service } = build(repo, authz);
    await expect(service.getSnapshot(humanPrincipal(), 'snap-1')).rejects.toMatchObject({
      status: 404,
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('rejects resource read when stored body no longer matches the manifest (503)', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.snapshots.set('snap-1', storedView());
    repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null));
    repo.bodies.set('snap-1/knowledge:doc-knowledge', {
      refId: 'knowledge:doc-knowledge',
      kind: 'DOCUMENT_REVISION',
      targetId: KNOWLEDGE_ID,
      sha256: 'd'.repeat(64),
      byteLength: 11,
      mediaType: 'text/markdown',
      authority: 'PUBLISHED',
      bodyBytes: new Uint8Array([1, 2, 3]),
    });
    const { service } = build(repo);
    await expect(
      service.getResource(humanPrincipal(), 'snap-1', 'knowledge:doc-knowledge'),
    ).rejects.toMatchObject({
      status: 503,
      code: V1_ERROR_CODES.CONTENT_UNAVAILABLE,
    });
  });

  it('serves a matching resource body by refId only', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.snapshots.set('snap-1', storedView());
    repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null));
    repo.bodies.set('snap-1/knowledge:doc-knowledge', {
      refId: 'knowledge:doc-knowledge',
      kind: 'DOCUMENT_REVISION',
      targetId: KNOWLEDGE_ID,
      sha256: SHA,
      byteLength: 10,
      mediaType: 'text/markdown',
      authority: 'PUBLISHED',
      bodyBytes: new Uint8Array(10),
    });
    const { service } = build(repo);
    const body = await service.getResource(humanPrincipal(), 'snap-1', 'knowledge:doc-knowledge');
    expect(body.sha256).toBe(SHA);
    expect(body.bodyBytes).toHaveLength(10);
  });
});
