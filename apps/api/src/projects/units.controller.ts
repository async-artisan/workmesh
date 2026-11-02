import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { CreateUnitDependencyDto, CreateUnitDto, UpdateUnitDto } from './dto';
import { UnitsService } from './units.service';

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

/** 工作单元与依赖图：只允许 HUMAN 读写，Agent 通过任务与上下文间接使用。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get(':projectId/units')
  list(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.units.list(projectId, humanUserId(request));
  }

  @Post(':projectId/units')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateUnitDto,
  ) {
    return this.units.create(projectId, humanUserId(request), dto);
  }

  @Patch(':projectId/units/:unitId')
  update(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    return this.units.update(projectId, humanUserId(request), unitId, dto);
  }

  @Get(':projectId/unit-dependencies')
  listDependencies(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.units.listDependencies(projectId, humanUserId(request));
  }

  @Post(':projectId/unit-dependencies')
  createDependency(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateUnitDependencyDto,
  ) {
    return this.units.createDependency(projectId, humanUserId(request), dto);
  }

  @Delete(':projectId/unit-dependencies/:dependencyId')
  removeDependency(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('dependencyId') dependencyId: string,
  ) {
    return this.units.deleteDependency(projectId, humanUserId(request), dependencyId);
  }
}
