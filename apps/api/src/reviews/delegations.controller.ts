import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { CreateDelegationDto } from './delegations.dto';
import { DelegationsService } from './delegations.service';

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

/** 委托与超时视图：只读列表对所有成员开放，写操作限 OWNER/ADMIN。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class DelegationsController {
  constructor(private readonly delegations: DelegationsService) {}

  @Get(':projectId/delegations')
  list(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.delegations.list(projectId, humanUserId(request));
  }

  @Post(':projectId/delegations')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateDelegationDto,
  ) {
    return this.delegations.create(projectId, humanUserId(request), dto);
  }

  @Delete(':projectId/delegations/:delegationId')
  revoke(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('delegationId') delegationId: string,
  ) {
    return this.delegations.revoke(projectId, humanUserId(request), delegationId);
  }

  @Get(':projectId/approvals/overdue')
  overdue(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.delegations.overdue(projectId, humanUserId(request));
  }
}
