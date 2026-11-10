import { Body, Controller, Get, Headers, Param, Put, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { V1KnowledgeBindingService } from './v1-knowledge-binding.service';

class SetKnowledgeBindingDto {
  @IsInt() @Min(1) expectedVersion!: number;
  @IsUUID() documentId!: string;
  @IsOptional() @IsUUID() roleId?: string | null;
  @IsBoolean() required!: boolean;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects/:projectId/knowledge-bindings')
export class V1KnowledgeBindingController {
  constructor(private readonly bindings: V1KnowledgeBindingService) {}

  @Get()
  list(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.bindings.list(principalOf(request), projectId);
  }

  @Put()
  bind(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: SetKnowledgeBindingDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const input = {
      expectedVersion: dto.expectedVersion,
      documentId: dto.documentId,
      roleId: dto.roleId ?? null,
      required: dto.required,
    };
    return this.bindings.bind(principalOf(request), projectId, input, {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      method: request.method,
      route: request.originalUrl ?? request.url,
      body: input,
      requestId: request.requestId ?? '',
      now: new Date(),
      operationId: randomUUID(),
    });
  }
}
