import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsOptional, IsUUID } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1WorkbenchService } from './v1-workbench.service';

class WorkbenchQueryDto {
  @IsOptional() @IsUUID() projectId?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

/** 工作台只读聚合：待我签字、待确认变更、可开工任务。 */
@UseGuards(V1AuthGuard)
@Controller('v1/workbench')
export class V1WorkbenchController {
  constructor(private readonly workbench: V1WorkbenchService) {}

  @Get()
  get(@Req() request: V1Request, @Query() query: WorkbenchQueryDto) {
    return this.workbench.get(principalOf(request), query.projectId ?? null);
  }
}
