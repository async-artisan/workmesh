import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type ActionBinding } from '@workmesh/shared';
import type { V1OperationRecord } from '../common/v1-idempotency';
import {
  actionDigestOf,
  hashTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from '../auth/v1-confirmation';
import type { V1Principal } from '../auth/v1-policy';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  ProjectMemberProfile,
  ProjectRoleAssignmentRecord,
  ProjectRoleChangeInput,
  ProjectRoleMutationView,
  ProjectRoleRepository,
} from './project-role.repository';
import {
  ProjectsService,
  DEFAULT_KNOWLEDGE_BASE_KEY,
  type ProjectRoleChangeContext,
} from './projects.service';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';
const ROLE_ACTIVE_ID = '55555555-5555-4555-8555-555555555555';
const ROLE_INACTIVE_ID = '66666666-6666-4666-8666-666666666666';
const TICKET_ID = '77777777-7777-4777-8777-777777777777';
const OTHER_TICKET_ID = '88888888-8888-4888-8888-888888888888';
const IDEMPOTENCY_KEY = '99999999-9999-4999-8999-999999999999';
const SESSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TICKET_SECRET = 'secret-1';
const REASON = 'initial role grant';

function operationsKey(projectScope: string, principalScope: string, key: string): string {
  return `${projectScope}|${principalScope}|${key}`;
}

class FakeOperations {
  private readonly records = new Map<string, V1OperationRecord>();

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return (
      this.records.get(operationsKey(input.projectScopeKey, input.principalScopeKey, input.key)) ??
      null
    );
  }

  record(record: V1OperationRecord): void {
    this.records.set(
      operationsKey(record.projectScopeKey, record.principalScopeKey, record.key),
      record,
    );
  }
}

class FakeTickets implements V1ConfirmationRepository {
  private readonly tickets = new Map<string, V1TicketRecord>();

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async createTicket(): Promise<V1TicketRecord> {
    throw new Error('ticket creation is outside this service');
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  async consumeTicket(): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    throw new Error('ticket consumption is owned by the prisma repository transaction');
  }
}

type FakeMember = ProjectMemberProfile;

class FakeRoleRepository implements ProjectRoleRepository {
  readonly members = new Map<string, FakeMember>();
  readonly roles = new Map<string, { id: string; projectId: string; isActive: boolean }>();
  readonly assignments = new Map<string, ProjectRoleAssignmentRecord>();

  constructor(private readonly operations: FakeOperations) {}

  addMember(member: FakeMember): void {
    this.members.set(`${member.projectId}:${member.userId}`, member);
  }

  addRole(role: { id: string; projectId: string; isActive: boolean }): void {
    this.roles.set(role.id, role);
  }

  async findManager(projectId: string, userId: string): Promise<FakeMember | null> {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }

  async findTargetMember(projectId: string, userId: string): Promise<FakeMember | null> {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }

  async findRole(
    projectId: string,
    roleId: string,
  ): Promise<{ id: string; projectId: string; isActive: boolean } | null> {
    const role = this.roles.get(roleId);
    return role && role.projectId === projectId ? role : null;
  }

  async findAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<ProjectRoleAssignmentRecord | null> {
    return this.assignments.get(`${projectId}:${userId}:${roleId}`) ?? null;
  }

  async assign(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView> {
    const member = this.members.get(`${input.projectId}:${input.userId}`);
    if (!member) throw new Error('target member missing');
    const key = `${input.projectId}:${input.userId}:${input.roleId}`;
    let assignment = this.assignments.get(key);
    if (assignment?.revokedAt) {
      assignment = { ...assignment, revokedAt: null, version: assignment.version + 1 };
      this.assignments.set(key, assignment);
    } else if (!assignment) {
      assignment = {
        id: randomUUID(),
        projectId: input.projectId,
        userId: input.userId,
        roleId: input.roleId,
        version: 1,
        revokedAt: null,
      };
      this.assignments.set(key, assignment);
    }
    member.version += 1;
    return this.persist(input, member, assignment);
  }

  async revoke(input: ProjectRoleChangeInput): Promise<ProjectRoleMutationView> {
    const member = this.members.get(`${input.projectId}:${input.userId}`);
    if (!member) throw new Error('target member missing');
    const key = `${input.projectId}:${input.userId}:${input.roleId}`;
    const existing = this.assignments.get(key);
    if (!existing || existing.revokedAt) throw new Error('active assignment missing');
    const assignment: ProjectRoleAssignmentRecord = {
      ...existing,
      revokedAt: input.now,
      version: existing.version + 1,
    };
    this.assignments.set(key, assignment);
    member.version += 1;
    return this.persist(input, member, assignment);
  }

  private persist(
    input: ProjectRoleChangeInput,
    member: FakeMember,
    assignment: ProjectRoleAssignmentRecord,
  ): ProjectRoleMutationView {
    const view: ProjectRoleMutationView = {
      member: {
        id: member.userId,
        email: member.email,
        name: member.email,
        role: member.role,
        version: member.version,
      },
      assignment: {
        id: assignment.id,
        userId: assignment.userId,
        roleId: assignment.roleId,
        version: assignment.version,
        revokedAt: assignment.revokedAt ? assignment.revokedAt.toISOString() : null,
      },
    };
    this.operations.record({
      id: input.operation.id,
      projectScopeKey: input.operation.projectScopeKey,
      principalScopeKey: input.operation.principalScopeKey,
      key: input.operation.key,
      method: input.operation.method,
      route: input.operation.route,
      requestDigest: input.operation.requestDigest,
      resultRefs: { member: view.member, assignment: view.assignment },
      committedAt: input.now,
    });
    return view;
  }
}

type FakeProjectRow = {
  id: string;
  name: string;
  key: string;
  description: string | null;
  version: number;
  createdById: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeKnowledgeBaseRow = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  visibility: 'PROJECT' | 'RESTRICTED';
  publicationApproverUserId: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** 只实现 ProjectsService 用到的 Prisma 模型方法，不模拟数据库事务语义。 */
class FakePrisma {
  readonly projects = new Map<string, FakeProjectRow>();
  readonly knowledgeBases: FakeKnowledgeBaseRow[] = [];
  readonly members: Array<{
    projectId: string;
    userId: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
    version: number;
    revokedAt: Date | null;
    grantedAt: Date;
  }> = [];

  addProject(project: Partial<FakeProjectRow> & { id: string; key: string }): void {
    this.projects.set(project.id, {
      id: project.id,
      name: project.name ?? project.key,
      key: project.key,
      description: project.description ?? null,
      version: project.version ?? 1,
      createdById: project.createdById ?? OWNER_ID,
      archivedAt: project.archivedAt ?? null,
      createdAt: project.createdAt ?? NOW,
      updatedAt: project.updatedAt ?? NOW,
    });
  }

  addKnowledgeBase(projectId: string, id: string, key: string): void {
    this.knowledgeBases.push({
      id,
      projectId,
      key,
      name: '产品知识库',
      visibility: 'PROJECT',
      publicationApproverUserId: OWNER_ID,
      archivedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  }

  readonly users = new Map<string, { id: string; email: string }>();

  addUser(user: { id: string; email: string }): void {
    this.users.set(user.email.toLowerCase(), user);
  }

  async $transaction<T>(run: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return run(this);
  }

  readonly user = {
    findUnique: async (args: { where: { email: string }; select: { id: true; email: true } }) =>
      this.users.get(args.where.email.toLowerCase()) ?? null,
  };

  readonly project = {
    findMany: async (args?: {
      where?: {
        archivedAt?: Date | null;
        members?: { some?: { userId?: string; revokedAt?: Date | null } };
      };
    }): Promise<FakeProjectRow[]> => {
      const userId = args?.where?.members?.some?.userId;
      return [...this.projects.values()]
        .filter((project) => project.archivedAt === null)
        .filter(
          (project) =>
            !userId ||
            this.members.some(
              (member) =>
                member.projectId === project.id &&
                member.userId === userId &&
                member.revokedAt === null,
            ),
        )
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    },
    create: async (args: {
      data: { name: string; key: string; description?: string | null; createdById: string };
    }): Promise<FakeProjectRow> => {
      const row: FakeProjectRow = {
        id: randomUUID(),
        name: args.data.name,
        key: args.data.key,
        description: args.data.description ?? null,
        version: 1,
        createdById: args.data.createdById,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      this.projects.set(row.id, row);
      return row;
    },
    update: async (args: {
      where: { id: string };
      data: {
        name?: string;
        description?: string;
        archivedAt?: Date;
        version: { increment: number };
      };
    }): Promise<FakeProjectRow> => {
      const row = this.projects.get(args.where.id);
      if (!row) throw new Error('project missing');
      const updated: FakeProjectRow = {
        ...row,
        ...(args.data.name === undefined ? {} : { name: args.data.name }),
        ...(args.data.description === undefined ? {} : { description: args.data.description }),
        ...(args.data.archivedAt === undefined ? {} : { archivedAt: args.data.archivedAt }),
        version: row.version + args.data.version.increment,
        updatedAt: NOW,
      };
      this.projects.set(updated.id, updated);
      return updated;
    },
  };

  readonly projectMember = {
    findUnique: async (args: {
      where: { projectId_userId: { projectId: string; userId: string } };
    }) =>
      this.members.find(
        (member) =>
          member.projectId === args.where.projectId_userId.projectId &&
          member.userId === args.where.projectId_userId.userId,
      ) ?? null,
    create: async (args: {
      data: {
        projectId: string;
        userId: string;
        role: 'OWNER' | 'ADMIN' | 'MEMBER';
        version?: number;
      };
    }) => {
      const row = {
        projectId: args.data.projectId,
        userId: args.data.userId,
        role: args.data.role,
        version: args.data.version ?? 1,
        revokedAt: null,
        grantedAt: NOW,
      };
      this.members.push(row);
      return row;
    },
    update: async (args: {
      where: { projectId_userId: { projectId: string; userId: string } };
      data: {
        role?: 'OWNER' | 'ADMIN' | 'MEMBER';
        revokedAt?: Date | null;
        version?: { increment: number };
      };
    }) => {
      const row = this.members.find(
        (member) =>
          member.projectId === args.where.projectId_userId.projectId &&
          member.userId === args.where.projectId_userId.userId,
      );
      if (!row) throw new Error('project member missing');
      if (args.data.role !== undefined) row.role = args.data.role;
      if (args.data.revokedAt !== undefined) row.revokedAt = args.data.revokedAt;
      if (args.data.version) row.version += args.data.version.increment;
      return row;
    },
  };

  readonly projectRole = {
    create: async (args: {
      data: { projectId: string; key: string; title: string; isActive?: boolean };
    }) => ({
      id: randomUUID(),
      projectId: args.data.projectId,
      key: args.data.key,
      title: args.data.title,
      isActive: args.data.isActive ?? true,
      version: 1,
      createdAt: NOW,
    }),
  };

  readonly projectRoleAssignment = {
    createMany: async (args: {
      data: Array<{ projectId: string; userId: string; roleId: string }>;
    }) => ({
      count: args.data.length,
    }),
  };

  readonly knowledgeBase = {
    findMany: async (args: {
      where: { projectId: { in: string[] }; key: string; archivedAt: Date | null };
      select: { id: true; projectId: true };
    }) =>
      this.knowledgeBases
        .filter(
          (item) =>
            args.where.projectId.in.includes(item.projectId) &&
            item.key === args.where.key &&
            item.archivedAt === args.where.archivedAt,
        )
        .map((item) => ({ id: item.id, projectId: item.projectId })),
    findFirst: async (args: {
      where: { projectId: string; key: string; archivedAt: Date | null };
      select: { id: true };
      orderBy?: { createdAt: 'asc' };
    }): Promise<{ id: string } | null> => {
      const found = this.knowledgeBases.find(
        (item) =>
          item.projectId === args.where.projectId &&
          item.key === args.where.key &&
          item.archivedAt === args.where.archivedAt,
      );
      return found ? { id: found.id } : null;
    },
    create: async (args: {
      data: {
        projectId: string;
        key: string;
        name: string;
        visibility: 'PROJECT' | 'RESTRICTED';
        publicationApproverUserId: string;
      };
    }) => {
      const row: FakeKnowledgeBaseRow = {
        id: randomUUID(),
        projectId: args.data.projectId,
        key: args.data.key,
        name: args.data.name,
        visibility: args.data.visibility,
        publicationApproverUserId: args.data.publicationApproverUserId,
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      };
      this.knowledgeBases.push(row);
      return row;
    },
  };

  readonly knowledgeBaseGrant = {
    create: async (args: { data: Record<string, unknown> }) => ({ id: randomUUID(), ...args.data }),
  };
}

function ticketFor(input: {
  id: string;
  action: 'PROJECT_ROLE_ASSIGN' | 'PROJECT_ROLE_UNASSIGN';
  targetId: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
  secret?: string;
}): V1TicketRecord {
  const binding: ActionBinding = {
    action: input.action,
    projectId: PROJECT_ID,
    targetType: 'PROJECT_MEMBER',
    targetId: input.targetId,
    expectedVersion: input.expectedVersion,
    roleSlot: null,
    payload: input.payload,
  };
  const secret = input.secret ?? TICKET_SECRET;
  return {
    id: input.id,
    secretHash: hashTicketSecret(secret),
    userId: OWNER_ID,
    webSessionId: SESSION_ID,
    projectId: PROJECT_ID,
    userAuthVersion: 1,
    action: input.action,
    targetType: 'PROJECT_MEMBER',
    targetId: input.targetId,
    expectedVersion: input.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: null,
    approvalSlotId: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
  };
}

function ownerPrincipal(): V1Principal {
  return { kind: 'HUMAN', userId: OWNER_ID, scopes: [], sessionId: SESSION_ID, authVersion: 1 };
}

function context(overrides?: Partial<ProjectRoleChangeContext>): ProjectRoleChangeContext {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    method: 'PUT',
    route: `/api/v1/projects/${PROJECT_ID}/members/${TARGET_ID}/roles/${ROLE_ACTIVE_ID}`,
    body: { expectedVersion: 1, reason: REASON },
    operationId: randomUUID(),
    now: NOW,
    webSessionId: SESSION_ID,
    userAuthVersion: 1,
    ...overrides,
  };
}

function assignRequest(expectedVersion: number, reason = REASON) {
  return {
    expectedVersion,
    reason,
    confirmation: { ticketId: TICKET_ID, ticketSecret: TICKET_SECRET },
  };
}

function bootstrap() {
  const operations = new FakeOperations();
  const tickets = new FakeTickets();
  const roles = new FakeRoleRepository(operations);
  const prisma = new FakePrisma();
  prisma.addProject({ id: PROJECT_ID, key: 'DEMO', name: 'Demo' });
  for (const [userId, role] of [
    [OWNER_ID, 'OWNER'],
    [MEMBER_ID, 'MEMBER'],
    [TARGET_ID, 'MEMBER'],
  ] as const)
    prisma.members.push({
      projectId: PROJECT_ID,
      userId,
      role,
      version: 1,
      revokedAt: null,
      grantedAt: NOW,
    });
  prisma.addKnowledgeBase(PROJECT_ID, 'kb-default', DEFAULT_KNOWLEDGE_BASE_KEY);
  roles.addRole({ id: ROLE_ACTIVE_ID, projectId: PROJECT_ID, isActive: true });
  roles.addRole({ id: ROLE_INACTIVE_ID, projectId: PROJECT_ID, isActive: false });
  for (const [userId, role] of [
    [OWNER_ID, 'OWNER'],
    [MEMBER_ID, 'MEMBER'],
    [TARGET_ID, 'MEMBER'],
  ] as const)
    roles.addMember({
      projectId: PROJECT_ID,
      userId,
      role,
      version: 1,
      revokedAt: null,
      email: `${role.toLowerCase()}-${userId.slice(0, 4)}@example.com`,
    });
  const service = new ProjectsService(
    prisma as unknown as PrismaService,
    roles,
    tickets,
    operations,
  );
  return { service, prisma, roles, tickets, operations };
}

async function expectRejection(
  run: Promise<unknown>,
  code: string,
  message: string,
  status: number,
): Promise<void> {
  let caught: unknown;
  try {
    await run;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WorkmeshError);
  const typed = caught as WorkmeshError;
  expect(typed.code).toBe(code);
  expect(typed.message).toBe(message);
  expect(typed.status).toBe(status);
}

describe('ProjectsService role grants', () => {
  let env: ReturnType<typeof bootstrap>;

  beforeEach(() => {
    env = bootstrap();
  });

  it('returns 404 PROJECT_NOT_FOUND for a non-manager member', async () => {
    const principal: V1Principal = {
      kind: 'HUMAN',
      userId: MEMBER_ID,
      scopes: [],
      sessionId: SESSION_ID,
      authVersion: 1,
    };
    await expectRejection(
      env.service.assignRole(
        principal,
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'PROJECT_NOT_FOUND',
      404,
    );
  });

  it('rejects AGENT principals with 403 HUMAN_SESSION_REQUIRED', async () => {
    const principal: V1Principal = {
      kind: 'AGENT',
      userId: OWNER_ID,
      agentCredentialId: 'credential-1',
      projectId: PROJECT_ID,
      roleIds: [ROLE_ACTIVE_ID],
      scopes: [],
    };
    await expectRejection(
      env.service.assignRole(
        principal,
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      403,
    );
  });

  it('rejects HUMAN principals without a WebSession id', async () => {
    const principal: V1Principal = { kind: 'HUMAN', userId: OWNER_ID, scopes: [], authVersion: 1 };
    await expectRejection(
      env.service.assignRole(
        principal,
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      403,
    );
  });

  it('rejects a missing confirmation ticket with 403', async () => {
    await expectRejection(
      env.service.assignRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_NOT_FOUND',
      403,
    );
  });

  it('rejects a ticket bound to another action with 403', async () => {
    env.tickets.seed(
      ticketFor({
        id: TICKET_ID,
        action: 'PROJECT_ROLE_UNASSIGN',
        targetId: TARGET_ID,
        expectedVersion: 1,
        payload: { userId: TARGET_ID, roleId: ROLE_ACTIVE_ID, reason: REASON },
      }),
    );
    await expectRejection(
      env.service.assignRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_ACTION_MISMATCH',
      403,
    );
  });

  it('rejects a stale expectedVersion with 409 VERSION_CONFLICT', async () => {
    await expectRejection(
      env.service.assignRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(2),
        context({ body: { expectedVersion: 2, reason: REASON } }),
      ),
      V1_ERROR_CODES.VERSION_CONFLICT,
      'VERSION_CONFLICT',
      409,
    );
  });

  it('rejects an inactive project role with 404', async () => {
    await expectRejection(
      env.service.assignRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_INACTIVE_ID,
        assignRequest(1),
        context(),
      ),
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'PROJECT_ROLE_NOT_FOUND',
      404,
    );
  });

  it('grants a role, bumps member version, and replays the same idempotency key', async () => {
    env.tickets.seed(
      ticketFor({
        id: TICKET_ID,
        action: 'PROJECT_ROLE_ASSIGN',
        targetId: TARGET_ID,
        expectedVersion: 1,
        payload: { userId: TARGET_ID, roleId: ROLE_ACTIVE_ID, reason: REASON },
      }),
    );
    const first = await env.service.assignRole(
      ownerPrincipal(),
      PROJECT_ID,
      TARGET_ID,
      ROLE_ACTIVE_ID,
      assignRequest(1),
      context(),
    );
    expect(first.member.version).toBe(2);
    expect(first.assignment.version).toBe(1);
    expect(first.assignment.revokedAt).toBeNull();

    const replay = await env.service.assignRole(
      ownerPrincipal(),
      PROJECT_ID,
      TARGET_ID,
      ROLE_ACTIVE_ID,
      { ...assignRequest(1), confirmation: { ticketId: OTHER_TICKET_ID, ticketSecret: 'unused' } },
      context(),
    );
    expect(replay).toEqual(first);
    expect(env.roles.members.get(`${PROJECT_ID}:${TARGET_ID}`)?.version).toBe(2);

    await expectRejection(
      env.service.assignRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        assignRequest(1, 'changed reason'),
        context({ body: { expectedVersion: 1, reason: 'changed reason' } }),
      ),
      V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'IDEMPOTENCY_DIGEST_CONFLICT',
      409,
    );
  });

  it('revokes an assignment and revives it on re-grant with increasing versions', async () => {
    env.tickets.seed(
      ticketFor({
        id: TICKET_ID,
        action: 'PROJECT_ROLE_ASSIGN',
        targetId: TARGET_ID,
        expectedVersion: 1,
        payload: { userId: TARGET_ID, roleId: ROLE_ACTIVE_ID, reason: REASON },
      }),
    );
    const granted = await env.service.assignRole(
      ownerPrincipal(),
      PROJECT_ID,
      TARGET_ID,
      ROLE_ACTIVE_ID,
      assignRequest(1),
      context(),
    );

    const revokeTicketId = '12121212-1212-4122-8122-121212121212';
    const revokeSecret = 'secret-revoke';
    env.tickets.seed(
      ticketFor({
        id: revokeTicketId,
        action: 'PROJECT_ROLE_UNASSIGN',
        targetId: TARGET_ID,
        expectedVersion: granted.member.version,
        payload: { userId: TARGET_ID, roleId: ROLE_ACTIVE_ID, reason: 'revoke role' },
        secret: revokeSecret,
      }),
    );
    const revoked = await env.service.revokeRole(
      ownerPrincipal(),
      PROJECT_ID,
      TARGET_ID,
      ROLE_ACTIVE_ID,
      {
        expectedVersion: granted.member.version,
        reason: 'revoke role',
        confirmation: { ticketId: revokeTicketId, ticketSecret: revokeSecret },
      },
      context({
        idempotencyKey: '13131313-1313-4133-8133-131313131313',
        method: 'POST',
        route: `/api/v1/projects/${PROJECT_ID}/members/${TARGET_ID}/roles/${ROLE_ACTIVE_ID}/revoke`,
        body: { expectedVersion: granted.member.version, reason: 'revoke role' },
      }),
    );
    expect(revoked.member.version).toBe(3);
    expect(revoked.assignment.version).toBe(2);
    expect(revoked.assignment.revokedAt).toBe(NOW.toISOString());

    const regrantTicketId = '14141414-1414-4144-8144-141414141414';
    const regrantSecret = 'secret-regrant';
    env.tickets.seed(
      ticketFor({
        id: regrantTicketId,
        action: 'PROJECT_ROLE_ASSIGN',
        targetId: TARGET_ID,
        expectedVersion: revoked.member.version,
        payload: { userId: TARGET_ID, roleId: ROLE_ACTIVE_ID, reason: 'restore role' },
        secret: regrantSecret,
      }),
    );
    const revived = await env.service.assignRole(
      ownerPrincipal(),
      PROJECT_ID,
      TARGET_ID,
      ROLE_ACTIVE_ID,
      {
        expectedVersion: revoked.member.version,
        reason: 'restore role',
        confirmation: { ticketId: regrantTicketId, ticketSecret: regrantSecret },
      },
      context({
        idempotencyKey: '15151515-1515-4155-8155-151515151515',
        body: { expectedVersion: revoked.member.version, reason: 'restore role' },
      }),
    );
    expect(revived.member.version).toBe(4);
    expect(revived.assignment.id).toBe(granted.assignment.id);
    expect(revived.assignment.version).toBe(3);
    expect(revived.assignment.revokedAt).toBeNull();
  });

  it('returns 404 ASSIGNMENT_NOT_FOUND when revoking an inactive assignment', async () => {
    await expectRejection(
      env.service.revokeRole(
        ownerPrincipal(),
        PROJECT_ID,
        TARGET_ID,
        ROLE_ACTIVE_ID,
        { ...assignRequest(1), reason: 'revoke missing' },
        context({
          method: 'POST',
          route: `/api/v1/projects/${PROJECT_ID}/members/${TARGET_ID}/roles/${ROLE_ACTIVE_ID}/revoke`,
          body: { expectedVersion: 1, reason: 'revoke missing' },
        }),
      ),
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'ASSIGNMENT_NOT_FOUND',
      404,
    );
  });
});

describe('ProjectsService project views', () => {
  it('includes defaultKnowledgeBaseId in the project list', async () => {
    const env = bootstrap();
    const withoutDefault = '16161616-1616-4166-8166-161616161616';
    env.prisma.addProject({ id: withoutDefault, key: 'EMPTY' });
    env.prisma.members.push({
      projectId: withoutDefault,
      userId: OWNER_ID,
      role: 'OWNER',
      version: 1,
      revokedAt: null,
      grantedAt: NOW,
    });
    const rows = await env.service.list(OWNER_ID);
    const demo = rows.find((row) => row.id === PROJECT_ID);
    const empty = rows.find((row) => row.id === withoutDefault);
    expect(demo?.defaultKnowledgeBaseId).toBe('kb-default');
    expect(empty?.defaultKnowledgeBaseId).toBeNull();
  });

  it('returns the created default knowledge base id from POST /projects', async () => {
    const env = bootstrap();
    const created = await env.service.create(OWNER_ID, { name: 'Second', key: 'SEC' });
    expect(created.defaultKnowledgeBaseId).not.toBeNull();
    const rows = await env.service.list(OWNER_ID);
    expect(rows.find((row) => row.id === created.id)?.defaultKnowledgeBaseId).toBe(
      created.defaultKnowledgeBaseId,
    );
  });
});

describe('ProjectsService description contract', () => {
  it('persists description on create and keeps it when only the name changes', async () => {
    const env = bootstrap();
    const created = await env.service.create(OWNER_ID, {
      name: 'Second',
      key: 'SEC',
      description: '试点项目',
    });
    expect(created.description).toBe('试点项目');
    const updated = await env.service.update(OWNER_ID, created.id, { name: 'Second v2' });
    expect(updated.name).toBe('Second v2');
    expect(updated.description).toBe('试点项目');
    expect(env.prisma.projects.get(created.id)?.description).toBe('试点项目');
  });

  it('updates description without touching the name', async () => {
    const env = bootstrap();
    const updated = await env.service.update(OWNER_ID, PROJECT_ID, { description: '补充描述' });
    expect(updated.name).toBe('Demo');
    expect(updated.description).toBe('补充描述');
  });
});

describe('ProjectsService addMemberByEmail', () => {
  const NEW_ID = '17171717-1717-4177-8177-171717171717';

  it('OWNER adds a registered user by normalized email and replays idempotently', async () => {
    const env = bootstrap();
    env.prisma.addUser({ id: NEW_ID, email: 'new@example.com' });
    const first = await env.service.addMemberByEmail(OWNER_ID, PROJECT_ID, '  NEW@example.com ');
    expect(first).toMatchObject({
      id: NEW_ID,
      email: 'new@example.com',
      role: 'MEMBER',
      version: 1,
    });
    const stored = env.prisma.members.find((member) => member.userId === NEW_ID);
    expect(stored?.revokedAt).toBeNull();

    const replay = await env.service.addMemberByEmail(OWNER_ID, PROJECT_ID, 'new@example.com');
    expect(replay).toEqual(first);
    expect(env.prisma.members.filter((member) => member.userId === NEW_ID)).toHaveLength(1);
  });

  it('reactivates a revoked membership as MEMBER with an incremented version', async () => {
    const env = bootstrap();
    env.prisma.addUser({ id: NEW_ID, email: 'returning@example.com' });
    env.prisma.members.push({
      projectId: PROJECT_ID,
      userId: NEW_ID,
      role: 'ADMIN',
      version: 3,
      revokedAt: new Date('2026-10-01T00:00:00.000Z'),
      grantedAt: NOW,
    });
    const revived = await env.service.addMemberByEmail(
      OWNER_ID,
      PROJECT_ID,
      'returning@example.com',
    );
    expect(revived.role).toBe('MEMBER');
    expect(revived.version).toBe(4);
    expect(env.prisma.members.find((member) => member.userId === NEW_ID)?.revokedAt).toBeNull();
  });

  it('rejects plain members before resolving the target email', async () => {
    const env = bootstrap();
    await expect(
      env.service.addMemberByEmail(MEMBER_ID, PROJECT_ID, 'new@example.com'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns 404 USER_NOT_FOUND for an unregistered email', async () => {
    const env = bootstrap();
    await expectRejection(
      env.service.addMemberByEmail(OWNER_ID, PROJECT_ID, 'missing@example.com'),
      V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      'USER_NOT_FOUND',
      404,
    );
  });
});
