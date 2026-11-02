import { Inject, Injectable } from '@nestjs/common';
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
  repositoryId: string;
  changeRequestId: string;
  headSha: string;
  reviewerExternalId: string;
  reviewExternalId: string;
  state: string;
  commitSha: string | null;
};

export function evidenceFingerprintOf(parts: V1EvidenceFingerprintParts): string {
  const canonical = JSON.stringify({
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

    await this.authorization.resolveProjectContext(principal, projectId);
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
      if (duplicate.payloadDigest !== payloadDigest)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'WEBHOOK_REPLAY_CONFLICT',
          { receiptId: duplicate.id },
          409,
        );
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

    const receipt = await this.repository.recordReceipt({
      projectId,
      source: 'GITHUB',
      eventType: input.eventType,
      deliveryId: input.deliveryId,
      signatureValid: true,
      payloadDigest,
    });

    const evaluation = evaluateCodeEvidenceSet(input.repositories);
    const evidenceIds: string[] = [];
    for (const repo of input.repositories) {
      for (const review of repo.reviews) {
        const fingerprint = evidenceFingerprintOf({
          repositoryId: repo.repositoryId,
          changeRequestId: repo.changeRequestId,
          headSha: repo.changeRequestHeadSha ?? '',
          reviewerExternalId: review.reviewerId,
          reviewExternalId: review.reviewId,
          state: review.state,
          commitSha: review.commitSha,
        });
        const prior = await this.repository.findEvidenceByFingerprint(fingerprint);
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
    await this.repository.recordReceiptProcessed(
      receipt.id,
      status,
      evaluation.reasons.join(';') || null,
    );
    await this.persistOperation(context, {
      projectScopeKey,
      principalScopeKey,
      requestDigest,
      receiptId: receipt.id,
      decision: evaluation.decision,
      reasons: evaluation.reasons,
      evidenceIds,
      signatureValid: true,
    });

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
    await this.authorization.resolveProjectContext(principal, projectId);
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
      const secret = String(existing.resultRefs.secret ?? '');
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

    // 多仓/缺证据拒绝：必须存在针对该 head 的他人 APPROVED 证据。
    const approved = await this.repository.findApprovedEvidenceForHead(
      input.repositoryId,
      input.changeRequestId,
      input.headSha,
    );
    if (!approved)
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

    const ticket = await this.repository.createVersionedTicket({
      projectId,
      repositoryId: input.repositoryId,
      changeRequestId: input.changeRequestId,
      headSha: input.headSha,
      artifactSetId: input.artifactSetId,
      generation: input.generation,
      evidenceId: approved.id,
      now: context.now,
      expiresInMs: 15 * 60 * 1000,
    });

    await this.persistOperation(context, {
      projectScopeKey,
      principalScopeKey,
      requestDigest,
      ticketId: ticket.ticketId,
      secret: ticket.secret,
      expiresAt: ticket.expiresAt.toISOString(),
      evidenceId: approved.id,
    });

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
    await this.authorization.resolveProjectContext(principal, projectId);

    const ticket = await this.repository.findVersionedTicket(input.ticketId);
    if (!ticket)
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

    await this.repository.consumeVersionedTicket(input.ticketId, context.now);
    return {
      evidenceId: ticket.evidenceId,
      repositoryId: ticket.repositoryId,
      changeRequestId: ticket.changeRequestId,
      headSha: ticket.headSha,
    };
  }

  private async persistOperation(
    context: V1WebhookReceiveContext,
    refs: Record<string, unknown>,
  ): Promise<void> {
    // 幂等写由仓储在同一事务内完成；服务层仅负责构造 resultRefs 语义。
    // 这里通过仓储暴露的轻量落盘入口持久化操作记录，保证重放一致性。
    await this.repository.persistIdempotency({
      id: context.operationId,
      projectScopeKey: refs.projectScopeKey as string,
      principalScopeKey: refs.principalScopeKey as string,
      key: context.idempotencyKey,
      method: context.method,
      route: context.route,
      requestDigest: refs.requestDigest as string,
      resultRefs: refs,
      now: context.now,
    });
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
