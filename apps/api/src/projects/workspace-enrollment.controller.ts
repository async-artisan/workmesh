import { Body, Controller, Headers, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1Principal } from '../auth/v1-policy';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import type { ProjectWriteContext } from './projects.service';
import {
  ConsumeWorkspaceEnrollmentDto,
  CreateWorkspaceEnrollmentDto,
} from './workspace-enrollment.dto';
import { WorkspaceEnrollmentService } from './workspace-enrollment.service';

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

/** 签发：任意活动 HUMAN 项目成员 + 限流；接入码本身不授予任何权限。 */
@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class WorkspaceEnrollmentController {
  constructor(private readonly enrollments: WorkspaceEnrollmentService) {}

  @Post(':projectId/workspace-enrollments')
  issue(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateWorkspaceEnrollmentDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = humanPrincipal(request);
    const context: ProjectWriteContext = {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      method: request.method,
      route: request.originalUrl ?? `/api/v1/projects/${projectId}/workspace-enrollments`,
      body: dto as unknown as Record<string, unknown>,
      operationId: randomUUID(),
      now: new Date(),
      webSessionId: principal.sessionId ?? '',
      userAuthVersion: principal.authVersion ?? 0,
    };
    return this.enrollments.issue(principal, projectId, dto, context);
  }
}

/**
 * 消费：匿名、无 Authorization/CSRF；码即凭证，严格限流。
 * 只返回项目与精确 revision 元数据，不授予成员/仓库/知识/Agent 权限。
 */
@Controller('v1')
export class WorkspaceEnrollmentConsumeController {
  constructor(private readonly enrollments: WorkspaceEnrollmentService) {}

  @Post('workspace-enrollments/consume')
  @HttpCode(200)
  consume(@Req() request: V1Request, @Body() dto: ConsumeWorkspaceEnrollmentDto) {
    return this.enrollments.consume(dto.code, request.ip ?? 'unknown');
  }
}
