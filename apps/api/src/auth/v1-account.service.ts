import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import {
  ANONYMOUS_SESSION_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from './v1-cookie-policy';
import {
  equalSecret,
  hashSecret,
  randomSecret,
  validateCsrf,
  validateOrigin,
  type V1Principal,
} from './v1-policy';
import { V1_AUTH_REPOSITORY } from './v1-auth.service';
import type { V1AuthRepository, V1SessionRecord, V1UserRecord } from './v1-auth.repository';

export type V1CookiePayload = {
  sessionId: string;
  sessionCookie: string;
  csrfCookie: string;
  csrfToken: string;
  expiresAt: Date;
};

export type V1SessionView = {
  authenticated: boolean;
  sessionId: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  csrfToken: string;
  user?: { id: string; email: string };
};

export type V1PasswordAttemptInput = {
  sessionId: string;
  userId: string;
};

export const RATE_WINDOW_15M = 15 * 60 * 1000;
export const RATE_WINDOW_10M = 10 * 60 * 1000;

const EMAIL_RX = /^[^\s@]{1,64}@[^\s@]{1,190}$/;
const BCRYPT_ROUNDS = 12;
/** 合法 60 字符 bcrypt 摘要：账号不存在时也执行等价比较，避免时间侧信道枚举。 */
const DUMMY_PASSWORD_HASH = `$2a$12$${'x'.repeat(53)}`;

function authInvalid(): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.AUTH_INVALID, '邮箱或密码不正确', undefined, 401);
}

@Injectable()
export class V1AccountService {
  constructor(@Inject(V1_AUTH_REPOSITORY) private readonly repository: V1AuthRepository) {}

  /**
   * 解析登录/注册所需的匿名会话：必须已有有效会话 cookie，并通过 Origin/CSRF 校验。
   */
  async requireAnonymousSession(input: {
    sessionCookie?: string;
    csrfCookie?: string;
    csrfHeader?: string;
    origin?: string;
    method?: string;
    publicOrigin: string;
    now?: Date;
  }): Promise<V1SessionRecord> {
    if (!validateOrigin(input.origin, input.publicOrigin))
      throw new WorkmeshError(V1_ERROR_CODES.UNSAFE_ORIGIN, '非安全方法要求精确匹配的 Origin', undefined, 403);
    const parsed = input.sessionCookie ? parseCookie(input.sessionCookie) : null;
    if (!parsed) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少会话 Cookie', undefined, 401);
    const session = await this.repository.findSession(parsed.sessionId);
    const now = input.now ?? new Date();
    if (!session || session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话已失效', undefined, 401);
    if (!equalSecret(parsed.secret, session.tokenHash))
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话密钥不匹配', undefined, 401);
    if (!validateCsrf(input.csrfHeader, input.csrfCookie, session.csrfTokenHash))
      throw new WorkmeshError(V1_ERROR_CODES.CSRF_FAILED, 'CSRF 校验失败', undefined, 403);
    return session;
  }

  /**
   * 会话引导：有效会话复用账号；缺失或无效时建立 10 分钟匿名会话。
   * CSRF 缺失时只轮换 CSRF，不轮换账号。
   */
  async bootstrap(input: {
    sessionCookie?: string;
    csrfCookie?: string;
    now?: Date;
  }): Promise<{ view: V1SessionView; cookies: V1CookiePayload | null }> {
    const now = input.now ?? new Date();
    const parsed = input.sessionCookie ? parseCookie(input.sessionCookie) : null;
    if (parsed) {
      const session = await this.repository.findSession(parsed.sessionId);
      if (
        session &&
        !session.revokedAt &&
        session.expiresAt > now &&
        session.idleExpiresAt > now &&
        equalSecret(parsed.secret, session.tokenHash) &&
        (session.userId === null || session.user)
      ) {
        if (session.user && !session.user.isActive)
          return this.createAnonymous(now);
        if (
          session.userId !== null &&
          session.user &&
          session.userAuthVersion !== session.user.authVersion
        )
          return this.createAnonymous(now);
        // 已有 CSRF cookie 且摘要匹配时复用；否则仅轮换 CSRF。
        let csrfToken = input.csrfCookie;
        let cookies: V1CookiePayload | null = null;
        if (!csrfToken || !validateCsrf(csrfToken, csrfToken, session.csrfTokenHash)) {
          csrfToken = randomSecret();
          await this.repository.updateSessionCsrf(session.id, hashSecret(csrfToken));
          cookies = {
            sessionId: session.id,
            sessionCookie: `wm_s1.${session.id}.${parsed.secret}`,
            csrfCookie: csrfToken,
            csrfToken,
            expiresAt: session.expiresAt,
          };
        }
        await this.repository.touchSession(session.id, now);
        const account = session.userId ? await this.repository.findUser(session.userId) : null;
        return {
          view: {
            authenticated: session.userId !== null,
            sessionId: session.id,
            expiresAt: session.expiresAt,
            idleExpiresAt: session.idleExpiresAt,
            csrfToken: csrfToken ?? '',
            ...(account ? { user: { id: account.id, email: account.email } } : {}),
          },
          cookies,
        };
      }
    }
    return this.createAnonymous(now);
  }

  private async createAnonymous(now: Date): Promise<{ view: V1SessionView; cookies: V1CookiePayload }> {
    const created = await this.createSession(null, null, now, ANONYMOUS_SESSION_TIMEOUT_MS);
    return {
      view: {
        authenticated: false,
        sessionId: created.sessionId,
        expiresAt: created.expiresAt,
        idleExpiresAt: created.expiresAt,
        csrfToken: created.csrfToken,
      },
      cookies: created,
    };
  }

  private async createSession(
    userId: string | null,
    userAuthVersion: number | null,
    now: Date,
    absoluteMs: number,
  ): Promise<V1CookiePayload> {
    const sessionId = randomUUID();
    const secret = randomSecret();
    const csrfToken = randomSecret();
    const expiresAt = new Date(now.getTime() + absoluteMs);
    const idleExpiresAt = new Date(now.getTime() + Math.min(SESSION_IDLE_TIMEOUT_MS, absoluteMs));
    await this.repository.createSession({
      id: sessionId,
      userId,
      tokenHash: hashSecret(secret),
      csrfTokenHash: hashSecret(csrfToken),
      userAuthVersion,
      idleExpiresAt,
      expiresAt,
    });
    return {
      sessionId,
      sessionCookie: `wm_s1.${sessionId}.${secret}`,
      csrfCookie: csrfToken,
      csrfToken,
      expiresAt,
    };
  }

  async register(input: {
    email: string;
    password: string;
    name?: string;
    session: V1SessionRecord;
    ip: string;
    now?: Date;
  }): Promise<{ user: V1UserRecord; cookies: V1CookiePayload }> {
    const now = input.now ?? new Date();
    await this.consumeRate('register-ip', input.ip, 30, RATE_WINDOW_15M, now);
    const email = normalizeEmail(input.email);
    if (!EMAIL_RX.test(email))
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '邮箱格式无效', undefined, 400);
    if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 200)
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '密码长度必须为 8–200', undefined, 400);
    if (input.name !== undefined && (input.name.length < 1 || input.name.length > 80))
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '名称长度必须为 1–80', undefined, 400);

    const existing = await this.repository.findUserByEmail(email);
    if (existing) throw new WorkmeshError(V1_ERROR_CODES.EMAIL_IN_USE, '该邮箱已注册', undefined, 409);

    let user: V1UserRecord;
    try {
      user = await this.repository.createUser({
        email,
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      });
    } catch {
      throw new WorkmeshError(V1_ERROR_CODES.EMAIL_IN_USE, '该邮箱已注册', undefined, 409);
    }
    await this.repository.revokeSession(input.session.id, now);
    const cookies = await this.createSession(user.id, user.authVersion, now, SESSION_ABSOLUTE_TIMEOUT_MS);
    return { user, cookies };
  }

  async login(input: {
    email: string;
    password: string;
    session: V1SessionRecord;
    ip: string;
    now?: Date;
  }): Promise<{ user: V1UserRecord; cookies: V1CookiePayload }> {
    const now = input.now ?? new Date();
    const email = normalizeEmail(input.email);
    await this.consumeRate('login-ip', input.ip, 30, RATE_WINDOW_15M, now);
    await this.consumeRate('login-email', hashSecret(email), 5, RATE_WINDOW_15M, now);

    const user = await this.repository.findUserByEmail(email);
    // 不存在的用户也执行等价 bcrypt 比较，避免通过响应时间枚举账号。
    const hash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const matches = await bcrypt.compare(input.password, hash);
    if (!user || !matches || !user.isActive) throw authInvalid();

    await this.repository.revokeSession(input.session.id, now);
    const cookies = await this.createSession(user.id, user.authVersion, now, SESSION_ABSOLUTE_TIMEOUT_MS);
    return { user, cookies };
  }

  async logout(sessionId: string, now = new Date()): Promise<void> {
    await this.repository.revokeSession(sessionId, now);
  }

  async reauthenticate(input: V1PasswordAttemptInput & { password: string; now?: Date }): Promise<V1UserRecord> {
    const now = input.now ?? new Date();
    await this.consumeRate('password-verify-session', input.sessionId, 5, RATE_WINDOW_15M, now);
    const user = await this.repository.findUser(input.userId);
    if (!user || !user.isActive) throw authInvalid();
    if (!(await bcrypt.compare(input.password, user.passwordHash))) throw authInvalid();
    return user;
  }

  async me(principal: Principal): Promise<Record<string, unknown>> {
    if (principal.kind === 'AGENT') {
      return {
        principal: { kind: 'AGENT', agentCredentialId: principal.agentCredentialId ?? null, projectId: principal.projectId ?? null, roleIds: principal.roleIds ?? [], scopes: principal.scopes },
      };
    }
    const user = await this.repository.findUser(principal.userId);
    if (!user) throw new WorkmeshError(V1_ERROR_CODES.AUTH_INVALID, '账号不存在', undefined, 401);
    const sessionId = (principal as V1Principal).sessionId;
    const session = sessionId ? await this.repository.findSession(sessionId) : null;
    return {
      principal: { kind: 'HUMAN', userId: principal.userId, scopes: principal.scopes },
      user: { id: user.id, email: user.email, isActive: user.isActive },
      session: session ? { expiresAt: session.expiresAt, idleExpiresAt: session.idleExpiresAt } : null,
    };
  }

  async listCredentials(principal: Principal): Promise<Array<Record<string, unknown>>> {
    requireHuman(principal);
    const credentials = await this.repository.listCredentials(principal.userId);
    return credentials.map((credential) => ({
      id: credential.id,
      name: credential.name,
      projectId: credential.projectId,
      roleId: credential.roleId,
      scopes: credential.scopes,
      expiresAt: credential.expiresAt,
      revokedAt: credential.revokedAt,
    }));
  }

  /**
   * 吊销凭据：HUMAN 保持原行为；AGENT 只可吊销自身凭据，且凭据必须属于其授权用户。
   * 任何越界尝试统一 404，不泄露他人凭据是否存在。
   */
  async revokeCredential(principal: Principal, credentialId: string, now = new Date()): Promise<{ revoked: true }> {
    if (principal.kind === 'AGENT') {
      if (principal.agentCredentialId !== credentialId) throw credentialNotFound(credentialId);
      const credential = await this.repository.findCredential(credentialId);
      if (!credential || credential.userId !== principal.userId) throw credentialNotFound(credentialId);
      const selfRevoked = await this.repository.revokeCredential(credentialId, principal.userId, now);
      if (!selfRevoked) throw credentialNotFound(credentialId);
      return { revoked: true };
    }
    requireHuman(principal);
    const revoked = await this.repository.revokeCredential(credentialId, principal.userId, now);
    if (!revoked) throw credentialNotFound(credentialId);
    return { revoked: true };
  }

  async consumeRate(
    kind: string,
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<void> {
    const attempts = await this.repository.bumpRateWindow({ kind, keyHash: hashSecret(key), now, windowMs });
    if (attempts > limit) {
      const retryAfterSeconds = Math.ceil(windowMs / 1000);
      throw new WorkmeshError(
        V1_ERROR_CODES.RATE_LIMITED,
        '请求过于频繁',
        { retryAfterSeconds, window: kind },
        429,
      );
    }
  }
}

function credentialNotFound(credentialId: string): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, '凭据不存在', { credentialId }, 404);
}

export function requireHuman(principal: Principal): V1Principal {
  if (principal.kind !== 'HUMAN')
    throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, '该动作仅允许人类会话', undefined, 403);
  return principal as V1Principal;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseCookie(value: string): { sessionId: string; secret: string } | null {
  const match = /^wm_s1\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(value);
  return match ? { sessionId: match[1], secret: match[2] } : null;
}
