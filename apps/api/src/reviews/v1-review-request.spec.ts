import { beforeEach, describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { V1ConfirmationRepository } from '../auth/v1-confirmation';
import type { V1IdempotencyRepository, V1OperationRecord } from '../common/v1-idempotency';
import {
  decodeReviewCursor,
  documentReviewKindOf,
  encodeReviewCursor,
  reviewListWhere,
  taskAcceptanceSlotBindings,
} from './v1-review-derivation';
import type {
  V1ArtifactReviewSubject,
  V1CommitDecisionInput,
  V1CommitDecisionResult,
  V1CreateReviewRequestInput,
  V1CreateReviewRequestResult,
  V1DecisionContext,
  V1DocumentReviewSubject,
  V1ReviewListQuery,
  V1ReviewListResult,
  V1ReviewRepository,
  V1ReviewSnapshot,
  V1RevokeInput,
  V1RevokeResult,
} from './v1-review.repository';
import { V1ReviewService, type V1RequestReviewContext } from './v1-review.service';

const now = new Date('2026-11-01T00:00:00.000Z');
const DIGEST = 'b'.repeat(64);

type FakeArtifact = V1ArtifactReviewSubject & {
  stepKey: string;
  definition: unknown;
  bindings: unknown;
};

type State = {
  reviews: V1ReviewSnapshot[];
  createdAt: Record<string, Date>;
  documents: Record<string, V1DocumentReviewSubject>;
  documentSlots: Record<string, Array<{ slotKey: string; requiredUserId: string; requiredRoleId: string | null }>>;
  artifacts: Record<string, FakeArtifact>;
  operations: V1OperationRecord[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function state(): State {
  return {
    reviews: [],
    createdAt: {},
    documents: {},
    documentSlots: {},
    artifacts: {},
    operations: [],
  };
}

const alice: Principal = { kind: 'HUMAN', userId: 'alice', scopes: [] };
const bob: Principal = { kind: 'HUMAN', userId: 'bob', scopes: [] };
const agentMatchingRole: Principal = {
  kind: 'AGENT',
  userId: 'agent-user',
  agentCredentialId: 'cred-1',
  projectId: 'p1',
  roleIds: ['role-product'],
  scopes: ['review:request', 'review:read', 'knowledge:read'],
};
const agentWrongRole: Principal = {
  kind: 'AGENT',
  userId: 'agent-user',
  agentCredentialId: 'cred-1',
  projectId: 'p1',
  roleIds: ['role-qa'],
  scopes: ['review:request', 'review:read', 'knowledge:read'],
};

function authRepository(): V1AuthorizationRepository {
  const roleAssignments: Record<string, string[]> = {
    alice: ['role-product'],
    bob: ['role-qa'],
    'agent-user': ['role-product', 'role-qa'],
  };
  return {
    async findProject(projectId) {
      return { id: projectId, version: 1, archivedAt: null };
    },
    async findMember(projectId, userId) {
      return { projectId, userId, role: 'MEMBER', version: 1, revokedAt: null };
    },
    async findActiveRoleAssignments(projectId, userId) {
      return (roleAssignments[userId] ?? []).map((roleId, index) => ({
        id: `ra-${userId}-${index}`,
        projectId,
        userId,
        roleId,
        version: 1,
        revokedAt: null,
      }));
    },
    async findRoleAssignment(projectId, userId, roleId) {
      return (roleAssignments[userId] ?? []).includes(roleId)
        ? { id: `ra-${userId}-${roleId}`, projectId, userId, roleId, version: 1, revokedAt: null }
        : null;
    },
    async findKnowledgeBase(knowledgeBaseId) {
      return {
        id: knowledgeBaseId,
        projectId: 'p1',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'alice',
        publicationApproverRoleId: null,
        archivedAt: null,
      };
    },
    async findGrants() {
      return [];
    },
  };
}

/** 仓储替身：创建语义与真实仓储一致（同 subject 有 OPEN 则返回既有；写幂等操作）。 */
function reviewRepository(store: State): V1ReviewRepository {
  function newSnapshot(input: V1CreateReviewRequestInput, id: string): V1ReviewSnapshot {
    if (input.subject.kind === 'DOCUMENT_REVISION') {
      const document = store.documents[input.subject.id];
      const slots = store.documentSlots[input.subject.id] ?? [];
      const kind = documentReviewKindOf(document.documentKind);
      return {
        id,
        projectId: input.projectId,
        kind,
        status: 'OPEN',
        version: 1,
        subjectDigest: document.revisionDigest,
        documentRevisionId: document.revisionId,
        artifactSetId: null,
        taskId: input.taskId,
        slots: slots.map((slot, index) => ({
          id: `slot-${index + 1}`,
          slotKey: slot.slotKey,
          kind,
          requiredUserId: slot.requiredUserId,
          requiredRoleId: slot.requiredRoleId,
          sourceSlotBindingId: null,
        })),
        decisions: [],
        subject: {
          documentId: document.documentId,
          knowledgeBaseId: document.knowledgeBaseId,
          documentVersion: document.documentVersion,
          currentPublishedRevisionId: null,
          revisionId: document.revisionId,
          revisionDigest: document.revisionDigest,
        },
      };
    }

    const artifact = store.artifacts[input.subject.id];
    const bindings = taskAcceptanceSlotBindings(artifact.definition, artifact.bindings, artifact.stepKey, artifact.taskId);
    return {
      id,
      projectId: input.projectId,
      kind: 'TASK_ACCEPTANCE',
      status: 'OPEN',
      version: 1,
      subjectDigest: artifact.manifestDigest,
      documentRevisionId: null,
      artifactSetId: artifact.artifactSetId,
      taskId: artifact.taskId,
      slots: bindings.map((binding, index) => ({
        id: `slot-${index + 1}`,
        slotKey: binding.slotKey,
        kind: 'TASK_ACCEPTANCE',
        requiredUserId: binding.userId,
        requiredRoleId: binding.roleId,
        sourceSlotBindingId: null,
      })),
      decisions: [],
      subject: null,
    };
  }

  return {
    async findReview(reviewId) {
      const review = store.reviews.find((item) => item.id === reviewId);
      return review ? clone(review) : null;
    },
    async findDecisionContext(): Promise<V1DecisionContext | null> {
      return null;
    },
    async findDocumentReviewSubject(revisionId) {
      const document = store.documents[revisionId];
      return document ? clone(document) : null;
    },
    async findArtifactReviewSubject(artifactSetId) {
      const artifact = store.artifacts[artifactSetId];
      if (!artifact) return null;
      const { stepKey: _stepKey, definition: _definition, bindings: _bindings, ...subject } = artifact;
      return clone(subject);
    },
    async createReviewRequest(input): Promise<V1CreateReviewRequestResult> {
      const isDocument = input.subject.kind === 'DOCUMENT_REVISION';
      const existing = store.reviews.find((item) => {
        if (item.status !== 'OPEN') return false;
        return isDocument
          ? item.documentRevisionId === input.subject.id
          : item.artifactSetId === input.subject.id;
      });
      if (existing) {
        store.operations.push(operationOf(input, { reviewRequestId: existing.id, version: existing.version, created: false }));
        return { review: clone(existing), created: false };
      }

      if (isDocument ? !store.documents[input.subject.id] : !store.artifacts[input.subject.id])
        throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVIEW_SUBJECT_NOT_FOUND', undefined, 404);

      const id = `rr-${store.reviews.length + 1}`;
      const review = newSnapshot(input, id);
      store.reviews.push(review);
      store.createdAt[id] = input.operation.now;
      store.operations.push(operationOf(input, { reviewRequestId: id, version: review.version, created: true }));
      return { review: clone(review), created: true };
    },
    async listReviews(query): Promise<V1ReviewListResult> {
      const filtered = store.reviews
        .filter((review) => (query.status ? review.status === query.status : true))
        .filter((review) =>
          query.knowledgeReadAllowed ? true : review.documentRevisionId === null,
        )
        .filter((review) => {
          if (query.principalKind === 'AGENT')
            return review.slots.some(
              (slot) =>
                slot.requiredUserId === query.userId ||
                (slot.requiredRoleId !== null && slot.requiredRoleId === query.agentRoleId),
            );
          if (!query.assignedToMe) return true;
          return review.slots.some(
            (slot) =>
              slot.requiredUserId === query.userId ||
              (slot.requiredRoleId !== null && query.activeRoleIds.includes(slot.requiredRoleId)),
          );
        })
        .filter((review) => {
          if (!query.cursor) return true;
          const cursor = decodeReviewCursor(query.cursor);
          const createdAt = store.createdAt[review.id];
          return (
            createdAt.getTime() < cursor.createdAt.getTime() ||
            (createdAt.getTime() === cursor.createdAt.getTime() && review.id < cursor.id)
          );
        })
        .sort((left, right) => {
          const delta = store.createdAt[right.id].getTime() - store.createdAt[left.id].getTime();
          if (delta !== 0) return delta;
          return right.id < left.id ? -1 : 1;
        });

      const page = filtered.slice(0, query.limit);
      const hasMore = filtered.length > query.limit;
      const last = page[page.length - 1];
      return {
        items: page.map((review) => clone(review)),
        nextCursor:
          hasMore && last ? encodeReviewCursor({ createdAt: store.createdAt[last.id], id: last.id }) : null,
        hasMore,
      };
    },
    async revokeDecision(_input: V1RevokeInput): Promise<V1RevokeResult> {
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'NOT_USED', undefined, 422);
    },
    async commitDecision(_input: V1CommitDecisionInput): Promise<V1CommitDecisionResult> {
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'NOT_USED', undefined, 422);
    },
  };
}

function operationOf(input: V1CreateReviewRequestInput, resultRefs: Record<string, unknown>): V1OperationRecord {
  return {
    id: input.operation.id,
    projectScopeKey: input.operation.projectScopeKey,
    principalScopeKey: input.operation.principalScopeKey,
    key: input.operation.key,
    method: input.operation.method,
    route: input.operation.route,
    requestDigest: input.operation.requestDigest,
    resultRefs,
    committedAt: input.operation.now,
  };
}

const ROUTE = '/api/v1/review-requests';
const KEY_1 = '11111111-1111-4111-8111-111111111111';
const KEY_2 = '22222222-2222-4222-8222-222222222222';

function requestContext(overrides: Partial<V1RequestReviewContext> = {}): V1RequestReviewContext {
  return {
    idempotencyKey: KEY_1,
    method: 'POST',
    route: ROUTE,
    body: { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3, taskId: null },
    requestId: 'req-1',
    now,
    operationId: 'op-1',
    webSessionId: 'sess-1',
    userAuthVersion: 1,
    ...overrides,
  };
}

function makeReview(
  id: string,
  overrides: {
    status?: V1ReviewSnapshot['status'];
    createdAt?: Date;
    documentRevisionId?: string | null;
    artifactSetId?: string | null;
    slots?: V1ReviewSnapshot['slots'];
  } = {},
): V1ReviewSnapshot {
  return {
    id,
    projectId: 'p1',
    kind: 'TASK_ACCEPTANCE',
    status: overrides.status ?? 'OPEN',
    version: 1,
    subjectDigest: DIGEST,
    documentRevisionId: overrides.documentRevisionId ?? null,
    artifactSetId: overrides.artifactSetId ?? `set-${id}`,
    taskId: `task-${id}`,
    slots:
      overrides.slots ?? [
        {
          id: `slot-${id}`,
          slotKey: 'qa',
          kind: 'TASK_ACCEPTANCE',
          requiredUserId: 'bob',
          requiredRoleId: 'role-qa',
          sourceSlotBindingId: null,
        },
      ],
    decisions: [],
    subject: null,
  };
}

function seedReview(store: State, review: V1ReviewSnapshot, createdAt: Date): void {
  store.reviews.push(review);
  store.createdAt[review.id] = createdAt;
}

function buildService(store: State, confirmation?: V1ConfirmationRepository) {
  const idempotency: V1IdempotencyRepository = {
    async findOperation(input) {
      return (
        store.operations.find(
          (item) =>
            item.projectScopeKey === input.projectScopeKey &&
            item.principalScopeKey === input.principalScopeKey &&
            item.key === input.key,
        ) ?? null
      );
    },
  };
  return new V1ReviewService(
    reviewRepository(store),
    new V1AuthorizationService(authRepository()),
    confirmation ?? {
      async createTicket() {
        throw new Error('not used');
      },
      async findTicket() {
        return null;
      },
      async consumeTicket() {
        return { consumed: false, ticket: null };
      },
    },
    idempotency,
  );
}

function seedDocument(store: State): void {
  store.documents['rev-1'] = {
    revisionId: 'rev-1',
    projectId: 'p1',
    knowledgeBaseId: 'kb-1',
    documentId: 'doc-1',
    documentKind: 'PRD',
    documentVersion: 3,
    revisionDigest: DIGEST,
    archived: false,
  };
  store.documentSlots['rev-1'] = [{ slotKey: 'publication', requiredUserId: 'alice', requiredRoleId: null }];
}

function seedArtifact(store: State, overrides: Partial<FakeArtifact> = {}): FakeArtifact {
  const artifact: FakeArtifact = {
    artifactSetId: 'set-1',
    projectId: 'p1',
    taskId: 'task-1',
    taskVersion: 3,
    taskGeneration: 2,
    taskRoleId: 'role-product',
    responsibleUserId: 'alice',
    manifestDigest: DIGEST,
    stepKey: 'impl',
    definition: {
      steps: [{ key: 'impl', gates: [{ reviewerSlots: ['qa'] }] }],
      roleSlots: [{ key: 'qa', kind: 'TASK_ACCEPTANCE' }],
    },
    bindings: { roleSlotBindings: [{ slotKey: 'qa', roleId: 'role-qa', userId: 'bob' }] },
    ...overrides,
  };
  store.artifacts[artifact.artifactSetId] = artifact;
  return artifact;
}

describe('V1ReviewService.requestReview', () => {
  let store: State;
  let service: V1ReviewService;

  beforeEach(() => {
    store = state();
    seedDocument(store);
    service = buildService(store);
  });

  it('derives document review kind slots and digest on the server', async () => {
    const result = await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext(),
    );

    expect(result.kind).toBe('PRD_PUBLICATION');
    expect(result.status).toBe('OPEN');
    expect(result.version).toBe(1);
    expect(result.subjectDigest).toBe(DIGEST);
    expect(result.documentRevisionId).toBe('rev-1');
    expect(result.slots).toEqual([
      {
        id: 'slot-1',
        slotKey: 'publication',
        kind: 'PRD_PUBLICATION',
        requiredUserId: 'alice',
        requiredRoleId: null,
        sourceSlotBindingId: null,
      },
    ]);
    expect(result.subject).toMatchObject({ documentId: 'doc-1', revisionId: 'rev-1', documentVersion: 3 });
    expect(store.reviews).toHaveLength(1);
    expect(store.operations[0].resultRefs).toMatchObject({ reviewRequestId: result.id, version: 1, created: true });
  });

  it('maps every document kind to its distinct review kind', () => {
    expect(documentReviewKindOf('UNDERSTANDING')).toBe('UNDERSTANDING_CONFIRM');
    expect(documentReviewKindOf('PRD')).toBe('PRD_PUBLICATION');
    expect(documentReviewKindOf('KNOWLEDGE')).toBe('KNOWLEDGE_PUBLICATION');
    expect(documentReviewKindOf('DECISION')).toBe('KNOWLEDGE_PUBLICATION');
  });

  it('rejects a stale expected version without creating anything', async () => {
    await expect(
      service.requestReview(
        alice,
        { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 2 },
        requestContext({ body: { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 2, taskId: null } }),
      ),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(store.reviews).toHaveLength(0);
    expect(store.operations).toHaveLength(0);
  });

  it('returns the existing OPEN review for the same subject instead of creating a duplicate', async () => {
    const first = await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext(),
    );
    const second = await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext({ idempotencyKey: KEY_2, operationId: 'op-2' }),
    );

    expect(second.id).toBe(first.id);
    expect(store.reviews).toHaveLength(1);
    expect(store.operations).toHaveLength(2);
    expect(store.operations[1].resultRefs).toMatchObject({ reviewRequestId: first.id, created: false });
  });

  it('returns the original result for a replayed idempotency key', async () => {
    const first = await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext(),
    );
    const replay = await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext({ operationId: 'op-replay' }),
    );

    expect(replay).toEqual(first);
    expect(store.reviews).toHaveLength(1);
    expect(store.operations).toHaveLength(1);
  });

  it('conflicts when the same idempotency key carries a different subject', async () => {
    await service.requestReview(
      alice,
      { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3 },
      requestContext(),
    );
    await expect(
      service.requestReview(
        alice,
        { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3, taskId: 'task-1' },
        requestContext({ body: { subject: { kind: 'DOCUMENT_REVISION', id: 'rev-1' }, expectedVersion: 3, taskId: 'task-1' } }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('derives task acceptance slots from the published workflow bindings', async () => {
    seedArtifact(store);
    const result = await service.requestReview(
      alice,
      { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: 'task-1' },
      requestContext({
        body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: 'task-1' },
      }),
    );

    expect(result.kind).toBe('TASK_ACCEPTANCE');
    expect(result.subjectDigest).toBe(DIGEST);
    expect(result.artifactSetId).toBe('set-1');
    expect(result.taskId).toBe('task-1');
    expect(result.subject).toBeNull();
    expect(result.slots).toEqual([
      {
        id: 'slot-1',
        slotKey: 'qa',
        kind: 'TASK_ACCEPTANCE',
        requiredUserId: 'bob',
        requiredRoleId: 'role-qa',
        sourceSlotBindingId: null,
      },
    ]);
  });

  it('rejects a task subject bound to a different task id', async () => {
    seedArtifact(store);
    await expect(
      service.requestReview(
        alice,
        { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: 'task-2' },
        requestContext({
          body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: 'task-2' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422, message: 'TASK_SUBJECT_MISMATCH' });
    expect(store.reviews).toHaveLength(0);
  });

  it('rejects an Agent whose credential role does not own the task role', async () => {
    seedArtifact(store);
    await expect(
      service.requestReview(
        agentWrongRole,
        { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3 },
        requestContext({
          body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: null },
          webSessionId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'REVIEW_SUBJECT_NOT_IN_RESPONSIBILITY' });
    expect(store.reviews).toHaveLength(0);
  });

  it('rejects an Agent that lacks the review:request scope', async () => {
    seedArtifact(store);
    const agentWithoutScope: Principal = {
      kind: 'AGENT',
      userId: 'agent-user',
      agentCredentialId: 'cred-1',
      projectId: 'p1',
      roleIds: ['role-product'],
      scopes: [],
    };
    await expect(
      service.requestReview(
        agentWithoutScope,
        { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3 },
        requestContext({
          body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: null },
          webSessionId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED', status: 403 });
    expect(store.reviews).toHaveLength(0);
  });

  it('allows an Agent that owns the task role and has review:request scope', async () => {
    seedArtifact(store);
    const result = await service.requestReview(
      agentMatchingRole,
      { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3 },
      requestContext({
        body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: null },
        webSessionId: null,
      }),
    );
    expect(result.kind).toBe('TASK_ACCEPTANCE');
    expect(store.reviews).toHaveLength(1);
  });

  it('rejects a human outside the task responsibility scope', async () => {
    seedArtifact(store);
    // bob 只持有 role-qa，而任务角色是 role-product，且不是责任人。
    await expect(
      service.requestReview(
        bob,
        { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3 },
        requestContext({
          body: { subject: { kind: 'TASK_ARTIFACT_SET', id: 'set-1' }, expectedVersion: 3, taskId: null },
        }),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403, message: 'REVIEW_SUBJECT_NOT_IN_RESPONSIBILITY' });
    expect(store.reviews).toHaveLength(0);
  });
});

describe('taskAcceptanceSlotBindings', () => {
  const definition = {
    steps: [{ key: 'impl', gates: [{ reviewerSlots: ['qa', 'codeReview', 'ignored'] }] }],
    roleSlots: [
      { key: 'qa', kind: 'TASK_ACCEPTANCE' },
      { key: 'codeReview', kind: 'TASK_ACCEPTANCE' },
      { key: 'ignored', kind: 'DELIVERY' },
    ],
  };
  const bindings = {
    roleSlotBindings: [
      { slotKey: 'qa', roleId: 'role-qa', userId: 'bob' },
      { slotKey: 'codeReview', roleId: 'role-reviewer', userId: 'carol' },
    ],
  };

  it('keeps only TASK_ACCEPTANCE reviewer slots, sorted by slot key', () => {
    expect(taskAcceptanceSlotBindings(definition, bindings, 'impl', 'task-1')).toEqual([
      { slotKey: 'codeReview', roleId: 'role-reviewer', userId: 'carol' },
      { slotKey: 'qa', roleId: 'role-qa', userId: 'bob' },
    ]);
  });

  it('returns no slots for an unknown step', () => {
    expect(taskAcceptanceSlotBindings(definition, bindings, 'missing', 'task-1')).toEqual([]);
  });

  it('rejects a referenced acceptance slot without a current binding', () => {
    expect(() =>
      taskAcceptanceSlotBindings(definition, { roleSlotBindings: [{ slotKey: 'qa', roleId: 'role-qa', userId: 'bob' }] }, 'impl', 'task-1'),
    ).toThrowError(/TASK_ACCEPTANCE_BINDING_MISSING/);
  });
});

describe('V1ReviewService.listReviews', () => {
  let store: State;
  let service: V1ReviewService;

  beforeEach(() => {
    store = state();
    service = buildService(store);
    seedReview(
      store,
      makeReview('rr-1', {
        status: 'OPEN',
        slots: [
          { id: 's-1', slotKey: 'qa', kind: 'TASK_ACCEPTANCE', requiredUserId: 'alice', requiredRoleId: null, sourceSlotBindingId: null },
        ],
      }),
      new Date('2026-10-31T10:00:00.000Z'),
    );
    seedReview(
      store,
      makeReview('rr-2', {
        status: 'OPEN',
        slots: [
          { id: 's-2', slotKey: 'qa', kind: 'TASK_ACCEPTANCE', requiredUserId: 'bob', requiredRoleId: 'role-qa', sourceSlotBindingId: null },
        ],
      }),
      new Date('2026-10-31T11:00:00.000Z'),
    );
    seedReview(
      store,
      makeReview('rr-3', {
        status: 'APPROVED',
        slots: [
          { id: 's-3', slotKey: 'qa', kind: 'TASK_ACCEPTANCE', requiredUserId: 'bob', requiredRoleId: 'role-product', sourceSlotBindingId: null },
        ],
      }),
      new Date('2026-10-31T12:00:00.000Z'),
    );
  });

  it('returns only reviews assigned to me or to one of my active roles', async () => {
    const result = await service.listReviews(alice, { projectId: 'p1', assignedToMe: true });
    expect(result.items.map((item) => item.id)).toEqual(['rr-3', 'rr-1']);
    expect(result.hasMore).toBe(false);
    expect(result.nextCursor).toBeNull();
  });

  it('filters by status', async () => {
    const result = await service.listReviews(alice, { projectId: 'p1', status: 'APPROVED' });
    expect(result.items.map((item) => item.id)).toEqual(['rr-3']);
  });

  it('paginates stably with the opaque next cursor', async () => {
    const first = await service.listReviews(alice, { projectId: 'p1', limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['rr-3', 'rr-2']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listReviews(alice, { projectId: 'p1', limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items.map((item) => item.id)).toEqual(['rr-1']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('restricts an Agent to reviews bound to its credential role or user', async () => {
    const result = await service.listReviews(agentMatchingRole, { projectId: 'p1' });
    expect(result.items.map((item) => item.id)).toEqual(['rr-3']);
  });
});

describe('reviewListWhere', () => {
  const base: V1ReviewListQuery = {
    projectId: 'p1',
    userId: 'alice',
    principalKind: 'HUMAN',
    agentRoleId: null,
    activeRoleIds: ['role-product'],
    knowledgeReadAllowed: true,
    assignedToMe: false,
    status: null,
    limit: 20,
    cursor: null,
  };

  it('applies status and assignedToMe filters before pagination', () => {
    const where = reviewListWhere({ ...base, status: 'OPEN', assignedToMe: true });
    const conditions = (where.AND ?? []) as Record<string, unknown>[];
    expect(where.projectId).toBe('p1');
    expect(conditions).toContainEqual({ status: 'OPEN' });
    expect(conditions).toContainEqual({
      approvalSlots: {
        some: {
          OR: [{ requiredUserId: 'alice' }, { requiredRoleId: { in: ['role-product'] } }],
        },
      },
    });
  });

  it('restricts an Agent to its credential role or direct assignment', () => {
    const where = reviewListWhere({
      ...base,
      principalKind: 'AGENT',
      agentRoleId: 'role-product',
      knowledgeReadAllowed: true,
    });
    const conditions = (where.AND ?? []) as Record<string, unknown>[];
    expect(conditions).toContainEqual({
      approvalSlots: {
        some: { OR: [{ requiredUserId: 'alice' }, { requiredRoleId: 'role-product' }] },
      },
    });
  });

  it('hides document subjects from an Agent without knowledge:read', () => {
    const where = reviewListWhere({
      ...base,
      principalKind: 'AGENT',
      agentRoleId: 'role-product',
      knowledgeReadAllowed: false,
    });
    const conditions = (where.AND ?? []) as Record<string, unknown>[];
    expect(conditions).toContainEqual({ documentRevisionId: null });
  });

  it('round-trips the keyset cursor', () => {
    const cursor = encodeReviewCursor({ createdAt: new Date('2026-10-31T12:00:00.000Z'), id: 'rr-3' });
    expect(decodeReviewCursor(cursor)).toEqual({ createdAt: new Date('2026-10-31T12:00:00.000Z'), id: 'rr-3' });
  });

  it('rejects a malformed cursor with 422', () => {
    try {
      decodeReviewCursor('not-a-cursor');
      throw new Error('expected decodeReviewCursor to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkmeshError);
      expect(error).toMatchObject({ code: V1_ERROR_CODES.INVALID_REQUEST, status: 422 });
    }
  });
});
