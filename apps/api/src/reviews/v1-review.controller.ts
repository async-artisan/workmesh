import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import type { V1ReviewStatus, V1ReviewSubjectKind } from './v1-review.repository';
import { V1ReviewService } from './v1-review.service';

const REVIEW_STATUS_VALUES: readonly V1ReviewStatus[] = [
  'OPEN',
  'APPROVED',
  'CHANGES_REQUESTED',
  'REJECTED',
  'INVALIDATED',
];

class ConfirmationDto {
  @IsUUID() ticketId!: string;

  @IsString() @MaxLength(64) ticketSecret!: string;
}

class DecideDto {
  @IsUUID() slotId!: string;

  @IsIn(['APPROVE', 'CHANGES_REQUESTED', 'REJECT']) decision!:
    'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

  /** expectedVersion 指 ReviewRequest 自身 version；不接受 0 或缺失。 */
  @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class BatchDecisionItemDto {
  @IsUUID() reviewId!: string;

  @IsUUID() slotId!: string;

  @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class BatchDecisionDto {
  @IsIn(['APPROVE', 'CHANGES_REQUESTED', 'REJECT']) decision!:
    'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

  /** 逐条独立校验；部分失败不影响其他条目。 */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => BatchDecisionItemDto)
  items!: BatchDecisionItemDto[];
}

class RevokeDto {
  /** expectedVersion 指父 ReviewRequest.version；决定自身没有可变版本。 */
  @IsInt() @Min(1) expectedVersion!: number;

  @IsString() @MinLength(1) @MaxLength(1000) reason!: string;

  @ValidateNested() @Type(() => ConfirmationDto) confirmation!: ConfirmationDto;
}

class ReviewSubjectDto {
  @IsIn(['DOCUMENT_REVISION', 'TASK_ARTIFACT_SET']) kind!: V1ReviewSubjectKind;

  @IsUUID() id!: string;
}

/** 客户端只能声明 subject 与版本；kind、slots 与 approved 一律服务端派生。 */
class CreateReviewRequestDto {
  @ValidateNested() @Type(() => ReviewSubjectDto) subject!: ReviewSubjectDto;

  @IsInt() @Min(1) expectedVersion!: number;

  @IsOptional() @IsUUID() taskId?: string | null;
}

class ListReviewRequestsQueryDto {
  @IsOptional() @IsIn(['true', 'false']) assignedToMe?: 'true' | 'false';

  @IsOptional() @IsIn(REVIEW_STATUS_VALUES) status?: V1ReviewStatus;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  @IsOptional() @IsString() @MaxLength(500) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/review-decisions')
export class V1ReviewDecisionController {
  constructor(@Inject(V1ReviewService) private readonly reviews: V1ReviewService) {}

  /**
   * 撤销批准：原决定人或当前准确槽位有权 HUMAN，父请求版本 + 一次性票据 + 幂等键。
   * 追加撤销记录并失效当前发布指针与受影响任务，不删除历史。
   */
  @Post(':decisionId/revoke')
  revoke(
    @Req() request: V1Request,
    @Param('decisionId') decisionId: string,
    @Body() dto: RevokeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    if (!principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    return this.reviews.revoke(
      principal,
      decisionId,
      {
        expectedVersion: dto.expectedVersion,
        reason: dto.reason,
        confirmation: {
          ticketId: dto.confirmation.ticketId,
          ticketSecret: dto.confirmation.ticketSecret,
        },
      },
      {
        idempotencyKey: key,
        method: request.method,
        route: request.originalUrl ?? `/api/v1/review-decisions/${decisionId}/revoke`,
        body: {
          expectedVersion: dto.expectedVersion,
          reason: dto.reason,
        },
        requestId: request.requestId ?? '',
        now: new Date(),
        operationId: crypto.randomUUID(),
        webSessionId: principal.sessionId,
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }
}

@UseGuards(V1AuthGuard)
@Controller('v1/review-requests')
export class V1ReviewController {
  constructor(@Inject(V1ReviewService) private readonly reviews: V1ReviewService) {}

  @Get(':reviewId')
  get(@Req() request: V1Request, @Param('reviewId') reviewId: string) {
    return this.reviews.getReview(principalOf(request), reviewId);
  }

  /**
   * 创建评审请求：只接受 subject 与 expectedVersion；kind 与槽位服务端派生。
   * 同一 subject 已有 OPEN 请求时返回既有 ReviewView（201），同 Idempotency-Key 重放同一结果。
   */
  @Post()
  create(
    @Req() request: V1Request,
    @Body() dto: CreateReviewRequestDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    const subject = { kind: dto.subject.kind, id: dto.subject.id };
    const body = { subject, expectedVersion: dto.expectedVersion, taskId: dto.taskId ?? null };
    return this.reviews.requestReview(principal, body, {
      idempotencyKey: key,
      method: request.method,
      route: request.originalUrl ?? '/api/v1/review-requests',
      body,
      requestId: request.requestId ?? '',
      now: new Date(),
      operationId: crypto.randomUUID(),
      webSessionId: principal.sessionId ?? null,
      userAuthVersion: principal.authVersion ?? 0,
    });
  }

  /**
   * 正式决定：有效 HUMAN WebSession + 准确 slot + expectedVersion + 版本绑定的一次性票据 + 幂等键。
   * 最后 ALL APPROVE 时在同一事务完成发布指针、DocumentPublication、审计与操作结果。
   */
  @Post(':reviewId/decisions')
  decide(
    @Req() request: V1Request,
    @Param('reviewId') reviewId: string,
    @Body() dto: DecideDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    if (!principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );
    return this.reviews.decide(
      principal,
      reviewId,
      {
        slotId: dto.slotId,
        decision: dto.decision,
        expectedVersion: dto.expectedVersion,
        comment: dto.comment ?? null,
        confirmation: {
          ticketId: dto.confirmation.ticketId,
          ticketSecret: dto.confirmation.ticketSecret,
        },
      },
      {
        idempotencyKey: key,
        method: request.method,
        route: request.originalUrl ?? `/api/v1/review-requests/${reviewId}/decisions`,
        body: {
          slotId: dto.slotId,
          decision: dto.decision,
          expectedVersion: dto.expectedVersion,
          comment: dto.comment ?? null,
        },
        requestId: request.requestId ?? '',
        now: new Date(),
        operationId: crypto.randomUUID(),
        webSessionId: principal.sessionId,
        // 授权版本只能来自服务端会话记录，不接受客户端声明。
        userAuthVersion: principal.authVersion ?? 0,
      },
    );
  }

  /**
   * 批量决定：逐条独立校验与授权，返回每条结果；不提供整批回滚。
   * 票据是一次性的，批量重放会因票据已消费失败，属预期行为。
   */
  @Post('batch-decisions')
  async batchDecide(
    @Req() request: V1Request,
    @Body() dto: BatchDecisionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    requireIdempotencyKey(idempotencyKey);
    if (!principal.sessionId)
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );

    const results: Array<{
      reviewId: string;
      status: string;
      decisionId?: string;
      message?: string;
    }> = [];
    for (const item of dto.items) {
      try {
        const result = await this.reviews.decide(
          principal,
          item.reviewId,
          {
            slotId: item.slotId,
            decision: dto.decision,
            expectedVersion: item.expectedVersion,
            comment: item.comment ?? null,
            confirmation: {
              ticketId: item.confirmation.ticketId,
              ticketSecret: item.confirmation.ticketSecret,
            },
          },
          {
            idempotencyKey: crypto.randomUUID(),
            method: request.method,
            route: request.originalUrl ?? '/api/v1/review-requests/batch-decisions',
            body: {
              reviewId: item.reviewId,
              slotId: item.slotId,
              decision: dto.decision,
              expectedVersion: item.expectedVersion,
            },
            requestId: request.requestId ?? '',
            now: new Date(),
            operationId: crypto.randomUUID(),
            webSessionId: principal.sessionId,
            userAuthVersion: principal.authVersion ?? 0,
          },
        );
        results.push({ reviewId: item.reviewId, status: 'APPLIED', decisionId: result.decisionId });
      } catch (error) {
        const failure = error as { code?: string; message?: string };
        results.push({
          reviewId: item.reviewId,
          status: failure.code ?? 'FAILED',
          message: failure.message,
        });
      }
    }
    return { results };
  }
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1ProjectReviewController {
  constructor(@Inject(V1ReviewService) private readonly reviews: V1ReviewService) {}

  /** 项目评审待办：当前活动成员必选，按主体可见范围、角色/指派与状态过滤后稳定分页。 */
  @Get(':projectId/review-requests')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListReviewRequestsQueryDto,
  ) {
    return this.reviews.listReviews(principalOf(request), {
      projectId,
      assignedToMe: query.assignedToMe === 'true',
      status: query.status,
      limit: query.limit ?? 20,
      cursor: query.cursor,
    });
  }
}
