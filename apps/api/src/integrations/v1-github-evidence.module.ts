import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { V1GithubEvidenceController } from './v1-github-evidence.controller';
import { V1GithubEvidenceService, V1_GITHUB_WEBHOOK_SECRET } from './v1-github-evidence.service';
import { V1GithubEvidencePrismaRepository } from './v1-github-evidence.prisma-repository';
import { V1_GITHUB_EVIDENCE_REPOSITORY } from './v1-github-evidence.repository';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';

@Module({
  controllers: [V1GithubEvidenceController],
  providers: [
    V1GithubEvidenceService,
    { provide: V1_GITHUB_EVIDENCE_REPOSITORY, useClass: V1GithubEvidencePrismaRepository },
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
    {
      provide: V1_GITHUB_WEBHOOK_SECRET,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get<string>('GITHUB_WEBHOOK_SECRET') ?? '',
    },
  ],
  exports: [V1GithubEvidenceService],
})
export class V1GithubEvidenceModule {}
