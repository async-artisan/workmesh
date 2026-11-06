import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { V1ProjectContext } from '../auth/v1-authorization';
import type { V1Principal } from '../auth/v1-policy';
import type { V1OperationRecord } from '../common/v1-idempotency';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProjectWriteContext } from './projects.service';
import {
  ENROLLMENT_CODE_SHAPE,
  hashEnrollmentCode,
  newEnrollmentCode,
  WORKSPACE_ENROLLMENT_CONSUME,
  WORKSPACE_ENROLLMENT_ISSUE,
  WorkspaceEnrollmentService,
} from './workspace-enrollment.service';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REVISION_ID = '44444444-4444-4444-8444-444444444444';
const KEY = '55555555-5555-4555-8555-555555555555';
const DIGEST = 'a'.repeat(64);
const NOW = new Date('2026-11-05T10:00:00.000Z');

const principal: V1Principal = {
  kind: 'HUMAN',
  userId: USER_ID,
  sessionId: SESSION_ID,
  authVersion: 1,
  scopes: [],
};

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

type EnrollmentRow = {
  id: string;
  projectId: string;
  createdByUserId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  codeHash: string;
  version: number;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
};

class FakePrisma {
  projectArchivedAt: Date | null = null;
  archiveOnConsumeLock = false;
  memberActive = true;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER' = 'MEMBER';
  currentRevision: { id: string; digest: string } | null = { id: REVISION_ID, digest: DIGEST };
  enrollments: EnrollmentRow[] = [];
  stamps: Array<Record<string, unknown>> = [];
  audits: Array<Record<string, unknown>> = [];
  readonly operations = new FakeOperations();
  consumeRace = false;
  private counter = 0;

  readonly prisma: Record<string, unknown>;

  constructor() {
    this.prisma = this.build();
  }

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  private build(): Record<string, unknown> {
    return {
      project: {
        findUnique: async () => ({ name: '工作区项目', archivedAt: this.projectArchivedAt }),
      },
      projectWorkspaceDefinition: {
        findUnique: async () => ({ currentRevision: this.currentRevision }),
      },
      projectWorkspaceEnrollment: {
        findUnique: async ({ where }: { where: { codeHash?: string; id?: string } }) => {
          const row = this.enrollments.find(
            (item) =>
              (where.codeHash !== undefined && item.codeHash === where.codeHash) ||
              (where.id !== undefined && item.id === where.id),
          );
          if (!row) return null;
          return {
            ...row,
            project: { name: '工作区项目', archivedAt: this.projectArchivedAt },
          };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            ...(data as Record<string, unknown>),
            id: randomUUID(),
            version: 1,
            consumedAt: null,
            revokedAt: null,
            createdAt: NOW,
          } as unknown as EnrollmentRow;
          this.enrollments.push(row);
          return { id: row.id };
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: {
            id?: string;
            projectId?: string;
            createdByUserId?: string;
            consumedAt?: null;
            revokedAt?: null;
            expiresAt?: { gt: Date };
          };
          data: { consumedAt?: Date; revokedAt?: Date; version: { increment: number } };
        }) => {
          if (this.consumeRace) {
            this.consumeRace = false;
            const winner = this.enrollments.find((item) => item.id === where.id);
            if (winner) winner.consumedAt = NOW;
            return { count: 0 };
          }
          let count = 0;
          for (const row of this.enrollments) {
            if (where.id !== undefined && row.id !== where.id) continue;
            if (where.projectId !== undefined && row.projectId !== where.projectId) continue;
            if (
              where.createdByUserId !== undefined &&
              row.createdByUserId !== where.createdByUserId
            )
              continue;
            if (where.consumedAt === null && row.consumedAt !== null) continue;
            if (where.revokedAt === null && row.revokedAt !== null) continue;
            if (where.expiresAt && !(row.expiresAt > where.expiresAt.gt)) continue;
            if (data.consumedAt !== undefined) row.consumedAt = data.consumedAt;
            if (data.revokedAt !== undefined) row.revokedAt = data.revokedAt;
            row.version += data.version.increment;
            count += 1;
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
      $queryRaw: async () => {
        if (this.archiveOnConsumeLock) {
          this.projectArchivedAt = new Date('2026-11-05T10:00:01.000Z');
          this.archiveOnConsumeLock = false;
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
  } {
    return {
      resolveProjectContext: async (_principal, projectId) => {
        if (!this.memberActive)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'MEMBER_NOT_ACTIVE',
            { projectId },
            404,
          );
        if (this.projectArchivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'PROJECT_ARCHIVED',
            { projectId, archivedAt: this.projectArchivedAt.toISOString() },
            409,
          );
        return {
          project: {
            id: projectId,
            version: 1,
            archivedAt: this.projectArchivedAt,
          },
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

function context(overrides: Partial<ProjectWriteContext> = {}): ProjectWriteContext {
  return {
    idempotencyKey: KEY,
    method: 'POST',
    route: `/api/v1/projects/${PROJECT_ID}/workspace-enrollments`,
    body: {},
    operationId: randomUUID(),
    now: NOW,
    webSessionId: SESSION_ID,
    userAuthVersion: 1,
    ...overrides,
  };
}

type Harness = {
  db: FakePrisma;
  service: WorkspaceEnrollmentService;
};

function harness(): Harness {
  const db = new FakePrisma();
  const service = new WorkspaceEnrollmentService(
    db.prisma as unknown as PrismaService,
    db.authorization() as never,
    db.operations as never,
  );
  return { db, service };
}

function seedEnrollment(
  db: FakePrisma,
  overrides: Partial<EnrollmentRow> = {},
  code = newEnrollmentCode(),
): { code: string; row: EnrollmentRow } {
  const row: EnrollmentRow = {
    id: randomUUID(),
    projectId: PROJECT_ID,
    createdByUserId: USER_ID,
    definitionRevisionId: REVISION_ID,
    definitionDigest: DIGEST,
    codeHash: hashEnrollmentCode(code),
    version: 1,
    expiresAt: new Date(NOW.getTime() + 15 * 60 * 1000),
    consumedAt: null,
    revokedAt: null,
    createdAt: NOW,
    ...overrides,
  };
  db.enrollments.push(row);
  return { code, row };
}

describe('接入码签发', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  it('活动 HUMAN 项目成员可签发：码绑定当前 revision/digest，只存 codeHash 并写审计', async () => {
    const code = newEnrollmentCode();
    expect(code).toMatch(ENROLLMENT_CODE_SHAPE);
    const view = await ctx.service.issue(principal, PROJECT_ID, {}, context());

    expect(view).toMatchObject({
      projectId: PROJECT_ID,
      definitionRevisionId: REVISION_ID,
      definitionDigest: DIGEST,
    });
    expect(view.code).toMatch(ENROLLMENT_CODE_SHAPE);
    expect(view.expiresAt).toBe(new Date(NOW.getTime() + 900 * 1000).toISOString());
    expect(ctx.db.enrollments).toHaveLength(1);
    const stored = ctx.db.enrollments[0]!;
    expect(stored.codeHash).toBe(hashEnrollmentCode(view.code));
    expect(JSON.stringify(stored)).not.toContain(view.code);
    expect(ctx.db.audits[0]).toMatchObject({
      action: WORKSPACE_ENROLLMENT_ISSUE,
      targetType: 'WORKSPACE_ENROLLMENT',
      actorStampId: ctx.db.stamps[0]!.id,
    });
    expect(ctx.db.operations.records).toHaveLength(1);
    // resultRefs 只保存 enrollmentId，绝不保存明文码。
    expect(JSON.stringify(ctx.db.operations.records[0]!.resultRefs)).not.toContain(view.code);
  });

  it('MEMBER 也能签发；非成员 404；归档项目 409', async () => {
    ctx.db.memberRole = 'MEMBER';
    await expect(ctx.service.issue(principal, PROJECT_ID, {}, context())).resolves.toBeTruthy();

    ctx.db.memberActive = false;
    await expect(
      ctx.service.issue(principal, PROJECT_ID, {}, context({ idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', status: 404 });

    ctx.db.memberActive = true;
    ctx.db.projectArchivedAt = new Date('2026-11-04T00:00:00.000Z');
    await expect(
      ctx.service.issue(principal, PROJECT_ID, {}, context({ idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
  });

  it('无 current published definition 时 409 PROJECT_UNCONFIGURED', async () => {
    ctx.db.currentRevision = null;
    await expect(ctx.service.issue(principal, PROJECT_ID, {}, context())).rejects.toMatchObject({
      code: 'PROJECT_UNCONFIGURED',
      status: 409,
    });
    expect(ctx.db.enrollments).toHaveLength(0);
  });

  it('同 key 重试不能回放明文：409 ENROLLMENT_CODE_NOT_REPLAYABLE + enrollmentId', async () => {
    const first = await ctx.service.issue(principal, PROJECT_ID, {}, context());
    await expect(ctx.service.issue(principal, PROJECT_ID, {}, context())).rejects.toMatchObject({
      code: 'ENROLLMENT_CODE_NOT_REPLAYABLE',
      status: 409,
      details: { enrollmentId: first.enrollmentId },
    });
    expect(ctx.db.enrollments).toHaveLength(1);
    expect(ctx.db.enrollments[0]!.revokedAt).toEqual(NOW);
  });

  it('重签会撤销同一用户此前未消费的码（旧码不可再用）', async () => {
    const { row: old } = seedEnrollment(ctx.db);
    const view = await ctx.service.issue(principal, PROJECT_ID, {}, context());
    expect(old.revokedAt).toEqual(NOW);
    expect(ctx.db.enrollments).toHaveLength(2);
    expect(ctx.db.enrollments.find((item) => item.id === view.enrollmentId)?.revokedAt).toBeNull();
  });

  it('超过限流返回 429 RATE_LIMITED', async () => {
    for (let index = 0; index < 5; index += 1)
      await ctx.service.issue(principal, PROJECT_ID, {}, context({ idempotencyKey: randomUUID() }));
    await expect(
      ctx.service.issue(principal, PROJECT_ID, {}, context({ idempotencyKey: randomUUID() })),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });
});

describe('接入码消费', () => {
  let ctx: Harness;

  beforeEach(() => {
    ctx = harness();
  });

  it('消费成功：CAS 写入 consumedAt，返回项目与精确 revision，不授予任何权限', async () => {
    const { code, row } = seedEnrollment(ctx.db);
    const view = await ctx.service.consume(code, 'ip-1', NOW);

    expect(view).toEqual({
      projectId: PROJECT_ID,
      projectName: '工作区项目',
      definitionRevisionId: REVISION_ID,
      definitionDigest: DIGEST,
    });
    expect(row.consumedAt).toEqual(NOW);
    expect(ctx.db.audits[0]).toMatchObject({
      action: WORKSPACE_ENROLLMENT_CONSUME,
      projectId: PROJECT_ID,
      targetType: 'WORKSPACE_ENROLLMENT',
    });
    expect(view).not.toHaveProperty('roleIds');
    expect(view).not.toHaveProperty('repositories');
    expect(view).not.toHaveProperty('scopes');
  });

  it('未知码 404；过期 409；已消费 409；已撤销 409', async () => {
    await expect(ctx.service.consume(newEnrollmentCode(), 'ip-1', NOW)).rejects.toMatchObject({
      code: 'ENROLLMENT_NOT_FOUND',
      status: 404,
    });

    const expired = seedEnrollment(ctx.db, {
      expiresAt: new Date(NOW.getTime() - 1000),
    });
    await expect(ctx.service.consume(expired.code, 'ip-2', NOW)).rejects.toMatchObject({
      code: 'ENROLLMENT_EXPIRED',
      status: 409,
    });

    const consumed = seedEnrollment(ctx.db, { consumedAt: new Date(NOW.getTime() - 1000) });
    await expect(ctx.service.consume(consumed.code, 'ip-3', NOW)).rejects.toMatchObject({
      code: 'ENROLLMENT_CONSUMED',
      status: 409,
    });

    const revoked = seedEnrollment(ctx.db, { revokedAt: new Date(NOW.getTime() - 1000) });
    await expect(ctx.service.consume(revoked.code, 'ip-4', NOW)).rejects.toMatchObject({
      code: 'ENROLLMENT_REVOKED',
      status: 409,
    });
  });

  it('并发消费只有一个成功：CAS 失败的一方得到 409 ENROLLMENT_CONSUMED', async () => {
    const { code } = seedEnrollment(ctx.db);
    ctx.db.consumeRace = true;
    await expect(ctx.service.consume(code, 'ip-1', NOW)).rejects.toMatchObject({
      code: 'ENROLLMENT_CONSUMED',
      status: 409,
    });
  });

  it('归档项目拒绝消费；消费接口严格限流', async () => {
    ctx.db.projectArchivedAt = new Date('2026-11-04T00:00:00.000Z');
    const archived = seedEnrollment(ctx.db);
    await expect(ctx.service.consume(archived.code, 'ip-archived', NOW)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      status: 409,
    });

    const limited = harness();
    for (let index = 0; index < 10; index += 1)
      await expect(
        limited.service.consume(newEnrollmentCode(), 'ip-limit', NOW),
      ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_FOUND' });
    await expect(
      limited.service.consume(newEnrollmentCode(), 'ip-limit', NOW),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
  });

  it('项目在消费预检后归档时不提交 consumedAt 或消费审计', async () => {
    const { code, row } = seedEnrollment(ctx.db);
    ctx.db.archiveOnConsumeLock = true;
    await expect(ctx.service.consume(code, 'ip-archive-race', NOW)).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PROJECT_ARCHIVED',
      status: 409,
    });
    expect(row.consumedAt).toBeNull();
    expect(ctx.db.audits).toHaveLength(0);
  });
});
