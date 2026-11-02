import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1ReadyService } from './v1-ready.service';

class ReadyQueryDto {
  @IsOptional() @IsString() @MaxLength(64) roleId?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;

  @IsOptional() @IsString() @MaxLength(2000) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

/** 就绪任务列表：Agent 固定本凭据角色，人类按当前责任范围与管理者可见性过滤。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1ReadyController {
  constructor(@Inject(V1ReadyService) private readonly ready: V1ReadyService) {}

  @Get(':projectId/tasks/ready')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ReadyQueryDto,
  ) {
    return this.ready.ready(principalOf(request), projectId, {
      roleId: query.roleId ?? null,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }
}
