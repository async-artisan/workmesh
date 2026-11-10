import { ACCEPTANCE_KEY_PATTERN, V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { V1KnowledgeAccess } from '../auth/v1-authorization';

export type KnowledgePermission = 'READ' | 'PROPOSE' | 'PUBLISH' | 'REVOKE';
export type KnowledgeVisibility = 'PROJECT' | 'RESTRICTED';
export type RevisionState = 'CANDIDATE' | 'PUBLISHED' | 'WITHDRAWN';
export type DocumentKind = 'UNDERSTANDING' | 'DECISION' | 'PRD' | 'KNOWLEDGE';

export type V1RevisionVisibility = {
  /** 当前 KB 权限交集；已由 V1AuthorizationService 按成员/角色/grant/scope 推导。 */
  access: V1KnowledgeAccess;
  isAuthor: boolean;
  isAssignedReviewer: boolean;
};

export function canReadKnowledge(access: V1KnowledgeAccess): boolean {
  return access.isActiveMember && access.canRead;
}

export function canProposeKnowledge(access: V1KnowledgeAccess): boolean {
  return canReadKnowledge(access) && access.canPropose;
}

export function canPublishKnowledge(
  access: V1KnowledgeAccess,
  principalKind: 'HUMAN' | 'AGENT',
): boolean {
  return principalKind === 'HUMAN' && canReadKnowledge(access) && access.canPublish;
}

/**
 * 候选可见性：先满足当前成员及 KB READ，再判断作者、明确评审者或当前 PROPOSE/PUBLISH 资格。
 * 作者被撤权后同样拒绝；无对象访问权由调用方按 404 返回，不泄露对象存在性。
 */
export function visibleRevisionState(
  state: RevisionState,
  visibility: V1RevisionVisibility,
): RevisionState | null {
  if (!canReadKnowledge(visibility.access)) return null;
  if (state === 'PUBLISHED') return state;
  if (state === 'WITHDRAWN') return visibility.access.canPublish ? state : null;
  const authorOrReviewer = visibility.isAuthor || visibility.isAssignedReviewer;
  const hasProposeOrPublish = visibility.access.canPropose || visibility.access.canPublish;
  return authorOrReviewer || hasProposeOrPublish ? state : null;
}

export function assertVisibleRevision(
  state: RevisionState | null,
  revisionId: string,
): RevisionState {
  if (!state)
    throw new WorkmeshError(
      V1_ERROR_CODES.KNOWLEDGE_ACCESS_DENIED,
      'KNOWLEDGE_ACCESS_DENIED',
      { revisionId },
      404,
    );
  return state;
}

/**
 * 文档 kind 与 requirement 绑定派生 Agent scope 要求（05 §5）：
 * UNDERSTANDING/PRD 及绑定 requirement 的 DECISION 要求 requirement:propose；
 * KNOWLEDGE 及无 requirement 的 DECISION 要求 knowledge:propose；两者都同时要求 KB PROPOSE。
 */
export function requiredProposeScope(
  kind: DocumentKind,
  hasRequirement: boolean,
): 'requirement:propose' | 'knowledge:propose' {
  if (kind === 'UNDERSTANDING' || kind === 'PRD') return 'requirement:propose';
  if (kind === 'DECISION' && hasRequirement) return 'requirement:propose';
  return 'knowledge:propose';
}

export function assertProposeScopes(input: {
  principalKind: 'HUMAN' | 'AGENT';
  scopes: readonly string[];
  required: 'requirement:propose' | 'knowledge:propose';
}): void {
  if (input.principalKind !== 'AGENT') return;
  if (!input.scopes.includes(input.required))
    throw new WorkmeshError(
      V1_ERROR_CODES.SCOPE_DENIED,
      'SCOPE_DENIED',
      { scope: input.required },
      403,
    );
}

export type V1AcceptanceVerification = 'TEST' | 'INSPECTION' | 'DEMO';

export type V1AcceptanceItem = {
  key: string;
  text: string;
  verification: V1AcceptanceVerification;
};

export type V1DeliveryScope = {
  participatingRoleIds: string[];
  requiredOutputKinds: Array<'PRD' | 'DESIGN' | 'IMPL' | 'CASES' | 'RELEASE'>;
  excludedRoles: Array<{ roleId: string; reason: string }>;
};

const ARTIFACT_KINDS = new Set(['PRD', 'DESIGN', 'IMPL', 'CASES', 'RELEASE']);
const VERIFICATIONS = new Set<V1AcceptanceVerification>(['TEST', 'INSPECTION', 'DEMO']);

function invalid(message: string, details?: Record<string, unknown>): WorkmeshError {
  return new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, message, details, 422);
}

export function reviewKindForDocument(
  kind: DocumentKind,
): 'UNDERSTANDING_CONFIRM' | 'PRD_PUBLICATION' | 'KNOWLEDGE_PUBLICATION' {
  if (kind === 'UNDERSTANDING') return 'UNDERSTANDING_CONFIRM';
  if (kind === 'PRD') return 'PRD_PUBLICATION';
  return 'KNOWLEDGE_PUBLICATION';
}

/**
 * deliveryScope 规范化：角色去重、产物去重并排序、排除角色不得同时也是参与角色。
 * 交付范围必须包含 IMPL，不能借自定义范围删掉实现产出（02 §2 工作流编译规则）。
 */
export function normalizeDeliveryScope(
  input: unknown,
  knownRoleIds: readonly string[],
): V1DeliveryScope {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw invalid('deliveryScope 必须是对象');
  const raw = input as Record<string, unknown>;
  const participating = raw.participatingRoleIds;
  const outputs = raw.requiredOutputKinds;
  const excluded = raw.excludedRoles ?? [];
  if (!Array.isArray(participating) || participating.length === 0)
    throw invalid('deliveryScope.participatingRoleIds 至少包含一个角色');
  if (!Array.isArray(outputs) || outputs.length === 0)
    throw invalid('deliveryScope.requiredOutputKinds 至少包含一个产物类型');
  if (!Array.isArray(excluded)) throw invalid('deliveryScope.excludedRoles 必须是数组');

  const roleIds = new Set<string>();
  for (const roleId of participating) {
    if (typeof roleId !== 'string' || !roleId)
      throw invalid('deliveryScope.participatingRoleIds 必须是 roleId 数组');
    if (!knownRoleIds.includes(roleId)) throw invalid('deliveryScope 含未知项目角色', { roleId });
    roleIds.add(roleId);
  }
  const kinds = new Set<string>();
  for (const kind of outputs) {
    if (typeof kind !== 'string' || !ARTIFACT_KINDS.has(kind))
      throw invalid('deliveryScope.requiredOutputKinds 含未知产物类型', { kind });
    kinds.add(kind);
  }
  if (!kinds.has('IMPL')) throw invalid('deliveryScope.requiredOutputKinds 必须包含 IMPL');

  const excludedRoles: Array<{ roleId: string; reason: string }> = [];
  const excludedIds = new Set<string>();
  for (const entry of excluded) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw invalid('deliveryScope.excludedRoles 项必须是 {roleId, reason}');
    const { roleId, reason } = entry as { roleId?: unknown; reason?: unknown };
    if (typeof roleId !== 'string' || !roleId)
      throw invalid('deliveryScope.excludedRoles 缺少 roleId');
    if (!knownRoleIds.includes(roleId)) throw invalid('deliveryScope 排除未知项目角色', { roleId });
    if (roleIds.has(roleId)) throw invalid('deliveryScope 排除角色不得同时参与', { roleId });
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 200)
      throw invalid('deliveryScope.excludedRoles.reason 长度必须为 1–200');
    if (excludedIds.has(roleId)) throw invalid('deliveryScope.excludedRoles 角色重复', { roleId });
    excludedIds.add(roleId);
    excludedRoles.push({ roleId, reason: reason.trim() });
  }

  return {
    participatingRoleIds: [...roleIds].sort(),
    requiredOutputKinds: [...kinds].sort() as V1DeliveryScope['requiredOutputKinds'],
    excludedRoles: excludedRoles.sort((left, right) => left.roleId.localeCompare(right.roleId)),
  };
}

/** 验收条款：1–200 条、key 唯一且符合标识规则、text 1–2000、verification 仅 TEST/INSPECTION/DEMO。 */
export function normalizeAcceptance(input: unknown): V1AcceptanceItem[] {
  if (!Array.isArray(input) || input.length === 0) throw invalid('PRD 必须至少包含一条验收条款');
  if (input.length > 200) throw invalid('验收条款最多 200 条');
  const keys = new Set<string>();
  const normalized: V1AcceptanceItem[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw invalid('验收条款项必须是对象');
    const { key, text, verification } = entry as {
      key?: unknown;
      text?: unknown;
      verification?: unknown;
    };
    if (typeof key !== 'string' || !ACCEPTANCE_KEY_PATTERN.test(key))
      throw invalid('验收条款 key 必须匹配 [a-z][a-z0-9-]{1,63}', { key });
    if (keys.has(key)) throw invalid('验收条款 key 必须唯一', { key });
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > 2000)
      throw invalid('验收条款 text 长度必须为 1–2000', { key });
    if (
      typeof verification !== 'string' ||
      !VERIFICATIONS.has(verification as V1AcceptanceVerification)
    )
      throw invalid('验收条款 verification 仅支持 TEST/INSPECTION/DEMO', { key });
    keys.add(key);
    normalized.push({
      key,
      text: text.trim(),
      verification: verification as V1AcceptanceVerification,
    });
  }
  return normalized;
}
