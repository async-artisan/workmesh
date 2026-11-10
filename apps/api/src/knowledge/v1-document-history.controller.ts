import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { Allow } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import { V1DocumentHistoryService } from './v1-document-history.service';

/** Value validation lives in the service so malformed page input consistently returns 422. */
export class V1DocumentHistoryQueryDto {
  @Allow() @Type(() => Number) limit?: number;
  @Allow() cursor?: string | null;
}

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/documents/:documentId')
export class V1DocumentHistoryController {
  constructor(
    @Inject(V1DocumentHistoryService) private readonly history: V1DocumentHistoryService,
  ) {}

  @Get('history')
  list(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Query() query: V1DocumentHistoryQueryDto,
  ) {
    return this.history.list(principalOf(request), documentId, query);
  }

  @Get('revisions/:revisionId/metadata')
  metadata(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.history.metadata(principalOf(request), documentId, revisionId);
  }
}
