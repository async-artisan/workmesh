/** 本地质量包只描述可复核的引用与覆盖关系；不把 Agent 结论升级为正式批准。 */
export type QualityStage = 'PLAN' | 'DELIVERY';
export type QualityIssue = {
  code: string;
  severity: 'ERROR' | 'WARNING';
  location: string;
  message: string;
};
export type QualityBasisV10 = { prdRevisionId: string; snapshotId: string; commitSha?: string };
export type QualityBasisV11 = QualityBasisV10 & { projectRepositoryId: string };
export type QualityCaseRevision = { artifactId: string; sha256: string };
export type QualityCaseRef = { caseId: string; revision: QualityCaseRevision };
export type QualityResult = 'PASSED' | 'FAILED' | 'BLOCKED' | 'NOT_RUN';
export type QualityCoverageStatus =
  'PLANNED' | 'REPORTED_PASS' | 'FAILED' | 'BLOCKED' | 'NOT_RUN' | 'MISSING';
export type QualityEvidenceV10 = {
  id: string;
  acceptanceKeys: string[];
  result: QualityResult;
  source: 'AGENT_REPORTED' | 'EXTERNAL_REFERENCE';
  ref: string;
  basis: QualityBasisV10 & { commitSha: string };
};
export type QualityEvidenceV11 = Omit<QualityEvidenceV10, 'basis'> & {
  basis: QualityBasisV11 & { commitSha: string };
  caseRefs: QualityCaseRef[];
};
export type QualityEvidence = QualityEvidenceV10 | QualityEvidenceV11;
export type QualityCaseV10 = {
  id: string;
  covers: string[];
  kind: 'TEST' | 'INSPECTION' | 'DEMO';
};
export type QualityCaseV11 = QualityCaseV10 & { revision: QualityCaseRevision };
type QualityBundleCommon = {
  stage: QualityStage;
  requirementId: string;
  acceptance: Array<{ key: string; text: string; verification: 'TEST' | 'INSPECTION' | 'DEMO' }>;
  tasks: Array<{
    id: string;
    acceptanceKeys: string[];
    dependsOn: string[];
    files: string[];
    parallel?: boolean;
  }>;
};
export type QualityBundleV10 = QualityBundleCommon & {
  schemaVersion: '1.0';
  basis: QualityBasisV10;
  cases: QualityCaseV10[];
  evidence: QualityEvidenceV10[];
};
export type QualityBundleV11 = QualityBundleCommon & {
  schemaVersion: '1.1';
  basis: QualityBasisV11;
  cases: QualityCaseV11[];
  evidence: QualityEvidenceV11[];
};
export type QualityBundle = QualityBundleV10 | QualityBundleV11;
export type QualityReport = {
  /** 分析报告自身的结构版本，与被分析质量包的版本分开。 */
  schemaVersion: '1.0';
  bundleSchemaVersion: QualityBundle['schemaVersion'] | null;
  executionLinkage: 'LEGACY_UNLINKED' | 'EXPLICIT_CASE_REVISION' | null;
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
    status: QualityCoverageStatus;
  }>;
  caseCoverage: Array<{
    caseId: string;
    revision: QualityCaseRevision | null;
    evidenceIds: string[];
    status: QualityCoverageStatus;
  }>;
};

export const ACCEPTANCE_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const VERIFICATIONS = new Set(['TEST', 'INSPECTION', 'DEMO']);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const strings = (value: unknown, nonempty = false): value is string[] =>
  Array.isArray(value) && (!nonempty || value.length > 0) && value.every(text);
export const sameQualityBasis = (left: QualityBundle['basis'], right: QualityBundle['basis']) =>
  left.prdRevisionId === right.prdRevisionId &&
  left.snapshotId === right.snapshotId &&
  left.commitSha === right.commitSha &&
  ('projectRepositoryId' in left ? left.projectRepositoryId : undefined) ===
    ('projectRepositoryId' in right ? right.projectRepositoryId : undefined);
const sameRevision = (left: QualityCaseRevision, right: QualityCaseRevision) =>
  left.artifactId === right.artifactId && left.sha256 === right.sha256;
const exactKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const revision = (value: unknown): value is QualityCaseRevision =>
  record(value) &&
  text(value.artifactId) &&
  typeof value.sha256 === 'string' &&
  DIGEST.test(value.sha256) &&
  exactKeys(value, ['artifactId', 'sha256']);
const uniqueStrings = (value: string[]) => new Set(value).size === value.length;

/** 保留所有报告异常；任何一条通过都不能掩盖失败、阻塞或未执行。 */
export function aggregateQualityResults(
  results: QualityResult[],
  missing = false,
): QualityCoverageStatus {
  if (results.includes('FAILED')) return 'FAILED';
  if (results.includes('BLOCKED')) return 'BLOCKED';
  if (results.includes('NOT_RUN')) return 'NOT_RUN';
  return !missing && results.length ? 'REPORTED_PASS' : 'MISSING';
}

/** 仅核对输入内的精确用例关系；不查询 CASES 工件或认可报告来源。 */
export function getQualityEvidenceLinkIssues(
  bundle: QualityBundle,
  evidence: QualityEvidence,
  location = 'evidence',
): QualityIssue[] {
  if (bundle.schemaVersion === '1.0') return [];
  const issues: QualityIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({
      code,
      severity: 'ERROR' as const,
      location: `${location}.caseRefs`,
      message,
    });
  if (!('caseRefs' in evidence) || !evidence.caseRefs.length) {
    add('CASE_EXECUTION_MISSING', '1.1 证据必须直接关联非空的用例修订');
    return issues;
  }
  const cases = new Map(bundle.cases.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const keys = new Set<string>();
  for (const ref of evidence.caseRefs) {
    if (seen.has(ref.caseId)) add('DUPLICATE_CASE_REF', `重复用例引用：${ref.caseId}`);
    seen.add(ref.caseId);
    const item = cases.get(ref.caseId);
    if (!item) {
      add('UNKNOWN_CASE', `未知用例：${ref.caseId}`);
      continue;
    }
    if (!sameRevision(ref.revision, item.revision))
      add('CASE_REVISION_MISMATCH', `${ref.caseId} 的工件修订或摘要与本次用例不一致`);
    for (const key of item.covers) keys.add(key);
  }
  if (
    keys.size !== evidence.acceptanceKeys.length ||
    evidence.acceptanceKeys.some((key) => !keys.has(key))
  )
    add('CASE_ACCEPTANCE_MISMATCH', '证据的验收 key 必须等于所引用用例 covers 的并集');
  return issues;
}
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
    bundleSchemaVersion: null,
    executionLinkage: null,
    stage: null,
    requirementId: null,
    basis: null,
    status: 'INVALID',
    authority: 'LOCAL_REPORTED',
    issues,
    coverage: [],
    caseCoverage: [],
  };
  if (!record(input)) {
    add('SCHEMA_INVALID', '$', '质量包必须是对象');
    return report;
  }
  if (input.schemaVersion !== '1.0' && input.schemaVersion !== '1.1')
    add('SCHEMA_INVALID', 'schemaVersion', '仅支持 1.0 或 1.1');
  else {
    report.bundleSchemaVersion = input.schemaVersion;
    report.executionLinkage =
      input.schemaVersion === '1.1' ? 'EXPLICIT_CASE_REVISION' : 'LEGACY_UNLINKED';
  }
  const linkedVersion = input.schemaVersion === '1.1';
  if (
    linkedVersion &&
    !exactKeys(input, [
      'schemaVersion',
      'stage',
      'requirementId',
      'basis',
      'acceptance',
      'tasks',
      'cases',
      'evidence',
    ])
  )
    add('SCHEMA_INVALID', '$', '1.1 质量包含未知字段；不能自行声明 verified 或平台权威');
  if (input.stage !== 'PLAN' && input.stage !== 'DELIVERY')
    add('SCHEMA_INVALID', 'stage', '必须是 PLAN 或 DELIVERY');
  else report.stage = input.stage;
  if (!text(input.requirementId)) add('SCHEMA_INVALID', 'requirementId', '需求标识不能为空');
  else report.requirementId = input.requirementId;
  if (
    !record(input.basis) ||
    !text(input.basis.prdRevisionId) ||
    !text(input.basis.snapshotId) ||
    (linkedVersion &&
      (!text(input.basis.projectRepositoryId) ||
        !exactKeys(input.basis, [
          'prdRevisionId',
          'snapshotId',
          'projectRepositoryId',
          'commitSha',
        ]))) ||
    (input.basis.commitSha !== undefined &&
      (typeof input.basis.commitSha !== 'string' || !SHA.test(input.basis.commitSha))) ||
    (input.stage === 'DELIVERY' && !text(input.basis.commitSha))
  )
    add(
      'SCHEMA_INVALID',
      'basis',
      '必须指定 PRD 修订、快照；1.1 还需登记仓库 ID；DELIVERY 还需完整小写 commit SHA',
    );
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
      (linkedVersion && !exactKeys(item, ['key', 'text', 'verification'])) ||
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
      (linkedVersion &&
        (!exactKeys(item, ['id', 'acceptanceKeys', 'dependsOn', 'files', 'parallel']) ||
          !uniqueStrings(item.acceptanceKeys) ||
          !uniqueStrings(item.dependsOn) ||
          !uniqueStrings(item.files))) ||
      (item.parallel !== undefined && typeof item.parallel !== 'boolean')
    )
      add('SCHEMA_INVALID', `tasks[${i}]`, '任务需 id、验收 key、依赖和安全的仓库相对文件路径');
  for (const [i, item] of (input.cases as unknown[]).entries())
    if (
      !record(item) ||
      !text(item.id) ||
      !strings(item.covers, true) ||
      (linkedVersion &&
        (!revision(item.revision) ||
          !uniqueStrings(item.covers) ||
          !exactKeys(item, ['id', 'covers', 'kind', 'revision']))) ||
      !VERIFICATIONS.has(item.kind as string)
    )
      add(
        'SCHEMA_INVALID',
        `cases[${i}]`,
        '用例需 id、covers 和 kind；1.1 还需精确 CASES 工件标识和 SHA-256 修订',
      );
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
      (linkedVersion &&
        (!text(item.basis.projectRepositoryId) ||
          !exactKeys(item.basis, [
            'prdRevisionId',
            'snapshotId',
            'projectRepositoryId',
            'commitSha',
          ]) ||
          !exactKeys(item, [
            'id',
            'acceptanceKeys',
            'caseRefs',
            'result',
            'source',
            'ref',
            'basis',
          ]) ||
          !uniqueStrings(item.acceptanceKeys) ||
          !Array.isArray(item.caseRefs) ||
          !item.caseRefs.length ||
          item.caseRefs.length > 2000 ||
          !item.caseRefs.every(
            (ref) =>
              record(ref) &&
              text(ref.caseId) &&
              revision(ref.revision) &&
              exactKeys(ref, ['caseId', 'revision']),
          ))) ||
      typeof item.basis.commitSha !== 'string' ||
      !SHA.test(item.basis.commitSha)
    )
      add(
        'SCHEMA_INVALID',
        `evidence[${i}]`,
        '证据需结果、来源、引用和完整版本绑定；1.1 还需非空精确用例引用',
      );
  if (issues.length) return report;
  const bundle = input as unknown as QualityBundle;
  report.basis = bundle.basis;
  if (bundle.schemaVersion === '1.0')
    add(
      'LEGACY_CASE_LINKAGE_MISSING',
      'schemaVersion',
      '1.0 未建立执行到用例修订的精确关联；不会补造修订或核验来源',
      'WARNING',
    );
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
    if (!sameQualityBasis(item.basis, bundle.basis))
      add('EVIDENCE_STALE', `evidence[${i}].basis`, '证据与本次 PRD、快照、仓库或代码提交不一致');
  });
  const invalidEvidence = new Set<QualityEvidence>();
  if (bundle.schemaVersion === '1.1') {
    const artifactDigests = new Map<string, string>();
    const conflictedArtifacts = new Set<string>();
    const invalidCaseIds = new Set<string>();
    const seenCases = new Set<string>();
    for (const [i, item] of bundle.cases.entries()) {
      if (
        seenCases.has(item.id) ||
        item.covers.some(
          (key) => !acceptance.has(key) || acceptance.get(key)!.verification !== item.kind,
        )
      )
        invalidCaseIds.add(item.id);
      seenCases.add(item.id);
      const previous = artifactDigests.get(item.revision.artifactId);
      if (previous && previous !== item.revision.sha256) {
        add(
          'CASE_ARTIFACT_CONFLICT',
          `cases[${i}].revision`,
          '相同 CASES 工件标识不能对应不同摘要',
        );
        conflictedArtifacts.add(item.revision.artifactId);
      }
      artifactDigests.set(item.revision.artifactId, item.revision.sha256);
    }
    for (const item of bundle.cases)
      if (conflictedArtifacts.has(item.revision.artifactId)) invalidCaseIds.add(item.id);
    for (const [i, item] of bundle.evidence.entries()) {
      const linkIssues = getQualityEvidenceLinkIssues(bundle, item, `evidence[${i}]`);
      issues.push(...linkIssues);
      if (linkIssues.length) invalidEvidence.add(item);
      if (item.caseRefs.some((ref) => invalidCaseIds.has(ref.caseId))) {
        invalidEvidence.add(item);
        add(
          'CASE_REFERENCE_INVALID',
          `evidence[${i}].caseRefs`,
          '所引用用例存在标识、摘要或验收方式冲突，不能作为执行覆盖',
        );
      }
    }
    for (const item of bundle.cases) {
      const evidence = bundle.evidence.filter(
        (entry) =>
          sameQualityBasis(entry.basis, bundle.basis) &&
          !invalidEvidence.has(entry) &&
          entry.caseRefs.some(
            (ref) => ref.caseId === item.id && sameRevision(ref.revision, item.revision),
          ),
      );
      const status =
        bundle.stage === 'PLAN'
          ? 'PLANNED'
          : aggregateQualityResults(evidence.map((entry) => entry.result));
      report.caseCoverage.push({
        caseId: item.id,
        revision: item.revision,
        evidenceIds: evidence.map((entry) => entry.id),
        status,
      });
      if (bundle.stage === 'DELIVERY' && status !== 'REPORTED_PASS')
        add(
          'CASE_EXECUTION_INCOMPLETE',
          `cases[${bundle.cases.indexOf(item)}]`,
          `${item.id} 的执行状态：${status}`,
        );
    }
  }
  for (const item of bundle.acceptance) {
    const taskIds = bundle.tasks
      .filter((task) => task.acceptanceKeys.includes(item.key))
      .map((task) => task.id);
    const caseIds = bundle.cases
      .filter((c) => c.covers.includes(item.key) && c.kind === item.verification)
      .map((c) => c.id);
    const evidence = bundle.evidence.filter(
      (e) => e.acceptanceKeys.includes(item.key) && sameQualityBasis(e.basis, bundle.basis),
    );
    if (!taskIds.length) add('TASK_COVERAGE_MISSING', `acceptance.${item.key}`, '验收没有对应任务');
    if (!caseIds.length)
      add('CASE_COVERAGE_MISSING', `acceptance.${item.key}`, '验收没有匹配验证方式的用例');
    let status: QualityCoverageStatus = 'PLANNED';
    if (bundle.stage === 'DELIVERY') {
      const missingCase =
        bundle.schemaVersion === '1.1' &&
        (!caseIds.length ||
          caseIds.some(
            (id) =>
              report.caseCoverage.find((entry) => entry.caseId === id)?.status !== 'REPORTED_PASS',
          ));
      // 异常声明继续可见；只有有效的精确引用才能补齐执行覆盖。
      status = aggregateQualityResults(
        evidence.map((e) => e.result),
        missingCase || evidence.some((entry) => invalidEvidence.has(entry)),
      );
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
