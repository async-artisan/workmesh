import { Controller, Get, Inject, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { Allow } from 'class-validator';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1DocumentSummaryQuery } from './v1-document-summary.query';
import { V1DocumentSummaryService } from './v1-document-summary.service';

function principalOf(request: V1Request) {
  if (!request.v1Principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'AUTH_REQUIRED', undefined, 401);
  return request.v1Principal;
}

/** These readers have no filters; accepting one would imply that it affects the result. */
export class V1DocumentSummaryEmptyQueryDto {}

/** Global whitelist rejects unknown fields; known values are checked by the service with 422. */
export class V1DocumentSummaryQueryDto implements V1DocumentSummaryQuery {
  @Allow() kind?: string;
  @Allow() knowledgeBaseKind?: string;
  @Allow() requirementId?: string;
  @Allow() status?: string;
  @Allow() q?: string;
  @Allow() searchProfile?: string;
  @Allow() @Type(() => Number) limit?: number;
  @Allow() cursor?: string | null;
}

@UseGuards(V1AuthGuard)
@Controller('v1')
export class V1DocumentSummaryController {
  constructor(
    @Inject(V1DocumentSummaryService) private readonly summaries: V1DocumentSummaryService,
  ) {}

  @Get('projects/:projectId/document-summaries')
  list(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() query: V1DocumentSummaryQueryDto,
  ) {
    return this.summaries.list(principalOf(request), projectId, query);
  }

  @Get('documents/:documentId/summary')
  summary(
    @Req() request: V1Request,
    @Param('documentId') documentId: string,
    @Query() _query: V1DocumentSummaryEmptyQueryDto,
  ) {
    return this.summaries.summary(principalOf(request), documentId);
  }

  @Get('projects/:projectId/document-summary-overview')
  overview(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Query() _query: V1DocumentSummaryEmptyQueryDto,
  ) {
    return this.summaries.overview(principalOf(request), projectId);
  }
}
