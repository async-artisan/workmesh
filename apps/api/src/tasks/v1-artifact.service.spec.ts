import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, sha256Bytes } from '@workmesh/shared';
import {
  V1ArtifactService,
  type V1DeliverBody,
  type V1DeliverContext,
  type V1RawDeliverItem,
} from './v1-artifact.service';
import { mapCodeReviewEvidence } from './v1-artifact.prisma-repository';
import {
  type V1ArtifactRepository,
  type V1ArtifactBody,
  type V1ArtifactSetSnapshot,
  type V1ArtifactCheck,
  type V1CodeReviewEvidenceSnapshot,
  contentPreviewOf,
  type V1DeliverInput,
  type V1DeliverResultRow,
} from './v1-artifact.repository';
import {
  type V1TaskRepository,
  type V1TaskSnapshot,
  type V1WorkflowStepContract,
} from './v1-task.repository';
import {
  requestDigestOf,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';

const SNAPSHOT_ID = '11111111-1111-4111-8111-111111111111';
const WORKFLOW_REVISION_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_ID = '33333333-3333-4333-8333-333333333333';
const HOSTED_BYTES = Buffer.from('module.exports = 1;\n', 'utf8');
const HOSTED_BASE64 = HOSTED_BYTES.toString('base64');
const HOSTED_SHA256 = 'bf9d65b6f1a13f51ddc1cb8c2ef15c17f5b8c1cbfe6a7ff11d9ef8b7e0b7f3a1';
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function humanPrincipal(userId = 'user-1'): any {
  return { kind: 'HUMAN', userId, scopes: ['task:deliver'] };
}
function agentPrincipal(userId = 'agent-user', credentialId = 'cred-1'): any {
  return {
    kind: 'AGENT',
    userId,
    agentCredentialId: credentialId,
    projectId: 'proj-1',
    roleIds: ['role-1'],
    scopes: ['task:deliver'],
  };
}

function taskSnapshot(over: Partial<V1TaskSnapshot> = {}): V1TaskSnapshot {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    workflowInstanceId: 'wf-1',
    stepKey: 'step-1',
    roleId: 'role-1',
    responsibleUserId: 'user-1',
    version: 1,
    generation: 1,
    executionStatus: 'ACTIVE',
    workStatus: 'ACTIVE',
    currentClaim: null,
    ...over,
  };
}

function activeClaim(
  over: Partial<V1TaskSnapshot['currentClaim']> = {},
): V1TaskSnapshot['currentClaim'] {
  return {
    id: CLAIM_ID,
    taskGeneration: 1,
    principalScopeKey: 'user:user-1',
    releasedAt: null,
    userId: 'user-1',
    ...over,
  };
}

function hostedItem(over: Partial<V1RawDeliverItem> = {}): V1RawDeliverItem {
  return {
    kind: 'IMPL',
    schemaVersion: '1.0',
    storage: 'HOSTED',
    mediaType: 'text/plain',
    sha256: EMPTY_SHA,
    byteLength: 0,
    bodyBase64: '',
    checks: [],
    ...over,
  };
}

function deliverBody(over: Partial<V1DeliverBody> = {}): V1DeliverBody {
  return {
    expectedVersion: 1,
    claimId: CLAIM_ID,
    snapshotId: SNAPSHOT_ID,
    workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
    localRunId: 'run-1',
    candidateRevisionIds: [],
    items: [hostedItem()],
    ...over,
  };
}

function deliverContext(key = 'idem-1'): V1DeliverContext {
  return {
    idempotencyKey: key,
    method: 'POST',
    route: '/api/v1/tasks/task-1/artifact-sets',
    body: {},
    requestId: 'req-1',
    now: new Date('2026-01-01T00:00:00Z'),
    operationId: 'op-1',
    webSessionId: 'sess-1',
    userAuthVersion: 3,
  };
}

class InMemoryArtifactRepo implements V1ArtifactRepository {
  sets = new Map<string, V1ArtifactSetSnapshot>();
  evidence = new Map<string, V1CodeReviewEvidenceSnapshot[]>();
  bodies = new Map<string, V1ArtifactBody>();
  deliverCalls: V1DeliverInput[] = [];
  async deliver(input: V1DeliverInput): Promise<V1DeliverResultRow> {
    this.deliverCalls.push(input);
    const id = randomUUID();
    const set: V1ArtifactSetSnapshot = {
      id,
      taskId: input.taskId,
      taskGeneration: input.expectedVersion,
      snapshotId: input.snapshotId,
      manifestDigest: 'a'.repeat(64),
      workflowDefinitionRevisionId: input.workflowDefinitionRevisionId,
      localRunId: input.localRunId,
      candidateRevisionIds: input.candidateRevisionIds,
      artifacts: input.items.map((item, index) => ({
        id: `art-${index}`,
        kind: item.kind,
        schemaVersion: item.schemaVersion,
        storage: item.storage,
        mediaType: item.mediaType,
        byteLength: item.byteLength,
        sha256: item.sha256,
        projectRepositoryId: item.projectRepositoryId,
        commitSha: item.commitSha,
        repoPath: item.repoPath,
        summary: item.summary,
        checks: item.checks,
      })),
      createdAt: input.now,
    };
    this.sets.set(id, set);
    return {
      artifactSet: set,
      task: taskSnapshot({
        generation: 2,
        version: input.expectedVersion + 1,
        currentClaim: activeClaim({ taskGeneration: 2 }),
      }),
      reviewRequestId: 'review-1',
    };
  }
  async findArtifactSet(id: string) {
    return this.sets.get(id) ?? null;
  }
  async findArtifactBody(artifactId: string) {
    return this.bodies.get(artifactId) ?? null;
  }
  async findCodeReviewEvidence(_projectId: string, artifactSetId: string) {
    return this.evidence.get(artifactSetId) ?? [];
  }
}

class InMemoryTaskRepo implements V1TaskRepository {
  task: V1TaskSnapshot | null = taskSnapshot();
  contract: V1WorkflowStepContract | null = {
    workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
    stepKey: 'step-1',
    kind: 'DELIVERY',
    outputKinds: ['IMPL'],
  };
  async findTask(_id: string) {
    return this.task as V1TaskSnapshot;
  }
  async findWorkflowStepContract() {
    return this.contract;
  }
  async claim(): Promise<V1TaskSnapshot> {
    throw new Error('not used');
  }
  async release(): Promise<V1TaskSnapshot> {
    throw new Error('not used');
  }
  async setWorkStatus(): Promise<V1TaskSnapshot> {
    throw new Error('not used');
  }
}

class InMemoryAuthz {
  scopeToDeny?: string;
  async resolveProjectContext(_p: any, projectId: string) {
    return {
      project: { id: projectId },
      roleIds: ['role-1'],
      capabilities: [],
      scopes: [],
      isOwner: true,
    };
  }
  async requireScope(_p: any, _projectId: string, scope: string) {
    if (scope === this.scopeToDeny)
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'FORBIDDEN', { scope }, 403);
  }
}

class InMemoryIdempotency implements V1IdempotencyRepository {
  op: V1OperationRecord | null = null;
  async findOperation(_q: any) {
    return this.op;
  }
}

function build(
  repo: InMemoryArtifactRepo,
  task: InMemoryTaskRepo,
  authz: InMemoryAuthz,
  idem = new InMemoryIdempotency(),
) {
  const service = new V1ArtifactService(repo as any, task as any, authz as any, idem as any);
  return { service, repo, task, authz, idem };
}

describe('V1ArtifactService.getArtifactSet evidence', () => {
  it('derives required and acceptable from shared code-evidence policy', async () => {
    const repo = new InMemoryArtifactRepo();
    const set: V1ArtifactSetSnapshot = {
      id: 'set-1',
      taskId: 'task-1',
      taskGeneration: 1,
      snapshotId: SNAPSHOT_ID,
      manifestDigest: 'a'.repeat(64),
      workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
      localRunId: 'run-1',
      candidateRevisionIds: [],
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'GIT_REF',
          mediaType: 'text/x-source',
          byteLength: 0,
          sha256: EMPTY_SHA,
          projectRepositoryId: 'repo-1',
          commitSha: 'b'.repeat(40),
          repoPath: 'src/index.ts',
          summary: 'implementation',
          checks: [],
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    repo.sets.set(set.id, set);
    repo.evidence.set(set.id, [
      {
        id: 'evidence-1',
        repositoryId: 'repo-external',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        adapter: 'github',
        changeRequestId: 'PR-1',
        headSha: 'b'.repeat(40),
        commitSha: 'b'.repeat(40),
        authorExternalId: 'author',
        reviewerExternalId: 'reviewer',
        reviewerKind: 'USER',
        state: 'APPROVED',
        submittedAt: '2026-01-01T01:00:00.000Z',
      },
    ]);
    const { service } = build(repo, new InMemoryTaskRepo(), new InMemoryAuthz());

    await expect(service.getArtifactSet(humanPrincipal(), set.id)).resolves.toMatchObject({
      codeReview: { required: true, acceptable: true, evidence: [{ changeRequestId: 'PR-1' }] },
    });
  });

  it('does not require code evidence for hosted-only artifacts', async () => {
    const repo = new InMemoryArtifactRepo();
    const set: V1ArtifactSetSnapshot = {
      id: 'set-hosted',
      taskId: 'task-1',
      taskGeneration: 1,
      snapshotId: SNAPSHOT_ID,
      manifestDigest: 'a'.repeat(64),
      workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
      localRunId: 'run-1',
      candidateRevisionIds: [],
      artifacts: [
        {
          id: 'artifact-1',
          kind: 'CASES',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/plain',
          byteLength: 3,
          sha256: EMPTY_SHA,
          projectRepositoryId: null,
          commitSha: null,
          repoPath: null,
          summary: null,
          checks: [],
        },
      ],
      createdAt: new Date(),
    };
    repo.sets.set(set.id, set);
    const { service } = build(repo, new InMemoryTaskRepo(), new InMemoryAuthz());
    await expect(service.getArtifactSet(humanPrincipal(), set.id)).resolves.toMatchObject({
      codeReview: { required: false, acceptable: true, evidence: [] },
    });
  });
});

describe('mapCodeReviewEvidence', () => {
  it('joins repository metadata by project external id and preserves unknown repos as null', () => {
    const result = mapCodeReviewEvidence(
      [
        {
          id: 'e-1',
          repositoryId: 'repo-1',
          changeRequestId: 'PR-1',
          headSha: 'a'.repeat(40),
          commitSha: 'a'.repeat(40),
          authorExternalId: 'author',
          reviewerExternalId: 'reviewer',
          reviewerKind: 'USER',
          state: 'APPROVED',
          submittedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'e-2',
          repositoryId: 'missing',
          changeRequestId: 'PR-2',
          headSha: 'b'.repeat(40),
          commitSha: null,
          authorExternalId: 'author',
          reviewerExternalId: 'bot',
          reviewerKind: 'BOT',
          state: 'PENDING',
          submittedAt: null,
        },
      ],
      [{ externalId: 'repo-1', owner: 'owner', name: 'service', adapter: 'github' }],
    );
    expect(result).toMatchObject([
      { repositoryOwner: 'owner', repositoryName: 'service', adapter: 'github' },
      { repositoryOwner: null, repositoryName: null, adapter: null, submittedAt: null },
    ]);
  });
});

describe('contentPreviewOf', () => {
  it('limits hosted text previews and leaves git refs unavailable', () => {
    const preview = contentPreviewOf('HOSTED', 'text/plain', Buffer.from('hello'));
    expect(preview).toEqual({ text: 'hello', truncated: false });
    expect(contentPreviewOf('GIT_REF', 'text/x-source', Buffer.from('ignored'))).toBeNull();
    const large = contentPreviewOf('HOSTED', 'text/plain', Buffer.alloc(5000, 65));
    expect(large?.text).toHaveLength(4096);
    expect(large?.truncated).toBe(true);
  });
});

describe('V1ArtifactService.deliver', () => {
  it('normalizes legacy checks as Agent-reported and keeps external references explicitly unverified', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const repo = new InMemoryArtifactRepo();
    const { service } = build(repo, task, new InMemoryAuthz());
    const checks: V1ArtifactCheck[] = [
      { code: 'self-check', passed: true },
      {
        code: 'ci-tests',
        passed: true,
        evidence: {
          kind: 'CI_RUN',
          provider: 'GitHub Actions',
          url: 'https://github.com/acme/app/actions/runs/42',
          runId: '42',
          commitSha: 'a'.repeat(40),
        },
      },
    ];
    const result = await service.deliver(
      humanPrincipal(),
      'task-1',
      deliverBody({ items: [hostedItem({ checks })] }),
      deliverContext(),
    );

    expect(repo.deliverCalls[0]?.items[0]?.checks).toEqual([
      { code: 'self-check', passed: true, source: 'AGENT_REPORTED' },
      {
        code: 'ci-tests',
        passed: true,
        source: 'EXTERNAL_REFERENCE',
        evidence: {
          kind: 'CI_RUN',
          provider: 'GitHub Actions',
          url: 'https://github.com/acme/app/actions/runs/42',
          runId: '42',
          commitSha: 'a'.repeat(40),
        },
      },
    ]);
    expect(result.artifactSet.artifacts[0]?.checks[0]?.source).toBe('AGENT_REPORTED');
    expect(result.artifactSet.artifacts[0]?.checks[1]?.source).toBe('EXTERNAL_REFERENCE');
    expect(result.artifactSet.artifacts[0]?.checks[1]?.evidence).toMatchObject({ runId: '42' });
  });

  it.each([
    {
      name: 'Agent cannot label a check verified',
      check: { code: 'tests', passed: true, verified: true },
    },
    {
      name: 'Agent cannot mark an evidence reference verified',
      check: {
        code: 'tests',
        passed: true,
        evidence: {
          kind: 'CI_RUN',
          provider: 'CI',
          url: 'https://ci.example.com/runs/1',
          verified: true,
        },
      },
    },
    {
      name: 'external references require evidence',
      check: { code: 'tests', passed: true, source: 'EXTERNAL_REFERENCE' },
    },
    {
      name: 'Agent-reported checks cannot carry external evidence',
      check: {
        code: 'tests',
        passed: true,
        source: 'AGENT_REPORTED',
        evidence: { kind: 'CI_RUN', provider: 'CI', url: 'https://ci.example.com/runs/1' },
      },
    },
    {
      name: 'evidence URLs must use HTTPS',
      check: {
        code: 'tests',
        passed: true,
        evidence: { kind: 'CI_RUN', provider: 'CI', url: 'http://ci.example.com/runs/1' },
      },
    },
    {
      name: 'CI evidence must refer to the delivered commit when one is declared',
      check: {
        code: 'tests',
        passed: true,
        evidence: {
          kind: 'CI_RUN',
          provider: 'CI',
          url: 'https://ci.example.com/runs/1',
          commitSha: 'b'.repeat(40),
        },
      },
      item: {
        storage: 'GIT_REF',
        bodyBase64: null,
        projectRepositoryId: '11111111-1111-4111-8111-111111111111',
        commitSha: 'a'.repeat(40),
        repoPath: 'src/main.ts',
      },
    },
  ] as Array<{ name: string; check: Record<string, unknown>; item?: Partial<V1RawDeliverItem> }>)(
    'rejects invalid check provenance: $name',
    async ({ check, item }) => {
      const task = new InMemoryTaskRepo();
      task.task = taskSnapshot({ currentClaim: activeClaim() });
      const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
      await expect(
        service.deliver(
          humanPrincipal(),
          'task-1',
          deliverBody({
            items: [hostedItem({ ...item, checks: [check as any] })],
          }),
          deliverContext(),
        ),
      ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.ARTIFACT_INVALID });
    },
  );

  it('rejects when task missing (404, no existence leak)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = null;
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(humanPrincipal(), 'task-1', deliverBody(), deliverContext()),
    ).rejects.toMatchObject({
      status: 404,
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  });

  it('rejects when no active claim (CLAIM_INVALID)', async () => {
    const { service } = build(
      new InMemoryArtifactRepo(),
      new InMemoryTaskRepo(),
      new InMemoryAuthz(),
    );
    await expect(
      service.deliver(humanPrincipal(), 'task-1', deliverBody(), deliverContext()),
    ).rejects.toMatchObject({
      status: 409,
      code: V1_ERROR_CODES.CLAIM_INVALID,
    });
  });

  it('rejects when claim belongs to another principal (CLAIM_INVALID)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim({ principalScopeKey: 'user:other' }) });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(humanPrincipal(), 'task-1', deliverBody(), deliverContext()),
    ).rejects.toMatchObject({
      status: 409,
      code: V1_ERROR_CODES.CLAIM_INVALID,
    });
  });

  it('rejects when AGENT lacks task:deliver scope (403)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const authz = new InMemoryAuthz();
    authz.scopeToDeny = 'task:deliver';
    const { service } = build(new InMemoryArtifactRepo(), task, authz);
    await expect(
      service.deliver(
        agentPrincipal(),
        'task-1',
        deliverBody({ claimId: CLAIM_ID }),
        deliverContext(),
      ),
    ).rejects.toMatchObject({ status: 403, code: V1_ERROR_CODES.FORBIDDEN });
  });

  it('rejects stale expectedVersion (409)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim(), version: 3 });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(
        humanPrincipal(),
        'task-1',
        deliverBody({ expectedVersion: 2 }),
        deliverContext(),
      ),
    ).rejects.toMatchObject({ status: 409, code: V1_ERROR_CODES.VERSION_CONFLICT });
  });

  it('delivers successfully and binds the referenced snapshot / workflow revision', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const repo = new InMemoryArtifactRepo();
    const { service } = build(repo, task, new InMemoryAuthz());
    const res = await service.deliver(humanPrincipal(), 'task-1', deliverBody(), deliverContext());
    expect(res.replayed).toBe(false);
    expect(res.artifactSet.snapshotId).toBe(SNAPSHOT_ID);
    expect(res.artifactSet.workflowDefinitionRevisionId).toBe(WORKFLOW_REVISION_ID);
    expect(res.artifactSet.artifacts).toHaveLength(1);
    expect(repo.deliverCalls[0].items[0].sha256).toBe(EMPTY_SHA);
    expect(repo.deliverCalls[0].subjectDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects an artifact kind that is outside the current workflow step contract', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    task.contract = {
      workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
      stepKey: 'implement',
      kind: 'DELIVERY',
      outputKinds: ['IMPL'],
    };
    task.findWorkflowStepContract = async () => task.contract;
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(
        humanPrincipal(),
        'task-1',
        deliverBody({ items: [hostedItem({ kind: 'RELEASE' })] }),
        deliverContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.ARTIFACT_INVALID });
  });

  it('rejects delivery against a stale workflow revision contract', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    task.contract = {
      workflowDefinitionRevisionId: '44444444-4444-4444-8444-444444444444',
      stepKey: 'implement',
      kind: 'DELIVERY',
      outputKinds: ['IMPL'],
    };
    task.findWorkflowStepContract = async () => task.contract;
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(humanPrincipal(), 'task-1', deliverBody(), deliverContext()),
    ).rejects.toMatchObject({ status: 409, code: V1_ERROR_CODES.BASELINE_STALE });
  });

  it('rejects HOSTED digest mismatch (422)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    const body = deliverBody({
      items: [hostedItem({ sha256: HOSTED_SHA256, byteLength: 3, bodyBase64: HOSTED_BASE64 })],
    });
    await expect(
      service.deliver(humanPrincipal(), 'task-1', body, deliverContext()),
    ).rejects.toMatchObject({
      status: 422,
      code: V1_ERROR_CODES.ARTIFACT_INVALID,
    });
  });

  it('rejects HOSTED without raw body (422)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    const body = deliverBody({ items: [hostedItem({ bodyBase64: null })] });
    await expect(
      service.deliver(humanPrincipal(), 'task-1', body, deliverContext()),
    ).rejects.toMatchObject({
      status: 422,
      code: V1_ERROR_CODES.ARTIFACT_INVALID,
    });
  });

  it('rejects GIT_REF without repository locator (422)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    const body = deliverBody({
      items: [
        hostedItem({
          storage: 'GIT_REF',
          bodyBase64: null,
          projectRepositoryId: null,
          commitSha: 'a'.repeat(40),
          repoPath: 'src/index.ts',
        }),
      ],
    });
    await expect(
      service.deliver(humanPrincipal(), 'task-1', body, deliverContext()),
    ).rejects.toMatchObject({
      status: 422,
      code: V1_ERROR_CODES.ARTIFACT_INVALID,
    });
  });

  it('rejects an empty set without candidates (422)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz());
    await expect(
      service.deliver(
        humanPrincipal(),
        'task-1',
        deliverBody({ items: [], candidateRevisionIds: [] }),
        deliverContext(),
      ),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.ARTIFACT_INVALID });
  });

  it('replays the committed operation without creating a second set', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const repo = new InMemoryArtifactRepo();
    const existing: V1OperationRecord = {
      id: 'op-old',
      projectScopeKey: 'project:proj-1',
      principalScopeKey: 'user:user-1',
      key: 'idem-1',
      method: 'POST',
      route: '/api/v1/tasks/task-1/artifact-sets',
      requestDigest: '',
      resultRefs: { artifactSetId: 'set-old', reviewRequestId: 'review-old' },
      committedAt: new Date(),
    };
    const idem = new InMemoryIdempotency();
    const body = deliverBody();
    const context = deliverContext();
    // 先执行一次以得到真实 digest 与 set。
    const first = await build(repo, task, new InMemoryAuthz()).service.deliver(
      humanPrincipal(),
      'task-1',
      body,
      context,
    );
    existing.requestDigest = requestDigestOf(context);
    existing.resultRefs.artifactSetId = first.artifactSet.id;
    idem.op = existing;
    const { service } = build(repo, task, new InMemoryAuthz(), idem);
    const replayed = await service.deliver(humanPrincipal(), 'task-1', body, context);
    expect(replayed.replayed).toBe(true);
    expect(replayed.artifactSet.id).toBe(first.artifactSet.id);
    expect(replayed.committedState).toBeNull();
    existing.resultRefs.taskVersion = first.committedState!.taskVersion;
    existing.resultRefs.taskGeneration = first.committedState!.taskGeneration;
    task.task!.version += 10;
    task.task!.generation += 2;
    const exactReplay = await service.deliver(humanPrincipal(), 'task-1', body, context);
    expect(exactReplay.task.version).toBe(task.task!.version);
    expect(exactReplay.committedState).toEqual(first.committedState);
    expect(repo.deliverCalls).toHaveLength(1);
  });

  it('rejects same key with different semantics (409 IDEMPOTENCY_CONFLICT)', async () => {
    const task = new InMemoryTaskRepo();
    task.task = taskSnapshot({ currentClaim: activeClaim() });
    const idem = new InMemoryIdempotency();
    const body = deliverBody();
    const context = deliverContext();
    const first = await build(
      new InMemoryArtifactRepo(),
      task,
      new InMemoryAuthz(),
    ).service.deliver(humanPrincipal(), 'task-1', body, context);
    idem.op = {
      id: 'op-old',
      projectScopeKey: 'project:proj-1',
      principalScopeKey: 'user:user-1',
      key: 'idem-1',
      method: 'POST',
      route: context.route,
      requestDigest: 'b'.repeat(64),
      resultRefs: { artifactSetId: first.artifactSet.id },
      committedAt: new Date(),
    };
    const { service } = build(new InMemoryArtifactRepo(), task, new InMemoryAuthz(), idem);
    await expect(service.deliver(humanPrincipal(), 'task-1', body, context)).rejects.toMatchObject({
      status: 409,
      code: V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
    });
  });
});

describe('V1ArtifactService.getArtifactContent 完整证据边界', () => {
  async function hostedSet() {
    const sha = await sha256Bytes(new Uint8Array(HOSTED_BYTES));
    const set: V1ArtifactSetSnapshot = {
      id: 'set-content',
      taskId: 'task-1',
      taskGeneration: 1,
      snapshotId: SNAPSHOT_ID,
      manifestDigest: 'a'.repeat(64),
      workflowDefinitionRevisionId: WORKFLOW_REVISION_ID,
      localRunId: 'run-1',
      candidateRevisionIds: [],
      artifacts: [
        {
          id: 'artifact-content',
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/plain',
          byteLength: HOSTED_BYTES.byteLength,
          sha256: sha,
          projectRepositoryId: null,
          commitSha: null,
          repoPath: 'src/index.ts',
          summary: 'hosted evidence',
          checks: [],
          contentPreview: contentPreviewOf('HOSTED', 'text/plain', HOSTED_BYTES),
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    return { set, sha };
  }

  it('返回真实 MIME、长度、摘要、文本和 base64，而不是截断预览', async () => {
    const repo = new InMemoryArtifactRepo();
    const { set, sha } = await hostedSet();
    repo.sets.set(set.id, set);
    repo.bodies.set('artifact-content', {
      artifactId: 'artifact-content',
      mediaType: 'text/plain',
      byteLength: HOSTED_BYTES.byteLength,
      sha256: sha,
      storage: 'HOSTED',
      bytes: HOSTED_BYTES,
    });
    const { service } = build(repo, new InMemoryTaskRepo(), new InMemoryAuthz());

    await expect(
      service.getArtifactContent(humanPrincipal(), set.id, 'artifact-content'),
    ).resolves.toEqual({
      artifactId: 'artifact-content',
      mediaType: 'text/plain',
      byteLength: HOSTED_BYTES.byteLength,
      sha256: sha,
      storage: 'HOSTED',
      text: HOSTED_BYTES.toString('utf8'),
      bodyBase64: HOSTED_BYTES.toString('base64'),
    });
  });

  it('工件的正文必须属于当前 artifact-set，不能按任意 id 越权读取', async () => {
    const repo = new InMemoryArtifactRepo();
    const { set } = await hostedSet();
    repo.sets.set(set.id, set);
    const { service } = build(repo, new InMemoryTaskRepo(), new InMemoryAuthz());

    await expect(
      service.getArtifactContent(humanPrincipal(), set.id, 'other-artifact'),
    ).rejects.toMatchObject({ status: 404, message: 'ARTIFACT_NOT_FOUND' });
  });

  it('无正文/GIT_REF/完整性不符都返回 CONTENT_UNAVAILABLE', async () => {
    const repo = new InMemoryArtifactRepo();
    const { set } = await hostedSet();
    repo.sets.set(set.id, set);
    const { service } = build(repo, new InMemoryTaskRepo(), new InMemoryAuthz());

    await expect(
      service.getArtifactContent(humanPrincipal(), set.id, 'artifact-content'),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.CONTENT_UNAVAILABLE });

    repo.bodies.set('artifact-content', {
      artifactId: 'artifact-content',
      mediaType: 'text/plain',
      byteLength: HOSTED_BYTES.byteLength,
      sha256: 'b'.repeat(64),
      storage: 'HOSTED',
      bytes: HOSTED_BYTES,
    });
    await expect(
      service.getArtifactContent(humanPrincipal(), set.id, 'artifact-content'),
    ).rejects.toMatchObject({ status: 422, code: V1_ERROR_CODES.CONTENT_UNAVAILABLE });
  });

  it('项目读权限失败时不返回正文', async () => {
    const repo = new InMemoryArtifactRepo();
    const { set } = await hostedSet();
    repo.sets.set(set.id, set);
    const authz = {
      resolveProjectContext: async () => {
        throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'FORBIDDEN', undefined, 403);
      },
    } as any;
    const { service } = build(repo, new InMemoryTaskRepo(), authz);

    await expect(
      service.getArtifactContent(humanPrincipal(), set.id, 'artifact-content'),
    ).rejects.toMatchObject({ status: 403, code: V1_ERROR_CODES.FORBIDDEN });
  });
});
