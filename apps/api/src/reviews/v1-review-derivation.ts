import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { V1ReviewKind, V1ReviewListQuery } from './v1-review.repository';

/** 文档修订的评审 kind 由文档类型唯一决定，客户端不能自选。 */
export function documentReviewKindOf(
  documentKind: 'UNDERSTANDING' | 'PRD' | 'KNOWLEDGE' | 'DECISION',
): V1ReviewKind {
  switch (documentKind) {
    case 'UNDERSTANDING':
      return 'UNDERSTANDING_CONFIRM';
    case 'PRD':
      return 'PRD_PUBLICATION';
    case 'KNOWLEDGE':
    case 'DECISION':
      return 'KNOWLEDGE_PUBLICATION';
  }
}

export type V1AcceptanceSlotBinding = {
  slotKey: string;
  roleId: string;
  userId: string;
};

type DefinitionStep = {
  key?: unknown;
  gates?: Array<{ reviewerSlots?: unknown }>;
};

type DefinitionRoleSlot = { key?: unknown; kind?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 从已发布 workflow revision 与本实例 bindings 派生 TASK_ACCEPTANCE 审批槽。
 * 规则与交付时 acceptanceSlots 一致：只有步骤门禁引用、且定义 kind 为 TASK_ACCEPTANCE 的
 * reviewerSlot 才生效；槽位绑定缺失按 422 拒绝，不静默跳过。
 */
export function taskAcceptanceSlotBindings(
  definition: unknown,
  bindings: unknown,
  stepKey: string,
  taskId: string,
): V1AcceptanceSlotBinding[] {
  const definitionRecord = asRecord(definition);
  if (!definitionRecord) return [];
  const steps = Array.isArray(definitionRecord.steps)
    ? (definitionRecord.steps as DefinitionStep[])
    : [];
  const roleSlots = Array.isArray(definitionRecord.roleSlots)
    ? (definitionRecord.roleSlots as DefinitionRoleSlot[])
    : [];

  const step = steps.find((entry) => asRecord(entry)?.key === stepKey);
  if (!step) return [];

  const slotKinds = new Map<string, string>();
  for (const slot of roleSlots) {
    if (typeof slot.key === 'string' && typeof slot.kind === 'string')
      slotKinds.set(slot.key, slot.kind);
  }

  const reviewerSlots = new Set<string>();
  for (const gate of Array.isArray(step.gates) ? step.gates : []) {
    const reviewerEntries = Array.isArray(gate?.reviewerSlots) ? gate.reviewerSlots : [];
    for (const reviewer of reviewerEntries) {
      if (typeof reviewer === 'string' && slotKinds.get(reviewer) === 'TASK_ACCEPTANCE')
        reviewerSlots.add(reviewer);
    }
  }

  const bindingsRecord = asRecord(bindings);
  const rawBindings = bindingsRecord?.roleSlotBindings;
  const roleSlotBindings = Array.isArray(rawBindings)
    ? rawBindings.filter((entry): entry is Record<string, unknown> => asRecord(entry) !== null)
    : [];

  const resolved: V1AcceptanceSlotBinding[] = [];
  for (const slotKey of [...reviewerSlots].sort()) {
    const binding = roleSlotBindings.find((entry) => entry.slotKey === slotKey);
    const roleId = binding?.roleId;
    const userId = binding?.userId;
    if (typeof roleId !== 'string' || typeof userId !== 'string')
      throw new WorkmeshError(
        V1_ERROR_CODES.REVIEW_PRECONDITION_FAILED,
        'TASK_ACCEPTANCE_BINDING_MISSING',
        { taskId, slotKey },
        422,
      );
    resolved.push({ slotKey, roleId, userId });
  }
  return resolved;
}

export function encodeReviewCursor(value: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({ t: value.createdAt.toISOString(), i: value.id }),
    'utf8',
  ).toString('base64url');
}

export function decodeReviewCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t?: unknown;
      i?: unknown;
    };
    if (typeof parsed.t !== 'string' || typeof parsed.i !== 'string') throw new Error('bad cursor');
    const createdAt = new Date(parsed.t);
    if (Number.isNaN(createdAt.getTime())) throw new Error('bad cursor');
    return { createdAt, id: parsed.i };
  } catch {
    throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'INVALID_CURSOR', undefined, 422);
  }
}

/** 项目/可见性/角色与游标条件在 SQL 层完成，先过滤再分页，避免分页后裁剪。 */
function knowledgeBaseReadableWhere(query: V1ReviewListQuery): Prisma.KnowledgeBaseWhereInput {
  const grants: Prisma.KnowledgeBaseGrantWhereInput[] = [
    {
      subjectKind: 'USER',
      subjectUserId: query.userId,
      revokedAt: null,
      permissions: { has: 'READ' },
    },
  ];
  if (query.activeRoleIds.length > 0) {
    grants.push({
      subjectKind: 'ROLE',
      subjectRoleId: { in: [...query.activeRoleIds] },
      revokedAt: null,
      permissions: { has: 'READ' },
    });
  }
  return { OR: [{ visibility: 'PROJECT' }, { grants: { some: { OR: grants } } }] };
}

function slotAssignmentWhere(query: V1ReviewListQuery): Prisma.ReviewRequestWhereInput {
  const slots: Prisma.ApprovalSlotWhereInput[] = [{ requiredUserId: query.userId }];
  if (query.agentRoleId) slots.push({ requiredRoleId: query.agentRoleId });
  else if (query.activeRoleIds.length > 0)
    slots.push({ requiredRoleId: { in: [...query.activeRoleIds] } });
  return { approvalSlots: { some: { OR: slots } } };
}

export function reviewListWhere(query: V1ReviewListQuery): Prisma.ReviewRequestWhereInput {
  const conditions: Prisma.ReviewRequestWhereInput[] = [];

  if (query.status) conditions.push({ status: query.status });

  // 文档主体必须有当前 KB READ；工件主体本身已按任务范围授权。
  if (query.knowledgeReadAllowed) {
    conditions.push({
      OR: [
        { documentRevisionId: null },
        { documentRevision: { document: { knowledgeBase: knowledgeBaseReadableWhere(query) } } },
      ],
    });
  } else {
    conditions.push({ documentRevisionId: null });
  }

  // AGENT 无条件限制在本凭据角色或直接指派；HUMAN 仅在 assignedToMe 时限制到当前角色/本人。
  if (query.principalKind === 'AGENT' || query.assignedToMe)
    conditions.push(slotAssignmentWhere(query));

  if (query.cursor) {
    const cursor = decodeReviewCursor(query.cursor);
    conditions.push({
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    });
  }

  return { projectId: query.projectId, ...(conditions.length > 0 ? { AND: conditions } : {}) };
}
