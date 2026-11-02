import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { ChangeRequestsService } from './change-requests.service';
import { CreateChangeRequestDto, DecideChangeRequestDto } from './change-requests.dto';

function humanUserId(request: V1Request): string {
  const principal = request.v1Principal;
  if (!principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  if (principal.kind !== 'HUMAN')
    throw new WorkmeshError(
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      undefined,
      403,
    );
  return principal.userId;
}

/** 变更请求：提案人可以是普通成员，决定必须是 OWNER/ADMIN。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class ChangeRequestsController {
  constructor(private readonly changes: ChangeRequestsService) {}

  @Get(':projectId/change-requests')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query('requirementId') requirementId?: string,
  ) {
    return this.changes.list(projectId, humanUserId(request), requirementId);
  }

  @Post(':projectId/change-requests')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateChangeRequestDto,
  ) {
    return this.changes.create(projectId, humanUserId(request), dto);
  }

  @Get(':projectId/change-requests/:changeId')
  get(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('changeId') changeId: string,
  ) {
    return this.changes.get(projectId, humanUserId(request), changeId);
  }

  @Post(':projectId/change-requests/:changeId/decisions')
  decide(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('changeId') changeId: string,
    @Body() dto: DecideChangeRequestDto,
  ) {
    return this.changes.decide(projectId, humanUserId(request), changeId, dto);
  }
}
