import { ExecutionContext, Injectable, ValidationPipe, type CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Principal,
} from '@workmesh/shared';
import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';
import { V1AuthGuard, type V1Request } from '../src/auth/v1-auth.guard';
import {
  V1AuthorizationService,
  type V1GrantRecord,
  type V1KnowledgeBaseRecord,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from '../src/auth/v1-authorization';
import {
  actionDigestOf,
  hashTicketSecret,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
  type V1TicketCreateInput,
  type V1TicketRecord,
} from '../src/auth/v1-confirmation';
import {
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../src/common/v1-idempotency';
import { V1KnowledgeBaseController } from '../src/knowledge/v1-knowledge-base.controller';
import { V1_KNOWLEDGE_BASE_REPOSITORY } from '../src/knowledge/v1-knowledge-base.repository';
import type {
  V1KnowledgeBaseGrantView,
  V1KnowledgeBaseRepository,
  V1KnowledgeBaseSearchItem,
  V1KnowledgeBaseView,
  V1KnowledgeGrantInput,
  V1KnowledgeMemberRecord,
  V1KnowledgeOperation,
  V1KnowledgeProjectRoleRecord,
} from '../src/knowledge/v1-knowledge-base.repository';
import { V1KnowledgeBaseService } from '../src/knowledge/v1-knowledge-base.service';

@Injectable()
class TestV1AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<V1Request>();
    const header = req.headers['x-test-principal'];
    if (typeof header !== 'string')
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
    req.v1Principal = JSON.parse(
      Buffer.from(header, 'base64').toString('utf8'),
    ) as V1Request['v1Principal'];
    return true;
  }
}

const PROJECT_ID = 'p1';
const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CAROL = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROLE_PRODUCT = '11111111-1111-4111-8111-111111111111';
const ROLE_REVIEWER = '22222222-2222-4222-8222-222222222222';
const ROLE_INACTIVE = '44444444-4444-4444-8444-444444444444';
const TICKET_ID = '33333333-3333-4333-8333-333333333333';
const TICKET_SECRET = 'secret-1';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

const alice: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: ALICE,
  scopes: [],
  sessionId: 'sess-1',
  authVersion: 1,
};
const bob: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: BOB,
  scopes: [],
  sessionId: 'sess-2',
  authVersion: 1,
};
const carol: Principal & { sessionId: string; authVersion: number } = {
  kind: 'HUMAN',
  userId: CAROL,
  scopes: [],
  sessionId: 'sess-3',
  authVersion: 1,
};
const agent: Principal = {
  kind: 'AGENT',
  userId: ALICE,
  agentCredentialId: 'cred-1',
  projectId: PROJECT_ID,
  roleIds: [ROLE_REVIEWER],
  scopes: ['knowledge:read'],
};

function encodePrincipal(value: Principal & { sessionId?: string; authVersion?: number }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

type StoredKnowledgeBase = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  visibility: 'PROJECT' | 'RESTRICTED';
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
};

type StoredGrant = {
  id: string;
  knowledgeBaseId: string;
  projectId: string;
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: string[];
  version: number;
  grantedAt: Date;
  revokedAt: Date | null;
};

type StoredDocument = {
  id: string;
  knowledgeBaseId: string;
  currentPublishedRevisionId: string | null;
  archivedAt: Date | null;
};
type StoredRevision = {
  id: string;
  documentId: string;
  title: string;
  bodyBytes: Uint8Array;
  sha256: string;
};

/** 共享内存世界：授权仓储与知识仓储各自按接口要求投影同一份数据。 */
class World {
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
  tickets = new Map<string, V1TicketRecord>();
  private sequence = 0;
  private clock = new Date('2026-01-01T00:00:00.000Z');

  constructor() {
    this.reset();
  }

  reset(): void {
    this.projects.clear();
    this.members.clear();
    this.assignments.clear();
    this.roles.clear();
    this.knowledgeBases.clear();
    this.grants.clear();
    this.documents.clear();
    this.revisions.clear();
    this.audits = [];
    this.operations.clear();
    this.tickets.clear();
    this.sequence = 0;
    this.clock = new Date('2026-01-01T00:00:00.000Z');

    this.projects.set(PROJECT_ID, { id: PROJECT_ID, version: 1, archivedAt: null });
    this.members.set(`${PROJECT_ID}:${ALICE}`, {
      projectId: PROJECT_ID,
      userId: ALICE,
      role: 'OWNER',
      version: 1,
      revokedAt: null,
    });
    this.members.set(`${PROJECT_ID}:${BOB}`, {
      projectId: PROJECT_ID,
      userId: BOB,
      role: 'MEMBER',
      version: 1,
      revokedAt: null,
    });
    this.members.set(`${PROJECT_ID}:${CAROL}`, {
      projectId: PROJECT_ID,
      userId: CAROL,
      role: 'MEMBER',
      version: 1,
      revokedAt: null,
    });
    this.roles.set(ROLE_PRODUCT, { id: ROLE_PRODUCT, projectId: PROJECT_ID, isActive: true });
    this.roles.set(ROLE_REVIEWER, { id: ROLE_REVIEWER, projectId: PROJECT_ID, isActive: true });
    this.roles.set(ROLE_INACTIVE, { id: ROLE_INACTIVE, projectId: PROJECT_ID, isActive: false });
    this.assignments.set(`${PROJECT_ID}:${ALICE}`, [
      {
        id: 'as-alice',
        projectId: PROJECT_ID,
        userId: ALICE,
        roleId: ROLE_PRODUCT,
        version: 1,
        revokedAt: null,
      },
    ]);
    this.assignments.set(`${PROJECT_ID}:${BOB}`, [
      {
        id: 'as-bob',
        projectId: PROJECT_ID,
        userId: BOB,
        roleId: ROLE_REVIEWER,
        version: 1,
        revokedAt: null,
      },
    ]);
    this.assignments.set(`${PROJECT_ID}:${CAROL}`, []);

    this.seedKnowledgeBase({
      id: 'kb-project',
      key: 'project-knowledge',
      name: '项目知识',
      visibility: 'PROJECT',
    });
    this.seedKnowledgeBase({
      id: 'kb-restricted',
      key: 'restricted',
      name: '受限知识',
      visibility: 'RESTRICTED',
    });
    this.seedKnowledgeBase({
      id: 'kb-private',
      key: 'private',
      name: '私库',
      visibility: 'RESTRICTED',
    });
    this.seedGrant({
      id: 'g-owner',
      knowledgeBaseId: 'kb-project',
      subjectKind: 'USER',
      subjectUserId: ALICE,
      subjectRoleId: null,
      permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
    });
    this.seedGrant({
      id: 'g-old-revoked',
      knowledgeBaseId: 'kb-project',
      subjectKind: 'USER',
      subjectUserId: CAROL,
      subjectRoleId: null,
      permissions: ['READ'],
      revoked: true,
    });
    this.seedGrant({
      id: 'g-bob',
      knowledgeBaseId: 'kb-restricted',
      subjectKind: 'USER',
      subjectUserId: BOB,
      subjectRoleId: null,
      permissions: ['READ', 'PROPOSE'],
    });

    this.documents.set('doc-published', {
      id: 'doc-published',
      knowledgeBaseId: 'kb-project',
      currentPublishedRevisionId: 'rev-published',
      archivedAt: null,
    });
    this.documents.set('doc-candidate', {
      id: 'doc-candidate',
      knowledgeBaseId: 'kb-project',
      currentPublishedRevisionId: null,
      archivedAt: null,
    });
    this.documents.set('doc-other', {
      id: 'doc-other',
      knowledgeBaseId: 'kb-private',
      currentPublishedRevisionId: 'rev-other',
      archivedAt: null,
    });
    this.revisions.set('rev-published', {
      id: 'rev-published',
      documentId: 'doc-published',
      title: 'Release Notes',
      bodyBytes: new Uint8Array(Buffer.from('The release ships on Friday.', 'utf8')),
      sha256: 'a'.repeat(64),
    });
    this.revisions.set('rev-candidate', {
      id: 'rev-candidate',
      documentId: 'doc-candidate',
      title: 'Release draft',
      bodyBytes: new Uint8Array(Buffer.from('Only candidates mention release.', 'utf8')),
      sha256: 'b'.repeat(64),
    });
    this.revisions.set('rev-other', {
      id: 'rev-other',
      documentId: 'doc-other',
      title: 'Private note',
      bodyBytes: new Uint8Array(Buffer.from('release in private library.', 'utf8')),
      sha256: 'c'.repeat(64),
    });
  }

  seedKnowledgeBase(input: {
    id: string;
    key: string;
    name: string;
    visibility: 'PROJECT' | 'RESTRICTED';
  }): void {
    this.knowledgeBases.set(input.id, {
      id: input.id,
      projectId: PROJECT_ID,
      key: input.key,
      name: input.name,
      visibility: input.visibility,
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: ALICE,
      publicationApproverRoleId: null,
      archivedAt: null,
      createdAt: this.nextClock(),
    });
  }

  seedGrant(input: {
    id: string;
    knowledgeBaseId: string;
    subjectKind: 'USER' | 'ROLE';
    subjectUserId: string | null;
    subjectRoleId: string | null;
    permissions: string[];
    revoked?: boolean;
  }): void {
    this.grants.set(input.id, {
      id: input.id,
      knowledgeBaseId: input.knowledgeBaseId,
      projectId: PROJECT_ID,
      subjectKind: input.subjectKind,
      subjectUserId: input.subjectUserId,
      subjectRoleId: input.subjectRoleId,
      permissions: input.permissions,
      version: 1,
      grantedAt: this.nextClock(),
      revokedAt: input.revoked ? this.nextClock() : null,
    });
  }

  grantRows(knowledgeBaseId: string): StoredGrant[] {
    return [...this.grants.values()]
      .filter((grant) => grant.knowledgeBaseId === knowledgeBaseId)
      .sort(
        (left, right) =>
          left.grantedAt.getTime() - right.grantedAt.getTime() || left.id.localeCompare(right.id),
      );
  }

  nextClock(): Date {
    this.clock = new Date(this.clock.getTime() + 1000);
    return new Date(this.clock);
  }

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }
}

class KnowledgeRepo implements V1KnowledgeBaseRepository {
  constructor(private readonly world: World) {}

  private view(row: StoredKnowledgeBase): V1KnowledgeBaseView {
    return {
      id: row.id,
      projectId: row.projectId,
      key: row.key,
      name: row.name,
      visibility: row.visibility,
      version: row.version,
      authzVersion: row.authzVersion,
      publicationApproverUserId: row.publicationApproverUserId,
      publicationApproverRoleId: row.publicationApproverRoleId,
      archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    };
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

  async createKnowledgeBase(input: {
    projectId: string;
    key: string;
    name: string;
    visibility: 'PROJECT' | 'RESTRICTED';
    creatorUserId: string;
    now: Date;
    operation: V1KnowledgeOperation;
  }): Promise<V1KnowledgeBaseView> {
    const duplicate = [...this.world.knowledgeBases.values()].find(
      (row) => row.projectId === input.projectId && row.key === input.key,
    );
    if (duplicate)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'KNOWLEDGE_BASE_KEY_CONFLICT',
        { key: input.key },
        409,
      );

    const id = this.world.nextId('kb');
    const row: StoredKnowledgeBase = {
      id,
      projectId: input.projectId,
      key: input.key,
      name: input.name,
      visibility: input.visibility,
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: input.creatorUserId,
      publicationApproverRoleId: null,
      archivedAt: null,
      createdAt: this.world.nextClock(),
    };
    this.world.knowledgeBases.set(id, row);
    this.world.grants.set(`grant-creator-${id}`, {
      id: `grant-creator-${id}`,
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
    this.world.audits.push({
      action: 'KNOWLEDGE_BASE_CREATE',
      targetId: id,
      details: { key: input.key },
    });
    const view = this.view(row);
    this.world.operations.set(
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

  async listKnowledgeBases(
    projectId: string,
    query: { limit: number; cursor: string | null; management: boolean; principalUserId: string },
  ): Promise<{ items: V1KnowledgeBaseView[]; nextCursor: string | null; hasMore: boolean }> {
    const rows = [...this.world.knowledgeBases.values()]
      .filter((row) => row.projectId === projectId)
      .sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      );
    const start = query.cursor
      ? Number(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      : 0;
    const page = rows.slice(start, start + query.limit);
    const hasMore = start + query.limit < rows.length;
    return {
      items: page.map((row) => this.view(row)),
      nextCursor: hasMore
        ? Buffer.from(String(start + query.limit), 'utf8').toString('base64url')
        : null,
      hasMore,
    };
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseView | null> {
    const row = this.world.knowledgeBases.get(knowledgeBaseId);
    return row ? this.view(row) : null;
  }

  async listAccessGrants(knowledgeBaseId: string): Promise<V1KnowledgeBaseGrantView[]> {
    return this.world.grantRows(knowledgeBaseId).map((grant) => this.grantView(grant));
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
    operation: V1KnowledgeOperation;
    now: Date;
  }): Promise<V1KnowledgeBaseAccessView> {
    const row = this.world.knowledgeBases.get(input.knowledgeBaseId);
    if (!row)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_BASE_NOT_FOUND',
        { knowledgeBaseId: input.knowledgeBaseId },
        404,
      );
    if (row.version !== input.expectedVersion || row.authzVersion !== input.expectedAuthzVersion)
      throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'VERSION_CONFLICT', {}, 409);

    for (const grant of this.world.grants.values()) {
      if (grant.knowledgeBaseId === input.knowledgeBaseId && grant.revokedAt === null) {
        grant.revokedAt = input.now;
        grant.version += 1;
      }
    }
    input.grants.forEach((grant, index) => {
      const id = `${input.operation.id}-grant-${index}`;
      this.world.grants.set(id, {
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

    const ticket = this.world.tickets.get(input.ticket.id);
    if (
      ticket &&
      ticket.secretHash === input.ticket.secretHash &&
      ticket.webSessionId === input.ticket.webSessionId
    ) {
      ticket.consumedAt = input.now;
      ticket.consumedOperationId = input.operation.id;
    }

    const view: V1KnowledgeBaseAccessView = {
      knowledgeBaseId: row.id,
      projectId: row.projectId,
      visibility: row.visibility,
      version: row.version,
      authzVersion: row.authzVersion,
      publicationApproverUserId: row.publicationApproverUserId,
      publicationApproverRoleId: row.publicationApproverRoleId,
      grants: await this.listAccessGrants(input.knowledgeBaseId),
    };
    this.world.audits.push({
      action: 'KB_ACCESS_REPLACE',
      targetId: row.id,
      details: {
        visibility: input.visibility,
        reason: input.reason,
        actorUserId: input.actorUserId,
      },
    });
    this.world.operations.set(
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
    q: string;
    limit: number;
    cursor: string | null;
  }): Promise<{
    items: V1KnowledgeBaseSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
    truncated: boolean;
  }> {
    const published = [...this.world.documents.values()]
      .filter(
        (document) =>
          document.knowledgeBaseId === input.knowledgeBaseId &&
          document.archivedAt === null &&
          document.currentPublishedRevisionId !== null,
      )
      .sort((left, right) => left.id.localeCompare(right.id));
    const needle = input.q.toLowerCase();
    const matches: V1KnowledgeBaseSearchItem[] = [];
    for (const document of published) {
      const revision = this.world.revisions.get(document.currentPublishedRevisionId!);
      if (!revision || revision.documentId !== document.id) continue;
      const body = new TextDecoder('utf-8', { fatal: true });
      let text: string | null;
      try {
        text = body.decode(revision.bodyBytes);
      } catch {
        text = null;
      }
      const index = text === null ? -1 : text.toLowerCase().indexOf(needle);
      if (index >= 0 && text !== null) {
        const start = Math.max(0, index - 80);
        const end = Math.min(text.length, index + needle.length + 80);
        matches.push({
          revisionId: revision.id,
          documentId: document.id,
          title: revision.title,
          excerpt: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`,
          sha256: revision.sha256,
        });
      } else if (revision.title.toLowerCase().includes(needle)) {
        matches.push({
          revisionId: revision.id,
          documentId: document.id,
          title: revision.title,
          excerpt: revision.title,
          sha256: revision.sha256,
        });
      }
    }
    const start = input.cursor
      ? Number(Buffer.from(input.cursor, 'base64url').toString('utf8'))
      : 0;
    const page = matches.slice(start, start + input.limit);
    const hasMore = start + input.limit < matches.length;
    return {
      items: page,
      nextCursor: hasMore
        ? Buffer.from(String(start + input.limit), 'utf8').toString('base64url')
        : null,
      hasMore,
      truncated: false,
    };
  }

  async findMember(projectId: string, userId: string): Promise<V1KnowledgeMemberRecord | null> {
    const member = this.world.members.get(`${projectId}:${userId}`);
    if (!member) return null;
    return {
      projectId: member.projectId,
      userId: member.userId,
      role: member.role,
      revokedAt: member.revokedAt,
    };
  }

  async findProjectRoles(
    projectId: string,
    roleIds: readonly string[],
  ): Promise<V1KnowledgeProjectRoleRecord[]> {
    return [...this.world.roles.values()].filter(
      (role) => role.projectId === projectId && roleIds.includes(role.id),
    );
  }
}

class AuthzRepo implements V1AuthorizationRepository {
  constructor(private readonly world: World) {}

  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    return this.world.projects.get(projectId) ?? null;
  }

  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.world.members.get(`${projectId}:${userId}`) ?? null;
  }

  async findActiveRoleAssignments(
    projectId: string,
    userId: string,
  ): Promise<V1RoleAssignmentRecord[]> {
    return this.world.assignments.get(`${projectId}:${userId}`) ?? [];
  }

  async findRoleAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<V1RoleAssignmentRecord | null> {
    return (
      (this.world.assignments.get(`${projectId}:${userId}`) ?? []).find(
        (item) => item.roleId === roleId,
      ) ?? null
    );
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseRecord | null> {
    const row = this.world.knowledgeBases.get(knowledgeBaseId);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      visibility: row.visibility,
      version: row.version,
      authzVersion: row.authzVersion,
      publicationApproverUserId: row.publicationApproverUserId,
      publicationApproverRoleId: row.publicationApproverRoleId,
      archivedAt: row.archivedAt,
    };
  }

  async findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]> {
    return this.world.grantRows(knowledgeBaseId).map((grant) => ({
      id: grant.id,
      knowledgeBaseId: grant.knowledgeBaseId,
      subjectKind: grant.subjectKind,
      subjectUserId: grant.subjectUserId,
      subjectRoleId: grant.subjectRoleId,
      permissions: grant.permissions,
      revokedAt: grant.revokedAt,
    }));
  }
}

class ConfirmationRepo implements V1ConfirmationRepository {
  constructor(private readonly world: World) {}

  async createTicket(input: V1TicketCreateInput): Promise<V1TicketRecord> {
    const { now, ...rest } = input;
    const ticket: V1TicketRecord = {
      ...rest,
      createdAt: now,
      consumedAt: null,
      consumedOperationId: null,
      invalidatedAt: null,
    };
    this.world.tickets.set(ticket.id, ticket);
    return ticket;
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.world.tickets.get(ticketId) ?? null;
  }

  async consumeTicket(input: {
    ticketId: string;
    secretHash: string;
    webSessionId: string;
    operationId: string;
    now: Date;
  }): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    const ticket = this.world.tickets.get(input.ticketId) ?? null;
    return { consumed: Boolean(ticket), ticket };
  }
}

class IdempotencyRepo implements V1IdempotencyRepository {
  constructor(private readonly world: World) {}

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return (
      this.world.operations.get(
        `${input.projectScopeKey}|${input.principalScopeKey}|${input.key}`,
      ) ?? null
    );
  }
}

function seedAccessTicket(
  world: World,
  binding: ActionBinding,
  overrides: Partial<V1TicketRecord> = {},
): void {
  world.tickets.set(TICKET_ID, {
    id: TICKET_ID,
    secretHash: hashTicketSecret(TICKET_SECRET),
    userId: ALICE,
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
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  });
}

function accessBinding(
  overrides: {
    expectedVersion?: number;
    publicationApproverUserId?: string;
    grants?: unknown[];
  } = {},
): ActionBinding {
  return {
    action: 'KB_ACCESS_REPLACE',
    projectId: PROJECT_ID,
    targetType: 'KNOWLEDGE_BASE',
    targetId: 'kb-restricted',
    expectedVersion: overrides.expectedVersion ?? 1,
    roleSlot: null,
    payload: {
      expectedAuthzVersion: 1,
      visibility: 'RESTRICTED',
      publicationApproverUserId: overrides.publicationApproverUserId ?? ALICE,
      publicationApproverRoleId: ROLE_PRODUCT,
      grants: overrides.grants ?? [
        { subjectKind: 'USER', subjectUserId: BOB, subjectRoleId: null, permissions: ['READ'] },
      ],
      reason: '调整可见范围',
    },
  };
}

function accessBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    expectedVersion: 1,
    expectedAuthzVersion: 1,
    visibility: 'RESTRICTED',
    publicationApproverUserId: ALICE,
    publicationApproverRoleId: ROLE_PRODUCT,
    grants: [
      { subjectKind: 'USER', subjectUserId: BOB, subjectRoleId: null, permissions: ['READ'] },
    ],
    reason: '调整可见范围',
    confirmation: { ticketId: TICKET_ID, ticketSecret: TICKET_SECRET },
    ...overrides,
  };
}

describe('v1 knowledge base & ACL HTTP contract (real Nest bootstrap)', () => {
  const world = new World();
  const authzRepo = new AuthzRepo(world);
  const knowledgeRepo = new KnowledgeRepo(world);
  const authzService = new V1AuthorizationService(authzRepo);
  const confirmationRepo = new ConfirmationRepo(world);
  const idempotencyRepo = new IdempotencyRepo(world);
  const knowledgeService = new V1KnowledgeBaseService(
    knowledgeRepo,
    authzService,
    confirmationRepo,
    idempotencyRepo,
  );

  let server: unknown;
  let appRef: { close: () => Promise<void> };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [V1KnowledgeBaseController],
      providers: [
        { provide: V1KnowledgeBaseService, useValue: knowledgeService },
        { provide: V1AuthorizationService, useValue: authzService },
        { provide: V1_KNOWLEDGE_BASE_REPOSITORY, useValue: knowledgeRepo },
        { provide: V1_CONFIRMATION_REPOSITORY, useValue: confirmationRepo },
        { provide: V1_IDEMPOTENCY_REPOSITORY, useValue: idempotencyRepo },
      ],
    })
      .overrideGuard(V1AuthGuard)
      .useValue(new TestV1AuthGuard())
      .compile();

    const app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
    app.use(
      (
        req: { requestId?: string },
        res: { setHeader: (name: string, value: string) => void },
        next: () => void,
      ) => {
        const id = randomUUID();
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
        res.setHeader('Cache-Control', 'no-store');
        next();
      },
    );
    await app.init();
    server = app.getHttpServer();
    appRef = app as unknown as { close: () => Promise<void> };
  });

  afterAll(async () => {
    await appRef?.close();
  });

  beforeEach(() => {
    world.reset();
    seedAccessTicket(world, accessBinding());
  });

  it('POST 创建 KB：201 返回 KB 视图并显式授予创建者全部内容权限', async () => {
    const res = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ key: 'design-notes', name: '设计笔记', visibility: 'RESTRICTED' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      projectId: PROJECT_ID,
      key: 'design-notes',
      name: '设计笔记',
      visibility: 'RESTRICTED',
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: ALICE,
      publicationApproverRoleId: null,
      archivedAt: null,
    });
    expect(world.grants.get(`grant-creator-${res.body.data.id}`)).toMatchObject({
      subjectKind: 'USER',
      subjectUserId: ALICE,
      permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
      revokedAt: null,
    });
    expect(world.audits.some((audit) => audit.action === 'KNOWLEDGE_BASE_CREATE')).toBe(true);
  });

  it('POST 创建 KB：缺少 Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const res = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(alice))
      .send({ key: 'no-key', name: '无幂等键', visibility: 'PROJECT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('POST 创建 KB：非管理者 404，Agent 403，key 冲突 409，DTO 未知字段 400', async () => {
    const memberRes = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(bob))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ key: 'member-key', name: '成员库', visibility: 'PROJECT' });
    expect(memberRes.status).toBe(404);
    expect(memberRes.body.error.code).toBe('RESOURCE_NOT_FOUND');

    const agentRes = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(agent))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ key: 'agent-key', name: 'Agent 库', visibility: 'PROJECT' });
    expect(agentRes.status).toBe(403);
    expect(agentRes.body.error.code).toBe('HUMAN_SESSION_REQUIRED');

    const conflictRes = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ key: 'project-knowledge', name: '重复', visibility: 'PROJECT' });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('RESOURCE_CONFLICT');

    const invalidRes = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ key: 'Bad_Key', name: '非法 key', visibility: 'PROJECT', rogue: true });
    expect(invalidRes.status).toBe(400);
  });

  it('GET 列表：普通成员只看可见库，OWNER 看管理列表，响应含稳定分页字段', async () => {
    const bobRes = await request(server)
      .get(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(bob));
    expect(bobRes.status).toBe(200);
    expect(bobRes.body.data.items.map((item: V1KnowledgeBaseView) => item.id)).toEqual([
      'kb-project',
      'kb-restricted',
    ]);
    expect(bobRes.body.data.hasMore).toBe(false);
    expect(bobRes.body.data.nextCursor).toBeNull();

    const carolRes = await request(server)
      .get(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(carol));
    expect(carolRes.status).toBe(200);
    expect(carolRes.body.data.items.map((item: V1KnowledgeBaseView) => item.id)).toEqual([
      'kb-project',
    ]);

    const aliceRes = await request(server)
      .get(`/api/v1/projects/${PROJECT_ID}/knowledge-bases`)
      .set('x-test-principal', encodePrincipal(alice));
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.data.items.map((item: V1KnowledgeBaseView) => item.id)).toEqual([
      'kb-project',
      'kb-restricted',
      'kb-private',
    ]);

    const paged = await request(server)
      .get(`/api/v1/projects/${PROJECT_ID}/knowledge-bases?limit=2`)
      .set('x-test-principal', encodePrincipal(alice));
    expect(paged.status).toBe(200);
    expect(paged.body.data.hasMore).toBe(true);
    expect(typeof paged.body.data.nextCursor).toBe('string');
  });

  it('GET ACL：非 OWNER/ADMIN 与 Agent 一律 404，OWNER 返回含已撤销历史', async () => {
    const memberRes = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/access')
      .set('x-test-principal', encodePrincipal(bob));
    expect(memberRes.status).toBe(404);
    expect(memberRes.body.error.code).toBe('RESOURCE_NOT_FOUND');

    const agentRes = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/access')
      .set('x-test-principal', encodePrincipal(agent));
    expect(agentRes.status).toBe(404);

    const missingRes = await request(server)
      .get('/api/v1/knowledge-bases/missing-kb/access')
      .set('x-test-principal', encodePrincipal(alice));
    expect(missingRes.status).toBe(404);

    const ownerRes = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/access')
      .set('x-test-principal', encodePrincipal(alice));
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data).toMatchObject({
      knowledgeBaseId: 'kb-project',
      projectId: PROJECT_ID,
      visibility: 'PROJECT',
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: ALICE,
      publicationApproverRoleId: null,
    });
    expect(ownerRes.body.data.grants.map((grant: V1KnowledgeBaseGrantView) => grant.id)).toEqual([
      'g-owner',
      'g-old-revoked',
    ]);
    expect(ownerRes.body.data.grants[1].revokedAt).not.toBeNull();
  });

  it('PUT ACL：缺少 Idempotency-Key → 400，未知字段 → 400', async () => {
    const missingKey = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .send(accessBody());
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const unknownField = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(accessBody({ rogue: true }));
    expect(unknownField.status).toBe(400);
  });

  it('PUT ACL：票据目标不符 → 403 CONFIRMATION_INVALID', async () => {
    seedAccessTicket(world, { ...accessBinding(), targetId: 'kb-project' });
    const res = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(accessBody());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CONFIRMATION_INVALID');
  });

  it('PUT ACL：version 与 authzVersion 双重 CAS 冲突 → 409 VERSION_CONFLICT', async () => {
    seedAccessTicket(world, accessBinding({ expectedVersion: 9 }));
    const staleVersion = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(accessBody({ expectedVersion: 9 }));
    expect(staleVersion.status).toBe(409);
    expect(staleVersion.body.error.code).toBe('VERSION_CONFLICT');

    const baseBinding = accessBinding();
    seedAccessTicket(world, {
      ...baseBinding,
      payload: { ...baseBinding.payload, expectedAuthzVersion: 9 },
    });
    const staleAuthz = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(accessBody({ expectedAuthzVersion: 9 }));
    expect(staleAuthz.status).toBe(409);
    expect(staleAuthz.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('PUT ACL：USER 主体携带 role、重复主体、重复权限等形状 → 422 INVALID_GRANT', async () => {
    const cases: Array<Record<string, unknown>> = [
      {
        grants: [
          {
            subjectKind: 'USER',
            subjectUserId: BOB,
            subjectRoleId: ROLE_PRODUCT,
            permissions: ['READ'],
          },
        ],
      },
      {
        grants: [
          {
            subjectKind: 'ROLE',
            subjectUserId: BOB,
            subjectRoleId: ROLE_PRODUCT,
            permissions: ['READ'],
          },
        ],
      },
      {
        grants: [
          { subjectKind: 'USER', subjectUserId: BOB, subjectRoleId: null, permissions: ['READ'] },
          {
            subjectKind: 'USER',
            subjectUserId: BOB,
            subjectRoleId: null,
            permissions: ['PROPOSE'],
          },
        ],
      },
      {
        grants: [
          {
            subjectKind: 'USER',
            subjectUserId: BOB,
            subjectRoleId: null,
            permissions: ['READ', 'READ'],
          },
        ],
      },
      {
        grants: [
          {
            subjectKind: 'ROLE',
            subjectUserId: null,
            subjectRoleId: ROLE_INACTIVE,
            permissions: ['READ'],
          },
        ],
      },
      { publicationApproverUserId: CAROL.replace('cccccccc', 'dddddddd') },
    ];
    for (const body of cases) {
      const res = await request(server)
        .put('/api/v1/knowledge-bases/kb-restricted/access')
        .set('x-test-principal', encodePrincipal(alice))
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(accessBody(body));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_GRANT');
    }
  });

  it('PUT ACL：DTO 层拒绝空权限与未知权限 → 400', async () => {
    const cases: Array<Record<string, unknown>> = [
      {
        grants: [{ subjectKind: 'USER', subjectUserId: BOB, subjectRoleId: null, permissions: [] }],
      },
      {
        grants: [
          { subjectKind: 'USER', subjectUserId: BOB, subjectRoleId: null, permissions: ['WRITE'] },
        ],
      },
    ];
    for (const body of cases) {
      const res = await request(server)
        .put('/api/v1/knowledge-bases/kb-restricted/access')
        .set('x-test-principal', encodePrincipal(alice))
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(accessBody(body));
      expect(res.status).toBe(400);
    }
  });

  it('PUT ACL 成功：撤销旧活动 grant、保留历史、version/authzVersion 递增并写审计与幂等结果', async () => {
    const res = await request(server)
      .put('/api/v1/knowledge-bases/kb-restricted/access')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(accessBody());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      knowledgeBaseId: 'kb-restricted',
      visibility: 'RESTRICTED',
      version: 2,
      authzVersion: 2,
      publicationApproverUserId: ALICE,
      publicationApproverRoleId: ROLE_PRODUCT,
    });
    const oldGrant = res.body.data.grants.find(
      (grant: V1KnowledgeBaseGrantView) => grant.id === 'g-bob',
    );
    expect(oldGrant.revokedAt).not.toBeNull();
    const active = res.body.data.grants.filter(
      (grant: V1KnowledgeBaseGrantView) => grant.revokedAt === null,
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      subjectKind: 'USER',
      subjectUserId: BOB,
      permissions: ['READ'],
    });
    expect(world.audits.some((audit) => audit.action === 'KB_ACCESS_REPLACE')).toBe(true);
    expect(world.operations.has(`project:${PROJECT_ID}|user:${ALICE}|${IDEMPOTENCY_KEY}`)).toBe(
      true,
    );
    expect(world.tickets.get(TICKET_ID)?.consumedAt).not.toBeNull();
  });

  it('GET 搜索：只命中当前发布修订；不可读 KB 返回 404；缺少 q → 400', async () => {
    const published = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/search?q=release')
      .set('x-test-principal', encodePrincipal(bob));
    expect(published.status).toBe(200);
    expect(
      published.body.data.items.map((item: V1KnowledgeBaseSearchItem) => item.documentId),
    ).toEqual(['doc-published']);
    expect(published.body.data.items[0].title).toBe('Release Notes');
    expect(published.body.data.items[0].sha256).toBe('a'.repeat(64));
    expect(published.body.data.items[0].excerpt).toContain('release');
    expect(published.body.data.hasMore).toBe(false);
    expect(published.body.data.truncated).toBe(false);

    const denied = await request(server)
      .get('/api/v1/knowledge-bases/kb-private/search?q=release')
      .set('x-test-principal', encodePrincipal(carol));
    expect(denied.status).toBe(404);

    const missingQuery = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/search')
      .set('x-test-principal', encodePrincipal(bob));
    expect(missingQuery.status).toBe(400);
  });

  it('GET 搜索：cursor 稳定分页且不返回候选修订', async () => {
    world.documents.set('doc-published-2', {
      id: 'doc-published-2',
      knowledgeBaseId: 'kb-project',
      currentPublishedRevisionId: 'rev-published-2',
      archivedAt: null,
    });
    world.revisions.set('rev-published-2', {
      id: 'rev-published-2',
      documentId: 'doc-published-2',
      title: 'Second release',
      bodyBytes: new Uint8Array(Buffer.from('more release', 'utf8')),
      sha256: 'd'.repeat(64),
    });

    const first = await request(server)
      .get('/api/v1/knowledge-bases/kb-project/search?q=release&limit=1')
      .set('x-test-principal', encodePrincipal(bob));
    expect(first.status).toBe(200);
    expect(first.body.data.items.map((item: V1KnowledgeBaseSearchItem) => item.documentId)).toEqual(
      ['doc-published'],
    );
    expect(first.body.data.hasMore).toBe(true);

    const second = await request(server)
      .get(
        `/api/v1/knowledge-bases/kb-project/search?q=release&limit=1&cursor=${encodeURIComponent(first.body.data.nextCursor)}`,
      )
      .set('x-test-principal', encodePrincipal(bob));
    expect(second.status).toBe(200);
    expect(
      second.body.data.items.map((item: V1KnowledgeBaseSearchItem) => item.documentId),
    ).toEqual(['doc-published-2']);
    expect(
      second.body.data.items.map((item: V1KnowledgeBaseSearchItem) => item.revisionId),
    ).not.toContain('rev-candidate');
  });
});
