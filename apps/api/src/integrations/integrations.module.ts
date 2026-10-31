import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { CommitParserService } from './commit-parser.service';
import { GitIntegrationService } from './git-integration.service';
@Module({
  controllers: [WebhookController],
  providers: [CommitParserService, GitIntegrationService],
  exports: [CommitParserService, GitIntegrationService],
})
export class IntegrationsModule {}
