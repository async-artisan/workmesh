import { Module } from '@nestjs/common';
import { V1_IDEMPOTENCY_REPOSITORY } from '../common/v1-idempotency';
import { V1IdempotencyPrismaRepository } from '../common/v1-idempotency.prisma-repository';
import { DelegationsController } from './delegations.controller';
import { DelegationsService } from './delegations.service';
import { V1_REVIEW_REPOSITORY } from './v1-review.repository';
import { V1ReviewPrismaRepository } from './v1-review.prisma-repository';
import {
  V1ProjectReviewController,
  V1ReviewController,
  V1ReviewDecisionController,
} from './v1-review.controller';
import { V1ReviewService } from './v1-review.service';
import { V1ReviewDiscussionController } from './v1-review-discussion.controller';
import { V1ReviewDiscussionService } from './v1-review-discussion.service';

@Module({
  controllers: [
    V1ReviewController,
    V1ReviewDecisionController,
    V1ProjectReviewController,
    DelegationsController,
    V1ReviewDiscussionController,
  ],
  providers: [
    { provide: V1_IDEMPOTENCY_REPOSITORY, useClass: V1IdempotencyPrismaRepository },
    { provide: V1_REVIEW_REPOSITORY, useClass: V1ReviewPrismaRepository },
    V1ReviewService,
    DelegationsService,
    V1ReviewDiscussionService,
  ],
  exports: [V1ReviewService, V1_IDEMPOTENCY_REPOSITORY],
})
export class V1ReviewModule {}
