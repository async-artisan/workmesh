import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type PrismaClient as V1PrismaClient,
} from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import { searchExcerptOf } from './v1-knowledge-base-policy';
import type {
  V1KnowledgeBaseAccessView,
  V1KnowledgeBaseGrantView,
  V1KnowledgeBaseRepository,
  V1KnowledgeBaseSearchItem,
  V1KnowledgeBaseView,
  V1KnowledgeMemberRecord,
  V1KnowledgeProjectRoleRecord,
} from './v1-knowledge-base.repository';

type V1TransactionClient = Omit<
  V1PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];
const SEARCH_BATCH = 100;
const SEARCH_MAX_SCAN = 1000;

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === 'P2002';
}

function cursorError(): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'CURSOR_INVALID', undefined, 400);
}

function knowledgeBaseNotFound(knowledgeBaseId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    'KNOWLEDGE_BASE_NOT_FOUND',
    { knowledgeBaseId },
    404,
  );
}

function projectNotFound(projectId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    'PROJECT_NOT_FOUND',
    { projectId },
    404,
  );
}

function keyConflict(projectId: string, key: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_CONFLICT,
    'KNOWLEDGE_BASE_KEY_CONFLICT',
    { projectId, key },
    409,
  );
}

function versionConflict(input: {
  knowledgeBaseId: string;
  expectedVersion: number;
  expectedAuthzVersion: number;
}): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'VERSION_CONFLICT', { ...input }, 409);
}

type KnowledgeBaseRow = {
  id: string;
  projectId: string;
  key: string;
  name: string;
  visibility: 'PROJECT' | 'RESTRICTED';
  version: number;
  authzVersion: number;
  publicationApproverUserId: string;
  publicationApproverRoleId: string | null;
  archivedAt: Date | null;
};

type GrantRow = {
  id: string;
  subjectKind: 'USER' | 'ROLE';
  subjectUserId: string | null;
  subjectRoleId: string | null;
  permissions: string[];
  version: number;
  grantedAt: Date;
  revokedAt: Date | null;
};

function knowledgeBaseView(row: KnowledgeBaseRow): V1KnowledgeBaseView {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    name: row.name,
    visibility: row.visibility,
    version: row.version,
    authzVersion: row.authzVersion,
    publicationApproverUserId: row.publicationApproverUserId,
    publicationApproverRoleId: row.publicationApproverRoleId,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function grantView(row: GrantRow): V1KnowledgeBaseGrantView {
  return {
    id: row.id,
    subjectKind: row.subjectKind,
    subjectUserId: row.subjectUserId,
    subjectRoleId: row.subjectRoleId,
    permissions: row.permissions,
    version: row.version,
    grantedAt: row.grantedAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
  };
}

function encodeListCursor(
  row: { createdAt: Date; id: string },
  binding: { projectId: string; management: boolean; principalUserId: string },
): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      k: 'kb-list',
      t: row.createdAt.toISOString(),
      i: row.id,
      p: binding.projectId,
      m: binding.management,
      u: binding.principalUserId,
    }),
    'utf8',
  ).toString('base64url');
}

function decodeListCursor(
  cursor: string,
  binding: { projectId: string; management: boolean; principalUserId: string },
): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      k?: unknown;
      t?: unknown;
      i?: unknown;
      p?: unknown;
      m?: unknown;
      u?: unknown;
    };
    if (
      parsed.v !== 1 ||
      parsed.k !== 'kb-list' ||
      typeof parsed.t !== 'string' ||
      typeof parsed.i !== 'string' ||
      parsed.p !== binding.projectId ||
      parsed.m !== binding.management ||
      parsed.u !== binding.principalUserId
    )
      throw cursorError();
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) throw cursorError();
    return { createdAt, id: parsed.i };
  } catch (error) {
    if (error instanceof WorkmeshError) throw error;
    throw cursorError();
  }
}

function encodeSearchCursor(documentId: string, knowledgeBaseId: string, q: string): string {
  return Buffer.from(
    JSON.stringify({ v: 1, k: 'kb-search', i: documentId, kb: knowledgeBaseId, q }),
    'utf8',
  ).toString('base64url');
}

function decodeSearchCursor(cursor: string, knowledgeBaseId: string, q: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      v?: unknown;
      k?: unknown;
      i?: unknown;
      kb?: unknown;
      q?: unknown;
    };
    if (
      parsed.v !== 1 ||
      parsed.k !== 'kb-search' ||
      typeof parsed.i !== 'string' ||
      parsed.kb !== knowledgeBaseId ||
      parsed.q !== q
    )
      throw cursorError();
    return parsed.i;
  } catch (error) {
    if (error instanceof WorkmeshError) throw error;
    throw cursorError();
  }
}

@Injectable()
export class V1KnowledgeBasePrismaRepository implements V1KnowledgeBaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createKnowledgeBase(input: {
    projectId: string;
    key: string;
    name: string;
    visibility: 'PROJECT' | 'RESTRICTED';
    creatorUserId: string;
    now: Date;
    operation: {
      id: string;
      projectScopeKey: string;
      principalScopeKey: string;
      key: string;
      method: string;
      route: string;
      requestDigest: string;
    };
  }): Promise<V1KnowledgeBaseView> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          await this.lockProject(tx, input.projectId);
          const member = await tx.projectMember.findUnique({
            where: {
              projectId_userId: { projectId: input.projectId, userId: input.creatorUserId },
            },
            select: { role: true, revokedAt: true },
          });
          if (!member || member.revokedAt || (member.role !== 'OWNER' && member.role !== 'ADMIN'))
            throw projectNotFound(input.projectId);

          const duplicate = await tx.knowledgeBase.findUnique({
            where: { projectId_key: { projectId: input.projectId, key: input.key } },
            select: { id: true },
          });
          if (duplicate) throw keyConflict(input.projectId, input.key);

          const created = await tx.knowledgeBase.create({
            data: {
              projectId: input.projectId,
              key: input.key,
              name: input.name,
              visibility: input.visibility,
              publicationApproverUserId: input.creatorUserId,
            },
            select: this.knowledgeBaseSelect(),
          });

          await tx.knowledgeBaseGrant.create({
            data: {
              projectId: input.projectId,
              knowledgeBaseId: created.id,
              subjectKind: 'USER',
              subjectUserId: input.creatorUserId,
              permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
              grantedAt: input.now,
            },
          });

          const view = knowledgeBaseView(created);
          await tx.auditEvent.create({
            data: {
              projectId: input.projectId,
              actorStampId: null,
              action: 'KNOWLEDGE_BASE_CREATE',
              targetType: 'KNOWLEDGE_BASE',
              targetId: created.id,
              targetVersion: created.version,
              outcome: 'SUCCESS',
              details: { key: input.key, visibility: input.visibility },
            },
          });
          await tx.idempotentOperation.create({
            data: {
              id: input.operation.id,
              projectId: input.projectId,
              projectScopeKey: input.operation.projectScopeKey,
              principalScopeKey: input.operation.principalScopeKey,
              key: input.operation.key,
              method: input.operation.method,
              route: input.operation.route,
              requestDigest: input.operation.requestDigest,
              resultRefs: { knowledgeBase: { ...view } },
              responseMetadata: {},
              committedAt: input.now,
            },
          });

          return view;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async listKnowledgeBases(
    projectId: string,
    query: { limit: number; cursor: string | null; management: boolean; principalUserId: string },
  ): Promise<{ items: V1KnowledgeBaseView[]; nextCursor: string | null; hasMore: boolean }> {
    const binding = {
      projectId,
      management: query.management,
      principalUserId: query.principalUserId,
    };
    const cursor = query.cursor ? decodeListCursor(query.cursor, binding) : null;
    const rows = await this.prisma.knowledgeBase.findMany({
      where: {
        projectId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: { ...this.knowledgeBaseSelect(), createdAt: true },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(knowledgeBaseView),
      nextCursor:
        rows.length > query.limit ? encodeListCursor(page[page.length - 1]!, binding) : null,
      hasMore: rows.length > query.limit,
    };
  }

  async findKnowledgeBase(knowledgeBaseId: string): Promise<V1KnowledgeBaseView | null> {
    const row = await this.prisma.knowledgeBase.findUnique({
      where: { id: knowledgeBaseId },
      select: this.knowledgeBaseSelect(),
    });
    return row ? knowledgeBaseView(row) : null;
  }

  async listAccessGrants(knowledgeBaseId: string): Promise<V1KnowledgeBaseGrantView[]> {
    const rows = await this.prisma.knowledgeBaseGrant.findMany({
      where: { knowledgeBaseId },
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
      select: this.grantSelect(),
    });
    return rows.map(grantView);
  }

  async replaceAccess(input: {
    knowledgeBaseId: string;
    expectedVersion: number;
    expectedAuthzVersion: number;
    visibility: 'PROJECT' | 'RESTRICTED';
    publicationApproverUserId: string;
    publicationApproverRoleId: string | null;
    grants: Array<{
      subjectKind: 'USER' | 'ROLE';
      subjectUserId: string | null;
      subjectRoleId: string | null;
      permissions: Array<'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE'>;
    }>;
    reason: string;
    actorUserId: string;
    ticket: { id: string; secretHash: string; webSessionId: string };
    operation: {
      id: string;
      projectScopeKey: string;
      principalScopeKey: string;
      key: string;
      method: string;
      route: string;
      requestDigest: string;
    };
    now: Date;
  }): Promise<V1KnowledgeBaseAccessView> {
    return this.runWithRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const located = await tx.knowledgeBase.findUnique({
            where: { id: input.knowledgeBaseId },
            select: { projectId: true },
          });
          if (!located) throw knowledgeBaseNotFound(input.knowledgeBaseId);

          await this.lockProject(tx, located.projectId);

          // 项目锁释放后必须重读，避免以锁前的旧版本做 CAS。
          const current = await tx.knowledgeBase.findUnique({
            where: { id: input.knowledgeBaseId },
            select: this.knowledgeBaseSelect(),
          });
          if (!current) throw knowledgeBaseNotFound(input.knowledgeBaseId);

          const bumped = await tx.knowledgeBase.updateMany({
            where: {
              id: input.knowledgeBaseId,
              version: input.expectedVersion,
              authzVersion: input.expectedAuthzVersion,
            },
            data: {
              visibility: input.visibility,
              publicationApproverUserId: input.publicationApproverUserId,
              publicationApproverRoleId: input.publicationApproverRoleId,
              version: { increment: 1 },
              authzVersion: { increment: 1 },
            },
          });
          if (bumped.count !== 1)
            throw versionConflict({
              knowledgeBaseId: input.knowledgeBaseId,
              expectedVersion: input.expectedVersion,
              expectedAuthzVersion: input.expectedAuthzVersion,
            });

          // 撤销全部现有活动 grant，保留历史行，再追加本次集合。
          await tx.knowledgeBaseGrant.updateMany({
            where: { knowledgeBaseId: input.knowledgeBaseId, revokedAt: null },
            data: { revokedAt: input.now, version: { increment: 1 } },
          });

          for (const grant of input.grants) {
            await tx.knowledgeBaseGrant.create({
              data: {
                projectId: located.projectId,
                knowledgeBaseId: input.knowledgeBaseId,
                subjectKind: grant.subjectKind,
                subjectUserId: grant.subjectUserId,
                subjectRoleId: grant.subjectRoleId,
                permissions: grant.permissions,
                grantedAt: input.now,
              },
            });
          }

          const consumed = await tx.$executeRaw(
            Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
              SET "consumedAt" = ${input.now}, "consumedRequestId" = gen_random_uuid(), "consumedOperationId" = ${input.operation.id}::uuid
              WHERE "id" = ${input.ticket.id}::uuid
                AND "secretHash" = ${input.ticket.secretHash}
                AND "webSessionId" = ${input.ticket.webSessionId}::uuid
                AND "consumedAt" IS NULL
                AND "invalidatedAt" IS NULL
                AND "expiresAt" > ${input.now}`,
          );
          if (consumed !== 1)
            throw new WorkmeshError(
              V1_ERROR_CODES.CONFIRMATION_USED,
              'CONFIRMATION_CONSUME_CONFLICT',
              { ticketId: input.ticket.id },
              409,
            );

          const grants = (
            await tx.knowledgeBaseGrant.findMany({
              where: { knowledgeBaseId: input.knowledgeBaseId },
              orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
              select: this.grantSelect(),
            })
          ).map(grantView);

          const view: V1KnowledgeBaseAccessView = {
            knowledgeBaseId: input.knowledgeBaseId,
            projectId: located.projectId,
            visibility: input.visibility,
            version: input.expectedVersion + 1,
            authzVersion: input.expectedAuthzVersion + 1,
            publicationApproverUserId: input.publicationApproverUserId,
            publicationApproverRoleId: input.publicationApproverRoleId,
            grants,
          };

          await tx.auditEvent.create({
            data: {
              projectId: located.projectId,
              actorStampId: null,
              action: 'KB_ACCESS_REPLACE',
              targetType: 'KNOWLEDGE_BASE',
              targetId: input.knowledgeBaseId,
              targetVersion: input.expectedVersion,
              outcome: 'SUCCESS',
              details: {
                visibility: input.visibility,
                publicationApproverUserId: input.publicationApproverUserId,
                publicationApproverRoleId: input.publicationApproverRoleId,
                grantCount: input.grants.length,
                authzVersion: view.authzVersion,
                reason: input.reason,
              },
            },
          });
          await tx.idempotentOperation.create({
            data: {
              id: input.operation.id,
              projectId: located.projectId,
              projectScopeKey: input.operation.projectScopeKey,
              principalScopeKey: input.operation.principalScopeKey,
              key: input.operation.key,
              method: input.operation.method,
              route: input.operation.route,
              requestDigest: input.operation.requestDigest,
              resultRefs: {
                access: {
                  knowledgeBaseId: view.knowledgeBaseId,
                  projectId: view.projectId,
                  visibility: view.visibility,
                  version: view.version,
                  authzVersion: view.authzVersion,
                  publicationApproverUserId: view.publicationApproverUserId,
                  publicationApproverRoleId: view.publicationApproverRoleId,
                  grants: view.grants.map((grant) => ({
                    id: grant.id,
                    subjectKind: grant.subjectKind,
                    subjectUserId: grant.subjectUserId,
                    subjectRoleId: grant.subjectRoleId,
                    permissions: grant.permissions,
                    version: grant.version,
                    grantedAt: grant.grantedAt,
                    revokedAt: grant.revokedAt,
                  })),
                },
              },
              responseMetadata: {},
              committedAt: input.now,
            },
          });

          return view;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async searchKnowledgeBase(input: {
    knowledgeBaseId: string;
    q: string;
    limit: number;
    cursor: string | null;
  }): Promise<{
    items: V1KnowledgeBaseSearchItem[];
    nextCursor: string | null;
    hasMore: boolean;
    truncated: boolean;
  }> {
    let afterId = input.cursor
      ? decodeSearchCursor(input.cursor, input.knowledgeBaseId, input.q)
      : null;
    let lastIncludedId: string | null = null;
    const items: V1KnowledgeBaseSearchItem[] = [];
    let scanned = 0;
    let hasMore: boolean;
    let truncated = false;

    for (;;) {
      const rows = await this.prisma.knowledgeDocument.findMany({
        where: {
          knowledgeBaseId: input.knowledgeBaseId,
          archivedAt: null,
          currentPublishedRevisionId: { not: null },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: SEARCH_BATCH + 1,
        select: { id: true, currentPublishedRevisionId: true },
      });
      const page = rows.slice(0, SEARCH_BATCH);
      const more = rows.length > SEARCH_BATCH;
      if (page.length === 0) {
        hasMore = false;
        break;
      }

      const revisionIds = page
        .map((row) => row.currentPublishedRevisionId)
        .filter((id): id is string => typeof id === 'string');
      const revisions = revisionIds.length
        ? await this.prisma.documentRevision.findMany({
            where: { id: { in: revisionIds } },
            select: { id: true, documentId: true, title: true, sha256: true, bodyBytes: true },
          })
        : [];
      const revisionsById = new Map(revisions.map((revision) => [revision.id, revision]));

      for (const row of page) {
        afterId = row.id;
        scanned += 1;
        const revision = row.currentPublishedRevisionId
          ? revisionsById.get(row.currentPublishedRevisionId)
          : null;
        if (!revision || revision.documentId !== row.id) continue;
        const excerpt = searchExcerptOf(revision.title, revision.bodyBytes, input.q);
        if (excerpt === null) continue;
        items.push({
          revisionId: revision.id,
          documentId: revision.documentId,
          title: revision.title,
          excerpt,
          sha256: revision.sha256,
        });
        if (items.length > input.limit) break;
        lastIncludedId = row.id;
      }

      if (items.length > input.limit) {
        hasMore = true;
        break;
      }
      if (!more) {
        hasMore = false;
        break;
      }
      if (scanned >= SEARCH_MAX_SCAN) {
        truncated = true;
        hasMore = true;
        break;
      }
    }

    return {
      items: items.slice(0, input.limit),
      nextCursor:
        hasMore && (lastIncludedId ?? afterId)
          ? encodeSearchCursor((lastIncludedId ?? afterId)!, input.knowledgeBaseId, input.q)
          : null,
      hasMore,
      truncated,
    };
  }

  async findMember(projectId: string, userId: string): Promise<V1KnowledgeMemberRecord | null> {
    return this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { projectId: true, userId: true, role: true, revokedAt: true },
    });
  }

  async findProjectRoles(
    projectId: string,
    roleIds: readonly string[],
  ): Promise<V1KnowledgeProjectRoleRecord[]> {
    if (roleIds.length === 0) return [];
    return this.prisma.projectRole.findMany({
      where: { projectId, id: { in: [...roleIds] } },
      select: { id: true, projectId: true, isActive: true },
    });
  }

  private knowledgeBaseSelect() {
    return {
      id: true,
      projectId: true,
      key: true,
      name: true,
      visibility: true,
      version: true,
      authzVersion: true,
      publicationApproverUserId: true,
      publicationApproverRoleId: true,
      archivedAt: true,
    } as const;
  }

  private grantSelect() {
    return {
      id: true,
      subjectKind: true,
      subjectUserId: true,
      subjectRoleId: true,
      permissions: true,
      version: true,
      grantedAt: true,
      revokedAt: true,
    } as const;
  }

  private async lockProject(tx: V1TransactionClient, projectId: string): Promise<void> {
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
    );
  }

  private async runWithRetry<T>(run: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await run();
      } catch (error) {
        if (isUniqueViolation(error))
          throw new WorkmeshError(
            V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
            'IDEMPOTENCY_CONFLICT',
            undefined,
            409,
          );
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }
}
