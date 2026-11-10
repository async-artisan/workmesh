import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  parseJsonStrict,
  principalScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
} from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService, type V1KnowledgeAccess } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import { PrismaService } from '../prisma/prisma.service';
import { REVISION_SUMMARY_SELECT, toRevisionSnapshot } from './v1-publication.prisma-repository';
import type { V1RevisionSnapshot } from './v1-publication.service';

export type V1DocumentHistoryQuery = { limit?: number; cursor?: string | null };
export type V1DocumentHistoryPage = {
  items: V1RevisionSnapshot[];
  nextCursor: string | null;
  total: number;
  documentVersion: number;
};

type HistoryDocument = {
  id: string;
  projectId: string;
  knowledgeBaseId: string;
  currentPublishedRevisionId: string | null;
  version: number;
};
type HistoryQuery = { limit: number; cursor: string | null };
type HistoryCursor = { v: 1; key: string; documentVersion: number; beforeSeq: number };

function invalid(message = 'HISTORY_CURSOR_INVALID'): never {
  throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, message, undefined, 422);
}

function normalizeQuery(query: V1DocumentHistoryQuery): HistoryQuery {
  const limit = query.limit === undefined ? 50 : query.limit;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid('HISTORY_QUERY_INVALID');
  const cursor = query.cursor ?? null;
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 2048)) invalid();
  return { limit: Math.min(limit, 100), cursor };
}

/** The cursor binds a query, never grants permission. Authorization is resolved anew first. */
function queryKey(
  principal: Principal,
  document: HistoryDocument,
  access: V1KnowledgeAccess,
  query: HistoryQuery,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        document.id,
        document.projectId,
        document.knowledgeBaseId,
        principalScopeKey(principal),
        principal.userId,
        principal.projectId ?? null,
        principal.agentCredentialId ?? null,
        [...(principal.roleIds ?? [])].sort(),
        [...principal.scopes].sort(),
        access.knowledgeBase.authzVersion,
        [...access.permissions].sort(),
        access.canPropose,
        access.canPublish,
        query.limit,
      ]),
    )
    .digest('hex');
}

function decodeCursor(raw: string | null, key: string, documentVersion: number): number | null {
  if (raw === null) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
  let value: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) invalid();
    value = parseJsonStrict(bytes.toString('utf8'));
  } catch {
    invalid();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const cursor = value as Record<string, unknown>;
  if (
    Object.keys(cursor).sort().join(',') !== 'beforeSeq,documentVersion,key,v' ||
    cursor.v !== 1 ||
    cursor.key !== key ||
    !Number.isSafeInteger(cursor.documentVersion) ||
    (cursor.documentVersion as number) < 1 ||
    !Number.isSafeInteger(cursor.beforeSeq) ||
    (cursor.beforeSeq as number) < 1
  )
    invalid();
  if (cursor.documentVersion !== documentVersion)
    throw new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_CONFLICT,
      'HISTORY_REFRESH_REQUIRED',
      undefined,
      409,
    );
  return cursor.beforeSeq as number;
}

function encodeCursor(key: string, documentVersion: number, beforeSeq: number): string {
  const cursor: HistoryCursor = { v: 1, key, documentVersion, beforeSeq };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function visibleWhere(
  principal: Principal,
  document: HistoryDocument,
  access: V1KnowledgeAccess,
): Prisma.DocumentRevisionWhereInput {
  const scope = { documentId: document.id, projectId: document.projectId };
  if (access.canPropose || access.canPublish) return scope;
  return {
    ...scope,
    OR: [
      ...(document.currentPublishedRevisionId ? [{ id: document.currentPublishedRevisionId }] : []),
      { createdById: principal.userId },
      {
        reviewRequests: { some: { approvalSlots: { some: { requiredUserId: principal.userId } } } },
      },
    ],
  };
}

/** Bounded metadata reads; legacy complete-history endpoints retain their existing contract. */
@Injectable()
export class V1DocumentHistoryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  private read<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return work(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async context(tx: Prisma.TransactionClient, principal: Principal, documentId: string) {
    const document = await tx.knowledgeDocument.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        projectId: true,
        knowledgeBaseId: true,
        currentPublishedRevisionId: true,
        version: true,
      },
    });
    if (!document)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DOCUMENT_NOT_FOUND',
        undefined,
        404,
      );
    const access = await this.authorization.resolveKnowledgeAccess(
      principal,
      document.knowledgeBaseId,
      V1AuthorizationPrismaRepository.forTransaction(tx),
    );
    if (!access.isActiveMember || !access.canRead || access.projectId !== document.projectId)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'KNOWLEDGE_NOT_READABLE',
        undefined,
        404,
      );
    return { document, access, where: visibleWhere(principal, document, access) };
  }

  async list(
    principal: Principal,
    documentId: string,
    input: V1DocumentHistoryQuery = {},
  ): Promise<V1DocumentHistoryPage> {
    const query = normalizeQuery(input);
    return this.read(async (tx) => {
      const { document, access, where } = await this.context(tx, principal, documentId);
      const key = queryKey(principal, document, access, query);
      const beforeSeq = decodeCursor(query.cursor, key, document.version);
      const total = await tx.documentRevision.count({ where });
      const rows = await tx.documentRevision.findMany({
        where: { ...where, ...(beforeSeq === null ? {} : { seq: { lt: beforeSeq } }) },
        orderBy: { seq: 'desc' },
        take: query.limit + 1,
        select: REVISION_SUMMARY_SELECT,
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => toRevisionSnapshot(row, document)),
        nextCursor:
          rows.length > query.limit
            ? encodeCursor(key, document.version, page[page.length - 1]!.seq)
            : null,
        total,
        documentVersion: document.version,
      };
    });
  }

  async metadata(
    principal: Principal,
    documentId: string,
    revisionId: string,
  ): Promise<V1RevisionSnapshot> {
    return this.read(async (tx) => {
      const { document, where } = await this.context(tx, principal, documentId);
      const row = await tx.documentRevision.findFirst({
        where: { AND: [where, { id: revisionId }] },
        select: REVISION_SUMMARY_SELECT,
      });
      if (!row)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'REVISION_NOT_FOUND',
          undefined,
          404,
        );
      return toRevisionSnapshot(row, document);
    });
  }
}
