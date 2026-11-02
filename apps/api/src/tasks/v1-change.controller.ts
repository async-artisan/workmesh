import { randomUUID } from 'node:crypto';
import { Body, Controller, Get, Headers, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1ChangeService, type V1ListServiceInput } from './v1-change.service';

class AckDto {
  @IsOptional() @IsInt() @Min(1) expectedVersion?: number;
}

class ListQueryDto {
  @IsString() @IsUUID() projectId!: string;

  @IsOptional() @IsIn(['true', 'false']) ackedOnly?: 'true' | 'false';

  @IsOptional() @IsString() @IsUUID() cursor?: string;

  @IsOptional() @IsInt() @Min(1) @Max(200) limit?: number;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/change-recipients')
export class V1ChangeRecipientController {
  constructor(@Inject(V1ChangeService) private readonly changes: V1ChangeService) {}

  @Post(':id/ack')
  ack(
    @Req() request: V1Request,
    @Param('id') recipientId: string,
    @Body() dto: AckDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = principalOf(request);
    const key = requireIdempotencyKey(idempotencyKey);
    return this.changes.ack(principal, recipientId, {
      idempotencyKey: key,
      expectedVersion: dto.expectedVersion,
      method: request.method,
      route: request.originalUrl ?? request.url ?? '',
      requestId: request.requestId ?? '',
      now: new Date(),
      operationId: randomUUID(),
      body: { recipientId, expectedVersion: dto.expectedVersion },
    });
  }

  @Get()
  list(@Req() request: V1Request, @Query() query: ListQueryDto) {
    const principal = principalOf(request);
    const input: V1ListServiceInput = {
      projectId: query.projectId,
      ackedOnly: query.ackedOnly === 'true' ? true : query.ackedOnly === 'false' ? false : undefined,
      cursor: query.cursor,
      limit: query.limit ?? 50,
    };
    return this.changes.listRecipients(principal, input);
  }
}
