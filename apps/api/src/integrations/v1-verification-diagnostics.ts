import type {
  QualityCaseRevision,
  VerificationApplicability,
  VerificationCollection,
  VerificationDimension,
} from '@workmesh/shared';

/** All target values come from a server read snapshot, never the report body. */
export type VerificationDiagnosticsTarget = {
  artifactSetId: string;
  currentArtifactSetId: string | null;
  taskGeneration: number;
  currentTaskGeneration: number;
  requirementGeneration: number;
  currentRequirementGeneration: number;
  workflowDefinitionRevisionId: string | null;
  currentWorkflowDefinitionRevisionId: string | null;
  snapshotId: string;
  currentSnapshotId: string | null;
  prdRevisionId: string | null;
  projectRepositoryId: string;
  providerRepositoryId: string | null;
  commitSha: string | null;
  /** revision.sha256 must be computed from actual immutable CASES bytes. */
  cases: Array<{ caseId: string; revision: QualityCaseRevision }> | null;
  /** A digest alone cannot prove that those bytes contain this case ID. */
  casesContentVerified?: boolean;
  requiredCaseIds?: string[] | null;
};

export type VerificationDiagnosticsInput = {
  collection: VerificationCollection;
  target: VerificationDiagnosticsTarget;
  /** No published machine-readable validation policy exists in the current flow. */
  definition: { status: 'UNKNOWN'; reasons?: string[] };
};

type DimensionBuilder = {
  mismatch: string[];
  unknown: string[];
  matched: string[];
};
const builder = (): DimensionBuilder => ({ mismatch: [], unknown: [], matched: [] });
const unique = (reasons: string[]): string[] => [...new Set(reasons)];
const finish = (value: DimensionBuilder): VerificationDimension => ({
  status: value.mismatch.length ? 'MISMATCH' : value.unknown.length ? 'UNKNOWN' : 'MATCHED',
  reasons: unique([...value.mismatch, ...value.unknown, ...value.matched]),
});

function compare(
  dimension: DimensionBuilder,
  label: string,
  actual: string | number | null | undefined,
  expected: string | number | null | undefined,
): void {
  if (actual == null || expected == null || actual === '' || expected === '')
    dimension.unknown.push(`${label}无法完整取得。`);
  else if (actual !== expected) dimension.mismatch.push(`${label}不匹配。`);
}

/**
 * Pure advisory diagnostics. Provider-observed origin, claimed report linkage,
 * current target versions and test-definition provenance remain separate.
 */
export function evaluateVerificationApplicability({
  collection,
  target,
  definition,
}: VerificationDiagnosticsInput): VerificationApplicability {
  const origin = builder();
  const association = builder();
  const current = builder();
  if (collection.provider !== 'GITHUB_ACTIONS' || collection.origin !== 'PROVIDER_OBSERVED')
    origin.mismatch.push('未取得服务端采集的 GitHub Actions 来源。');
  compare(origin, '提供方仓库身份', collection.repositoryId, target.providerRepositoryId);
  if (!collection.identityStable) origin.unknown.push('采集前后提供方运行身份发生变化。');
  if (collection.completeness !== 'COMPLETE' || collection.issues.length)
    origin.unknown.push('提供方采集不完整，不能将部分记录视为完整事实。');
  if (!collection.runId || !Number.isSafeInteger(collection.attempt) || collection.attempt < 1)
    origin.unknown.push('提供方运行或 attempt 身份无法完整取得。');
  for (const job of collection.jobs) {
    compare(origin, '提供方 job 所属 run', job.runId, collection.runId);
    compare(origin, '提供方 job 所属 attempt', job.attempt, collection.attempt);
    compare(origin, '提供方 job head SHA', job.headSha, collection.headSha);
  }
  if (!origin.mismatch.length && !origin.unknown.length)
    origin.matched.push('服务端采集的提供方仓库与运行身份稳定。');

  compare(current, '当前工件集', target.artifactSetId, target.currentArtifactSetId);
  compare(current, '任务代次', target.taskGeneration, target.currentTaskGeneration);
  compare(current, '需求代次', target.requirementGeneration, target.currentRequirementGeneration);
  compare(current, '上下文快照', target.snapshotId, target.currentSnapshotId);
  compare(
    current,
    '工作流定义修订',
    target.workflowDefinitionRevisionId,
    target.currentWorkflowDefinitionRevisionId,
  );
  compare(current, '当前仓库身份', collection.repositoryId, target.providerRepositoryId);
  if (!target.commitSha) current.unknown.push('当前工件集没有唯一可确认的代码提交。');
  if (collection.latestAttempt !== collection.attempt)
    current.unknown.push('该运行已有其他 attempt，不能拼接不同重试或代表最新执行。');
  if (!collection.identityStable || collection.completeness !== 'COMPLETE' || collection.issues.length)
    current.unknown.push('运行观测不稳定或不完整，无法完整判定当前适用性。');
  if (collection.event === 'push')
    compare(current, 'push 提交与当前代码提交', collection.headSha, target.commitSha);
  else
    current.unknown.push('当前仅对 push 事件核对检出提交；其他事件的实际检出语义尚未取证。');

  if (!collection.reports.length) {
    association.unknown.push('没有取得可解析的机器结果报告。');
    current.unknown.push('缺少机器结果报告，无法核对报告基准和用例修订。');
  }
  const confirmedCases = new Map<string, QualityCaseRevision>();
  if (!target.cases || !target.casesContentVerified) {
    current.unknown.push('尚未核验实际 CASES 字节与 caseId 的对应关系，摘要相等不能证明用例内容。');
  } else {
    for (const item of target.cases) {
      const prior = confirmedCases.get(item.caseId);
      if (prior && (prior.artifactId !== item.revision.artifactId || prior.sha256 !== item.revision.sha256))
        current.mismatch.push('服务端 CASES 映射包含冲突修订。');
      if (!item.revision.artifactId || !/^[a-f0-9]{64}$/.test(item.revision.sha256))
        current.unknown.push('实际 CASES 字节摘要无法完整取得。');
      else confirmedCases.set(item.caseId, item.revision);
    }
  }
  const observedCaseIds = new Set<string>();
  const retestCaseIds = new Set<string>();
  for (const fact of collection.reports) {
    // Artifacts are listed at run scope. A filename or a report's own jobId,
    // runAttempt and matching strings cannot promote this to job provenance.
    association.unknown.push('GitHub artifact 仅关联到 run，尚无提供方证据证明所属 attempt 和 job。');
    if (fact.association === 'UNKNOWN' || fact.expired || fact.issues.length)
      association.unknown.push('报告下载、有效期或解析记录不完整。');
    if (
      !fact.archiveSha256 || !/^[a-f0-9]{64}$/.test(fact.archiveSha256) ||
      !fact.reportSha256 || !/^[a-f0-9]{64}$/.test(fact.reportSha256) ||
      !fact.reportByteLength || fact.reportByteLength < 1
    ) association.unknown.push('报告实际下载字节摘要无法完整取得。');
    const report = fact.report;
    if (!report) {
      current.unknown.push('报告无法解析，不能推断其基准或用例结果。');
      continue;
    }
    compare(association, '报告声明的提供方仓库', report.run.repositoryId, collection.repositoryId);
    compare(association, '报告声明的 run', report.run.runId, collection.runId);
    compare(association, '报告声明的 attempt', report.run.runAttempt, collection.attempt);
    compare(association, '报告声明的 head SHA', report.run.headSha, collection.headSha);
    compare(association, '报告声明的事件', report.run.event, collection.event);
    if (report.run.jobId) {
      const job = collection.jobs.find((item) => item.id === report.run.jobId);
      if (!job && collection.completeness === 'COMPLETE')
        association.mismatch.push('报告声明的 job 不在该 attempt 的提供方 job 列表中。');
      else if (!job) association.unknown.push('报告声明的 job 尚未在不完整采集中确认。');
    }
    compare(current, '报告项目仓库', report.basis.projectRepositoryId, target.projectRepositoryId);
    compare(current, '报告 PRD 修订', report.basis.prdRevisionId, target.prdRevisionId);
    compare(current, '报告快照', report.basis.snapshotId, target.snapshotId);
    compare(current, '报告代码提交', report.basis.commitSha, target.commitSha);
    compare(current, '报告实际检出声明', report.run.testedCommitSha, target.commitSha);
    compare(current, '报告基准与检出声明', report.run.testedCommitSha, report.basis.commitSha);
    if (collection.event === 'push')
      compare(current, '报告 push 检出声明', report.run.testedCommitSha, collection.headSha);
    if (!report.results.length) current.unknown.push('报告没有用例结果，不能当作覆盖通过。');
    for (const result of report.results) {
      observedCaseIds.add(result.caseRef.caseId);
      const actual = confirmedCases.get(result.caseRef.caseId);
      if (target.casesContentVerified && target.cases) {
        if (!actual) current.mismatch.push('报告引用了当前 CASES 中不存在或尚未取证的 caseId。');
        else if (
          result.caseRef.revision.artifactId !== actual.artifactId ||
          result.caseRef.revision.sha256 !== actual.sha256
        ) current.mismatch.push('报告 CASES 工件或实际字节摘要与当前修订不匹配。');
        else if (result.result !== 'PASSED') retestCaseIds.add(result.caseRef.caseId);
      }
    }
  }
  if (target.requiredCaseIds == null)
    current.unknown.push('正式要求执行的 caseId 集合尚未结构化，不能自动判定全部覆盖。');
  else if (!target.requiredCaseIds.length)
    current.unknown.push('要求执行的用例集合为空，不能据此认定覆盖通过。');
  else for (const caseId of target.requiredCaseIds) {
    if (!confirmedCases.has(caseId)) current.unknown.push('要求执行的用例尚未取得实际内容和修订映射。');
    if (!observedCaseIds.has(caseId)) {
      current.unknown.push('当前要求的用例缺少执行结果。');
      if (confirmedCases.has(caseId)) retestCaseIds.add(caseId);
    }
  }
  if (!current.mismatch.length && !current.unknown.length)
    current.matched.push('已核对服务端当前版本、报告基准与实际 CASES 字节；来源关联仍需单独判断。');

  const dimensions = {
    origin: finish(origin),
    reportAssociation: finish(association),
    currentness: finish(current),
    definitionIndependence: {
      status: 'UNKNOWN' as const,
      reasons: unique([
        '尚无可机器核验的正式 KNOWLEDGE 验证规则来源；独立运行环境不能证明定义独立。',
        ...(definition.reasons ?? []),
      ]),
    },
  };
  const reasons = ['诊断仅供参考，不构成 HUMAN 批准，也不替代既有代码评审门禁。'];
  if (retestCaseIds.size)
    reasons.push(`建议复验已确认修订的用例：${[...retestCaseIds].sort().join('、')}。`);
  if (current.mismatch.length || current.unknown.length)
    reasons.push('影响范围或当前基准未完全确认，请 QA 界定需重跑的用例；此建议不是穷尽范围。');
  return { authority: 'ADVISORY', ...dimensions, outcome: summarizeOutcome(collection, dimensions), reasons };
}

function summarizeOutcome(
  collection: VerificationCollection,
  dimensions: Pick<VerificationApplicability, 'origin' | 'reportAssociation' | 'currentness'>,
): VerificationApplicability['outcome'] {
  const values: VerificationApplicability['outcome'][] = [];
  const conclusion = (status: string, value: string | null): void => {
    // Explicit failures stay visible even when a provider run incorrectly says success.
    if (value === 'failure' || value === 'startup_failure') values.push('FAILED');
    else if (['cancelled', 'timed_out', 'action_required', 'stale'].includes(value ?? '')) values.push('BLOCKED');
    else if (value === 'skipped' || value === 'neutral') values.push('NOT_RUN');
    else if (status !== 'completed' || value !== 'success') values.push('UNKNOWN');
    else values.push('REPORTED_PASS');
  };
  conclusion(collection.status, collection.conclusion);
  if (!collection.jobs.length) values.push('UNKNOWN');
  for (const job of collection.jobs) {
    conclusion(job.status, job.conclusion);
    if (!job.steps.length) values.push('UNKNOWN');
    for (const step of job.steps) conclusion(step.status, step.conclusion);
  }
  if (!collection.reports.length) values.push('UNKNOWN');
  for (const fact of collection.reports) {
    if (!fact.report || !fact.report.results.length || fact.expired || fact.issues.length)
      values.push('UNKNOWN');
    for (const result of fact.report?.results ?? []) {
      const mapped = { PASSED: 'REPORTED_PASS', FAILED: 'FAILED', BLOCKED: 'BLOCKED', NOT_RUN: 'NOT_RUN' } as const;
      values.push(mapped[result.result] ?? 'UNKNOWN');
    }
  }
  if (Object.values(dimensions).some((item) => item.status !== 'MATCHED')) values.push('UNKNOWN');
  for (const result of ['FAILED', 'BLOCKED', 'NOT_RUN', 'UNKNOWN'] as const)
    if (values.includes(result)) return result;
  return 'REPORTED_PASS';
}
