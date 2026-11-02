import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import {
  V1ArtifactService,
  type V1DeliverBody,
  type V1DeliverContext,
  type V1RawDeliverItem,
} from './v1-artifact.service';
import {
  type V1ArtifactRepository,
  type V1ArtifactSetSnapshot,
  type V1DeliverInput,
  type V1DeliverResultRow,
} from './v1-artifact.repository';
import { type V1TaskRepository, type V1TaskSnapshot } from './v1-task.repository';
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
}

class InMemoryTaskRepo implements V1TaskRepository {
  task: V1TaskSnapshot | null = taskSnapshot();
  async findTask(_id: string) {
    return this.task as V1TaskSnapshot;
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

describe('V1ArtifactService.deliver', () => {
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
