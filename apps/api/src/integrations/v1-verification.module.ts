import { Module } from '@nestjs/common';
import { V1VerificationController } from './v1-verification.controller';
import { V1VerificationService, V1_ACTIONS_ADAPTER } from './v1-verification.service';
import { GithubActionsAdapter } from './v1-actions-adapter';

@Module({
  controllers: [V1VerificationController],
  providers: [V1VerificationService, { provide: V1_ACTIONS_ADAPTER, useFactory: () => new GithubActionsAdapter() }],
  exports: [V1VerificationService],
})
export class V1VerificationModule {}
