/** 本地质量包只描述可复核的引用与覆盖关系；不把 Agent 结论升级为正式批准。 */
export type QualityStage = 'PLAN' | 'DELIVERY';
export type QualityIssue = {
  code: string;
  severity: 'ERROR' | 'WARNING';
  location: string;
  message: string;
};
export type QualityEvidence = {
  id: string;
  acceptanceKeys: string[];
  result: 'PASSED' | 'FAILED' | 'BLOCKED' | 'NOT_RUN';
  source: 'AGENT_REPORTED' | 'EXTERNAL_REFERENCE';
  ref: string;
  basis: { prdRevisionId: string; snapshotId: string; commitSha: string };
};
export type QualityBundle = {
  schemaVersion: '1.0';
  stage: QualityStage;
  requirementId: string;
  basis: { prdRevisionId: string; snapshotId: string; commitSha?: string };
  acceptance: Array<{ key: string; text: string; verification: 'TEST' | 'INSPECTION' | 'DEMO' }>;
  tasks: Array<{
    id: string;
    acceptanceKeys: string[];
    dependsOn: string[];
    files: string[];
    parallel?: boolean;
  }>;
  cases: Array<{
    id: string;
    covers: string[];
    kind: 'TEST' | 'INSPECTION' | 'DEMO';
  }>;
  evidence: QualityEvidence[];
};
export type QualityReport = {
  schemaVersion: '1.0';
  stage: QualityStage | null;
  requirementId: string | null;
  basis: QualityBundle['basis'] | null;
  status: 'CONSISTENT' | 'INCOMPLETE' | 'INVALID';
  authority: 'LOCAL_REPORTED';
  issues: QualityIssue[];
  coverage: Array<{
    acceptanceKey: string;
    taskIds: string[];
    caseIds: string[];
    evidenceIds: string[];
    status: 'PLANNED' | 'REPORTED_PASS' | 'FAILED' | 'BLOCKED' | 'NOT_RUN' | 'MISSING';
  }>;
};

export const ACCEPTANCE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SHA = /^[a-f0-9]{40}$/;
const VERIFICATIONS = new Set(['TEST', 'INSPECTION', 'DEMO']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const strings = (value: unknown, nonempty = false): value is string[] =>
  Array.isArray(value) && (!nonempty || value.length > 0) && value.every(text);
const sameBasis = (left: QualityEvidence['basis'], right: QualityBundle['basis']) =>
  left.prdRevisionId === right.prdRevisionId &&
  left.snapshotId === right.snapshotId &&
  left.commitSha === right.commitSha;
const overlaps = (left: string, right: string) =>
  left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const safeFile = (value: string) =>
  !value.includes('\\') &&
  !value.startsWith('/') &&
  !/^[a-zA-Z]:/.test(value) &&
  value.split('/').every((part) => !!part && part !== '.' && part !== '..');

/** 严格校验机器输入，避免空包或遗漏的章节被解释为全绿。 */
export function analyzeQualityBundle(input: unknown): QualityReport {
  const issues: QualityIssue[] = [];
  const add = (
    code: string,
    location: string,
    message: string,
    severity: 'ERROR' | 'WARNING' = 'ERROR',
  ) => issues.push({ code, severity, location, message });
  const report: QualityReport = {
    schemaVersion: '1.0',
    stage: null,
    requirementId: null,
    basis: null,
    status: 'INVALID',
    authority: 'LOCAL_REPORTED',
    issues,
    coverage: [],
  };
  if (!record(input)) {
    add('SCHEMA_INVALID', '$', '质量包必须是对象');
    return report;
  }
  if (input.schemaVersion !== '1.0') add('SCHEMA_INVALID', 'schemaVersion', '仅支持 1.0');
  if (input.stage !== 'PLAN' && input.stage !== 'DELIVERY')
    add('SCHEMA_INVALID', 'stage', '必须是 PLAN 或 DELIVERY');
  else report.stage = input.stage;
  if (!text(input.requirementId)) add('SCHEMA_INVALID', 'requirementId', '需求标识不能为空');
  else report.requirementId = input.requirementId;
  if (
    !record(input.basis) ||
    !text(input.basis.prdRevisionId) ||
    !text(input.basis.snapshotId) ||
    (input.basis.commitSha !== undefined &&
      (typeof input.basis.commitSha !== 'string' || !SHA.test(input.basis.commitSha))) ||
    (input.stage === 'DELIVERY' && !text(input.basis.commitSha))
  )
    add('SCHEMA_INVALID', 'basis', '必须指定 PRD 修订、快照；DELIVERY 还需完整小写 commit SHA');
  const arrays = ['acceptance', 'tasks', 'cases', 'evidence'] as const;
  for (const key of arrays) {
    if (!Array.isArray(input[key])) add('SCHEMA_INVALID', key, '必须显式提供数组');
    else if (input[key].length > 2000) add('SCHEMA_INVALID', key, '条目不能超过 2000');
  }
  if (issues.length) return report;
  for (const [i, item] of (input.acceptance as unknown[]).entries())
    if (
      !record(item) ||
      !text(item.key) ||
      !ACCEPTANCE_KEY_PATTERN.test(item.key) ||
      !text(item.text) ||
      item.text.length > 2000 ||
      !VERIFICATIONS.has(item.verification as string)
    )
      add('SCHEMA_INVALID', `acceptance[${i}]`, '验收必须有合法小写 key、正文和 verification');
  if (!(input.acceptance as unknown[]).length || (input.acceptance as unknown[]).length > 200)
    add('SCHEMA_INVALID', 'acceptance', '必须有 1–200 条验收');
  for (const [i, item] of (input.tasks as unknown[]).entries())
    if (
      !record(item) ||
      !text(item.id) ||
      !strings(item.acceptanceKeys, true) ||
      !strings(item.dependsOn) ||
      !strings(item.files, true) ||
      !item.files.every(safeFile) ||
      (item.parallel !== undefined && typeof item.parallel !== 'boolean')
    )
      add('SCHEMA_INVALID', `tasks[${i}]`, '任务需 id、验收 key、依赖和安全的仓库相对文件路径');
  for (const [i, item] of (input.cases as unknown[]).entries())
    if (
      !record(item) ||
      !text(item.id) ||
      !strings(item.covers, true) ||
      !VERIFICATIONS.has(item.kind as string)
    )
      add('SCHEMA_INVALID', `cases[${i}]`, '用例需 id、covers 和 kind');
  for (const [i, item] of (input.evidence as unknown[]).entries())
    if (
      !record(item) ||
      !text(item.id) ||
      !strings(item.acceptanceKeys, true) ||
      !text(item.ref) ||
      !['PASSED', 'FAILED', 'BLOCKED', 'NOT_RUN'].includes(item.result as string) ||
      !['AGENT_REPORTED', 'EXTERNAL_REFERENCE'].includes(item.source as string) ||
      !record(item.basis) ||
      !text(item.basis.prdRevisionId) ||
      !text(item.basis.snapshotId) ||
      typeof item.basis.commitSha !== 'string' ||
      !SHA.test(item.basis.commitSha)
    )
      add('SCHEMA_INVALID', `evidence[${i}]`, '证据需结果、来源、引用和完整版本绑定');
  if (issues.length) return report;
  const bundle = input as unknown as QualityBundle;
  report.basis = bundle.basis;
  for (const [key, entries] of [
    ['acceptance', bundle.acceptance.map((item) => item.key)],
    ['tasks', bundle.tasks.map((item) => item.id)],
    ['cases', bundle.cases.map((item) => item.id)],
    ['evidence', bundle.evidence.map((item) => item.id)],
  ] as const) {
    const seen = new Set<string>();
    entries.forEach((id, i) => {
      if (seen.has(id)) add('DUPLICATE_ID', `${key}[${i}]`, `重复标识：${id}`);
      seen.add(id);
    });
  }
  const acceptance = new Map(bundle.acceptance.map((item) => [item.key, item]));
  for (const [section, entries] of [
    ['tasks', bundle.tasks.map((item) => item.acceptanceKeys)],
    ['cases', bundle.cases.map((item) => item.covers)],
    ['evidence', bundle.evidence.map((item) => item.acceptanceKeys)],
  ] as const)
    entries.forEach((keys, i) => {
      for (const key of keys)
        if (!acceptance.has(key))
          add('UNKNOWN_ACCEPTANCE', `${section}[${i}]`, `未知验收 key：${key}`);
    });
  const tasks = new Map(bundle.tasks.map((item) => [item.id, item]));
  for (const [i, task] of bundle.tasks.entries())
    for (const dependency of task.dependsOn)
      if (!tasks.has(dependency))
        add('UNKNOWN_DEPENDENCY', `tasks[${i}].dependsOn`, `未知任务：${dependency}`);
  const degrees = new Map<string, number>();
  const downstream = new Map<string, string[]>();
  for (const task of tasks.values()) {
    const deps = task.dependsOn.filter((id) => tasks.has(id));
    degrees.set(task.id, deps.length);
    for (const dep of deps) downstream.set(dep, [...(downstream.get(dep) ?? []), task.id]);
  }
  const queue = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++)
    for (const id of downstream.get(queue[i]) ?? []) {
      const degree = degrees.get(id)! - 1;
      degrees.set(id, degree);
      if (degree === 0) queue.push(id);
    }
  if (queue.length !== tasks.size)
    add('DEPENDENCY_CYCLE', 'tasks', '任务依赖存在环，必须先解除环再安排工作');
  // 按需缓存依赖祖先；长链不递归，也不为每一对并行任务重复遍历。
  const ancestors = new Map<string, Set<string>>();
  const dependsOn = (id: string, target: string): boolean => {
    let seen = ancestors.get(id);
    if (!seen) {
      seen = new Set<string>();
      const pending = [...(tasks.get(id)?.dependsOn ?? [])];
      while (pending.length) {
        const dep = pending.pop()!;
        if (seen.has(dep)) continue;
        seen.add(dep);
        pending.push(...(tasks.get(dep)?.dependsOn ?? []));
      }
      ancestors.set(id, seen);
    }
    return seen.has(target);
  };
  for (let i = 0; i < bundle.tasks.length; i++)
    for (let j = i + 1; j < bundle.tasks.length; j++) {
      const a = bundle.tasks[i],
        b = bundle.tasks[j];
      if (
        a.parallel &&
        b.parallel &&
        a.files.some((left) => b.files.some((right) => overlaps(left, right))) &&
        !dependsOn(a.id, b.id) &&
        !dependsOn(b.id, a.id)
      )
        add(
          'PARALLEL_FILE_CONFLICT',
          `tasks[${j}].files`,
          `${a.id} 与 ${b.id} 并行修改相同文件或目录`,
        );
    }
  bundle.cases.forEach((item, i) => {
    for (const key of item.covers)
      if (acceptance.has(key) && acceptance.get(key)!.verification !== item.kind)
        add('VERIFICATION_MISMATCH', `cases[${i}].kind`, `${key} 的验证方式与用例不一致`);
  });
  bundle.evidence.forEach((item, i) => {
    if (!sameBasis(item.basis, bundle.basis))
      add('EVIDENCE_STALE', `evidence[${i}].basis`, '证据与本次 PRD、快照或代码提交不一致');
  });
  for (const item of bundle.acceptance) {
    const taskIds = bundle.tasks
      .filter((task) => task.acceptanceKeys.includes(item.key))
      .map((task) => task.id);
    const caseIds = bundle.cases
      .filter((c) => c.covers.includes(item.key) && c.kind === item.verification)
      .map((c) => c.id);
    const evidence = bundle.evidence.filter(
      (e) => e.acceptanceKeys.includes(item.key) && sameBasis(e.basis, bundle.basis),
    );
    if (!taskIds.length) add('TASK_COVERAGE_MISSING', `acceptance.${item.key}`, '验收没有对应任务');
    if (!caseIds.length)
      add('CASE_COVERAGE_MISSING', `acceptance.${item.key}`, '验收没有匹配验证方式的用例');
    let status: QualityReport['coverage'][number]['status'] = 'PLANNED';
    if (bundle.stage === 'DELIVERY') {
      status = evidence.some((e) => e.result === 'FAILED')
        ? 'FAILED'
        : evidence.some((e) => e.result === 'BLOCKED')
          ? 'BLOCKED'
          : evidence.some((e) => e.result === 'NOT_RUN')
            ? 'NOT_RUN'
            : evidence.length
              ? 'REPORTED_PASS'
              : 'MISSING';
      if (status !== 'REPORTED_PASS')
        add('DELIVERY_EVIDENCE_INCOMPLETE', `acceptance.${item.key}`, `交付证据状态：${status}`);
      else
        add(
          'EVIDENCE_REQUIRES_REVIEW',
          `acceptance.${item.key}`,
          '证据为提交者报告；尚未核验引用内容或作出正式验收',
          'WARNING',
        );
    }
    report.coverage.push({
      acceptanceKey: item.key,
      taskIds,
      caseIds,
      evidenceIds: evidence.map((e) => e.id),
      status,
    });
  }
  report.status = issues.some((issue) => issue.severity === 'ERROR') ? 'INCOMPLETE' : 'CONSISTENT';
  return report;
}
