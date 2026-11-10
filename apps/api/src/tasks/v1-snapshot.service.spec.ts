import { describe, expect, it, vi } from 'vitest';
import {
  sha256Bytes,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
  type Scope,
  type TaskRolePackageStatus,
} from '@workmesh/shared';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import { V1SnapshotService, type V1SnapshotContext } from './v1-snapshot.service';
import type { V1SnapshotManifestResource } from './v1-snapshot-policy';
import {
  type V1CreateSnapshotInput,
  type V1CreateSnapshotResult,
  type V1SnapshotBindingRecord,
  type V1SnapshotDocumentRef,
  type V1SnapshotInputDocument,
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
  documentId = `doc-${revisionId}`,
): V1SnapshotDocumentRef {
  return {
    projectId: 'proj-1',
    revisionId,
    documentId,
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
  async verifyResourceContent(
    _resource: V1SnapshotManifestResource,
    _projectId: string,
  ): Promise<'VERIFIED' | 'EXTERNAL_REFERENCE' | 'UNAVAILABLE'> {
    return 'VERIFIED';
  }
  task = taskState();
  missing = false;
  revisions = new Map<string, V1SnapshotDocumentRef>();
  documents = new Map<string, V1SnapshotInputDocument>();
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
    storage?: 'HOSTED' | 'GIT_REF';
  }> = [];

  async findTaskState() {
    return this.missing ? null : this.task;
  }
  async findRevision(id: string) {
    return this.revisions.get(id) ?? null;
  }
  async findInputDocument(id: string) {
    return (
      this.documents.get(id) ??
      [...this.revisions.values()].find((ref) => ref.documentId === id) ??
      null
    );
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
  async findResourceScope(kind: 'ARTIFACT' | 'ROLE_RESOURCE', targetId: string) {
    const resource =
      kind === 'ARTIFACT'
        ? this.prerequisiteArtifacts.find((item) => item.artifactId === targetId)
        : this.roleResources.find((item) => item.rolePackageResourceId === targetId);
    return resource
      ? {
          projectId: kind === 'ROLE_RESOURCE' ? this.roleResourceProjectId : 'proj-1',
          sha256: resource.sha256,
          byteLength: resource.byteLength,
          mediaType: resource.mediaType,
        }
      : null;
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

describe('read-only input inspection', () => {
  it('reports task locked role metadata and actual resource changes without mutating stored snapshots', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.roleResources = [
      {
        rolePackageResourceId: ROLE_RESOURCE_ID,
        refKey: 'sop',
        sha256: SHA,
        byteLength: 10,
        mediaType: 'text/markdown',
      },
    ];
    const metadata: TaskRolePackageStatus = {
      workflowDefinitionRevisionId: 'wf-rev-1',
      roleKey: 'impl-role',
      status: 'LOCKED',
      locked: {
        packageId: 'workmesh.role.backend',
        version: '1.2.0',
        packageDigest: 'a'.repeat(64),
        source: 'BUILTIN',
        resources: [{ refId: 'role:sop', path: 'sop.md', sha256: SHA, byteLength: 10 }],
      },
      latestAvailable: {
        packageId: 'workmesh.role.backend',
        version: '1.3.0',
        packageDigest: 'b'.repeat(64),
        source: 'PROJECT',
      },
    };
    const inspectRolePackage = vi.fn(async () => structuredClone(metadata));
    Object.assign(repo, { inspectRolePackage });
    const { service } = build(repo);
    expect((await service.inspectInputs(humanPrincipal(), 'task-1')).rolePackage).toMatchObject({
      locked: { version: '1.2.0' },
      latestAvailable: { version: '1.3.0' },
      comparison: { status: 'NO_SNAPSHOT', changes: [] },
    });
    const created = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );
    const originalManifest = JSON.stringify(created.snapshot.manifest);
    repo.task.currentSnapshotId = created.snapshot.id;
    const oldResource = { ...repo.roleResources[0] };
    repo.roleResources = [
      {
        ...oldResource,
        rolePackageResourceId: '55555555-5555-4555-8555-555555555555',
        sha256: 'c'.repeat(64),
      },
    ];
    const originalScope = repo.findResourceScope.bind(repo);
    vi.spyOn(repo, 'findResourceScope').mockImplementation(async (kind, targetId) =>
      targetId === oldResource.rolePackageResourceId
        ? { projectId: null, sha256: SHA, byteLength: 10, mediaType: 'text/markdown' }
        : originalScope(kind, targetId),
    );
    metadata.locked!.resources[0].sha256 = 'c'.repeat(64);
    const result = await service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.rolePackage?.comparison).toEqual({
      status: 'CHANGED',
      changes: [
        {
          refId: 'role:sop',
          path: 'sop.md',
          status: 'CHANGED',
          previousSha256: SHA,
          currentSha256: 'c'.repeat(64),
        },
      ],
    });
    expect(inspectRolePackage).toHaveBeenCalledWith({
      projectId: 'proj-1',
      roleKey: 'impl-role',
      revisionId: 'wf-rev-1',
    });
    expect(JSON.stringify(repo.snapshots.get(created.snapshot.id)!.manifest)).toBe(
      originalManifest,
    );
    expect(repo.createCalls).toHaveLength(1);
  });

  it('collects independent baseline, knowledge and upstream problems with precise readable identities', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.currentPrdRevisionId = null;
    repo.task.knowledgeInputs = [{ inputKey: 'contract', documentId: 'doc-contract' }];
    for (const id of ['doc-contract', 'doc-policy'])
      repo.documents.set(id, {
        documentId: id,
        projectId: 'proj-1',
        knowledgeBaseId: 'kb-1',
        documentKind: 'KNOWLEDGE',
      });
    repo.bindings = [
      {
        bindingId: 'policy',
        documentId: 'doc-policy',
        knowledgeBaseId: 'kb-1',
        roleId: null,
        required: true,
        currentPublishedRevisionId: null,
      },
    ];
    repo.task.upstreamInputs = [
      { inputKey: 'api', fromStepKey: 'backend', kind: 'API_SPEC' },
      { inputKey: 'design', fromStepKey: 'ui', kind: 'UI_SPEC' },
      { inputKey: 'optional', fromStepKey: 'optional', kind: 'IMPL', required: false },
    ];
    const result = await build(repo).service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      issue: 'BASELINE_STALE',
      issuesComplete: true,
      resources: [],
    });
    expect(result.issues).toEqual([
      expect.objectContaining({ kind: 'PRD', reason: 'NOT_PUBLISHED', action: 'PUBLISH_BASELINE' }),
      expect.objectContaining({
        kind: 'KNOWLEDGE',
        reason: 'NOT_BOUND',
        inputKey: 'contract',
        documentId: 'doc-contract',
        action: 'BIND_KNOWLEDGE',
      }),
      expect.objectContaining({
        kind: 'KNOWLEDGE',
        reason: 'NOT_PUBLISHED',
        documentId: 'doc-policy',
        action: 'PUBLISH_KNOWLEDGE',
      }),
      expect.objectContaining({
        kind: 'ARTIFACT',
        inputKey: 'api',
        fromStepKey: 'backend',
        artifactKind: 'API_SPEC',
        action: 'DELIVER_UPSTREAM',
      }),
      expect.objectContaining({
        kind: 'ARTIFACT',
        inputKey: 'design',
        fromStepKey: 'ui',
        artifactKind: 'UI_SPEC',
      }),
    ]);
    expect(repo.createCalls).toHaveLength(0);
    expect(repo.task.taskVersion).toBe(2);
    await expect(
      build(repo).service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({ code: 'BASELINE_STALE' });
    expect(repo.createCalls).toHaveLength(0);
  });

  it('identifies a readable obsolete PRD revision and distinguishes it from absent publication', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.revisions.get(PRD_ID)!.isCurrentPublished = false;
    const result = await build(repo).service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'PRD',
        reason: 'NOT_CURRENT_PUBLISHED',
        revisionId: PRD_ID,
        documentId: `doc-${PRD_ID}`,
        action: 'REFRESH_BASELINE',
      }),
    ]);
  });

  it('redacts private and foreign unpublished document identities', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.knowledgeInputs = [
      { inputKey: 'first', documentId: 'private-doc' },
      { inputKey: 'second', documentId: 'foreign-doc' },
    ];
    repo.documents.set('private-doc', {
      documentId: 'private-doc',
      projectId: 'proj-1',
      knowledgeBaseId: 'private-kb',
      documentKind: 'KNOWLEDGE',
    });
    repo.documents.set('foreign-doc', {
      documentId: 'foreign-doc',
      projectId: 'foreign-project',
      knowledgeBaseId: 'kb-1',
      documentKind: 'KNOWLEDGE',
    });
    const { service, authz } = build(repo);
    authz.unreadableKnowledgeBaseIds = ['private-kb'];
    const result = await service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.issues).toHaveLength(2);
    expect(
      result.issues!.every(
        (issue) =>
          issue.reason === 'UNAVAILABLE_OR_UNREADABLE' && !issue.documentId && !issue.revisionId,
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/private-|foreign-/);
  });

  it('reports content failure separately and preserves infrastructure failures as failed reads', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.verifyResourceContent = async (resource) =>
      resource.refId === 'prd' ? 'UNAVAILABLE' : 'VERIFIED';
    const { service } = build(repo);
    expect(await service.inspectInputs(humanPrincipal(), 'task-1')).toMatchObject({
      availability: 'UNAVAILABLE',
      issue: 'INPUT_UNAVAILABLE',
      issuesComplete: true,
      issues: [
        expect.objectContaining({
          kind: 'PRD',
          reason: 'CONTENT_UNAVAILABLE',
          revisionId: PRD_ID,
          action: 'RESTORE_CONTENT',
        }),
      ],
    });
    vi.spyOn(repo, 'listRoleKnowledgeBindings').mockRejectedValueOnce(
      new Error('database offline'),
    );
    await expect(service.inspectInputs(humanPrincipal(), 'task-1')).rejects.toThrow(
      'database offline',
    );
  });

  it('preserves optional input requirements when content diagnostics are generated', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null, 'optional-doc'));
    repo.bindings = [
      {
        bindingId: 'optional',
        documentId: 'optional-doc',
        knowledgeBaseId: 'kb-1',
        roleId: null,
        required: false,
        currentPublishedRevisionId: KNOWLEDGE_ID,
      },
    ];
    repo.verifyResourceContent = async (ref) =>
      ref.targetId === KNOWLEDGE_ID ? 'UNAVAILABLE' : 'VERIFIED';
    const result = await build(repo).service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.issues).toEqual([
      expect.objectContaining({
        kind: 'KNOWLEDGE',
        required: false,
        reason: 'CONTENT_UNAVAILABLE',
      }),
    ]);
  });

  it('rechecks permission for diagnostic-only documents after slow verification', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.documents.set('readable', {
      documentId: 'readable',
      projectId: 'proj-1',
      knowledgeBaseId: 'diagnostic-kb',
      documentKind: 'KNOWLEDGE',
    });
    repo.task.knowledgeInputs = [{ inputKey: 'contract', documentId: 'readable' }];
    const { service, authz } = build(repo);
    repo.verifyResourceContent = async () => {
      authz.unreadableKnowledgeBaseIds = ['diagnostic-kb'];
      return 'VERIFIED';
    };
    await expect(service.inspectInputs(humanPrincipal(), 'task-1')).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.createCalls).toHaveLength(0);
  });
  it('checks inputs before claim without creating or changing task state', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.currentClaim = null;
    const { service } = build(repo);
    const result = await service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.availability).toBe('VERIFIED');
    expect(result.comparison.status).toBe('NO_SNAPSHOT');
    expect(result.resources).toHaveLength(2);
    expect(repo.createCalls).toHaveLength(0);
    expect(repo.task.currentClaim).toBeNull();
  });

  it('reports unavailable required knowledge without leaking unreadable resource references', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.knowledgeInputs = [{ inputKey: 'contract', documentId: 'private-doc' }];
    const result = await build(repo).service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result).toMatchObject({
      availability: 'UNAVAILABLE',
      issue: 'INPUT_UNAVAILABLE',
      resources: [],
    });
    expect(JSON.stringify(result)).not.toContain('private-doc');
  });

  it('compares the exact current task snapshot, not a global notification version', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service } = build(repo);
    const created = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );
    repo.task.currentSnapshotId = created.snapshot.id;
    repo.task.knowledgeBindingsVersion += 1;
    expect((await service.inspectInputs(humanPrincipal(), 'task-1')).comparison.status).toBe(
      'CURRENT',
    );
    const next = revision('new-prd', 'PRD', 'req-1');
    repo.revisions.set('new-prd', next);
    repo.task.currentPrdRevisionId = 'new-prd';
    const result = await service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.comparison).toMatchObject({
      status: 'CHANGED',
      changes: [
        { refId: 'prd', status: 'CHANGED', previousTargetId: PRD_ID, currentTargetId: 'new-prd' },
      ],
    });
  });

  it('withholds comparison data after snapshot input read access is revoked', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service, authz } = build(repo);
    const created = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );
    repo.task.currentSnapshotId = created.snapshot.id;
    repo.revisions.get(PRD_ID)!.knowledgeBaseId = 'old-private';
    repo.task.currentPrdRevisionId = 'new-prd';
    repo.revisions.set('new-prd', revision('new-prd', 'PRD', 'req-1'));
    authz.unreadableKnowledgeBaseIds = ['old-private'];
    const result = await service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result.comparison).toEqual({ status: 'UNAVAILABLE', changes: [], metadataChanges: [] });
  });

  it('distinguishes external references requiring local verification from server-verified bytes', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.verifyResourceContent = async () => 'EXTERNAL_REFERENCE';
    expect((await build(repo).service.inspectInputs(humanPrincipal(), 'task-1')).availability).toBe(
      'REQUIRES_LOCAL_CHECK',
    );
  });

  it('does not interpret read permission or infrastructure failures as missing inputs', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service, authz } = build(repo);
    authz.scopeToDeny = 'context:read';
    await expect(service.inspectInputs(humanPrincipal(), 'task-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects a foreign-project knowledge binding even when the human can read both projects', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.bindings = [
      {
        bindingId: 'foreign-binding',
        documentId: 'foreign-document',
        knowledgeBaseId: 'foreign-kb',
        roleId: null,
        required: true,
        currentPublishedRevisionId: 'foreign-revision',
      },
    ];
    repo.revisions.set('foreign-revision', {
      ...revision('foreign-revision', 'KNOWLEDGE', null, 'foreign-document'),
      projectId: 'foreign-project',
      knowledgeBaseId: 'foreign-kb',
    });
    const result = await build(repo).service.inspectInputs(humanPrincipal(), 'task-1');
    expect(result).toMatchObject({ availability: 'UNAVAILABLE', resources: [] });
    expect(JSON.stringify(result)).not.toMatch(/foreign/);
  });

  it('does not label a different document as the bound knowledge document', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.bindings = [
      {
        bindingId: 'binding',
        documentId: 'expected-doc',
        knowledgeBaseId: 'kb-1',
        roleId: null,
        required: true,
        currentPublishedRevisionId: 'wrong-revision',
      },
    ];
    repo.revisions.set(
      'wrong-revision',
      revision('wrong-revision', 'KNOWLEDGE', null, 'different-doc'),
    );
    expect(await build(repo).service.inspectInputs(humanPrincipal(), 'task-1')).toMatchObject({
      availability: 'UNAVAILABLE',
      resources: [],
    });
  });

  it.each(['project', 'task', 'requirement'])(
    'withholds a current-snapshot pointer for another %s before reading its resources',
    async (subject) => {
      const repo = new InMemorySnapshotRepo();
      seedBaseline(repo);
      const { service } = build(repo);
      const created = await service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      );
      repo.task.currentSnapshotId = created.snapshot.id;
      const stored = repo.snapshots.get(created.snapshot.id)!;
      if (subject === 'project') stored.projectId = 'foreign-project';
      if (subject === 'task') stored.taskId = 'foreign-task';
      if (subject === 'requirement') stored.requirementId = 'foreign-requirement';
      const reads = vi.spyOn(service, 'getSnapshot');
      expect(await service.inspectInputs(humanPrincipal(), 'task-1')).toMatchObject({
        snapshotId: null,
        comparison: { status: 'UNAVAILABLE', changes: [], metadataChanges: [] },
      });
      expect(reads).not.toHaveBeenCalled();
    },
  );

  it('keeps an older generation of the same task comparable and reports generation changes', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service } = build(repo);
    const created = await service.create(
      humanPrincipal(),
      'task-1',
      { expectedVersion: 2, claimId: 'claim-1' },
      snapshotContext(),
    );
    repo.task.currentSnapshotId = created.snapshot.id;
    repo.task.taskGeneration += 1;
    repo.task.requirementGeneration += 1;
    expect((await service.inspectInputs(humanPrincipal(), 'task-1')).comparison).toEqual({
      status: 'CHANGED',
      changes: [],
      metadataChanges: ['requirementGeneration', 'taskGeneration'],
    });
  });

  it('distinguishes actual external upstream refs and explicitly rejects creating an unmaterializable required input', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    repo.task.upstreamInputs = [{ inputKey: 'impl', fromStepKey: 'upstream', kind: 'IMPL' }];
    repo.prerequisiteArtifacts = [
      {
        artifactId: 'git-artifact',
        sourceStepKey: 'upstream',
        kind: 'IMPL',
        storage: 'GIT_REF',
        sha256: SHA,
        byteLength: 10,
        mediaType: 'text/plain',
      },
    ];
    repo.verifyResourceContent = async (resource: V1SnapshotManifestResource) =>
      resource.kind === 'ARTIFACT' ? 'EXTERNAL_REFERENCE' : 'VERIFIED';
    const { service } = build(repo);
    expect(await service.inspectInputs(humanPrincipal(), 'task-1')).toMatchObject({
      availability: 'REQUIRES_LOCAL_CHECK',
      issue: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED',
      resources: expect.arrayContaining([
        expect.objectContaining({ targetId: 'git-artifact', contentStatus: 'EXTERNAL_REFERENCE' }),
      ]),
    });
    await expect(
      service.create(
        humanPrincipal(),
        'task-1',
        { expectedVersion: 2, claimId: 'claim-1' },
        snapshotContext(),
      ),
    ).rejects.toMatchObject({
      code: 'INPUT_UNAVAILABLE',
      message: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED',
    });
    expect(repo.createCalls).toHaveLength(0);
  });

  it('rechecks read access after slow body verification before returning any references', async () => {
    const repo = new InMemorySnapshotRepo();
    seedBaseline(repo);
    const { service, authz } = build(repo);
    repo.verifyResourceContent = async () => {
      authz.unreadableKnowledgeBaseIds = ['kb-1'];
      return 'VERIFIED';
    };
    await expect(service.inspectInputs(humanPrincipal(), 'task-1')).rejects.toMatchObject({
      status: 404,
    });
  });
});

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
    repo.revisions.set('rev-contract', revision('rev-contract', 'KNOWLEDGE', null, 'doc-contract'));
    repo.revisions.set('rev-policy', revision('rev-policy', 'DECISION', null, 'doc-policy'));
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
      repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null, 'doc-knowledge'));
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

  it('rejects a foreign-project document even when its KB is readable', async () => {
    const repo = new InMemorySnapshotRepo();
    repo.snapshots.set('snap-1', storedView());
    repo.revisions.set(KNOWLEDGE_ID, {
      ...revision(KNOWLEDGE_ID, 'KNOWLEDGE', null),
      projectId: 'another-project',
    });
    await expect(build(repo).service.getSnapshot(humanPrincipal(), 'snap-1')).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('does not expose manifest refs that differ from the indexed resources actually authorized', async () => {
    const repo = new InMemorySnapshotRepo();
    const stored = storedView();
    stored.manifest = {
      ...stored.manifest,
      resources: [{ ...stored.resources[0], targetId: 'unauthorized-manifest-only' }],
    };
    repo.snapshots.set('snap-1', stored);
    repo.revisions.set(KNOWLEDGE_ID, revision(KNOWLEDGE_ID, 'KNOWLEDGE', null));
    await expect(build(repo).service.getSnapshot(humanPrincipal(), 'snap-1')).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it('allows built-in role resources but rejects missing or foreign private role resources', async () => {
    const repo = new InMemorySnapshotRepo();
    const resource: V1SnapshotManifestResource = {
      refId: 'role:sop',
      kind: 'ROLE_RESOURCE',
      targetId: ROLE_RESOURCE_ID,
      sha256: SHA,
      byteLength: 10,
      mediaType: 'text/plain',
      authority: 'PUBLISHED',
    };
    const stored = storedView();
    stored.resources = [resource];
    stored.manifest = { ...stored.manifest, resources: [resource] };
    repo.snapshots.set('snap-1', stored);
    const { service } = build(repo);
    await expect(service.getSnapshot(humanPrincipal(), 'snap-1')).rejects.toMatchObject({
      status: 404,
    });
    repo.roleResources = [
      {
        rolePackageResourceId: ROLE_RESOURCE_ID,
        refKey: 'sop',
        sha256: SHA,
        byteLength: 10,
        mediaType: 'text/plain',
      },
    ];
    expect((await service.getSnapshot(humanPrincipal(), 'snap-1')).id).toBe('snap-1');
    repo.roleResourceProjectId = 'foreign-project';
    await expect(service.getSnapshot(humanPrincipal(), 'snap-1')).rejects.toMatchObject({
      status: 404,
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
    const bytes = new Uint8Array(10);
    const digest = await sha256Bytes(bytes);
    const stored = storedView();
    stored.resources[0].sha256 = digest;
    repo.snapshots.set('snap-1', stored);
    repo.revisions.set(KNOWLEDGE_ID, {
      ...revision(KNOWLEDGE_ID, 'KNOWLEDGE', null),
      sha256: digest,
    });
    repo.bodies.set('snap-1/knowledge:doc-knowledge', {
      refId: 'knowledge:doc-knowledge',
      kind: 'DOCUMENT_REVISION',
      targetId: KNOWLEDGE_ID,
      sha256: digest,
      byteLength: 10,
      mediaType: 'text/markdown',
      authority: 'PUBLISHED',
      bodyBytes: bytes,
    });
    const { service } = build(repo);
    const body = await service.getResource(humanPrincipal(), 'snap-1', 'knowledge:doc-knowledge');
    expect(body.sha256).toBe(digest);
    expect(body.bodyBytes).toHaveLength(10);
    repo.bodies.get('snap-1/knowledge:doc-knowledge')!.bodyBytes[0] = 1;
    await expect(
      service.getResource(humanPrincipal(), 'snap-1', 'knowledge:doc-knowledge'),
    ).rejects.toMatchObject({ status: 503, code: V1_ERROR_CODES.CONTENT_UNAVAILABLE });
  });
});
