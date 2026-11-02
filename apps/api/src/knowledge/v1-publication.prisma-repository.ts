import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient as V1PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  V1CreateDocumentResult,
  V1DocumentView,
  V1ProposeRevisionResult,
  V1PublicationRepository,
  V1RequirementBinding,
  V1RevisionView,
  V1ListDocumentsQuery,
} from './v1-publication.service';
import type { DocumentKind, RevisionState, V1AcceptanceItem, V1DeliveryScope } from './v1-publication-policy';

type V1TransactionClient = Omit<
  V1PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return message.includes('40001') || message.includes('40P01') || message.includes('could not serialize');
}

function toRevisionView(
  revision: {
    id: string;
    documentId: string;
    projectId: string;
    seq: number;
    title: string;
    mimeType: string;
    byteLength: number;
    sha256: string;
    bodyBytes: Uint8Array;
    createdById: string;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: Prisma.JsonValue;
    acceptance: Prisma.JsonValue;
  },
  document: { knowledgeBaseId: string; currentPublishedRevisionId: string | null },
): V1RevisionView {
  return {
    id: revision.id,
    documentId: revision.documentId,
    knowledgeBaseId: document.knowledgeBaseId,
    projectId: revision.projectId,
    seq: revision.seq,
    title: revision.title,
    mimeType: revision.mimeType,
    byteLength: revision.byteLength,
    digest: revision.sha256,
    state: (document.currentPublishedRevisionId === revision.id ? 'PUBLISHED' : 'CANDIDATE') as RevisionState,
    bodyBytes: revision.bodyBytes,
    createdBy: revision.createdById,
    basisUnderstandingRevisionId: revision.basisUnderstandingRevisionId,
    deliveryScope: (revision.deliveryScope as V1DeliveryScope | null) ?? null,
    acceptance: (revision.acceptance as V1AcceptanceItem[] | null) ?? null,
  };
}

function documentView(document: {
  id: string;
  projectId: string;
  knowledgeBaseId: string;
  requirementId: string | null;
  kind: string;
  version: number;
  currentPublishedRevisionId: string | null;
  archivedAt: Date | null;
}): V1DocumentView {
  return {
    id: document.id,
    projectId: document.projectId,
    knowledgeBaseId: document.knowledgeBaseId,
    requirementId: document.requirementId,
    kind: document.kind as DocumentKind,
    version: document.version,
    currentPublishedRevisionId: document.currentPublishedRevisionId,
    archivedAt: document.archivedAt,
  };
}

function encodeCursor(value: { updatedAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify({ t: value.updatedAt.toISOString(), i: value.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { updatedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { t?: unknown; i?: unknown };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') throw new Error('bad cursor');
    const updatedAt = new Date(parsed.t);
    if (Number.isNaN(updatedAt.getTime())) throw new Error('bad cursor');
    return { updatedAt, id: parsed.i };
  } catch {
    throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'cursor 无效', undefined, 422);
  }
}

@Injectable()
export class V1PublicationPrismaRepository implements V1PublicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findDocument(documentId: string): Promise<V1DocumentView | null> {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        projectId: true,
        knowledgeBaseId: true,
        requirementId: true,
        kind: true,
        version: true,
        currentPublishedRevisionId: true,
        archivedAt: true,
      },
    });
    return document ? documentView(document) : null;
  }

  async findRevision(revisionId: string): Promise<V1RevisionView | null> {
    const revision = await this.prisma.documentRevision.findUnique({
      where: { id: revisionId },
      include: { document: { select: { knowledgeBaseId: true, currentPublishedRevisionId: true } } },
    });
    return revision ? toRevisionView(revision, revision.document) : null;
  }

  async listRevisions(documentId: string): Promise<V1RevisionView[]> {
    const document = await this.prisma.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: { knowledgeBaseId: true, currentPublishedRevisionId: true },
    });
    if (!document) return [];
    const revisions = await this.prisma.documentRevision.findMany({
      where: { documentId },
      orderBy: { seq: 'desc' },
    });
    return revisions.map((revision) => toRevisionView(revision, document));
  }

  async isAssignedReviewer(revisionId: string, userId: string): Promise<boolean> {
    const slot = await this.prisma.approvalSlot.findFirst({
      where: { reviewRequest: { documentRevisionId: revisionId }, requiredUserId: userId },
      select: { id: true },
    });
    return Boolean(slot);
  }

  async findRequirement(requirementId: string): Promise<V1RequirementBinding | null> {
    const requirement = await this.prisma.requirement.findUnique({
      where: { id: requirementId },
      select: {
        id: true,
        projectId: true,
        currentUnderstandingRevisionId: true,
        currentPrdRevisionId: true,
      },
    });
    return requirement;
  }

  async findKnowledgeBaseProjectId(knowledgeBaseId: string): Promise<string | null> {
    const knowledgeBase = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: { projectId: true },
    });
    return knowledgeBase?.projectId ?? null;
  }

  async projectRoleIds(projectId: string): Promise<string[]> {
    const roles = await this.prisma.projectRole.findMany({
      where: { projectId },
      select: { id: true },
    });
    return roles.map((role) => role.id);
  }

  async listDocuments(
    projectId: string,
    query: V1ListDocumentsQuery,
  ): Promise<{ items: V1DocumentView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const where: Prisma.KnowledgeDocumentWhereInput = {
      projectId,
      archivedAt: null,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.q
        ? { revisions: { some: { title: { contains: query.q, mode: 'insensitive' } } } }
        : {}),
      ...(cursor
        ? {
            OR: [
              { updatedAt: { lt: cursor.updatedAt } },
              { updatedAt: { equals: cursor.updatedAt }, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.knowledgeDocument.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        projectId: true,
        knowledgeBaseId: true,
        requirementId: true,
        kind: true,
        version: true,
        currentPublishedRevisionId: true,
        archivedAt: true,
        updatedAt: true,
      },
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(documentView),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
    };
  }

  async createDocument(input: {
    projectId: string;
    knowledgeBaseId: string;
    kind: DocumentKind;
    requirementId: string | null;
    title: string;
    mimeType: string;
    bodyBytes: Uint8Array;
    createdBy: string;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: V1DeliveryScope | null;
    acceptance: V1AcceptanceItem[] | null;
    reviewKind: string;
  }): Promise<V1CreateDocumentResult> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`);
          const knowledgeBase = await tx.knowledgeBase.findUnique({
            where: { id: input.knowledgeBaseId },
            select: { projectId: true, archivedAt: true, publicationApproverUserId: true, publicationApproverRoleId: true },
          });
          if (!knowledgeBase || knowledgeBase.projectId !== input.projectId || knowledgeBase.archivedAt)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'KNOWLEDGE_BASE_NOT_FOUND', { knowledgeBaseId: input.knowledgeBaseId }, 404);

          const bytes = Buffer.from(input.bodyBytes);
          const digest = createHash('sha256').update(bytes).digest('hex');

          const document = await tx.knowledgeDocument.create({
            data: {
              projectId: input.projectId,
              knowledgeBaseId: input.knowledgeBaseId,
              requirementId: input.requirementId,
              kind: input.kind,
              nextRevisionSeq: 2,
            },
            select: {
              id: true,
              projectId: true,
              knowledgeBaseId: true,
              requirementId: true,
              kind: true,
              version: true,
              currentPublishedRevisionId: true,
              archivedAt: true,
            },
          });

          const revision = await tx.documentRevision.create({
            data: {
              projectId: input.projectId,
              documentId: document.id,
              seq: 1,
              title: input.title,
              mimeType: input.mimeType,
              bodyBytes: bytes,
              byteLength: bytes.byteLength,
              sha256: digest,
              createdById: input.createdBy,
              basisUnderstandingRevisionId: input.basisUnderstandingRevisionId,
              deliveryScope: (input.deliveryScope ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              acceptance: (input.acceptance ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            },
          });

          const review = await this.createReviewWithSlots(tx, {
            projectId: input.projectId,
            kind: input.reviewKind,
            revisionId: revision.id,
            subjectDigest: digest,
            approverUserId: knowledgeBase.publicationApproverUserId,
            approverRoleId: knowledgeBase.publicationApproverRoleId,
          });

          return {
            document: documentView(document),
            revision: toRevisionView(revision, { knowledgeBaseId: input.knowledgeBaseId, currentPublishedRevisionId: null }),
            reviewRequestId: review.id,
            reviewKind: input.reviewKind,
            slots: review.slots,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async proposeRevision(input: {
    document: V1DocumentView;
    title: string;
    mimeType: string;
    bodyBytes: Uint8Array;
    createdBy: string;
    basisUnderstandingRevisionId: string | null;
    deliveryScope: V1DeliveryScope | null;
    acceptance: V1AcceptanceItem[] | null;
    reviewKind: string;
  }): Promise<V1ProposeRevisionResult> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.document.projectId}::uuid FOR UPDATE`);
          const document = await tx.knowledgeDocument.findUnique({
            where: { id: input.document.id },
            select: {
              id: true,
              projectId: true,
              knowledgeBaseId: true,
              nextRevisionSeq: true,
              version: true,
              archivedAt: true,
              knowledgeBase: {
                select: { publicationApproverUserId: true, publicationApproverRoleId: true },
              },
            },
          });
          if (!document || document.archivedAt)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId: input.document.id }, 404);

          const bytes = Buffer.from(input.bodyBytes);
          const digest = createHash('sha256').update(bytes).digest('hex');

          const revision = await tx.documentRevision.create({
            data: {
              projectId: document.projectId,
              documentId: document.id,
              seq: document.nextRevisionSeq,
              title: input.title,
              mimeType: input.mimeType,
              bodyBytes: bytes,
              byteLength: bytes.byteLength,
              sha256: digest,
              createdById: input.createdBy,
              basisUnderstandingRevisionId: input.basisUnderstandingRevisionId,
              deliveryScope: (input.deliveryScope ?? Prisma.JsonNull) as Prisma.InputJsonValue,
              acceptance: (input.acceptance ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            },
          });

          const bumped = await tx.knowledgeDocument.updateMany({
            where: { id: document.id, version: document.version },
            data: { version: { increment: 1 }, nextRevisionSeq: { increment: 1 } },
          });
          if (bumped.count !== 1)
            throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'VERSION_CONFLICT', { documentId: document.id }, 409);

          const review = await this.createReviewWithSlots(tx, {
            projectId: document.projectId,
            kind: input.reviewKind,
            revisionId: revision.id,
            subjectDigest: digest,
            approverUserId: document.knowledgeBase.publicationApproverUserId,
            approverRoleId: document.knowledgeBase.publicationApproverRoleId,
          });

          return {
            revision: toRevisionView(revision, {
              knowledgeBaseId: document.knowledgeBaseId,
              currentPublishedRevisionId: null,
            }),
            reviewRequestId: review.id,
            reviewKind: input.reviewKind,
            slots: review.slots,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async restoreRevision(input: {
    document: V1DocumentView;
    sourceRevisionId: string;
    title: string | null;
    createdBy: string;
    reviewKind: string;
  }): Promise<V1ProposeRevisionResult> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.document.projectId}::uuid FOR UPDATE`);
          const document = await tx.knowledgeDocument.findUnique({
            where: { id: input.document.id },
            select: {
              id: true,
              projectId: true,
              knowledgeBaseId: true,
              nextRevisionSeq: true,
              version: true,
              archivedAt: true,
              knowledgeBase: {
                select: { publicationApproverUserId: true, publicationApproverRoleId: true },
              },
            },
          });
          if (!document || document.archivedAt)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId: input.document.id }, 404);

          const source = await tx.documentRevision.findUnique({ where: { id: input.sourceRevisionId } });
          if (!source || source.documentId !== document.id)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'REVISION_NOT_FOUND', { revisionId: input.sourceRevisionId }, 404);

          const revision = await tx.documentRevision.create({
            data: {
              projectId: document.projectId,
              documentId: document.id,
              seq: document.nextRevisionSeq,
              title: input.title ?? source.title,
              mimeType: source.mimeType,
              bodyBytes: source.bodyBytes,
              byteLength: source.byteLength,
              sha256: source.sha256,
              createdById: input.createdBy,
              basisUnderstandingRevisionId: source.basisUnderstandingRevisionId,
              deliveryScope: source.deliveryScope ?? Prisma.JsonNull,
              acceptance: source.acceptance ?? Prisma.JsonNull,
            },
          });

          const bumped = await tx.knowledgeDocument.updateMany({
            where: { id: document.id, version: document.version },
            data: { version: { increment: 1 }, nextRevisionSeq: { increment: 1 } },
          });
          if (bumped.count !== 1)
            throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'VERSION_CONFLICT', { documentId: document.id }, 409);

          const review = await this.createReviewWithSlots(tx, {
            projectId: document.projectId,
            kind: input.reviewKind,
            revisionId: revision.id,
            subjectDigest: source.sha256,
            approverUserId: document.knowledgeBase.publicationApproverUserId,
            approverRoleId: document.knowledgeBase.publicationApproverRoleId,
          });

          return {
            revision: toRevisionView(revision, {
              knowledgeBaseId: document.knowledgeBaseId,
              currentPublishedRevisionId: null,
            }),
            reviewRequestId: review.id,
            reviewKind: input.reviewKind,
            slots: review.slots,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async withdraw(input: {
    document: V1DocumentView;
    expectedVersion: number;
    reason: string;
    ticket: { id: string; secretHash: string; webSessionId: string };
    actorUserId: string;
    now: Date;
  }): Promise<{ documentVersion: number; publicationId: string }> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.document.projectId}::uuid FOR UPDATE`);
          const document = await tx.knowledgeDocument.findUnique({
            where: { id: input.document.id },
            select: { id: true, projectId: true, version: true, currentPublishedRevisionId: true },
          });
          if (!document)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_FOUND', { documentId: input.document.id }, 404);
          if (document.version !== input.expectedVersion)
            throw new WorkmeshError(
              V1_ERROR_CODES.VERSION_CONFLICT,
              'VERSION_CONFLICT',
              { documentId: document.id, expectedVersion: input.expectedVersion, currentVersion: document.version },
              409,
            );
          if (!document.currentPublishedRevisionId)
            throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'DOCUMENT_NOT_PUBLISHED', { documentId: document.id }, 409);

          const consumed = await tx.$executeRaw(
            Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
              SET "consumedAt" = ${input.now}, "consumedRequestId" = gen_random_uuid()
              WHERE "id" = ${input.ticket.id}::uuid
                AND "secretHash" = ${input.ticket.secretHash}
                AND "webSessionId" = ${input.ticket.webSessionId}::uuid
                AND "consumedAt" IS NULL
                AND "invalidatedAt" IS NULL
                AND "expiresAt" > ${input.now}`,
          );
          if (consumed !== 1)
            throw new WorkmeshError(V1_ERROR_CODES.CONFIRMATION_USED, 'CONFIRMATION_CONSUME_CONFLICT', { ticketId: input.ticket.id }, 409);

          const publication = await tx.documentPublication.create({
            data: {
              projectId: document.projectId,
              documentId: document.id,
              revisionId: document.currentPublishedRevisionId,
              kind: 'WITHDRAW',
              reason: input.reason,
            },
          });

          const updated = await tx.$executeRaw(
            Prisma.sql`UPDATE "workmesh_v1"."KnowledgeDocument"
              SET "version" = "version" + 1,
                  "currentPublishedRevisionId" = NULL,
                  "updatedAt" = now()
              WHERE "id" = ${document.id}::uuid
                AND "version" = ${document.version}
                AND "currentPublishedRevisionId" = ${document.currentPublishedRevisionId}::uuid`,
          );
          if (updated !== 1)
            throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'WITHDRAW_CONFLICT', { documentId: document.id }, 409);

          // 撤回当前已确认理解/PRD 时同步清空需求指针并提升 generation，旧基线与旧认领立即失效。
          await tx.$executeRaw(
            Prisma.sql`UPDATE "workmesh_v1"."Requirement"
              SET "version" = "version" + 1,
                  "generation" = "generation" + 1,
                  "currentUnderstandingRevisionId" = CASE
                    WHEN "currentUnderstandingRevisionId" = ${document.currentPublishedRevisionId}::uuid THEN NULL
                    ELSE "currentUnderstandingRevisionId" END,
                  "currentPrdRevisionId" = CASE
                    WHEN "currentPrdRevisionId" = ${document.currentPublishedRevisionId}::uuid THEN NULL
                    ELSE "currentPrdRevisionId" END,
                  "deliveryScope" = CASE
                    WHEN "currentPrdRevisionId" = ${document.currentPublishedRevisionId}::uuid THEN NULL
                    ELSE "deliveryScope" END,
                  "updatedAt" = now()
              WHERE "projectId" = ${document.projectId}::uuid
                AND (
                  "currentUnderstandingRevisionId" = ${document.currentPublishedRevisionId}::uuid
                  OR "currentPrdRevisionId" = ${document.currentPublishedRevisionId}::uuid
                )`,
          );

          await tx.auditEvent.create({
            data: {
              projectId: document.projectId,
              actorStampId: null,
              action: 'KNOWLEDGE_WITHDRAW',
              targetType: 'KNOWLEDGE_DOCUMENT',
              targetId: document.id,
              targetVersion: document.version,
              outcome: 'SUCCESS',
              details: { reason: input.reason, revisionId: document.currentPublishedRevisionId },
            },
          });

          return { documentVersion: document.version + 1, publicationId: publication.id };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async createReviewWithSlots(
    tx: V1TransactionClient,
    input: {
      projectId: string;
      kind: string;
      revisionId: string;
      subjectDigest: string;
      approverUserId: string;
      approverRoleId: string | null;
    },
  ): Promise<{
    id: string;
    slots: Array<{ id: string; slotKey: string; requiredUserId: string; requiredRoleId: string | null }>;
  }> {
    const review = await tx.reviewRequest.create({
      data: {
        projectId: input.projectId,
        kind: input.kind as never,
        documentRevisionId: input.revisionId,
        subjectDigest: input.subjectDigest,
      },
    });
    const slot = await tx.approvalSlot.create({
      data: {
        projectId: input.projectId,
        reviewRequestId: review.id,
        slotKey: 'publication',
        kind: input.kind,
        requiredUserId: input.approverUserId,
        requiredRoleId: input.approverRoleId,
      },
    });
    return {
      id: review.id,
      slots: [
        {
          id: slot.id,
          slotKey: slot.slotKey,
          requiredUserId: slot.requiredUserId ?? '',
          requiredRoleId: slot.requiredRoleId,
        },
      ],
    };
  }

  private async runWithRetry<T>(run: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await run();
      } catch (error) {
        const code = (error as { code?: string })?.code;
        const retryableSerialization = isRetryable(error);
        // 只有纯数据库序列化冲突重试；业务 409/404 等不重试，避免重复意图。
        if (!retryableSerialization || code === V1_ERROR_CODES.VERSION_CONFLICT || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }
}
