import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1FlowMetricsService } from './v1-flow-metrics.service';

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

const UUID = /^[0-9a-fA-F-]{36}$/;

/** 只读派生指标：不写库，不改状态。口径见 docs/metrics.md。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1FlowMetricsController {
  constructor(@Inject(V1FlowMetricsService) private readonly metrics: V1FlowMetricsService) {}

  @Get(':projectId/metrics/flow')
  flow(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query('days') days?: string,
  ) {
    if (!UUID.test(projectId))
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'PROJECT_ID_INVALID',
        { projectId },
        422,
      );
    const parsed = days === undefined ? 30 : Number(days);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365)
      throw new WorkmeshError(V1_ERROR_CODES.VALIDATION_FAILED, 'DAYS_INVALID', { days }, 422);
    return this.metrics.flow(principalOf(request), projectId, parsed);
  }
}
