import { Body, Controller, Headers, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1Principal } from '../auth/v1-policy';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { DeclareRepositoryDto } from './dto';
import { ProjectRepositoryDeclarationService } from './project-repository-declaration.service';
import type { ProjectWriteContext } from './projects.service';

/** 声明写接口要求真实 WebSession：Agent 与无会话主体一律 403。 */
function humanPrincipal(request: V1Request): V1Principal {
  const principal = request.v1Principal;
  if (!principal)
    throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少有效凭据', undefined, 401);
  if (principal.kind !== 'HUMAN' || !principal.sessionId)
    throw new WorkmeshError(
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      'HUMAN_SESSION_REQUIRED',
      undefined,
      403,
    );
  return principal;
}

/**
 * 仓库声明与既有仓库写路径的补强入口。
 *
 * P0a 不暴露 provider verify：声明端点只创建/复用 DECLARED 稳定身份，
 * 不调用 provider API、不写 `PROVIDER_VERIFIED`/`lastVerified*`。
 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class WorkspaceRepositoryController {
  constructor(private readonly declarations: ProjectRepositoryDeclarationService) {}

  @Post(':projectId/repositories/declarations')
  async declare(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: DeclareRepositoryDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = humanPrincipal(request);
    const context: ProjectWriteContext = {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      method: request.method,
      route: request.originalUrl ?? `/api/v1/projects/${projectId}/repositories/declarations`,
      body: dto as unknown as Record<string, unknown>,
      operationId: randomUUID(),
      now: new Date(),
      webSessionId: principal.sessionId ?? '',
      userAuthVersion: principal.authVersion ?? 0,
    };
    const result = await this.declarations.declare(principal, projectId, dto, context);
    response.status(result.status);
    return result.view;
  }
}
