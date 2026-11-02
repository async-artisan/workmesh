import { Module } from '@nestjs/common';
import { V1GithubEvidenceModule } from './v1-github-evidence.module';

@Module({
  imports: [V1GithubEvidenceModule],
  exports: [V1GithubEvidenceModule],
})
export class IntegrationsModule {}
