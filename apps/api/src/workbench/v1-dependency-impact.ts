import type { DependencyImpact } from '@workmesh/shared';

export interface DependencyTask {
  id: string;
  stepKey: string;
  executionStatus: string;
  workStatus: string;
  currentClaimId: string | null;
}

export function dependencyCounts(
  definition: unknown,
  tasks: readonly DependencyTask[],
  rootIds: readonly string[],
  simulateCompletion: boolean,
  includeRoots = false,
): { blocking: number; readyAfterAction: number } | null {
  const rawSteps = (definition as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(rawSteps)) return null;
  const deps = new Map<string, string[]>();
  for (const raw of rawSteps) {
    if (!raw || typeof raw !== 'object') return null;
    const step = raw as { key?: unknown; deps?: unknown };
    if (
      typeof step.key !== 'string' ||
      deps.has(step.key) ||
      !Array.isArray(step.deps) ||
      step.deps.some((dep) => typeof dep !== 'string')
    )
      return null;
    deps.set(step.key, [...new Set(step.deps as string[])]);
  }
  const byStep = new Map(tasks.map((task) => [task.stepKey, task]));
  if (byStep.size !== tasks.length || tasks.some((task) => !deps.has(task.stepKey))) return null;
  const children = new Map<string, string[]>();
  for (const [key, parents] of deps) {
    if (!byStep.has(key) || parents.some((parent) => !deps.has(parent))) return null;
    for (const parent of parents) children.set(parent, [...(children.get(parent) ?? []), key]);
  }
  // Reject cycles instead of publishing plausible counts for a corrupt graph.
  const remaining = new Map([...deps].map(([key, parents]) => [key, parents.length]));
  const queue = [...remaining].filter(([, count]) => count === 0).map(([key]) => key);
  let visited = 0;
  for (let index = 0; index < queue.length; index++) {
    visited++;
    for (const child of children.get(queue[index]) ?? []) {
      const count = remaining.get(child)! - 1;
      remaining.set(child, count);
      if (count === 0) queue.push(child);
    }
  }
  if (visited !== deps.size) return null;
  const rootSet = new Set(rootIds);
  const roots = tasks.filter((task) => rootSet.has(task.id));
  if (roots.length !== rootSet.size) return null;
  const completedSteps = new Set(roots.map((task) => task.stepKey));
  const reachable = new Set<string>(includeRoots ? completedSteps : []);
  const pending = roots.flatMap((task) => children.get(task.stepKey) ?? []);
  for (let index = 0; index < pending.length; index++) {
    const key = pending[index];
    if (reachable.has(key)) continue;
    reachable.add(key);
    pending.push(...(children.get(key) ?? []));
  }
  const unfinished = [...reachable]
    .map((key) => byStep.get(key)!)
    .filter((task) => task.executionStatus !== 'DONE' && task.workStatus !== 'CANCELLED');
  const readyAfterAction = simulateCompletion
    ? unfinished.filter((task) => {
        if (
          rootSet.has(task.id) ||
          task.executionStatus !== 'OPEN' ||
          task.workStatus !== 'ACTIVE' ||
          task.currentClaimId
        )
          return false;
        const parents = deps.get(task.stepKey)!;
        const readyNow = parents.every((parent) => byStep.get(parent)?.executionStatus === 'DONE');
        return (
          !readyNow &&
          parents.every(
            (parent) =>
              byStep.get(parent)?.executionStatus === 'DONE' || completedSteps.has(parent),
          )
        );
      }).length
    : 0;
  return { blocking: unfinished.length, readyAfterAction };
}

export function unavailableImpact(checkedAt: string): DependencyImpact {
  return {
    status: 'UNAVAILABLE',
    checkedAt,
    blocking: null,
    readyAfterAction: null,
    scenario: 'UNSUPPORTED',
    reason: 'GRAPH_UNAVAILABLE',
  };
}
