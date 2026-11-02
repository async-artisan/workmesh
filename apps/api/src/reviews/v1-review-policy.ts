/**
 * 反求已发布流程定义中某个步骤的全部下游步骤（传递闭包）。
 * 定义来自不可变的 WorkflowRevision，但仍按不可信输入处理：非数组或非字符串依赖一律忽略，
 * visited 截断环，排序保证同一输入得到确定性结果。
 */
export function collectDownstreamStepKeys(definition: unknown, rootStepKey: string): string[] {  if (!definition || typeof definition !== 'object') return [];
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

/**
 * 代码评审证据的判定规则。
 *
 * 背景：验收曾经无条件要求「IMPL 交付必须有已批准的 PR 评审证据」，
 * 但纯 HOSTED 的实现说明没有提交可评审，这条要求永远无法满足，
 * 这类交付会卡死在验收。规则改为按交付内容判断，而不是按步骤类型判断。
 */
export type ArtifactCodeClaim = { storage: string; commitSha?: string | null };
export type CodeEvidenceItem = { state: string; reviewerKind: string };

/** 单个工件是否声称“包含真实代码”：代码引用存储，或带提交 SHA。 */
export function artifactClaimsCode(artifact: ArtifactCodeClaim): boolean {
  return artifact.storage === 'GIT_REF' || Boolean(artifact.commitSha);
}

/** 只有交付集里存在代码引用时，才要求 PR 评审证据。 */
export function needsCodeEvidence(artifacts: readonly ArtifactCodeClaim[]): boolean {
  return artifacts.some(artifactClaimsCode);
}

/** 证据必须全部 APPROVED 且非 Bot：空集、待定、被驳回、机器人评审一律不通过。 */
export function isCodeEvidenceAcceptable(evidence: readonly CodeEvidenceItem[]): boolean {
  if (evidence.length === 0) return false;
  return evidence.every((item) => item.state === 'APPROVED' && item.reviewerKind !== 'BOT');
}
