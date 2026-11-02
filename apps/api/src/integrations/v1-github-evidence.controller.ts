import { randomUUID } from 'node:crypto';
import { Body, Controller, Headers, Param, Post, Req, UseGuards, type RawBodyRequest } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1GithubEvidenceService } from './v1-github-evidence.service';

/** 真实 Git SHA：40 位小写十六进制。 */
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

class ReviewEvidenceDto {
  @IsString() reviewerId!: string;
  @IsIn(['USER', 'BOT']) reviewerKind!: 'USER' | 'BOT';
  @IsIn(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED', 'COMMENTED', 'PENDING']) state!: 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'COMMENTED' | 'PENDING';
  @IsOptional() @IsString() @Matches(GIT_SHA_PATTERN) commitSha?: string | null;
  @IsOptional() @IsString() submittedAt?: string | null;
  @IsString() reviewId!: string;
}

class RepositoryEvidenceDto {
  @IsString() repositoryId!: string;
  @IsString() changeRequestId!: string;
  @IsOptional() @IsString() @Matches(GIT_SHA_PATTERN) changeRequestHeadSha?: string | null;
  @IsOptional() @IsString() authorExternalId?: string | null;
  @IsOptional() @IsBoolean() merged?: boolean;
  @IsArray() @ValidateNested({ each: true }) @Type(() => ReviewEvidenceDto) reviews!: ReviewEvidenceDto[];
  @IsOptional() @IsString() @Matches(GIT_SHA_PATTERN) artifactCommitSha?: string | null;
}

class WebhookDto {
  @IsString() @IsUUID() projectId!: string;
  @IsString() eventType!: string;
  @IsString() deliveryId!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RepositoryEvidenceDto) repositories!: RepositoryEvidenceDto[];
}

class PrepareDto {
  @IsString() @IsUUID() projectId!: string;
  @IsString() @IsUUID() artifactSetId!: string;
  @IsString() repositoryId!: string;
  @IsString() changeRequestId!: string;
  @IsString() @Matches(GIT_SHA_PATTERN) headSha!: string;
  @IsIn([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) generation!: number;
}

class UseTicketDto {
  @IsString() @IsUUID() projectId!: string;
  @IsString() @IsUUID() ticketId!: string;
  @IsString() secret!: string;
  @IsString() @IsUUID() artifactSetId!: string;
  @IsString() @Matches(GIT_SHA_PATTERN) headSha!: string;
  @IsIn([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) generation!: number;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

function contextOf(request: V1Request, idempotencyKey: string, body: Record<string, unknown>) {
  return {
    idempotencyKey,
    method: request.method,
    route: request.originalUrl ?? request.url ?? '',
    requestId: request.requestId ?? '',
    now: new Date(),
    operationId: randomUUID(),
    body,
  };
}

@UseGuards(V1AuthGuard)
@Controller('v1/integrations/github')
export class V1GithubEvidenceController {
  constructor(private readonly service: V1GithubEvidenceService) {}

  @Post('webhooks')
  receiveWebhook(
    @Req() request: RawBodyRequest<V1Request>,
    @Headers('x-hub-signature-256') signatureHeader: string | undefined,
    @Body() dto: WebhookDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    const rawBody = request.rawBody;
    // 必须拿到未经重序列化的原始字节，否则 HMAC 无法可靠验证。
    if (!rawBody || rawBody.length === 0)
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'WEBHOOK_RAW_BODY_REQUIRED', undefined, 403);
    return this.service.receiveWebhook(principal, dto.projectId, {
      eventType: dto.eventType,
      deliveryId: dto.deliveryId,
      rawBody,
      signatureHeader,
      repositories: dto.repositories.map((repo) => ({
        repositoryId: repo.repositoryId,
        changeRequestId: repo.changeRequestId,
        changeRequestHeadSha: repo.changeRequestHeadSha ?? null,
        authorExternalId: repo.authorExternalId ?? null,
        merged: repo.merged ?? false,
        artifactCommitSha: repo.artifactCommitSha ?? null,
        reviews: repo.reviews.map((review) => ({
          reviewerId: review.reviewerId,
          reviewerKind: review.reviewerKind,
          state: review.state,
          commitSha: review.commitSha ?? null,
          submittedAt: review.submittedAt ?? null,
          reviewId: review.reviewId,
        })),
      })),
    }, contextOf(request, key, dto as unknown as Record<string, unknown>));
  }

  @Post('code-evidence/prepare')
  prepare(@Req() request: V1Request, @Body() dto: PrepareDto, @Headers('idempotency-key') idempotencyKey: string) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.service.prepareCodeEvidence(principal, dto.projectId, {
      artifactSetId: dto.artifactSetId,
      repositoryId: dto.repositoryId,
      changeRequestId: dto.changeRequestId,
      headSha: dto.headSha,
      generation: dto.generation,
    }, contextOf(request, key, dto as unknown as Record<string, unknown>));
  }

  @Post('code-evidence/:ticketId/use')
  useTicket(@Req() request: V1Request, @Param('ticketId') ticketId: string, @Body() dto: UseTicketDto) {
    const principal = principalOf(request);
    return this.service.useVersionedTicket(principal, dto.projectId, {
      ticketId,
      secret: dto.secret,
      artifactSetId: dto.artifactSetId,
      headSha: dto.headSha,
      generation: dto.generation,
    }, { now: new Date() });
  }
}
