import { Injectable } from '@nestjs/common';
import { principalScopeKey, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import {
  assertReplayable,
  requestDigestOf,
  requireExpectedVersion,
  type V1OperationRecord,
} from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import type { V1KnowledgeActionContext } from './v1-knowledge-base.service';

export type KnowledgeBindingInput = {
  expectedVersion: number;
  documentId: string;
  /** null 使该资料对项目全部业务角色生效，不授予知识库 READ 权限。 */
  roleId: string | null;
  required: boolean;
};

@Injectable()
export class V1KnowledgeBindingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
  ) {}

  async list(principal: V1Principal, projectId: string) {
    const access = await this.authorization.resolveProjectContext(principal, projectId, 'read');
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { knowledgeBindingsVersion: true },
    });
    const rows = await this.prisma.projectKnowledgeBinding.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        documentId: true,
        roleId: true,
        required: true,
        document: { select: { knowledgeBaseId: true } },
      },
    });
    const items = [];
    for (const { document, ...binding } of rows) {
      const knowledgeAccess = await this.authorization.resolveKnowledgeAccess(
        principal,
        document.knowledgeBaseId,
      );
      if (knowledgeAccess.canRead && !knowledgeAccess.knowledgeBase.archivedAt) items.push(binding);
    }
    return {
      version: project.knowledgeBindingsVersion,
      canManage:
        principal.kind === 'HUMAN' &&
        Boolean(principal.sessionId) &&
        !access.project.archivedAt &&
        ['OWNER', 'ADMIN'].includes(access.membership.role),
      items,
    };
  }

  /** 增加或更新一个绑定；项目版本 CAS、授权复查、审计和幂等结果在同一事务提交。 */
  async bind(
    principal: V1Principal,
    projectId: string,
    input: KnowledgeBindingInput,
    context: V1KnowledgeActionContext,
  ) {
    requireExpectedVersion(input.expectedVersion);
    if (principal.kind !== 'HUMAN' || !principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    const scope = {
      projectScopeKey: `project:${projectId}`,
      principalScopeKey: principalScopeKey(principal),
      key: context.idempotencyKey,
    };
    const digest = requestDigestOf(context);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
            const access = await this.authorization.resolveProjectContext(
              principal,
              projectId,
              'write',
              repository,
            );
            if (!['OWNER', 'ADMIN'].includes(access.membership.role))
              throw new WorkmeshError(
                V1_ERROR_CODES.FORBIDDEN,
                'PROJECT_MANAGER_REQUIRED',
                { projectId },
                403,
              );
            const existing = await tx.idempotentOperation.findUnique({
              where: { projectScopeKey_principalScopeKey_key: scope },
            });
            if (existing) {
              assertReplayable(existing as unknown as V1OperationRecord, {
                method: context.method,
                route: context.route,
                digest,
              });
              return (existing.resultRefs as Record<string, unknown>).knowledgeBinding;
            }
            const document = await tx.knowledgeDocument.findFirst({
              where: {
                id: input.documentId,
                projectId,
                archivedAt: null,
                kind: { in: ['KNOWLEDGE', 'DECISION'] },
                currentPublishedRevisionId: { not: null },
              },
              select: { id: true, knowledgeBaseId: true },
            });
            if (!document)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'PUBLISHED_KNOWLEDGE_NOT_FOUND',
                undefined,
                404,
              );
            const knowledgeAccess = await this.authorization.resolveKnowledgeAccess(
              principal,
              document.knowledgeBaseId,
              repository,
            );
            if (!knowledgeAccess.canRead || knowledgeAccess.knowledgeBase.archivedAt)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'PUBLISHED_KNOWLEDGE_NOT_FOUND',
                undefined,
                404,
              );
            if (
              input.roleId &&
              !(await tx.projectRole.findFirst({
                where: { id: input.roleId, projectId, isActive: true },
                select: { id: true },
              }))
            )
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_NOT_FOUND,
                'PROJECT_ROLE_NOT_FOUND',
                undefined,
                404,
              );
            const version = await tx.project.updateMany({
              where: {
                id: projectId,
                archivedAt: null,
                knowledgeBindingsVersion: input.expectedVersion,
              },
              data: { knowledgeBindingsVersion: { increment: 1 } },
            });
            if (version.count !== 1)
              throw new WorkmeshError(
                V1_ERROR_CODES.RESOURCE_CONFLICT,
                'KNOWLEDGE_BINDINGS_VERSION_CONFLICT',
                { expectedVersion: input.expectedVersion },
                409,
              );
            const stamp = await tx.principalStamp.create({
              data: {
                kind: 'HUMAN',
                userId: principal.userId,
                webSessionId: principal.sessionId,
                projectId,
                userAuthVersion: principal.authVersion ?? 0,
                memberVersion: access.membership.version,
                scopeSnapshot: [],
              },
              select: { id: true },
            });
            // roleId 为 null 时 PostgreSQL 的唯一约束不合并 NULL，因此必须在项目 CAS 后显式查找。
            const previous = await tx.projectKnowledgeBinding.findFirst({
              where: { projectId, documentId: input.documentId, roleId: input.roleId },
            });
            const data = {
              projectId,
              documentId: input.documentId,
              roleId: input.roleId,
              required: input.required,
              createdByStampId: stamp.id,
            };
            const binding = previous
              ? await tx.projectKnowledgeBinding.update({ where: { id: previous.id }, data })
              : await tx.projectKnowledgeBinding.create({ data });
            const result = {
              version: input.expectedVersion + 1,
              binding: {
                id: binding.id,
                documentId: binding.documentId,
                roleId: binding.roleId,
                required: binding.required,
              },
            };
            await tx.auditEvent.create({
              data: {
                projectId,
                actorStampId: stamp.id,
                action: 'KNOWLEDGE_BINDING_SET',
                targetType: 'PROJECT_KNOWLEDGE_BINDING',
                targetId: binding.id,
                targetVersion: result.version,
                outcome: 'SUCCESS',
                details: {
                  documentId: input.documentId,
                  roleId: input.roleId,
                  required: input.required,
                },
              },
            });
            await tx.idempotentOperation.create({
              data: {
                id: context.operationId,
                projectId,
                ...scope,
                method: context.method,
                route: context.route,
                requestDigest: digest,
                resultRefs: { knowledgeBinding: result },
                responseMetadata: {},
                committedAt: context.now,
              },
            });
            return result;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !['P2034', 'P2002'].includes(error.code) ||
          attempt >= 2
        )
          throw error;
      }
    }
  }
}
