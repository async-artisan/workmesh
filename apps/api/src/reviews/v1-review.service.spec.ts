import { beforeEach, describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import {
  actionDigestOf,
  hashTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from '../auth/v1-confirmation';
import {
  requestDigestOf,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { V1ReviewService, type V1DecideContext, type V1DecideInput } from './v1-review.service';
import type {
  V1CommitDecisionInput,
  V1CommitDecisionResult,
  V1DecisionContext,
  V1ReviewRepository,
  V1ReviewSnapshot,
  V1ReviewSubject,
  V1RevokeInput,
  V1RevokeResult,
  V1SubjectResult,
} from './v1-review.repository';

const now = new Date('2026-11-01T00:00:00.000Z');

type Doc = {
  id: string;
  projectId: string;
  knowledgeBaseId: string;
  version: number;
  currentPublishedRevisionId: string | null;
};
type Pub = { id: string; documentId: string; revisionId: string; kind: 'PUBLISH' | 'WITHDRAW' };
type Op = V1OperationRecord & { resultRefs: Record<string, unknown> };

type DecisionRecord = {
  id: string;
  approvalSlotId: string;
  decision: string;
  subjectDigest: string;
  comment?: string | null;
  createdById?: string;
  createdAt?: Date;
  revoked?: boolean;
  revocationId?: string;
};

type Store = {
  review: V1ReviewSnapshot;
  documents: Doc[];
  publications: Pub[];
  decisions: DecisionRecord[];
  operations: Op[];
  tickets: V1TicketRecord[];
  /** 快照资源引用到的任务：撤销发布基线时这些任务同样失效。 */
  snapshotTaskIds: string[];
  /** 注入故障：让事务中发布步骤抛错，用于验证回滚。 */
  failPublishWith?: string;
};

function subject(overrides: Partial<V1ReviewSubject> = {}): V1ReviewSubject {
  return {
    documentId: 'doc-1',
    knowledgeBaseId: 'kb-1',
    documentVersion: 3,
    currentPublishedRevisionId: null,
    revisionId: 'rev-1',
    revisionDigest: 'a'.repeat(64),
    ...overrides,
  };
}

function store(): Store {
  return {
    review: {
      id: 'rr-1',
      projectId: 'p-a',
      kind: 'KNOWLEDGE_PUBLICATION',
      status: 'OPEN',
      version: 3,
      subjectDigest: 'a'.repeat(64),
      documentRevisionId: 'rev-1',
      artifactSetId: null,
      taskId: null,
      slots: [
        {
          id: 'slot-1',
          slotKey: 'publication',
          kind: 'KNOWLEDGE_PUBLICATION',
          requiredRoleId: null,
          requiredUserId: 'alice',
          sourceSlotBindingId: null,
        },
        {
          id: 'slot-2',
          slotKey: 'qa',
          kind: 'KNOWLEDGE_PUBLICATION',
          requiredRoleId: 'r-qa',
          requiredUserId: 'bob',
          sourceSlotBindingId: null,
        },
      ],
      decisions: [],
      subject: subject(),
    },
    documents: [
      {
        id: 'doc-1',
        projectId: 'p-a',
        knowledgeBaseId: 'kb-1',
        version: 3,
        currentPublishedRevisionId: null,
      },
    ],
    publications: [],
    decisions: [],
    operations: [],
    tickets: [],
    snapshotTaskIds: [],
  };
}

/** 事务替身：以结构化快照实现真实回滚，用于验证“任一步失败全部回滚”的服务层顺序。 */
function reviewRepository(state: Store): V1ReviewRepository {
  const snapshot = () =>
    JSON.parse(
      JSON.stringify({
        review: state.review,
        documents: state.documents,
        publications: state.publications,
        decisions: state.decisions,
        operations: state.operations,
        tickets: state.tickets,
        snapshotTaskIds: state.snapshotTaskIds,
      }),
    );
  const restore = (snap: ReturnType<typeof snapshot>) => {
    state.review = snap.review;
    state.documents = snap.documents;
    state.publications = snap.publications;
    state.decisions = snap.decisions;
    state.operations = snap.operations;
    state.tickets = snap.tickets;
    state.snapshotTaskIds = snap.snapshotTaskIds;
  };
  return {
    async findReview(reviewId) {
      return state.review.id === reviewId ? JSON.parse(JSON.stringify(state.review)) : null;
    },
    async findDocumentReviewSubject() {
      return null;
    },
    async findArtifactReviewSubject() {
      return null;
    },
    async createReviewRequest() {
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'NOT_USED_IN_DECIDE_TESTS',
        undefined,
        422,
      );
    },
    async listReviews() {
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'NOT_USED_IN_DECIDE_TESTS',
        undefined,
        422,
      );
    },
    async findDecisionContext(decisionId) {
      const record = state.decisions.find((item) => item.id === decisionId);
      if (!record) return null;
      const slot = state.review.slots.find((item) => item.id === record.approvalSlotId);
      if (!slot) return null;
      return {
        decisionId: record.id,
        projectId: state.review.projectId,
        reviewId: state.review.id,
        reviewKind: state.review.kind,
        reviewStatus: state.review.status,
        reviewVersion: state.review.version,
        subjectDigest: record.subjectDigest,
        documentRevisionId: state.review.documentRevisionId,
        artifactSetId: state.review.artifactSetId,
        taskId: state.review.taskId,
        decision: record.decision as V1DecisionContext['decision'],
        createdById: record.createdById ?? 'alice',
        revoked: record.revoked === true,
        knowledgeBaseId: state.review.subject?.knowledgeBaseId ?? null,
        slot,
      };
    },
    async revokeDecision(input: V1RevokeInput): Promise<V1RevokeResult> {
      const snap = snapshot();
      try {
        const record = state.decisions.find((item) => item.id === input.decisionId);
        if (!record)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REVIEW_DECISION_NOT_FOUND',
            { decisionId: input.decisionId },
            404,
          );
        if (record.decision !== 'APPROVE')
          throw new WorkmeshError(
            V1_ERROR_CODES.VALIDATION_FAILED,
            'REVOCATION_NOT_APPLICABLE',
            { decisionId: input.decisionId },
            422,
          );
        if (record.revoked)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'DECISION_ALREADY_REVOKED',
            { decisionId: input.decisionId },
            409,
          );
        const wasApproved = state.review.status === 'APPROVED';
        if (state.review.status !== 'APPROVED' && state.review.status !== 'OPEN')
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_CLOSED,
            'REVIEW_CLOSED',
            { reviewId: state.review.id, status: state.review.status },
            409,
          );
        if (state.review.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            {
              reviewId: state.review.id,
              expectedVersion: input.expectedVersion,
              currentVersion: state.review.version,
            },
            409,
          );

        // 条件消费票据：只有未消费、未失效、未过期且属于本次 session 的行才可消费。
        const ticket = state.tickets.find((item) => item.id === input.ticket.id);
        const consumed =
          ticket &&
          ticket.secretHash === input.ticket.secretHash &&
          ticket.webSessionId === input.ticket.webSessionId &&
          !ticket.consumedAt &&
          !ticket.invalidatedAt &&
          ticket.expiresAt > input.now;
        if (!consumed)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );
        ticket!.consumedAt = input.now;
        ticket!.consumedOperationId = input.operationId;

        const revocationId = `revk-${state.decisions.filter((item) => item.revocationId).length + 1}`;
        record.revoked = true;
        record.revocationId = revocationId;
        state.review.status = 'INVALIDATED';
        state.review.version += 1;

        const affected = new Set<string>();
        if (state.review.taskId) affected.add(state.review.taskId);
        for (const taskId of state.snapshotTaskIds) affected.add(taskId);

        if (wasApproved && state.review.documentRevisionId) {
          const revisionId = state.review.documentRevisionId;
          const document = state.documents.find(
            (item) => item.id === state.review.subject?.documentId,
          );
          if (!document)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_NOT_FOUND,
              'DOCUMENT_NOT_FOUND',
              { documentId: state.review.subject?.documentId },
              404,
            );
          const publication = state.publications.find(
            (item) =>
              item.documentId === document.id &&
              item.revisionId === revisionId &&
              item.kind === 'PUBLISH',
          );
          if (!publication)
            throw new WorkmeshError(
              V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
              'REVIEW_PRECONDITION_FAILED',
              { reviewId: state.review.id, revisionId, condition: 'PUBLICATION_REQUIRED' },
              422,
            );
          // 仅当当前指针仍指向被撤销的修订时清空；已被新发布超过则只追加撤销，不动历史。
          if (document.currentPublishedRevisionId === revisionId) {
            document.currentPublishedRevisionId = null;
            document.version += 1;
            state.publications.push({
              id: `pub-${state.publications.length + 1}`,
              documentId: document.id,
              revisionId,
              kind: 'WITHDRAW',
            });
          }
        }

        const affectedTaskIds = [...affected].sort();
        state.operations.push({
          id: input.operationId,
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.operationKey,
          method: input.method,
          route: input.route,
          requestDigest: input.requestDigest,
          resultRefs: {
            reviewRequestId: state.review.id,
            decisionId: record.id,
            revocationId,
            reason: input.reason,
            revokedAt: input.now.toISOString(),
            affectedTaskIds,
          },
          committedAt: input.now,
        });

        return {
          revocation: {
            id: revocationId,
            decisionId: record.id,
            reason: input.reason,
            createdAt: input.now,
          },
          affectedTaskIds,
        };
      } catch (error) {
        restore(snap);
        throw error;
      }
    },
    async commitDecision(input: V1CommitDecisionInput): Promise<V1CommitDecisionResult> {
      const snap = snapshot();
      try {
        // 事务内重新读取版本与状态，不使用事务外读到的旧值。
        if (state.review.status !== 'OPEN')
          throw new WorkmeshError(V1_ERROR_CODES.REVIEW_CLOSED, 'REVIEW_CLOSED', undefined, 409);
        if (state.review.version !== input.expectedVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'VERSION_CONFLICT',
            undefined,
            409,
          );
        if (state.review.subjectDigest !== input.subjectDigest)
          throw new WorkmeshError(
            V1_ERROR_CODES.REVISION_DIGEST_CHANGED,
            'REVISION_DIGEST_CHANGED',
            undefined,
            409,
          );
        if (state.decisions.some((item) => item.approvalSlotId === input.slotId))
          throw new WorkmeshError(
            V1_ERROR_CODES.REVIEW_SLOT_DECIDED,
            'REVIEW_SLOT_DECIDED',
            undefined,
            409,
          );

        // 条件消费票据：只有未消费、未失效且属于本次 session 的行才 count=1。
        const ticket = state.tickets.find((item) => item.id === input.ticket.id);
        const consumed =
          ticket &&
          ticket.secretHash === input.ticket.secretHash &&
          ticket.webSessionId === input.ticket.webSessionId &&
          !ticket.consumedAt &&
          !ticket.invalidatedAt &&
          ticket.expiresAt > input.now;
        if (!consumed)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_FAILED',
            undefined,
            409,
          );
        ticket!.consumedAt = input.now;
        ticket!.consumedOperationId = input.operationId;

        const decisionId = `dec-${state.decisions.length + 1}`;
        state.decisions.push({
          id: decisionId,
          approvalSlotId: input.slotId,
          decision: input.decision,
          subjectDigest: input.subjectDigest,
        });
        state.review.decisions = [...state.review.decisions];

        const approvedSlots = new Set(
          state.decisions
            .filter(
              (item) =>
                item.decision === 'APPROVE' && item.subjectDigest === state.review.subjectDigest,
            )
            .map((item) => item.approvalSlotId),
        );
        const allApproved =
          state.review.slots.length > 0 &&
          state.review.slots.every((slot) => approvedSlots.has(slot.id)) &&
          input.decision === 'APPROVE';

        let published = false;
        let publicationId: string | null = null;
        let documentVersion: number | null = null;

        if (allApproved && state.review.subject) {
          if (state.failPublishWith) throw new Error(state.failPublishWith);
          // CAS：首次发布 currentPublishedRevisionId 为 NULL 也必须命中；
          // 重复发布同一 revision 视为已被并发发布，不静默成功。
          const doc = state.documents.find((item) => item.id === state.review.subject!.documentId)!;
          const alreadyPublished =
            doc.currentPublishedRevisionId === state.review.subject!.revisionId;
          if (alreadyPublished)
            throw new WorkmeshError(
              V1_ERROR_CODES.VERSION_CONFLICT,
              'VERSION_CONFLICT',
              undefined,
              409,
            );
          doc.version += 1;
          doc.currentPublishedRevisionId = state.review.subject!.revisionId;
          documentVersion = doc.version;
          publicationId = `pub-${state.publications.length + 1}`;
          state.publications.push({
            id: publicationId,
            documentId: doc.id,
            revisionId: state.review.subject!.revisionId,
            kind: 'PUBLISH',
          });
          state.review.status = 'APPROVED';
          state.review.version += 1;
          published = true;
        } else if (input.decision !== 'APPROVE') {
          state.review.status = input.decision === 'REJECT' ? 'REJECTED' : 'CHANGES_REQUESTED';
          state.review.version += 1;
        }

        const subjectResult: V1SubjectResult =
          published && publicationId && documentVersion !== null
            ? { kind: 'PUBLISHED', publicationId, documentVersion }
            : input.decision === 'REJECT'
              ? { kind: 'REJECTED', affectedTaskIds: [] }
              : input.decision === 'CHANGES_REQUESTED'
                ? { kind: 'REWORK', affectedTaskIds: [] }
                : {
                    kind: 'RECORDED',
                    approvedSlotIds: [...approvedSlots],
                    remainingSlotIds: state.review.slots
                      .filter((slot) => !approvedSlots.has(slot.id))
                      .map((slot) => slot.id),
                  };

        state.operations.push({
          id: input.operationId,
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.operationKey,
          method: input.method,
          route: input.route,
          requestDigest: input.requestDigest,
          resultRefs: {
            reviewRequestId: state.review.id,
            decisionId,
            published,
            publicationId,
            documentVersion,
            subjectResult,
            task: null,
            requirement: null,
          },
          committedAt: input.now,
        });

        return {
          decisionId,
          review: JSON.parse(JSON.stringify(state.review)),
          published,
          publicationId,
          documentVersion,
          approvedSlotIds: [...approvedSlots],
          subjectResult,
          task: null,
          requirement: null,
        };
      } catch (error) {
        restore(snap);
        throw error;
      }
    },
  };
}

function authRepository(
  overrides: { memberActive?: boolean; assignments?: Array<{ roleId: string }> } = {},
): V1AuthorizationRepository {
  const memberActive = overrides.memberActive ?? true;
  const assignments = overrides.assignments ?? [];
  return {
    async findProject(projectId) {
      return { id: projectId, version: 1, archivedAt: null };
    },
    async findMember(projectId, userId) {
      return {
        projectId,
        userId,
        role: 'MEMBER',
        version: 1,
        revokedAt: memberActive ? null : now,
      };
    },
    async findActiveRoleAssignments(projectId, userId) {
      return assignments.map((item, index) => ({
        id: `as-${index}`,
        projectId,
        userId,
        roleId: item.roleId,
        version: 1,
        revokedAt: null,
      }));
    },
    async findRoleAssignment(projectId, userId, roleId) {
      return roleId === 'r-qa' && userId === 'bob'
        ? { id: 'as-qa', projectId, userId, roleId, version: 1, revokedAt: null }
        : null;
    },
    async findKnowledgeBase(knowledgeBaseId) {
      return {
        id: knowledgeBaseId,
        projectId: 'p-a',
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

const ticketSecret = 'ticket-secret-value';

function makeTicket(
  binding: Record<string, unknown>,
  overrides: Partial<V1TicketRecord> = {},
): V1TicketRecord {
  return {
    id: 'tk-1',
    secretHash: hashTicketSecret(ticketSecret),
    userId: 'alice',
    webSessionId: 'sess-1',
    projectId: 'p-a',
    userAuthVersion: 1,
    action: 'REVIEW_DECIDE',
    targetType: 'REVIEW_REQUEST',
    targetId: 'rr-1',
    expectedVersion: 3,
    actionDigest: actionDigestOf(binding as unknown as Parameters<typeof actionDigestOf>[0]),
    roleId: null,
    approvalSlotId: null,
    createdAt: now,
    expiresAt: new Date('2026-11-01T00:05:00.000Z'),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  };
}

const alice: Principal = { kind: 'HUMAN', userId: 'alice', scopes: [] };
const bob: Principal = { kind: 'HUMAN', userId: 'bob', scopes: [] };
const agentAlice: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-1',
  projectId: 'p-a',
  roleIds: ['r-product'],
  scopes: [],
};

describe('V1ReviewService.decide', () => {
  let state: Store;
  let service: V1ReviewService;
  let operations: Op[];

  const baseInput: V1DecideInput = {
    slotId: 'slot-1',
    decision: 'APPROVE',
    expectedVersion: 3,
    comment: null,
    confirmation: { ticketId: 'tk-1', ticketSecret },
  };

  const route = '/api/v1/review-requests/rr-1/decisions';

  function context(overrides: Partial<V1DecideContext> = {}): V1DecideContext {
    return {
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      method: 'POST',
      route,
      body: { slotId: baseInput.slotId, decision: 'APPROVE', expectedVersion: 3 },
      requestId: 'req-1',
      now,
      operationId: 'op-1',
      webSessionId: 'sess-1',
      userAuthVersion: 1,
      ...overrides,
    };
  }

  beforeEach(() => {
    state = store();
    // 幂等查询与事务写入共享同一数组，避免替身与真实提交范围不一致。
    operations = state.operations;
    const authorization = new V1AuthorizationService(authRepository());
    const confirmation: V1ConfirmationRepository = {
      async createTicket() {
        throw new Error('not used');
      },
      async findTicket(ticketId) {
        return state.tickets.find((item) => item.id === ticketId) ?? null;
      },
      async consumeTicket() {
        return { consumed: false, ticket: null };
      },
    };
    const idempotency: V1IdempotencyRepository = {
      async findOperation(input) {
        return (
          operations.find(
            (item) =>
              item.projectScopeKey === input.projectScopeKey &&
              item.principalScopeKey === input.principalScopeKey &&
              item.key === input.key,
          ) ?? null
        );
      },
    };
    service = new V1ReviewService(
      reviewRepository(state),
      authorization,
      confirmation,
      idempotency,
    );
    // 预置票据：绑定必须与服务层服务端派生的 binding 完全一致
    const preview = service.previewDigest(state.review, baseInput);
    state.tickets.push(
      makeTicket({ schemaVersion: 1, ...preview.binding } as unknown as Parameters<
        typeof actionDigestOf
      >[0]),
    );
  });

  it('rejects an Agent principal for approval decisions', async () => {
    await expect(service.decide(agentAlice, 'rr-1', baseInput, context())).rejects.toMatchObject({
      code: 'HUMAN_SESSION_REQUIRED',
      status: 403,
    });
    expect(state.decisions).toHaveLength(0);
  });

  it('rejects a member who is not the assigned approver and lacks the required role', async () => {
    await expect(service.decide(bob, 'rr-1', baseInput, context())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(state.decisions).toHaveLength(0);
  });

  it('allows a slot qualified by current business role assignment', async () => {
    const roleBinding = service.previewDigest(state.review, { ...baseInput, slotId: 'slot-2' });
    state.tickets.push(
      makeTicket(
        { schemaVersion: 1, ...roleBinding.binding } as unknown as Parameters<
          typeof actionDigestOf
        >[0],
        {
          id: 'tk-2',
          userId: 'bob',
          roleId: 'r-qa',
          approvalSlotId: 'slot-2',
        },
      ),
    );
    const result = await service.decide(
      bob,
      'rr-1',
      { ...baseInput, slotId: 'slot-2', confirmation: { ticketId: 'tk-2', ticketSecret } },
      context({
        operationId: 'op-2',
        body: { slotId: 'slot-2', decision: 'APPROVE', expectedVersion: 3 },
      }),
    );
    expect(result.decisionId).toBe('dec-1');
    expect(result.published).toBe(false);
  });

  it('rejects a stale expectedVersion', async () => {
    await expect(
      service.decide(alice, 'rr-1', { ...baseInput, expectedVersion: 2 }, context()),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
  });

  it('requires a non-empty comment when requesting changes or rejecting', async () => {
    await expect(
      service.decide(
        alice,
        'rr-1',
        { ...baseInput, decision: 'CHANGES_REQUESTED', comment: '  ' },
        context(),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'REVIEW_COMMENT_REQUIRED',
      status: 422,
    });
    await expect(
      service.decide(alice, 'rr-1', { ...baseInput, decision: 'REJECT', comment: null }, context()),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'REVIEW_COMMENT_REQUIRED',
      status: 422,
    });
  });

  it('rejects decisions on a closed review', async () => {
    state.review.status = 'APPROVED';
    await expect(service.decide(alice, 'rr-1', baseInput, context())).rejects.toMatchObject({
      code: 'REVIEW_CLOSED',
      status: 409,
    });
  });

  it('rejects a second decision for the same slot', async () => {
    state.review.decisions = [
      {
        id: 'dec-0',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        comment: null,
        createdById: 'alice',
        createdAt: now,
      },
    ];
    await expect(service.decide(alice, 'rr-1', baseInput, context())).rejects.toMatchObject({
      code: 'REVIEW_SLOT_DECIDED',
      status: 409,
    });
  });

  it('rejects a wrong ticket secret without recording a decision', async () => {
    await expect(
      service.decide(
        alice,
        'rr-1',
        { ...baseInput, confirmation: { ticketId: 'tk-1', ticketSecret: 'wrong' } },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID', status: 403 });
    expect(state.decisions).toHaveLength(0);
  });

  it('rejects a ticket bound to a different comment', async () => {
    const otherPreview = service.previewDigest(state.review, { ...baseInput, comment: 'changed' });
    state.tickets.push(
      makeTicket(
        { schemaVersion: 1, ...otherPreview.binding } as unknown as Parameters<
          typeof actionDigestOf
        >[0],
        { id: 'tk-9' },
      ),
    );
    await expect(
      service.decide(
        alice,
        'rr-1',
        { ...baseInput, confirmation: { ticketId: 'tk-9', ticketSecret } },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_CHANGED' });
  });

  it('publishes atomically when the last required slot approves', async () => {
    const secondBinding = service.previewDigest(state.review, { ...baseInput, slotId: 'slot-2' });
    state.tickets.push(
      makeTicket(
        { schemaVersion: 1, ...secondBinding.binding } as unknown as Parameters<
          typeof actionDigestOf
        >[0],
        { id: 'tk-2', userId: 'bob', roleId: 'r-qa', approvalSlotId: 'slot-2' },
      ),
    );
    const secondContext = context({
      operationId: 'op-2',
      body: { slotId: 'slot-2', decision: 'APPROVE', expectedVersion: 3 },
    });
    const first = await service.decide(alice, 'rr-1', baseInput, context());
    expect(first.published).toBe(false);
    const second = await service.decide(
      bob,
      'rr-1',
      { ...baseInput, slotId: 'slot-2', confirmation: { ticketId: 'tk-2', ticketSecret } },
      // 第二次决定的 expectedVersion 仍是 request 自身 version（第一个决定不改变它）
      secondContext,
    );
    expect(second.published).toBe(true);
    expect(second.publicationId).toBe('pub-1');
    expect(second.subjectResult).toEqual({
      kind: 'PUBLISHED',
      publicationId: 'pub-1',
      documentVersion: state.documents[0].version,
    });
    expect(state.documents[0].currentPublishedRevisionId).toBe('rev-1');
    expect(state.publications).toHaveLength(1);
    expect(state.review.status).toBe('APPROVED');
  });

  it('consumes the ticket exactly once', async () => {
    await service.decide(alice, 'rr-1', baseInput, context());
    expect(state.tickets[0].consumedAt).toEqual(now);
    await expect(
      service.decide(
        alice,
        'rr-1',
        baseInput,
        context({ operationId: 'op-x', idempotencyKey: '22222222-2222-4222-8222-222222222222' }),
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_USED' });
  });

  it('rolls the whole transaction back when publishing fails', async () => {
    state.review.slots = [state.review.slots[0]];
    state.failPublishWith = 'simulated constraint failure';
    await expect(service.decide(alice, 'rr-1', baseInput, context())).rejects.toThrow(/simulated/);
    expect(state.decisions).toHaveLength(0);
    expect(state.publications).toHaveLength(0);
    expect(state.documents[0].currentPublishedRevisionId).toBeNull();
    expect(state.documents[0].version).toBe(3);
    expect(state.operations).toHaveLength(0);
    expect(state.tickets[0].consumedAt).toBeNull();
  });

  it('returns the original result for a replayed idempotency key', async () => {
    const first = await service.decide(alice, 'rr-1', baseInput, context());
    const replay = await service.decide(
      alice,
      'rr-1',
      baseInput,
      context({ operationId: 'op-again' }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.decisionId).toBe(first.decisionId);
    expect(replay.subjectResult).toEqual({
      kind: 'RECORDED',
      approvedSlotIds: ['slot-1'],
      remainingSlotIds: ['slot-2'],
    });
    expect(state.decisions).toHaveLength(1);
  });

  it('replays a committed decision before checking CLOSED, version or slot state', async () => {
    const first = await service.decide(alice, 'rr-1', baseInput, context());
    // 模拟提交后评审已关闭、版本已推进、槽位已占用：重放仍必须返回原结果。
    state.review.status = 'APPROVED';
    state.review.version = 9;
    state.review.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        comment: null,
        createdById: 'alice',
        createdAt: now,
      },
    ];
    const replay = await service.decide(
      alice,
      'rr-1',
      { ...baseInput, expectedVersion: 9 },
      context({ operationId: 'op-again' }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.decisionId).toBe(first.decisionId);
    expect(state.decisions).toHaveLength(1);
  });

  it('conflicts when the same idempotency key carries different business content', async () => {
    await service.decide(alice, 'rr-1', baseInput, context());
    await expect(
      service.decide(
        alice,
        'rr-1',
        { ...baseInput, decision: 'REJECT' },
        context({ body: { slotId: 'slot-1', decision: 'REJECT', expectedVersion: 3 } }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('hides a review the principal cannot read', async () => {
    const authorization = new V1AuthorizationService(authRepository({ memberActive: false }));
    const hidden = new V1ReviewService(
      reviewRepository(state),
      authorization,
      {
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
      {
        async findOperation() {
          return null;
        },
      },
    );
    await expect(hidden.getReview(alice, 'rr-1')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('hides a review from an agent scoped to another project', async () => {
    // 工件类评审的 subject 为 null：知识库校验不触发。若不像 HUMAN 那样先解析项目上下文，
    // 跨项目 Agent 只要拿到 reviewId 就能读到别的项目的 projectId/taskId/责任人/驳回意见。
    const artifactState = store();
    artifactState.review.subject = null;
    const scoped = new V1ReviewService(
      reviewRepository(artifactState),
      new V1AuthorizationService(authRepository({ assignments: [{ roleId: 'r-product' }] })),
      {
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
      {
        async findOperation() {
          return null;
        },
      },
    );

    await expect(
      scoped.getReview({ ...agentAlice, projectId: 'p-b' }, 'rr-1'),
    ).rejects.toMatchObject(
      // notFound() 把细因放在 message 上，外层 code 统一为 RESOURCE_NOT_FOUND。
      { code: 'RESOURCE_NOT_FOUND', message: 'CROSS_PROJECT_AGENT', status: 404 },
    );
    // 同项目 Agent 读同一份评审不受影响。
    await expect(scoped.getReview(agentAlice, 'rr-1')).resolves.toMatchObject({ id: 'rr-1' });
  });

  it('binds the decision to the server derived binding, not to client supplied slots', async () => {
    const preview = service.previewDigest(state.review, baseInput);
    expect(preview.binding.action).toBe('REVIEW_DECIDE');
    expect(preview.binding.targetType).toBe('REVIEW_REQUEST');
    expect(preview.binding.targetId).toBe('rr-1');
    expect(preview.binding.expectedVersion).toBe(3);
    expect(preview.binding.payload).toMatchObject({ slotId: 'slot-1', decision: 'APPROVE' });
    expect(
      requestDigestOf({
        method: 'POST',
        route,
        body: { slotId: 'slot-1', decision: 'APPROVE', expectedVersion: 3 },
      }),
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('V1ReviewService.revoke', () => {
  let state: Store;
  let service: V1ReviewService;

  const route = '/api/v1/review-decisions/dec-1/revoke';
  const reason = 'approval withdrawn';

  function context(overrides: Partial<V1DecideContext> = {}): V1DecideContext {
    return {
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      method: 'POST',
      route,
      body: { expectedVersion: 3, reason },
      requestId: 'req-1',
      now,
      operationId: 'op-r1',
      webSessionId: 'sess-1',
      userAuthVersion: 1,
      ...overrides,
    };
  }

  function decisionContext(overrides: Partial<V1DecisionContext> = {}): V1DecisionContext {
    return {
      decisionId: 'dec-1',
      projectId: 'p-a',
      reviewId: 'rr-1',
      reviewKind: 'KNOWLEDGE_PUBLICATION',
      reviewStatus: 'APPROVED',
      reviewVersion: 3,
      subjectDigest: 'a'.repeat(64),
      documentRevisionId: 'rev-1',
      artifactSetId: null,
      taskId: null,
      decision: 'APPROVE',
      createdById: 'alice',
      revoked: false,
      knowledgeBaseId: 'kb-1',
      slot: {
        id: 'slot-1',
        slotKey: 'publication',
        kind: 'KNOWLEDGE_PUBLICATION',
        requiredRoleId: null,
        requiredUserId: 'alice',
        sourceSlotBindingId: null,
      },
      ...overrides,
    };
  }

  /** 预置“已批准并产生当前发布指针”的状态，并签发与撤销绑定一致的票据。 */
  function seedPublishedApproval(): void {
    state.review.status = 'APPROVED';
    state.review.version = 3;
    state.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        createdById: 'alice',
        createdAt: now,
        revoked: false,
      },
    ];
    state.documents[0].version = 4;
    state.documents[0].currentPublishedRevisionId = 'rev-1';
    state.publications.push({
      id: 'pub-1',
      documentId: 'doc-1',
      revisionId: 'rev-1',
      kind: 'PUBLISH',
    });
    state.snapshotTaskIds = ['task-2'];
    const preview = service.previewRevoke(decisionContext(), reason, state.review.version);
    state.tickets.push(
      makeTicket(
        { schemaVersion: 1, ...preview.binding } as unknown as Parameters<typeof actionDigestOf>[0],
        {
          action: 'REVIEW_REVOKE',
          targetType: 'REVIEW_DECISION',
          targetId: 'dec-1',
          expectedVersion: state.review.version,
        },
      ),
    );
  }

  function revokeInput(overrides: Partial<Parameters<V1ReviewService['revoke']>[2]> = {}) {
    return {
      expectedVersion: 3,
      reason,
      confirmation: { ticketId: 'tk-1', ticketSecret },
      ...overrides,
    };
  }

  beforeEach(() => {
    state = store();
    const authorization = new V1AuthorizationService(authRepository());
    const confirmation: V1ConfirmationRepository = {
      async createTicket() {
        throw new Error('not used');
      },
      async findTicket(ticketId) {
        return state.tickets.find((item) => item.id === ticketId) ?? null;
      },
      async consumeTicket() {
        return { consumed: false, ticket: null };
      },
    };
    const idempotency: V1IdempotencyRepository = {
      async findOperation(input) {
        return (
          state.operations.find(
            (item) =>
              item.projectScopeKey === input.projectScopeKey &&
              item.principalScopeKey === input.principalScopeKey &&
              item.key === input.key,
          ) ?? null
        );
      },
    };
    service = new V1ReviewService(
      reviewRepository(state),
      authorization,
      confirmation,
      idempotency,
    );
  });

  it('rejects revoking a non-approval decision', async () => {
    state.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'CHANGES_REQUESTED',
        subjectDigest: state.review.subjectDigest,
        createdById: 'alice',
        createdAt: now,
      },
    ];
    state.review.status = 'CHANGES_REQUESTED';
    await expect(service.revoke(alice, 'dec-1', revokeInput(), context())).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 422,
      message: 'REVOCATION_NOT_APPLICABLE',
    });
    expect(state.decisions[0].revoked).toBeUndefined();
  });

  it('rejects a decision that was already revoked', async () => {
    state.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        createdById: 'alice',
        createdAt: now,
        revoked: true,
      },
    ];
    await expect(service.revoke(alice, 'dec-1', revokeInput(), context())).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      status: 409,
    });
    expect(state.review.status).toBe('OPEN');
  });

  it('rejects a stale parent review version', async () => {
    state.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        createdById: 'alice',
        createdAt: now,
      },
    ];
    await expect(
      service.revoke(
        alice,
        'dec-1',
        revokeInput({ expectedVersion: 2 }),
        context({ body: { expectedVersion: 2, reason } }),
      ),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
    });
    expect(state.review.status).toBe('OPEN');
  });

  it('rejects a member who neither decided nor holds the slot', async () => {
    state.decisions = [
      {
        id: 'dec-1',
        approvalSlotId: 'slot-1',
        decision: 'APPROVE',
        subjectDigest: state.review.subjectDigest,
        createdById: 'alice',
        createdAt: now,
      },
    ];
    await expect(service.revoke(bob, 'dec-1', revokeInput(), context())).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect(state.decisions[0].revoked).toBeUndefined();
  });

  it('rejects an Agent principal', async () => {
    seedPublishedApproval();
    await expect(
      service.revoke(agentAlice, 'dec-1', revokeInput(), context()),
    ).rejects.toMatchObject({
      code: 'HUMAN_SESSION_REQUIRED',
      status: 403,
    });
    expect(state.review.status).toBe('APPROVED');
  });

  it('rejects a ticket bound to a different reason', async () => {
    seedPublishedApproval();
    const other = service.previewRevoke(decisionContext(), 'other reason', 3);
    state.tickets.push(
      makeTicket(
        { schemaVersion: 1, ...other.binding } as unknown as Parameters<typeof actionDigestOf>[0],
        { id: 'tk-2', action: 'REVIEW_REVOKE', targetType: 'REVIEW_DECISION', targetId: 'dec-1' },
      ),
    );
    await expect(
      service.revoke(
        alice,
        'dec-1',
        revokeInput({ confirmation: { ticketId: 'tk-2', ticketSecret } }),
        context(),
      ),
    ).rejects.toMatchObject({ code: 'ACTION_CHANGED', status: 409 });
    expect(state.decisions[0].revoked).toBe(false);
    expect(state.publications).toHaveLength(1);
  });

  it('revokes the approval, withdraws the publication pointer, and reports affected tasks', async () => {
    seedPublishedApproval();
    const result = await service.revoke(alice, 'dec-1', revokeInput(), context());

    expect(result.replayed).toBe(false);
    expect(result.revocation).toMatchObject({ id: 'revk-1', decisionId: 'dec-1', reason });
    expect(result.affectedTaskIds).toEqual(['task-2']);

    expect(state.decisions[0].revoked).toBe(true);
    expect(state.review.status).toBe('INVALIDATED');
    expect(state.review.version).toBe(4);
    expect(state.documents[0].currentPublishedRevisionId).toBeNull();
    expect(state.documents[0].version).toBe(5);
    expect(state.publications.map((item) => item.kind)).toEqual(['PUBLISH', 'WITHDRAW']);
    expect(state.tickets[0].consumedAt).toEqual(now);
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].resultRefs).toMatchObject({
      reviewRequestId: 'rr-1',
      decisionId: 'dec-1',
      revocationId: 'revk-1',
      affectedTaskIds: ['task-2'],
    });
  });

  it('returns the original revocation for a replayed idempotency key', async () => {
    seedPublishedApproval();
    const first = await service.revoke(alice, 'dec-1', revokeInput(), context());
    const replay = await service.revoke(
      alice,
      'dec-1',
      revokeInput(),
      context({ operationId: 'op-r2' }),
    );

    expect(replay.replayed).toBe(true);
    expect(replay.revocation.id).toBe(first.revocation.id);
    expect(replay.affectedTaskIds).toEqual(first.affectedTaskIds);
    expect(state.decisions).toHaveLength(1);
    expect(state.publications).toHaveLength(2);
    expect(state.operations).toHaveLength(1);
  });

  it('conflicts when the same idempotency key carries a different reason', async () => {
    seedPublishedApproval();
    await service.revoke(alice, 'dec-1', revokeInput(), context());
    await expect(
      service.revoke(
        alice,
        'dec-1',
        revokeInput({ reason: 'another reason' }),
        context({ body: { expectedVersion: 3, reason: 'another reason' } }),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });
});
