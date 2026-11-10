import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { createHash, randomBytes } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { readCodeEvidenceDiagnosticsInTransaction } from '../tasks/v1-code-evidence-diagnostics.reader';
import { codeEvidenceReviewReasons } from '../tasks/v1-code-evidence-provenance';
import {
  Prisma,
  type CodeReviewEvidence,
  type WebhookReceipt,
} from '../../../node_modules/.prisma/workmesh-v1-client';

import {
  type V1ArtifactSetSummary,
  type V1CodeEvidenceTarget,
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

  async assertCodeEvidenceTarget(input: V1CodeEvidenceTarget): Promise<void> {
    await this.prisma.$transaction((tx) => assertCodeEvidenceTargetInTransaction(tx, input), {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  }

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
    const row = await this.prisma.webhookReceipt
      .upsert({
        where: { source_deliveryId: { source: input.source, deliveryId: input.deliveryId } },
        update: {},
        create: {
          projectId: input.projectId,
          source: input.source,
          eventType: input.eventType,
          deliveryId: input.deliveryId,
          signatureValid: input.signatureValid,
          payloadDigest: input.payloadDigest,
          status: 'PENDING',
        },
      })
      .catch(async (error: unknown) => {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
          throw error;
        // Prisma may emulate an empty-update upsert with a read followed by an
        // insert. Return the winning immutable receipt when those inserts race.
        return this.prisma.webhookReceipt.findUniqueOrThrow({
          where: { source_deliveryId: { source: input.source, deliveryId: input.deliveryId } },
        });
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

  async completeReceipt(
    receiptId: string,
    status: string,
    errorMessage: string | null,
    operation: V1PersistIdempotencyInput,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const repository = new V1GithubEvidencePrismaRepository(tx as PrismaService);
      await repository.persistIdempotency(operation);
      await repository.recordReceiptProcessed(receiptId, status, errorMessage);
    });
  }

  async findEvidenceByFingerprint(
    projectId: string,
    fingerprint: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    const row = await this.prisma.codeReviewEvidence.findFirst({
      where: { projectId, evidenceFingerprint: fingerprint },
    });
    return row ? this.toEvidence(row) : null;
  }

  async recordEvidence(input: V1RecordEvidenceInput): Promise<V1CodeReviewEvidenceRecord> {
    // 去重键是 (projectId, evidenceFingerprint)。这里不依赖 Prisma 生成的复合唯一键 API，
    // 而是「先查后建 + 冲突回读」：并发下的 P2002 由数据库唯一索引兜住，语义与 upsert 等价，
    // 同时不必在业务代码里绑定索引名。
    const where = { projectId: input.projectId, evidenceFingerprint: input.evidenceFingerprint };
    const existing = await this.prisma.codeReviewEvidence.findFirst({ where });
    if (existing) return this.toEvidence(existing);

    try {
      const created = await this.prisma.codeReviewEvidence.create({
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
      return this.toEvidence(created);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
        throw error;
      // 并发写入的失败者回读赢家那一行，仍然返回同一条证据。
      const winner = await this.prisma.codeReviewEvidence.findFirstOrThrow({ where });
      return this.toEvidence(winner);
    }
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
    projectId: string,
    repositoryId: string,
    changeRequestId: string,
    headSha: string,
  ): Promise<V1CodeReviewEvidenceRecord | null> {
    const rows = await this.prisma.codeReviewEvidence.findMany({
      where: { projectId, repositoryId, changeRequestId, preparedSecretHash: null },
      include: {
        receipt: { select: { projectId: true, source: true, signatureValid: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 1001,
    });
    if (rows.length > 1000) return null;
    const reviews = rows.map((row) => ({
      ...row,
      receipt:
        row.receipt?.projectId === projectId && row.receipt.source === 'GITHUB'
          ? row.receipt
          : null,
    }));
    const row = reviews.find(
      (item) =>
        item.headSha === headSha &&
        codeEvidenceReviewReasons(item, reviews, { repositoryId, headSha }).length === 0,
    );
    return row ? this.toEvidence(row) : null;
  }

  async createVersionedTicket(
    input: V1CreateVersionedTicketInput,
    operation: (ticket: {
      ticketId: string;
      secret: string;
      expiresAt: Date;
    }) => V1PersistIdempotencyInput,
  ): Promise<{ ticketId: string; secret: string; expiresAt: Date }> {
    const secret = randomBytes(32).toString('hex');
    const secretHash = createHash('sha256').update(Buffer.from(secret, 'utf8')).digest('hex');
    const expiresAt = new Date(input.now.getTime() + input.expiresInMs);
    const ticketNonce = randomBytes(16).toString('hex');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );
        await assertCodeEvidenceTargetInTransaction(tx, input);
        const row = await tx.codeReviewEvidence.create({
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
            reviewExternalId: `ticket:${ticketNonce}`,
            artifactSetId: input.artifactSetId,
            evidenceFingerprint: createHash('sha256')
              .update(
                Buffer.from(
                  JSON.stringify([
                    'ticket',
                    input.projectId,
                    input.repositoryId,
                    input.changeRequestId,
                    input.artifactSetId,
                    input.headSha,
                    input.generation,
                    ticketNonce,
                  ]),
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
        const ticket = { ticketId: row.id, secret, expiresAt };
        const op = operation(ticket);
        // A competing prepare must never replace the winner's replay secret.
        // A unique-key failure rolls back this ticket as well as the operation.
        await tx.idempotentOperation.create({
          data: {
            id: op.id,
            projectId: input.projectId,
            projectScopeKey: op.projectScopeKey,
            principalScopeKey: op.principalScopeKey,
            key: op.key,
            method: op.method,
            route: op.route,
            requestDigest: op.requestDigest,
            resultRefs: op.resultRefs as Prisma.InputJsonValue,
            responseMetadata: {},
            committedAt: op.now,
          },
        });
        return ticket;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async findVersionedTicket(ticketId: string): Promise<V1VersionedTicketRecord | null> {
    const row = await this.prisma.codeReviewEvidence.findUnique({ where: { id: ticketId } });
    if (!row) return null;
    return {
      id: row.id,
      evidenceId: row.preparedEvidenceId ?? '',
      projectId: row.projectId,
      repositoryId: row.repositoryId,
      changeRequestId: row.changeRequestId,
      headSha: row.headSha,
      artifactSetId: row.artifactSetId ?? '',
      generation: row.ticketGeneration ?? 0,
      preparedSecretHash: row.preparedSecretHash,
      preparedExpiresAt: row.preparedExpiresAt,
    };
  }

  async consumeVersionedTicket(ticketId: string, projectId: string, now: Date): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
        );
        const ticket = await tx.codeReviewEvidence.findFirst({
          where: {
            id: ticketId,
            projectId,
            preparedSecretHash: { not: null },
            preparedExpiresAt: { gt: now },
          },
        });
        if (
          !ticket?.artifactSetId ||
          !ticket.preparedEvidenceId ||
          ticket.ticketGeneration === null
        )
          return false;
        await assertCodeEvidenceTargetInTransaction(tx, {
          projectId,
          artifactSetId: ticket.artifactSetId,
          generation: ticket.ticketGeneration,
          repositoryId: ticket.repositoryId,
          changeRequestId: ticket.changeRequestId,
          headSha: ticket.headSha,
          evidenceId: ticket.preparedEvidenceId,
        });
        const result = await tx.codeReviewEvidence.updateMany({
          where: { id: ticketId, projectId, preparedExpiresAt: { gt: now } },
          data: { preparedExpiresAt: null },
        });
        return result.count === 1;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
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

async function assertCodeEvidenceTargetInTransaction(
  tx: Prisma.TransactionClient,
  input: V1CodeEvidenceTarget,
): Promise<void> {
  const diagnostics = await readCodeEvidenceDiagnosticsInTransaction(
    tx,
    input.projectId,
    input.artifactSetId,
  );
  const reference = diagnostics?.references.find(
    (row) =>
      row.repository?.externalId === input.repositoryId &&
      row.repository.identityMode === 'PROVIDER' &&
      row.repository.adapter?.toUpperCase() === 'GITHUB' &&
      !row.repository.archived &&
      row.commitSha === input.headSha,
  );
  if (
    !diagnostics?.complete ||
    diagnostics.currentBinding !== 'CURRENT' ||
    diagnostics.taskGeneration !== input.generation ||
    !reference
  )
    throw new WorkmeshError(
      V1_ERROR_CODES.CODE_EVIDENCE_TICKET_STALE,
      'CODE_EVIDENCE_TARGET_MISMATCH',
      { artifactSetId: input.artifactSetId },
      409,
    );
  if (
    !reference.reviews.some(
      (row) =>
        row.changeRequestId === input.changeRequestId &&
        row.headSha === input.headSha &&
        row.reasons.length === 0 &&
        (!input.evidenceId || row.id === input.evidenceId),
    )
  )
    throw new WorkmeshError(
      V1_ERROR_CODES.CODE_EVIDENCE_MISSING,
      'CODE_EVIDENCE_PROVENANCE_INVALID',
      { artifactSetId: input.artifactSetId },
      422,
    );
}
