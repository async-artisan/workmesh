/**
 * 从已发布的工作流定义里读取步骤语义。
 *
 * 为什么单独成模块：快照层需要「这一步的基线策略」和「这一步依赖哪些步骤」，
 * 而这两件事只存在于 `WorkflowRevision.definition`（定义正文）里，
 * `compiledRules` 只保存服务端派生的规则（角色解析、包锁、系统闸门），不含 steps。
 * 早先的实现在 `compiledRules` 里找 `definition.steps`，因此恒为空，
 * 导致 PRD 基线永不注入、下游也拿不到上游已验收工件。
 *
 * 这里只接受「定义」本身，从类型上消除再传错对象的机会。
 */

export type V1SnapshotStepShape = {
  key: string;
  deps: string[];
  baselinePolicy: 'NONE' | 'PUBLISHED_PRD';
  outputKinds: string[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** 解析定义里的步骤；非法输入返回空数组，不抛错（快照读取失败由上层决定如何降级）。 */
export function snapshotStepsOf(definition: unknown): V1SnapshotStepShape[] {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return [];
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];

  const parsed: V1SnapshotStepShape[] = [];
  for (const entry of steps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const step = entry as {
      key?: unknown;
      deps?: unknown;
      baselinePolicy?: unknown;
      outputKinds?: unknown;
    };
    if (typeof step.key !== 'string' || !step.key) continue;
    parsed.push({
      key: step.key,
      deps: stringArray(step.deps),
      baselinePolicy: step.baselinePolicy === 'PUBLISHED_PRD' ? 'PUBLISHED_PRD' : 'NONE',
      outputKinds: stringArray(step.outputKinds),
    });
  }
  return parsed;
}

/** 该步骤声明的直接依赖；找不到步骤时返回空数组。 */
export function snapshotDependenciesOf(definition: unknown, stepKey: string): string[] {
  return snapshotStepsOf(definition).find((step) => step.key === stepKey)?.deps ?? [];
}

/** 该步骤的基线策略；唯一合法取值是 `NONE` / `PUBLISHED_PRD`，其余一律按 NONE 处理。 */
export function snapshotBaselinePolicyOf(
  definition: unknown,
  stepKey: string,
): 'NONE' | 'PUBLISHED_PRD' {
  return snapshotStepsOf(definition).find((step) => step.key === stepKey)?.baselinePolicy ?? 'NONE';
}
