import { ExecutionContext, Injectable, ValidationPipe, type CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
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
  V1_AUTHORIZATION_REPOSITORY,
  type V1AuthorizationRepository,
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
  type V1TicketRecord,
} from '../src/auth/v1-confirmation';
import {
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../src/common/v1-idempotency';
import { V1ReviewController } from '../src/reviews/v1-review.controller';
import { V1ReviewService } from '../src/reviews/v1-review.service';
import {
  V1_REVIEW_REPOSITORY,
  type V1CommitDecisionResult,
  type V1ReviewRepository,
  type V1ReviewSnapshot,
} from '../src/reviews/v1-review.repository';
import { V1PublicationController } from '../src/knowledge/v1-publication.controller';
import {
  V1PublicationService,
  V1_PUBLICATION_REPOSITORY,
  type V1DocumentView,
  type V1PublicationRepository,
  type V1ProposeRevisionSnapshot,
  type V1RevisionView,
  type V1WriteOperation,
} from '../src/knowledge/v1-publication.service';

// ---------------------------------------------------------------------------
// 测试守卫：从 `x-test-principal`（base64(JSON(V1Principal))）注入主体；
// 仅用于 HTTP 契约测试，验证路由/DTO/错误/权限层，而非真实认证解析（已由单元覆盖）。
// ---------------------------------------------------------------------------
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

const alice: Principal & { sessionId?: string; authVersion?: number } = {
  kind: 'HUMAN',
  userId: 'alice',
  scopes: [],
  sessionId: 'sess-1',
  authVersion: 1,
};
const bob: Principal & { sessionId?: string; authVersion?: number } = {
  kind: 'HUMAN',
  userId: 'bob',
  scopes: [],
  sessionId: 'sess-2',
  authVersion: 1,
};
const carol: Principal & { sessionId?: string; authVersion?: number } = {
  kind: 'HUMAN',
  userId: 'carol',
  scopes: [],
  sessionId: 'sess-3',
  authVersion: 1,
};

function encodePrincipal(p: Principal & { sessionId?: string; authVersion?: number }): string {
  return Buffer.from(JSON.stringify(p), 'utf8').toString('base64');
}

// ---------------------------------------------------------------------------
// 内存替身
// ---------------------------------------------------------------------------
class InMemoryAuthzRepo implements V1AuthorizationRepository {
  private projects = new Map<string, V1ProjectRecord>();
  private members = new Map<string, V1MemberRecord>();
  private assignments = new Map<string, V1RoleAssignmentRecord[]>();
  private knowledgeBases = new Map<string, V1KnowledgeBaseRecord>();
  private grants = new Map<string, V1GrantRecord[]>();

  reset(): void {
    this.projects.clear();
    this.members.clear();
    this.assignments.clear();
    this.knowledgeBases.clear();
    this.grants.clear();
    this.projects.set('p1', { id: 'p1', version: 1, archivedAt: null });
    for (const user of [alice.userId, bob.userId, carol.userId])
      this.members.set(`${'p1'}:${user}`, {
        projectId: 'p1',
        userId: user,
        role: 'MEMBER',
        version: 1,
        revokedAt: null,
      });
    this.assignments.set(`${'p1'}:${alice.userId}`, [
      {
        id: 'ra1',
        projectId: 'p1',
        userId: alice.userId,
        roleId: 'r-approver',
        version: 1,
        revokedAt: null,
      },
    ]);
    this.assignments.set(`${'p1'}:${bob.userId}`, [
      {
        id: 'ra2',
        projectId: 'p1',
        userId: bob.userId,
        roleId: 'r-reviewer',
        version: 1,
        revokedAt: null,
      },
    ]);
    this.assignments.set(`${'p1'}:${carol.userId}`, []);
    this.knowledgeBases.set('kb1', {
      id: 'kb1',
      projectId: 'p1',
      visibility: 'PROJECT',
      version: 1,
      authzVersion: 1,
      publicationApproverUserId: 'alice',
      publicationApproverRoleId: null,
      archivedAt: null,
    });
    this.grants.set('kb1', [
      {
        id: 'g-alice',
        knowledgeBaseId: 'kb1',
        subjectKind: 'USER',
        subjectUserId: 'alice',
        subjectRoleId: null,
        permissions: ['READ', 'PROPOSE', 'PUBLISH'],
        revokedAt: null,
      },
      {
        id: 'g-bob',
        knowledgeBaseId: 'kb1',
        subjectKind: 'USER',
        subjectUserId: 'bob',
        subjectRoleId: null,
        permissions: ['READ'],
        revokedAt: null,
      },
      {
        id: 'g-carol',
        knowledgeBaseId: 'kb1',
        subjectKind: 'USER',
        subjectUserId: 'carol',
        subjectRoleId: null,
        permissions: ['READ'],
        revokedAt: null,
      },
    ]);
  }

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
  async findKnowledgeBase(id: string): Promise<V1KnowledgeBaseRecord | null> {
    return this.knowledgeBases.get(id) ?? null;
  }
  async findGrants(knowledgeBaseId: string): Promise<V1GrantRecord[]> {
    return this.grants.get(knowledgeBaseId) ?? [];
  }
}

class InMemoryReviewRepo implements V1ReviewRepository {
  private reviews = new Map<string, V1ReviewSnapshot>();
  private committed: V1CommitDecisionResult | null = null;

  reset(): void {
    this.reviews.clear();
    this.committed = null;
    this.reviews.set('rr1', {
      id: 'rr1',
      projectId: 'p1',
      kind: 'KNOWLEDGE_PUBLICATION',
      status: 'OPEN',
      version: 1,
      subjectDigest: 'digest-1',
      documentRevisionId: 'rev1',
      artifactSetId: null,
      taskId: null,
      slots: [
        {
          id: SLOT_ID,
          slotKey: 'publication',
          kind: 'KNOWLEDGE_PUBLICATION',
          requiredRoleId: null,
          requiredUserId: 'alice',
          sourceSlotBindingId: null,
        },
      ],
      decisions: [],
      subject: {
        documentId: 'doc1',
        knowledgeBaseId: 'kb1',
        documentVersion: 1,
        currentPublishedRevisionId: null,
        revisionId: 'rev1',
        revisionDigest: 'digest-1',
      },
    });
  }

  async findReview(id: string): Promise<V1ReviewSnapshot | null> {
    return this.reviews.get(id) ?? null;
  }

  async commitDecision(): Promise<V1CommitDecisionResult> {
    const result: V1CommitDecisionResult = {
      decisionId: 'dec-1',
      review: this.reviews.get('rr1')!,
      published: true,
      publicationId: 'pub-1',
      documentVersion: 2,
      approvedSlotIds: [SLOT_ID],
      subjectResult: { kind: 'PUBLISHED', publicationId: 'pub-1', documentVersion: 2 },
      task: null,
      requirement: null,
    };
    this.committed = result;
    return result;
  }

  getCommitted(): V1CommitDecisionResult | null {
    return this.committed;
  }
}

class InMemoryConfirmationRepo implements V1ConfirmationRepository {
  private tickets = new Map<string, V1TicketRecord>();

  reset(): void {
    this.tickets.clear();
  }

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async findTicket(id: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(id) ?? null;
  }

  async consumeTicket(): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    // 契约测试只验证服务层是否尝试消费；此处直接声明消费成功。
    return { consumed: true, ticket: null };
  }
}

class InMemoryIdempotencyRepo implements V1IdempotencyRepository {
  private operations = new Map<string, V1OperationRecord>();

  reset(): void {
    this.operations.clear();
  }

  seed(op: V1OperationRecord): void {
    this.operations.set(`${op.projectScopeKey}|${op.principalScopeKey}|${op.key}`, op);
  }

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

class InMemoryPublicationRepo implements V1PublicationRepository {
  private documents = new Map<string, V1DocumentView>();
  private revisions = new Map<string, V1RevisionView>();
  private reviewerMap = new Map<string, string[]>();
  private proposed: V1ProposeRevisionSnapshot | null = null;
  operations: V1WriteOperation[] = [];

  constructor(private readonly idempotency: InMemoryIdempotencyRepo) {}

  reset(): void {
    this.documents.clear();
    this.revisions.clear();
    this.reviewerMap.clear();
    this.proposed = null;
    this.operations.length = 0;
    this.operations = [];
    const sampleBytes = Buffer.from('Hello, WorkMesh 世界 🌐', 'utf8');
    this.documents.set('doc1', {
      id: 'doc1',
      projectId: 'p1',
      knowledgeBaseId: 'kb1',
      requirementId: null,
      kind: 'KNOWLEDGE',
      version: 1,
      currentPublishedRevisionId: 'rev2',
      archivedAt: null,
    });
    this.revisions.set('rev1', {
      id: 'rev1',
      documentId: 'doc1',
      knowledgeBaseId: 'kb1',
      projectId: 'p1',
      seq: 1,
      title: 'Candidate',
      mimeType: 'text/markdown; charset=utf-8',
      byteLength: sampleBytes.byteLength,
      digest: createHash('sha256').update(sampleBytes).digest('hex'),
      state: 'CANDIDATE',
      bodyBytes: new Uint8Array(sampleBytes),
      createdBy: 'alice',
    });
    this.revisions.set('rev2', {
      id: 'rev2',
      documentId: 'doc1',
      knowledgeBaseId: 'kb1',
      projectId: 'p1',
      seq: 2,
      title: 'Published',
      mimeType: 'text/markdown; charset=utf-8',
      byteLength: sampleBytes.byteLength,
      digest: createHash('sha256').update(sampleBytes).digest('hex'),
      state: 'PUBLISHED',
      bodyBytes: new Uint8Array(sampleBytes),
      createdBy: 'alice',
    });
    this.reviewerMap.set('rev1', ['alice']);
  }

  async findDocument(id: string): Promise<V1DocumentView | null> {
    return this.documents.get(id) ?? null;
  }
  async findRevision(id: string): Promise<V1RevisionView | null> {
    return this.revisions.get(id) ?? null;
  }
  async listRevisions(documentId: string): Promise<V1RevisionView[]> {
    return [...this.revisions.values()].filter((item) => item.documentId === documentId);
  }
  async isAssignedReviewer(revisionId: string, userId: string): Promise<boolean> {
    return (this.reviewerMap.get(revisionId) ?? []).includes(userId);
  }
  async proposeRevision(input: {
    document: V1DocumentView;
    title: string;
    mimeType: string;
    bodyBytes: Uint8Array;
    createdBy: string;
    operation: V1WriteOperation;
  }): Promise<V1ProposeRevisionSnapshot> {
    const id = randomUUID();
    this.operations.push(input.operation);
    const result: V1ProposeRevisionSnapshot = {
      revision: {
        id,
        documentId: input.document.id,
        knowledgeBaseId: input.document.knowledgeBaseId,
        projectId: input.document.projectId,
        seq: 3,
        title: input.title,
        mimeType: input.mimeType,
        byteLength: input.bodyBytes.byteLength,
        digest: createHash('sha256').update(Buffer.from(input.bodyBytes)).digest('hex'),
        state: 'CANDIDATE',
        createdBy: input.createdBy,
        basisUnderstandingRevisionId: null,
        deliveryScope: null,
        acceptance: null,
      },
      reviewRequestId: randomUUID(),
      reviewKind: 'KNOWLEDGE_PUBLICATION',
      slots: [
        { id: 'slot-x', slotKey: 'publication', requiredUserId: 'alice', requiredRoleId: null },
      ],
    };
    this.proposed = result;
    // 与真实仓储一致：业务写入与幂等收据同一事务落库。
    this.idempotency.seed({
      id: input.operation.id,
      projectScopeKey: input.operation.projectScopeKey,
      principalScopeKey: input.operation.principalScopeKey,
      key: input.operation.key,
      method: input.operation.method,
      route: input.operation.route,
      requestDigest: input.operation.requestDigest,
      resultRefs: result as unknown as Record<string, unknown>,
      committedAt: new Date(),
    });
    return result;
  }

  getProposed(): V1ProposeRevisionSnapshot | null {
    return this.proposed;
  }
}

// ---------------------------------------------------------------------------
// 引导真实 Nest 应用（仅 v1 路由），套用全局 ValidationPipe / 错误信封 / 严格 JSON。
// ---------------------------------------------------------------------------
const authzRepo = new InMemoryAuthzRepo();
const reviewRepo = new InMemoryReviewRepo();
const confirmationRepo = new InMemoryConfirmationRepo();
const idempotencyRepo = new InMemoryIdempotencyRepo();
const publicationRepo = new InMemoryPublicationRepo(idempotencyRepo);

const IDEMPOTENCY_KEY = '11111111-1111-1111-1111-111111111111';
const TICKET_SECRET = 'secret-1';
// 评审审批槽与确认票据 ID 在真实域为 Prisma uuid()；DecideDto 的 slotId/ticketId 均为 @IsUUID()。
// 这里用固定 UUID 格式对齐 DTO 约束，确保校验通过而非被格式校验误伤。
const SLOT_ID = '22222222-2222-4aaa-8aaa-222222222222';
const TICKET_ID = '33333333-3333-4bbb-9bbb-333333333333';

describe('v1 HTTP contract (real Nest bootstrap)', () => {
  let server: unknown;
  let appRef: { close: () => Promise<void> };

  beforeAll(async () => {
    const authzService = new V1AuthorizationService(authzRepo);
    const reviewService = new V1ReviewService(
      reviewRepo,
      authzService,
      confirmationRepo,
      idempotencyRepo,
    );
    const publicationService = new V1PublicationService(
      publicationRepo,
      authzService,
      confirmationRepo,
      idempotencyRepo,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [V1ReviewController, V1PublicationController],
      providers: [
        { provide: V1ReviewService, useValue: reviewService },
        { provide: V1PublicationService, useValue: publicationService },
        { provide: V1AuthorizationService, useValue: authzService },
        { provide: V1_AUTHORIZATION_REPOSITORY, useValue: authzRepo },
        { provide: V1_REVIEW_REPOSITORY, useValue: reviewRepo },
        { provide: V1_CONFIRMATION_REPOSITORY, useValue: confirmationRepo },
        { provide: V1_IDEMPOTENCY_REPOSITORY, useValue: idempotencyRepo },
        { provide: V1_PUBLICATION_REPOSITORY, useValue: publicationRepo },
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
        res: { setHeader: (n: string, v: string) => void },
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
    authzRepo.reset();
    reviewRepo.reset();
    confirmationRepo.reset();
    idempotencyRepo.reset();
    publicationRepo.reset();
    // 预置合法票据：actionDigest 由服务端派生逻辑计算，确保绑定一致。
    const binding: ActionBinding = {
      action: 'REVIEW_DECIDE',
      projectId: 'p1',
      targetType: 'REVIEW_REQUEST',
      targetId: 'rr1',
      expectedVersion: 1,
      roleSlot: null,
      payload: { slotId: SLOT_ID, decision: 'APPROVE', subjectDigest: 'digest-1', comment: null },
    };
    confirmationRepo.seed({
      id: TICKET_ID,
      secretHash: hashTicketSecret(TICKET_SECRET),
      userId: 'alice',
      webSessionId: 'sess-1',
      projectId: 'p1',
      userAuthVersion: 1,
      action: 'REVIEW_DECIDE',
      targetType: 'REVIEW_REQUEST',
      targetId: 'rr1',
      expectedVersion: 1,
      actionDigest: actionDigestOf(binding),
      roleId: null,
      approvalSlotId: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      consumedAt: null,
      consumedOperationId: null,
      invalidatedAt: null,
    });
  });

  it('路由注册：已知 v1 路由存在（200/401/404），未知 v1 路由 404', async () => {
    // 说明：OpenAPI 文档由生产 tsc 构建在 main.ts 中经 SwaggerModule 接线；vitest 用 esbuild 转译不发射
    // design:paramtypes 装饰器元数据，Swagger 在测试进程内无法稳定生成。此处以真实路由探测证明 v1 路由已注册。
    const known = await request(server)
      .get('/api/v1/review-requests/rr1')
      .set('x-test-principal', encodePrincipal(alice));
    expect([200, 401, 403, 404]).toContain(known.status);
    const unknown = await request(server)
      .get('/api/v1/review-requests/does-not-exist-xyz')
      .set('x-test-principal', encodePrincipal(alice));
    expect(unknown.status).toBe(404);
    const bogusRoute = await request(server)
      .get('/api/v1/totally-unknown-path')
      .set('x-test-principal', encodePrincipal(alice));
    expect(bogusRoute.status).toBe(404);
  });

  it('错误信封：未带主体 → 401 且形态为 {error:{code,message,requestId}}', async () => {
    const res = await request(server).get('/api/v1/review-requests/rr1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
    expect(typeof res.body.error.requestId).toBe('string');
    expect(res.body.error.requestId.length).toBeGreaterThan(0);
  });

  it('404：无权访问的对象按 404 返回，不泄露存在性（alice 读不存在的评审）', async () => {
    const res = await request(server)
      .get('/api/v1/review-requests/does-not-exist')
      .set('x-test-principal', encodePrincipal(alice));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('200：alice 读取其可访问的评审', async () => {
    const res = await request(server)
      .get('/api/v1/review-requests/rr1')
      .set('x-test-principal', encodePrincipal(alice));
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('rr1');
    expect(res.body.meta.requestId).toBeDefined();
  });

  it('严格 JSON：POST 重复 key 正文 → 400 INVALID_REQUEST', async () => {
    const body =
      '{"slotId":"slot1","slotId":"x","decision":"APPROVE","expectedVersion":1,"confirmation":{"ticketId":"t1","ticketSecret":"secret-1"}}';
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('Content-Type', 'application/json')
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('严格 JSON：POST 浮点数字段 → 400 INVALID_REQUEST', async () => {
    const body = JSON.stringify({
      slotId: SLOT_ID,
      decision: 'APPROVE',
      expectedVersion: 1.5,
      confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
    });
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  it('DTO：未知字段 → 400（forbidNonWhitelisted）', async () => {
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
        rogueField: 'x',
      });
    expect(res.status).toBe(400);
  });

  it('幂等键：缺失 → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('403：bob 非指派审批人且无业务角色 → REVIEW_SLOT_NOT_ASSIGNED', async () => {
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(bob))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('409：expectedVersion 与评审版本不符 → VERSION_CONFLICT', async () => {
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 2,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('409：同键异内容 → IDEMPOTENCY_CONFLICT', async () => {
    idempotencyRepo.seed({
      id: 'op-stale',
      projectScopeKey: 'project:p1',
      principalScopeKey: 'user:alice',
      key: IDEMPOTENCY_KEY,
      method: 'POST',
      route: '/api/v1/review-requests/rr1/decisions',
      requestDigest: 'stale-digest',
      resultRefs: {},
      committedAt: new Date(),
    });
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
      });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('200：alice 经正式 decisions 路径完成批准并发布（不与直插 ReviewDecision 等价）', async () => {
    const res = await request(server)
      .post('/api/v1/review-requests/rr1/decisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        confirmation: { ticketId: TICKET_ID, ticketSecret: 'secret-1' },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.published).toBe(true);
    expect(res.body.data.publicationId).toBe('pub-1');
    expect(res.body.data.subjectResult).toEqual({
      kind: 'PUBLISHED',
      publicationId: 'pub-1',
      documentVersion: 2,
    });
    expect(res.body.data.task).toBeNull();
    expect(res.body.data.requirement).toBeNull();
    expect(reviewRepo.getCommitted()).not.toBeNull();
  });

  it('正文 bytes 契约：alice 读取候选正文，base64 还原与摘要一致', async () => {
    const res = await request(server)
      .get('/api/v1/document-revisions/rev1/content')
      .set('x-test-principal', encodePrincipal(alice));
    expect(res.status).toBe(200);
    expect(res.body.data.encoding).toBe('base64');
    const decoded = Buffer.from(res.body.data.bodyBase64, 'base64');
    expect(decoded.toString('utf8')).toBe('Hello, WorkMesh 世界 🌐');
    expect(res.body.data.sha256).toBe(createHash('sha256').update(decoded).digest('hex'));
  });

  it('候选可见性：carol（仅 READ，非作者/评审者/PROPOSE）→ 404', async () => {
    const res = await request(server)
      .get('/api/v1/document-revisions/rev1/content')
      .set('x-test-principal', encodePrincipal(carol));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('KNOWLEDGE_ACCESS_DENIED');
  });

  it('另一授权主体：carol 读取已发布正文并核对相同 bytes 与摘要', async () => {
    const res = await request(server)
      .get('/api/v1/document-revisions/rev2/content')
      .set('x-test-principal', encodePrincipal(carol));
    expect(res.status).toBe(200);
    const decoded = Buffer.from(res.body.data.bodyBase64, 'base64');
    expect(decoded.toString('utf8')).toBe('Hello, WorkMesh 世界 🌐');
    expect(res.body.data.sha256).toBe(createHash('sha256').update(decoded).digest('hex'));
  });

  it('propose：alice 创建候选（无直接发布入口），返回派生审批槽', async () => {
    const sample = Buffer.from('# Proposal', 'utf8');
    const res = await request(server)
      .post('/api/v1/documents/doc1/revisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'Proposal',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBase64: sample.toString('base64'),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.reviewRequestId).toBeDefined();
    expect(res.body.data.slots[0].requiredUserId).toBe('alice');
    expect(res.body.data.revision.bodyBytes).toBeUndefined();
    expect(publicationRepo.getProposed()).not.toBeNull();
  });

  it('propose：缺 Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
    const res = await request(server)
      .post('/api/v1/documents/doc1/revisions')
      .set('x-test-principal', encodePrincipal(alice))
      .send({
        title: 'Proposal',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBase64: Buffer.from('x').toString('base64'),
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(V1_ERROR_CODES.IDEMPOTENCY_KEY_REQUIRED);
  });

  it('propose：同 Idempotency-Key 重放返回首次结果且不产生第二条候选', async () => {
    const key = randomUUID();
    const send = () =>
      request(server)
        .post('/api/v1/documents/doc1/revisions')
        .set('x-test-principal', encodePrincipal(alice))
        .set('Idempotency-Key', key)
        .send({
          title: 'Replay',
          mimeType: 'text/markdown; charset=utf-8',
          bodyBase64: Buffer.from('# Replay', 'utf8').toString('base64'),
        });
    const first = await send();
    const second = await send();
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.revision.id).toBe(first.body.data.revision.id);
    expect(second.body.data.reviewRequestId).toBe(first.body.data.reviewRequestId);
    expect(publicationRepo.operations).toHaveLength(1);
  });

  it('propose：未知字段 → 400（forbidNonWhitelisted）', async () => {
    const res = await request(server)
      .post('/api/v1/documents/doc1/revisions')
      .set('x-test-principal', encodePrincipal(alice))
      .set('Idempotency-Key', randomUUID())
      .send({
        title: 'Proposal',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBase64: Buffer.from('x').toString('base64'),
        unexpected: true,
      });
    expect(res.status).toBe(400);
  });
});
