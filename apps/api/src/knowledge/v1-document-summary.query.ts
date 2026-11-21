import { createHash } from 'node:crypto';
import {
  parseJsonStrict,
  principalScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
} from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { V1KnowledgeAccess, V1ProjectContext } from '../auth/v1-authorization';
import { isUuidShaped } from '../common/v1-idempotency';
import type { DocumentKind } from './v1-publication-policy';
import { documentRevisionVisibilityPolicy } from './v1-document-visibility';
import { javascriptLowercaseFieldSql } from './v1-document-summary.case-fold';

export const SUMMARY_DOCUMENT_KINDS = ['UNDERSTANDING', 'DECISION', 'PRD', 'KNOWLEDGE'] as const;
export const SUMMARY_KNOWLEDGE_BASE_KINDS = ['BUSINESS', 'SYSTEM', 'PRACTICE'] as const;
export type SummaryKnowledgeBaseKind = (typeof SUMMARY_KNOWLEDGE_BASE_KINDS)[number];
export type V1DocumentSummaryQuery = {
  kind?: string;
  knowledgeBaseKind?: string;
  requirementId?: string;
  status?: string;
  q?: string;
  searchProfile?: string;
  limit?: number;
  cursor?: string | null;
};
export type NormalizedSummaryQuery = {
  kind: DocumentKind | null;
  knowledgeBaseKind: SummaryKnowledgeBaseKind | null;
  requirementId: string | null;
  status: 'all' | 'candidate' | 'published';
  q: string;
  searchProfile: 'knowledge' | 'prd';
  limit: number;
  cursor: string | null;
};
export type SummaryKnowledgeBase = {
  id: string;
  name: string;
  kind: string;
  access: V1KnowledgeAccess;
};
export type SummaryContext = {
  projectId: string;
  principal: Principal;
  project: V1ProjectContext;
  knowledgeBases: SummaryKnowledgeBase[];
  canReadRequirement: boolean;
};
export type SummaryBoundary = { updatedAt: string; id: string };

export function summaryQueryInvalid(message = 'DOCUMENT_SUMMARY_QUERY_INVALID'): never {
  throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, message, undefined, 422);
}

export function summaryId(value: unknown): string {
  if (!isUuidShaped(value)) summaryQueryInvalid('DOCUMENT_SUMMARY_ID_INVALID');
  return value.toLowerCase();
}

export function normalizeSummaryQuery(input: V1DocumentSummaryQuery): NormalizedSummaryQuery {
  const keys = [
    'kind',
    'knowledgeBaseKind',
    'requirementId',
    'status',
    'q',
    'searchProfile',
    'limit',
    'cursor',
  ];
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    summaryQueryInvalid();
  if (
    input.kind !== undefined &&
    !(SUMMARY_DOCUMENT_KINDS as readonly unknown[]).includes(input.kind)
  )
    summaryQueryInvalid();
  if (
    input.knowledgeBaseKind !== undefined &&
    !(SUMMARY_KNOWLEDGE_BASE_KINDS as readonly unknown[]).includes(input.knowledgeBaseKind)
  )
    summaryQueryInvalid();
  const status = input.status === undefined ? 'all' : input.status;
  if (status !== 'all' && status !== 'candidate' && status !== 'published') summaryQueryInvalid();
  const searchProfile = input.searchProfile === undefined ? 'knowledge' : input.searchProfile;
  if (searchProfile !== 'knowledge' && searchProfile !== 'prd') summaryQueryInvalid();
  if (searchProfile === 'prd' && input.kind !== undefined && input.kind !== 'PRD')
    summaryQueryInvalid();
  if (
    input.q !== undefined &&
    (typeof input.q !== 'string' || input.q.length > 100 || input.q.includes('\u0000'))
  )
    summaryQueryInvalid();
  const limit = input.limit === undefined ? 50 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1) summaryQueryInvalid();
  const cursor = input.cursor === undefined ? null : input.cursor;
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 2048))
    summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  return {
    kind: (input.kind ?? (searchProfile === 'prd' ? 'PRD' : null)) as DocumentKind | null,
    knowledgeBaseKind: (input.knowledgeBaseKind ?? null) as SummaryKnowledgeBaseKind | null,
    requirementId: input.requirementId === undefined ? null : summaryId(input.requirementId),
    status,
    q: input.q?.trim().toLowerCase() ?? '',
    searchProfile,
    limit: Math.min(limit, 100),
    cursor,
  };
}

/** Permission/query binding only; this does not claim a cross-request data snapshot. */
export function summaryQueryKey(context: SummaryContext, query: NormalizedSummaryQuery): string {
  const principal = context.principal;
  return createHash('sha256')
    .update(
      JSON.stringify([
        context.projectId,
        principalScopeKey(principal),
        principal.userId,
        principal.projectId ?? null,
        principal.agentCredentialId ?? null,
        [...(principal.roleIds ?? [])].sort(),
        [...principal.scopes].sort(),
        [...context.project.activeRoleIds].sort(),
        context.project.membership.version,
        context.canReadRequirement,
        context.knowledgeBases
          .map(({ id, access }) => [
            id,
            access.knowledgeBase.authzVersion,
            [...access.permissions].sort(),
            access.isActiveMember,
            access.canRead,
            access.canPropose,
            access.canPublish,
          ])
          .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
        query.kind,
        query.knowledgeBaseKind,
        query.requirementId,
        query.status,
        query.q,
        query.searchProfile,
        query.limit,
      ]),
    )
    .digest('hex');
}

export function decodeSummaryCursor(raw: string | null, key: string): SummaryBoundary | null {
  if (raw === null) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  let value: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) throw new Error('Noncanonical cursor');
    value = parseJsonStrict(bytes.toString('utf8'));
  } catch {
    summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  const cursor = value as Record<string, unknown>;
  if (
    Object.keys(cursor).sort().join(',') !== 'id,key,updatedAt,v' ||
    cursor.v !== 1 ||
    cursor.key !== key ||
    typeof cursor.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.updatedAt) ||
    cursor.updatedAt.startsWith('0000-') ||
    !isUuidShaped(cursor.id) ||
    cursor.id !== cursor.id.toLowerCase()
  )
    summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  const date = new Date(cursor.updatedAt as string);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== cursor.updatedAt)
    summaryQueryInvalid('DOCUMENT_SUMMARY_CURSOR_INVALID');
  return { updatedAt: cursor.updatedAt as string, id: cursor.id as string };
}

export function encodeSummaryCursor(key: string, boundary: SummaryBoundary): string {
  return Buffer.from(
    JSON.stringify({ v: 1, key, updatedAt: boundary.updatedAt, id: boundary.id }),
  ).toString('base64url');
}

/** Fixed d/r aliases: same document/project and exact-user slots, irrespective of review status. */
function visibleRevision(context: SummaryContext): Prisma.Sql {
  const limited = documentRevisionVisibilityPolicy(context.principal, {
    canPropose: false,
    canPublish: false,
  });
  if (limited.mode !== 'LIMITED') throw new Error('Expected limited revision policy');
  return Prisma.sql`r."documentId" = d."id" AND r."projectId" = d."projectId" AND (
    d."allRevisions" OR r."id" = d."currentPublishedRevisionId" OR r."createdById" = ${limited.userId}::uuid OR EXISTS (
      SELECT 1 FROM "workmesh_v1"."ReviewRequest" rr
      JOIN "workmesh_v1"."ApprovalSlot" slot ON slot."reviewRequestId" = rr."id" AND slot."projectId" = rr."projectId"
      WHERE rr."documentRevisionId" = r."id" AND slot."requiredUserId" = ${limited.userId}::uuid
    )
  )`;
}

/** Only KB identifiers and current capabilities are materialized in Node, never revision rows. */
function summaryScope(context: SummaryContext, includeArchived = false): Prisma.Sql {
  const readable = context.knowledgeBases.filter(
    ({ access }) =>
      access.isActiveMember && access.canRead && access.projectId === context.projectId,
  );
  if (!readable.length)
    throw new Error('Summary SQL requires at least one readable knowledge base');
  const bases = readable.map(
    ({ id, access }) =>
      Prisma.sql`(${id}::uuid, ${documentRevisionVisibilityPolicy(context.principal, access).mode === 'ALL'}::boolean)`,
  );
  return Prisma.sql`"scope" AS (
    SELECT d."id", d."projectId", d."knowledgeBaseId", d."requirementId", d."kind", d."version",
      d."currentPublishedRevisionId", d."archivedAt", d."updatedAt", kb."name" AS "knowledgeBaseName",
      kb."kind" AS "knowledgeBaseKind", rb."allRevisions", req."id" AS "readableRequirementId",
      req."code" AS "requirementCode", req."title" AS "requirementTitle"
    FROM "workmesh_v1"."KnowledgeDocument" d
    JOIN (VALUES ${Prisma.join(bases)}) AS rb("id", "allRevisions") ON rb."id" = d."knowledgeBaseId"
    JOIN "workmesh_v1"."KnowledgeBase" kb ON kb."id" = d."knowledgeBaseId" AND kb."projectId" = d."projectId"
    LEFT JOIN "workmesh_v1"."Requirement" req ON ${context.canReadRequirement}::boolean
      AND req."id" = d."requirementId" AND req."projectId" = d."projectId"
    WHERE d."projectId" = ${context.projectId}::uuid ${includeArchived ? Prisma.empty : Prisma.sql`AND d."archivedAt" IS NULL`}
  )`;
}

function summaryFilters(context: SummaryContext, query: NormalizedSummaryQuery): Prisma.Sql {
  const filters: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (query.kind) filters.push(Prisma.sql`d."kind" = ${query.kind}`);
  if (query.knowledgeBaseKind)
    filters.push(Prisma.sql`d."knowledgeBaseKind" = ${query.knowledgeBaseKind}`);
  if (query.requirementId)
    filters.push(Prisma.sql`d."requirementId" = ${query.requirementId}::uuid`);
  if (query.status !== 'all')
    filters.push(Prisma.sql`EXISTS (
    SELECT 1 FROM "workmesh_v1"."DocumentRevision" r WHERE ${visibleRevision(context)} AND
    ${query.status === 'candidate' ? Prisma.sql`r."id" IS DISTINCT FROM d."currentPublishedRevisionId"` : Prisma.sql`r."id" = d."currentPublishedRevisionId"`}
  )`);
  if (query.q) {
    const kindText =
      query.searchProfile === 'prd'
        ? Prisma.sql`'PRD prd ' || d."kind"`
        : Prisma.sql`(CASE d."kind" WHEN 'UNDERSTANDING' THEN '理解' WHEN 'DECISION' THEN '决策' WHEN 'PRD' THEN 'PRD' WHEN 'KNOWLEDGE' THEN '知识' ELSE '' END) || ' ' || d."kind"`;
    // Preserve empty-field separators, repeated requirement text and cross-field substring matches.
    const prefix = Prisma.sql`
      ${kindText} || ' ' || COALESCE(d."requirementCode", '') || ' ' || COALESCE(d."requirementTitle", '') || ' ' ||
      (CASE WHEN d."readableRequirementId" IS NOT NULL THEN d."requirementCode" || ' · ' || d."requirementTitle" ELSE '' END)
    `;
    // Every independently folded field is joined by U+0020, which is not
    // Case_Ignorable and therefore ends Final_Sigma context. This preserves
    // whole-string JavaScript lowercase, including cross-field substring matches,
    // while avoiding the Unicode map over the entire historical aggregate.
    const searchText = Prisma.sql`${javascriptLowercaseFieldSql(prefix)} ||
      COALESCE((SELECT ' ' || string_agg(
        (${javascriptLowercaseFieldSql(Prisma.sql`r."title"`)}) || ' v' || r."seq"::text || ' ' ||
        (CASE WHEN r."id" = d."currentPublishedRevisionId" THEN 'published 已发布' ELSE 'candidate 候选' END),
        ' ' ORDER BY r."seq" DESC
      ) FROM "workmesh_v1"."DocumentRevision" r WHERE ${visibleRevision(context)}), '')
    `;
    filters.push(Prisma.sql`strpos(${searchText}, ${query.q}) > 0`);
  }
  return Prisma.join(
    filters.map((filter) => Prisma.sql`(${filter})`),
    ' AND ',
  );
}

export function summaryCountSql(
  context: SummaryContext,
  query: NormalizedSummaryQuery,
): Prisma.Sql {
  return Prisma.sql`WITH ${summaryScope(context)} SELECT count(*)::bigint AS "total" FROM "scope" d WHERE ${summaryFilters(context, query)}`;
}

function summaryProjection(context: SummaryContext): Prisma.Sql {
  return Prisma.sql`SELECT d."id", d."projectId", d."knowledgeBaseId", d."requirementId", d."kind", d."version",
    d."currentPublishedRevisionId", d."archivedAt", d."updatedAt", d."knowledgeBaseName", d."knowledgeBaseKind",
    d."readableRequirementId", d."requirementCode", d."requirementTitle",
    latest."value" AS "latestVisibleRevision",
    CASE WHEN published."id" IS NULL THEN NULL ELSE jsonb_build_object(
      'id', published."id", 'documentId', published."documentId", 'seq', published."seq", 'title', published."title",
      'digest', published."sha256", 'state', 'PUBLISHED'
    ) END AS "publishedRevision",
    (d."currentPublishedRevisionId" IS NOT NULL AND published."id" IS NULL) AS "invalidPublication",
    counts."visibleRevisionCount", counts."candidateRevisionCount"
    FROM "selected" d
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('id', r."id", 'documentId', r."documentId", 'seq', r."seq", 'title', r."title",
        'digest', r."sha256", 'state', CASE WHEN r."id" = d."currentPublishedRevisionId" THEN 'PUBLISHED' ELSE 'CANDIDATE' END) AS "value"
      FROM "workmesh_v1"."DocumentRevision" r WHERE ${visibleRevision(context)} ORDER BY r."seq" DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN "workmesh_v1"."DocumentRevision" published ON published."id" = d."currentPublishedRevisionId"
      AND published."documentId" = d."id" AND published."projectId" = d."projectId"
    CROSS JOIN LATERAL (
      SELECT count(*)::bigint AS "visibleRevisionCount", count(*) FILTER (WHERE r."id" IS DISTINCT FROM d."currentPublishedRevisionId")::bigint AS "candidateRevisionCount"
      FROM "workmesh_v1"."DocumentRevision" r WHERE ${visibleRevision(context)}
    ) counts
    ORDER BY d."updatedAt" DESC, d."id" DESC`;
}

export function summaryPageSql(
  context: SummaryContext,
  query: NormalizedSummaryQuery,
  boundary: SummaryBoundary | null,
  take = query.limit + 1,
): Prisma.Sql {
  const before = boundary
    ? Prisma.sql`AND (d."updatedAt", d."id") < (${boundary.updatedAt}::timestamptz, ${boundary.id}::uuid)`
    : Prisma.empty;
  return Prisma.sql`WITH ${summaryScope(context)}, "selected" AS MATERIALIZED (
    SELECT d.* FROM "scope" d WHERE ${summaryFilters(context, query)} ${before}
    ORDER BY d."updatedAt" DESC, d."id" DESC LIMIT ${take}
  ) ${summaryProjection(context)}`;
}

export function summarySingletonSql(context: SummaryContext, documentId: string): Prisma.Sql {
  return Prisma.sql`WITH ${summaryScope(context, true)}, "selected" AS MATERIALIZED (
    SELECT d.* FROM "scope" d WHERE d."id" = ${documentId}::uuid LIMIT 1
  ) ${summaryProjection(context)}`;
}

export function summaryOverviewSql(context: SummaryContext): Prisma.Sql {
  return Prisma.sql`WITH ${summaryScope(context)} SELECT d."kind" AS "documentKind", d."knowledgeBaseKind", count(*)::bigint AS "count"
    FROM "scope" d GROUP BY d."kind", d."knowledgeBaseKind"`;
}
