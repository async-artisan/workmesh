import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1ActivityService } from './v1-activity.service';

class ActivityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/activity')
export class V1ActivityController {
  constructor(private readonly activity: V1ActivityService) {}

  @Get()
  list(@Req() request: V1Request, @Query() query: ActivityQueryDto) {
    return this.activity.list(principalOf(request), query.limit);
  }
}
