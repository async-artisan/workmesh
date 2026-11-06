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
import type { ProjectWriteContext } from './projects.service';
import {
  WORKSPACE_DEFINITION_PUBLISH,
  WORKSPACE_DEFINITION_TARGET,
  WorkspaceDefinitionService,
} from './workspace-definition.service';
import {
  normalizeWorkspaceDefinition,
  workspaceDefinitionDigest,
  type WorkspaceDefinitionPayload,
} from './workspace-definition-validator';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const TICKET_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const REPO_A = '66666666-6666-4666-8666-666666666666';
const REPO_B = '77777777-7777-4777-8777-777777777777';
const DOC_A = '88888888-8888-4888-8888-888888888888';
const SECRET = 'ticket-secret';
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

function payload(): WorkspaceDefinitionPayload {
  const normalized = normalizeWorkspaceDefinition(
    {
      schemaVersion: '1.0',
      projectId: PROJECT_ID,
      layout: { kind: 'MULTI_ROOT' },
      repositories: [
        {
          key: 'web',
          projectRepositoryId: REPO_A,
          suggestedPath: 'apps/web',
          defaultRef: 'main',
        },
        {
          key: 'api',
          projectRepositoryId: REPO_B,
          suggestedPath: 'services/api',
        },
      ],
      contextPolicy: { requiredDocumentIds: [] },
    },
    PROJECT_ID,
  );
  if (!normalized.ok) throw new Error('fixture payload must normalize');
  return normalized.payload;
}

function payloadWithRequiredDoc(): WorkspaceDefinitionPayload {
  const base = payload();
  return {
    ...base,
    contextPolicy: { ...base.contextPolicy, requiredDocumentIds: [DOC_A] },
  };
}

class FakePrisma {
  projectVersion = 5;
  archivedAt: Date | null = null;
  archiveOnProjectLock = false;
  archiveRepositoryOnProjectLock = false;
  archiveDocumentOnProjectLock = false;
  revokeKnowledgeReadOnProjectLock = false;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER';
  definition: Record<string, unknown> | null = null;
  revisions: Array<Record<string, unknown>> = [];
  revisionRepositories: Array<Record<string, unknown>> = [];
  repositories = [
    {
      id: REPO_A,
      projectId: PROJECT_ID,
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      owner: 'acme',
      name: 'web',
      archivedAt: null as Date | null,
      lastVerifiedStatus: null,
      lastVerifiedAt: null,
      locators: [] as unknown[],
    },
    {
      id: REPO_B,
      projectId: PROJECT_ID,
      identityMode: 'DECLARED',
      adapter: null,
      externalId: null,
      owner: 'acme',
      name: 'api',
      archivedAt: null as Date | null,
      lastVerifiedStatus: null,
      lastVerifiedAt: null,
      locators: [] as unknown[],
    },
  ];
  documents: Array<Record<string, unknown>> = [
    { id: DOC_A, projectId: PROJECT_ID, knowledgeBaseId: 'kb-1', archivedAt: null },
  ];
  readableKnowledgeBases = new Set<string>(['kb-1']);
  stamps: Array<Record<string, unknown>> = [];
  audits: Array<Record<string, unknown>> = [];
  readonly operations = new FakeOperations();
  private counter = 0;

  readonly prisma: Record<string, unknown>;

  constructor() {
    this.prisma = this.build();
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  seedDraft(draftPayload: WorkspaceDefinitionPayload, options: { version?: number } = {}): void {
    this.definition = {
      id: 'def-1',
      projectId: PROJECT_ID,
      version: options.version ?? 1,
      draftPayload,
      draftDigest: workspaceDefinitionDigest(draftPayload),
      currentRevisionId: null,
      currentRevisionNo: null,
      updatedAt: NOW,
    };
  }

  private resolveDefinition(): Record<string, unknown> | null {
    if (!this.definition) return null;
    const current =
      this.revisions.find((revision) => revision.id === this.definition!.currentRevisionId) ?? null;
    return {
      ...this.definition,
      currentRevision: current
        ? { ...current, definition: { version: this.definition.version } }
        : null,
    };
  }

  private build(): Record<string, unknown> {
    return {
      project: {
        findUnique: async () => ({ version: this.projectVersion, archivedAt: this.archivedAt }),
        updateMany: async ({
          where,
          data,
        }: {
          where: { id: string; version: number; archivedAt?: null };
          data: { version: { increment: number } };
        }) => {
          if (where.version !== this.projectVersion) return { count: 0 };
          if (where.archivedAt === null && this.archivedAt !== null) return { count: 0 };
          this.projectVersion += data.version.increment;
          return { count: 1 };
        },
      },
      projectWorkspaceDefinition: {
        findUnique: async () => this.resolveDefinition(),
        create: async ({ data }: { data: Record<string, unknown> }) => {
          this.definition = {
            id: 'def-1',
            projectId: PROJECT_ID,
            version: 1,
            currentRevisionId: null,
            currentRevisionNo: null,
            updatedAt: NOW,
            ...data,
          };
          return { id: 'def-1', version: 1, updatedAt: NOW };
        },
        update: async ({ data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const target = this.definition!;
          const nextVersion = data.version;
          if (typeof nextVersion === 'number') target.version = nextVersion;
          else if (nextVersion && typeof nextVersion === 'object') {
            const increment = (nextVersion as { increment?: number }).increment;
            if (increment) target.version = Number(target.version) + increment;
          }
          for (const [key, value] of Object.entries(data)) {
            if (key === 'version') continue;
            // Prisma.DbNull / JsonNull 是无自有键的哨兵对象：fake 里映射成 SQL NULL。
            target[key] =
              value !== null &&
              typeof value === 'object' &&
              Object.keys(value as object).length === 0
                ? null
                : value;
          }
          target.updatedAt = NOW;
          return { version: target.version, updatedAt: NOW };
        },
      },
      projectWorkspaceDefinitionRevision: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const revision = this.revisions.find(
            (row) =>
              (where.id === undefined || row.id === where.id) &&
              (where.projectId === undefined || row.projectId === where.projectId),
          );
          if (!revision) return null;
          return { ...revision, definition: { version: this.definition?.version ?? 1 } };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: randomUUID(), publishedAt: data.publishedAt, ...data };
          this.revisions.push(row);
          return { id: row.id };
        },
      },
      projectWorkspaceDefinitionRevisionRepository: {
        createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => {
          this.revisionRepositories.push(...data);
          return { count: data.length };
        },
        findMany: async ({ where }: { where: { revisionId: string } }) =>
          this.revisionRepositories
            .filter((row) => row.revisionId === where.revisionId)
            .sort((left, right) => String(left.logicalKey).localeCompare(String(right.logicalKey)))
            .map((row) => ({
              ...row,
              repository:
                this.repositories.find((repository) => repository.id === row.repositoryId) ?? null,
            })),
      },
      projectRepository: {
        findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
          this.repositories.filter((row) => !where.id || where.id.in.includes(String(row.id))),
      },
      knowledgeDocument: {
        findMany: async ({ where }: { where: { id?: { in: string[] } } }) =>
          this.documents.filter((row) => !where.id || where.id.in.includes(String(row.id))),
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
      $queryRaw: async () => {
        if (this.archiveOnProjectLock) {
          this.archivedAt = new Date('2026-11-05T10:00:01.000Z');
          this.archiveOnProjectLock = false;
        }
        if (this.archiveRepositoryOnProjectLock) {
          this.repositories[0]!.archivedAt = new Date('2026-11-05T10:00:01.000Z');
          this.archiveRepositoryOnProjectLock = false;
        }
        if (this.archiveDocumentOnProjectLock) {
          this.documents[0]!.archivedAt = new Date('2026-11-05T10:00:01.000Z');
          this.archiveDocumentOnProjectLock = false;
        }
        if (this.revokeKnowledgeReadOnProjectLock) {
          this.readableKnowledgeBases.delete('kb-1');
          this.revokeKnowledgeReadOnProjectLock = false;
        }
        return [{ id: PROJECT_ID }];
      },
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
    resolveKnowledgeAccess: (
      _principal: V1Principal,
      knowledgeBaseId: string,
    ) => Promise<{ canRead: boolean }>;
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
          project: { id: projectId, version: this.projectVersion, archivedAt: this.archivedAt },
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
      resolveKnowledgeAccess: async (_principal, knowledgeBaseId) => {
        if (!this.readableKnowledgeBases.has(knowledgeBaseId))
          throw new WorkmeshError(
            V1_ERROR_CODES.KNOWLEDGE_ACCESS_DENIED,
            'KNOWLEDGE_ACCESS_DENIED',
            { knowledgeBaseId },
            403,
          );
        return { canRead: true };
      },
    };
  }
}

type Harness = {
  db: FakePrisma;
  tickets: FakeTickets;
  service: WorkspaceDefinitionService;
};

function harness(): Harness {
  const db = new FakePrisma();
  const tickets = new FakeTickets();
  const service = new WorkspaceDefinitionService(
    db.prisma as unknown as PrismaService,
    db.authorization() as never,
    tickets,
    db.operations as never,
  );
  return { db, tickets, service };
}

function context(
  body: Record<string, unknown>,
  overrides: Partial<ProjectWriteContext> = {},
): ProjectWriteContext {
  return {
    idempotencyKey: KEY,
    method: 'PUT',
    route: `/api/v1/projects/${PROJECT_ID}/workspace-definition/draft`,
    body,
    operationId: randomUUID(),
    now: NOW,
    webSessionId: SESSION_ID,
    userAuthVersion: 1,
    ...overrides,
  };
}

function seedPublishTicket(
  tickets: FakeTickets,
  input: {
    expectedProjectVersion: number;
    expectedDefinitionVersion: number;
    payloadDigest: string;
  },
): { ticketId: string; ticketSecret: string } {
  const binding: ActionBinding = {
    action: WORKSPACE_DEFINITION_PUBLISH,
    projectId: PROJECT_ID,
    targetType: WORKSPACE_DEFINITION_TARGET,
    targetId: PROJECT_ID,
    expectedVersion: input.expectedProjectVersion,
    roleSlot: null,
    payload: {
      expectedDefinitionVersion: input.expectedDefinitionVersion,
      payloadDigest: input.payloadDigest,
    },
  };
  tickets.seed({
    id: TICKET_ID,
    secretHash: hashTicketSecret(SECRET),
    userId: USER_ID,
    webSessionId: SESSION_ID,
    projectId: PROJECT_ID,
    userAuthVersion: 1,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
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

type PublishRequest = {
  expectedProjectVersion: number;
  expectedDefinitionVersion: number;
  payloadDigest: string;
  confirmation: { ticketId: string; ticketSecret: string };
};

function publishContext(request: PublishRequest): ProjectWriteContext {
  return context(
    {
      expectedProjectVersion: request.expectedProjectVersion,
      expectedDefinitionVersion: request.expectedDefinitionVersion,
      payloadDigest: request.payloadDigest,
      confirmation: request.confirmation,
    },
    {
      method: 'POST',
      route: `/api/v1/projects/${PROJECT_ID}/workspace-definition/publish`,
    },
  );
}

describe('工作区定义：草稿与读取', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  it('未配置返回 200 NOT_CONFIGURED，不制造空 revision', async () => {
    const view = await ctx.service.getDefinition(principal, PROJECT_ID);
    expect(view).toMatchObject({
      definitionStatus: 'NOT_CONFIGURED',
      projectId: PROJECT_ID,
      revisionId: null,
      revisionNo: null,
      digest: null,
      payload: null,
      repositories: [],
      draft: null,
      definitionVersion: 0,
      validation: { valid: true, issues: [] },
    });
  });

  it('首次保存草稿：expectedDefinitionVersion=0，definitionVersion 从 1 开始，不写审计', async () => {
    const body = payload();
    const digest = workspaceDefinitionDigest(body);
    const view = await ctx.service.saveDraft(
      principal,
      PROJECT_ID,
      { expectedDefinitionVersion: 0, payloadDigest: digest, definition: body },
      context({ expectedDefinitionVersion: 0, payloadDigest: digest, definition: body }),
    );
    expect(view).toMatchObject({ definitionVersion: 1, payloadDigest: digest, replayed: false });
    expect(ctx.db.definition).toMatchObject({ version: 1, draftDigest: digest });
    expect(ctx.db.audits).toHaveLength(0);
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('项目在草稿预检后归档时拒绝保存且不留下草稿或幂等记录', async () => {
    const body = payload();
    const digest = workspaceDefinitionDigest(body);
    ctx.db.archiveOnProjectLock = true;
    await expect(
      ctx.service.saveDraft(
        principal,
        PROJECT_ID,
        { expectedDefinitionVersion: 0, payloadDigest: digest, definition: body },
        context({ expectedDefinitionVersion: 0, payloadDigest: digest, definition: body }),
      ),
    ).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PROJECT_ARCHIVED',
      status: 409,
    });
    expect(ctx.db.definition).toBeNull();
    expect(ctx.db.operations.records).toHaveLength(0);
  });

  it('同 key 同摘要回放：即使 definitionVersion 已被发布推进，也返回原响应', async () => {
    const body = payload();
    const digest = workspaceDefinitionDigest(body);
    const request = { expectedDefinitionVersion: 0, payloadDigest: digest, definition: body };
    const bodyContext = { expectedDefinitionVersion: 0, payloadDigest: digest, definition: body };
    const first = await ctx.service.saveDraft(principal, PROJECT_ID, request, context(bodyContext));
    ctx.db.definition!.version = 5;

    const replay = await ctx.service.saveDraft(
      principal,
      PROJECT_ID,
      request,
      context(bodyContext),
    );
    expect(replay).toMatchObject({
      definitionVersion: first.definitionVersion,
      payloadDigest: digest,
      replayed: true,
    });
    expect(ctx.db.operations.records).toHaveLength(1);
    expect(ctx.db.audits).toHaveLength(0);
  });

  it('新 key + 旧 expectedDefinitionVersion 返回 409 DEFINITION_VERSION_CONFLICT', async () => {
    ctx.db.seedDraft(payload(), { version: 3 });
    const digest = workspaceDefinitionDigest(payload());
    await expect(
      ctx.service.saveDraft(
        principal,
        PROJECT_ID,
        { expectedDefinitionVersion: 2, payloadDigest: digest, definition: payload() },
        context(
          { expectedDefinitionVersion: 2, payloadDigest: digest, definition: payload() },
          { idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'DEFINITION_VERSION_CONFLICT', status: 409 });
  });

  it('payloadDigest 与服务端重算不一致返回 409；结构非法返回 422', async () => {
    const body = payload();
    await expect(
      ctx.service.saveDraft(
        principal,
        PROJECT_ID,
        { expectedDefinitionVersion: 0, payloadDigest: 'f'.repeat(64), definition: body },
        context({ expectedDefinitionVersion: 0, payloadDigest: 'f'.repeat(64), definition: body }),
      ),
    ).rejects.toMatchObject({ code: 'DEFINITION_DIGEST_CONFLICT', status: 409 });

    const invalid = { schemaVersion: '1.0', layout: { kind: 'BOGUS' }, repositories: [] };
    await expect(
      ctx.service.saveDraft(
        principal,
        PROJECT_ID,
        { expectedDefinitionVersion: 0, payloadDigest: 'f'.repeat(64), definition: invalid },
        context(
          { expectedDefinitionVersion: 0, payloadDigest: 'f'.repeat(64), definition: invalid },
          { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it('validate：无草稿返回 DRAFT_NOT_FOUND；内容错误 200 + valid:false；合法返回 digest', async () => {
    const noDraft = await ctx.service.validate(principal, PROJECT_ID, {});
    expect(noDraft).toMatchObject({ valid: false, digest: null });
    expect(noDraft.issues[0]).toMatchObject({ code: 'DRAFT_NOT_FOUND' });

    const invalidLayout = { ...payload(), layout: { kind: 'NONE' as const } };
    const invalid = await ctx.service.validate(principal, PROJECT_ID, {
      definition: invalidLayout,
    });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((item) => item.code)).toContain('LAYOUT_REPOSITORIES_MISMATCH');

    const valid = await ctx.service.validate(principal, PROJECT_ID, { definition: payload() });
    expect(valid.valid).toBe(true);
    expect(valid.digest).toBe(workspaceDefinitionDigest(payload()));
    expect(valid.definition).toEqual(payload());
  });
});

describe('工作区定义：发布与 revision 读取', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  function seedDraft(version = 1) {
    ctx.db.seedDraft(payload(), { version });
  }

  function requestFor(version = 1): PublishRequest {
    const payloadDigest = workspaceDefinitionDigest(payload());
    return {
      expectedProjectVersion: 5,
      expectedDefinitionVersion: version,
      payloadDigest,
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: version,
        payloadDigest,
      }),
    };
  }

  it('发布成功：创建不可变 revision、递增双版本、清空草稿、写审计与幂等记录', async () => {
    seedDraft();
    const request = requestFor();
    const view = await ctx.service.publish(principal, PROJECT_ID, request, publishContext(request));

    expect(view).toMatchObject({
      revisionNo: 1,
      digest: workspaceDefinitionDigest(payload()),
      definitionVersion: 2,
      projectVersion: 6,
      replayed: false,
    });
    expect(ctx.db.revisions).toHaveLength(1);
    expect(ctx.db.revisions[0]).toMatchObject({
      revisionNo: 1,
      digest: workspaceDefinitionDigest(payload()),
      payload: payload(),
      projectId: PROJECT_ID,
    });
    expect(ctx.db.revisionRepositories).toHaveLength(2);
    expect(ctx.db.definition).toMatchObject({
      version: 2,
      draftPayload: null,
      currentRevisionId: ctx.db.revisions[0]!.id,
      currentRevisionNo: 1,
    });
    expect(ctx.db.projectVersion).toBe(6);
    expect(ctx.db.audits[0]).toMatchObject({
      action: WORKSPACE_DEFINITION_PUBLISH,
      targetType: 'PROJECT_WORKSPACE_DEFINITION',
      actorStampId: ctx.db.stamps[0]!.id,
    });
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('发布前置：无草稿 409 DEFINITION_NOT_SAVED；旧版本/摘要 409', async () => {
    await expect(
      ctx.service.publish(principal, PROJECT_ID, requestFor(), context({})),
    ).rejects.toMatchObject({ code: 'DEFINITION_NOT_SAVED', status: 409 });

    seedDraft(3);
    await expect(
      ctx.service.publish(principal, PROJECT_ID, requestFor(2), context({})),
    ).rejects.toMatchObject({ code: 'DEFINITION_VERSION_CONFLICT', status: 409 });

    const wrongDigest = {
      ...requestFor(3),
      payloadDigest: 'f'.repeat(64),
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: 3,
        payloadDigest: 'f'.repeat(64),
      }),
    };
    await expect(
      ctx.service.publish(principal, PROJECT_ID, wrongDigest, context({})),
    ).rejects.toMatchObject({ code: 'DEFINITION_DIGEST_CONFLICT', status: 409 });
  });

  it('发布时仓库已归档或文档不存在返回 422 并带 issues', async () => {
    const body = payloadWithRequiredDoc();
    ctx.db.seedDraft(body);
    const digest = workspaceDefinitionDigest(body);
    ctx.db.repositories[0]!.archivedAt = new Date('2026-11-04T00:00:00.000Z');
    ctx.db.documents = [];
    const request: PublishRequest = {
      expectedProjectVersion: 5,
      expectedDefinitionVersion: 1,
      payloadDigest: digest,
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: 1,
        payloadDigest: digest,
      }),
    };
    await expect(
      ctx.service.publish(principal, PROJECT_ID, request, context({})),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
  });

  it('事务内重验仓库归档状态，预检后归档不能进入发布 revision', async () => {
    seedDraft();
    const request = requestFor();
    ctx.db.archiveRepositoryOnProjectLock = true;
    await expect(
      ctx.service.publish(principal, PROJECT_ID, request, publishContext(request)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(ctx.db.revisions).toHaveLength(0);
    expect(ctx.db.audits).toHaveLength(0);
    expect(ctx.db.operations.records).toHaveLength(0);
  });

  it('事务内复核文档归档和知识读取权限，预检后失效不能发布', async () => {
    const body = payloadWithRequiredDoc();
    ctx.db.seedDraft(body);
    const digest = workspaceDefinitionDigest(body);
    const makeRequest = () => ({
      expectedProjectVersion: 5,
      expectedDefinitionVersion: 1,
      payloadDigest: digest,
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: 1,
        payloadDigest: digest,
      }),
    });
    const archivedDocRequest = makeRequest();
    ctx.db.archiveDocumentOnProjectLock = true;
    await expect(
      ctx.service.publish(
        principal,
        PROJECT_ID,
        archivedDocRequest,
        publishContext(archivedDocRequest),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(ctx.db.revisions).toHaveLength(0);

    // A fresh fixture represents the independent revoke race.
    ctx = harness();
    ctx.db.seedDraft(body);
    const revokedRequest = makeRequest();
    ctx.db.revokeKnowledgeReadOnProjectLock = true;
    await expect(
      ctx.service.publish(principal, PROJECT_ID, revokedRequest, publishContext(revokedRequest)),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 422 });
    expect(ctx.db.revisions).toHaveLength(0);
    expect(ctx.db.audits).toHaveLength(0);
  });

  it('发布后同 key 同摘要重放返回原响应，不重复写 revision/审计', async () => {
    seedDraft();
    const request = requestFor();
    const first = await ctx.service.publish(
      principal,
      PROJECT_ID,
      request,
      publishContext(request),
    );
    const replay = await ctx.service.publish(
      principal,
      PROJECT_ID,
      request,
      publishContext(request),
    );

    expect(replay).toMatchObject({
      revisionId: first.revisionId,
      revisionNo: first.revisionNo,
      definitionVersion: first.definitionVersion,
      projectVersion: first.projectVersion,
      replayed: true,
    });
    expect(ctx.db.revisions).toHaveLength(1);
    expect(ctx.db.audits).toHaveLength(1);
    expect(ctx.db.operations.records).toHaveLength(1);
  });

  it('同 key 不同请求体返回 409 IDEMPOTENCY_DIGEST_CONFLICT', async () => {
    seedDraft();
    const request = requestFor();
    await ctx.service.publish(principal, PROJECT_ID, request, publishContext(request));

    const changed: PublishRequest = {
      ...request,
      expectedDefinitionVersion: 2,
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: 2,
        payloadDigest: request.payloadDigest,
      }),
    };
    await expect(
      ctx.service.publish(principal, PROJECT_ID, changed, publishContext(changed)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_DIGEST_CONFLICT', status: 409 });
  });

  it('读取 revision：返回 payload/digest/仓库与读取时复核原因；未知 revision 404', async () => {
    const body = payloadWithRequiredDoc();
    ctx.db.seedDraft(body);
    const digest = workspaceDefinitionDigest(body);
    const request: PublishRequest = {
      expectedProjectVersion: 5,
      expectedDefinitionVersion: 1,
      payloadDigest: digest,
      confirmation: seedPublishTicket(ctx.tickets, {
        expectedProjectVersion: 5,
        expectedDefinitionVersion: 1,
        payloadDigest: digest,
      }),
    };
    const published = await ctx.service.publish(principal, PROJECT_ID, request, context({}));
    ctx.db.readableKnowledgeBases.delete('kb-1');

    const view = await ctx.service.getRevision(principal, PROJECT_ID, published.revisionId);
    expect(view).toMatchObject({
      revisionId: published.revisionId,
      revisionNo: 1,
      digest,
      definitionVersion: 2,
      projectVersion: 6,
    });
    expect(view.repositories.map((repository) => repository.key)).toEqual(['api', 'web']);
    expect(view.repositories[0]).toMatchObject({
      projectRepositoryId: expect.any(String),
      identityMode: 'DECLARED',
      provider: null,
    });
    expect(view.validation.valid).toBe(false);
    expect(view.validation.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'DOCUMENT_FORBIDDEN' })]),
    );

    await expect(
      ctx.service.getRevision(principal, PROJECT_ID, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).rejects.toMatchObject({ code: 'REVISION_NOT_FOUND', status: 404 });
  });
});
