import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import { PrismaService } from '../prisma/prisma.service';
import type { DocumentKind } from './v1-publication-policy';
import type { V1DocumentView } from './v1-publication.service';
import {
  decodeSummaryCursor,
  encodeSummaryCursor,
  normalizeSummaryQuery,
  SUMMARY_DOCUMENT_KINDS,
  SUMMARY_KNOWLEDGE_BASE_KINDS,
  summaryCountSql,
  summaryId,
  summaryOverviewSql,
  summaryPageSql,
  summaryQueryKey,
  summarySingletonSql,
  type SummaryContext,
  type SummaryKnowledgeBaseKind,
  type V1DocumentSummaryQuery,
} from './v1-document-summary.query';

export type V1DocumentSummaryRevision = {
  id: string;
  documentId: string;
  seq: number;
  title: string;
  digest: string;
  state: 'CANDIDATE' | 'PUBLISHED';
};
export type V1DocumentSummary = {
  document: V1DocumentView;
  updatedAt: Date;
  knowledgeBase: { id: string; name: string; kind: string };
  requirement: { id: string; code: string; title: string } | null;
  latestVisibleRevision: V1DocumentSummaryRevision | null;
  publishedRevision: V1DocumentSummaryRevision | null;
  visibleRevisionCount: number;
  candidateRevisionCount: number;
};
export type V1DocumentSummaryPage = {
  items: V1DocumentSummary[];
  nextCursor: string | null;
  total: number;
};
export type V1DocumentSummaryOverview = {
  total: number;
  totalsByDocumentKind: Record<DocumentKind, number>;
  collections: Array<{
    knowledgeBaseKind: SummaryKnowledgeBaseKind;
    knowledgeBaseCount: number;
    documentCount: number;
    recentItems: V1DocumentSummary[];
  }>;
};

type SummaryRow = V1DocumentView & {
  updatedAt: Date;
  knowledgeBaseName: string;
  knowledgeBaseKind: string;
  readableRequirementId: string | null;
  requirementCode: string | null;
  requirementTitle: string | null;
  latestVisibleRevision: V1DocumentSummaryRevision | null;
  publishedRevision: V1DocumentSummaryRevision | null;
  invalidPublication: boolean;
  visibleRevisionCount: bigint;
  candidateRevisionCount: bigint;
};
type OverviewRow = { documentKind: string; knowledgeBaseKind: string; count: bigint };

function notFound(message: string): never {
  throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, message, undefined, 404);
}

function exactCount(value: bigint): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Document summary count exceeds JSON integer range');
  return count;
}

function summaryItem(row: SummaryRow): V1DocumentSummary {
  if (row.invalidPublication)
    throw new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_CONFLICT,
      'DOCUMENT_SUMMARY_REFRESH_REQUIRED',
      undefined,
      409,
    );
  return {
    document: {
      id: row.id,
      projectId: row.projectId,
      knowledgeBaseId: row.knowledgeBaseId,
      requirementId: row.requirementId,
      kind: row.kind,
      version: row.version,
      currentPublishedRevisionId: row.currentPublishedRevisionId,
      archivedAt: row.archivedAt,
    },
    updatedAt: row.updatedAt,
    knowledgeBase: {
      id: row.knowledgeBaseId,
      name: row.knowledgeBaseName,
      kind: row.knowledgeBaseKind,
    },
    requirement:
      row.readableRequirementId !== null
        ? {
            id: row.readableRequirementId,
            code: row.requirementCode!,
            title: row.requirementTitle!,
          }
        : null,
    latestVisibleRevision: row.latestVisibleRevision,
    publishedRevision: row.publishedRevision,
    visibleRevisionCount: exactCount(row.visibleRevisionCount),
    candidateRevisionCount: exactCount(row.candidateRevisionCount),
  };
}

function emptyOverview(): V1DocumentSummaryOverview {
  return {
    total: 0,
    totalsByDocumentKind: { UNDERSTANDING: 0, DECISION: 0, PRD: 0, KNOWLEDGE: 0 },
    collections: SUMMARY_KNOWLEDGE_BASE_KINDS.map((knowledgeBaseKind) => ({
      knowledgeBaseKind,
      knowledgeBaseCount: 0,
      documentCount: 0,
      recentItems: [],
    })),
  };
}

/** Additive bounded projections. Legacy document endpoints keep their complete-array contract. */
@Injectable()
export class V1DocumentSummaryService {
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

  private async context(
    tx: Prisma.TransactionClient,
    principal: Principal,
    projectId: string,
    knowledgeBaseId?: string,
  ): Promise<SummaryContext> {
    const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
    const project = await this.authorization.resolveProjectContext(
      principal,
      projectId,
      'read',
      repository,
    );
    const bases = await tx.knowledgeBase.findMany({
      where: { projectId, ...(knowledgeBaseId ? { id: knowledgeBaseId } : {}) },
      select: { id: true, name: true, kind: true },
      orderBy: { id: 'asc' },
    });
    const knowledgeBases: SummaryContext['knowledgeBases'] = [];
    for (const base of bases) {
      const access = await this.authorization.resolveKnowledgeAccess(
        principal,
        base.id,
        repository,
      );
      if (access.isActiveMember && access.canRead && access.projectId === projectId)
        knowledgeBases.push({ ...base, access });
    }
    return {
      projectId,
      principal,
      project,
      knowledgeBases,
      canReadRequirement:
        principal.kind !== 'AGENT' || principal.scopes.includes('requirement:read'),
    };
  }

  async list(
    principal: Principal,
    rawProjectId: string,
    input: V1DocumentSummaryQuery = {},
  ): Promise<V1DocumentSummaryPage> {
    const projectId = summaryId(rawProjectId);
    const query = normalizeSummaryQuery(input);
    return this.read(async (tx) => {
      const context = await this.context(tx, principal, projectId);
      const key = summaryQueryKey(context, query);
      // Even a now-empty permission set cannot reuse a cursor from its earlier grants.
      const boundary = decodeSummaryCursor(query.cursor, key);
      if (!context.knowledgeBases.length) return { items: [], nextCursor: null, total: 0 };
      const counts = await tx.$queryRaw<Array<{ total: bigint }>>(summaryCountSql(context, query));
      const total = exactCount(counts[0]!.total);
      const rows = await tx.$queryRaw<SummaryRow[]>(summaryPageSql(context, query, boundary));
      const page = rows.slice(0, query.limit);
      const items = page.map(summaryItem);
      const last = page[page.length - 1];
      return {
        items,
        nextCursor:
          rows.length > query.limit && last
            ? encodeSummaryCursor(key, { updatedAt: last.updatedAt.toISOString(), id: last.id })
            : null,
        total,
      };
    });
  }

  async summary(principal: Principal, rawDocumentId: string): Promise<V1DocumentSummary> {
    const documentId = summaryId(rawDocumentId);
    return this.read(async (tx) => {
      const document = await tx.knowledgeDocument.findUnique({
        where: { id: documentId },
        select: { projectId: true, knowledgeBaseId: true },
      });
      if (!document) notFound('DOCUMENT_NOT_FOUND');
      const context = await this.context(
        tx,
        principal,
        document.projectId,
        document.knowledgeBaseId,
      );
      if (!context.knowledgeBases.length) notFound('KNOWLEDGE_NOT_READABLE');
      const rows = await tx.$queryRaw<SummaryRow[]>(summarySingletonSql(context, documentId));
      if (!rows[0]) notFound('DOCUMENT_NOT_FOUND');
      return summaryItem(rows[0]);
    });
  }

  async overview(principal: Principal, rawProjectId: string): Promise<V1DocumentSummaryOverview> {
    const projectId = summaryId(rawProjectId);
    return this.read(async (tx) => {
      const context = await this.context(tx, principal, projectId);
      const result = emptyOverview();
      if (!context.knowledgeBases.length) return result;
      const counts = await tx.$queryRaw<OverviewRow[]>(summaryOverviewSql(context));
      for (const row of counts) {
        const count = exactCount(row.count);
        result.total += count;
        if ((SUMMARY_DOCUMENT_KINDS as readonly string[]).includes(row.documentKind))
          result.totalsByDocumentKind[row.documentKind as DocumentKind] += count;
        const collection = result.collections.find(
          (item) => item.knowledgeBaseKind === row.knowledgeBaseKind,
        );
        if (collection) collection.documentCount += count;
      }
      for (const collection of result.collections) {
        collection.knowledgeBaseCount = context.knowledgeBases.filter(
          (base) => base.kind === collection.knowledgeBaseKind,
        ).length;
        if (!collection.documentCount) continue;
        const query = normalizeSummaryQuery({
          knowledgeBaseKind: collection.knowledgeBaseKind,
          limit: 2,
        });
        const rows = await tx.$queryRaw<SummaryRow[]>(summaryPageSql(context, query, null, 2));
        collection.recentItems = rows.map(summaryItem);
      }
      return result;
    });
  }
}
