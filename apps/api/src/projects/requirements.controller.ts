import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { CreateRequirementDto, UpdateRequirementDto } from './dto';
import { RequirementsService } from './requirements.service';

class ListRequirementsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;

  @IsOptional() @IsString() @MaxLength(20) cursor?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects/:projectId/requirements')
export class RequirementsController {
  constructor(private readonly requirements: RequirementsService) {}

  @Get()
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: ListRequirementsQueryDto,
  ) {
    return this.requirements.list(principalOf(request), projectId, {
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Get(':requirementId')
  detail(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('requirementId') requirementId: string,
  ) {
    return this.requirements.detail(principalOf(request), projectId, requirementId);
  }

  @Patch(':requirementId')
  update(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('requirementId') requirementId: string,
    @Body() dto: UpdateRequirementDto,
  ) {
    return this.requirements.update(principalOf(request), projectId, requirementId, dto);
  }

  @Post()
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRequirementDto,
  ) {
    return this.requirements.create(principalOf(request), projectId, dto);
  }
}
