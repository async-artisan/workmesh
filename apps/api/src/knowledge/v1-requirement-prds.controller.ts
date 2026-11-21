import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1RequirementPrdsService } from './v1-requirement-prds.service';

/** No pagination or search input: the global whitelist rejects every query field. */
export class V1RequirementPrdsQueryDto {}

@UseGuards(V1AuthGuard)
@Controller('v1/projects/:projectId/requirements/:requirementId')
export class V1RequirementPrdsController {
  constructor(@Inject(V1RequirementPrdsService) private readonly prds: V1RequirementPrdsService) {}

  @Get('published-prds')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('requirementId') requirementId: string,
    @Query() _query: V1RequirementPrdsQueryDto,
  ) {
    if (!request.v1Principal)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
    return this.prds.list(request.v1Principal, projectId, requirementId);
  }
}
