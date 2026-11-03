import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { V1AuthGuard, type V1Request } from '../auth/v1-auth.guard';
import type { V1Principal } from '../auth/v1-policy';
import { V1AccountService } from '../auth/v1-account.service';
import { cookieNames, resolveCookieMode } from '../auth/v1-cookie-policy';
import { setSessionCookies } from '../auth/v1-session-cookies';
import { requireIdempotencyKey } from '../common/v1-idempotency';
import { AcceptInvitationDto, CreateInvitationDto } from './invitations.dto';
import { InvitationsService, type InvitationContext } from './invitations.service';

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

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function publicOrigin(): string {
  return process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173';
}

function contextOf(
  request: V1Request,
  principal: V1Principal,
  dto: unknown,
  idempotencyKey: string | undefined,
): InvitationContext {
  return {
    idempotencyKey: requireIdempotencyKey(idempotencyKey),
    method: request.method,
    route: request.originalUrl ?? request.url,
    body: dto as Record<string, unknown>,
    operationId: randomUUID(),
    now: new Date(),
    webSessionId: principal.sessionId ?? '',
    userAuthVersion: principal.authVersion ?? 0,
  };
}

@Controller('v1')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    @Inject(V1AccountService) private readonly accounts: V1AccountService,
  ) {}

  /** 管理员生成邀请链接：需要票据，链接本身只在这一次响应里出现。 */
  @UseGuards(V1AuthGuard)
  @Post('projects/:projectId/invitations')
  create(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Body() dto: CreateInvitationDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const principal = humanPrincipal(request);
    response.status(201);
    return this.invitations.create(
      principal,
      projectId,
      {
        roleKeys: dto.roleKeys,
        email: dto.email,
        expiresInHours: dto.expiresInHours,
        expectedVersion: dto.expectedVersion,
        confirmation: {
          ticketId: dto.confirmation.ticketId,
          ticketSecret: dto.confirmation.ticketSecret,
        },
      },
      contextOf(request, principal, dto, idempotencyKey),
    );
  }

  /** 管理员查看未接受、未撤销、未过期的邀请（列表里只有邮箱与角色，没有 token）。 */
  @UseGuards(V1AuthGuard)
  @Get('projects/:projectId/invitations')
  list(@Req() request: V1Request, @Param('projectId') projectId: string) {
    return this.invitations.list(humanPrincipal(request), projectId);
  }

  /** 撤回未接受的邀请；已接受的邀请不会因撤回而失效。 */
  @UseGuards(V1AuthGuard)
  @Post('projects/:projectId/invitations/:invitationId/revoke')
  revoke(
    @Req() request: V1Request,
    @Param('projectId') projectId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.invitations.revoke(humanPrincipal(request), projectId, invitationId);
  }

  /** 公开解析：给接受页展示项目名与角色，不要求登录。 */
  @Get('invitations/:token')
  resolve(@Param('token') token: string) {
    return this.invitations.resolve(token);
  }

  /**
   * 未注册用户接受邀请：设置密码即建号、自动登录并加入项目。
   * 邮箱已被注册时返回 409 EMAIL_ALREADY_REGISTERED，引导走“登录后接受”。
   */
  @Post('invitations/:token/accept')
  async accept(
    @Req() request: Request,
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const mode = resolveCookieMode(process.env.WORKMESH_COOKIE_MODE);
    const names = cookieNames(mode);
    const now = new Date();
    const prepared = await this.invitations.prepareAnonymousAccept(token, dto.email, now);
    const session = await this.accounts.requireAnonymousSession({
      sessionCookie: readCookie(request, names.session),
      csrfCookie: readCookie(request, names.csrf),
      csrfHeader:
        typeof request.headers['x-csrf-token'] === 'string'
          ? request.headers['x-csrf-token']
          : undefined,
      origin: typeof request.headers.origin === 'string' ? request.headers.origin : undefined,
      method: request.method,
      publicOrigin: publicOrigin(),
      now,
    });
    const registered = await this.accounts.register({
      email: prepared.email,
      password: dto.password,
      name: dto.name,
      session,
      ip: request.ip || 'unknown',
      now,
    });
    const joined = await this.invitations.join(token, {
      userId: registered.user.id,
      webSessionId: session.id,
      now,
    });
    setSessionCookies(response, mode, registered.cookies);
    response.status(201);
    response.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: registered.user.id, email: registered.user.email },
      invitation: { projectId: joined.projectId, roleKeys: joined.roleKeys },
    };
  }

  /** 已有账号登录后接受邀请（未绑定邮箱的邀请也走这里）。 */
  @UseGuards(V1AuthGuard)
  @Post('invitations/:token/join')
  join(@Req() request: V1Request, @Param('token') token: string) {
    const principal = humanPrincipal(request);
    return this.invitations.join(token, {
      userId: principal.userId,
      webSessionId: principal.sessionId ?? '',
      now: new Date(),
    });
  }
}
