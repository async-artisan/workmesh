import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1ReviewDiscussionService } from './v1-review-discussion.service';

class CreateDiscussionDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) body!: string;
}
class DiscussionEntryDto {
  @IsIn(['REPLY', 'RESOLVED', 'REOPENED']) kind!: 'REPLY' | 'RESOLVED' | 'REOPENED';
  @IsInt() @Min(1) expectedVersion!: number;
  @IsString() @MinLength(1) @MaxLength(10000) body!: string;
  @IsOptional() @IsUUID() addressedInReviewId?: string;
}
class DiscussionQueryDto {
  @IsOptional() @IsString() @MaxLength(1000) cursor?: string;
}
function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/review-requests/:reviewId/discussions')
export class V1ReviewDiscussionController {
  constructor(private readonly discussions: V1ReviewDiscussionService) {}

  @Get()
  list(
    @Req() request: V1Request,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Query() query: DiscussionQueryDto,
  ) {
    return this.discussions.list(principalOf(request), reviewId, query.cursor);
  }

  @Get(':discussionId/entries')
  entries(
    @Req() request: V1Request,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @Query() query: DiscussionQueryDto,
  ) {
    return this.discussions.entries(principalOf(request), reviewId, discussionId, query.cursor);
  }

  @Post()
  create(
    @Req() request: V1Request,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Body() dto: CreateDiscussionDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.discussions.mutate(
      principalOf(request),
      reviewId,
      { kind: 'CREATE', title: dto.title, body: dto.body },
      {
        idempotencyKey: requireIdempotencyKey(key),
        method: request.method,
        route: request.originalUrl ?? `/api/v1/review-requests/${reviewId}/discussions`,
        now: new Date(),
      },
    );
  }

  @Post(':discussionId/entries')
  reply(
    @Req() request: V1Request,
    @Param('reviewId', ParseUUIDPipe) reviewId: string,
    @Param('discussionId', ParseUUIDPipe) discussionId: string,
    @Body() dto: DiscussionEntryDto,
    @Headers('idempotency-key') key: string,
  ) {
    return this.discussions.mutate(
      principalOf(request),
      reviewId,
      {
        kind: dto.kind,
        discussionId,
        expectedVersion: dto.expectedVersion,
        body: dto.body,
        addressedInReviewId: dto.addressedInReviewId,
      },
      {
        idempotencyKey: requireIdempotencyKey(key),
        method: request.method,
        route:
          request.originalUrl ??
          `/api/v1/review-requests/${reviewId}/discussions/${discussionId}/entries`,
        now: new Date(),
      },
    );
  }
}
