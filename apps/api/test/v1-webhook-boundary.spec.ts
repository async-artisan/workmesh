import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';

import { V1AuthService, V1_AUTH_REPOSITORY } from '../src/auth/v1-auth.service';
import type { V1AuthRepository } from '../src/auth/v1-auth.repository';
import { hashSecret, randomSecret } from '../src/auth/v1-policy';
import {
  V1AuthorizationService,
  V1_AUTHORIZATION_REPOSITORY,
  type V1AuthorizationRepository,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from '../src/auth/v1-authorization';
import { V1_IDEMPOTENCY_REPOSITORY, type V1IdempotencyRepository, type V1OperationRecord } from '../src/common/v1-idempotency';

import { V1GithubEvidenceController } from '../src/integrations/v1-github-evidence.controller';
import { V1GithubEvidenceService, V1_GITHUB_WEBHOOK_SECRET } from '../src/integrations/v1-github-evidence.service';
import {
  V1_GITHUB_EVIDENCE_REPOSITORY,
  type V1CodeReviewEvidenceRecord,
  type V1GithubEvidenceRepository,
  type V1RecordEvidenceInput,
  type V1RecordReceiptInput,
  type V1WebhookReceiptRecord,
} from '../src/integrations/v1-github-evidence.repository';

// ---------------------------------------------------------------------------
// 固定标识：全部为稳定 UUID / 40 位十六进制 SHA，便于复跑。
// ---------------------------------------------------------------------------
const PROJECT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_ID = 'aa000000-0000-4000-8000-000000000001';
const ROLE_INTEGRATION = '11111111-1111-4111-8111-111111111111';
const CREDENTIAL_ID = '55555555-5555-4555-8555-555555555555';

const HEAD_SHA = 'a'.repeat(40);
const COMMIT_SHA = 'b'.repeat(40);

const TEST_SECRET = 'test-webhook-secret-do-not-use-in-prod';
const AGENT_SECRET = randomSecret();
const AGENT_TOKEN = `wm_a1.${CREDENTIAL_ID}.${AGENT_SECRET}`;

const KEY_FIRST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const KEY_SECOND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const KEY_BAD_SHA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const KEY_TAMPER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const KEY_FORGED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const KEY_NO_SECRET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
const KEY_NO_HEADER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';

function webhookPayload(deliveryId: string, overrides: Record<string, unknown> = {}) {
  return {
    projectId: PROJECT_ID,
    eventType: 'pull_request',
    deliveryId,
    repositories: [
      {
        repositoryId: 'repo-1',
        changeRequestId: '42',
        changeRequestHeadSha: HEAD_SHA,
        authorExternalId: 'author-1',
        merged: true,
        artifactCommitSha: HEAD_SHA,
        reviews: [
          {
            reviewerId: 'reviewer-1',
            reviewerKind: 'USER',
            state: 'APPROVED',
            commitSha: HEAD_SHA,
            submittedAt: '2026-01-01T00:00:00.000Z',
            reviewId: 'review-1',
          },
        ],
      },
    ],
    ...overrides,
  };
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body, 'utf8').digest('hex')}`;
}

// ---------------------------------------------------------------------------
// 内存仓储：收据 / 证据 / 幂等操作全部进程内，不触达任何真实数据库。
// ---------------------------------------------------------------------------
class MemoryGithubRepo implements V1GithubEvidenceRepository {
  receipts = new Map<string, V1WebhookReceiptRecord>();
  evidence = new Map<string, V1CodeReviewEvidenceRecord>();
  evidenceByReceipt = new Map<string, string[]>();
  recorded = 0;

  reset(): void {
    this.receipts.clear();
    this.evidence.clear();
    this.evidenceByReceipt.clear();
    this.recorded = 0;
  }

  async findReceiptByDelivery(_source: 'GITHUB', deliveryId: string) {
    for (const receipt of this.receipts.values()) if (receipt.deliveryId === deliveryId) return receipt;
    return null;
  }

  async recordReceipt(input: V1RecordReceiptInput): Promise<V1WebhookReceiptRecord> {
    const receipt: V1WebhookReceiptRecord = {
      id: randomUUID(),
      ...input,
      receivedAt: new Date(),
      processedAt: null,
      status: 'RECEIVED',
      errorMessage: null,
    };
    this.receipts.set(receipt.id, receipt);
    return receipt;
  }

  async recordReceiptProcessed(receiptId: string, status: string, errorMessage: string | null): Promise<void> {
    const receipt = this.receipts.get(receiptId)!;
    this.receipts.set(receiptId, { ...receipt, status, errorMessage, processedAt: new Date() });
  }

  async findEvidenceIdsByReceipt(receiptId: string): Promise<string[]> {
    return this.evidenceByReceipt.get(receiptId) ?? [];
  }

  async findEvidenceByFingerprint(fingerprint: string): Promise<V1CodeReviewEvidenceRecord | null> {
    for (const row of this.evidence.values()) if (row.evidenceFingerprint === fingerprint) return row;
    return null;
  }

  async recordEvidence(input: V1RecordEvidenceInput): Promise<V1CodeReviewEvidenceRecord> {
    const row: V1CodeReviewEvidenceRecord = { id: randomUUID(), ...input, createdAt: new Date() };
    this.evidence.set(row.id, row);
    this.recorded += 1;
    if (row.receiptId) {
      const list = this.evidenceByReceipt.get(row.receiptId) ?? [];
      list.push(row.id);
      this.evidenceByReceipt.set(row.receiptId, list);
    }
    return row;
  }

  async findArtifactSet(): Promise<null> {
    return null;
  }
  async findApprovedEvidenceForHead(): Promise<null> {
    return null;
  }
  async createVersionedTicket(): Promise<never> {
    throw new Error('不在本用例范围内');
  }
  async findVersionedTicket(): Promise<null> {
    return null;
  }
  async consumeVersionedTicket(): Promise<void> {}
  async persistIdempotency(): Promise<void> {}
}

class MemoryIdempotencyRepo implements V1IdempotencyRepository {
  async findOperation(): Promise<V1OperationRecord | null> {
    return null;
  }
}

class MemoryAuthzRepo implements V1AuthorizationRepository {
  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    if (projectId !== PROJECT_ID) return null;
    return { id: projectId, version: 1, archivedAt: null };
  }
  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    if (projectId !== PROJECT_ID || userId !== USER_ID) return null;
    return { id: 'm-1', projectId, userId, role: 'MEMBER', version: 1, revokedAt: null };
  }
  async findActiveRoleAssignments(projectId: string, userId: string): Promise<V1RoleAssignmentRecord[]> {
    if (userId !== USER_ID) return [];
    return [{ id: 'ra-1', projectId, userId, roleId: ROLE_INTEGRATION, version: 1, revokedAt: null }];
  }
  async findRoleAssignment(projectId: string, userId: string, roleId: string) {
    if (userId !== USER_ID || roleId !== ROLE_INTEGRATION) return null;
    return { id: 'ra-1', projectId, userId, roleId, version: 1, revokedAt: null };
  }
  async findKnowledgeBase(): Promise<null> {
    return null;
  }
  async findGrants(): Promise<[]> {
    return [];
  }
}

const agentCredential = {
  id: CREDENTIAL_ID,
  userId: USER_ID,
  projectId: PROJECT_ID,
  roleId: ROLE_INTEGRATION,
  name: 'webhook-agent',
  tokenHash: hashSecret(AGENT_SECRET),
  scopes: ['integrations:receive'],
  userAuthVersion: 1,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  user: { id: USER_ID, isActive: true, authVersion: 1 },
};

const authRepo = {
  async findSession() {
    return null;
  },
  async findCredential(credentialId: string) {
    return credentialId === CREDENTIAL_ID ? agentCredential : null;
  },
  async touchSession() {},
} as unknown as V1AuthRepository;

const repo = new MemoryGithubRepo();

async function buildApp(secret: string) {
  const authzRepo = new MemoryAuthzRepo();
  const idempotencyRepo = new MemoryIdempotencyRepo();
  const authzService = new V1AuthorizationService(authzRepo);
  const authService = new V1AuthService(authRepo);
  const service = new V1GithubEvidenceService(repo, authzService, idempotencyRepo, secret);

  const moduleRef = await Test.createTestingModule({
    controllers: [V1GithubEvidenceController],
    providers: [
      { provide: V1AuthService, useValue: authService },
      { provide: V1_AUTH_REPOSITORY, useValue: authRepo },
      { provide: V1_GITHUB_EVIDENCE_REPOSITORY, useValue: repo },
      { provide: V1_GITHUB_WEBHOOK_SECRET, useValue: secret },
      { provide: V1GithubEvidenceService, useValue: service },
      { provide: V1AuthorizationService, useValue: authzService },
      { provide: V1_AUTHORIZATION_REPOSITORY, useValue: authzRepo },
      { provide: V1_IDEMPOTENCY_REPOSITORY, useValue: idempotencyRepo },
    ],
  }).compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
  await app.init();
  return { server: app.getHttpServer(), app: app as unknown as { close: () => Promise<void> } };
}

// ---------------------------------------------------------------------------
// 真实 HTTP controller + 真实 V1AuthGuard + 真实服务的 webhook 边界验证。
// ---------------------------------------------------------------------------
describe('v1 GitHub webhook HTTP 边界（真实 controller / Guard / service）', () => {
  let server: unknown;
  let noSecretServer: unknown;
  let appRef: { close: () => Promise<void> };
  let noSecretAppRef: { close: () => Promise<void> };

  beforeAll(async () => {
    const configured = await buildApp(TEST_SECRET);
    server = configured.server;
    appRef = configured.app;
    const unconfigured = await buildApp('');
    noSecretServer = unconfigured.server;
    noSecretAppRef = unconfigured.app;
  });

  afterAll(async () => {
    await appRef?.close();
    await noSecretAppRef?.close();
  });

  beforeEach(() => {
    repo.reset();
  });

  it('合法 HMAC：真实原始字节签名 → 201，落收据且 signatureValid=true', async () => {
    const body = JSON.stringify(webhookPayload('delivery-1'));
    const res = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_FIRST)
      .set('x-hub-signature-256', sign(body, TEST_SECRET))
      .send(body);

    expect(res.status).toBe(201);
    expect(res.body.data.signatureValid).toBe(true);
    expect(res.body.data.replayed).toBe(false);
    expect(res.body.data.decision).toBe('VALID');
    expect(res.body.data.evidenceIds).toHaveLength(1);
    // 服务端必须按原始字节独立计算 digest：与客户端声明无关。
    expect(repo.recorded).toBe(1);
  });

  it('伪造签名：用错误密钥签名 → 403 WEBHOOK_SIGNATURE_INVALID，且不落收据', async () => {
    const body = JSON.stringify(webhookPayload('delivery-forged'));
    const res = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_FORGED)
      .set('x-hub-signature-256', sign(body, 'attacker-secret'))
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.reason ?? res.body.error.message).toBeTruthy();
    expect(repo.receipts.size).toBe(0);
    expect(repo.recorded).toBe(0);
  });

  it('缺失签名头 → 403；格式非 sha256= 或 digest 非 64 位十六进制同样拒绝', async () => {
    const body = JSON.stringify(webhookPayload('delivery-nohdr'));

    const missing = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_NO_HEADER)
      .send(body);
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('FORBIDDEN');

    const wrongAlgo = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_NO_HEADER)
      .set('x-hub-signature-256', `sha1=${'0'.repeat(40)}`)
      .send(body);
    expect(wrongAlgo.status).toBe(403);

    const shortDigest = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_NO_HEADER)
      .set('x-hub-signature-256', 'sha256=abc')
      .send(body);
    expect(shortDigest.status).toBe(403);

    expect(repo.receipts.size).toBe(0);
  });

  it('缺失 webhook 密钥配置 → 即使签名格式正确也 403 安全拒绝', async () => {
    const body = JSON.stringify(webhookPayload('delivery-nosecret'));
    const res = await request(noSecretServer)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_NO_SECRET)
      .set('x-hub-signature-256', sign(body, TEST_SECRET))
      .send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(repo.receipts.size).toBe(0);
  });

  it('SHA 格式合法但与 head 不一致 → 201 落收据，决策判为 INVALID（APPROVAL_HEAD_MISMATCH）', async () => {
    const payload = webhookPayload('delivery-sha-mismatch');
    payload.repositories[0].reviews[0].commitSha = COMMIT_SHA;
    const body = JSON.stringify(payload);
    const res = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_BAD_SHA)
      .set('x-hub-signature-256', sign(body, TEST_SECRET))
      .send(body);

    // 格式合规不阻挡投递；证据完整性判断下沉到策略层，收据照常留痕。
    expect(res.status).toBe(201);
    expect(res.body.data.decision).toBe('INVALID');
    expect(res.body.data.reasons).toContain('APPROVAL_HEAD_MISMATCH');
    expect(repo.receipts.size).toBe(1);
  });

  it('SHA 格式校验：commitSha 非 40 位小写十六进制 → 400 且不落收据', async () => {
    const payload = webhookPayload('delivery-badsha');
    payload.repositories[0].reviews[0].commitSha = 'NOT-A-SHA';
    const body = JSON.stringify(payload);
    const res = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_BAD_SHA)
      .set('x-hub-signature-256', sign(body, TEST_SECRET))
      .send(body);

    expect(res.status).toBe(400);
    expect(repo.receipts.size).toBe(0);
    expect(repo.recorded).toBe(0);
  });

  it('原始字节被篡改：签名对应旧字节 → 403，证明按 rawBody 校验而非重序列化结果', async () => {
    const original = JSON.stringify(webhookPayload('delivery-tamper'));
    const signature = sign(original, TEST_SECRET);
    const tampered = original.replace('"merged":true', '"merged":false');

    const res = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_TAMPER)
      .set('x-hub-signature-256', signature)
      .send(tampered);

    expect(res.status).toBe(403);
    expect(repo.receipts.size).toBe(0);
  });

  it('重复投递：同一 deliveryId 二次投递 → 幂等返回原收据，replayed=true', async () => {
    const body = JSON.stringify(webhookPayload('delivery-dup'));
    const signature = sign(body, TEST_SECRET);

    const first = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_FIRST)
      .set('x-hub-signature-256', signature)
      .send(body);
    expect(first.status).toBe(201);
    expect(first.body.data.replayed).toBe(false);

    const second = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_SECOND)
      .set('x-hub-signature-256', signature)
      .send(body);

    expect(second.status).toBe(201);
    expect(second.body.data.replayed).toBe(true);
    expect(second.body.data.receiptId).toBe(first.body.data.receiptId);
    expect(second.body.data.signatureValid).toBe(true);
    // 去重生效：证据不重复落库。
    expect(repo.recorded).toBe(1);
  });

  it('重复投递但 payload 摘要不同 → 409 WEBHOOK_REPLAY_CONFLICT', async () => {
    const firstBody = JSON.stringify(webhookPayload('delivery-conflict'));
    const first = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_FIRST)
      .set('x-hub-signature-256', sign(firstBody, TEST_SECRET))
      .send(firstBody);
    expect(first.status).toBe(201);

    const mutated = JSON.stringify(
      webhookPayload('delivery-conflict', { eventType: 'pull_request_review' }),
    );
    const second = await request(server)
      .post('/api/v1/integrations/github/webhooks')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', KEY_SECOND)
      .set('x-hub-signature-256', sign(mutated, TEST_SECRET))
      .send(mutated);

    expect(second.status).toBe(409);
  });
});
