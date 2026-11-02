/**
 * 反求已发布流程定义中某个步骤的全部下游步骤（传递闭包）。
 * 定义来自不可变的 WorkflowRevision，但仍按不可信输入处理：非数组或非字符串依赖一律忽略，
 * visited 截断环，排序保证同一输入得到确定性结果。
 */
export function collectDownstreamStepKeys(definition: unknown, rootStepKey: string): string[] {
  if (!definition || typeof definition !== 'object') return [];
  const steps = (definition as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];

  // dep -> 依赖它的步骤（反向边），沿反向边遍历即得到下游。
  const dependents = new Map<string, Set<string>>();
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const key = (step as { key?: unknown }).key;
    if (typeof key !== 'string') continue;
    const deps = (step as { deps?: unknown }).deps;
    if (!Array.isArray(deps)) continue;
    for (const dep of deps) {
      if (typeof dep !== 'string') continue;
      const set = dependents.get(dep) ?? new Set<string>();
      set.add(key);
      dependents.set(dep, set);
    }
  }

  const seen = new Set<string>([rootStepKey]);
  const queue = [rootStepKey];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of dependents.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  seen.delete(rootStepKey);
  return [...seen].sort();
}
