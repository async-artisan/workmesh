import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  principalScopeKey,
  projectScopeKey,
} from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import {
  normalizeRoute,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { RateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { runWithSerializableRetry, type ProjectWriteContext } from './projects.service';
import type { CreateWorkspaceEnrollmentDto } from './workspace-enrollment.dto';

export const WORKSPACE_ENROLLMENT_ISSUE = 'WORKSPACE_ENROLLMENT_ISSUE';
export const WORKSPACE_ENROLLMENT_CONSUME = 'WORKSPACE_ENROLLMENT_CONSUME';
export const WORKSPACE_ENROLLMENT_TARGET = 'WORKSPACE_ENROLLMENT';

export const DEFAULT_ENROLLMENT_TTL_SECONDS = 900;
export const MIN_ENROLLMENT_TTL_SECONDS = 60;
export const MAX_ENROLLMENT_TTL_SECONDS = 3600;

/** 进程内固定窗口限流：签发按 (用户, 项目)，消费按客户端地址。 */
export const ENROLLMENT_ISSUE_RATE_LIMIT = { limit: 5, windowMs: 60_000 } as const;
export const ENROLLMENT_CONSUME_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

export const ENROLLMENT_CODE_SHAPE = /^wme_[A-Za-z0-9_-]{43}$/;

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export type IssuedEnrollmentView = {
  enrollmentId: string;
  /** 明文码只在签发响应当次返回；不落库、不可回放。 */
  code: string;
  projectId: string;
  definitionRevisionId: string;
  definitionDigest: string;
  expiresAt: string;
};

export type ConsumedEnrollmentView = {
  projectId: string;
  projectName: string;
  definitionRevisionId: string;
  definitionDigest: string;
};

/** 新接入码明文：`wme_` + 32 随机字节 base64url（43 字符）。只存 sha256。 */
export function newEnrollmentCode(): string {
  return `wme_${randomBytes(32).toString('base64url')}`;
}

export function hashEnrollmentCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}

function enrollmentNotFound(): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.ENROLLMENT_NOT_FOUND, 'ENROLLMENT_NOT_FOUND', {}, 404);
}

function rateLimited(retryAfterSeconds: number): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RATE_LIMITED, 'RATE_LIMITED', { retryAfterSeconds }, 429);
}

/** 接入码冲突使用明确错误码：过期/已消费/已撤销/不可回放必须可区分。 */
function enrollmentConflict(
  code:
    | 'ENROLLMENT_EXPIRED'
    | 'ENROLLMENT_CONSUMED'
    | 'ENROLLMENT_REVOKED'
    | 'ENROLLMENT_CODE_NOT_REPLAYABLE',
  details: Record<string, unknown>,
): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES[code], code, details, 409);
}

/**
 * CLI 一次性接入码。
 *
 * 签发（§21.1 已冻结）：任意活动 HUMAN 项目成员可签发 + 限流；不要求 OWNER/ADMIN；
 * 必须有 current published definition（否则 409 PROJECT_UNCONFIGURED），码绑定签发时的
 * exact revision + digest；重签会撤销同一用户此前未消费的码。
 *
 * 消费：匿名，码即凭证；单事务内 CAS `consumedAt`，并发只有一个成功；不授予任何成员、
 * 仓库、知识或 Agent 权限，只返回项目与精确 revision 元数据。
 */
@Injectable()
export class WorkspaceEnrollmentService {
  private readonly issueLimiter = new RateLimiter(
    ENROLLMENT_ISSUE_RATE_LIMIT.limit,
    10_000,
    ENROLLMENT_ISSUE_RATE_LIMIT.windowMs,
  );
  private readonly consumeLimiter = new RateLimiter(
    ENROLLMENT_CONSUME_RATE_LIMIT.limit,
    10_000,
    ENROLLMENT_CONSUME_RATE_LIMIT.windowMs,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async issue(
    principal: V1Principal,
    projectId: string,
    dto: CreateWorkspaceEnrollmentDto,
    context: ProjectWriteContext,
  ): Promise<IssuedEnrollmentView> {
    await this.requireActiveHumanMember(principal, projectId);

    const limit = this.issueLimiter.take(`${principal.userId}:${projectId}`, context.now.getTime());
    if (!limit.allowed) throw rateLimited(limit.retryAfter);

    const replay = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(projectId),
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    });
    // 明文码只展示一次：同 key 重试不能回放明文，只能重新签发（旧码会被作废）。
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    if (replay) {
      this.assertSameIssueRequest(replay, context, requestDigest);
      await this.revokeUnconsumedEnrollment(
        String(replay.resultRefs.enrollmentId ?? ''),
        context.now,
        principal,
      );
      throw enrollmentConflict('ENROLLMENT_CODE_NOT_REPLAYABLE', {
        enrollmentId: String(replay.resultRefs.enrollmentId ?? ''),
      });
    }

    const ttl = dto.ttlSeconds ?? DEFAULT_ENROLLMENT_TTL_SECONDS;
    if (
      !Number.isSafeInteger(ttl) ||
      ttl < MIN_ENROLLMENT_TTL_SECONDS ||
      ttl > MAX_ENROLLMENT_TTL_SECONDS
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'ENROLLMENT_TTL_INVALID',
        {
          ttlSeconds: dto.ttlSeconds ?? null,
          min: MIN_ENROLLMENT_TTL_SECONDS,
          max: MAX_ENROLLMENT_TTL_SECONDS,
        },
        422,
      );

    const now = context.now;
    const expiresAt = new Date(now.getTime() + ttl * 1000);
    const code = newEnrollmentCode();
    const codeHash = hashEnrollmentCode(code);

    let result: IssuedEnrollmentView | { replayedEnrollmentId: string };
    try {
      result = await runWithSerializableRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await lockProject(tx, projectId);
          await lockMembership(tx, projectId, principal.userId);
          const access = await this.requireActiveHumanMember(principal, projectId, tx);
          const committed = await this.operations.findOperation(
            {
              projectScopeKey: projectScopeKey(projectId),
              principalScopeKey: principalScopeKey(principal),
              key: context.idempotencyKey,
            },
            tx,
          );
          if (committed) {
            this.assertSameIssueRequest(committed, context, requestDigest);
            const enrollmentId = String(committed.resultRefs.enrollmentId ?? '');
            if (enrollmentId) {
              await tx.projectWorkspaceEnrollment.updateMany({
                where: {
                  id: enrollmentId,
                  consumedAt: null,
                  revokedAt: null,
                },
                data: { revokedAt: now, version: { increment: 1 } },
              });
            }
            return { replayedEnrollmentId: enrollmentId };
          }
          const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { archivedAt: true },
          });
          if (!project) throw enrollmentNotFound();
          if (project.archivedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'PROJECT_ARCHIVED',
              { projectId, archivedAt: project.archivedAt.toISOString() },
              409,
            );

          const definition = await tx.projectWorkspaceDefinition.findUnique({
            where: { projectId },
            select: {
              currentRevision: { select: { id: true, digest: true } },
            },
          });
          const revision = definition?.currentRevision ?? null;
          if (!revision)
            throw new WorkmeshError(
              V1_ERROR_CODES.PROJECT_UNCONFIGURED,
              'PROJECT_UNCONFIGURED',
              { projectId },
              409,
            );

          // 重签 = 旧码作废：同一用户在同一项目下未消费的码全部撤销。
          await tx.projectWorkspaceEnrollment.updateMany({
            where: {
              projectId,
              createdByUserId: principal.userId,
              consumedAt: null,
              revokedAt: null,
            },
            data: { revokedAt: now, version: { increment: 1 } },
          });

          const enrollment = await tx.projectWorkspaceEnrollment.create({
            data: {
              projectId,
              createdByUserId: principal.userId,
              definitionRevisionId: revision.id,
              definitionDigest: revision.digest,
              codeHash,
              expiresAt,
              createdAt: now,
            },
            select: { id: true },
          });

          const stamp = await tx.principalStamp.create({
            data: {
              kind: 'HUMAN',
              userId: principal.userId,
              webSessionId: context.webSessionId,
              projectId,
              userAuthVersion: context.userAuthVersion,
              memberVersion: access.membership.version,
              scopeSnapshot: [],
            },
          });
          await tx.auditEvent.create({
            data: {
              projectId,
              actorStampId: stamp.id,
              action: WORKSPACE_ENROLLMENT_ISSUE,
              targetType: WORKSPACE_ENROLLMENT_TARGET,
              targetId: enrollment.id,
              targetVersion: 1,
              outcome: 'SUCCESS',
              details: {
                definitionRevisionId: revision.id,
                definitionDigest: revision.digest,
                expiresAt: expiresAt.toISOString(),
              } as Prisma.InputJsonValue,
            },
          });

          await tx.idempotentOperation.create({
            data: {
              id: context.operationId,
              projectId,
              projectScopeKey: projectScopeKey(projectId),
              principalScopeKey: principalScopeKey(principal),
              key: context.idempotencyKey,
              method: context.method,
              route: context.route,
              requestDigest,
              // 只存 id；绝不存明文码。
              resultRefs: { enrollmentId: enrollment.id },
              responseMetadata: {},
            },
          });

          return {
            enrollmentId: enrollment.id,
            code,
            projectId,
            definitionRevisionId: revision.id,
            definitionDigest: revision.digest,
            expiresAt: expiresAt.toISOString(),
          };
        }, SERIALIZABLE),
      );
    } catch (error) {
      if (error instanceof WorkmeshError && (error.status === 403 || error.status === 404))
        throw error;
      const existing = await this.operations.findOperation({
        projectScopeKey: projectScopeKey(projectId),
        principalScopeKey: principalScopeKey(principal),
        key: context.idempotencyKey,
      });
      if (!existing) throw error;
      this.assertSameIssueRequest(existing, context, requestDigest);
      const enrollmentId = String(existing.resultRefs.enrollmentId ?? '');
      await this.revokeUnconsumedEnrollment(enrollmentId, context.now, principal);
      result = { replayedEnrollmentId: enrollmentId };
    }
    if ('replayedEnrollmentId' in result)
      throw enrollmentConflict('ENROLLMENT_CODE_NOT_REPLAYABLE', {
        enrollmentId: result.replayedEnrollmentId,
      });
    return result;
  }

  /** 匿名消费：只解析项目与精确 revision；不创建任何成员/凭据/权限。 */
  async consume(
    code: string,
    clientKey: string,
    now = new Date(),
  ): Promise<ConsumedEnrollmentView> {
    const limit = this.consumeLimiter.take(clientKey, now.getTime());
    if (!limit.allowed) throw rateLimited(limit.retryAfter);

    if (typeof code !== 'string' || !ENROLLMENT_CODE_SHAPE.test(code)) throw enrollmentNotFound();

    const enrollment = await this.prisma.projectWorkspaceEnrollment.findUnique({
      where: { codeHash: hashEnrollmentCode(code) },
      select: {
        id: true,
        projectId: true,
        definitionRevisionId: true,
        definitionDigest: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        project: { select: { name: true, archivedAt: true } },
      },
    });
    if (!enrollment) throw enrollmentNotFound();
    if (enrollment.revokedAt)
      throw enrollmentConflict('ENROLLMENT_REVOKED', {
        enrollmentId: enrollment.id,
        revokedAt: enrollment.revokedAt.toISOString(),
      });
    if (enrollment.consumedAt)
      throw enrollmentConflict('ENROLLMENT_CONSUMED', {
        enrollmentId: enrollment.id,
        consumedAt: enrollment.consumedAt.toISOString(),
      });
    if (enrollment.expiresAt <= now)
      throw enrollmentConflict('ENROLLMENT_EXPIRED', {
        enrollmentId: enrollment.id,
        expiresAt: enrollment.expiresAt.toISOString(),
      });
    if (enrollment.project.archivedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'PROJECT_ARCHIVED',
        {
          projectId: enrollment.projectId,
          archivedAt: enrollment.project.archivedAt.toISOString(),
        },
        409,
      );

    return runWithSerializableRetry(() =>
      this.prisma.$transaction(async (tx) => {
        await lockProject(tx, enrollment.projectId);
        const project = await tx.project.findUnique({
          where: { id: enrollment.projectId },
          select: { name: true, archivedAt: true },
        });
        if (!project) throw enrollmentNotFound();
        if (project.archivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'PROJECT_ARCHIVED',
            { projectId: enrollment.projectId, archivedAt: project.archivedAt.toISOString() },
            409,
          );
        const claimed = await tx.projectWorkspaceEnrollment.updateMany({
          where: {
            id: enrollment.id,
            consumedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now, version: { increment: 1 } },
        });
        if (claimed.count !== 1) {
          const current = await tx.projectWorkspaceEnrollment.findUnique({
            where: { id: enrollment.id },
            select: { consumedAt: true, revokedAt: true, expiresAt: true },
          });
          if (current?.consumedAt)
            throw enrollmentConflict('ENROLLMENT_CONSUMED', {
              enrollmentId: enrollment.id,
              consumedAt: current.consumedAt.toISOString(),
            });
          if (current?.revokedAt)
            throw enrollmentConflict('ENROLLMENT_REVOKED', {
              enrollmentId: enrollment.id,
              revokedAt: current.revokedAt.toISOString(),
            });
          throw enrollmentConflict('ENROLLMENT_EXPIRED', {
            enrollmentId: enrollment.id,
            expiresAt: (current?.expiresAt ?? enrollment.expiresAt).toISOString(),
          });
        }

        await tx.auditEvent.create({
          data: {
            projectId: enrollment.projectId,
            action: WORKSPACE_ENROLLMENT_CONSUME,
            targetType: WORKSPACE_ENROLLMENT_TARGET,
            targetId: enrollment.id,
            targetVersion: 2,
            outcome: 'SUCCESS',
            details: {
              definitionRevisionId: enrollment.definitionRevisionId,
              definitionDigest: enrollment.definitionDigest,
            } as Prisma.InputJsonValue,
          },
        });

        return {
          projectId: enrollment.projectId,
          projectName: project.name,
          definitionRevisionId: enrollment.definitionRevisionId,
          definitionDigest: enrollment.definitionDigest,
        };
      }, SERIALIZABLE),
    );
  }

  private async requireActiveHumanMember(
    principal: V1Principal,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ) {
    if (principal.kind !== 'HUMAN' || !principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    // write 模式：非成员/已撤权 404，归档项目 409；不检查 OWNER/ADMIN。
    return this.authorization.resolveProjectContext(
      principal,
      projectId,
      'write',
      tx ? V1AuthorizationPrismaRepository.forTransaction(tx) : undefined,
    );
  }

  private assertSameIssueRequest(
    record: V1OperationRecord,
    context: ProjectWriteContext,
    digest: string,
  ): void {
    if (
      record.method.toUpperCase() !== context.method.toUpperCase() ||
      normalizeRoute(record.route) !== normalizeRoute(context.route)
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        'IDEMPOTENCY_ROUTE_CONFLICT',
        { operationId: record.id },
        409,
      );
    if (record.requestDigest !== digest)
      throw new WorkmeshError(
        V1_ERROR_CODES.IDEMPOTENCY_DIGEST_CONFLICT,
        'IDEMPOTENCY_DIGEST_CONFLICT',
        { operationId: record.id },
        409,
      );
  }

  private async revokeUnconsumedEnrollment(
    enrollmentId: string,
    now: Date,
    principal: V1Principal,
  ): Promise<void> {
    if (!enrollmentId) return;
    await this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.projectWorkspaceEnrollment.findUnique({
        where: { id: enrollmentId },
        select: { projectId: true },
      });
      if (!enrollment) return;
      await lockProject(tx, enrollment.projectId);
      await lockMembership(tx, enrollment.projectId, principal.userId);
      await this.requireActiveHumanMember(principal, enrollment.projectId, tx);
      await tx.projectWorkspaceEnrollment.updateMany({
        where: { id: enrollmentId, consumedAt: null, revokedAt: null },
        data: { revokedAt: now, version: { increment: 1 } },
      });
    }, SERIALIZABLE);
  }
}

async function lockProject(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
  );
  if (locked.length === 0) throw enrollmentNotFound();
}

async function lockMembership(
  tx: Prisma.TransactionClient,
  projectId: string,
  userId: string,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT "projectId" FROM "workmesh_v1"."ProjectMember"
    WHERE "projectId" = ${projectId}::uuid AND "userId" = ${userId}::uuid FOR SHARE`);
}
