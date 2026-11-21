import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import { isUuidShaped } from '../common/v1-idempotency';
import { PrismaService } from '../prisma/prisma.service';
import type { V1DocumentView } from './v1-publication.service';

export type V1RequirementPublishedPrd = {
  document: V1DocumentView;
  publishedRevision: {
    id: string;
    documentId: string;
    seq: number;
    title: string;
    digest: string;
  };
};

export type V1RequirementPublishedPrds = {
  items: V1RequirementPublishedPrd[];
  total: number;
};

const DOCUMENT_SELECT = {
  id: true,
  projectId: true,
  knowledgeBaseId: true,
  requirementId: true,
  kind: true,
  version: true,
  currentPublishedRevisionId: true,
  archivedAt: true,
} satisfies Prisma.KnowledgeDocumentSelect;

// Task review needs an exact publication reference, not revision history or acceptance JSON.
const PUBLISHED_REVISION_SELECT = {
  id: true,
  documentId: true,
  projectId: true,
  seq: true,
  title: true,
  sha256: true,
} satisfies Prisma.DocumentRevisionSelect;

function publicationChanged(): never {
  throw new WorkmeshError(
    V1_ERROR_CODES.RESOURCE_CONFLICT,
    'PRD_PUBLICATION_REFRESH_REQUIRED',
    undefined,
    409,
  );
}

/** A two-row uniqueness projection; legacy complete document reads remain unchanged. */
@Injectable()
export class V1RequirementPrdsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  async list(
    principal: Principal,
    projectId: string,
    requirementId: string,
  ): Promise<V1RequirementPublishedPrds> {
    if (!isUuidShaped(projectId) || !isUuidShaped(requirementId))
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'PRD_CONTEXT_ID_INVALID',
        undefined,
        422,
      );

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const repository = V1AuthorizationPrismaRepository.forTransaction(tx);
        await this.authorization.resolveProjectContext(principal, projectId, 'read', repository);
        const requirement = await tx.requirement.findFirst({
          where: { id: requirementId, projectId },
          select: { id: true },
        });
        if (!requirement)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'REQUIREMENT_NOT_FOUND',
            undefined,
            404,
          );

        const candidates: Prisma.KnowledgeDocumentWhereInput = {
          projectId,
          requirementId,
          kind: 'PRD',
          archivedAt: null,
          currentPublishedRevisionId: { not: null },
        };
        const knowledgeBases = await tx.knowledgeBase.findMany({
          where: { projectId, documents: { some: candidates } },
          select: { id: true },
        });
        const readableKnowledgeBaseIds: string[] = [];
        for (const { id: knowledgeBaseId } of knowledgeBases) {
          const access = await this.authorization.resolveKnowledgeAccess(
            principal,
            knowledgeBaseId,
            repository,
          );
          if (access.isActiveMember && access.canRead && access.projectId === projectId)
            readableKnowledgeBaseIds.push(knowledgeBaseId);
        }
        if (readableKnowledgeBaseIds.length === 0) return { items: [], total: 0 };

        const where: Prisma.KnowledgeDocumentWhereInput = {
          ...candidates,
          knowledgeBaseId: { in: readableKnowledgeBaseIds },
        };
        const total = await tx.knowledgeDocument.count({ where });
        const documents = await tx.knowledgeDocument.findMany({
          where,
          orderBy: { id: 'asc' },
          take: 2,
          select: DOCUMENT_SELECT,
        });
        const items: V1RequirementPublishedPrd[] = [];
        for (const document of documents) {
          if (!document.currentPublishedRevisionId) publicationChanged();
          const revision = await tx.documentRevision.findUnique({
            where: { id: document.currentPublishedRevisionId },
            select: PUBLISHED_REVISION_SELECT,
          });
          if (
            !revision ||
            revision.documentId !== document.id ||
            revision.projectId !== document.projectId
          )
            publicationChanged();
          items.push({
            document: { ...document, kind: 'PRD' },
            publishedRevision: {
              id: revision.id,
              documentId: revision.documentId,
              seq: revision.seq,
              title: revision.title,
              digest: revision.sha256,
            },
          });
        }
        return { items, total };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }
}
