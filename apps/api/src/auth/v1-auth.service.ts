import { Inject, Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Scope } from '@workmesh/shared';
import { classifyCredential } from './v1-credential-policy';
import { containsForbiddenAgentScope } from '@workmesh/shared';
import { equalSecret, parseOpaqueSessionCookie, rejectSelfAssertedIdentity, validateCsrf, validateOrigin, type V1Principal } from './v1-policy';
import { parseAgentBearerToken, type V1AuthRepository } from './v1-auth.repository';

export const V1_AUTH_REPOSITORY = Symbol('V1_AUTH_REPOSITORY');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type V1AuthInput = {
  authorization?: string;
  sessionCookie?: string;
  csrfCookie?: string;
  csrfHeader?: string;
  method?: string;
  origin?: string;
  publicOrigin: string;
  body?: Record<string, unknown>;
  now?: Date;
};

@Injectable()
export class V1AuthService {
  constructor(@Inject(V1_AUTH_REPOSITORY) private readonly repository: V1AuthRepository) {}

  async authenticate(input: V1AuthInput): Promise<V1Principal> {
    if (input.body) {
      try {
        rejectSelfAssertedIdentity(input.body);
      } catch {
        throw new WorkmeshError(V1_ERROR_CODES.SELF_ASSERTED_IDENTITY, '请求体不得包含自报身份字段', undefined, 400);
      }
    }
    const method = (input.method ?? 'GET').toUpperCase();
    const kind = classifyCredential({ authorization: input.authorization, sessionCookie: input.sessionCookie });
    if (kind === 'CONFLICT')
      throw new WorkmeshError(V1_ERROR_CODES.CREDENTIAL_CONFLICT, '不得同时使用 Agent 令牌与人类会话', undefined, 401);
    if (kind === 'NONE')
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '缺少有效凭据', undefined, 401);

    const now = input.now ?? new Date();
    if (kind === 'HUMAN_SESSION') return this.authenticateSession(input, now, method);
    return this.authenticateAgent(input, now);
  }

  private async authenticateSession(input: V1AuthInput, now: Date, method: string): Promise<V1Principal> {
    const parsed = parseOpaqueSessionCookie(input.sessionCookie ?? '');
    if (!parsed) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话 Cookie 格式无效', undefined, 401);
    if (!SAFE_METHODS.has(method) && !validateOrigin(input.origin, input.publicOrigin))
      throw new WorkmeshError(V1_ERROR_CODES.UNSAFE_ORIGIN, '非安全方法要求精确匹配的 Origin', undefined, 403);
    const session = await this.repository.findSession(parsed.sessionId);
    if (!session)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话不存在', undefined, 401);
    // CSRF：相等之外还必须对原值算摘要并与本会话 csrfTokenHash 常量时间比较。
    if (!SAFE_METHODS.has(method) && !validateCsrf(input.csrfHeader, input.csrfCookie, session.csrfTokenHash))
      throw new WorkmeshError(V1_ERROR_CODES.CSRF_FAILED, 'CSRF 校验失败', undefined, 403);
    if (!session.userId || !session.user)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话未登录', undefined, 401);
    if (session.revokedAt || session.expiresAt <= now || session.idleExpiresAt <= now)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话已失效', undefined, 401);
    if (!equalSecret(parsed.secret, session.tokenHash))
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话密钥不匹配', undefined, 401);
    if (!session.user.isActive)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '账号已停用', undefined, 401);
    if (session.userAuthVersion !== null && session.userAuthVersion !== session.user.authVersion)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '会话已被用户授权版本作废', undefined, 401);
    await this.repository.touchSession(session.id, now);
    return {
      kind: 'HUMAN',
      userId: session.userId,
      scopes: [],
      sessionId: session.id,
      authVersion: session.userAuthVersion ?? session.user.authVersion,
    };
  }

  private async authenticateAgent(input: V1AuthInput, now: Date): Promise<V1Principal> {
    const token = (input.authorization ?? '').slice('Bearer '.length);
    const parsed = parseAgentBearerToken(token);
    if (!parsed) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'Agent 令牌格式无效', undefined, 401);
    const credential = await this.repository.findCredential(parsed.credentialId);
    if (!credential) throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'Agent 凭据不存在', undefined, 401);
    if (credential.revokedAt || credential.expiresAt <= now)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'Agent 凭据已失效', undefined, 401);
    if (!equalSecret(parsed.secret, credential.tokenHash))
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'Agent 密钥不匹配', undefined, 401);
    if (!credential.user.isActive)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, '授权账号已停用', undefined, 401);
    if (credential.userAuthVersion !== credential.user.authVersion)
      throw new WorkmeshError(V1_ERROR_CODES.AUTH_REQUIRED, 'Agent 凭据已被用户授权版本作废', undefined, 401);
    // Agent 即使被写入受保护动作名也不能获得相应能力。
    if (containsForbiddenAgentScope(credential.scopes))
      throw new WorkmeshError(V1_ERROR_CODES.UNSUPPORTED_SCOPE, 'AGENT_SCOPE_REGISTRY_VIOLATION', undefined, 422);
    return {
      kind: 'AGENT',
      userId: credential.userId,
      agentCredentialId: credential.id,
      projectId: credential.projectId,
      roleIds: [credential.roleId],
      scopes: [...credential.scopes] as Scope[],
      authVersion: credential.userAuthVersion,
    };
  }
}
