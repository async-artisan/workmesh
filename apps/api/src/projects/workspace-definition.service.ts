import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  principalScopeKey,
  projectScopeKey,
  type ActionBinding,
  type Confirmation,
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
import type {
  PublishWorkspaceDefinitionDto,
  SaveWorkspaceDefinitionDraftDto,
  ValidateWorkspaceDefinitionDto,
} from './workspace-definition.dto';
import {
  collectDocumentReferences,
  normalizeWorkspaceDefinition,
  validateWorkspaceDefinitionPayload,
  workspaceDefinitionDigest,
  type WorkspaceDefinitionIssue,
  type WorkspaceDefinitionPayload,
} from './workspace-definition-validator';
import {
  projectVersionConflict,
  runWithSerializableRetry,
  type ProjectWriteContext,
} from './projects.service';

export const WORKSPACE_DEFINITION_PUBLISH = 'WORKSPACE_DEFINITION_PUBLISH';
export const WORKSPACE_DEFINITION_TARGET = 'PROJECT_WORKSPACE_DEFINITION';

const SERIALIZABLE = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type WorkspaceRepositoryView = {
  key: string;
  projectRepositoryId: string;
  suggestedPath: string | null;
  defaultRef: string | null;
  description: string | null;
  identityMode: string;
  adapter: string | null;
  externalId: string | null;
  owner: string;
  name: string;
  archivedAt: string | null;
  provider: { adapter: string; externalId: string } | null;
  locators: Array<{ id: string; canonicalLocator: string; source: string; declaredAt: string }>;
};

export type WorkspaceValidationView = {
  valid: boolean;
  issues: WorkspaceDefinitionIssue[];
};

export type WorkspaceDefinitionReadView = {
  definitionStatus: 'CONFIGURED' | 'NOT_CONFIGURED';
  projectId: string;
  projectVersion: number;
  definitionVersion: number;
  revisionId: string | null;
  revisionNo: number | null;
  digest: string | null;
  publishedAt: string | null;
  publishedByUserId: string | null;
  payload: WorkspaceDefinitionPayload | null;
  repositories: WorkspaceRepositoryView[];
  draft: {
    definitionVersion: number;
    payloadDigest: string;
    payload: WorkspaceDefinitionPayload;
    updatedAt: string;
  } | null;
  validation: WorkspaceValidationView;
};

export type WorkspaceDefinitionRevisionView = {
  revisionId: string;
  revisionNo: number;
  digest: string;
  payload: WorkspaceDefinitionPayload;
  publishedAt: string;
  publishedByUserId: string | null;
  definitionVersion: number;
  projectVersion: number;
  repositories: WorkspaceRepositoryView[];
  validation: WorkspaceValidationView;
};

export type WorkspaceDefinitionDraftView = {
  definitionVersion: number;
  payloadDigest: string;
  projectVersion: number;
  updatedAt: string;
  replayed: boolean;
};

export type WorkspaceDefinitionPublishView = {
  revisionId: string;
  revisionNo: number;
  digest: string;
  definitionVersion: number;
  projectVersion: number;
  publishedAt: string;
  replayed: boolean;
};

export type WorkspaceDefinitionValidateView = {
  valid: boolean;
  digest: string | null;
  definition: WorkspaceDefinitionPayload | null;
  issues: WorkspaceDefinitionIssue[];
};

function notFound(code: string, details: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, code, details, 404);
}

function managerRequired(projectId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.FORBIDDEN,
    'PROJECT_MANAGER_REQUIRED',
    { projectId },
    403,
  );
}

function definitionVersionConflict(
  expectedDefinitionVersion: number,
  currentDefinitionVersion: number,
): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.DEFINITION_VERSION_CONFLICT,
    'DEFINITION_VERSION_CONFLICT',
    { expectedDefinitionVersion, currentDefinitionVersion },
    409,
  );
}

function definitionDigestConflict(
  payloadDigest: string,
  currentDigest: string | null,
): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.DEFINITION_DIGEST_CONFLICT,
    'DEFINITION_DIGEST_CONFLICT',
    { payloadDigest, currentDigest },
    409,
  );
}

function definitionNotSaved(projectId: string): WorkmeshError {
  return new WorkmeshError(
    V1_ERROR_CODES.DEFINITION_NOT_SAVED,
    'DEFINITION_NOT_SAVED',
    { projectId },
    409,
  );
}

function invalidDefinition(issues: WorkspaceDefinitionIssue[]): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.VALIDATION_FAILED, 'DEFINITION_INVALID', { issues }, 422);
}

/**
 * 平台工作区定义生命周期：draft / validate / publish / current read / revision read。
 *
 * 关键契约：
 * - 服务端重新规范化并计算 digest，客户端值只用于声明；
 * - 幂等回放先于版本/摘要 CAS；同 key 同摘要重放即使版本已变化也返回原响应；
 * - 发布在单事务内递增 `Project.version` 与 `Definition.version`，写不可变 revision 与审计；
 * - 文档引用只存在 payload JSON 中：不建关系表/FK，发布校验、读取复核。
 */
@Injectable()
export class WorkspaceDefinitionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly tickets: V1ConfirmationRepository,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async getDefinition(
    principal: V1Principal,
    projectId: string,
  ): Promise<WorkspaceDefinitionReadView> {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { version: true },
    });
    if (!project) throw notFound('PROJECT_NOT_FOUND', { projectId });

    const definition = await this.prisma.projectWorkspaceDefinition.findUnique({
      where: { projectId },
      select: {
        version: true,
        draftPayload: true,
        draftDigest: true,
        updatedAt: true,
        currentRevisionNo: true,
        currentRevision: {
          select: {
            id: true,
            revisionNo: true,
            digest: true,
            payload: true,
            publishedAt: true,
            publishedByUserId: true,
          },
        },
      },
    });

    const current = definition?.currentRevision ?? null;
    const payload = current ? (current.payload as unknown as WorkspaceDefinitionPayload) : null;
    const repositories = current ? await this.loadRevisionRepositories(current.id) : [];
    const validation =
      payload !== null
        ? await this.collectValidation(principal, projectId, payload)
        : { valid: true, issues: [] };

    const draft =
      definition?.draftPayload && definition.draftDigest
        ? {
            definitionVersion: definition.version,
            payloadDigest: definition.draftDigest,
            payload: definition.draftPayload as unknown as WorkspaceDefinitionPayload,
            updatedAt: definition.updatedAt.toISOString(),
          }
        : null;

    return {
      definitionStatus: current ? 'CONFIGURED' : 'NOT_CONFIGURED',
      projectId,
      projectVersion: project.version,
      definitionVersion: definition?.version ?? 0,
      revisionId: current?.id ?? null,
      revisionNo: current?.revisionNo ?? definition?.currentRevisionNo ?? null,
      digest: current?.digest ?? null,
      publishedAt: current?.publishedAt.toISOString() ?? null,
      publishedByUserId: current?.publishedByUserId ?? null,
      payload,
      repositories,
      draft,
      validation,
    };
  }

  async getRevision(
    principal: V1Principal,
    projectId: string,
    revisionId: string,
  ): Promise<WorkspaceDefinitionRevisionView> {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    if (!UUID_SHAPE.test(revisionId))
      throw new WorkmeshError(
        V1_ERROR_CODES.REVISION_NOT_FOUND,
        'REVISION_NOT_FOUND',
        { revisionId },
        404,
      );
    const revision = await this.prisma.projectWorkspaceDefinitionRevision.findFirst({
      where: { id: revisionId, projectId },
      select: {
        id: true,
        revisionNo: true,
        digest: true,
        payload: true,
        publishedAt: true,
        publishedByUserId: true,
        definition: { select: { version: true } },
      },
    });
    if (!revision)
      throw new WorkmeshError(
        V1_ERROR_CODES.REVISION_NOT_FOUND,
        'REVISION_NOT_FOUND',
        { projectId, revisionId },
        404,
      );
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { version: true },
    });
    if (!project) throw notFound('PROJECT_NOT_FOUND', { projectId });

    const payload = revision.payload as unknown as WorkspaceDefinitionPayload;
    const repositories = await this.loadRevisionRepositories(revision.id);
    const validation = await this.collectValidation(principal, projectId, payload);
    return {
      revisionId: revision.id,
      revisionNo: revision.revisionNo,
      digest: revision.digest,
      payload,
      publishedAt: revision.publishedAt.toISOString(),
      publishedByUserId: revision.publishedByUserId,
      definitionVersion: revision.definition.version,
      projectVersion: project.version,
      repositories,
      validation,
    };
  }

  /**
   * 保存草稿：结构规范化 + 摘要 CAS + 版本 CAS；不写审计（§21.1 默认）。
   * 幂等回放先于版本校验：同 key 同摘要的旧请求即使发布已递增 definitionVersion 也返回原响应。
   */
  async saveDraft(
    principal: V1Principal,
    projectId: string,
    dto: SaveWorkspaceDefinitionDraftDto,
    context: ProjectWriteContext,
  ): Promise<WorkspaceDefinitionDraftView> {
    await this.requireManager(principal, projectId, 'write');
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
      return this.replayDraft(replay);
    }

    const normalized = normalizeWorkspaceDefinition(dto.definition, projectId);
    if (!normalized.ok) throw invalidDefinition(normalized.issues);
    const digest = workspaceDefinitionDigest(normalized.payload);
    if (digest !== dto.payloadDigest) throw definitionDigestConflict(dto.payloadDigest, digest);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { version: true, archivedAt: true },
    });
    if (!project) throw notFound('PROJECT_NOT_FOUND', { projectId });
    if (project.archivedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'PROJECT_ARCHIVED',
        { projectId, archivedAt: project.archivedAt.toISOString() },
        409,
      );

    try {
      return await runWithSerializableRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await this.lockProject(tx, projectId);
          await this.lockMembership(tx, projectId, principal.userId);
          await this.requireManager(principal, projectId, 'write', tx);
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
            return this.replayDraft(committed);
          }
          const lockedProject = await tx.project.findUnique({
            where: { id: projectId },
            select: { version: true, archivedAt: true },
          });
          if (!lockedProject) throw notFound('PROJECT_NOT_FOUND', { projectId });
          if (lockedProject.archivedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'PROJECT_ARCHIVED',
              { projectId, archivedAt: lockedProject.archivedAt.toISOString() },
              409,
            );
          const definition = await tx.projectWorkspaceDefinition.findUnique({
            where: { projectId },
            select: { id: true, version: true },
          });
          const currentVersion = definition?.version ?? 0;
          if (dto.expectedDefinitionVersion !== currentVersion)
            throw definitionVersionConflict(dto.expectedDefinitionVersion, currentVersion);

          let saved: { version: number; updatedAt: Date };
          if (!definition) {
            saved = await tx.projectWorkspaceDefinition.create({
              data: {
                projectId,
                version: 1,
                draftPayload: normalized.payload as unknown as Prisma.InputJsonValue,
                draftDigest: digest,
                updatedByUserId: principal.userId,
              },
              select: { version: true, updatedAt: true },
            });
          } else {
            saved = await tx.projectWorkspaceDefinition.update({
              where: { id: definition.id },
              data: {
                version: { increment: 1 },
                draftPayload: normalized.payload as unknown as Prisma.InputJsonValue,
                draftDigest: digest,
                updatedByUserId: principal.userId,
              },
              select: { version: true, updatedAt: true },
            });
          }

          const view: WorkspaceDefinitionDraftView = {
            definitionVersion: saved.version,
            payloadDigest: digest,
            projectVersion: lockedProject.version,
            updatedAt: saved.updatedAt.toISOString(),
            replayed: false,
          };
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
          return view;
        }, SERIALIZABLE),
      );
    } catch (error) {
      if (error instanceof WorkmeshError && (error.status === 403 || error.status === 404))
        throw error;
      const errorCode = (error as { code?: string } | null)?.code;
      const existing = await this.operations.findOperation({
        projectScopeKey: projectScopeKey(projectId),
        principalScopeKey: principalScopeKey(principal),
        key: context.idempotencyKey,
      });
      if (existing) {
        this.assertSameRequest(existing, context, requestDigest);
        return this.replayDraft(existing);
      }
      if (errorCode !== 'P2002') throw error;
      const definition = await this.prisma.projectWorkspaceDefinition.findUnique({
        where: { projectId },
        select: { version: true },
      });
      throw definitionVersionConflict(dto.expectedDefinitionVersion, definition?.version ?? 0);
    }
  }

  /** 只读诊断：内容问题以 200 + valid:false 返回，不是 HTTP 错误。 */
  async validate(
    principal: V1Principal,
    projectId: string,
    dto: ValidateWorkspaceDefinitionDto,
  ): Promise<WorkspaceDefinitionValidateView> {
    await this.requireManager(principal, projectId, 'read');
    let raw: unknown;
    if (dto.definition !== undefined) {
      raw = dto.definition;
    } else {
      const definition = await this.prisma.projectWorkspaceDefinition.findUnique({
        where: { projectId },
        select: { draftPayload: true },
      });
      if (!definition?.draftPayload)
        return {
          valid: false,
          digest: null,
          definition: null,
          issues: [
            {
              path: '$',
              code: 'DRAFT_NOT_FOUND',
              message: '没有可校验的草稿，请先保存草稿或提交 definition',
            },
          ],
        };
      raw = definition.draftPayload;
    }

    const normalized = normalizeWorkspaceDefinition(raw, projectId);
    if (!normalized.ok)
      return { valid: false, digest: null, definition: null, issues: normalized.issues };
    const issues = [
      ...validateWorkspaceDefinitionPayload(normalized.payload),
      ...(await this.collectReferenceIssues(principal, projectId, normalized.payload)),
    ];
    return {
      valid: issues.length === 0,
      digest: workspaceDefinitionDigest(normalized.payload),
      definition: normalized.payload,
      issues,
    };
  }

  /**
   * 发布草稿：票据 + 双版本 CAS + 摘要 CAS + 幂等回放；同一事务内写不可变 revision、
   * 递增 definitionVersion 与 Project.version、清空 draft 并写审计。
   */
  async publish(
    principal: V1Principal,
    projectId: string,
    dto: PublishWorkspaceDefinitionDto,
    context: ProjectWriteContext,
  ): Promise<WorkspaceDefinitionPublishView> {
    await this.requireManager(principal, projectId, 'write');
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });
    const replay = await this.findPublishReplay(principal, projectId, context, requestDigest);
    if (replay) return replay;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { version: true, archivedAt: true },
    });
    if (!project) throw notFound('PROJECT_NOT_FOUND', { projectId });
    if (project.archivedAt) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'PROJECT_ARCHIVED',
        { projectId, archivedAt: project.archivedAt.toISOString() },
        409,
      );
    }

    const definition = await this.prisma.projectWorkspaceDefinition.findUnique({
      where: { projectId },
      select: {
        id: true,
        version: true,
        draftPayload: true,
        draftDigest: true,
        currentRevisionNo: true,
      },
    });
    if (!definition?.draftPayload || !definition.draftDigest) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw definitionNotSaved(projectId);
    }
    if (project.version !== dto.expectedProjectVersion) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw projectVersionConflict(dto.expectedProjectVersion, project.version);
    }
    if (definition.version !== dto.expectedDefinitionVersion) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw definitionVersionConflict(dto.expectedDefinitionVersion, definition.version);
    }

    const normalized = normalizeWorkspaceDefinition(definition.draftPayload, projectId);
    if (!normalized.ok) throw invalidDefinition(normalized.issues);
    const serverDigest = workspaceDefinitionDigest(normalized.payload);
    if (dto.payloadDigest !== definition.draftDigest || dto.payloadDigest !== serverDigest) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw definitionDigestConflict(dto.payloadDigest, definition.draftDigest);
    }

    const issues = [
      ...validateWorkspaceDefinitionPayload(normalized.payload),
      ...(await this.collectReferenceIssues(principal, projectId, normalized.payload)),
    ];
    if (issues.length > 0) throw invalidDefinition(issues);

    // Recheck after the preflight because another same-key request may have committed
    // while reference validation ran. This also avoids treating its consumed ticket as a
    // fresh invalid confirmation.
    const lateReplay = await this.findPublishReplay(principal, projectId, context, requestDigest);
    if (lateReplay) return lateReplay;
    let ticket: Awaited<ReturnType<WorkspaceDefinitionService['requireTicket']>>;
    try {
      ticket = await this.requireTicket(principal, projectId, dto, context);
    } catch (error) {
      const committed = await this.findPublishReplay(principal, projectId, context, requestDigest);
      if (committed) return committed;
      throw error;
    }

    try {
      return await runWithSerializableRetry(() =>
        this.prisma.$transaction(async (tx) => {
          await this.lockProject(tx, projectId);
          await this.lockMembership(tx, projectId, principal.userId);
          const access = await this.requireManager(principal, projectId, 'write', tx);
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
            return this.replayPublish(committed);
          }
          const lockedProject = await tx.project.findUnique({
            where: { id: projectId },
            select: { version: true, archivedAt: true },
          });
          if (!lockedProject) throw notFound('PROJECT_NOT_FOUND', { projectId });
          if (lockedProject.archivedAt)
            throw new WorkmeshError(
              V1_ERROR_CODES.RESOURCE_CONFLICT,
              'PROJECT_ARCHIVED',
              { projectId, archivedAt: lockedProject.archivedAt.toISOString() },
              409,
            );
          if (lockedProject.version !== dto.expectedProjectVersion)
            throw projectVersionConflict(dto.expectedProjectVersion, lockedProject.version);

          const lockedDefinition = await tx.projectWorkspaceDefinition.findUnique({
            where: { projectId },
            select: {
              id: true,
              version: true,
              draftPayload: true,
              draftDigest: true,
              currentRevisionNo: true,
            },
          });
          if (!lockedDefinition?.draftPayload || !lockedDefinition.draftDigest)
            throw definitionNotSaved(projectId);
          if (lockedDefinition.version !== dto.expectedDefinitionVersion)
            throw definitionVersionConflict(
              dto.expectedDefinitionVersion,
              lockedDefinition.version,
            );
          if (lockedDefinition.draftDigest !== dto.payloadDigest)
            throw definitionDigestConflict(dto.payloadDigest, lockedDefinition.draftDigest);

          // Hold shared locks on every mutable fact used to validate this payload.
          // Repository/document archival and permission revocation cannot slip between
          // the final validation and this revision's commit.
          await this.lockReferenceState(tx, principal, projectId, normalized.payload);
          const finalReferenceIssues = await this.collectReferenceIssues(
            principal,
            projectId,
            normalized.payload,
            tx,
          );
          if (finalReferenceIssues.length > 0) throw invalidDefinition(finalReferenceIssues);

          const consumed = await this.consumeTicket(tx, ticket, context);
          if (!consumed)
            throw new WorkmeshError(
              V1_ERROR_CODES.CONFIRMATION_USED,
              'CONFIRMATION_CONSUME_CONFLICT',
              { ticketId: ticket.id },
              409,
            );

          const revisionNo = (lockedDefinition.currentRevisionNo ?? 0) + 1;
          const revision = await tx.projectWorkspaceDefinitionRevision.create({
            data: {
              definitionId: lockedDefinition.id,
              projectId,
              revisionNo,
              digest: serverDigest,
              payload: normalized.payload as unknown as Prisma.InputJsonValue,
              publishedByUserId: principal.userId,
              publishedAt: context.now,
            },
            select: { id: true },
          });
          await tx.projectWorkspaceDefinitionRevisionRepository.createMany({
            data: normalized.payload.repositories.map((repository) => ({
              revisionId: revision.id,
              repositoryId: repository.projectRepositoryId,
              logicalKey: repository.key,
              suggestedPath: repository.suggestedPath,
              defaultRef: repository.defaultRef,
              description: repository.description,
            })),
          });

          const definitionVersion = dto.expectedDefinitionVersion + 1;
          await tx.projectWorkspaceDefinition.update({
            where: { id: lockedDefinition.id },
            data: {
              version: definitionVersion,
              currentRevisionId: revision.id,
              currentRevisionNo: revisionNo,
              draftPayload: Prisma.DbNull,
              draftDigest: null,
              updatedByUserId: principal.userId,
            },
          });

          const projectVersion = dto.expectedProjectVersion + 1;
          const bumped = await tx.project.updateMany({
            where: {
              id: projectId,
              version: dto.expectedProjectVersion,
              archivedAt: null,
            },
            data: { version: { increment: 1 } },
          });
          if (bumped.count !== 1)
            throw projectVersionConflict(dto.expectedProjectVersion, lockedProject.version);

          const view: WorkspaceDefinitionPublishView = {
            revisionId: revision.id,
            revisionNo,
            digest: serverDigest,
            definitionVersion,
            projectVersion,
            publishedAt: context.now.toISOString(),
            replayed: false,
          };
          await this.recordPublishAudit(tx, {
            principal,
            access,
            context,
            projectId,
            view,
            repositoryKeys: normalized.payload.repositories.map((repository) => repository.key),
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
          return view;
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
      if (existing) {
        this.assertSameRequest(existing, context, requestDigest);
        return this.replayPublish(existing);
      }
      throw error;
    }
  }

  private async loadRevisionRepositories(revisionId: string): Promise<WorkspaceRepositoryView[]> {
    const rows = await this.prisma.projectWorkspaceDefinitionRevisionRepository.findMany({
      where: { revisionId },
      orderBy: { logicalKey: 'asc' },
      select: {
        logicalKey: true,
        suggestedPath: true,
        defaultRef: true,
        description: true,
        repository: {
          select: {
            id: true,
            identityMode: true,
            adapter: true,
            externalId: true,
            owner: true,
            name: true,
            archivedAt: true,
            locators: {
              where: { revokedAt: null },
              orderBy: { declaredAt: 'asc' },
              select: { id: true, canonicalLocator: true, source: true, declaredAt: true },
            },
          },
        },
      },
    });
    return rows.map((row) => ({
      key: row.logicalKey,
      projectRepositoryId: row.repository.id,
      suggestedPath: row.suggestedPath,
      defaultRef: row.defaultRef,
      description: row.description,
      identityMode: row.repository.identityMode,
      adapter: row.repository.adapter,
      externalId: row.repository.externalId,
      owner: row.repository.owner,
      name: row.repository.name,
      archivedAt: row.repository.archivedAt ? row.repository.archivedAt.toISOString() : null,
      provider:
        row.repository.identityMode === 'PROVIDER' &&
        row.repository.adapter &&
        row.repository.externalId
          ? { adapter: row.repository.adapter, externalId: row.repository.externalId }
          : null,
      locators: row.repository.locators.map((locator) => ({
        id: locator.id,
        canonicalLocator: locator.canonicalLocator,
        source: locator.source,
        declaredAt: locator.declaredAt.toISOString(),
      })),
    }));
  }

  private async collectValidation(
    principal: V1Principal,
    projectId: string,
    payload: WorkspaceDefinitionPayload,
  ): Promise<WorkspaceValidationView> {
    const issues = [
      ...validateWorkspaceDefinitionPayload(payload),
      ...(await this.collectReferenceIssues(principal, projectId, payload)),
    ];
    return { valid: issues.length === 0, issues };
  }

  /**
   * 发布/读取时的引用复核：仓库必须属于本项目且未归档；文档必须存在、同项目、未归档且当前
   * 主体可读。文档关系不落库，只在 payload JSON 内保存引用。
   */
  private async collectReferenceIssues(
    principal: V1Principal,
    projectId: string,
    payload: WorkspaceDefinitionPayload,
    tx?: Prisma.TransactionClient,
  ): Promise<WorkspaceDefinitionIssue[]> {
    const issues: WorkspaceDefinitionIssue[] = [];

    const repositoryIds = payload.repositories.map((entry) => entry.projectRepositoryId);
    if (repositoryIds.length > 0) {
      const rows = await (tx ?? this.prisma).projectRepository.findMany({
        where: { id: { in: repositoryIds } },
        select: { id: true, projectId: true, archivedAt: true },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      payload.repositories.forEach((entry, index) => {
        const row = byId.get(entry.projectRepositoryId);
        if (!row || row.projectId !== projectId)
          issues.push({
            path: `repositories[${index}].projectRepositoryId`,
            code: 'REPOSITORY_NOT_FOUND',
            message: '仓库不存在或不属于本项目',
          });
        else if (row.archivedAt)
          issues.push({
            path: `repositories[${index}].projectRepositoryId`,
            code: 'REPOSITORY_ARCHIVED',
            message: '仓库已归档，不能进入工作区定义',
          });
      });
    }

    const references = collectDocumentReferences(payload);
    if (references.length > 0) {
      const documentIds = [...new Set(references.map((reference) => reference.documentId))];
      const documents = await (tx ?? this.prisma).knowledgeDocument.findMany({
        where: { id: { in: documentIds } },
        select: { id: true, projectId: true, knowledgeBaseId: true, archivedAt: true },
      });
      const byId = new Map(documents.map((document) => [document.id, document]));
      const accessCache = new Map<string, boolean>();
      for (const reference of references) {
        const document = byId.get(reference.documentId);
        if (!document || document.projectId !== projectId) {
          issues.push({
            path: reference.path,
            code: 'DOCUMENT_NOT_FOUND',
            message: '文档不存在或不属于本项目',
          });
          continue;
        }
        if (document.archivedAt) {
          issues.push({
            path: reference.path,
            code: 'DOCUMENT_ARCHIVED',
            message: '文档已归档，不能进入工作区定义',
          });
          continue;
        }
        let readable = accessCache.get(document.knowledgeBaseId);
        if (readable === undefined) {
          try {
            const access = await this.authorization.resolveKnowledgeAccess(
              principal,
              document.knowledgeBaseId,
              tx ? V1AuthorizationPrismaRepository.forTransaction(tx) : undefined,
            );
            readable = access.canRead;
          } catch {
            readable = false;
          }
          accessCache.set(document.knowledgeBaseId, readable);
        }
        if (!readable)
          issues.push({
            path: reference.path,
            code: 'DOCUMENT_FORBIDDEN',
            message: '当前主体无权读取该文档',
          });
      }
    }
    return issues;
  }

  /** 管理类定义写操作的统一顺序：HUMAN 会话 → 项目上下文（归档项目 write 409）→ OWNER/ADMIN。 */
  private async requireManager(
    principal: V1Principal,
    projectId: string,
    mode: 'read' | 'write',
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
      mode,
      tx ? V1AuthorizationPrismaRepository.forTransaction(tx) : undefined,
    );
    if (access.membership.role !== 'OWNER' && access.membership.role !== 'ADMIN')
      throw managerRequired(projectId);
    return access;
  }

  private async requireTicket(
    principal: V1Principal,
    projectId: string,
    dto: PublishWorkspaceDefinitionDto,
    context: ProjectWriteContext,
  ) {
    const binding: ActionBinding = {
      action: WORKSPACE_DEFINITION_PUBLISH,
      projectId,
      targetType: WORKSPACE_DEFINITION_TARGET,
      targetId: projectId,
      expectedVersion: dto.expectedProjectVersion,
      roleSlot: null,
      payload: {
        expectedDefinitionVersion: dto.expectedDefinitionVersion,
        payloadDigest: dto.payloadDigest,
      },
    };
    const ticket = await this.tickets.findTicket(dto.confirmation.ticketId);
    if (!ticket)
      throw new WorkmeshError(
        V1_ERROR_CODES.CONFIRMATION_INVALID,
        'CONFIRMATION_NOT_FOUND',
        { ticketId: dto.confirmation.ticketId },
        403,
      );
    verifyTicketBinding({
      ticket,
      confirmation: dto.confirmation as Confirmation,
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
    if (locked.length === 0) throw notFound('PROJECT_NOT_FOUND', { projectId });
  }

  private async lockMembership(
    tx: Prisma.TransactionClient,
    projectId: string,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw(Prisma.sql`SELECT "projectId" FROM "workmesh_v1"."ProjectMember"
      WHERE "projectId" = ${projectId}::uuid AND "userId" = ${userId}::uuid FOR SHARE`);
  }

  private async lockReferenceState(
    tx: Prisma.TransactionClient,
    principal: V1Principal,
    projectId: string,
    payload: WorkspaceDefinitionPayload,
  ): Promise<void> {
    const repositoryIds = [
      ...new Set(payload.repositories.map((item) => item.projectRepositoryId)),
    ];
    if (repositoryIds.length > 0) {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "workmesh_v1"."ProjectRepository"
          WHERE "id" IN (${Prisma.join(repositoryIds.map((id) => Prisma.sql`${id}::uuid`))})
          FOR SHARE`,
      );
    }
    const documentIds = [
      ...new Set(collectDocumentReferences(payload).map((item) => item.documentId)),
    ];
    if (documentIds.length === 0) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."KnowledgeDocument"
        WHERE "id" IN (${Prisma.join(documentIds.map((id) => Prisma.sql`${id}::uuid`))})
        FOR SHARE`,
    );
    const documents = await tx.knowledgeDocument.findMany({
      where: { id: { in: documentIds } },
      select: { knowledgeBaseId: true },
    });
    const knowledgeBaseIds = [...new Set(documents.map((item) => item.knowledgeBaseId))];
    if (knowledgeBaseIds.length === 0) return;
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."KnowledgeBase"
        WHERE "id" IN (${Prisma.join(knowledgeBaseIds.map((id) => Prisma.sql`${id}::uuid`))})
        FOR SHARE`,
    );
    // Authorization is resolved again after these locks are held below. Lock all
    // grant/assignment rows in scope so a concurrent revoke waits until publish ends.
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."KnowledgeBaseGrant"
        WHERE "knowledgeBaseId" IN (${Prisma.join(knowledgeBaseIds.map((id) => Prisma.sql`${id}::uuid`))})
        FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."ProjectRoleAssignment"
        WHERE "projectId" = ${projectId}::uuid AND "userId" = ${principal.userId}::uuid
        FOR SHARE`,
    );
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "workmesh_v1"."ProjectRole"
        WHERE "projectId" = ${projectId}::uuid
        FOR SHARE`,
    );
  }

  private async consumeTicket(
    tx: Prisma.TransactionClient,
    ticket: Awaited<ReturnType<WorkspaceDefinitionService['requireTicket']>>,
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

  private async recordPublishAudit(
    tx: Prisma.TransactionClient,
    args: {
      principal: V1Principal;
      access: V1ProjectContext;
      context: ProjectWriteContext;
      projectId: string;
      view: WorkspaceDefinitionPublishView;
      repositoryKeys: string[];
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
        action: WORKSPACE_DEFINITION_PUBLISH,
        targetType: WORKSPACE_DEFINITION_TARGET,
        targetId: args.projectId,
        targetVersion: args.view.projectVersion,
        outcome: 'SUCCESS',
        details: {
          revisionId: args.view.revisionId,
          revisionNo: args.view.revisionNo,
          digest: args.view.digest,
          definitionVersion: args.view.definitionVersion,
          repositoryKeys: args.repositoryKeys,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private replayDraft(record: V1OperationRecord): WorkspaceDefinitionDraftView {
    const refs = record.resultRefs;
    return {
      definitionVersion: Number(refs.definitionVersion ?? 0),
      payloadDigest: String(refs.payloadDigest ?? ''),
      projectVersion: Number(refs.projectVersion ?? 0),
      updatedAt: String(refs.updatedAt ?? ''),
      replayed: true,
    };
  }

  private replayPublish(record: V1OperationRecord): WorkspaceDefinitionPublishView {
    const refs = record.resultRefs;
    return {
      revisionId: String(refs.revisionId ?? ''),
      revisionNo: Number(refs.revisionNo ?? 0),
      digest: String(refs.digest ?? ''),
      definitionVersion: Number(refs.definitionVersion ?? 0),
      projectVersion: Number(refs.projectVersion ?? 0),
      publishedAt: String(refs.publishedAt ?? ''),
      replayed: true,
    };
  }

  private async findPublishReplay(
    principal: V1Principal,
    projectId: string,
    context: ProjectWriteContext,
    requestDigest: string,
  ): Promise<WorkspaceDefinitionPublishView | null> {
    const record = await this.operations.findOperation({
      projectScopeKey: projectScopeKey(projectId),
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    });
    if (!record) return null;
    this.assertSameRequest(record, context, requestDigest);
    return this.replayPublish(record);
  }

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
}
