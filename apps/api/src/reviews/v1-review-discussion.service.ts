import { Injectable } from '@nestjs/common';
import {
  principalScopeKey,
  projectScopeKey,
  V1_ERROR_CODES,
  WorkmeshError,
  type Principal,
} from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import {
  assertReplayable,
  requestDigestOf,
  requireExpectedVersion,
} from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import { V1ReviewService } from './v1-review.service';
import {
  canManageDiscussion,
  decodeDiscussionCursor,
  discussionText,
  encodeDiscussionCursor,
  sameDiscussionSubject,
  type DiscussionReview,
} from './v1-review-discussion.policy';

const REVIEW_INCLUDE = {
  approvalSlots: { select: { requiredUserId: true, requiredRoleId: true } },
  documentRevision: { select: { document: { select: { id: true, knowledgeBaseId: true } } } },
} satisfies Prisma.ReviewRequestInclude;
const AUTHOR_INCLUDE = { select: { kind: true, user: { select: { id: true, email: true } } } };
const ENTRY_INCLUDE = {
  createdByStamp: AUTHOR_INCLUDE,
  addressedInReview: {
    select: {
      id: true,
      artifactSetId: true,
      documentRevisionId: true,
      subjectDigest: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ReviewDiscussionEntryInclude;
const DISCUSSION_INCLUDE = {
  createdByStamp: AUTHOR_INCLUDE,
  reviewRequest: { include: REVIEW_INCLUDE },
  entries: { include: ENTRY_INCLUDE, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 21 },
} satisfies Prisma.ReviewDiscussionInclude;
type DiscussionRow = Prisma.ReviewDiscussionGetPayload<{ include: typeof DISCUSSION_INCLUDE }>;
type EntryRow = Prisma.ReviewDiscussionEntryGetPayload<{ include: typeof ENTRY_INCLUDE }>;

export type DiscussionMutation =
  | { kind: 'CREATE'; title: string; body: string }
  | {
      kind: 'REPLY' | 'RESOLVED' | 'REOPENED';
      discussionId: string;
      expectedVersion: number;
      body: string;
      addressedInReviewId?: string | null;
    };
export type DiscussionWriteContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  now: Date;
};

function notFound(): never {
  throw new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_NOT_FOUND,
    'REVIEW_DISCUSSION_NOT_FOUND',
    undefined,
    404,
  );
}
function forbidden(message: string): never {
  throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, message, undefined, 403);
}
function afterWhere(cursor: { createdAt: Date; id: string } | null) {
  return cursor
    ? {
        OR: [
          { createdAt: { gt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { gt: cursor.id } },
        ],
      }
    : {};
}
function sourceOf(review: {
  id: string;
  artifactSetId: string | null;
  documentRevisionId: string | null;
  subjectDigest: string;
  createdAt: Date;
}) {
  return {
    reviewId: review.id,
    artifactSetId: review.artifactSetId,
    documentRevisionId: review.documentRevisionId,
    subjectDigest: review.subjectDigest,
    createdAt: review.createdAt.toISOString(),
  };
}
function entryView(row: EntryRow) {
  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    author: { ...row.createdByStamp.user, kind: row.createdByStamp.kind },
    addressedInReview: row.addressedInReview ? sourceOf(row.addressedInReview) : null,
  };
}
function discussionView(
  row: DiscussionRow,
  principal: Principal,
  activeRoleIds: readonly string[],
  writable: boolean,
) {
  const entries = row.entries.slice(0, 20);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    resolved: row.resolved,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    author: { ...row.createdByStamp.user, kind: row.createdByStamp.kind },
    source: sourceOf(row.reviewRequest),
    canReply:
      writable && (principal.kind === 'HUMAN' || principal.scopes.includes('review:request')),
    canManage:
      writable &&
      canManageDiscussion(principal, row.createdByStamp.user.id, row.reviewRequest, activeRoleIds),
    entries: entries.map(entryView),
    nextEntriesCursor:
      row.entries.length > 20
        ? encodeDiscussionCursor(`entries:${row.id}`, entries[entries.length - 1])
        : null,
  };
}

@Injectable()
export class V1ReviewDiscussionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: V1ReviewService,
    private readonly authorization: V1AuthorizationService,
  ) {}

  private async accessible(principal: Principal, reviewId: string) {
    const review = await this.reviews.getReview(principal, reviewId);
    await this.authorization.requireScope(principal, review.projectId, 'review:read');
    return review;
  }

  async list(principal: V1Principal, reviewId: string, cursor?: string) {
    await this.accessible(principal, reviewId);
    const position = decodeDiscussionCursor(`discussions:${reviewId}`, cursor);
    return this.prisma.$transaction(
      async (tx) => {
        const review = await tx.reviewRequest.findUnique({
          where: { id: reviewId },
          include: REVIEW_INCLUDE,
        });
        if (!review) notFound();
        const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
        const context = await this.authorization.resolveProjectContext(
          principal,
          review.projectId,
          'read',
          repository,
        );
        await this.knowledgeAccess(principal, review, repository);
        const actor = await this.currentActor(
          tx,
          principal,
          review.projectId,
          new Date(),
          false,
          Boolean(review.documentRevision),
        );
        const currentPrincipal = { ...principal, scopes: actor.scopes };
        const lineage: Prisma.ReviewRequestWhereInput | null = review.documentRevision
          ? { documentRevision: { documentId: review.documentRevision.document.id } }
          : review.taskId && review.artifactSetId
            ? { taskId: review.taskId, documentRevisionId: null }
            : null;
        const where: Prisma.ReviewDiscussionWhereInput = {
          projectId: review.projectId,
          OR: [
            { reviewRequestId: review.id },
            ...(lineage
              ? [
                  {
                    resolved: false,
                    reviewRequest: { ...lineage, createdAt: { lte: review.createdAt } },
                  },
                ]
              : []),
          ],
        };
        const unresolvedCount = await tx.reviewDiscussion.count({
          where: { AND: [where, { resolved: false }] },
        });
        const rows = await tx.reviewDiscussion.findMany({
          where: { AND: [where, afterWhere(position)] },
          include: DISCUSSION_INCLUDE,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 21,
        });
        const page = rows.slice(0, 20);
        const writable = !context.project.archivedAt;
        return {
          items: page.map((row) =>
            discussionView(row, currentPrincipal, context.activeRoleIds, writable),
          ),
          nextCursor:
            rows.length > 20
              ? encodeDiscussionCursor(`discussions:${reviewId}`, page[page.length - 1])
              : null,
          unresolvedCount,
          canCreate:
            writable &&
            review.status === 'OPEN' &&
            (currentPrincipal.kind === 'HUMAN' ||
              currentPrincipal.scopes.includes('review:request')),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async entries(principal: V1Principal, reviewId: string, discussionId: string, cursor?: string) {
    await this.accessible(principal, reviewId);
    const position = decodeDiscussionCursor(`entries:${discussionId}`, cursor);
    return this.prisma.$transaction(
      async (tx) => {
        const review = await tx.reviewRequest.findUnique({
          where: { id: reviewId },
          include: REVIEW_INCLUDE,
        });
        if (!review) notFound();
        const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
        await this.authorization.resolveProjectContext(
          principal,
          review.projectId,
          'read',
          repository,
        );
        await this.knowledgeAccess(principal, review, repository);
        await this.currentActor(
          tx,
          principal,
          review.projectId,
          new Date(),
          false,
          Boolean(review.documentRevision),
        );
        const discussion = await tx.reviewDiscussion.findFirst({
          where: { id: discussionId, projectId: review.projectId, reviewRequestId: reviewId },
          select: { id: true },
        });
        if (!discussion) notFound();
        const rows = await tx.reviewDiscussionEntry.findMany({
          where: { discussionId, projectId: review.projectId, ...afterWhere(position) },
          include: ENTRY_INCLUDE,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: 51,
        });
        const page = rows.slice(0, 50);
        return {
          items: page.map(entryView),
          nextCursor:
            rows.length > 50
              ? encodeDiscussionCursor(`entries:${discussionId}`, page[page.length - 1])
              : null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  private async knowledgeAccess(
    principal: Principal,
    review: DiscussionReview,
    repository: V1AuthorizationPrismaRepository,
  ) {
    const knowledgeBaseId = review.documentRevision?.document.knowledgeBaseId;
    if (knowledgeBaseId) {
      const access = await this.authorization.resolveKnowledgeAccess(
        principal,
        knowledgeBaseId,
        repository,
      );
      if (!access.canRead) notFound();
    }
  }

  async mutate(
    principal: V1Principal,
    reviewId: string,
    input: DiscussionMutation,
    operation: DiscussionWriteContext,
  ) {
    const visible = await this.accessible(principal, reviewId);
    await this.authorization.requireScope(principal, visible.projectId, 'review:request');
    const body = discussionText(input.body, 10000, 'body');
    const title = input.kind === 'CREATE' ? discussionText(input.title, 200, 'title') : null;
    if (input.kind !== 'CREATE') requireExpectedVersion(input.expectedVersion);
    const request = {
      method: operation.method,
      route: operation.route,
      body: input as unknown as Record<string, unknown>,
    };
    const requestDigest = requestDigestOf(request);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${visible.projectId}::uuid FOR UPDATE`,
        );
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."User" WHERE "id" = ${principal.userId}::uuid FOR SHARE`,
        );
        const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
        const context = await this.authorization.resolveProjectContext(
          principal,
          visible.projectId,
          'write',
          repository,
        );
        const review = await tx.reviewRequest.findUnique({
          where: { id: reviewId },
          include: REVIEW_INCLUDE,
        });
        if (!review || review.projectId !== visible.projectId) notFound();
        await this.knowledgeAccess(principal, review, repository);
        const actor = await this.currentActor(
          tx,
          principal,
          review.projectId,
          operation.now,
          true,
          Boolean(review.documentRevision),
        );
        const operationKey = {
          projectScopeKey: projectScopeKey(review.projectId),
          principalScopeKey: principalScopeKey(principal),
          key: operation.idempotencyKey,
        };
        const replay = await tx.idempotentOperation.findUnique({
          where: { projectScopeKey_principalScopeKey_key: operationKey },
        });
        if (replay) {
          assertReplayable(replay as unknown as Parameters<typeof assertReplayable>[0], {
            method: operation.method,
            route: operation.route,
            digest: requestDigest,
          });
          const refs = replay.resultRefs as {
            discussionId?: unknown;
            entryId?: unknown;
            version?: unknown;
          };
          if (typeof refs.discussionId !== 'string' || typeof refs.version !== 'number') notFound();
          return {
            discussionId: refs.discussionId,
            entryId: typeof refs.entryId === 'string' ? refs.entryId : null,
            version: refs.version,
            replayed: true,
          };
        }
        const stamp = await tx.principalStamp.create({
          data: {
            kind: principal.kind,
            userId: principal.userId,
            projectId: review.projectId,
            webSessionId: principal.kind === 'HUMAN' ? principal.sessionId : null,
            agentCredentialId: principal.kind === 'AGENT' ? principal.agentCredentialId : null,
            roleId: principal.kind === 'AGENT' ? principal.roleIds?.[0] : null,
            scopeSnapshot: [...actor.scopes],
            userAuthVersion: actor.authVersion,
          },
        });
        let discussionId: string;
        let entryId: string | null = null;
        let version: number;
        if (input.kind === 'CREATE') {
          if (review.status !== 'OPEN')
            throw new WorkmeshError(V1_ERROR_CODES.REVIEW_CLOSED, 'REVIEW_CLOSED', undefined, 409);
          const created = await tx.reviewDiscussion.create({
            data: {
              projectId: review.projectId,
              reviewRequestId: review.id,
              title: title!,
              body,
              createdByStampId: stamp.id,
            },
          });
          discussionId = created.id;
          version = created.version;
        } else {
          const discussion = await tx.reviewDiscussion.findUnique({
            where: { id: input.discussionId },
            include: {
              reviewRequest: { include: REVIEW_INCLUDE },
              createdByStamp: { select: { userId: true } },
            },
          });
          if (
            !discussion ||
            discussion.projectId !== review.projectId ||
            discussion.reviewRequest.createdAt > review.createdAt ||
            !sameDiscussionSubject(discussion.reviewRequest, review)
          )
            notFound();
          await this.knowledgeAccess(principal, discussion.reviewRequest, repository);
          if (
            input.kind !== 'REPLY' &&
            !canManageDiscussion(
              principal,
              discussion.createdByStamp.userId,
              discussion.reviewRequest,
              context.activeRoleIds,
            )
          )
            forbidden('DISCUSSION_REVIEWER_REQUIRED');
          if (
            (input.kind === 'RESOLVED' && discussion.resolved) ||
            (input.kind === 'REOPENED' && !discussion.resolved)
          )
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'DISCUSSION_STATE_CONFLICT',
              undefined,
              409,
            );
          let addressedInReviewId: string | null = null;
          if (input.addressedInReviewId) {
            const delivery = await tx.reviewRequest.findUnique({
              where: { id: input.addressedInReviewId },
              include: REVIEW_INCLUDE,
            });
            if (
              !delivery ||
              !sameDiscussionSubject(discussion.reviewRequest, delivery) ||
              delivery.createdAt < discussion.reviewRequest.createdAt
            )
              throw new WorkmeshError(
                V1_ERROR_CODES.INVALID_REQUEST,
                'DISCUSSION_DELIVERY_MISMATCH',
                undefined,
                400,
              );
            await this.knowledgeAccess(principal, delivery, repository);
            addressedInReviewId = delivery.id;
          }
          const updated = await tx.reviewDiscussion.updateMany({
            where: { id: discussion.id, version: input.expectedVersion },
            data: {
              version: { increment: 1 },
              ...(input.kind === 'RESOLVED'
                ? { resolved: true }
                : input.kind === 'REOPENED'
                  ? { resolved: false }
                  : {}),
            },
          });
          if (updated.count !== 1)
            throw new WorkmeshError(
              V1_ERROR_CODES.VERSION_CONFLICT,
              'DISCUSSION_VERSION_CONFLICT',
              { currentVersion: discussion.version },
              409,
            );
          const entry = await tx.reviewDiscussionEntry.create({
            data: {
              projectId: review.projectId,
              discussionId: discussion.id,
              kind: input.kind,
              body,
              addressedInReviewId,
              createdByStampId: stamp.id,
            },
          });
          discussionId = discussion.id;
          entryId = entry.id;
          version = discussion.version + 1;
        }
        await tx.auditEvent.create({
          data: {
            projectId: review.projectId,
            actorStampId: stamp.id,
            action: `REVIEW_DISCUSSION_${input.kind}`,
            targetType: 'REVIEW_DISCUSSION',
            targetId: discussionId,
            targetVersion: version,
            outcome: 'SUCCESS',
            details: { reviewId, entryId },
          },
        });
        await tx.idempotentOperation.create({
          data: {
            ...operationKey,
            projectId: review.projectId,
            method: operation.method,
            route: operation.route,
            requestDigest,
            resultRefs: { discussionId, entryId, version },
            responseMetadata: {},
          },
        });
        return { discussionId, entryId, version, replayed: false };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async currentActor(
    tx: Prisma.TransactionClient,
    principal: V1Principal,
    projectId: string,
    now: Date,
    write: boolean,
    knowledgeRead: boolean,
  ) {
    const user = await tx.user.findUnique({
      where: { id: principal.userId },
      select: { isActive: true, authVersion: true },
    });
    if (!user?.isActive) forbidden('ACTOR_INACTIVE');
    if (principal.kind === 'HUMAN') {
      if (write && principal.sessionId)
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."WebSession" WHERE "id" = ${principal.sessionId}::uuid FOR SHARE`,
        );
      const session = principal.sessionId
        ? await tx.webSession.findUnique({ where: { id: principal.sessionId } })
        : null;
      if (
        !session ||
        session.userId !== principal.userId ||
        session.revokedAt ||
        session.expiresAt <= now ||
        session.idleExpiresAt <= now ||
        session.userAuthVersion !== user.authVersion
      )
        forbidden('HUMAN_SESSION_REQUIRED');
    } else {
      if (write && principal.agentCredentialId)
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."AgentCredential" WHERE "id" = ${principal.agentCredentialId}::uuid FOR SHARE`,
        );
      const credential = principal.agentCredentialId
        ? await tx.agentCredential.findUnique({ where: { id: principal.agentCredentialId } })
        : null;
      if (
        !credential ||
        credential.userId !== principal.userId ||
        credential.projectId !== projectId ||
        principal.roleIds?.length !== 1 ||
        credential.roleId !== principal.roleIds[0] ||
        credential.revokedAt ||
        credential.expiresAt <= now ||
        credential.userAuthVersion !== user.authVersion ||
        (write && !credential.scopes.includes('review:request')) ||
        !credential.scopes.includes('review:read') ||
        (knowledgeRead && !credential.scopes.includes('knowledge:read'))
      )
        forbidden('DISCUSSION_CREDENTIAL_INACTIVE');
      return {
        authVersion: user.authVersion,
        scopes: principal.scopes.filter((scope) => credential.scopes.includes(scope)),
      };
    }
    return { authVersion: user.authVersion, scopes: principal.scopes };
  }
}
