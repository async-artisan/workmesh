import type { PrincipalKind, Scope } from './protocol';

/**
 * 运行时主体。只能由认证 Guard 依据服务端凭据构造。
 * - HUMAN：来自有效 WebSession，不得携带 agentCredentialId；项目动作在服务端解析项目后补充 projectId/roleIds。
 * - AGENT：来自有效 AgentCredential，agentCredentialId、projectId 与**仅含一项**的 roleIds 必须存在。
 */
export type Principal = {
  kind: PrincipalKind;
  userId: string;
  agentCredentialId?: string;
  projectId?: string;
  roleIds?: readonly string[];
  scopes: readonly Scope[];
};

export const SCOPE_REGISTRY: readonly Scope[] = [
  'project:read',
  'workflow:read',
  'workflow:propose',
  'requirement:read',
  'requirement:propose',
  'clarification:write',
  'knowledge:read',
  'knowledge:propose',
  'task:read',
  'task:claim',
  'task:release',
  'task:deliver',
  'context:read',
  'context:create',
  'review:read',
  'review:request',
  'change:read',
  'change:ack',
  'integrations:receive',
  'integrations:prepare',
];

/**
 * Agent 永远不能获得的能力。即使这些动作名被放进 scopes，也以 422 UNSUPPORTED_SCOPE 拒绝。
 * 增加管理角色、拥有多个业务角色或创建自定义 roleKey 都不改变这条底线。
 */
export const AGENT_FORBIDDEN_SCOPE_TOKENS: readonly string[] = [
  'publish',
  'revoke',
  'approve',
  'decide',
  'admin',
  'owner',
  'member:manage',
  'grant:manage',
  'workflow:publish',
  'knowledge:publish',
  'requirement:confirm',
];

export type RoleSlot = { roleId: string; approvalSlotId: string | null } | null;

export type ActionBinding = {
  action: string;
  projectId: string | null;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  roleSlot: RoleSlot;
  payload: Record<string, unknown>;
};

export type Confirmation = { ticketId: string; ticketSecret: string };

export function isKnownScope(value: string): value is Scope {
  return (SCOPE_REGISTRY as readonly string[]).includes(value);
}

/**
 * scope 是区分大小写的有限字符串：不支持 `*`，不支持前缀通配，不支持角色名替代或客户端扩展。
 */
export function validateScopeSet(
  scopes: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(scopes) || scopes.length === 0) return { ok: false, reason: 'EMPTY' };
  const seen = new Set<string>();
  for (const scope of scopes) {
    if (typeof scope !== 'string') return { ok: false, reason: 'NOT_STRING' };
    if (scope.includes('*')) return { ok: false, reason: 'WILDCARD' };
    if (!isKnownScope(scope)) return { ok: false, reason: 'UNKNOWN_SCOPE' };
    if (seen.has(scope)) return { ok: false, reason: 'DUPLICATE' };
    seen.add(scope);
  }
  return { ok: true };
}

export function containsForbiddenAgentScope(scopes: readonly string[] | null | undefined): boolean {
  if (!scopes) return false;
  return scopes.some((scope) =>
    AGENT_FORBIDDEN_SCOPE_TOKENS.some(
      (token) => scope === token || scope.startsWith(`${token}:`) || scope.endsWith(`:${token}`),
    ),
  );
}

/**
 * 主体形状不变量。HUMAN 不得携带凭据；AGENT 必须携带凭据、项目与唯一业务角色。
 */
export function assertPrincipalShape(principal: Principal): void {
  if (principal.kind === 'HUMAN') {
    if (principal.agentCredentialId)
      throw new Error('HUMAN principal must not carry agentCredentialId');
    return;
  }
  if (!principal.agentCredentialId) throw new Error('AGENT principal requires agentCredentialId');
  if (!principal.projectId) throw new Error('AGENT principal requires projectId');
  if (!principal.roleIds || principal.roleIds.length !== 1)
    throw new Error('AGENT principal requires exactly one roleId');
}

/**
 * 幂等主体键：HUMAN 按 userId，AGENT 按 credentialId。换凭据不是同一主体的透明重试。
 */
export function principalScopeKey(principal: Principal): string {
  return principal.kind === 'AGENT' && principal.agentCredentialId
    ? `agent:${principal.agentCredentialId}`
    : `user:${principal.userId}`;
}

/**
 * 项目动作 scope 为 `project:<UUID>`；账号级动作使用 `account:<userId>` 且不伪造隐藏 Project。
 */
export function projectScopeKey(projectId: string): string {
  return `project:${projectId}`;
}

export function accountScopeKey(userId: string): string {
  return `account:${userId}`;
}

export function hasScope(principal: Principal, scope: Scope): boolean {
  // HUMAN 的 scopes 只是本次动作能力的运行时结果，不是客户端令牌声明；
  // 业务授权仍必须与当前成员/角色/KB 权限求交，因此这里只做 scope 存在性判断。
  return principal.scopes.includes(scope);
}

/**
 * AGENT 对项目内动作的硬边界：projectId 必须完全相同，且只允许其唯一业务角色。
 */
export function agentProjectAllowed(principal: Principal, projectId: string): boolean {
  if (principal.kind !== 'AGENT') return true;
  return principal.projectId === projectId;
}

export function agentRoleAllowed(principal: Principal, roleId: string | null | undefined): boolean {
  if (principal.kind !== 'AGENT') return true;
  if (!roleId) return false;
  return principal.roleIds?.length === 1 && principal.roleIds[0] === roleId;
}
