import { Module } from '@nestjs/common';
import { V1GithubEvidenceModule } from './v1-github-evidence.module';
import { V1VerificationModule } from './v1-verification.module';

@Module({
  imports: [V1GithubEvidenceModule, V1VerificationModule],
  exports: [V1GithubEvidenceModule, V1VerificationModule],
})
export class IntegrationsModule {}
