import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import {
  V1_ERROR_CODES,
  WorkmeshError,
  containsForbiddenAgentScope,
  isKnownScope,
  type Principal,
} from '@workmesh/shared';
import { V1AuthorizationService } from './v1-authorization';
import { hashSecret, type V1Principal } from './v1-policy';
import { requireHuman } from './v1-account.service';
import { V1_AUTH_REPOSITORY } from './v1-auth.service';
import type { V1AuthRepository, V1CliAuthorizationRecord } from './v1-auth.repository';

export const CLI_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;
export const CLI_INTERVAL_SECONDS = 5;

const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NO_PROOF = V1_ERROR_CODES.AUTH_INVALID;

function unauthorized(message: string): WorkmeshError {
  return new WorkmeshError(NO_PROOF, message, undefined, 401);
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function newUserCode(): string {
  let code = '';
  for (let index = 0; index < 8; index += 1)
    code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function userCodeHashOf(code: string): string {
  return hashSecret(code.replace(/[^A-Z2-9]/g, '').toUpperCase());
}

/** PKCE S256：challenge = base64url(SHA256(verifier))，不使用 plain。 */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (typeof verifier !== 'string' || verifier.length < 43 || verifier.length > 128) return false;
  const computed = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  return (
    computed.length === challenge.length &&
    timingSafeEqual(Buffer.from(computed), Buffer.from(challenge))
  );
}

export type V1CredentialView = {
  credentialId: string;
  userId: string;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresAt: Date;
};

@Injectable()
export class V1CliAuthorizationService {
  constructor(
    @Inject(V1_AUTH_REPOSITORY) private readonly repository: V1AuthRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  async create(input: {
    clientName: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    credentialSecretHash: string;
    ip: string;
    now?: Date;
  }): Promise<Record<string, unknown>> {
    const now = input.now ?? new Date();
    await this.consumeRate('cli-create-ip', input.ip, 10, 10 * 60 * 1000, now);
    if (
      typeof input.clientName !== 'string' ||
      input.clientName.length < 1 ||
      input.clientName.length > 80
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'clientName 长度必须为 1–80',
        undefined,
        400,
      );
    if (input.codeChallengeMethod !== 'S256')
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, '仅支持 PKCE S256', undefined, 400);
    if (typeof input.codeChallenge !== 'string' || input.codeChallenge.length !== 43)
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'codeChallenge 必须是 43 字符 base64url',
        undefined,
        400,
      );
    if (
      typeof input.credentialSecretHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.credentialSecretHash)
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'credentialSecretHash 必须是 64 位小写 hex',
        undefined,
        400,
      );

    const deviceCode = randomBytes(32).toString('base64url');
    const userCode = newUserCode();
    const request = await this.repository.createCliAuthorization({
      clientName: input.clientName,
      deviceCodeHash: hashSecret(deviceCode),
      userCodeHash: userCodeHashOf(userCode),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: 'S256',
      credentialSecretHash: input.credentialSecretHash,
      expiresAt: new Date(now.getTime() + CLI_AUTHORIZATION_TTL_MS),
    });
    return {
      authorizationId: request.id,
      deviceCode,
      userCode,
      verificationUri: '/cli/authorize',
      expiresAt: request.expiresAt,
      intervalSeconds: CLI_INTERVAL_SECONDS,
    };
  }

  async lookup(input: {
    userCode: string;
    principal: Principal;
    now?: Date;
  }): Promise<Record<string, unknown>> {
    const principal = requireHuman(input.principal);
    const now = input.now ?? new Date();
    const sessionId = requireSessionId(principal);
    await this.consumeRate('cli-lookup-session', sessionId, 10, 10 * 60 * 1000, now);
    if (typeof input.userCode !== 'string')
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, '授权请求不存在', undefined, 404);
    const request = await this.repository.findCliAuthorizationByUserCodeHash(
      userCodeHashOf(input.userCode),
    );
    if (!request || request.expiresAt <= now)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, '授权请求不存在', undefined, 404);
    await this.repository.recordCliAuthorizationView({
      authorizationRequestId: request.id,
      webSessionId: sessionId,
      userId: principal.userId,
      expiresAt: new Date(now.getTime() + CLI_AUTHORIZATION_TTL_MS),
    });
    return {
      authorizationId: request.id,
      clientName: request.clientName,
      status: request.status,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      version: request.version,
    };
  }

  async approve(input: {
    authorizationId: string;
    principal: Principal;
    expectedVersion: number;
    projectId: string;
    roleId: string;
    scopes: string[];
    expiresInDays: number;
    now?: Date;
  }): Promise<Record<string, unknown>> {
    const principal = requireHuman(input.principal);
    const now = input.now ?? new Date();
    const sessionId = requireSessionId(principal);
    const request = await this.repository.findCliAuthorizationById(input.authorizationId);
    if (!request)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, '授权请求不存在', undefined, 404);
    if (request.expiresAt <= now)
      throw new WorkmeshError(
        V1_ERROR_CODES.AUTHORIZATION_EXPIRED,
        '授权请求已过期',
        undefined,
        410,
      );
    await this.assertView(request.id, sessionId, principal.userId, now);

    if (
      !Number.isInteger(input.expiresInDays) ||
      input.expiresInDays < 1 ||
      input.expiresInDays > 365
    )
      throw new WorkmeshError(
        V1_ERROR_CODES.INVALID_REQUEST,
        'expiresInDays 必须为 1–365',
        undefined,
        400,
      );
    if (!Array.isArray(input.scopes) || input.scopes.length === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.UNSUPPORTED_SCOPE,
        '必须选择至少一个 scope',
        undefined,
        422,
      );
    const invalid = input.scopes.filter((scope) => !isKnownScope(scope));
    if (invalid.length > 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.UNSUPPORTED_SCOPE,
        '包含未注册的 scope',
        { scopes: invalid },
        422,
      );
    if (containsForbiddenAgentScope(input.scopes))
      throw new WorkmeshError(
        V1_ERROR_CODES.UNSUPPORTED_SCOPE,
        'AGENT_SCOPE_REGISTRY_VIOLATION',
        undefined,
        422,
      );

    // 签发 Agent 凭据同样是项目范围内的写入：归档项目不应再产出新凭据。
    await this.authorization.resolveProjectContext(principal, input.projectId, 'write');
    const holdsRole = await this.authorization.hasBusinessRole(
      principal,
      input.projectId,
      input.roleId,
    );
    if (!holdsRole)
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        '不具备所选业务角色',
        { roleId: input.roleId },
        403,
      );

    const approved = await this.repository.approveCliAuthorization({
      id: request.id,
      userId: principal.userId,
      webSessionId: sessionId,
      expectedVersion: input.expectedVersion,
      projectId: input.projectId,
      roleId: input.roleId,
      scopes: [...input.scopes],
      expiresInDays: input.expiresInDays,
      now,
    });
    if (!approved) {
      const current = await this.repository.findCliAuthorizationById(request.id);
      if (current && current.expiresAt <= now)
        throw new WorkmeshError(
          V1_ERROR_CODES.AUTHORIZATION_EXPIRED,
          '授权请求已过期',
          undefined,
          410,
        );
      throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, '授权请求已变更', undefined, 409);
    }
    return {
      authorizationId: approved.id,
      status: approved.status,
      version: approved.version,
      expiresAt: approved.expiresAt,
    };
  }

  async deny(input: {
    authorizationId: string;
    principal: Principal;
    expectedVersion: number;
    now?: Date;
  }): Promise<Record<string, unknown>> {
    const principal = requireHuman(input.principal);
    const now = input.now ?? new Date();
    const sessionId = requireSessionId(principal);
    const request = await this.repository.findCliAuthorizationById(input.authorizationId);
    if (!request)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, '授权请求不存在', undefined, 404);
    if (request.expiresAt <= now)
      throw new WorkmeshError(
        V1_ERROR_CODES.AUTHORIZATION_EXPIRED,
        '授权请求已过期',
        undefined,
        410,
      );
    await this.assertView(request.id, sessionId, principal.userId, now);
    const denied = await this.repository.denyCliAuthorization({
      id: request.id,
      userId: principal.userId,
      webSessionId: sessionId,
      expectedVersion: input.expectedVersion,
      now,
    });
    if (!denied)
      throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, '授权请求已变更', undefined, 409);
    return { authorizationId: denied.id, status: denied.status, version: denied.version };
  }

  async poll(input: {
    authorizationId: string;
    deviceCode: string;
    codeVerifier: string;
    now?: Date;
  }): Promise<Record<string, unknown>> {
    const now = input.now ?? new Date();
    if (typeof input.deviceCode !== 'string' || input.deviceCode.length !== 43)
      throw unauthorized('设备码无效');
    const request = await this.repository.findCliAuthorizationById(input.authorizationId);
    if (!request || !safeEqualHex(hashSecret(input.deviceCode), request.deviceCodeHash))
      throw unauthorized('设备码无效');
    if (!verifyPkce(input.codeVerifier, request.codeChallenge)) throw unauthorized('PKCE 校验失败');
    if (request.expiresAt <= now)
      throw new WorkmeshError(
        V1_ERROR_CODES.AUTHORIZATION_EXPIRED,
        '授权请求已过期',
        undefined,
        410,
      );

    if (request.status === 'DENIED')
      throw new WorkmeshError(
        V1_ERROR_CODES.AUTHORIZATION_DENIED,
        '授权请求已被拒绝',
        undefined,
        403,
      );
    if (request.status === 'ISSUED') {
      const credential = request.issuedCredentialId
        ? await this.repository.findCredential(request.issuedCredentialId)
        : null;
      if (!credential) throw unauthorized('凭据不存在');
      return { status: 'ISSUED', credential: credentialView(credential) };
    }
    if (request.status === 'PENDING')
      return { status: 'PENDING', intervalSeconds: CLI_INTERVAL_SECONDS };

    return this.issue(request, now);
  }

  private async issue(
    request: V1CliAuthorizationRecord,
    now: Date,
  ): Promise<Record<string, unknown>> {
    if (
      !request.approvedUserId ||
      !request.approvedProjectId ||
      !request.approvedRoleId ||
      !request.approvedExpiresInDays
    )
      throw unauthorized('授权请求状态无效');
    const user = await this.repository.findUser(request.approvedUserId);
    if (!user || !user.isActive) throw unauthorized('授权账号已停用');
    let credential;
    try {
      credential = await this.repository.createCredential({
        userId: request.approvedUserId,
        projectId: request.approvedProjectId,
        roleId: request.approvedRoleId,
        name: `CLI ${request.clientName}`.slice(0, 80),
        tokenHash: request.credentialSecretHash,
        scopes: request.approvedScopes,
        userAuthVersion: user.authVersion,
        expiresAt: new Date(now.getTime() + request.approvedExpiresInDays * 24 * 60 * 60 * 1000),
      });
    } catch {
      // 并发 poll：另一个请求已签发，重新读取并返回同一凭据。
      const current = await this.repository.findCliAuthorizationById(request.id);
      if (current?.issuedCredentialId) {
        const existing = await this.repository.findCredential(current.issuedCredentialId);
        if (existing) return { status: 'ISSUED', credential: credentialView(existing) };
      }
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        '授权请求状态已变更',
        undefined,
        409,
      );
    }
    const issued = await this.repository.markCliAuthorizationIssued(request.id, credential.id, now);
    if (!issued) {
      // 状态推进失败：本次创建的凭据未绑定到授权请求，必须补偿撤销，避免孤儿凭据。
      // 若并发 poll 已签发另一凭据，返回既有凭据；否则报冲突，下一轮轮询可安全重试。
      await this.repository.revokeCredential(credential.id, request.approvedUserId, now);
      const current = await this.repository.findCliAuthorizationById(request.id);
      const issuedCredentialId = current?.issuedCredentialId ?? request.issuedCredentialId;
      if (issuedCredentialId) {
        const existing = await this.repository.findCredential(issuedCredentialId);
        if (existing) return { status: 'ISSUED', credential: credentialView(existing) };
      }
      throw new WorkmeshError(
        V1_ERROR_CODES.VERSION_CONFLICT,
        '授权请求状态已变更',
        undefined,
        409,
      );
    }
    return { status: 'ISSUED', credential: credentialView(credential) };
  }

  private async assertView(
    authorizationRequestId: string,
    webSessionId: string,
    userId: string,
    now: Date,
  ): Promise<void> {
    const exists = await this.repository.hasCliAuthorizationView({
      authorizationRequestId,
      webSessionId,
      userId,
      now,
    });
    if (!exists)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        '授权请求不存在',
        { authorizationRequestId },
        404,
      );
  }

  private async consumeRate(
    kind: string,
    key: string,
    limit: number,
    windowMs: number,
    now: Date,
  ): Promise<void> {
    const attempts = await this.repository.bumpRateWindow({
      kind,
      keyHash: hashSecret(key),
      now,
      windowMs,
    });
    if (attempts > limit)
      throw new WorkmeshError(
        V1_ERROR_CODES.RATE_LIMITED,
        '请求过于频繁',
        { retryAfterSeconds: Math.ceil(windowMs / 1000), window: kind },
        429,
      );
  }
}

function credentialView(credential: {
  id: string;
  userId: string;
  projectId: string;
  roleId: string;
  scopes: string[];
  expiresAt: Date;
}): V1CredentialView {
  return {
    credentialId: credential.id,
    userId: credential.userId,
    projectId: credential.projectId,
    roleId: credential.roleId,
    scopes: credential.scopes,
    expiresAt: credential.expiresAt,
  };
}

function requireSessionId(principal: V1Principal): string {
  if (!principal.sessionId)
    throw new WorkmeshError(
      V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      '缺少 WebSession',
      undefined,
      403,
    );
  return principal.sessionId;
}

/** 供动作预览/票据使用：只有人类会话可持有单次确认票据，也能取得会话 ID。 */
export function sessionIdOf(principal: Principal): string {
  return requireSessionId(requireHuman(principal));
}
