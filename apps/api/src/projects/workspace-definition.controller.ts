import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1Principal } from '../auth/v1-policy';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import type { ProjectWriteContext } from './projects.service';
import {
  PublishWorkspaceDefinitionDto,
  SaveWorkspaceDefinitionDraftDto,
  ValidateWorkspaceDefinitionDto,
} from './workspace-definition.dto';
import { WorkspaceDefinitionService } from './workspace-definition.service';

function principalOf(request: V1Request): V1Principal {
  const principal = request.v1Principal;
  if (!principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少有效凭据', undefined, 401);
  return principal;
}

/** 定义写接口要求真实 WebSession：Agent 与无会话主体一律 403。 */
function humanPrincipal(request: V1Request): V1Principal {
  const principal = principalOf(request);
  if (principal.kind !== 'HUMAN' || !principal.sessionId)
    throw new WorkmeshError(
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      undefined,
      403,
    );
  return principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class WorkspaceDefinitionController {
  constructor(private readonly definitions: WorkspaceDefinitionService) {}

  @Get(':projectId/workspace-definition')
  getDefinition(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.definitions.getDefinition(principalOf(request), projectId);
  }

  @Get(':projectId/workspace-definition/revisions/:revisionId')
  getRevision(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('revisionId') revisionId: string,
  ) {
    return this.definitions.getRevision(principalOf(request), projectId, revisionId);
  }

  @Put(':projectId/workspace-definition/draft')
  saveDraft(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: SaveWorkspaceDefinitionDraftDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = humanPrincipal(request);
    return this.definitions.saveDraft(
      principal,
      projectId,
      dto,
      this.writeContext(
        request,
        principal,
        dto,
        `/api/v1/projects/${projectId}/workspace-definition/draft`,
        idempotencyKey,
      ),
    );
  }

  @Post(':projectId/workspace-definition/validate')
  @HttpCode(200)
  validate(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: ValidateWorkspaceDefinitionDto,
  ) {
    return this.definitions.validate(humanPrincipal(request), projectId, dto);
  }

  @Post(':projectId/workspace-definition/publish')
  @HttpCode(200)
  publish(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: PublishWorkspaceDefinitionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = humanPrincipal(request);
    return this.definitions.publish(
      principal,
      projectId,
      dto,
      this.writeContext(
        request,
        principal,
        dto,
        `/api/v1/projects/${projectId}/workspace-definition/publish`,
        idempotencyKey,
      ),
    );
  }

  private writeContext(
    request: V1Request,
    principal: V1Principal,
    body: object,
    route: string,
    idempotencyKey: string,
  ): ProjectWriteContext {
    return {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      method: request.method,
      route: request.originalUrl ?? route,
      body: body as Record<string, unknown>,
      operationId: randomUUID(),
      now: new Date(),
      webSessionId: principal.sessionId ?? '',
      userAuthVersion: principal.authVersion ?? 0,
    };
  }
}
