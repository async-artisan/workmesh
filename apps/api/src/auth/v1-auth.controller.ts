import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ActionBinding, Principal } from '@workmesh/shared';
import {
  cookieNames,
  csrfCookieOptions,
  resolveCookieMode,
  remainingSeconds,
  sessionCookieOptions,
} from './v1-cookie-policy';
import { V1AuthGuard, type V1Request } from './v1-auth.guard';
import { V1AccountService, V1CookiePayload } from './v1-account.service';
import { V1ActionService } from './v1-action.service';
import { V1CliAuthorizationService } from './v1-cli-authorization.service';
import {
  ActionPreviewDto,
  ApproveCliAuthorizationDto,
  ConfirmationTicketDto,
  CreateCliAuthorizationDto,
  DenyCliAuthorizationDto,
  LoginDto,
  LookupCliAuthorizationDto,
  PollCliAuthorizationDto,
  RegisterDto,
} from './v1-auth.dto';

function principalOf(request: V1Request): Principal {
  if (!request.v1Principal) throw new Error('AUTHENTICATION_REQUIRED');
  return request.v1Principal;
}

function emailOf(request: Request): string {
  return request.ip || 'unknown';
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

function bindingOf(dto: ActionPreviewDto): ActionBinding {
  return {
    action: dto.action,
    projectId: dto.projectId ?? null,
    targetType: dto.targetType,
    targetId: dto.targetId,
    expectedVersion: dto.expectedVersion,
    roleSlot: dto.roleSlot
      ? { roleId: dto.roleSlot.roleId, approvalSlotId: dto.roleSlot.approvalSlotId ?? null }
      : null,
    payload: dto.payload,
  };
}

@Controller('v1/auth')
export class V1AuthController {
  constructor(
    @Inject(V1AccountService) private readonly accounts: V1AccountService,
    @Inject(V1CliAuthorizationService) private readonly cli: V1CliAuthorizationService,
    @Inject(V1ActionService) private readonly actions: V1ActionService,
  ) {}

  @Get('session')
  async session(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const mode = resolveCookieMode(process.env.WORKMESH_COOKIE_MODE);
    const names = cookieNames(mode);
    const result = await this.accounts.bootstrap({
      sessionCookie: readCookie(request, names.session),
      csrfCookie: readCookie(request, names.csrf),
    });
    if (result.cookies) this.setCookies(response, mode, result.cookies);
    response.setHeader('Cache-Control', 'no-store');
    return { ...result.view, authenticated: result.view.authenticated };
  }

  @Post('register')
  async register(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: RegisterDto,
  ) {
    const mode = resolveCookieMode(process.env.WORKMESH_COOKIE_MODE);
    const names = cookieNames(mode);
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
    });
    const result = await this.accounts.register({
      email: dto.email,
      password: dto.password,
      name: dto.name,
      session,
      ip: emailOf(request),
    });
    this.setCookies(response, mode, result.cookies);
    response.status(201);
    response.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: result.user.id, email: result.user.email },
      session: { expiresAt: result.cookies.expiresAt, csrfToken: result.cookies.csrfToken },
    };
  }

  @Post('login')
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() dto: LoginDto,
  ) {
    const mode = resolveCookieMode(process.env.WORKMESH_COOKIE_MODE);
    const names = cookieNames(mode);
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
    });
    const result = await this.accounts.login({
      email: dto.email,
      password: dto.password,
      session,
      ip: emailOf(request),
    });
    this.setCookies(response, mode, result.cookies);
    response.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: result.user.id, email: result.user.email },
      session: { expiresAt: result.cookies.expiresAt, csrfToken: result.cookies.csrfToken },
    };
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const mode = resolveCookieMode(process.env.WORKMESH_COOKIE_MODE);
    const names = cookieNames(mode);
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
    });
    await this.accounts.logout(session.id);
    // 删除 Cookie 必须保留与原 Cookie 一致的 Path、Secure 与 __Host- 前缀要求。
    response.setHeader('Set-Cookie', [
      serializeDeletionCookie(names.session, mode, true),
      serializeDeletionCookie(names.csrf, mode, false),
    ]);
    response.setHeader('Cache-Control', 'no-store');
    return { revoked: true };
  }

  @UseGuards(V1AuthGuard)
  @Get('me')
  me(@Req() request: V1Request) {
    return this.accounts.me(principalOf(request));
  }

  @UseGuards(V1AuthGuard)
  @Get('credentials')
  listCredentials(@Req() request: V1Request) {
    return this.accounts.listCredentials(principalOf(request));
  }

  @UseGuards(V1AuthGuard)
  @Delete('credentials/:credentialId')
  revokeCredential(@Req() request: V1Request, @Param('credentialId') credentialId: string) {
    return this.accounts.revokeCredential(principalOf(request), credentialId);
  }

  @Post('cli-authorizations')
  createCliAuthorization(
    @Req() request: Request,
    @Body() dto: CreateCliAuthorizationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.status(201);
    return this.cli.create({ ...dto, ip: emailOf(request) });
  }

  @UseGuards(V1AuthGuard)
  @Post('cli-authorizations/lookup')
  lookup(@Req() request: V1Request, @Body() dto: LookupCliAuthorizationDto) {
    return this.cli.lookup({ userCode: dto.userCode, principal: principalOf(request) });
  }

  @UseGuards(V1AuthGuard)
  @Post('cli-authorizations/:authorizationId/approve')
  approve(
    @Req() request: V1Request,
    @Param('authorizationId') authorizationId: string,
    @Body() dto: ApproveCliAuthorizationDto,
  ) {
    return this.cli.approve({ ...dto, authorizationId, principal: principalOf(request) });
  }

  @UseGuards(V1AuthGuard)
  @Post('cli-authorizations/:authorizationId/deny')
  deny(
    @Req() request: V1Request,
    @Param('authorizationId') authorizationId: string,
    @Body() dto: DenyCliAuthorizationDto,
  ) {
    return this.cli.deny({ ...dto, authorizationId, principal: principalOf(request) });
  }

  @Post('cli-authorizations/poll')
  poll(@Body() dto: PollCliAuthorizationDto) {
    return this.cli.poll(dto);
  }

  @UseGuards(V1AuthGuard)
  @Post('action-previews')
  preview(@Req() request: V1Request, @Body() dto: ActionPreviewDto) {
    return this.actions.preview(principalOf(request), bindingOf(dto));
  }

  @UseGuards(V1AuthGuard)
  @Post('confirmation-tickets')
  async issueTicket(
    @Req() request: V1Request,
    @Body() dto: ConfirmationTicketDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.actions.issueTicket({
      principal: principalOf(request),
      binding: bindingOf(dto),
      actionDigest: dto.actionDigest,
      password: dto.password,
    });
    response.status(201);
    return result;
  }

  private setCookies(
    response: Response,
    mode: ReturnType<typeof resolveCookieMode>,
    cookies: V1CookiePayload,
  ): void {
    const names = cookieNames(mode);
    const now = new Date();
    const maxAge = Math.max(1, remainingSeconds(cookies.expiresAt, now));
    const sessionOptions = sessionCookieOptions(mode, maxAge);
    const csrfOptions = csrfCookieOptions(mode, maxAge);
    response.setHeader('Set-Cookie', [
      serializeCookie(names.session, cookies.sessionCookie, sessionOptions),
      serializeCookie(names.csrf, cookies.csrfCookie, csrfOptions),
    ]);
  }
}

function publicOrigin(): string {
  return process.env.WORKMESH_PUBLIC_ORIGIN ?? 'http://127.0.0.1:5173';
}

/** 删除同名 Cookie：SECURE 模式必须带 Secure，且 __Host- 前缀要求 Path=/、无 Domain。 */
function serializeDeletionCookie(
  name: string,
  mode: ReturnType<typeof resolveCookieMode>,
  httpOnly: boolean,
): string {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (mode === 'SECURE') parts.push('Secure');
  return parts.join('; ');
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; secure: boolean; sameSite: 'lax'; path: string; maxAge: number },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path}`,
    `Max-Age=${Math.floor(options.maxAge / 1000)}`,
    `SameSite=Lax`,
  ];
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
