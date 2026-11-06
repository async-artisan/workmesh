import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError, type ActionBinding } from '@workmesh/shared';
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
import type { DeclareRepositoryDto } from './dto';
import {
  ProjectRepositoryDeclarationService,
  REPOSITORY_DECLARE,
  REPOSITORY_DECLARE_TARGET,
} from './project-repository-declaration.service';
import type { ProjectWriteContext } from './projects.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TICKET_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const SECRET = 'ticket-secret';
const LOCATOR = 'https://github.com/acme/workmesh.git';
const NOW = new Date('2026-11-05T10:00:00.000Z');

const principal: V1Principal = {
  kind: 'HUMAN',
  userId: USER_ID,
  sessionId: SESSION_ID,
  authVersion: 1,
  scopes: [],
};

class FakeTickets implements V1ConfirmationRepository {
  private readonly tickets = new Map<string, V1TicketRecord>();

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async createTicket(): Promise<V1TicketRecord> {
    throw new Error('not used');
  }

  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(ticketId) ?? null;
  }

  async consumeTicket(): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    return { consumed: false, ticket: null };
  }
}

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

class FakePrisma {
  version = 3;
  archivedAt: Date | null = null;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER';
  repositories: Array<Record<string, unknown>> = [];
  locators: Array<Record<string, unknown>> = [];
  stamps: Array<Record<string, unknown>> = [];
  audits: Array<Record<string, unknown>> = [];
  readonly operations = new FakeOperations();
  ticketConsumeCount = 0;
  /** 模拟并发声明：create locator 时先插入一条别人写好的活跃 locator，再抛 P2002。 */
  raceLocator: Record<string, unknown> | null = null;
  private counter = 0;

  readonly prisma: Record<string, unknown>;

  constructor() {
    this.prisma = this.build();
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value === undefined) return true;
      if (value === null) return row[key] === null;
      if (value && typeof value === 'object' && 'not' in (value as object))
        return row[key] !== (value as { not: unknown }).not;
      return row[key] === value;
    });
  }

  private build(): Record<string, unknown> {
    return {
      project: {
        findUnique: async () => ({ version: this.version, archivedAt: this.archivedAt }),
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
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          this.repositories.find((row) => this.matches(row, where)) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: this.nextId('repo'),
            identityMode: 'DECLARED',
            adapter: null,
            externalId: null,
            archivedAt: null,
            createdAt: new Date('2026-11-01T00:00:00.000Z'),
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
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          let count = 0;
          for (const row of this.repositories) {
            if (this.matches(row, where)) {
              Object.assign(row, data);
              count += 1;
            }
          }
          return { count };
        },
      },
      projectRepositoryLocator: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const row = this.locators.find((item) => this.matches(item, where));
          if (!row) return null;
          return {
            ...row,
            repository: this.repositories.find((item) => item.id === row.repositoryId) ?? null,
          };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (this.raceLocator) {
            this.locators.push(this.raceLocator);
            this.raceLocator = null;
            throw { code: 'P2002', meta: { target: ['projectId', 'canonicalLocator'] } };
          }
          const row = { id: this.nextId('locator'), ...data };
          this.locators.push(row);
          return row;
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
      $executeRaw: async () => {
        this.ticketConsumeCount += 1;
        return 1;
      },
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
            role: this.memberRole,
            version: 2,
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
  service: ProjectRepositoryDeclarationService;
};

function harness(): Harness {
  const db = new FakePrisma();
  const tickets = new FakeTickets();
  const service = new ProjectRepositoryDeclarationService(
    db.prisma as unknown as PrismaService,
    db.authorization() as never,
    tickets,
    db.operations as never,
  );
  return { db, tickets, service };
}

function bindingOf(input: DeclareRepositoryDto): ActionBinding {
  return {
    action: REPOSITORY_DECLARE,
    projectId: PROJECT_ID,
    targetType: REPOSITORY_DECLARE_TARGET,
    targetId: PROJECT_ID,
    expectedVersion: input.expectedProjectVersion,
    roleSlot: null,
    payload: {
      locator: input.locator,
      targetRepositoryId: input.targetRepositoryId ?? null,
      displayName: input.displayName ?? null,
    },
  };
}

function seedTicket(
  tickets: FakeTickets,
  input: DeclareRepositoryDto,
): { ticketId: string; ticketSecret: string } {
  tickets.seed({
    id: TICKET_ID,
    secretHash: hashTicketSecret(SECRET),
    userId: USER_ID,
    webSessionId: SESSION_ID,
    projectId: PROJECT_ID,
    userAuthVersion: 1,
    action: REPOSITORY_DECLARE,
    targetType: REPOSITORY_DECLARE_TARGET,
    targetId: PROJECT_ID,
    expectedVersion: input.expectedProjectVersion,
    actionDigest: actionDigestOf(bindingOf(input)),
    roleId: null,
    approvalSlotId: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
  });
  return { ticketId: TICKET_ID, ticketSecret: SECRET };
}

function context(body: Record<string, unknown>, key = KEY): ProjectWriteContext {
  return {
    idempotencyKey: key,
    method: 'POST',
    route: `/api/v1/projects/${PROJECT_ID}/repositories/declarations`,
    body,
    operationId: randomUUID(),
    now: NOW,
    webSessionId: SESSION_ID,
    userAuthVersion: 1,
  };
}

function bodyOf(input: DeclareRepositoryDto): Record<string, unknown> {
  return {
    expectedProjectVersion: input.expectedProjectVersion,
    locator: input.locator,
    targetRepositoryId: input.targetRepositoryId,
    displayName: input.displayName,
    confirmation: input.confirmation,
  };
}

function repoRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'repo-existing',
    projectId: PROJECT_ID,
    identityMode: 'DECLARED',
    adapter: null,
    externalId: null,
    owner: 'acme',
    name: 'workmesh',
    archivedAt: null,
    ...overrides,
  };
}

function locatorRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'locator-existing',
    projectId: PROJECT_ID,
    repositoryId: 'repo-existing',
    canonicalLocator: LOCATOR,
    source: 'HTTPS',
    revokedAt: null,
    ...overrides,
  };
}

describe('仓库声明：DECLARED 身份与 locator 复用', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  it('新 locator 创建 DECLARED 仓库（adapter/externalId 为 NULL），递增项目版本并写 actorStamp 审计', async () => {
    const real = { expectedProjectVersion: 3, locator: LOCATOR };
    const confirmation = seedTicket(ctx.tickets, real as DeclareRepositoryDto);
    const request = { ...real, confirmation };

    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(result.status).toBe(201);
    expect(result.view).toMatchObject({
      identityMode: 'DECLARED',
      canonicalLocator: LOCATOR,
      source: 'HTTPS',
      owner: 'acme',
      name: 'workmesh',
      reused: false,
      replayed: false,
      alias: false,
      projectVersion: 4,
    });
    expect(ctx.db.repositories).toHaveLength(1);
    expect(ctx.db.repositories[0]).toMatchObject({
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
    });
    expect(ctx.db.locators).toHaveLength(1);
    expect(ctx.db.version).toBe(4);
    expect(ctx.db.audits[0]).toMatchObject({
      action: REPOSITORY_DECLARE,
      targetType: 'PROJECT_REPOSITORY',
      targetId: result.view.repositoryId,
      actorStampId: ctx.db.stamps[0]!.id,
    });
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('同项目同 canonical locator 不同 key 返回 200 复用同一仓库（reused:true）', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.locators.push(locatorRow());
    const first = { expectedProjectVersion: 3, locator: LOCATOR };
    const confirmation = seedTicket(ctx.tickets, first as DeclareRepositoryDto);
    const request = { ...first, confirmation };

    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(result.status).toBe(200);
    expect(result.view).toMatchObject({
      repositoryId: 'repo-existing',
      locatorId: 'locator-existing',
      reused: true,
      replayed: false,
      projectVersion: 3,
    });
    expect(ctx.db.repositories).toHaveLength(1);
    expect(ctx.db.locators).toHaveLength(1);
    expect(ctx.db.version).toBe(3);
    expect(ctx.db.audits).toHaveLength(1);
    expect(ctx.db.ticketConsumeCount).toBe(1);
  });

  it('同 key 同摘要重放返回原响应且不重复写审计/操作', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.locators.push(locatorRow());
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
      } as DeclareRepositoryDto),
    };
    await ctx.service.declare(principal, PROJECT_ID, request, context(bodyOf(request)));
    const replay = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(replay.view.replayed).toBe(true);
    expect(replay.view.repositoryId).toBe('repo-existing');
    expect(ctx.db.audits).toHaveLength(1);
    expect(ctx.db.operations.records).toHaveLength(1);
    expect(ctx.db.ticketConsumeCount).toBe(1);
  });

  it('复用 PROVIDER 仓库时保留真实 identityMode 和 provider 展示字段', async () => {
    ctx.db.repositories.push(
      repoRow({
        identityMode: 'PROVIDER',
        adapter: 'GITHUB',
        externalId: 'gh_123',
        name: 'Provider name',
      }),
    );
    ctx.db.locators.push(locatorRow());
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      displayName: 'Caller override',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
        displayName: 'Caller override',
      } as DeclareRepositoryDto),
    };
    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );
    expect(result.view).toMatchObject({
      identityMode: 'PROVIDER',
      name: 'Provider name',
      projectVersion: 3,
    });
    expect(ctx.db.repositories[0]).toMatchObject({
      identityMode: 'PROVIDER',
      adapter: 'GITHUB',
      externalId: 'gh_123',
      name: 'Provider name',
    });
  });

  it('活跃声明复用实际更新展示名时递增项目版本', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.locators.push(locatorRow());
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      displayName: 'Renamed for display',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
        displayName: 'Renamed for display',
      } as DeclareRepositoryDto),
    };
    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );
    expect(result.view).toMatchObject({ name: 'Renamed for display', projectVersion: 4 });
    expect(ctx.db.version).toBe(4);
  });

  it('显式 alias 绑到另一仓库：已有活跃 locator 时 409 LOCATOR_ALREADY_BOUND', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.repositories.push(repoRow({ id: 'repo-target', name: 'other' }));
    ctx.db.locators.push(locatorRow());
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      targetRepositoryId: 'repo-target',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
        targetRepositoryId: 'repo-target',
        displayName: undefined,
      } as DeclareRepositoryDto),
    };
    await expect(
      ctx.service.declare(principal, PROJECT_ID, request, context(bodyOf(request))),
    ).rejects.toMatchObject({
      code: 'LOCATOR_ALREADY_BOUND',
      status: 409,
      details: { canonicalLocator: LOCATOR, boundRepositoryId: 'repo-existing' },
    });
    expect(ctx.db.locators).toHaveLength(1);
  });

  it('显式 alias 到空闲 locator：只新增 locator，不创建仓库', async () => {
    ctx.db.repositories.push(repoRow({ id: 'repo-target', owner: 'acme', name: 'api' }));
    const request = {
      expectedProjectVersion: 3,
      locator: 'ssh://git@github.com/acme/api.git',
      targetRepositoryId: 'repo-target',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: 'ssh://git@github.com/acme/api.git',
        targetRepositoryId: 'repo-target',
      } as DeclareRepositoryDto),
    };

    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(result.status).toBe(200);
    expect(result.view).toMatchObject({
      repositoryId: 'repo-target',
      identityMode: 'DECLARED',
      alias: true,
      reused: false,
      projectVersion: 4,
    });
    expect(ctx.db.repositories).toHaveLength(1);
    expect(ctx.db.locators).toHaveLength(1);
    expect(ctx.db.locators[0]).toMatchObject({ repositoryId: 'repo-target', source: 'SSH' });
  });

  it('alias 目标仓库已归档时 409，且不新增 locator', async () => {
    ctx.db.repositories.push(
      repoRow({ id: 'repo-archived', archivedAt: new Date('2026-11-03T00:00:00.000Z') }),
    );
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      targetRepositoryId: 'repo-archived',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
        targetRepositoryId: 'repo-archived',
      } as DeclareRepositoryDto),
    };
    await expect(
      ctx.service.declare(principal, PROJECT_ID, request, context(bodyOf(request))),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', message: 'REPOSITORY_ARCHIVED' });
    expect(ctx.db.locators).toHaveLength(0);
  });

  it('已撤销历史 locator：复用同一 ProjectRepository ID，追加活跃 locator', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.locators.push(
      locatorRow({ id: 'locator-revoked', revokedAt: new Date('2026-11-02T00:00:00.000Z') }),
    );
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
      } as DeclareRepositoryDto),
    };

    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(result.status).toBe(200);
    expect(result.view).toMatchObject({
      repositoryId: 'repo-existing',
      reused: true,
      projectVersion: 4,
    });
    expect(ctx.db.locators).toHaveLength(2);
    expect(ctx.db.locators[1]).toMatchObject({ repositoryId: 'repo-existing' });
  });

  it('并发同一 locator 的 P2002 恢复为 200 复用', async () => {
    ctx.db.repositories.push(repoRow());
    ctx.db.raceLocator = locatorRow({ id: 'locator-racer' });
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
      } as DeclareRepositoryDto),
    };

    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );

    expect(result.status).toBe(200);
    expect(result.view).toMatchObject({ locatorId: 'locator-racer', reused: true });
  });

  it('非法 locator 422、普通成员 403、归档项目 409、旧版本 409', async () => {
    const invalid = {
      expectedProjectVersion: 3,
      locator: 'http://github.com/acme/repo',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: 'http://github.com/acme/repo',
      } as DeclareRepositoryDto),
    };
    await expect(
      ctx.service.declare(principal, PROJECT_ID, invalid, context(bodyOf(invalid))),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', message: 'LOCATOR_INVALID', status: 422 });

    ctx.db.memberRole = 'MEMBER';
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
      } as DeclareRepositoryDto),
    };
    await expect(
      ctx.service.declare(principal, PROJECT_ID, request, context(bodyOf(request))),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    ctx.db.memberRole = 'OWNER';
    ctx.db.archivedAt = new Date('2026-11-04T00:00:00.000Z');
    await expect(
      ctx.service.declare(principal, PROJECT_ID, request, context(bodyOf(request))),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });

    ctx.db.archivedAt = null;
    const stale = { ...request, expectedProjectVersion: 2 };
    await expect(
      ctx.service.declare(principal, PROJECT_ID, stale, context(bodyOf(stale))),
    ).rejects.toMatchObject({ code: 'PROJECT_VERSION_CONFLICT', status: 409 });
  });

  it('displayName 仅覆盖展示名，不改变 canonicalLocator', async () => {
    const request = {
      expectedProjectVersion: 3,
      locator: LOCATOR,
      displayName: 'WorkMesh Web',
      confirmation: seedTicket(ctx.tickets, {
        expectedProjectVersion: 3,
        locator: LOCATOR,
        displayName: 'WorkMesh Web',
      } as DeclareRepositoryDto),
    };
    const result = await ctx.service.declare(
      principal,
      PROJECT_ID,
      request,
      context(bodyOf(request)),
    );
    expect(result.view.name).toBe('WorkMesh Web');
    expect(result.view.canonicalLocator).toBe(LOCATOR);
    expect(ctx.db.repositories[0]).toMatchObject({
      name: 'WorkMesh Web',
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
    });
  });
});
