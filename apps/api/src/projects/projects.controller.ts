import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1Principal } from '../auth/v1-policy';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { CreateProjectDto, AddProjectMemberDto, ProjectRoleChangeDto, UpdateProjectDto } from './dto';
import { ProjectsService, type ProjectRoleChangeContext } from './projects.service';

function humanUserId(request: V1Request): string {
  const principal = request.v1Principal;
  if (!principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少有效凭据', undefined, 401);
  if (principal.kind !== 'HUMAN')
    throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, '项目管理仅允许人类会话', undefined, 403);
  return principal.userId;
}

/** 角色写接口要求真实 WebSession：Agent 与无会话主体一律 403。 */
function humanPrincipal(request: V1Request): V1Principal {
  const principal = request.v1Principal;
  if (!principal) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少有效凭据', undefined, 401);
  if (principal.kind !== 'HUMAN' || !principal.sessionId)
    throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, 'HUMAN_SESSION_REQUIRED', undefined, 403);
  return principal;
}

@UseGuards(V1AuthGuard)
@Controller('v1/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Req() request: V1Request) {
    return this.projects.list(humanUserId(request));
  }

  @Post()
  create(@Req() request: V1Request, @Body() dto: CreateProjectDto) {
    return this.projects.create(humanUserId(request), dto);
  }

  @Get(':projectId/members')
  members(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.projects.members(humanUserId(request), projectId);
  }

  @Post(':projectId/members')
  addMember(@Req() request: V1Request, @Param('projectId') projectId: string, @Body() dto: AddProjectMemberDto) {
    return this.projects.addMemberByEmail(humanUserId(request), projectId, dto.email);
  }

  @Get(':projectId/roles')
  roles(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.projects.roles(humanUserId(request), projectId);
  }

  @Put(':projectId/members/:userId/roles/:roleId')
  assignRole(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Body() dto: ProjectRoleChangeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = humanPrincipal(request);
    return this.projects.assignRole(
      principal,
      projectId,
      userId,
      roleId,
      {
        expectedVersion: dto.expectedVersion,
        reason: dto.reason,
        confirmation: { ticketId: dto.confirmation.ticketId, ticketSecret: dto.confirmation.ticketSecret },
      },
      this.roleContext(request, principal, dto, `/api/v1/projects/${projectId}/members/${userId}/roles/${roleId}`, idempotencyKey),
    );
  }

  @Post(':projectId/members/:userId/roles/:roleId/revoke')
  revokeRole(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Body() dto: ProjectRoleChangeDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const principal = humanPrincipal(request);
    return this.projects.revokeRole(
      principal,
      projectId,
      userId,
      roleId,
      {
        expectedVersion: dto.expectedVersion,
        reason: dto.reason,
        confirmation: { ticketId: dto.confirmation.ticketId, ticketSecret: dto.confirmation.ticketSecret },
      },
      this.roleContext(
        request,
        principal,
        dto,
        `/api/v1/projects/${projectId}/members/${userId}/roles/${roleId}/revoke`,
        idempotencyKey,
      ),
    );
  }

  @Put(':projectId')
  update(@Req() request: V1Request, @Param('projectId') projectId: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(humanUserId(request), projectId, dto);
  }

  @Delete(':projectId')
  archive(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.projects.archive(humanUserId(request), projectId);
  }

  private roleContext(
    request: V1Request,
    principal: V1Principal,
    dto: ProjectRoleChangeDto,
    route: string,
    idempotencyKey: string,
  ): ProjectRoleChangeContext {
    return {
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      method: request.method,
      route: request.originalUrl ?? route,
      body: { expectedVersion: dto.expectedVersion, reason: dto.reason },
      operationId: randomUUID(),
      now: new Date(),
      webSessionId: principal.sessionId ?? '',
      userAuthVersion: principal.authVersion ?? 0,
    };
  }
}
