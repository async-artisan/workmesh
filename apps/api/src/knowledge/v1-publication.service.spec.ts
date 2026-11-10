import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import {
  actionDigestOf,
  hashTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from '../auth/v1-confirmation';
import {
  V1AuthorizationService,
  type V1AuthorizationRepository,
  type V1GrantRecord,
} from '../auth/v1-authorization';
import {
  V1PublicationService,
  type V1CreateDocumentSnapshot,
  type V1DocumentView,
  type V1DocumentWriteContext,
  type V1ProposeRevisionSnapshot,
  type V1PublicationRepository,
  type V1RevisionView,
  type V1WriteOperation,
} from './v1-publication.service';
import type { V1IdempotencyRepository, V1OperationRecord } from '../common/v1-idempotency';

const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const WRITE_ROUTE = '/api/v1/documents/doc-1/revisions';

/**
 * 固定幂等上下文：同一次"重试"用同一个 key 与 operationId。
 * 需要区分两次不同写入的用例显式传入不同的 key。
 */
function writeContext(overrides: Partial<V1DocumentWriteContext> = {}): V1DocumentWriteContext {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    method: 'POST',
    route: WRITE_ROUTE,
    now: new Date('2026-11-01T00:00:00Z'),
    operationId: 'op-fixed-1',
    ...overrides,
  };
}

class MemoryIdempotencyRepository implements V1IdempotencyRepository {
  readonly operations = new Map<string, V1OperationRecord>();

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return (
      this.operations.get(`${input.projectScopeKey}|${input.principalScopeKey}|${input.key}`) ??
      null
    );
  }

  /** 模拟仓储在业务事务内落库。 */
  record(operation: V1WriteOperation, resultRefs: unknown): void {
    this.operations.set(
      `${operation.projectScopeKey}|${operation.principalScopeKey}|${operation.key}`,
      {
        id: operation.id,
        projectScopeKey: operation.projectScopeKey,
        principalScopeKey: operation.principalScopeKey,
        key: operation.key,
        method: operation.method,
        route: operation.route,
        requestDigest: operation.requestDigest,
        resultRefs: resultRefs as Record<string, unknown>,
        committedAt: new Date('2026-11-01T00:00:00Z'),
      },
    );
  }
}

/** 当前用例的幂等仓储；`beforeEach` 重新赋值，仓储 fake 从这里落库。 */
let operations = new MemoryIdempotencyRepository();

const author: Principal = { kind: 'HUMAN', userId: 'alice', scopes: [] };
const authorSession: Principal & { sessionId: string } = { ...author, sessionId: 'sess-1' };
const reader: Principal = { kind: 'HUMAN', userId: 'carol', scopes: [] };
const reviewer: Principal = { kind: 'HUMAN', userId: 'bob', scopes: [] };
const agentRead: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-1',
  projectId: 'p-a',
  roleIds: ['r-product'],
  scopes: ['knowledge:read'],
};
const agentPropose: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-2',
  projectId: 'p-a',
  roleIds: ['r-product'],
  scopes: ['knowledge:read', 'knowledge:propose', 'requirement:propose'],
};

const TICKET_SECRET = 'ticket-secret-value';

function authorizationRepository(): V1AuthorizationRepository {
  return {
    async findProject(projectId) {
      return projectId === 'p-a' ? { id: projectId, version: 1, archivedAt: null } : null;
    },
    async findMember(projectId, userId) {
      return ['alice', 'bob', 'carol'].includes(userId)
        ? { projectId, userId, role: 'MEMBER', version: 1, revokedAt: null }
        : null;
    },
    async findActiveRoleAssignments(projectId, userId) {
      return userId === 'alice'
        ? [{ id: 'as-1', projectId, userId, roleId: 'r-product', version: 1, revokedAt: null }]
        : [];
    },
    async findRoleAssignment(projectId, userId, roleId) {
      return userId === 'alice' && roleId === 'r-product'
        ? { id: 'as-1', projectId, userId, roleId, version: 1, revokedAt: null }
        : null;
    },
    async findKnowledgeBase(knowledgeBaseId) {
      return {
        id: knowledgeBaseId,
        projectId: 'p-a',
        visibility: 'RESTRICTED',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'alice',
        publicationApproverRoleId: null,
        archivedAt: null,
      };
    },
    async findGrants(): Promise<V1GrantRecord[]> {
      return [
        {
          id: 'g-1',
          knowledgeBaseId: 'kb-1',
          subjectKind: 'USER',
          subjectUserId: 'alice',
          subjectRoleId: null,
          permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
          revokedAt: null,
        },
        {
          id: 'g-2',
          knowledgeBaseId: 'kb-1',
          subjectKind: 'USER',
          subjectUserId: 'bob',
          subjectRoleId: null,
          permissions: ['READ'],
          revokedAt: null,
        },
        {
          id: 'g-3',
          knowledgeBaseId: 'kb-1',
          subjectKind: 'USER',
          subjectUserId: 'carol',
          subjectRoleId: null,
          permissions: ['READ'],
          revokedAt: null,
        },
      ];
    },
  };
}

const document: V1DocumentView = {
  id: 'doc-1',
  projectId: 'p-a',
  knowledgeBaseId: 'kb-1',
  requirementId: null,
  kind: 'KNOWLEDGE',
  version: 3,
  currentPublishedRevisionId: null,
  archivedAt: null,
};

const understandingDocument: V1DocumentView = {
  id: 'doc-understanding',
  projectId: 'p-a',
  knowledgeBaseId: 'kb-1',
  requirementId: 'req-1',
  kind: 'UNDERSTANDING',
  version: 5,
  currentPublishedRevisionId: 'rev-understanding',
  archivedAt: null,
};

const prdDocument: V1DocumentView = {
  id: 'doc-prd',
  projectId: 'p-a',
  knowledgeBaseId: 'kb-1',
  requirementId: 'req-1',
  kind: 'PRD',
  version: 2,
  currentPublishedRevisionId: null,
  archivedAt: null,
};

function revision(overrides: Partial<V1RevisionView> = {}): V1RevisionView {
  return {
    id: 'rev-1',
    documentId: 'doc-1',
    knowledgeBaseId: 'kb-1',
    projectId: 'p-a',
    seq: 1,
    title: '候选标题',
    mimeType: 'text/markdown; charset=utf-8',
    byteLength: 12,
    digest: 'a'.repeat(64),
    state: 'CANDIDATE',
    bodyBytes: new Uint8Array(Buffer.from('hello\nworld', 'utf8')),
    createdBy: 'alice',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
    ...overrides,
  };
}

type State = {
  reviewers: string[];
  proposed: number;
  requirement: { currentUnderstandingRevisionId: string | null };
  createdDocuments: Array<{
    kind: string;
    reviewKind: string;
    basisUnderstandingRevisionId: string | null;
  }>;
  restored: number;
  withdrawn: Array<{ expectedVersion: number; reason: string; ticketWebSessionId: string }>;
};

function repository(state: State): V1PublicationRepository {
  const docs: Record<string, V1DocumentView> = {
    'doc-1': document,
    'doc-understanding': understandingDocument,
    'doc-prd': prdDocument,
    'doc-archived': {
      ...document,
      id: 'doc-archived',
      archivedAt: new Date('2026-01-01T00:00:00Z'),
    },
  };
  const revs: Record<string, V1RevisionView> = {
    'rev-1': revision(),
    'rev-2': revision({ id: 'rev-2', createdBy: 'dave' }),
    'rev-pub': revision({ id: 'rev-pub', documentId: 'doc-2', state: 'PUBLISHED' }),
    'rev-understanding': revision({
      id: 'rev-understanding',
      documentId: 'doc-understanding',
      state: 'PUBLISHED',
      createdBy: 'alice',
    }),
    'rev-understanding-old': revision({
      id: 'rev-understanding-old',
      documentId: 'doc-understanding',
      state: 'PUBLISHED',
      createdBy: 'alice',
    }),
  };
  const feedback = {
    reviewRequestId: 'rr-1',
    slots: [
      { id: 'slot-1', slotKey: 'publication', requiredUserId: 'alice', requiredRoleId: null },
    ],
  };
  return {
    async findDocument(documentId) {
      return docs[documentId] ? { ...docs[documentId] } : null;
    },
    async findRevision(revisionId) {
      return revs[revisionId] ? { ...revs[revisionId] } : null;
    },
    async listRevisions(documentId) {
      // rev-2 的作者不是当前评审者，对只有 READ 的主体必须过滤掉
      return Object.values(revs).filter((item) => item.documentId === documentId);
    },
    async isAssignedReviewer(revisionId, userId) {
      // bob 只被指派为 rev-1 的评审者
      return revisionId === 'rev-1' && state.reviewers.includes(userId);
    },
    async listAssignedReviewerRevisionIds(revisionIds, userId) {
      return revisionIds.filter((id) => id === 'rev-1' && state.reviewers.includes(userId));
    },
    async findRequirement(requirementId) {
      return requirementId === 'req-1'
        ? {
            id: 'req-1',
            projectId: 'p-a',
            currentUnderstandingRevisionId: state.requirement.currentUnderstandingRevisionId,
            currentPrdRevisionId: null,
          }
        : null;
    },
    async findKnowledgeBaseProjectId(knowledgeBaseId) {
      return knowledgeBaseId === 'kb-1' ? 'p-a' : null;
    },
    async projectRoleIds() {
      return ['r-dev', 'r-design', 'r-product'];
    },
    async listDocuments() {
      return { items: [document], nextCursor: null };
    },
    async createDocument(input): Promise<V1CreateDocumentSnapshot> {
      state.createdDocuments.push({
        kind: input.kind,
        reviewKind: input.reviewKind,
        basisUnderstandingRevisionId: input.basisUnderstandingRevisionId,
      });
      const result: V1CreateDocumentSnapshot = {
        document: { ...prdDocument, id: 'doc-created' },
        revision: revision({ id: 'rev-created' }),
        reviewKind: input.reviewKind,
        ...feedback,
      };
      operations.record(input.operation, result);
      return result;
    },
    async proposeRevision(input): Promise<V1ProposeRevisionSnapshot> {
      state.proposed += 1;
      const result: V1ProposeRevisionSnapshot = {
        revision: revision(),
        reviewKind: input.reviewKind,
        ...feedback,
      };
      operations.record(input.operation, result);
      return result;
    },
    async restoreRevision(input): Promise<V1ProposeRevisionSnapshot> {
      state.restored += 1;
      const result: V1ProposeRevisionSnapshot = {
        revision: revision({ id: 'rev-restored' }),
        reviewKind: input.reviewKind,
        ...feedback,
      };
      operations.record(input.operation, result);
      return result;
    },
    async withdraw(input) {
      state.withdrawn.push({
        expectedVersion: input.expectedVersion,
        reason: input.reason,
        ticketWebSessionId: input.ticket.webSessionId,
      });
      return { documentVersion: input.expectedVersion + 1, publicationId: 'pub-1' };
    },
  };
}

function ticketRepository(record: V1TicketRecord | null): V1ConfirmationRepository {
  return {
    async createTicket() {
      throw new Error('not used');
    },
    async findTicket(ticketId) {
      return record && record.id === ticketId ? record : null;
    },
    async consumeTicket() {
      throw new Error('not used');
    },
  };
}

function withdrawTicket(overrides: Partial<V1TicketRecord> = {}): V1TicketRecord {
  const now = new Date('2026-11-01T00:00:00Z');
  const binding = {
    action: 'KNOWLEDGE_WITHDRAW',
    projectId: 'p-a',
    targetType: 'KNOWLEDGE_DOCUMENT',
    targetId: 'doc-1',
    expectedVersion: 3,
    roleSlot: null,
    payload: { reason: '内容已过时' },
  };
  return {
    id: 'ticket-1',
    secretHash: hashTicketSecret(TICKET_SECRET),
    userId: 'alice',
    webSessionId: 'sess-1',
    projectId: 'p-a',
    userAuthVersion: 0,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: null,
    approvalSlotId: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  };
}

describe('V1PublicationService', () => {
  let state: State;
  let service: V1PublicationService;

  function build(
    ticket: V1TicketRecord | null = null,
    repo: V1PublicationRepository = repository(state),
  ) {
    return new V1PublicationService(
      repo,
      new V1AuthorizationService(authorizationRepository()),
      ticketRepository(ticket),
      operations,
    );
  }

  beforeEach(() => {
    state = {
      reviewers: ['bob'],
      proposed: 0,
      requirement: { currentUnderstandingRevisionId: 'rev-understanding' },
      createdDocuments: [],
      restored: 0,
      withdrawn: [],
    };
    operations = new MemoryIdempotencyRepository();
    service = build();
  });

  it('shows a candidate to its author who still has READ', async () => {
    await expect(service.getRevision(author, 'rev-1')).resolves.toMatchObject({
      id: 'rev-1',
      state: 'CANDIDATE',
    });
  });

  it('hides a candidate from a member who only has READ', async () => {
    await expect(service.getRevision(reader, 'rev-1')).rejects.toMatchObject({
      code: 'KNOWLEDGE_ACCESS_DENIED',
      status: 404,
    });
  });

  it('shows a candidate to the explicitly assigned reviewer', async () => {
    await expect(service.getRevision(reviewer, 'rev-1')).resolves.toMatchObject({ id: 'rev-1' });
  });

  it('retains the single-revision reviewer lookup and propagates its errors', async () => {
    const failure = new Error('Single revision lookup unavailable');
    const isAssignedReviewer = vi.fn().mockRejectedValue(failure);
    const listAssignedReviewerRevisionIds = vi.fn();
    const instance = build(null, {
      ...repository(state),
      isAssignedReviewer,
      listAssignedReviewerRevisionIds,
    });

    await expect(instance.getRevision(reviewer, 'rev-1')).rejects.toBe(failure);
    expect(isAssignedReviewer).toHaveBeenCalledExactlyOnceWith('rev-1', 'bob');
    expect(listAssignedReviewerRevisionIds).not.toHaveBeenCalled();
  });

  it('hides a candidate from the author once the author loses READ', async () => {
    const authorization = new V1AuthorizationService({
      ...authorizationRepository(),
      async findGrants() {
        return [];
      },
    });
    const denied = new V1PublicationService(
      repository(state),
      authorization,
      ticketRepository(null),
      operations,
    );
    await expect(denied.getRevision(author, 'rev-1')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('shows a published revision to any principal with current READ', async () => {
    await expect(service.getRevision(reader, 'rev-pub')).resolves.toMatchObject({ id: 'rev-pub' });
  });

  describe('idempotency', () => {
    const propose = (context = writeContext()) =>
      service.proposeRevision(
        author,
        'doc-1',
        {
          title: '候选',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('hello')),
        },
        context,
      );

    it('replays the first result for the same key and payload without a second write', async () => {
      const first = await propose();
      const second = await propose();
      expect(state.proposed).toBe(1);
      expect(second.revision.id).toBe(first.revision.id);
      expect(second.reviewRequestId).toBe(first.reviewRequestId);
    });

    it('writes twice for distinct keys even with the same payload', async () => {
      await propose(
        writeContext({
          idempotencyKey: '55555555-5555-4555-8555-555555555555',
          operationId: 'op-2',
        }),
      );
      await propose(
        writeContext({
          idempotencyKey: '66666666-6666-4666-8666-666666666666',
          operationId: 'op-3',
        }),
      );
      expect(state.proposed).toBe(2);
    });

    it('rejects the same key with a different payload instead of silently overwriting', async () => {
      await propose();
      await expect(
        service.proposeRevision(
          author,
          'doc-1',
          {
            title: '改过的候选',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('hello')),
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      expect(state.proposed).toBe(1);
    });

    it('rejects the same key on a different route', async () => {
      await propose();
      await expect(
        service.createDocument(
          author,
          'p-a',
          {
            projectId: 'p-a',
            knowledgeBaseId: 'kb-1',
            kind: 'KNOWLEDGE',
            title: 'K',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
          },
          writeContext({ route: '/api/v1/projects/p-a/documents' }),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
      expect(state.createdDocuments).toHaveLength(0);
    });

    it('replays a committed candidate even after its PRD basis moved on', async () => {
      const prdContext = writeContext({ route: '/api/v1/documents/doc-prd/revisions' });
      const proposePrd = () =>
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 'PRD 候选',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('# PRD')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope: { participatingRoleIds: ['r-product'], requiredOutputKinds: ['IMPL'] },
            acceptance: [{ key: 'login-works', text: '登录可用', verification: 'TEST' }],
          },
          prdContext,
        );

      const first = await proposePrd();
      // 首次提交后理解基线前进：直接重发同样入参会得到 BASELINE_STALE，
      // 但同一 Idempotency-Key 的重放必须返回首次结果，而不是让已生效的操作"消失"。
      state.requirement.currentUnderstandingRevisionId = 'rev-understanding-old';
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 'PRD 候选',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('# PRD')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope: { participatingRoleIds: ['r-product'], requiredOutputKinds: ['IMPL'] },
            acceptance: [{ key: 'login-works', text: '登录可用', verification: 'TEST' }],
          },
          writeContext({
            idempotencyKey: '77777777-7777-4777-8777-777777777777',
            operationId: 'op-other',
          }),
        ),
      ).rejects.toMatchObject({ code: 'BASELINE_STALE' });

      const replayed = await proposePrd();
      expect(replayed.revision.id).toBe(first.revision.id);
      expect(state.proposed).toBe(1);
    });

    it('rejects a body that cannot be canonicalised with 422 instead of 500', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope: {
              participatingRoleIds: ['r-product'],
              requiredOutputKinds: ['IMPL'],
              ratio: 1.5,
            },
            acceptance: [{ key: 'a-b', text: 'x', verification: 'TEST' }],
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });
  });

  it('filters candidate revisions out of listing for read-only members', async () => {
    const visible = await service.listRevisions(reader, 'doc-1');
    expect(visible).toHaveLength(0);
    // alice 当前具备 PROPOSE/PUBLISH，因此所有候选对她可见（不只自己写的那份）
    const forAuthor = await service.listRevisions(author, 'doc-1');
    expect(forAuthor.map((item) => item.id)).toEqual(['rev-1', 'rev-2']);
    // bob 只是 rev-1 的明确评审者，看不到他人候选
    const forReviewer = await service.listRevisions(reviewer, 'doc-1');
    expect(forReviewer.map((item) => item.id)).toEqual(['rev-1']);
  });

  describe.each(['history', 'detail', 'documents'] as const)('%s revision summaries', (kind) => {
    async function readSummaries(principal: Principal, instance = service) {
      if (kind === 'history') return instance.listRevisions(principal, 'doc-1');
      if (kind === 'detail') return (await instance.getDocument(principal, 'doc-1')).revisions;
      return (await instance.listDocuments(principal, 'p-a', {})).items[0]!.revisions;
    }

    it('preserves all visible metadata and order without returning bodyBytes', async () => {
      const repo = repository(state);
      const findRevision = vi.fn().mockRejectedValue(new Error('Summary must not load content'));
      const instance = build(null, { ...repo, findRevision });
      // The fake deliberately still returns full views: the public boundary must strip bytes too.
      const summaries = await readSummaries(author, instance);

      expect(summaries.map((item) => item.id)).toEqual(['rev-1', 'rev-2']);
      const expected = revision();
      delete (expected as Partial<V1RevisionView>).bodyBytes;
      expect(summaries[0]).toEqual(expected);
      for (const summary of summaries) expect(summary).not.toHaveProperty('bodyBytes');
      expect(findRevision).not.toHaveBeenCalled();
    });

    it('still hides other authors candidates from READ-only members and reviewers', async () => {
      await expect(readSummaries(reader)).resolves.toEqual([]);
      const summaries = await readSummaries(reviewer);
      expect(summaries.map((item) => item.id)).toEqual(['rev-1']);
      expect(summaries[0]).not.toHaveProperty('bodyBytes');
    });

    it('batches reviewer checks while preserving all visibility states, metadata and history order', async () => {
      const history = [
        revision({ id: 'published', state: 'PUBLISHED', createdBy: 'dave' }),
        revision({ id: 'assigned', createdBy: 'dave' }),
        revision({ id: 'own-reader', createdBy: 'carol' }),
        revision({ id: 'withdrawn', state: 'WITHDRAWN', createdBy: 'carol' }),
        ...Array.from({ length: 1001 }, (_, index) =>
          revision({ id: `candidate-${index}`, createdBy: 'dave', seq: 1001 - index }),
        ),
      ];
      const assigned = new Set(['assigned', 'withdrawn', 'candidate-0', 'candidate-1000']);
      const listAssignedReviewerRevisionIds = vi
        .fn()
        .mockImplementation(async (ids, userId) =>
          userId === 'bob' ? ids.filter((id: string) => assigned.has(id)) : [],
        );
      const isAssignedReviewer = vi.fn().mockRejectedValue(new Error('Unexpected per-row lookup'));
      const repo = {
        ...repository(state),
        listRevisions: vi.fn().mockResolvedValue(history),
        listAssignedReviewerRevisionIds,
        isAssignedReviewer,
      };
      const instance = build(null, repo);

      for (const [principal, expectedIds] of [
        [reviewer, ['published', 'assigned', 'candidate-0', 'candidate-1000']],
        [reader, ['published', 'own-reader']],
        [author, history.map((item) => item.id)],
        [agentRead, ['published']],
      ] as const) {
        const summaries = await readSummaries(principal, instance);
        expect(summaries.map((item) => item.id)).toEqual(expectedIds);
        expect(listAssignedReviewerRevisionIds).toHaveBeenLastCalledWith(
          history.map((item) => item.id),
          principal.userId,
        );
        for (const summary of summaries) {
          const expected = { ...history.find((item) => item.id === summary.id)! };
          delete (expected as Partial<V1RevisionView>).bodyBytes;
          expect(summary).toEqual(expected);
        }
      }
      expect(listAssignedReviewerRevisionIds).toHaveBeenCalledTimes(4);
      expect(isAssignedReviewer).not.toHaveBeenCalled();
    });

    it('resolves current assignments per request and fails closed on a lookup error', async () => {
      const failure = new Error('Reviewer lookup unavailable');
      const listAssignedReviewerRevisionIds = vi
        .fn()
        .mockResolvedValueOnce(['rev-1'])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(failure);
      const instance = build(null, { ...repository(state), listAssignedReviewerRevisionIds });

      expect((await readSummaries(reviewer, instance)).map((item) => item.id)).toEqual(['rev-1']);
      await expect(readSummaries(reviewer, instance)).resolves.toEqual([]);
      await expect(readSummaries(reviewer, instance)).rejects.toBe(failure);
      expect(listAssignedReviewerRevisionIds).toHaveBeenCalledTimes(3);
    });

    it('does not look up assignments for empty history or bypass a revoked READ grant', async () => {
      const listAssignedReviewerRevisionIds = vi.fn().mockResolvedValue(['rev-1']);
      const empty = build(null, {
        ...repository(state),
        listRevisions: vi.fn().mockResolvedValue([]),
        listAssignedReviewerRevisionIds,
      });
      await expect(readSummaries(reviewer, empty)).resolves.toEqual([]);
      expect(listAssignedReviewerRevisionIds).not.toHaveBeenCalled();

      const listRevisions = vi.fn().mockResolvedValue([revision()]);
      const denied = new V1PublicationService(
        { ...repository(state), listRevisions, listAssignedReviewerRevisionIds },
        new V1AuthorizationService({
          ...authorizationRepository(),
          async findGrants() {
            return [];
          },
        }),
        ticketRepository(null),
        operations,
      );
      if (kind === 'documents') {
        await expect(denied.listDocuments(reviewer, 'p-a', {})).resolves.toEqual({
          items: [],
          nextCursor: null,
        });
      } else {
        await expect(readSummaries(reviewer, denied)).rejects.toMatchObject({
          code: 'RESOURCE_NOT_FOUND',
          status: 404,
        });
      }
      expect(listRevisions).not.toHaveBeenCalled();
      expect(listAssignedReviewerRevisionIds).not.toHaveBeenCalled();
    });
  });

  it('keeps published metadata body-free and retrieves unchanged bytes from the content path', async () => {
    const detail = await service.getDocument(reader, 'doc-understanding');

    expect(detail.publishedRevision).toMatchObject({
      id: 'rev-understanding',
      state: 'PUBLISHED',
    });
    expect(detail.publishedRevision).not.toHaveProperty('bodyBytes');
    for (const summary of detail.revisions) expect(summary).not.toHaveProperty('bodyBytes');
    const content = await service.getRevisionContent(reader, 'rev-understanding');
    expect(content.bodyBytes).toEqual(revision().bodyBytes);
    await expect(service.getRevisionContent(reader, 'rev-1')).rejects.toMatchObject({
      code: 'KNOWLEDGE_ACCESS_DENIED',
      status: 404,
    });
  });

  it('denies an Agent proposing without the derived propose scope', async () => {
    await expect(
      service.proposeRevision(
        agentRead,
        'doc-1',
        {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
        },
        writeContext(),
      ),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED' });
  });

  it('allows an Agent with the derived propose scope to create a candidate', async () => {
    const result = await service.proposeRevision(
      agentPropose,
      'doc-1',
      {
        title: 't',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBytes: new Uint8Array(Buffer.from('x')),
      },
      writeContext(),
    );
    expect(state.proposed).toBe(1);
    expect(result.reviewKind).toBe('KNOWLEDGE_PUBLICATION');
    expect(result.slots[0]).toMatchObject({ slotKey: 'publication', requiredUserId: 'alice' });
  });

  it('derives requirement:propose for UNDERSTANDING and knowledge:propose for KNOWLEDGE', async () => {
    const kindRepo: V1PublicationRepository = {
      ...repository(state),
      async findDocument() {
        return { ...document, kind: 'UNDERSTANDING', requirementId: 'req-1' };
      },
    };
    const withDoc = new V1PublicationService(
      kindRepo,
      new V1AuthorizationService(authorizationRepository()),
      ticketRepository(null),
      operations,
    );
    await expect(
      withDoc.proposeRevision(
        { ...agentPropose, scopes: ['knowledge:read', 'knowledge:propose'] },
        'doc-1',
        {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
        },
        writeContext(),
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
  });

  it('returns 404 for unknown or non-readable documents instead of leaking existence', async () => {
    await expect(service.listRevisions(reader, 'doc-x')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  describe('PRD binding', () => {
    const deliveryScope = {
      participatingRoleIds: ['r-product'],
      requiredOutputKinds: ['IMPL', 'PRD'],
    };
    const acceptance = [{ key: 'login-works', text: '登录可用', verification: 'TEST' as const }];

    it('rejects binding fields on non-PRD documents', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-1',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            deliveryScope,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('requires basisUnderstandingRevisionId for PRD candidates', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            deliveryScope,
            acceptance,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects a basis that is not the current understanding of the requirement', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding-old',
            deliveryScope,
            acceptance,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'BASELINE_STALE', status: 409 });
    });

    it('rejects a basis whose document is no longer the published pointer', async () => {
      state.requirement.currentUnderstandingRevisionId = 'rev-understanding';
      const stalePointer: V1PublicationRepository = {
        ...repository(state),
        async findDocument(documentId) {
          if (documentId === 'doc-understanding')
            return { ...understandingDocument, currentPublishedRevisionId: 'rev-other' };
          if (documentId === 'doc-prd') return { ...prdDocument };
          return documentId === 'doc-1' ? { ...document } : null;
        },
      };
      const stale = build(null, stalePointer);
      await expect(
        stale.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope,
            acceptance,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'BASELINE_STALE', status: 409 });
    });

    it('requires IMPL in deliveryScope', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope: { participatingRoleIds: ['r-product'], requiredOutputKinds: ['PRD'] },
            acceptance,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects excluded roles that also participate', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope: {
              participatingRoleIds: ['r-product'],
              requiredOutputKinds: ['IMPL'],
              excludedRoles: [{ roleId: 'r-product', reason: '同时参与又排除' }],
            },
            acceptance,
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects duplicate acceptance keys', async () => {
      await expect(
        service.proposeRevision(
          author,
          'doc-prd',
          {
            title: 't',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
            basisUnderstandingRevisionId: 'rev-understanding',
            deliveryScope,
            acceptance: [...acceptance, ...acceptance],
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('creates a PRD candidate bound to the published understanding with PRD_PUBLICATION review', async () => {
      const result = await service.proposeRevision(
        author,
        'doc-prd',
        {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          basisUnderstandingRevisionId: 'rev-understanding',
          deliveryScope,
          acceptance,
        },
        writeContext(),
      );
      expect(result.reviewKind).toBe('PRD_PUBLICATION');
      expect(state.proposed).toBe(1);
    });

    it('creates a PRD document only with a valid published understanding basis', async () => {
      const created = await service.createDocument(
        author,
        'p-a',
        {
          projectId: 'p-a',
          knowledgeBaseId: 'kb-1',
          kind: 'PRD',
          requirementId: 'req-1',
          title: 'PRD',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('# PRD')),
          basisUnderstandingRevisionId: 'rev-understanding',
          deliveryScope,
          acceptance,
        },
        writeContext(),
      );
      expect(created.document.id).toBe('doc-created');
      expect(state.createdDocuments).toEqual([
        {
          kind: 'PRD',
          reviewKind: 'PRD_PUBLICATION',
          basisUnderstandingRevisionId: 'rev-understanding',
        },
      ]);
    });

    it('rejects a PRD document whose knowledge base belongs to another project', async () => {
      await expect(
        service.createDocument(
          author,
          'p-a',
          {
            projectId: 'p-a',
            knowledgeBaseId: 'kb-other',
            kind: 'KNOWLEDGE',
            title: 'K',
            mimeType: 'text/markdown; charset=utf-8',
            bodyBytes: new Uint8Array(Buffer.from('x')),
          },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });

  describe('restore', () => {
    it('creates a new candidate without touching the published pointer', async () => {
      const result = await service.restoreRevision(
        author,
        'doc-1',
        { sourceRevisionId: 'rev-2' },
        writeContext(),
      );
      expect(result.revision.id).toBe('rev-restored');
      expect(state.restored).toBe(1);
    });

    it('refuses restoring a revision from another document', async () => {
      await expect(
        service.restoreRevision(
          author,
          'doc-1',
          { sourceRevisionId: 'rev-understanding' },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('refuses writing to an archived document', async () => {
      await expect(
        service.restoreRevision(
          author,
          'doc-archived',
          { sourceRevisionId: 'rev-1' },
          writeContext(),
        ),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });

  describe('withdraw', () => {
    const withdrawInput = {
      expectedVersion: 3,
      reason: '内容已过时',
      confirmation: { ticketId: 'ticket-1', ticketSecret: TICKET_SECRET },
      webSessionId: 'sess-1',
      userAuthVersion: 0,
      now: new Date('2026-11-01T00:00:00Z'),
    };

    it('rejects withdraw without a server-side ticket', async () => {
      await expect(service.withdraw(authorSession, 'doc-1', withdrawInput)).rejects.toMatchObject({
        code: 'CONFIRMATION_INVALID',
        status: 403,
      });
    });

    it('rejects a ticket issued to another web session', async () => {
      const other = build(withdrawTicket({ webSessionId: 'sess-2' }));
      await expect(other.withdraw(authorSession, 'doc-1', withdrawInput)).rejects.toMatchObject({
        code: 'CONFIRMATION_INVALID',
        details: expect.objectContaining({ ticketId: 'ticket-1' }),
      });
    });

    it('rejects a ticket whose version no longer matches the document', async () => {
      const other = build(withdrawTicket({ expectedVersion: 2 }));
      await expect(other.withdraw(authorSession, 'doc-1', withdrawInput)).rejects.toMatchObject({
        code: 'ACTION_CHANGED',
        status: 409,
      });
    });

    it('rejects a consumed ticket', async () => {
      const other = build(
        withdrawTicket({
          consumedAt: new Date('2026-10-31T23:00:00Z'),
          consumedOperationId: 'op-1',
        }),
      );
      await expect(other.withdraw(authorSession, 'doc-1', withdrawInput)).rejects.toMatchObject({
        code: 'CONFIRMATION_USED',
      });
    });

    it('refuses an Agent even when the granting user holds PUBLISH', async () => {
      // PUBLISH/REVOKE 永不下放给 Agent，因此无论供权人的 grant 如何都只能是 HUMAN 才能撤回。
      await expect(
        build(withdrawTicket()).withdraw(agentPropose, 'doc-1', withdrawInput),
      ).rejects.toMatchObject({
        code: 'HUMAN_SESSION_REQUIRED',
        status: 403,
      });
    });

    it('refuses an empty reason before consuming any ticket', async () => {
      await expect(
        build(withdrawTicket()).withdraw(authorSession, 'doc-1', {
          ...withdrawInput,
          reason: '   ',
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
      expect(state.withdrawn).toEqual([]);
    });

    it('consumes a bound ticket and delegates the pointer clear to the repository', async () => {
      const result = await build(withdrawTicket()).withdraw(authorSession, 'doc-1', withdrawInput);
      expect(result).toEqual({ documentVersion: 4, publicationId: 'pub-1' });
      expect(state.withdrawn).toEqual([
        { expectedVersion: 3, reason: '内容已过时', ticketWebSessionId: 'sess-1' },
      ]);
    });
  });
});
