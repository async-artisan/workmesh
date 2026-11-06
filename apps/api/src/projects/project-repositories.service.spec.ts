import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  principalScopeKey,
  projectScopeKey,
  type ActionBinding,
} from '@workmesh/shared';
import {
  actionDigestOf,
  hashTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from '../auth/v1-confirmation';
import type { V1ProjectContext } from '../auth/v1-authorization';
import type { V1Principal } from '../auth/v1-policy';
import type { V1OperationRecord } from '../common/v1-idempotency';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateProjectRepositoryDto } from './dto';
import {
  ProjectsService,
  REPOSITORY_ARCHIVE,
  REPOSITORY_REGISTER,
  type ProjectWriteContext,
} from './projects.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const TICKET_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';
const SECRET = 'ticket-secret';
const NOW = new Date('2026-11-05T10:00:00.000Z');

const principal: V1Principal = {
  kind: 'HUMAN',
  userId: USER_ID,
  sessionId: SESSION_ID,
  authVersion: 1,
  scopes: [],
};

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

class FakeOperations {
  records: V1OperationRecord[] = [];

  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.projectScopeKey === input.projectScopeKey &&
          record.principalScopeKey === input.principalScopeKey &&
          record.key === input.key,
      ) ?? null
    );
  }

  async record(record: Omit<V1OperationRecord, 'id' | 'committedAt'>): Promise<void> {
    this.records.push({ ...record, id: randomUUID(), committedAt: new Date() });
  }
}

class FakeTickets implements V1ConfirmationRepository {
  private readonly tickets = new Map<string, V1TicketRecord>();

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async createTicket(): Promise<V1TicketRecord> {
    throw new Error('ticket creation happens elsewhere');
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  async consumeTicket(): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    return { consumed: false, ticket: null };
  }
}

class FakePrisma {
  version = 3;
  archivedAt: Date | null = null;
  member: { role: MemberRole; version: number; revokedAt: Date | null } | null = {
    role: 'OWNER',
    version: 2,
    revokedAt: null,
  };
  repositories: Array<Record<string, unknown>> = [];
  locators: Array<Record<string, unknown>> = [];
  stamps: Array<Record<string, unknown>> = [];
  audits: Array<Record<string, unknown>> = [];
  operations = new FakeOperations();
  failNextRepositoryCreate = false;
  private readonly id = { value: 1 };

  nextId(prefix: string): string {
    const value = `${prefix}-${this.id.value}`;
    this.id.value += 1;
    return value;
  }

  readonly prisma: Record<string, unknown>;

  constructor() {
    this.prisma = this.build();
  }

  private build(): Record<string, unknown> {
    return {
      projectMember: {
        findUnique: async () => (this.member ? { ...this.member } : null),
      },
      project: {
        findUnique: async () => ({
          version: this.version,
          archivedAt: this.archivedAt,
        }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; version: number; archivedAt?: null };
          data: { version: { increment: number } };
        }) => {
          if (where.id !== PROJECT_ID || where.version !== this.version) return { count: 0 };
          if (where.archivedAt === null && this.archivedAt !== null) return { count: 0 };
          this.version += data.version.increment;
          return { count: 1 };
        },
      },
      projectRepository: {
        findMany: async ({ where }: { where: { projectId: string; archivedAt?: null } }) =>
          this.repositories.filter(
            (row) =>
              row.projectId === where.projectId &&
              (where.archivedAt === undefined || row.archivedAt === where.archivedAt),
          ),
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          this.repositories.find((row) =>
            Object.entries(where).every(([key, value]) => {
              if (value === undefined) return true;
              if (value === null) return row[key] === null;
              return row[key] === value;
            }),
          ) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (this.failNextRepositoryCreate) {
            this.failNextRepositoryCreate = false;
            throw { code: 'P2002', meta: { target: ['projectId', 'adapter', 'externalId'] } };
          }
          const row = {
            id: this.nextId('repo'),
            archivedAt: null,
            lastVerifiedStatus: null,
            lastVerifiedAt: null,
            createdAt: new Date('2026-11-01T00:00:00.000Z'),
            locators: [],
            ...data,
          };
          this.repositories.push(row);
          return row;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = this.repositories.find((item) => item.id === where.id);
          if (!row) throw new Error('missing repository');
          Object.assign(row, data);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; projectId: string; archivedAt: { not: null } };
          data: { archivedAt: null };
        }) => {
          const row = this.repositories.find(
            (item) =>
              item.id === where.id &&
              item.projectId === where.projectId &&
              item.archivedAt !== null,
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
      projectRepositoryLocator: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          this.locators.find((row) =>
            Object.entries(where).every(([key, value]) => {
              if (value === undefined) return true;
              if (value === null) return row[key] === null;
              return row[key] === value;
            }),
          ) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: this.nextId('locator'), ...data };
          this.locators.push(row);
          return row;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: { repositoryId: string; projectId: string; revokedAt: null };
          data: { revokedAt: Date; revokedByUserId: string };
        }) => {
          let count = 0;
          for (const row of this.locators) {
            if (
              row.repositoryId === where.repositoryId &&
              row.projectId === where.projectId &&
              row.revokedAt === null
            ) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        },
      },
      principalStamp: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: this.nextId('stamp'), ...data };
          this.stamps.push(row);
          return row;
        },
      },
      auditEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          this.audits.push(data);
          return { id: this.nextId('audit') };
        },
      },
      idempotentOperation: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          await this.operations.record({
            projectScopeKey: String(data.projectScopeKey),
            principalScopeKey: String(data.principalScopeKey),
            key: String(data.key),
            method: String(data.method),
            route: String(data.route),
            requestDigest: String(data.requestDigest),
            resultRefs: data.resultRefs as Record<string, unknown>,
          });
          return data;
        },
      },
      $queryRaw: async () => [{ id: PROJECT_ID }],
      $executeRaw: async () => 1,
      $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(this.prisma),
    };
  }

  authorization(): {
    resolveProjectContext: (
      _principal: V1Principal,
      projectId: string,
      mode: 'read' | 'write',
    ) => Promise<V1ProjectContext>;
  } {
    return {
      resolveProjectContext: async (_principal, projectId, mode) => {
        if (projectId !== PROJECT_ID)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'MEMBER_NOT_ACTIVE',
            { projectId },
            404,
          );
        if (!this.member || this.member.revokedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'MEMBER_NOT_ACTIVE',
            { projectId },
            404,
          );
        if (mode === 'write' && this.archivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'PROJECT_ARCHIVED',
            { projectId, archivedAt: this.archivedAt.toISOString() },
            409,
          );
        return {
          project: { id: projectId, version: this.version, archivedAt: this.archivedAt },
          membership: {
            projectId,
            userId: USER_ID,
            role: this.member.role,
            version: this.member.version,
            revokedAt: null,
          },
          activeRoleIds: [],
          selectableRoleIds: [],
        };
      },
    };
  }
}

type Harness = {
  db: FakePrisma;
  tickets: FakeTickets;
  service: ProjectsService;
};

function harness(): Harness {
  const db = new FakePrisma();
  const tickets = new FakeTickets();
  const service = new ProjectsService(
    db.prisma as unknown as PrismaService,
    {} as never,
    tickets,
    db.operations as never,
    db.authorization() as never,
  );
  return { db, tickets, service };
}

function context(
  body: Record<string, unknown>,
  overrides: Partial<ProjectWriteContext> = {},
): ProjectWriteContext {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    method: 'POST',
    route: `/api/v1/projects/${PROJECT_ID}/repositories`,
    body,
    operationId: randomUUID(),
    now: NOW,
    webSessionId: SESSION_ID,
    userAuthVersion: 1,
    ...overrides,
  };
}

function seedTicket(
  tickets: FakeTickets,
  binding: ActionBinding,
  options: { expiresAt?: Date } = {},
): { ticketId: string; ticketSecret: string } {
  tickets.seed({
    id: TICKET_ID,
    secretHash: hashTicketSecret(SECRET),
    userId: USER_ID,
    webSessionId: SESSION_ID,
    projectId: binding.projectId,
    userAuthVersion: 1,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: null,
    approvalSlotId: null,
    createdAt: NOW,
    expiresAt: options.expiresAt ?? new Date(NOW.getTime() + 5 * 60 * 1000),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
  });
  return { ticketId: TICKET_ID, ticketSecret: SECRET };
}

function providerDto(
  confirmation: { ticketId: string; ticketSecret: string },
  overrides: Partial<CreateProjectRepositoryDto> = {},
): CreateProjectRepositoryDto {
  return {
    adapter: 'github',
    externalId: '123456789',
    owner: 'async-artisan',
    name: 'workmesh',
    defaultBranch: 'main',
    expectedProjectVersion: 3,
    confirmation,
    ...overrides,
  };
}

function seedProviderTicket(tickets: FakeTickets) {
  return seedTicket(tickets, {
    action: REPOSITORY_REGISTER,
    projectId: PROJECT_ID,
    targetType: 'PROJECT',
    targetId: PROJECT_ID,
    expectedVersion: 3,
    roleSlot: null,
    payload: {
      adapter: 'github',
      externalId: '123456789',
      owner: 'async-artisan',
      name: 'workmesh',
      defaultBranch: 'main',
    },
  });
}

function seedArchiveTicket(tickets: FakeTickets, repositoryId: string) {
  return seedTicket(tickets, {
    action: REPOSITORY_ARCHIVE,
    projectId: PROJECT_ID,
    targetType: 'PROJECT_REPOSITORY',
    targetId: repositoryId,
    expectedVersion: 3,
    roleSlot: null,
    payload: { repositoryId },
  });
}

function bodyOf(dto: CreateProjectRepositoryDto): Record<string, unknown> {
  return {
    expectedProjectVersion: dto.expectedProjectVersion,
    adapter: dto.adapter,
    externalId: dto.externalId,
    owner: dto.owner,
    name: dto.name,
    defaultBranch: dto.defaultBranch,
    confirmation: dto.confirmation,
  };
}

describe('项目代码仓库：列表与既有写路径补强', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  it('列表扩展 identityMode/locators/provider，DECLARED 行不伪造 adapter/externalId', async () => {
    ctx.db.repositories.push({
      id: 'repo-declared',
      projectId: PROJECT_ID,
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      owner: 'acme',
      name: 'web',
      defaultBranch: null,
      archivedAt: null,
      lastVerifiedStatus: null,
      lastVerifiedAt: null,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      locators: [
        {
          id: 'locator-1',
          canonicalLocator: 'https://github.com/acme/web.git',
          source: 'HTTPS',
          declaredAt: new Date('2026-11-01T00:00:00.000Z'),
        },
      ],
    });
    ctx.db.repositories.push({
      id: 'repo-provider',
      projectId: PROJECT_ID,
      identityMode: 'PROVIDER',
      adapter: 'github',
      externalId: '987654321',
      owner: 'acme',
      name: 'api',
      defaultBranch: 'main',
      archivedAt: null,
      lastVerifiedStatus: 'PROVIDER_VERIFIED',
      lastVerifiedAt: new Date('2026-11-02T00:00:00.000Z'),
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      locators: [],
    });

    const rows = await ctx.service.repositories(USER_ID, PROJECT_ID);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'repo-declared',
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      provider: null,
      locators: [
        {
          id: 'locator-1',
          canonicalLocator: 'https://github.com/acme/web.git',
          source: 'HTTPS',
          declaredAt: '2026-11-01T00:00:00.000Z',
        },
      ],
    });
    expect(rows[1]).toMatchObject({
      identityMode: 'PROVIDER',
      provider: { adapter: 'github', externalId: '987654321' },
      lastVerifiedStatus: 'PROVIDER_VERIFIED',
      lastVerifiedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  it('provider 登记：票据 + 幂等 + CAS 后递增项目版本并写 actorStamp 审计', async () => {
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation);

    const view = await ctx.service.createRepository(
      principal,
      PROJECT_ID,
      dto,
      context(bodyOf(dto)),
    );

    expect(view).toMatchObject({
      identityMode: 'PROVIDER',
      adapter: 'github',
      externalId: '123456789',
      provider: { adapter: 'github', externalId: '123456789' },
      projectVersion: 4,
      replayed: false,
    });
    expect(ctx.db.version).toBe(4);
    expect(ctx.db.stamps).toHaveLength(1);
    expect(ctx.db.audits[0]).toMatchObject({
      action: REPOSITORY_REGISTER,
      actorStampId: ctx.db.stamps[0]!.id,
      targetType: 'PROJECT_REPOSITORY',
      outcome: 'SUCCESS',
    });
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('同 key 同内容重放返回原结果且不重复写仓库/审计', async () => {
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation);
    const first = context(bodyOf(dto));
    const replay = context(bodyOf(dto));

    await ctx.service.createRepository(principal, PROJECT_ID, dto, first);
    const again = await ctx.service.createRepository(principal, PROJECT_ID, dto, replay);

    expect(again.replayed).toBe(true);
    expect(again.id).toBe((await ctx.service.repositories(USER_ID, PROJECT_ID))[0]!.id);
    expect(ctx.db.repositories).toHaveLength(1);
    expect(ctx.db.audits).toHaveLength(1);
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('同 key 不同内容返回 409 IDEMPOTENCY_DIGEST_CONFLICT', async () => {
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation);
    await ctx.service.createRepository(principal, PROJECT_ID, dto, context(bodyOf(dto)));

    await expect(
      ctx.service.createRepository(
        principal,
        PROJECT_ID,
        providerDto(confirmation, { name: 'renamed' }),
        context(bodyOf(providerDto(confirmation, { name: 'renamed' }))),
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_DIGEST_CONFLICT', status: 409 });
  });

  it('expectedProjectVersion 过期返回 409 PROJECT_VERSION_CONFLICT', async () => {
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation, { expectedProjectVersion: 2 });
    await expect(
      ctx.service.createRepository(
        principal,
        PROJECT_ID,
        dto,
        context({ ...bodyOf(dto), expectedProjectVersion: 2 }),
      ),
    ).rejects.toMatchObject({ code: 'PROJECT_VERSION_CONFLICT', status: 409 });
  });

  it('普通成员/归档项目/缺票据均被拒绝', async () => {
    ctx.db.member!.role = 'MEMBER';
    const confirmation = seedProviderTicket(ctx.tickets);
    await expect(
      ctx.service.createRepository(
        principal,
        PROJECT_ID,
        providerDto(confirmation),
        context(bodyOf(providerDto(confirmation))),
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    ctx.db.member = { role: 'OWNER', version: 2, revokedAt: null };
    ctx.db.archivedAt = new Date('2026-11-04T00:00:00.000Z');
    await expect(
      ctx.service.createRepository(
        principal,
        PROJECT_ID,
        providerDto(confirmation),
        context(bodyOf(providerDto(confirmation))),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });

    ctx.db.archivedAt = null;
    const noTicket = { ticketId: randomUUID(), ticketSecret: SECRET };
    await expect(
      ctx.service.createRepository(
        principal,
        PROJECT_ID,
        providerDto(noTicket),
        context(bodyOf(providerDto(noTicket))),
      ),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID', status: 403 });
  });

  it('P2002（并发重复 provider 身份）转换为 409 REPOSITORY_EXISTS', async () => {
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation);
    ctx.db.failNextRepositoryCreate = true;
    await expect(
      ctx.service.createRepository(principal, PROJECT_ID, dto, context(bodyOf(dto))),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'REPOSITORY_EXISTS' });
  });

  it('归档：票据 + CAS 生效、撤销活跃 locator、写 actorStamp 审计；重放不重复消费', async () => {
    const repository = {
      id: 'repo-declared',
      projectId: PROJECT_ID,
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      owner: 'acme',
      name: 'web',
      defaultBranch: null,
      archivedAt: null,
      lastVerifiedStatus: null,
      lastVerifiedAt: null,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      locators: [],
    };
    ctx.db.repositories.push(repository);
    ctx.db.locators.push({
      id: 'locator-1',
      projectId: PROJECT_ID,
      repositoryId: repository.id,
      canonicalLocator: 'https://github.com/acme/web.git',
      source: 'HTTPS',
      revokedAt: null,
    });
    const confirmation = seedArchiveTicket(ctx.tickets, repository.id);
    const body = {
      expectedProjectVersion: 3,
      confirmation,
    };
    const first = context(body, {
      method: 'DELETE',
      route: `/api/v1/projects/${PROJECT_ID}/repositories/${repository.id}`,
    });

    const result = await ctx.service.archiveRepository(
      principal,
      PROJECT_ID,
      repository.id,
      body,
      first,
    );
    expect(result).toMatchObject({
      repositoryId: repository.id,
      projectVersion: 4,
      replayed: false,
    });
    expect(ctx.db.version).toBe(4);
    expect(repository.archivedAt).toBeInstanceOf(Date);
    expect(ctx.db.locators[0]!.revokedAt).toBeInstanceOf(Date);
    expect(ctx.db.audits[0]).toMatchObject({
      action: REPOSITORY_ARCHIVE,
      actorStampId: ctx.db.stamps[0]!.id,
    });

    const replayBody = { expectedProjectVersion: 3, confirmation };
    const again = await ctx.service.archiveRepository(
      principal,
      PROJECT_ID,
      repository.id,
      replayBody,
      context(replayBody, {
        method: 'DELETE',
        route: `/api/v1/projects/${PROJECT_ID}/repositories/${repository.id}`,
      }),
    );
    expect(again.replayed).toBe(true);
    expect(ctx.db.version).toBe(4);
    expect(ctx.db.audits).toHaveLength(1);
  });

  it('归档已归档仓库幂等返回；跨项目仓库 404', async () => {
    const archivedAt = new Date('2026-11-03T00:00:00.000Z');
    ctx.db.repositories.push({
      id: 'repo-archived',
      projectId: PROJECT_ID,
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      owner: 'acme',
      name: 'web',
      defaultBranch: null,
      archivedAt,
      lastVerifiedStatus: null,
      lastVerifiedAt: null,
      createdAt: new Date('2026-11-01T00:00:00.000Z'),
      locators: [],
    });
    const confirmation = seedArchiveTicket(ctx.tickets, 'repo-archived');
    const body = { expectedProjectVersion: 3, confirmation };
    const replay = await ctx.service.archiveRepository(
      principal,
      PROJECT_ID,
      'repo-archived',
      body,
      context(body, {
        method: 'DELETE',
        route: `/api/v1/projects/${PROJECT_ID}/repositories/repo-archived`,
      }),
    );
    expect(replay).toMatchObject({ archivedAt: archivedAt.toISOString(), projectVersion: 3 });
    expect(ctx.db.version).toBe(3);

    ctx.tickets.seed({
      id: TICKET_ID,
      secretHash: hashTicketSecret(SECRET),
      userId: USER_ID,
      webSessionId: SESSION_ID,
      projectId: PROJECT_ID,
      userAuthVersion: 1,
      action: REPOSITORY_ARCHIVE,
      targetType: 'PROJECT_REPOSITORY',
      targetId: 'repo-other',
      expectedVersion: 3,
      actionDigest: actionDigestOf({
        action: REPOSITORY_ARCHIVE,
        projectId: PROJECT_ID,
        targetType: 'PROJECT_REPOSITORY',
        targetId: 'repo-other',
        expectedVersion: 3,
        roleSlot: null,
        payload: { repositoryId: 'repo-other' },
      }),
      roleId: null,
      approvalSlotId: null,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 60_000),
      consumedAt: null,
      consumedOperationId: null,
      invalidatedAt: null,
    });
    await expect(
      ctx.service.archiveRepository(
        principal,
        PROJECT_ID,
        'repo-other',
        {
          expectedProjectVersion: 3,
          confirmation: { ticketId: TICKET_ID, ticketSecret: SECRET },
        },
        context(
          { expectedProjectVersion: 3 },
          {
            method: 'DELETE',
            route: `/api/v1/projects/${PROJECT_ID}/repositories/repo-other`,
            idempotencyKey: '77777777-7777-4777-8777-777777777777',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', message: 'REPOSITORY_NOT_FOUND' });
  });
});

describe('项目代码仓库：idempotency 键作用域', () => {
  it('不同 key 同一 provider 身份第二次登记 409 REPOSITORY_EXISTS', async () => {
    const ctx = harness();
    const confirmation = seedProviderTicket(ctx.tickets);
    const dto = providerDto(confirmation);
    await ctx.service.createRepository(principal, PROJECT_ID, dto, context(bodyOf(dto)));

    // 第一次登记已把 Project.version 从 3 递增到 4；新 key + 新版本再次登记同一身份。
    const secondDto = providerDto(
      seedTicket(ctx.tickets, {
        action: REPOSITORY_REGISTER,
        projectId: PROJECT_ID,
        targetType: 'PROJECT',
        targetId: PROJECT_ID,
        expectedVersion: 4,
        roleSlot: null,
        payload: {
          adapter: 'github',
          externalId: '123456789',
          owner: 'async-artisan',
          name: 'workmesh',
          defaultBranch: 'main',
        },
      }),
      { expectedProjectVersion: 4 },
    );
    const secondKey = context(bodyOf(secondDto), {
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    });
    await expect(
      ctx.service.createRepository(principal, PROJECT_ID, secondDto, secondKey),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'REPOSITORY_EXISTS' });
    expect(
      principalScopeKey(principal).startsWith('user:') &&
        projectScopeKey(PROJECT_ID).startsWith('project:'),
    ).toBe(true);
  });
});
