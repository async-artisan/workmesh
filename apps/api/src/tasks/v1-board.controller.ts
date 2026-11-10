import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1BoardService } from './v1-board.service';

class BoardQueryDto {
  @IsOptional() @IsString() @MaxLength(500) q?: string;
  @IsOptional() @IsString() @MaxLength(80) roleTitle?: string;
  @IsOptional() @IsString() @MaxLength(32) requirementCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number;
  @IsOptional() @IsString() @MaxLength(2048) cursor?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1BoardController {
  constructor(@Inject(V1BoardService) private readonly board: V1BoardService) {}

  @Get(':projectId/board')
  getBoard(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: BoardQueryDto = {},
  ) {
    this.validateProject(projectId);
    return this.board.board(principalOf(request), projectId, query);
  }

  @Get(':projectId/board/columns/:column')
  getColumn(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('column') column: string,
    @Query() query: BoardQueryDto,
  ) {
    this.validateProject(projectId);
    return this.board.column(principalOf(request), projectId, column, query);
  }

  @Get(':projectId/board/requirements')
  getRequirements(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: BoardQueryDto,
  ) {
    this.validateProject(projectId);
    return this.board.requirements(principalOf(request), projectId, query);
  }

  @Get(':projectId/board/filters/:kind')
  getFilters(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Query() query: BoardQueryDto,
  ) {
    this.validateProject(projectId);
    return this.board.filters(principalOf(request), projectId, kind, query);
  }

  private validateProject(projectId: string) {
    if (!projectId || !/^[0-9a-fA-F-]{36}$/.test(projectId))
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'PROJECT_ID_INVALID',
        { projectId },
        422,
      );
  }
}
