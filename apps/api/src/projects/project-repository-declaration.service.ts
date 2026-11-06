import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  canonicalizeRepositoryLocator,
  principalScopeKey,
  projectScopeKey,
  RepositoryLocatorError,
  type ActionBinding,
  type CanonicalRepositoryLocator,
} from '@workmesh/shared';
import { V1AuthorizationService, type V1ProjectContext } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import {
  verifyTicketBinding,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
} from '../auth/v1-confirmation';
import {
  normalizeRoute,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import type { DeclareRepositoryDto } from './dto';
import type { ProjectWriteContext } from './projects.service';

export const REPOSITORY_DECLARE = 'REPOSITORY_DECLARE';
/** 声明/别名的票据目标：项目本身；locator 与 displayName 由 payload 摘要绑定。 */
export const REPOSITORY_DECLARE_TARGET = 'PROJECT';

export type RepositoryDeclarationView = {
  repositoryId: string;
  locatorId: string;
  identityMode: string;
  canonicalLocator: string;
  source: 'HTTPS' | 'SSH';
  owner: string;
  name: string;
  reused: boolean;
  replayed: boolean;
  alias: boolean;
  projectVersion: number;
};

export type RepositoryDeclarationResult = {
  status: 200 | 201;
  view: RepositoryDeclarationView;
};

type RepositoryRow = {
  id: string;
  identityMode: string;
  adapter: string | null;
  externalId: string | null;
  owner: string;
  name: string;
  archivedAt: Date | null;
};

type LocatorRow = {
  id: string;
  repositoryId: string;
  canonicalLocator: string;
  source: string;
  repository: RepositoryRow;
};

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];
const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2034') return true;
  const message = (error as Error | null)?.message ?? '';
  return message.includes('40001') || message.includes('could not serialize');
}

function resourceNotFound(code: string, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, code, details, 404);
}

function projectVersionConflict(expectedVersion: number, currentVersion: number): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.PROJECT_VERSION_CONFLICT,
    'PROJECT_VERSION_CONFLICT',
    { expectedVersion, currentVersion },
    409,
  );
}

function locatorAlreadyBound(canonicalLocator: string, boundRepositoryId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.LOCATOR_ALREADY_BOUND,
    'LOCATOR_ALREADY_BOUND',
    { canonicalLocator, boundRepositoryId },
    409,
  );
}

function locatorInvalid(reason: string, locator?: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.VALIDATION_FAILED,
    'LOCATOR_INVALID',
    { ...(locator !== undefined ? { locator } : {}), reason },
    422,
  );
}

/**
 * HUMAN 声明的仓库来源。
 *
 * 稳定身份规则（§7.4）：
 * - 同项目 `(projectId, canonicalLocator)` 的活跃 locator 一律复用现有 `ProjectRepository`，
 *   与 Idempotency-Key 是否相同无关；不创建第二条仓库。
 * - 只有显式 alias（携带 targetRepositoryId）且该 locator 已绑定到**另一**仓库时，
 *   才返回 409 LOCATOR_ALREADY_BOUND。
 * - DECLARED 行 `adapter/externalId` 必须为 NULL；`owner/name` 仅展示。
 * - 不调用任何 provider API，不写核验状态。
 */
@Injectable()
export class ProjectRepositoryDeclarationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async declare(
    principal: V1Principal,
    projectId: string,
    input: DeclareRepositoryDto,
    context: ProjectWriteContext,
  ): Promise<RepositoryDeclarationResult> {
    const access = await this.requireWriteAccess(principal, projectId);
    const canonical = this.canonicalize(input.locator);

    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const replay = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(projectId),
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    });
    if (replay) {
      this.assertSameRequest(replay, context, requestDigest);
      return { status: 200, view: this.replayView(replay) };
    }

    if (access.project.version !== input.expectedProjectVersion) {
      const committed = await this.operations.findOperation({
        projectScopeKey: projectScopeKey(projectId),
        principalScopeKey: principalScopeKey(principal),
        key: context.idempotencyKey,
      });
      if (committed) {
        this.assertSameRequest(committed, context, requestDigest);
        return { status: 200, view: this.replayView(committed) };
      }
      throw projectVersionConflict(input.expectedProjectVersion, access.project.version);
    }

    let ticket: Awaited<ReturnType<ProjectRepositoryDeclarationService['requireTicket']>>;
    try {
      ticket = await this.requireTicket(principal, projectId, input, context);
    } catch (error) {
      const committed = await this.operations.findOperation({
        projectScopeKey: projectScopeKey(projectId),
        principalScopeKey: principalScopeKey(principal),
        key: context.idempotencyKey,
      });
      if (committed) {
        this.assertSameRequest(committed, context, requestDigest);
        return { status: 200, view: this.replayView(committed) };
      }
      throw error;
    }
    try {
      return await this.runWithRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await this.lockProject(tx, projectId);
          const committed = await this.operations.findOperation(
            {
              projectScopeKey: projectScopeKey(projectId),
              principalScopeKey: principalScopeKey(principal),
              key: context.idempotencyKey,
            },
            tx,
          );
          if (committed) {
            this.assertSameRequest(committed, context, requestDigest);
            return { status: 200, view: this.replayView(committed) };
          }
          await this.lockMembership(tx, projectId, principal.userId);
          const transactionAccess = await this.requireWriteAccess(principal, projectId, tx);
          const project = await tx.project.findUnique({
            where: { id: projectId },
            select: { version: true, archivedAt: true },
          });
          if (!project) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
          if (project.archivedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'PROJECT_ARCHIVED',
              { projectId, archivedAt: project.archivedAt.toISOString() },
              409,
            );
          const active = await tx.projectRepositoryLocator.findFirst({
            where: { projectId, canonicalLocator: canonical.canonicalLocator, revokedAt: null },
            select: {
              id: true,
              repositoryId: true,
              canonicalLocator: true,
              source: true,
              repository: {
                select: {
                  id: true,
                  identityMode: true,
                  adapter: true,
                  externalId: true,
                  owner: true,
                  name: true,
                  archivedAt: true,
                },
              },
            },
          });

          if (project.version !== input.expectedProjectVersion) {
            const activeIsNoOp =
              active &&
              active.repository.archivedAt === null &&
              !(
                active.repository.identityMode === 'DECLARED' &&
                input.displayName &&
                input.displayName !== active.repository.name
              );
            if (!activeIsNoOp)
              throw projectVersionConflict(input.expectedProjectVersion, project.version);
          }
          if (active?.repository.archivedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'REPOSITORY_ARCHIVED',
              {
                repositoryId: active.repository.id,
                archivedAt: active.repository.archivedAt.toISOString(),
              },
              409,
            );

          // A request that wins the locator race still consumes its own confirmation
          // unless it is an already-committed idempotent replay.
          const consumed = await this.consumeTicket(tx, ticket, context);
          if (!consumed)
            throw new WorkmeshError(
              V1_ERROR_CODES.CONFIRMATION_USED,
              'CONFIRMATION_CONSUME_CONFLICT',
              { ticketId: ticket.id },
              409,
            );

          if (active) {
            if (input.targetRepositoryId && active.repositoryId !== input.targetRepositoryId)
              throw locatorAlreadyBound(canonical.canonicalLocator, active.repositoryId);
            return await this.reuseExisting(tx, {
              principal,
              projectId,
              access: transactionAccess,
              context,
              input,
              canonical,
              requestDigest,
              locator: active,
              projectVersion: project.version,
              alias: Boolean(input.targetRepositoryId),
            });
          }

          let repository: RepositoryRow;
          let reused = false;
          let alias = false;
          if (input.targetRepositoryId) {
            const target = await tx.projectRepository.findFirst({
              where: { id: input.targetRepositoryId, projectId },
              select: {
                id: true,
                identityMode: true,
                adapter: true,
                externalId: true,
                owner: true,
                name: true,
                archivedAt: true,
              },
            });
            if (!target)
              throw resourceNotFound('REPOSITORY_NOT_FOUND', {
                repositoryId: input.targetRepositoryId,
              });
            if (target.archivedAt)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_CONFLICT,
                'REPOSITORY_ARCHIVED',
                { repositoryId: target.id, archivedAt: target.archivedAt.toISOString() },
                409,
              );
            repository = target;
            alias = true;
          } else {
            const history = await tx.projectRepositoryLocator.findFirst({
              where: { projectId, canonicalLocator: canonical.canonicalLocator },
              orderBy: { declaredAt: 'desc' },
              select: {
                repository: {
                  select: {
                    id: true,
                    identityMode: true,
                    adapter: true,
                    externalId: true,
                    owner: true,
                    name: true,
                    archivedAt: true,
                  },
                },
              },
            });
            if (history) {
              // 已撤销的历史 locator：复用同一 ProjectRepository ID，仅追加新的活跃 locator。
              repository = history.repository;
              if (repository.identityMode === 'PROVIDER' && repository.archivedAt)
                throw new WorkmeshError(
                  V1_ERROR_CODES.RESOURCE_CONFLICT,
                  'REPOSITORY_ARCHIVED',
                  { repositoryId: repository.id, archivedAt: repository.archivedAt.toISOString() },
                  409,
                );
              reused = true;
            } else {
              repository = await tx.projectRepository.create({
                data: {
                  projectId,
                  identityMode: 'DECLARED',
                  adapter: null,
                  externalId: null,
                  owner: canonical.owner,
                  name: input.displayName ?? canonical.name,
                },
                select: {
                  id: true,
                  identityMode: true,
                  adapter: true,
                  externalId: true,
                  owner: true,
                  name: true,
                  archivedAt: true,
                },
              });
            }
          }

          if (
            repository.identityMode === 'DECLARED' &&
            input.displayName &&
            repository.name !== input.displayName
          ) {
            repository = await tx.projectRepository.update({
              where: { id: repository.id },
              data: { name: input.displayName },
              select: {
                id: true,
                identityMode: true,
                adapter: true,
                externalId: true,
                owner: true,
                name: true,
                archivedAt: true,
              },
            });
          }
          // 已归档的稳定身份被重新声明时恢复可用，但保留原 ID。
          const reactivated =
            repository.identityMode === 'DECLARED'
              ? await tx.projectRepository.updateMany({
                  where: { id: repository.id, projectId, archivedAt: { not: null } },
                  data: { archivedAt: null },
                })
              : { count: 0 };

          const locator = await tx.projectRepositoryLocator.create({
            data: {
              projectId,
              repositoryId: repository.id,
              canonicalLocator: canonical.canonicalLocator,
              source: canonical.source,
              declaredByUserId: principal.userId,
              declaredAt: context.now,
            },
            select: { id: true },
          });

          const projectVersion = input.expectedProjectVersion + 1;
          const bumped = await tx.project.updateMany({
            where: { id: projectId, version: input.expectedProjectVersion, archivedAt: null },
            data: { version: { increment: 1 } },
          });
          if (bumped.count !== 1)
            throw projectVersionConflict(input.expectedProjectVersion, project.version);

          const view: RepositoryDeclarationView = {
            repositoryId: repository.id,
            locatorId: locator.id,
            identityMode: repository.identityMode,
            canonicalLocator: canonical.canonicalLocator,
            source: canonical.source,
            owner: repository.owner,
            name: repository.name,
            reused,
            replayed: false,
            alias,
            projectVersion,
          };
          await this.recordAudit(tx, {
            principal,
            projectId,
            access: transactionAccess,
            context,
            canonical,
            view,
            details: {
              canonicalLocator: canonical.canonicalLocator,
              source: canonical.source,
              identityMode: repository.identityMode,
              alias,
              reused,
              reactivated: reactivated.count === 1,
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
              resultRefs: { ...view } as unknown as Prisma.InputJsonValue,
              responseMetadata: {},
            },
          });
          // 新建仓库 201；复用/别名 200。
          return { status: alias || reused ? 200 : 201, view };
        }, SERIALIZABLE),
      );
    } catch (error) {
      return this.recoverConcurrentDeclaration(error, {
        principal,
        projectId,
        input,
        canonical,
        access,
        context,
        requestDigest,
        ticket,
      });
    }
  }

  /** 活跃 locator 复用：不新建仓库/locator；仅实际展示字段/归档恢复会递增项目版本。 */
  private async reuseExisting(
    tx: Prisma.TransactionClient,
    args: {
      principal: V1Principal;
      projectId: string;
      access: V1ProjectContext;
      context: ProjectWriteContext;
      input: DeclareRepositoryDto;
      canonical: CanonicalRepositoryLocator;
      requestDigest: string;
      locator: LocatorRow;
      projectVersion: number;
      alias: boolean;
    },
  ): Promise<RepositoryDeclarationResult> {
    let repository = args.locator.repository;
    const displayNameChanged =
      repository.identityMode === 'DECLARED' &&
      Boolean(args.input.displayName) &&
      repository.name !== args.input.displayName;
    if (displayNameChanged && args.input.displayName) {
      repository = await tx.projectRepository.update({
        where: { id: repository.id },
        data: { name: args.input.displayName },
        select: {
          id: true,
          identityMode: true,
          adapter: true,
          externalId: true,
          owner: true,
          name: true,
          archivedAt: true,
        },
      });
    }
    const reactivated =
      repository.identityMode === 'DECLARED'
        ? await tx.projectRepository.updateMany({
            where: { id: repository.id, projectId: args.projectId, archivedAt: { not: null } },
            data: { archivedAt: null },
          })
        : { count: 0 };
    const changed = reactivated.count === 1 || displayNameChanged;
    let projectVersion = args.projectVersion;
    if (changed) {
      const bumped = await tx.project.updateMany({
        where: { id: args.projectId, version: args.projectVersion, archivedAt: null },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1)
        throw projectVersionConflict(args.projectVersion, args.projectVersion);
      projectVersion += 1;
    }
    const view: RepositoryDeclarationView = {
      repositoryId: repository.id,
      locatorId: args.locator.id,
      identityMode: repository.identityMode,
      canonicalLocator: args.canonical.canonicalLocator,
      source: args.canonical.source,
      owner: repository.owner,
      name: repository.name,
      reused: true,
      replayed: false,
      alias: args.alias,
      projectVersion,
    };
    await this.recordAudit(tx, {
      principal: args.principal,
      projectId: args.projectId,
      access: args.access,
      context: args.context,
      canonical: args.canonical,
      view,
      details: {
        canonicalLocator: args.canonical.canonicalLocator,
        source: args.canonical.source,
        identityMode: repository.identityMode,
        alias: args.alias,
        reused: true,
        reactivated: reactivated.count === 1,
      },
    });
    await tx.idempotentOperation.create({
      data: {
        id: args.context.operationId,
        projectId: args.projectId,
        projectScopeKey: projectScopeKey(args.projectId),
        principalScopeKey: principalScopeKey(args.principal),
        key: args.context.idempotencyKey,
        method: args.context.method,
        route: args.context.route,
        requestDigest: args.requestDigest,
        resultRefs: { ...view } as unknown as Prisma.InputJsonValue,
        responseMetadata: {},
      },
    });
    return { status: 200, view };
  }

  /**
   * 并发声明：部分唯一索引 `(projectId, canonicalLocator) WHERE revokedAt IS NULL` 或
   * 幂等键唯一约束会抛 P2002。按约束目标恢复成可解释结果，而不是 500。
   */
  private async recoverConcurrentDeclaration(
    error: unknown,
    args: {
      principal: V1Principal;
      projectId: string;
      input: DeclareRepositoryDto;
      canonical: CanonicalRepositoryLocator;
      access: V1ProjectContext;
      context: ProjectWriteContext;
      requestDigest: string;
      ticket: Awaited<ReturnType<ProjectRepositoryDeclarationService['requireTicket']>>;
    },
  ): Promise<RepositoryDeclarationResult> {
    const code = (error as { code?: string } | null)?.code;
    if (code !== 'P2002' && !isRetryable(error)) throw error;
    const rawTarget = (error as { meta?: { target?: unknown } }).meta?.target;
    const target = Array.isArray(rawTarget) ? rawTarget.join(',') : String(rawTarget ?? '');

    const existing = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(args.projectId),
      principalScopeKey: principalScopeKey(args.principal),
      key: args.context.idempotencyKey,
    });
    if (existing) {
      this.assertSameRequest(existing, args.context, args.requestDigest);
      return { status: 200, view: this.replayView(existing) };
    }

    // A uniqueness/serialization loser must complete the same write contract as an
    // ordinary reuse: consume its ticket and persist audit + idempotency in one tx.
    if (target.includes('canonicalLocator') || isRetryable(error)) {
      return this.prisma.$transaction(async (tx) => {
        await this.lockProject(tx, args.projectId);
        const committed = await this.operations.findOperation(
          {
            projectScopeKey: projectScopeKey(args.projectId),
            principalScopeKey: principalScopeKey(args.principal),
            key: args.context.idempotencyKey,
          },
          tx,
        );
        if (committed) {
          this.assertSameRequest(committed, args.context, args.requestDigest);
          return { status: 200, view: this.replayView(committed) };
        }
        await this.lockMembership(tx, args.projectId, args.principal.userId);
        const access = await this.requireWriteAccess(args.principal, args.projectId, tx);
        const project = await tx.project.findUnique({
          where: { id: args.projectId },
          select: { version: true, archivedAt: true },
        });
        if (!project) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId: args.projectId });
        if (project.archivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'PROJECT_ARCHIVED',
            { projectId: args.projectId, archivedAt: project.archivedAt.toISOString() },
            409,
          );
        const active = await tx.projectRepositoryLocator.findFirst({
          where: {
            projectId: args.projectId,
            canonicalLocator: args.canonical.canonicalLocator,
            revokedAt: null,
          },
          select: {
            id: true,
            repositoryId: true,
            canonicalLocator: true,
            source: true,
            repository: {
              select: {
                id: true,
                identityMode: true,
                adapter: true,
                externalId: true,
                owner: true,
                name: true,
                archivedAt: true,
              },
            },
          },
        });
        if (!active) throw error;
        if (active.repository.archivedAt)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_CONFLICT,
            'REPOSITORY_ARCHIVED',
            {
              repositoryId: active.repository.id,
              archivedAt: active.repository.archivedAt.toISOString(),
            },
            409,
          );
        const changesDisplayName =
          active.repository.identityMode === 'DECLARED' &&
          Boolean(args.input.displayName) &&
          args.input.displayName !== active.repository.name;
        if (changesDisplayName && project.version !== args.input.expectedProjectVersion)
          throw projectVersionConflict(args.input.expectedProjectVersion, project.version);
        if (args.input.targetRepositoryId && active.repositoryId !== args.input.targetRepositoryId)
          throw locatorAlreadyBound(args.canonical.canonicalLocator, active.repositoryId);
        const consumed = await this.consumeTicket(tx, args.ticket, args.context);
        if (!consumed)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: args.ticket.id },
            409,
          );
        return this.reuseExisting(tx, {
          principal: args.principal,
          projectId: args.projectId,
          access,
          context: args.context,
          input: args.input,
          canonical: args.canonical,
          requestDigest: args.requestDigest,
          locator: active,
          projectVersion: project.version,
          alias: Boolean(args.input.targetRepositoryId),
        });
      }, SERIALIZABLE);
    }
    if (isRetryable(error)) throw error;
    throw new WorkmeshError(
      V1_ERROR_CODES.RESOURCE_CONFLICT,
      'REPOSITORY_DECLARATION_CONFLICT',
      { canonicalLocator: args.canonical.canonicalLocator },
      409,
    );
  }

  private canonicalize(locator: string): CanonicalRepositoryLocator {
    try {
      return canonicalizeRepositoryLocator(locator);
    } catch (error) {
      if (error instanceof RepositoryLocatorError) throw locatorInvalid(error.reason, locator);
      throw error;
    }
  }

  private replayView(record: V1OperationRecord): RepositoryDeclarationView {
    const refs = record.resultRefs;
    return {
      repositoryId: String(refs.repositoryId ?? ''),
      locatorId: String(refs.locatorId ?? ''),
      identityMode: String(refs.identityMode ?? 'DECLARED'),
      canonicalLocator: String(refs.canonicalLocator ?? ''),
      source: refs.source === 'SSH' ? 'SSH' : 'HTTPS',
      owner: String(refs.owner ?? ''),
      name: String(refs.name ?? ''),
      reused: refs.reused === true,
      replayed: true,
      alias: refs.alias === true,
      projectVersion: Number(refs.projectVersion ?? 0),
    };
  }

  /** 同 key 但换 route/换请求体：409，不把旧结果当成新请求的成功。 */
  private assertSameRequest(
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

  private async requireWriteAccess(
    principal: V1Principal,
    projectId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<V1ProjectContext> {
    if (principal.kind !== 'HUMAN' || !principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    const access = await this.authorization.resolveProjectContext(
      principal,
      projectId,
      'write',
      tx ? V1AuthorizationPrismaRepository.forTransaction(tx) : undefined,
    );
    if (access.membership.role !== 'OWNER' && access.membership.role !== 'ADMIN')
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'PROJECT_MANAGER_REQUIRED',
        { projectId },
        403,
      );
    return access;
  }

  private async requireTicket(
    principal: V1Principal,
    projectId: string,
    input: DeclareRepositoryDto,
    context: ProjectWriteContext,
  ) {
    const binding: ActionBinding = {
      action: REPOSITORY_DECLARE,
      projectId,
      targetType: REPOSITORY_DECLARE_TARGET,
      targetId: projectId,
      expectedVersion: input.expectedProjectVersion,
      roleSlot: null,
      // 票据绑定用户原样提交的 locator：用户批准的就是这个字符串。
      payload: {
        locator: input.locator,
        targetRepositoryId: input.targetRepositoryId ?? null,
        displayName: input.displayName ?? null,
      },
    };
    const ticket = await this.tickets.findTicket(input.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: input.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: input.confirmation,
      userId: principal.userId,
      webSessionId: context.webSessionId,
      userAuthVersion: context.userAuthVersion,
      binding,
      now: context.now,
    });
    return ticket;
  }

  private async lockProject(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
    );
    if (locked.length === 0) throw resourceNotFound('PROJECT_NOT_FOUND', { projectId });
  }

  private async lockMembership(
    tx: Prisma.TransactionClient,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT "projectId" FROM "workmesh_v1"."ProjectMember"
      WHERE "projectId" = ${projectId}::uuid AND "userId" = ${userId}::uuid FOR SHARE`);
  }

  private async consumeTicket(
    tx: Prisma.TransactionClient,
    ticket: Awaited<ReturnType<ProjectRepositoryDeclarationService['requireTicket']>>,
    context: ProjectWriteContext,
  ): Promise<boolean> {
    const consumed = await tx.$executeRaw(
      Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
        SET "consumedAt" = ${context.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${context.operationId}::uuid
        WHERE "id" = ${ticket.id}::uuid
          AND "secretHash" = ${ticket.secretHash}
          AND "webSessionId" = ${context.webSessionId}::uuid
          AND "consumedAt" IS NULL
          AND "invalidatedAt" IS NULL
          AND "expiresAt" > ${context.now}`,
    );
    return consumed === 1;
  }

  private async recordAudit(
    tx: Prisma.TransactionClient,
    args: {
      principal: V1Principal;
      projectId: string;
      access: V1ProjectContext;
      context: ProjectWriteContext;
      canonical: CanonicalRepositoryLocator;
      view: RepositoryDeclarationView;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const stamp = await tx.principalStamp.create({
      data: {
        kind: 'HUMAN',
        userId: args.principal.userId,
        webSessionId: args.context.webSessionId,
        projectId: args.projectId,
        userAuthVersion: args.context.userAuthVersion,
        memberVersion: args.access.membership.version,
        scopeSnapshot: [],
      },
    });
    await tx.auditEvent.create({
      data: {
        projectId: args.projectId,
        actorStampId: stamp.id,
        action: REPOSITORY_DECLARE,
        targetType: 'PROJECT_REPOSITORY',
        targetId: args.view.repositoryId,
        targetVersion: args.view.projectVersion,
        outcome: 'SUCCESS',
        details: args.details as Prisma.InputJsonValue,
      },
    });
  }

  private async runWithRetry<T>(run: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run();
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
      }
    }
  }
}
