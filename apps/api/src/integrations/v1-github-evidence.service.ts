import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { V1_ERROR_CODES, WorkmeshError, type Principal, type Scope } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { assertGithubWebhookSignature } from './v1-code-host-adapter';
import { openTicketSecret, sealTicketSecret } from './v1-ticket-secret';
import { evaluateCodeEvidenceSet, type RepositoryEvidenceInput } from './v1-code-evidence-policy';
import {
  V1_GITHUB_EVIDENCE_REPOSITORY,
  type V1ArtifactSetSummary,
  type V1CodeReviewEvidenceRecord,
  type V1GithubEvidenceRepository,
  type V1WebhookReceiptRecord,
} from './v1-github-evidence.repository';

const SCOPE_RECEIVE: Scope = 'integrations:receive';
const SCOPE_PREPARE: Scope = 'integrations:prepare';

/** 配置的 GitHub webhook 密钥；缺失时所有 webhook 一律安全拒绝。 */
export const V1_GITHUB_WEBHOOK_SECRET = Symbol('V1_GITHUB_WEBHOOK_SECRET');
export const V1_TICKET_ENCRYPTION_KEY = Symbol('V1_TICKET_ENCRYPTION_KEY');

export type V1WebhookReceiveInput = {
  eventType: string;
  deliveryId: string;
  /** 原始请求体：签名与 digest 都必须基于未重序列化的字节。 */
  rawBody: Uint8Array;
  signatureHeader: string | undefined;
  repositories: RepositoryEvidenceInput[];
};

export type V1WebhookReceiveContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
};

export type V1WebhookReceiveResult = {
  receiptId: string;
  decision: 'VALID' | 'INVALID' | 'UNKNOWN';
  reasons: string[];
  evidenceIds: string[];
  replayed: boolean;
  signatureValid: boolean;
};

export type V1PrepareInput = {
  artifactSetId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  generation: number;
};

export type V1PrepareContext = V1WebhookReceiveContext;

export type V1PrepareResult = {
  ticketId: string;
  secret: string;
  expiresAt: Date;
  evidenceId: string;
  replayed: boolean;
};

export type V1UseTicketInput = {
  ticketId: string;
  secret: string;
  artifactSetId: string;
  headSha: string;
  generation: number;
};

export type V1UseTicketContext = {
  now: Date;
};

export type V1UseTicketResult = {
  evidenceId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
};

export type V1EvidenceFingerprintParts = {
  projectId: string;
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  reviewerExternalId: string;
  reviewExternalId: string;
  state: string;
  commitSha: string | null;
};

/**
 * 证据去重指纹。**必须包含 projectId**：同一个 GitHub 仓库可以被两个 WorkMesh 项目登记，
 * 指纹若不含项目，两边的同一条评审会被判成同一条证据——先到者占住唯一键，
 * 后到的项目复用它的行、`projectId` 却是对方的，于是该项目永远拿不到自己的证据。
 */
export function evidenceFingerprintOf(parts: V1EvidenceFingerprintParts): string {
  const canonical = JSON.stringify({
    projectId: parts.projectId,
    repositoryId: parts.repositoryId,
    changeRequestId: parts.changeRequestId,
    headSha: parts.headSha,
    reviewerExternalId: parts.reviewerExternalId,
    reviewExternalId: parts.reviewExternalId,
    state: parts.state,
    commitSha: parts.commitSha ?? null,
  });
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

export function versionedTicketFingerprint(input: {
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  artifactSetId: string;
  generation: number;
}): string {
  const canonical = JSON.stringify(input);
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

@Injectable()
export class V1GithubEvidenceService {
  constructor(
    @Inject(V1_GITHUB_EVIDENCE_REPOSITORY) private readonly repository: V1GithubEvidenceRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
    @Inject(V1_GITHUB_WEBHOOK_SECRET) private readonly webhookSecret: string,
    @Optional() @Inject(V1_TICKET_ENCRYPTION_KEY) private readonly ticketEncryptionKey = '',
  ) {}

  async receiveWebhook(
    principal: Principal,
    projectId: string,
    input: V1WebhookReceiveInput,
    context: V1WebhookReceiveContext,
  ): Promise<V1WebhookReceiveResult> {
    // 1) 服务端先按原始字节校验 HMAC；无密钥、缺签名或伪造签名一律 403，不落任何收据。
    assertGithubWebhookSignature({
      secret: this.webhookSecret,
      rawBody: input.rawBody,
      signatureHeader: input.signatureHeader,
    });
    // 2) payload digest 由服务端计算，客户端无法通过字段声明影响去重判断。
    const payloadDigest = createHash('sha256').update(input.rawBody).digest('hex');

    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    await this.authorization.requireScope(principal, projectId, SCOPE_RECEIVE);

    const projectScopeKey = `project:${projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    // 幂等：同一 delivery 重放返回原收据，不再重复处理。
    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const prior = String(existing.resultRefs.receiptId ?? '');
      return {
        receiptId: prior,
        decision: (existing.resultRefs.decision as V1WebhookReceiveResult['decision']) ?? 'INVALID',
        reasons: (existing.resultRefs.reasons as string[]) ?? [],
        evidenceIds: (existing.resultRefs.evidenceIds as string[]) ?? [],
        replayed: true,
        signatureValid: Boolean(existing.resultRefs.signatureValid),
      };
    }

    // 投递去重：同一 source+deliveryId 重复投递必须幂等，返回原收据与原结果。
    const duplicate = await this.repository.findReceiptByDelivery('GITHUB', input.deliveryId);
    if (duplicate) {
      if (duplicate.projectId !== projectId || duplicate.payloadDigest !== payloadDigest)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'WEBHOOK_REPLAY_CONFLICT',
          { receiptId: duplicate.id },
          409,
        );
      if (duplicate.status !== 'PENDING') {
        const evidenceIds = await this.repository.findEvidenceIdsByReceipt(duplicate.id);
        return {
          receiptId: duplicate.id,
          decision: decisionFromReceiptStatus(duplicate.status),
          reasons: reasonsFromReceipt(duplicate),
          evidenceIds,
          replayed: true,
          signatureValid: duplicate.signatureValid,
        };
      }
    }

    // A previous attempt may have stopped after any individual write. Resume the
    // pending receipt; fingerprint deduplication preserves already recorded evidence.
    const receipt =
      duplicate ??
      (await this.repository.recordReceipt({
        projectId,
        source: 'GITHUB',
        eventType: input.eventType,
        deliveryId: input.deliveryId,
        signatureValid: true,
        payloadDigest,
      }));
    // recordReceipt may return the winner of a simultaneous delivery insert.
    if (receipt.projectId !== projectId || receipt.payloadDigest !== payloadDigest)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'WEBHOOK_REPLAY_CONFLICT',
        { receiptId: receipt.id },
        409,
      );

    const evaluation = evaluateCodeEvidenceSet(input.repositories);
    const evidenceIds: string[] = [];
    for (const repo of input.repositories) {
      for (const review of repo.reviews) {
        const fingerprint = evidenceFingerprintOf({
          projectId,
          repositoryId: repo.repositoryId,
          changeRequestId: repo.changeRequestId,
          headSha: repo.changeRequestHeadSha ?? '',
          reviewerExternalId: review.reviewerId,
          reviewExternalId: review.reviewId,
          state: review.state,
          commitSha: review.commitSha,
        });
        const prior = await this.repository.findEvidenceByFingerprint(projectId, fingerprint);
        if (prior) {
          evidenceIds.push(prior.id);
          continue;
        }
        const recorded = await this.repository.recordEvidence({
          projectId,
          repositoryId: repo.repositoryId,
          changeRequestId: repo.changeRequestId,
          headSha: repo.changeRequestHeadSha ?? '',
          authorExternalId: repo.authorExternalId ?? '',
          reviewerExternalId: review.reviewerId,
          reviewerKind: review.reviewerKind,
          state: review.state,
          commitSha: review.commitSha,
          submittedAt: review.submittedAt ? new Date(review.submittedAt) : null,
          reviewExternalId: review.reviewId,
          artifactSetId: null,
          evidenceFingerprint: fingerprint,
          receiptId: receipt.id,
        });
        evidenceIds.push(recorded.id);
      }
    }

    const status = evaluation.decision === 'VALID' ? 'PROCESSED' : 'EVIDENCE_INVALID';
    const refs = {
      projectScopeKey,
      principalScopeKey,
      requestDigest,
      receiptId: receipt.id,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      evidenceIds,
      signatureValid: true,
    };
    await this.repository.completeReceipt(
      receipt.id,
      status,
      evaluation.reasons.join(';') || null,
      {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
        resultRefs: refs,
        now: context.now,
      },
    );

    return {
      receiptId: receipt.id,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      evidenceIds,
      replayed: false,
      signatureValid: true,
    };
  }

  async prepareCodeEvidence(
    principal: Principal,
    projectId: string,
    input: V1PrepareInput,
    context: V1PrepareContext,
  ): Promise<V1PrepareResult> {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');
    await this.authorization.requireScope(principal, projectId, SCOPE_PREPARE);

    const projectScopeKey = `project:${projectId}`;
    const principalScopeKey = `user:${principal.userId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const ticketId = String(existing.resultRefs.ticketId ?? '');
      let secret: string;
      try {
        secret = openTicketSecret(
          String(existing.resultRefs.encryptedSecret ?? ''),
          this.ticketEncryptionKey,
          JSON.stringify([projectScopeKey, principalScopeKey, ticketId, requestDigest]),
        );
      } catch {
        throw new WorkmeshError(
          V1_ERROR_CODES.INVALID_REQUEST,
          'CODE_EVIDENCE_TICKET_REPREPARE_REQUIRED',
          undefined,
          409,
        );
      }
      const expiresAt = existing.resultRefs.expiresAt
        ? new Date(existing.resultRefs.expiresAt as string)
        : new Date(0);
      return {
        ticketId,
        secret,
        expiresAt,
        evidenceId: String(existing.resultRefs.evidenceId ?? ''),
        replayed: true,
      };
    }

    const artifactSet: V1ArtifactSetSummary | null = await this.repository.findArtifactSet(
      input.artifactSetId,
    );
    if (!artifactSet || artifactSet.projectId !== projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'ARTIFACT_SET_NOT_FOUND',
        { artifactSetId: input.artifactSetId },
        404,
      );

    if (!/^[0-9a-f]{64}$/i.test(this.ticketEncryptionKey))
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'TICKET_ENCRYPTION_KEY_REQUIRED',
        undefined,
        503,
      );
    if (artifactSet.taskGeneration !== input.generation)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_STALE,
        'CODE_EVIDENCE_TICKET_STALE',
        undefined,
        409,
      );

    // 多仓/缺证据拒绝：必须存在针对该 head 的他人 APPROVED 证据。
    // projectId 必须进查询条件：同一仓库被两个项目登记时，只按仓库/PR 查会命中对方的证据，
    // 随后再比对 projectId 只会把"有证据"误判成"缺证据"。
    const approved = await this.repository.findApprovedEvidenceForHead(
      projectId,
      input.repositoryId,
      input.changeRequestId,
      input.headSha,
    );
    if (!approved || approved.projectId !== projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_MISSING,
        'CODE_EVIDENCE_MISSING',
        {
          repositoryId: input.repositoryId,
          changeRequestId: input.changeRequestId,
          headSha: input.headSha,
        },
        422,
      );

    let ticket: { ticketId: string; secret: string; expiresAt: Date };
    try {
      ticket = await this.repository.createVersionedTicket(
        {
          projectId,
          repositoryId: input.repositoryId,
          changeRequestId: input.changeRequestId,
          headSha: input.headSha,
          artifactSetId: input.artifactSetId,
          generation: input.generation,
          evidenceId: approved.id,
          now: context.now,
          expiresInMs: 15 * 60 * 1000,
        },
        (prepared) => ({
          id: context.operationId,
          projectScopeKey,
          principalScopeKey,
          key: context.idempotencyKey,
          method: context.method,
          route: context.route,
          requestDigest,
          now: context.now,
          resultRefs: {
            projectScopeKey,
            principalScopeKey,
            requestDigest,
            ticketId: prepared.ticketId,
            encryptedSecret: sealTicketSecret(
              prepared.secret,
              this.ticketEncryptionKey,
              JSON.stringify([
                projectScopeKey,
                principalScopeKey,
                prepared.ticketId,
                requestDigest,
              ]),
            ),
            expiresAt: prepared.expiresAt.toISOString(),
            evidenceId: approved.id,
          },
        }),
      );
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002')
        throw new WorkmeshError(
          V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
          'IDEMPOTENCY_CONFLICT',
          undefined,
          409,
        );
      throw error;
    }

    return {
      ticketId: ticket.ticketId,
      secret: ticket.secret,
      expiresAt: ticket.expiresAt,
      evidenceId: approved.id,
      replayed: false,
    };
  }

  async useVersionedTicket(
    principal: Principal,
    projectId: string,
    input: V1UseTicketInput,
    context: V1UseTicketContext,
  ): Promise<V1UseTicketResult> {
    await this.authorization.resolveProjectContext(principal, projectId, 'write');

    const ticket = await this.repository.findVersionedTicket(input.ticketId);
    if (!ticket || ticket.projectId !== projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'CODE_EVIDENCE_TICKET_NOT_FOUND',
        { ticketId: input.ticketId },
        404,
      );
    if (!ticket.preparedExpiresAt || ticket.preparedExpiresAt.getTime() <= context.now.getTime())
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_EXPIRED,
        'CODE_EVIDENCE_TICKET_EXPIRED',
        { ticketId: input.ticketId },
        409,
      );

    const expectedSecretHash = createHash('sha256')
      .update(Buffer.from(input.secret, 'utf8'))
      .digest('hex');
    if (ticket.preparedSecretHash !== expectedSecretHash)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_INVALID,
        'CODE_EVIDENCE_TICKET_SECRET_MISMATCH',
        { ticketId: input.ticketId },
        403,
      );

    // 版本绑定：head / artifactSet / generation 变化则拒绝旧票据，不偷偷换内容。
    // 仓库与变更请求身份由票据自身绑定，不接受客户端另行声明。
    if (ticket.headSha !== input.headSha)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_STALE,
        'CODE_EVIDENCE_TICKET_STALE',
        { ticketId: input.ticketId },
        409,
      );
    if (ticket.artifactSetId !== input.artifactSetId || ticket.generation !== input.generation)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_STALE,
        'CODE_EVIDENCE_TICKET_STALE',
        { ticketId: input.ticketId },
        409,
      );

    const consumed = await this.repository.consumeVersionedTicket(
      input.ticketId,
      projectId,
      context.now,
    );
    if (!consumed)
      throw new WorkmeshError(
        V1_ERROR_CODES.CODE_EVIDENCE_TICKET_EXPIRED,
        'CODE_EVIDENCE_TICKET_EXPIRED',
        { ticketId: input.ticketId },
        409,
      );
    return {
      evidenceId: ticket.evidenceId,
      repositoryId: ticket.repositoryId,
      changeRequestId: ticket.changeRequestId,
      headSha: ticket.headSha,
    };
  }
}

function decisionFromReceiptStatus(status: string): V1WebhookReceiveResult['decision'] {
  if (status === 'PROCESSED') return 'VALID';
  if (status === 'EVIDENCE_INVALID' || status === 'SIGNATURE_INVALID') return 'INVALID';
  return 'UNKNOWN';
}

function reasonsFromReceipt(receipt: V1WebhookReceiptRecord): string[] {
  if (receipt.status === 'SIGNATURE_INVALID') return ['SIGNATURE_INVALID'];
  if (!receipt.errorMessage) return [];
  return receipt.errorMessage.split(';').filter((reason) => reason.length > 0);
}

export type { V1WebhookReceiptRecord, V1CodeReviewEvidenceRecord, V1OperationRecord };
