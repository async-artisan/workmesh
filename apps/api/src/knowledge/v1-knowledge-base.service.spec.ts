import { beforeEach, describe, expect, it } from 'vitest';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Principal,
} from '@workmesh/shared';
import {
  V1AuthorizationService,
  type V1AuthorizationRepository,
  type V1GrantRecord,
  type V1KnowledgeBaseRecord,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from '../auth/v1-authorization';
import {
  actionDigestOf,
  hashTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketCreateInput,
  type V1TicketRecord,
} from '../auth/v1-confirmation';
import { type V1IdempotencyRepository, type V1OperationRecord } from '../common/v1-idempotency';
import { searchExcerptOf } from './v1-knowledge-base-policy';
import {
  V1KnowledgeBaseService,
  type V1KnowledgeActionContext,
  type V1KnowledgeReplaceContext,
  type V1ReplaceKnowledgeAccessInput,
} from './v1-knowledge-base.service';
import type {
  V1KnowledgeBaseAccessView,
  V1KnowledgeBaseGrantView,
  V1KnowledgeBaseRepository,
  V1KnowledgeBaseSearchItem,
  V1KnowledgeBaseView,
  V1KnowledgeGrantInput,
} from './v1-knowledge-base.repository';

const PROJECT_ID = 'p1';
const OWNER_ID = 'alice';
const MEMBER_ID = 'bob';
const OTHER_ID = 'carol';
const SECRET = 'ticket-secret';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';

const owner: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: OWNER_ID,
  scopes: [],
  sessionId: 'sess-1',
  authVersion: 1,
};
const member: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: MEMBER_ID,
  scopes: [],
  sessionId: 'sess-2',
  authVersion: 1,
};
const other: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: OTHER_ID,
  scopes: [],
  sessionId: 'sess-3',
  authVersion: 1,
};
const agent: Principal = {
  kind: 'AGENT',
  userId: OWNER_ID,
  agentCredentialId: 'cred-1',
  projectId: PROJECT_ID,
  roleIds: ['r-reviewer'],
  scopes: ['knowledge:read'],
};

type StoredKnowledgeBase = V1KnowledgeBaseView & { createdAt: Date };
type StoredGrant = Omit<V1KnowledgeBaseGrantView, 'grantedAt' | 'revokedAt'> & {
  knowledgeBaseId: string;
  projectId: string;
  grantedAt: Date;
  revokedAt: Date | null;
};
type StoredDocument = {
  id: string;
  kind: string;
  currentPublishedRevisionId: string | null;
  archivedAt: Date | null;
  knowledgeBaseId: string;
};
type StoredRevision = {
  id: string;
  documentId: string;
  title: string;
  bodyBytes: Uint8Array;
  sha256: string;
};

class MemoryStore implements V1KnowledgeBaseRepository {
  projects = new Map<string, V1ProjectRecord>();
  members = new Map<string, V1MemberRecord>();
  assignments = new Map<string, V1RoleAssignmentRecord[]>();
  roles = new Map<string, { id: string; projectId: string; isActive: boolean }>();
  knowledgeBases = new Map<string, StoredKnowledgeBase>();
  grants = new Map<string, StoredGrant>();
  documents = new Map<string, StoredDocument>();
  revisions = new Map<string, StoredRevision>();
  audits: Array<{ action: string; targetId: string; details: Record<string, unknown> }> = [];
  operations = new Map<string, V1OperationRecord>();
  private sequence = 0;
  private clock = new Date('2026-01-01T00:00:00.000Z');

  seedKnowledgeBase(input: {
    id: string;
    visibility: 'PROJECT' | 'RESTRICTED';
    key: string;
    name: string;
    kind?: string;
    approverUserId?: string;
    approverRoleId?: string | null;
    version?: number;
    authzVersion?: number;
  }): void {
    this.knowledgeBases.set(input.id, {
      id: input.id,
      projectId: PROJECT_ID,
      key: input.key,
      name: input.name,
      kind: input.kind ?? 'SYSTEM',
      visibility: input.visibility,
      version: input.version ?? 1,
      authzVersion: input.authzVersion ?? 1,
      publicationApproverUserId: input.approverUserId ?? OWNER_ID,
      publicationApproverRoleId: input.approverRoleId ?? null,
      archivedAt: null,
      createdAt: this.nextClock(),
    });
  }

  seedGrant(
    input: Omit<StoredGrant, 'projectId' | 'grantedAt' | 'revokedAt' | 'version'> & {
      revoked?: boolean;
    },
  ): void {
    const id = input.id;
    this.grants.set(id, {
      ...input,
      projectId: PROJECT_ID,
      version: 1,
      grantedAt: this.nextClock(),
      revokedAt: input.revoked ? this.nextClock() : null,
    });
  }

  seedDocument(input: {
    id: string;
    kind?: string;
    publishedRevisionId: string | null;
    archivedAt?: Date | null;
  }): void {
    this.documents.set(input.id, {
      id: input.id,
      kind: input.kind ?? 'KNOWLEDGE',
      currentPublishedRevisionId: input.publishedRevisionId,
      archivedAt: input.archivedAt ?? null,
      knowledgeBaseId: 'kb-project',
    });
  }

  seedRevision(input: {
    id: string;
    documentId: string;
    title: string;
    body: string | Uint8Array;
    sha256?: string;
  }): void {
    this.revisions.set(input.id, {
      id: input.id,
      documentId: input.documentId,
      title: input.title,
      bodyBytes:
        typeof input.body === 'string'
          ? new Uint8Array(Buffer.from(input.body, 'utf8'))
          : input.body,
      sha256: input.sha256 ?? 'a'.repeat(64),
    });
  }

  private nextClock(): Date {
    this.clock = new Date(this.clock.getTime() + 1000);
    return new Date(this.clock);
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  // --- V1AuthorizationRepository ---

  async findProject(id: string): Promise<V1ProjectRecord | null> {
    return this.projects.get(id) ?? null;
  }

  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }

  async findActiveRoleAssignments(
    projectId: string,
    userId: string,
  ): Promise<V1RoleAssignmentRecord[]> {
    return this.assignments.get(`${projectId}:${userId}`) ?? [];
  }

  async findRoleAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<V1RoleAssignmentRecord | null> {
    return (
      (this.assignments.get(`${projectId}:${userId}`) ?? []).find(
        (item) => item.roleId === roleId,
      ) ?? null
    );
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseView | null> {
    const row = this.knowledgeBases.get(knowledgeBaseId);
    if (!row) return null;
    return { ...row };
  }

  async findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]> {
    return this.grantRows(knowledgeBaseId).map((grant) => ({
      id: grant.id,
      knowledgeBaseId,
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectUserId,
      subjectRoleId: grant.subjectRoleId,
      permissions: grant.permissions,
      revokedAt: grant.revokedAt,
    }));
  }

  private grantRows(knowledgeBaseId: string): StoredGrant[] {
    return [...this.grants.values()]
      .filter((grant) => grant.knowledgeBaseId === knowledgeBaseId)
      .sort(
        (left, right) =>
          left.grantedAt.getTime() - right.grantedAt.getTime() || left.id.localeCompare(right.id),
      );
  }

  private grantView(grant: StoredGrant): V1KnowledgeBaseGrantView {
    return {
      id: grant.id,
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectUserId,
      subjectRoleId: grant.subjectRoleId,
      permissions: grant.permissions,
      version: grant.version,
      grantedAt: grant.grantedAt.toISOString(),
      revokedAt: grant.revokedAt ? grant.revokedAt.toISOString() : null,
    };
  }

  // --- V1KnowledgeBaseRepository ---

  async listKnowledgeBases(
    projectId: string,
    query: { limit: number; cursor: string | null; management: boolean; principalUserId: string },
  ): Promise<{ items: V1KnowledgeBaseView[]; nextCursor: string | null; hasMore: boolean }> {
    const rows = [...this.knowledgeBases.values()]
      .filter((row) => row.projectId === projectId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      );
    const start = query.cursor
      ? Number(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      : 0;
    const page = rows.slice(start, start + query.limit);
    return {
      items: page.map(({ createdAt: _createdAt, ...view }) => view),
      nextCursor:
        start + query.limit < rows.length
          ? Buffer.from(String(start + query.limit), 'utf8').toString('base64url')
          : null,
      hasMore: start + query.limit < rows.length,
    };
  }

  async createKnowledgeBase(input: {
    projectId: string;
    key: string;
    name: string;
    visibility: 'PROJECT' | 'RESTRICTED';
    creatorUserId: string;
    now: Date;
    operation: {
      id: string;
      projectScopeKey: string;
      principalScopeKey: string;
      key: string;
      method: string;
      route: string;
      requestDigest: string;
    };
  }): Promise<V1KnowledgeBaseView> {
    const duplicate = [...this.knowledgeBases.values()].find(
      (row) => row.projectId === input.projectId && row.key === input.key,
    );
    if (duplicate)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'KNOWLEDGE_BASE_KEY_CONFLICT',
        { projectId: input.projectId, key: input.key },
        409,
      );

    const id = this.nextId('kb');
    const row: StoredKnowledgeBase = {
      id,
      projectId: input.projectId,
      key: input.key,
      name: input.name,
      kind: 'SYSTEM',
      visibility: input.visibility,
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: input.creatorUserId,
      publicationApproverRoleId: null,
      archivedAt: null,
      createdAt: this.nextClock(),
    };
    this.knowledgeBases.set(id, row);
    this.grants.set('grant-creator-' + id, {
      id: 'grant-creator-' + id,
      knowledgeBaseId: id,
      projectId: input.projectId,
      subjectKind: 'USER',
      subjectUserId: input.creatorUserId,
      subjectRoleId: null,
      permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
      version: 1,
      grantedAt: input.now,
      revokedAt: null,
    });
    this.audits.push({
      action: 'KNOWLEDGE_BASE_CREATE',
      targetId: id,
      details: { key: input.key, visibility: input.visibility },
    });
    const view: V1KnowledgeBaseView = {
      id,
      projectId: input.projectId,
      key: input.key,
      name: input.name,
      kind: 'SYSTEM',
      visibility: input.visibility,
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: input.creatorUserId,
      publicationApproverRoleId: null,
      archivedAt: null,
    };
    this.operations.set(
      `${input.operation.projectScopeKey}|${input.operation.principalScopeKey}|${input.operation.key}`,
      {
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { knowledgeBase: view },
        committedAt: input.now,
      },
    );
    return view;
  }

  async listAccessGrants(knowledgeBaseId: string): Promise<V1KnowledgeBaseGrantView[]> {
    return this.grantRows(knowledgeBaseId).map((grant) => this.grantView(grant));
  }

  async replaceAccess(input: {
    knowledgeBaseId: string;
    expectedVersion: number;
    expectedAuthzVersion: number;
    visibility: 'PROJECT' | 'RESTRICTED';
    publicationApproverUserId: string;
    publicationApproverRoleId: string | null;
    grants: V1KnowledgeGrantInput[];
    reason: string;
    actorUserId: string;
    ticket: { id: string; secretHash: string; webSessionId: string };
    operation: {
      id: string;
      projectScopeKey: string;
      principalScopeKey: string;
      key: string;
      method: string;
      route: string;
      requestDigest: string;
    };
    now: Date;
  }): Promise<V1KnowledgeBaseAccessView> {
    const row = this.knowledgeBases.get(input.knowledgeBaseId);
    if (!row)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_BASE_NOT_FOUND',
        { knowledgeBaseId: input.knowledgeBaseId },
        404,
      );
    if (row.version !== input.expectedVersion || row.authzVersion !== input.expectedAuthzVersion)
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        'VERSION_CONFLICT',
        {
          knowledgeBaseId: input.knowledgeBaseId,
          expectedVersion: input.expectedVersion,
          expectedAuthzVersion: input.expectedAuthzVersion,
        },
        409,
      );

    for (const grant of this.grants.values()) {
      if (grant.knowledgeBaseId === input.knowledgeBaseId && grant.revokedAt === null) {
        grant.revokedAt = input.now;
        grant.version += 1;
      }
    }
    input.grants.forEach((grant, index) => {
      const id = `${input.operation.id}-grant-${index}`;
      this.grants.set(id, {
        id,
        knowledgeBaseId: input.knowledgeBaseId,
        projectId: row.projectId,
        subjectKind: grant.subjectKind,
        subjectUserId: grant.subjectUserId,
        subjectRoleId: grant.subjectRoleId,
        permissions: grant.permissions,
        version: 1,
        grantedAt: input.now,
        revokedAt: null,
      });
    });

    row.visibility = input.visibility;
    row.publicationApproverUserId = input.publicationApproverUserId;
    row.publicationApproverRoleId = input.publicationApproverRoleId;
    row.version += 1;
    row.authzVersion += 1;

    const grants = await this.listAccessGrants(input.knowledgeBaseId);
    const view: V1KnowledgeBaseAccessView = {
      knowledgeBaseId: row.id,
      projectId: row.projectId,
      visibility: row.visibility,
      version: row.version,
      authzVersion: row.authzVersion,
      publicationApproverUserId: row.publicationApproverUserId,
      publicationApproverRoleId: row.publicationApproverRoleId,
      grants,
    };
    this.audits.push({
      action: 'KB_ACCESS_REPLACE',
      targetId: row.id,
      details: { visibility: input.visibility, reason: input.reason },
    });
    this.operations.set(
      `${input.operation.projectScopeKey}|${input.operation.principalScopeKey}|${input.operation.key}`,
      {
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { access: view },
        committedAt: input.now,
      },
    );
    return view;
  }

  async searchKnowledgeBase(input: {
    knowledgeBaseId: string;
    knowledgeBaseName: string;
    knowledgeBaseKind: string;
    q: string;
    limit: number;
    cursor: string | null;
  }): Promise<{
    items: V1KnowledgeBaseSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
    truncated: boolean;
  }> {
    const published = [...this.documents.values()]
      .filter(
        (document) =>
          document.knowledgeBaseId === input.knowledgeBaseId &&
          document.archivedAt === null &&
          document.currentPublishedRevisionId !== null,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const start = input.cursor
      ? Number(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      : 0;
    const matches: V1KnowledgeBaseSearchItem[] = [];
    for (const document of published) {
      const revision = this.revisions.get(document.currentPublishedRevisionId!);
      if (!revision || revision.documentId !== document.id) continue;
      const excerpt = searchExcerptOf(revision.title, revision.bodyBytes, input.q);
      if (excerpt === null) continue;
      matches.push({
        knowledgeBaseId: input.knowledgeBaseId,
        knowledgeBaseName: input.knowledgeBaseName,
        knowledgeBaseKind: input.knowledgeBaseKind,
        revisionId: revision.id,
        documentId: document.id,
        documentKind: document.kind,
        status: 'PUBLISHED',
        title: revision.title,
        excerpt,
        sha256: revision.sha256,
      });
    }
    const page = matches.slice(start, start + input.limit);
    return {
      items: page,
      nextCursor:
        start + input.limit < matches.length
          ? Buffer.from(String(start + input.limit), 'utf8').toString('base64url')
          : null,
      hasMore: start + input.limit < matches.length,
      truncated: false,
    };
  }

  async findProjectRoles(
    projectId: string,
    roleIds: readonly string[],
  ): Promise<Array<{ id: string; projectId: string; isActive: boolean }>> {
    return [...this.roles.values()].filter(
      (role) => role.projectId === projectId && roleIds.includes(role.id),
    );
  }

  // --- V1IdempotencyRepository ---

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
}

class MemoryAuthzRepository implements V1AuthorizationRepository {
  constructor(private readonly store: MemoryStore) {}

  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    return this.store.findProject(projectId);
  }

  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.store.findMember(projectId, userId);
  }

  async findActiveRoleAssignments(
    projectId: string,
    userId: string,
  ): Promise<V1RoleAssignmentRecord[]> {
    return this.store.findActiveRoleAssignments(projectId, userId);
  }

  async findRoleAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<V1RoleAssignmentRecord | null> {
    return this.store.findRoleAssignment(projectId, userId, roleId);
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseRecord | null> {
    const row = this.store.knowledgeBases.get(knowledgeBaseId);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      visibility: row.visibility,
      version: row.version,
      authzVersion: row.authzVersion,
      publicationApproverUserId: row.publicationApproverUserId,
      publicationApproverRoleId: row.publicationApproverRoleId,
      archivedAt: row.archivedAt === null ? null : new Date(row.archivedAt),
    };
  }

  async findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]> {
    return this.store.findGrants(knowledgeBaseId);
  }
}

class MemoryIdempotencyRepository implements V1IdempotencyRepository {
  constructor(private readonly store: MemoryStore) {}

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return this.store.findOperation(input);
  }
}

class MemoryConfirmationRepository implements V1ConfirmationRepository {
  tickets = new Map<string, V1TicketRecord>();

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async createTicket(input: V1TicketCreateInput): Promise<V1TicketRecord> {
    const { now, ...rest } = input;
    const ticket: V1TicketRecord = {
      ...rest,
      createdAt: now,
      consumedAt: null,
      consumedOperationId: null,
      invalidatedAt: null,
    };
    this.tickets.set(ticket.id, ticket);
    return ticket;
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  async consumeTicket(input: {
    ticketId: string;
    secretHash: string;
    webSessionId: string;
    operationId: string;
    now: Date;
  }): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    const ticket = this.tickets.get(input.ticketId) ?? null;
    return { consumed: Boolean(ticket), ticket };
  }
}

function seedBase(store: MemoryStore): void {
  store.projects.set(PROJECT_ID, { id: PROJECT_ID, version: 1, archivedAt: null });
  store.members.set(`${PROJECT_ID}:${OWNER_ID}`, {
    projectId: PROJECT_ID,
    userId: OWNER_ID,
    role: 'OWNER',
    version: 1,
    revokedAt: null,
  });
  store.members.set(`${PROJECT_ID}:${MEMBER_ID}`, {
    projectId: PROJECT_ID,
    userId: MEMBER_ID,
    role: 'MEMBER',
    version: 1,
    revokedAt: null,
  });
  store.members.set(`${PROJECT_ID}:${OTHER_ID}`, {
    projectId: PROJECT_ID,
    userId: OTHER_ID,
    role: 'MEMBER',
    version: 1,
    revokedAt: null,
  });
  store.roles.set('r-product', { id: 'r-product', projectId: PROJECT_ID, isActive: true });
  store.roles.set('r-reviewer', { id: 'r-reviewer', projectId: PROJECT_ID, isActive: true });
  store.roles.set('r-inactive', { id: 'r-inactive', projectId: PROJECT_ID, isActive: false });
  store.assignments.set(`${PROJECT_ID}:${MEMBER_ID}`, [
    {
      id: 'as-bob',
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
      roleId: 'r-reviewer',
      version: 1,
      revokedAt: null,
    },
  ]);
  store.assignments.set(`${PROJECT_ID}:${OWNER_ID}`, [
    {
      id: 'as-alice',
      projectId: PROJECT_ID,
      userId: OWNER_ID,
      roleId: 'r-product',
      version: 1,
      revokedAt: null,
    },
  ]);

  store.seedKnowledgeBase({
    id: 'kb-project',
    key: 'project-knowledge',
    name: '项目知识',
    kind: 'BUSINESS',
    visibility: 'PROJECT',
  });
  store.seedKnowledgeBase({
    id: 'kb-restricted',
    key: 'restricted',
    name: '受限知识',
    kind: 'SYSTEM',
    visibility: 'RESTRICTED',
  });
  store.seedKnowledgeBase({
    id: 'kb-private',
    key: 'private',
    name: '私库',
    kind: 'PRACTICE',
    visibility: 'RESTRICTED',
  });
  store.seedGrant({
    id: 'g-owner',
    knowledgeBaseId: 'kb-project',
    subjectKind: 'USER',
    subjectUserId: OWNER_ID,
    subjectRoleId: null,
    permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
  });
  store.seedGrant({
    id: 'g-old-revoked',
    knowledgeBaseId: 'kb-project',
    subjectKind: 'USER',
    subjectUserId: OTHER_ID,
    subjectRoleId: null,
    permissions: ['READ'],
    revoked: true,
  });
  store.seedGrant({
    id: 'g-bob',
    knowledgeBaseId: 'kb-restricted',
    subjectKind: 'USER',
    subjectUserId: MEMBER_ID,
    subjectRoleId: null,
    permissions: ['READ', 'PROPOSE'],
  });

  store.seedDocument({
    id: 'doc-published',
    kind: 'UNDERSTANDING',
    publishedRevisionId: 'rev-published',
  });
  store.seedDocument({ id: 'doc-candidate', publishedRevisionId: null });
  store.seedDocument({ id: 'doc-other', publishedRevisionId: 'rev-other' });
  store.seedRevision({
    id: 'rev-published',
    documentId: 'doc-published',
    title: 'Release Notes',
    body: 'The release ships on Friday.',
  });
  store.seedRevision({
    id: 'rev-candidate',
    documentId: 'doc-candidate',
    title: 'Release draft',
    body: 'Only candidates mention release.',
  });
  store.seedRevision({
    id: 'rev-other',
    documentId: 'doc-other',
    title: 'Handbook',
    body: 'Nothing to see here.',
  });
}

function context(
  body: Record<string, unknown>,
  overrides: Partial<V1KnowledgeActionContext> = {},
): V1KnowledgeActionContext {
  return {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    method: 'POST',
    route: '/api/v1/projects/p1/knowledge-bases',
    body,
    requestId: 'req-1',
    now: new Date('2026-02-01T00:00:00.000Z'),
    operationId: 'op-1',
    ...overrides,
  };
}

function replaceContext(
  body: Record<string, unknown>,
  overrides: Partial<V1KnowledgeReplaceContext> = {},
): V1KnowledgeReplaceContext {
  return {
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    method: 'PUT',
    route: '/api/v1/knowledge-bases/kb-restricted/access',
    body,
    requestId: 'req-2',
    now: new Date('2026-02-02T00:00:00.000Z'),
    operationId: 'op-2',
    webSessionId: 'sess-1',
    userAuthVersion: 1,
    ...overrides,
  };
}

function replaceBody(input: V1ReplaceKnowledgeAccessInput): Record<string, unknown> {
  return {
    expectedVersion: input.expectedVersion,
    expectedAuthzVersion: input.expectedAuthzVersion,
    visibility: input.visibility,
    publicationApproverUserId: input.publicationApproverUserId,
    publicationApproverRoleId: input.publicationApproverRoleId,
    grants: input.grants.map((grant) => ({
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectUserId,
      subjectRoleId: grant.subjectRoleId,
      permissions: grant.permissions,
    })),
    reason: input.reason,
  };
}

function bindingOf(input: V1ReplaceKnowledgeAccessInput): ActionBinding {
  return {
    action: 'KB_ACCESS_REPLACE',
    projectId: PROJECT_ID,
    targetType: 'KNOWLEDGE_BASE',
    targetId: 'kb-restricted',
    expectedVersion: input.expectedVersion,
    roleSlot: null,
    payload: {
      expectedAuthzVersion: input.expectedAuthzVersion,
      visibility: input.visibility,
      publicationApproverUserId: input.publicationApproverUserId,
      publicationApproverRoleId: input.publicationApproverRoleId,
      grants: input.grants.map((grant) => ({
        subjectKind: grant.subjectKind,
        subjectUserId: grant.subjectUserId,
        subjectRoleId: grant.subjectRoleId,
        permissions: grant.permissions,
      })),
      reason: input.reason,
    },
  };
}

function ticketFor(
  binding: ActionBinding,
  overrides: Partial<V1TicketRecord> = {},
): V1TicketRecord {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    secretHash: hashTicketSecret(SECRET),
    userId: OWNER_ID,
    webSessionId: 'sess-1',
    projectId: PROJECT_ID,
    userAuthVersion: 1,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: null,
    approvalSlotId: null,
    createdAt: new Date('2026-01-30T00:00:00.000Z'),
    expiresAt: new Date('2026-02-10T00:00:00.000Z'),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  };
}

const validReplaceInput: V1ReplaceKnowledgeAccessInput = {
  expectedVersion: 1,
  expectedAuthzVersion: 1,
  visibility: 'RESTRICTED',
  publicationApproverUserId: OWNER_ID,
  publicationApproverRoleId: 'r-product',
  grants: [
    { subjectKind: 'USER', subjectUserId: MEMBER_ID, subjectRoleId: null, permissions: ['READ'] },
    {
      subjectKind: 'ROLE',
      subjectUserId: null,
      subjectRoleId: 'r-product',
      permissions: ['READ', 'PROPOSE'],
    },
  ],
  reason: '调整可见范围',
  confirmation: { ticketId: TICKET_ID, ticketSecret: SECRET },
};

describe('V1KnowledgeBaseService', () => {
  let store: MemoryStore;
  let confirmations: MemoryConfirmationRepository;
  let service: V1KnowledgeBaseService;

  beforeEach(() => {
    store = new MemoryStore();
    confirmations = new MemoryConfirmationRepository();
    seedBase(store);
    const authorization = new V1AuthorizationService(new MemoryAuthzRepository(store));
    service = new V1KnowledgeBaseService(
      store,
      authorization,
      confirmations,
      new MemoryIdempotencyRepository(store),
    );
  });

  it('HUMAN OWNER 创建 KB 并显式授予创建者全部内容权限，同时写审计与幂等结果', async () => {
    const created = await service.createKnowledgeBase(
      owner,
      PROJECT_ID,
      { key: 'design-notes', name: '设计笔记', visibility: 'RESTRICTED' },
      context({ key: 'design-notes', name: '设计笔记', visibility: 'RESTRICTED' }),
    );

    expect(created).toMatchObject({
      projectId: PROJECT_ID,
      key: 'design-notes',
      visibility: 'RESTRICTED',
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: OWNER_ID,
      publicationApproverRoleId: null,
    });
    const grants = await store.listAccessGrants(created.id);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      subjectKind: 'USER',
      subjectUserId: OWNER_ID,
      permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
      revokedAt: null,
    });
    expect(store.audits.some((audit) => audit.action === 'KNOWLEDGE_BASE_CREATE')).toBe(true);
    expect(
      await store.findOperation({
        projectScopeKey: 'project:p1',
        principalScopeKey: 'user:alice',
        key: context({}).idempotencyKey,
      }),
    ).not.toBeNull();
  });

  it('非管理者创建返回 404，Agent 返回 403，重复 key 返回 409', async () => {
    await expect(
      service.createKnowledgeBase(
        member,
        PROJECT_ID,
        { key: 'forbidden', name: 'x', visibility: 'PROJECT' },
        context({}),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.RESOURCE_NOT_FOUND, status: 404 });

    await expect(
      service.createKnowledgeBase(
        agent,
        PROJECT_ID,
        { key: 'agent', name: 'x', visibility: 'PROJECT' },
        context({}),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, status: 403 });

    await expect(
      service.createKnowledgeBase(
        owner,
        PROJECT_ID,
        { key: 'project-knowledge', name: '重复', visibility: 'PROJECT' },
        context({ key: 'project-knowledge' }),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.RESOURCE_CONFLICT, status: 409 });
  });

  it('同 Idempotency-Key 合法重放返回原结果且不重复创建', async () => {
    const body = { key: 'replay-key', name: '重放', visibility: 'PROJECT' };
    const first = await service.createKnowledgeBase(
      owner,
      PROJECT_ID,
      { key: 'replay-key', name: '重放', visibility: 'PROJECT' },
      context(body),
    );
    const auditsAfterFirst = store.audits.length;
    const second = await service.createKnowledgeBase(
      owner,
      PROJECT_ID,
      { key: 'replay-key', name: '重放', visibility: 'PROJECT' },
      context(body, { operationId: 'op-replay' }),
    );
    expect(second).toEqual(first);
    expect(store.audits.length).toBe(auditsAfterFirst);
  });

  it('列表按当前成员可见性过滤，OWNER 可读管理列表', async () => {
    const memberPage = await service.listKnowledgeBases(member, PROJECT_ID, {});
    expect(memberPage.items.map((item) => item.id)).toEqual(['kb-project', 'kb-restricted']);
    expect(memberPage.items.map((item) => item.kind)).toEqual(['BUSINESS', 'SYSTEM']);

    const otherPage = await service.listKnowledgeBases(other, PROJECT_ID, {});
    expect(otherPage.items.map((item) => item.id)).toEqual(['kb-project']);

    const ownerPage = await service.listKnowledgeBases(owner, PROJECT_ID, {});
    expect(ownerPage.items.map((item) => item.id)).toEqual([
      'kb-project',
      'kb-restricted',
      'kb-private',
    ]);
    expect(ownerPage.items.map((item) => item.kind)).toEqual(['BUSINESS', 'SYSTEM', 'PRACTICE']);
  });

  it('列表分页 cursor 稳定且不重复', async () => {
    const first = await service.listKnowledgeBases(owner, PROJECT_ID, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['kb-project', 'kb-restricted']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.listKnowledgeBases(owner, PROJECT_ID, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual(['kb-private']);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
  });

  it('ACL 读取仅 HUMAN OWNER/ADMIN，且保留已撤销历史', async () => {
    await expect(service.getAccess(member, 'kb-project')).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
    await expect(service.getAccess(agent, 'kb-project')).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
    await expect(service.getAccess(owner, 'missing-kb')).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });

    const access = await service.getAccess(owner, 'kb-project');
    expect(access.grants.map((grant) => grant.id)).toEqual(['g-owner', 'g-old-revoked']);
    expect(access.grants[1]!.revokedAt).not.toBeNull();
  });

  it('ACL 替换必须匹配票据绑定与目标', async () => {
    const input = { ...validReplaceInput };
    confirmations.seed(ticketFor(bindingOf(input), { targetId: 'kb-project' }));

    await expect(
      service.replaceAccess(owner, 'kb-restricted', input, replaceContext(replaceBody(input))),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.CONFIRMATION_INVALID, status: 403 });
  });

  it('ACL 替换对 version/authzVersion 做双重 CAS', async () => {
    const input = { ...validReplaceInput, expectedVersion: 9 };
    confirmations.seed(ticketFor(bindingOf(input), { expectedVersion: 9 }));

    await expect(
      service.replaceAccess(owner, 'kb-restricted', input, replaceContext(replaceBody(input))),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.VERSION_CONFLICT, status: 409 });

    const staleAuthz = { ...validReplaceInput, expectedAuthzVersion: 9 };
    confirmations.seed(
      ticketFor(bindingOf(staleAuthz), { actionDigest: actionDigestOf(bindingOf(staleAuthz)) }),
    );
    await expect(
      service.replaceAccess(
        owner,
        'kb-restricted',
        staleAuthz,
        replaceContext(replaceBody(staleAuthz)),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.VERSION_CONFLICT, status: 409 });
  });

  it('拒绝重复主体、混合 user/role、空或重复权限', async () => {
    const base = { ...validReplaceInput };
    const invalidInputs: Array<{ input: V1ReplaceKnowledgeAccessInput; reason: string }> = [
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'USER',
              subjectUserId: MEMBER_ID,
              subjectRoleId: 'r-product',
              permissions: ['READ'],
            },
          ],
        },
        reason: 'USER 不得带 role',
      },
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'ROLE',
              subjectUserId: MEMBER_ID,
              subjectRoleId: 'r-product',
              permissions: ['READ'],
            },
          ],
        },
        reason: 'ROLE 不得带 user',
      },
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'USER',
              subjectUserId: MEMBER_ID,
              subjectRoleId: null,
              permissions: ['READ'],
            },
            {
              subjectKind: 'USER',
              subjectUserId: MEMBER_ID,
              subjectRoleId: null,
              permissions: ['PROPOSE'],
            },
          ],
        },
        reason: '重复用户主体',
      },
      {
        input: {
          ...base,
          grants: [
            { subjectKind: 'USER', subjectUserId: MEMBER_ID, subjectRoleId: null, permissions: [] },
          ],
        },
        reason: '空权限',
      },
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'USER',
              subjectUserId: MEMBER_ID,
              subjectRoleId: null,
              permissions: ['READ', 'READ'],
            },
          ],
        },
        reason: '重复权限',
      },
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'USER',
              subjectUserId: MEMBER_ID,
              subjectRoleId: null,
              permissions: ['WRITE'],
            },
          ],
        },
        reason: '未知权限',
      },
      {
        input: {
          ...base,
          grants: [
            {
              subjectKind: 'ROLE',
              subjectUserId: null,
              subjectRoleId: 'r-inactive',
              permissions: ['READ'],
            },
          ],
        },
        reason: '非活动角色',
      },
    ];

    for (const { input } of invalidInputs) {
      confirmations.seed(ticketFor(bindingOf(input)));
      await expect(
        service.replaceAccess(owner, 'kb-restricted', input, replaceContext(replaceBody(input))),
      ).rejects.toMatchObject({ code: V1_ERROR_CODES.INVALID_GRANT, status: 422 });
    }
  });

  it('拒绝非项目活动成员审批人与非活动审批角色', async () => {
    const strangerApprover = { ...validReplaceInput, publicationApproverUserId: 'stranger' };
    confirmations.seed(ticketFor(bindingOf(strangerApprover)));
    await expect(
      service.replaceAccess(
        owner,
        'kb-restricted',
        strangerApprover,
        replaceContext(replaceBody(strangerApprover)),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.INVALID_GRANT, status: 422 });

    const inactiveApproverRole = { ...validReplaceInput, publicationApproverRoleId: 'r-inactive' };
    confirmations.seed(ticketFor(bindingOf(inactiveApproverRole)));
    await expect(
      service.replaceAccess(
        owner,
        'kb-restricted',
        inactiveApproverRole,
        replaceContext(replaceBody(inactiveApproverRole)),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.INVALID_GRANT, status: 422 });
  });

  it('成功替换 ACL：撤销旧活动 grant、保留历史、递增版本并写审计与幂等结果', async () => {
    const input = { ...validReplaceInput };
    confirmations.seed(ticketFor(bindingOf(input)));

    const access = await service.replaceAccess(
      owner,
      'kb-restricted',
      input,
      replaceContext(replaceBody(input)),
    );

    expect(access).toMatchObject({
      knowledgeBaseId: 'kb-restricted',
      visibility: 'RESTRICTED',
      version: 2,
      authzVersion: 2,
      publicationApproverUserId: OWNER_ID,
      publicationApproverRoleId: 'r-product',
    });
    const oldGrant = access.grants.find((grant) => grant.id === 'g-bob')!;
    expect(oldGrant.revokedAt).not.toBeNull();
    const activeGrants = access.grants.filter((grant) => grant.revokedAt === null);
    expect(activeGrants).toHaveLength(input.grants.length);
    expect(store.audits.some((audit) => audit.action === 'KB_ACCESS_REPLACE')).toBe(true);
    expect(
      await store.findOperation({
        projectScopeKey: 'project:p1',
        principalScopeKey: 'user:alice',
        key: '22222222-2222-4222-8222-222222222222',
      }),
    ).not.toBeNull();
  });

  it('搜索只命中当前发布修订，忽略候选与未发布文档', async () => {
    const result = await service.search(owner, 'kb-project', { q: 'release' });
    expect(result.items.map((item) => item.documentId)).toEqual(['doc-published']);
    expect(result.items[0]).toMatchObject({
      knowledgeBaseId: 'kb-project',
      knowledgeBaseName: '项目知识',
      knowledgeBaseKind: 'BUSINESS',
      documentId: 'doc-published',
      documentKind: 'UNDERSTANDING',
      status: 'PUBLISHED',
    });
    expect(result.items[0]!.excerpt).toContain('release');
    expect(result.hasMore).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it('搜索大小写不敏感，非 UTF-8 正文只按标题匹配', async () => {
    store.seedDocument({ id: 'doc-upload', publishedRevisionId: 'rev-upload' });
    store.seedRevision({
      id: 'rev-upload',
      documentId: 'doc-upload',
      title: 'Binary REPORT',
      body: new Uint8Array([0xff, 0xfe, 0x00, 0x52]),
    });
    const result = await service.search(owner, 'kb-project', { q: 'report' });
    expect(result.items.map((item) => item.revisionId)).toEqual(['rev-upload']);
    expect(result.items[0]!.excerpt).toBe('Binary REPORT');
  });

  it('搜索分页 cursor 稳定且只返回发布版', async () => {
    store.seedDocument({ id: 'doc-published-2', publishedRevisionId: 'rev-published-2' });
    store.seedRevision({
      id: 'rev-published-2',
      documentId: 'doc-published-2',
      title: 'Second release',
      body: 'more release',
    });
    store.seedDocument({ id: 'doc-published-3', publishedRevisionId: 'rev-published-3' });
    store.seedRevision({
      id: 'rev-published-3',
      documentId: 'doc-published-3',
      title: 'Third release',
      body: 'again',
    });

    const first = await service.search(owner, 'kb-project', { q: 'release', limit: 2 });
    expect(first.items.map((item) => item.documentId)).toEqual([
      'doc-published',
      'doc-published-2',
    ]);
    expect(first.hasMore).toBe(true);
    const second = await service.search(owner, 'kb-project', {
      q: 'release',
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.documentId)).toEqual(['doc-published-3']);
    expect(second.hasMore).toBe(false);
  });

  it('无 KB READ 时搜索返回 404', async () => {
    await expect(service.search(other, 'kb-private', { q: 'secret' })).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
  });
});
