import { Controller, Get, Inject, Param, Req, UseGuards } from '@nestjs/common';
import { IsString, IsUUID } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1BoardService } from './v1-board.service';

function principalOf(request: V1Request) {
  if (!request.v1Principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class V1BoardController {
  constructor(@Inject(V1BoardService) private readonly board: V1BoardService) {}

  @Get(':projectId/board')
  getBoard(@Req() request: V1Request, @Param('projectId') projectId: string) {
    if (!projectId || !/^[0-9a-fA-F-]{36}$/.test(projectId))
      throw new WorkmeshError(V1_ERROR_CODES.VALIDATION_FAILED, 'PROJECT_ID_INVALID', { projectId }, 422);
    return this.board.board(principalOf(request), projectId);
  }
}
