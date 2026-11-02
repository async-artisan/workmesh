import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'node:crypto';
import {
  Prisma,
  type CodeReviewEvidence,
  type WebhookReceipt,
} from '../../../node_modules/.prisma/workmesh-v1-client';

import {
  type V1ArtifactSetSummary,
  type V1CodeReviewEvidenceRecord,
  type V1CreateVersionedTicketInput,
  type V1GithubEvidenceRepository,
  type V1PersistIdempotencyInput,
  type V1RecordEvidenceInput,
  type V1RecordReceiptInput,
  type V1VersionedTicketRecord,
  type V1WebhookReceiptRecord,
} from './v1-github-evidence.repository';

@Injectable()
export class V1GithubEvidencePrismaRepository implements V1GithubEvidenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findReceiptByDelivery(
    source: 'GITHUB',
    deliveryId: string,
  ): Promise<V1WebhookReceiptRecord | null> {
    const row = await this.prisma.webhookReceipt.findUnique({
      where: { source_deliveryId: { source, deliveryId } },
    });
    if (!row) return null;
    return this.toReceipt(row);
  }

  async recordReceipt(input: V1RecordReceiptInput): Promise<V1WebhookReceiptRecord> {
    const row = await this.prisma.webhookReceipt.create({
      data: {
        projectId: input.projectId,
        source: input.source,
        eventType: input.eventType,
        deliveryId: input.deliveryId,
        signatureValid: input.signatureValid,
        payloadDigest: input.payloadDigest,
        status: 'PENDING',
      },
    });
    return this.toReceipt(row);
  }

  async recordReceiptProcessed(
    receiptId: string,
    status: string,
    errorMessage: string | null,
  ): Promise<void> {
    await this.prisma.webhookReceipt.update({
      where: { id: receiptId },
      data: { status, errorMessage, processedAt: new Date() },
    });
  }

  async findEvidenceIdsByReceipt(receiptId: string): Promise<string[]> {
    const rows = await this.prisma.codeReviewEvidence.findMany({
      where: { receiptId },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async findEvidenceByFingerprint(fingerprint: string): Promise<V1CodeReviewEvidenceRecord | null> {
    const row = await this.prisma.codeReviewEvidence.findUnique({
      where: { evidenceFingerprint: fingerprint },
    });
    return row ? this.toEvidence(row) : null;
  }

  async recordEvidence(input: V1RecordEvidenceInput): Promise<V1CodeReviewEvidenceRecord> {
    const row = await this.prisma.codeReviewEvidence.create({
      data: {
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        changeRequestId: input.changeRequestId,
        headSha: input.headSha,
        authorExternalId: input.authorExternalId,
        reviewerExternalId: input.reviewerExternalId,
        reviewerKind: input.reviewerKind,
        state: input.state,
        commitSha: input.commitSha,
        submittedAt: input.submittedAt,
        reviewExternalId: input.reviewExternalId,
        artifactSetId: input.artifactSetId,
        evidenceFingerprint: input.evidenceFingerprint,
        receiptId: input.receiptId,
      },
    });
    return this.toEvidence(row);
  }

  async findArtifactSet(id: string): Promise<V1ArtifactSetSummary | null> {
    const row = await this.prisma.artifactSet.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.projectId,
      taskGeneration: row.taskGeneration,
      manifestDigest: row.manifestDigest,
    };
  }

  async findApprovedEvidenceForHead(
    repositoryId: string,
    changeRequestId: string,
    headSha: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    const row = await this.prisma.codeReviewEvidence.findFirst({
      where: { repositoryId, changeRequestId, headSha, state: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toEvidence(row) : null;
  }

  async createVersionedTicket(
    input: V1CreateVersionedTicketInput,
  ): Promise<{ ticketId: string; secret: string; expiresAt: Date }> {
    const secret = randomBytes(32).toString('hex');
    const secretHash = createHash('sha256').update(Buffer.from(secret, 'utf8')).digest('hex');
    const expiresAt = new Date(input.now.getTime() + input.expiresInMs);
    const row = await this.prisma.codeReviewEvidence.create({
      data: {
        projectId: input.projectId,
        repositoryId: input.repositoryId,
        changeRequestId: input.changeRequestId,
        headSha: input.headSha,
        authorExternalId: '_ticket',
        reviewerExternalId: '_ticket',
        reviewerKind: 'USER',
        state: 'PENDING',
        commitSha: input.headSha,
        submittedAt: input.now,
        reviewExternalId: `ticket:${randomBytes(8).toString('hex')}`,
        artifactSetId: input.artifactSetId,
        evidenceFingerprint: createHash('sha256')
          .update(
            Buffer.from(
              `ticket:${input.artifactSetId}:${input.headSha}:${input.generation}`,
              'utf8',
            ),
          )
          .digest('hex'),
        preparedSecretHash: secretHash,
        preparedExpiresAt: expiresAt,
        preparedEvidenceId: input.evidenceId,
        ticketGeneration: input.generation,
      },
    });
    return { ticketId: row.id, secret, expiresAt };
  }

  async findVersionedTicket(ticketId: string): Promise<V1VersionedTicketRecord | null> {
    const row = await this.prisma.codeReviewEvidence.findUnique({ where: { id: ticketId } });
    if (!row) return null;
    return {
      id: row.id,
      evidenceId: row.preparedEvidenceId ?? '',
      repositoryId: row.repositoryId,
      changeRequestId: row.changeRequestId,
      headSha: row.headSha,
      artifactSetId: row.artifactSetId ?? '',
      generation: row.ticketGeneration ?? 0,
      preparedSecretHash: row.preparedSecretHash,
      preparedExpiresAt: row.preparedExpiresAt,
    };
  }

  async consumeVersionedTicket(ticketId: string, _now: Date): Promise<void> {
    await this.prisma.codeReviewEvidence.update({
      where: { id: ticketId },
      data: { preparedExpiresAt: null },
    });
  }

  async persistIdempotency(input: V1PersistIdempotencyInput): Promise<void> {
    await this.prisma.idempotentOperation.upsert({
      where: {
        projectScopeKey_principalScopeKey_key: {
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.key,
        },
      },
      create: {
        id: input.id,
        projectId: input.projectScopeKey.startsWith('project:')
          ? input.projectScopeKey.slice('project:'.length)
          : null,
        projectScopeKey: input.projectScopeKey,
        principalScopeKey: input.principalScopeKey,
        key: input.key,
        method: input.method,
        route: input.route,
        requestDigest: input.requestDigest,
        resultRefs: input.resultRefs as Prisma.InputJsonValue,
        responseMetadata: {},
      },
      update: { resultRefs: input.resultRefs as Prisma.InputJsonValue, responseMetadata: {} },
    });
  }

  private toReceipt(row: WebhookReceipt): V1WebhookReceiptRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      source: row.source,
      eventType: row.eventType,
      deliveryId: row.deliveryId,
      signatureValid: row.signatureValid,
      payloadDigest: row.payloadDigest,
      receivedAt: row.receivedAt,
      processedAt: row.processedAt,
      status: row.status,
      errorMessage: row.errorMessage,
    };
  }

  private toEvidence(row: CodeReviewEvidence): V1CodeReviewEvidenceRecord {
    return {
      id: row.id,
      projectId: row.projectId,
      repositoryId: row.repositoryId,
      changeRequestId: row.changeRequestId,
      headSha: row.headSha,
      authorExternalId: row.authorExternalId,
      reviewerExternalId: row.reviewerExternalId,
      reviewerKind: row.reviewerKind,
      state: row.state,
      commitSha: row.commitSha,
      submittedAt: row.submittedAt,
      reviewExternalId: row.reviewExternalId,
      artifactSetId: row.artifactSetId,
      evidenceFingerprint: row.evidenceFingerprint,
      receiptId: row.receiptId,
      createdAt: row.createdAt,
    };
  }
}
