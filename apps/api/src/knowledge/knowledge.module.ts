import { Module } from '@nestjs/common';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';
import { V1KnowledgeBaseController } from './v1-knowledge-base.controller';
import { V1KnowledgeBasePrismaRepository } from './v1-knowledge-base.prisma-repository';
import { V1_KNOWLEDGE_BASE_REPOSITORY } from './v1-knowledge-base.repository';
import { V1KnowledgeBaseService } from './v1-knowledge-base.service';
import { V1PublicationController } from './v1-publication.controller';
import { V1PublicationPrismaRepository } from './v1-publication.prisma-repository';
import { V1PublicationService, V1_PUBLICATION_REPOSITORY } from './v1-publication.service';

@Module({
  controllers: [V1PublicationController, V1KnowledgeBaseController],
  providers: [
    V1PublicationService,
    V1KnowledgeBaseService,
    { provide: V1_PUBLICATION_REPOSITORY, useClass: V1PublicationPrismaRepository },
    { provide: V1_KNOWLEDGE_BASE_REPOSITORY, useClass: V1KnowledgeBasePrismaRepository },
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
  ],
  exports: [V1PublicationService, V1_PUBLICATION_REPOSITORY, V1KnowledgeBaseService, V1_KNOWLEDGE_BASE_REPOSITORY],
})
export class KnowledgeModule {}
