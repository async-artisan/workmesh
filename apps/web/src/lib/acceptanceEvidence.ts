import {
  analyzeQualityBundle,
  parseJsonStrict,
  type QualityBundle,
  type QualityEvidence,
  type QualityReport,
} from '@workmesh/shared';
import type {
  ArtifactContentView,
  ArtifactSetView,
  ArtifactView,
  RevisionView,
} from '../api/resources';

export type AcceptanceCriterion = NonNullable<RevisionView['acceptance']>[number];
export type QualityArtifactSource = {
  artifactId: string;
  label: string;
  bundle: QualityBundle;
  report: QualityReport;
};
export type ParsedQualityArtifact =
  { ok: true; source: QualityArtifactSource } | { ok: false; message: string };
export type EvidenceBasisState = 'MATCHED' | 'MISMATCH' | 'UNVERIFIED';
export type MappedAcceptanceEvidence = QualityEvidence & {
  artifactId: string;
  artifactLabel: string;
  stage: QualityBundle['stage'];
  basisState: EvidenceBasisState;
  issues: string[];
};
export type AcceptanceEvidenceRow = {
  criterion: AcceptanceCriterion;
  evidence: MappedAcceptanceEvidence[];
  taskIds: string[];
  caseIds: string[];
  status:
    'REPORTED_PASS' | 'FAILED' | 'BLOCKED' | 'NOT_RUN' | 'MISSING' | 'NEEDS_REVIEW' | 'UNKNOWN';
  gaps: string[];
};

/** Previews can identify a candidate, but never supply the parsed proof. */
export function isQualityJsonCandidate(artifact: ArtifactView): boolean {
  if (artifact.storage !== 'HOSTED') return false;
  const mediaType = artifact.mediaType.split(';', 1)[0].trim().toLowerCase();
  return (
    mediaType === 'application/json' ||
    mediaType.endsWith('+json') ||
    /\.json$/i.test(artifact.repoPath ?? '') ||
    (/quality|质量包/i.test(artifact.summary ?? '') &&
      artifact.contentPreview?.text.trimStart().startsWith('{') === true)
  );
}

/** The guarded content endpoint supplies full bytes; a preview is never accepted here. */
export function parseQualityArtifact(
  artifact: ArtifactView,
  content: ArtifactContentView,
): ParsedQualityArtifact {
  if (
    artifact.storage !== 'HOSTED' ||
    content.storage !== 'HOSTED' ||
    content.artifactId !== artifact.id ||
    content.sha256 !== artifact.sha256 ||
    content.byteLength !== artifact.byteLength
  )
    return { ok: false, message: '完整正文与当前交付物的标识、摘要或长度不一致，请重新读取。' };
  if (content.text === null)
    return { ok: false, message: '该完整正文不是可读取的 JSON 文本，不能建立验收映射。' };
  let parsed: unknown;
  try {
    parsed = parseJsonStrict(content.text);
  } catch {
    return {
      ok: false,
      message: '完整正文不是合法 JSON，或含有重复字段；不会使用截断预览推断覆盖。',
    };
  }
  const report = analyzeQualityBundle(parsed);
  if (report.status === 'INVALID')
    return {
      ok: false,
      message: `未识别为有效质量包：${report.issues
        .slice(0, 3)
        .map((issue) => issue.message)
        .join('；')}`,
    };
  return {
    ok: true,
    source: {
      artifactId: artifact.id,
      label: artifact.summary ?? artifact.repoPath ?? artifact.id,
      bundle: parsed as QualityBundle,
      report,
    },
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Only explicit acceptanceKeys produce rows. Artifact checks do not contain that relationship. */
export function buildAcceptanceEvidenceMapping(input: {
  acceptance: AcceptanceCriterion[];
  requirementId: string | null;
  prdRevisionId: string | null;
  artifactSet: ArtifactSetView | null;
  sources: QualityArtifactSource[];
}): { rows: AcceptanceEvidenceRow[]; unlinkedCheckCount: number; unknownAcceptanceKeys: string[] } {
  const commits = new Set(
    input.artifactSet?.artifacts
      .map((artifact) => artifact.commitSha)
      .filter(
        (commit): commit is string => typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit),
      ),
  );
  const expectedKeys = new Set(input.acceptance.map((criterion) => criterion.key));
  const unknownAcceptanceKeys = unique(
    input.sources.flatMap(({ bundle }) =>
      bundle.evidence.flatMap((evidence) =>
        evidence.acceptanceKeys.filter((key) => !expectedKeys.has(key)),
      ),
    ),
  );
  const rows = input.acceptance.map((criterion): AcceptanceEvidenceRow => {
    const evidence: MappedAcceptanceEvidence[] = [];
    const taskIds: string[] = [];
    const caseIds: string[] = [];
    const gaps: string[] = [];
    for (const source of input.sources) {
      const { bundle, report } = source;
      const declarations = bundle.acceptance.filter((item) => item.key === criterion.key);
      const linked = bundle.evidence.filter((item) => item.acceptanceKeys.includes(criterion.key));
      if (!declarations.length && !linked.length) continue;
      const commonIssues: string[] = [];
      let mismatch = false;
      let unverified = false;
      const mismatchIssue = (message: string) => {
        mismatch = true;
        commonIssues.push(message);
      };
      const unknownIssue = (message: string) => {
        unverified = true;
        commonIssues.push(message);
      };
      if (!input.requirementId) unknownIssue('需求标识不可确认');
      else if (bundle.requirementId !== input.requirementId) mismatchIssue('质量包属于其他需求');
      if (!input.prdRevisionId) unknownIssue('已发布 PRD 修订标识不可确认');
      else if (bundle.basis.prdRevisionId !== input.prdRevisionId)
        mismatchIssue('质量包 PRD 修订与当前已发布 PRD 不一致');
      if (!input.artifactSet) unknownIssue('交付物快照不可读取');
      else if (bundle.basis.snapshotId !== input.artifactSet.snapshotId)
        mismatchIssue('质量包快照与本次交付不一致');
      if (bundle.stage !== 'DELIVERY')
        unknownIssue('PLAN 质量包只描述计划，不能作为交付执行通过证据');
      if (!bundle.basis.commitSha) unknownIssue('质量包未声明完整代码提交');
      else if (!commits.size) unknownIssue('本次工件未声明可对照的完整 commit，代码版本待核对');
      else if (!commits.has(bundle.basis.commitSha))
        mismatchIssue('质量包 commit 未对应本次已声明的交付提交');
      if (declarations.length !== 1) mismatchIssue('质量包的验收 key 缺失或重复');
      else if (
        declarations[0].text.trim() !== criterion.text.trim() ||
        declarations[0].verification.toUpperCase() !== criterion.verification.toUpperCase()
      )
        mismatchIssue('同一验收 key 的正文或验证方式与已发布 PRD 不一致');
      // Structural or coverage errors remain visible; a PASSED row cannot hide them.
      const structuralErrors = report.issues.filter(
        (issue) =>
          issue.severity === 'ERROR' &&
          (issue.location === `acceptance.${criterion.key}` ||
            [
              'DUPLICATE_ID',
              'UNKNOWN_ACCEPTANCE',
              'UNKNOWN_DEPENDENCY',
              'DEPENDENCY_CYCLE',
              'PARALLEL_FILE_CONFLICT',
              'VERIFICATION_MISMATCH',
            ].includes(issue.code)),
      );
      for (const issue of structuralErrors) unknownIssue(issue.message);
      taskIds.push(
        ...bundle.tasks
          .filter((task) => task.acceptanceKeys.includes(criterion.key))
          .map((task) => task.id),
      );
      caseIds.push(
        ...bundle.cases
          .filter(
            (item) =>
              item.covers.includes(criterion.key) &&
              item.kind.toUpperCase() === criterion.verification.toUpperCase(),
          )
          .map((item) => item.id),
      );
      for (const item of linked) {
        const issues = [...commonIssues];
        const stale =
          item.basis.prdRevisionId !== bundle.basis.prdRevisionId ||
          item.basis.snapshotId !== bundle.basis.snapshotId ||
          item.basis.commitSha !== bundle.basis.commitSha;
        if (stale) issues.push('这条证据的 PRD、快照或 commit 与质量包依据不一致');
        evidence.push({
          ...item,
          artifactId: source.artifactId,
          artifactLabel: source.label,
          stage: bundle.stage,
          basisState: mismatch || stale ? 'MISMATCH' : unverified ? 'UNVERIFIED' : 'MATCHED',
          issues: unique(issues),
        });
      }
      gaps.push(...commonIssues);
    }
    if (!evidence.length)
      gaps.push(
        input.artifactSet
          ? '没有通过 acceptanceKeys 明确关联到此条验收的可读质量包证据；普通工件检查不自动算作覆盖。'
          : '交付物尚不可读取，不能判断此条验收是否有证据。',
      );
    let status: AcceptanceEvidenceRow['status'] = !input.artifactSet ? 'UNKNOWN' : 'MISSING';
    if (evidence.length) {
      status = evidence.some((item) => item.result === 'FAILED')
        ? 'FAILED'
        : evidence.some((item) => item.result === 'BLOCKED')
          ? 'BLOCKED'
          : evidence.some((item) => item.result === 'NOT_RUN')
            ? 'NOT_RUN'
            : evidence.every((item) => item.basisState === 'MATCHED') && !gaps.length
              ? 'REPORTED_PASS'
              : 'NEEDS_REVIEW';
    }
    return {
      criterion,
      evidence,
      taskIds: unique(taskIds),
      caseIds: unique(caseIds),
      status,
      gaps: unique(gaps),
    };
  });
  return {
    rows,
    unlinkedCheckCount:
      input.artifactSet?.artifacts.reduce((count, artifact) => count + artifact.checks.length, 0) ??
      0,
    unknownAcceptanceKeys,
  };
}

/** Report references may be local paths or other schemes; only safe web URLs become links. */
export function safeEvidenceUrl(ref: string): string | null {
  try {
    const url = new URL(ref);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
