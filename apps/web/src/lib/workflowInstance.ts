import type { WorkflowSlotDefinition, WorkflowStepDefinition } from '../api/resources';

export const IMPL_OUTPUT_KIND = 'IMPL';

function isWorkflowStep(value: unknown): value is WorkflowStepDefinition {
  if (!value || typeof value !== 'object') return false;
  const step = value as Record<string, unknown>;
  return typeof step.key === 'string' && typeof step.roleKey === 'string';
}

function isWorkflowSlot(value: unknown): value is WorkflowSlotDefinition {
  if (!value || typeof value !== 'object') return false;
  const slot = value as Record<string, unknown>;
  return typeof slot.key === 'string' && typeof slot.roleKey === 'string';
}

/** 从已发布修订的 `definition` 里读出步骤定义（与 WorkflowInstanceDialog 同一口径）。 */
export function readWorkflowSteps(definition: unknown): WorkflowStepDefinition[] {
  if (!definition || typeof definition !== 'object') return [];
  const steps = (definition as Record<string, unknown>).steps;
  return Array.isArray(steps) ? steps.filter(isWorkflowStep) : [];
}

/** 从已发布修订的 `definition` 里读出审批槽定义。 */
export function readWorkflowSlots(definition: unknown): WorkflowSlotDefinition[] {
  if (!definition || typeof definition !== 'object') return [];
  const slots = (definition as Record<string, unknown>).roleSlots;
  return Array.isArray(slots) ? slots.filter(isWorkflowSlot) : [];
}

/**
 * 步骤 → 直接前置步骤 key 列表。只保留定义里真实存在的步骤，避免脏数据造成
 * 「永远等待一个不存在的步骤」。没有依赖信息的步骤返回空数组（= 起点）。
 */
export function stepDependencyMap(definition: unknown): Record<string, string[]> {
  const steps = readWorkflowSteps(definition);
  const keys = new Set(steps.map((step) => step.key));
  const map: Record<string, string[]> = {};
  for (const step of steps) {
    map[step.key] = (step.deps ?? []).filter((key) => keys.has(key));
  }
  return map;
}

/** IMPL 步骤必须声明代码仓库范围：交付的 GIT_REF 工件要能落回仓库。 */
export function isImplStep(step: WorkflowStepDefinition): boolean {
  return (step.outputKinds ?? []).includes(IMPL_OUTPUT_KIND);
}

/**
 * 验收条目默认归到验证步骤（测试的 cases 任务），没有验证步骤时归到最后一步。
 * 服务端要求每条 PRD 验收至少被一个任务覆盖，默认值本身就要满足这条规则。
 */
export function defaultAcceptanceOwners(
  keys: string[],
  steps: WorkflowStepDefinition[],
): Record<string, string> {
  if (keys.length === 0 || steps.length === 0) return {};
  const owner =
    steps.find((step) => step.kind === 'VERIFY' || (step.outputKinds ?? []).includes('CASES')) ??
    steps[steps.length - 1];
  return Object.fromEntries(keys.map((key) => [key, owner.key]));
}

export interface StepBindingInput {
  steps: WorkflowStepDefinition[];
  slots: WorkflowSlotDefinition[];
  roles: Array<{ key: string; id: string }>;
  stepUsers: Record<string, string>;
  slotUsers: Record<string, string>;
  repositories: Record<string, string[]>;
  acceptanceKeys: string[];
  acceptanceOwners: Record<string, string>;
}

export interface StepBindingPayload {
  stepKey: string;
  roleId: string;
  responsibleUserId: string;
  repositoryIds: string[];
  acceptanceKeys: string[];
}

export interface SlotBindingPayload {
  slotKey: string;
  roleId: string;
  userId: string;
}

/**
 * 建实例前先在本地把绑定拼完整：每个步骤的责任人、每个 IMPL 步骤的仓库、
 * 每条验收的归属都必须是显式选择，缺一项就报错，不把半成品发给服务端。
 */
export function buildInstanceBindings(input: StepBindingInput): {
  stepBindings: StepBindingPayload[];
  roleSlotBindings: SlotBindingPayload[];
} {
  const roleIdByKey = new Map(input.roles.map((role) => [role.key, role.id]));
  const stepKeys = new Set(input.steps.map((step) => step.key));

  for (const key of input.acceptanceKeys) {
    const owner = input.acceptanceOwners[key];
    if (!owner) throw new Error(`验收条目 ${key} 还没有归属步骤`);
    if (!stepKeys.has(owner)) throw new Error(`验收条目 ${key} 的归属步骤 ${owner} 不存在`);
  }

  const stepBindings = input.steps.map((step) => {
    const roleId = roleIdByKey.get(step.roleKey);
    if (!roleId) throw new Error(`步骤 ${step.key} 的角色 ${step.roleKey} 未登记`);
    const responsibleUserId = input.stepUsers[step.key];
    if (!responsibleUserId) throw new Error(`步骤 ${step.key} 未选择责任人`);
    const repositoryIds = isImplStep(step) ? (input.repositories[step.key] ?? []) : [];
    if (isImplStep(step) && repositoryIds.length === 0)
      throw new Error(`步骤 ${step.key} 要交付代码，至少选择一个代码仓库`);
    const acceptanceKeys = input.acceptanceKeys.filter(
      (key) => (input.acceptanceOwners[key] ?? '') === step.key,
    );
    return { stepKey: step.key, roleId, responsibleUserId, repositoryIds, acceptanceKeys };
  });

  const roleSlotBindings = input.slots.map((slot) => {
    const roleId = roleIdByKey.get(slot.roleKey);
    if (!roleId) throw new Error(`审批槽 ${slot.key} 的角色 ${slot.roleKey} 未登记`);
    const userId = input.slotUsers[slot.key];
    if (!userId) throw new Error(`审批槽 ${slot.key} 未选择审批人`);
    return { slotKey: slot.key, roleId, userId };
  });

  return { stepBindings, roleSlotBindings };
}
