import { beforeEach, describe, expect, it } from 'vitest';
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
  type V1CreateDocumentResult,
  type V1DocumentView,
  type V1ProposeRevisionResult,
  type V1PublicationRepository,
  type V1RevisionView,
} from './v1-publication.service';

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
  createdDocuments: Array<{ kind: string; reviewKind: string; basisUnderstandingRevisionId: string | null }>;
  restored: number;
  withdrawn: Array<{ expectedVersion: number; reason: string; ticketWebSessionId: string }>;
};

function repository(state: State): V1PublicationRepository {
  const docs: Record<string, V1DocumentView> = {
    'doc-1': document,
    'doc-understanding': understandingDocument,
    'doc-prd': prdDocument,
    'doc-archived': { ...document, id: 'doc-archived', archivedAt: new Date('2026-01-01T00:00:00Z') },
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
    slots: [{ id: 'slot-1', slotKey: 'publication', requiredUserId: 'alice', requiredRoleId: null }],
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
    async createDocument(input): Promise<V1CreateDocumentResult> {
      state.createdDocuments.push({
        kind: input.kind,
        reviewKind: input.reviewKind,
        basisUnderstandingRevisionId: input.basisUnderstandingRevisionId,
      });
      return { document: { ...prdDocument, id: 'doc-created' }, revision: revision({ id: 'rev-created' }), reviewKind: input.reviewKind, ...feedback };
    },
    async proposeRevision(input): Promise<V1ProposeRevisionResult> {
      state.proposed += 1;
      return { revision: revision(), reviewKind: input.reviewKind, ...feedback };
    },
    async restoreRevision(input): Promise<V1ProposeRevisionResult> {
      state.restored += 1;
      return { revision: revision({ id: 'rev-restored' }), reviewKind: input.reviewKind, ...feedback };
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

  function build(ticket: V1TicketRecord | null = null, repo: V1PublicationRepository = repository(state)) {
    return new V1PublicationService(repo, new V1AuthorizationService(authorizationRepository()), ticketRepository(ticket));
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
    service = build();
  });

  it('shows a candidate to its author who still has READ', async () => {
    await expect(service.getRevision(author, 'rev-1')).resolves.toMatchObject({ id: 'rev-1', state: 'CANDIDATE' });
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

  it('hides a candidate from the author once the author loses READ', async () => {
    const authorization = new V1AuthorizationService({
      ...authorizationRepository(),
      async findGrants() {
        return [];
      },
    });
    const denied = new V1PublicationService(repository(state), authorization, ticketRepository(null));
    await expect(denied.getRevision(author, 'rev-1')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('shows a published revision to any principal with current READ', async () => {
    await expect(service.getRevision(reader, 'rev-pub')).resolves.toMatchObject({ id: 'rev-pub' });
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

  it('denies an Agent proposing without the derived propose scope', async () => {
    await expect(
      service.proposeRevision(agentRead, 'doc-1', {
        title: 't',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBytes: new Uint8Array(Buffer.from('x')),
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_PROPOSE_PERMISSION_REQUIRED' });
  });

  it('allows an Agent with the derived propose scope to create a candidate', async () => {
    const result = await service.proposeRevision(agentPropose, 'doc-1', {
      title: 't',
      mimeType: 'text/markdown; charset=utf-8',
      bodyBytes: new Uint8Array(Buffer.from('x')),
    });
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
    const withDoc = new V1PublicationService(kindRepo, new V1AuthorizationService(authorizationRepository()), ticketRepository(null));
    await expect(
      withDoc.proposeRevision(
        { ...agentPropose, scopes: ['knowledge:read', 'knowledge:propose'] },
        'doc-1',
        { title: 't', mimeType: 'text/markdown; charset=utf-8', bodyBytes: new Uint8Array(Buffer.from('x')) },
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
    const deliveryScope = { participatingRoleIds: ['r-product'], requiredOutputKinds: ['IMPL', 'PRD'] };
    const acceptance = [{ key: 'login-works', text: '登录可用', verification: 'TEST' as const }];

    it('rejects binding fields on non-PRD documents', async () => {
      await expect(
        service.proposeRevision(author, 'doc-1', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          deliveryScope,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('requires basisUnderstandingRevisionId for PRD candidates', async () => {
      await expect(
        service.proposeRevision(author, 'doc-prd', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          deliveryScope,
          acceptance,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects a basis that is not the current understanding of the requirement', async () => {
      await expect(
        service.proposeRevision(author, 'doc-prd', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          basisUnderstandingRevisionId: 'rev-understanding-old',
          deliveryScope,
          acceptance,
        }),
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
        stale.proposeRevision(author, 'doc-prd', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          basisUnderstandingRevisionId: 'rev-understanding',
          deliveryScope,
          acceptance,
        }),
      ).rejects.toMatchObject({ code: 'BASELINE_STALE', status: 409 });
    });

    it('requires IMPL in deliveryScope', async () => {
      await expect(
        service.proposeRevision(author, 'doc-prd', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          basisUnderstandingRevisionId: 'rev-understanding',
          deliveryScope: { participatingRoleIds: ['r-product'], requiredOutputKinds: ['PRD'] },
          acceptance,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects excluded roles that also participate', async () => {
      await expect(
        service.proposeRevision(author, 'doc-prd', {
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
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('rejects duplicate acceptance keys', async () => {
      await expect(
        service.proposeRevision(author, 'doc-prd', {
          title: 't',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
          basisUnderstandingRevisionId: 'rev-understanding',
          deliveryScope,
          acceptance: [...acceptance, ...acceptance],
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
    });

    it('creates a PRD candidate bound to the published understanding with PRD_PUBLICATION review', async () => {
      const result = await service.proposeRevision(author, 'doc-prd', {
        title: 't',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBytes: new Uint8Array(Buffer.from('x')),
        basisUnderstandingRevisionId: 'rev-understanding',
        deliveryScope,
        acceptance,
      });
      expect(result.reviewKind).toBe('PRD_PUBLICATION');
      expect(state.proposed).toBe(1);
    });

    it('creates a PRD document only with a valid published understanding basis', async () => {
      const created = await service.createDocument(author, 'p-a', {
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
      });
      expect(created.document.id).toBe('doc-created');
      expect(state.createdDocuments).toEqual([
        { kind: 'PRD', reviewKind: 'PRD_PUBLICATION', basisUnderstandingRevisionId: 'rev-understanding' },
      ]);
    });

    it('rejects a PRD document whose knowledge base belongs to another project', async () => {
      await expect(
        service.createDocument(author, 'p-a', {
          projectId: 'p-a',
          knowledgeBaseId: 'kb-other',
          kind: 'KNOWLEDGE',
          title: 'K',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBytes: new Uint8Array(Buffer.from('x')),
        }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });
  });

  describe('restore', () => {
    it('creates a new candidate without touching the published pointer', async () => {
      const result = await service.restoreRevision(author, 'doc-1', { sourceRevisionId: 'rev-2' });
      expect(result.revision.id).toBe('rev-restored');
      expect(state.restored).toBe(1);
    });

    it('refuses restoring a revision from another document', async () => {
      await expect(
        service.restoreRevision(author, 'doc-1', { sourceRevisionId: 'rev-understanding' }),
      ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });
    });

    it('refuses writing to an archived document', async () => {
      await expect(
        service.restoreRevision(author, 'doc-archived', { sourceRevisionId: 'rev-1' }),
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
      const other = build(withdrawTicket({ consumedAt: new Date('2026-10-31T23:00:00Z'), consumedOperationId: 'op-1' }));
      await expect(other.withdraw(authorSession, 'doc-1', withdrawInput)).rejects.toMatchObject({ code: 'CONFIRMATION_USED' });
    });

    it('refuses an Agent even when the granting user holds PUBLISH', async () => {
      // PUBLISH/REVOKE 永不下放给 Agent，因此无论供权人的 grant 如何都只能是 HUMAN 才能撤回。
      await expect(build(withdrawTicket()).withdraw(agentPropose, 'doc-1', withdrawInput)).rejects.toMatchObject({
        code: 'HUMAN_SESSION_REQUIRED',
        status: 403,
      });
    });

    it('refuses an empty reason before consuming any ticket', async () => {
      await expect(
        build(withdrawTicket()).withdraw(authorSession, 'doc-1', { ...withdrawInput, reason: '   ' }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST', status: 422 });
      expect(state.withdrawn).toEqual([]);
    });

    it('consumes a bound ticket and delegates the pointer clear to the repository', async () => {
      const result = await build(withdrawTicket()).withdraw(authorSession, 'doc-1', withdrawInput);
      expect(result).toEqual({ documentVersion: 4, publicationId: 'pub-1' });
      expect(state.withdrawn).toEqual([{ expectedVersion: 3, reason: '内容已过时', ticketWebSessionId: 'sess-1' }]);
    });
  });
});
