import { parseJsonStrict } from './strict-json';
import type { QualityBasisV11, QualityCaseRef, QualityIssue, QualityResult } from './quality';

export const CI_RESULT_REPORT_MAX_BYTES = 4 * 1024 * 1024;
export const CI_RESULT_REPORT_MAX_RESULTS = 2000;

/** 所有字段都是报告内容声明；提供方身份、artifact 字节摘要由服务端采集信封另存。 */
export type CiResultReportV1 = {
  kind: 'WORKMESH_CI_RESULTS';
  schemaVersion: '1.0';
  run: {
    provider: 'GITHUB_ACTIONS';
    repositoryId: string;
    runId: string;
    runAttempt: number;
    jobId?: string;
    jobKey: string;
    event: string;
    headSha: string;
    testedCommitSha: string;
  };
  basis: QualityBasisV11 & { commitSha: string };
  environment: { summary: string; startedAt: string; completedAt: string };
  results: Array<{
    id: string;
    caseRef: QualityCaseRef;
    result: QualityResult;
    durationMs?: number;
    ref?: string;
  }>;
};
export type CiResultReportParseResult =
  | { ok: true; authority: 'LOCAL_REPORTED'; report: CiResultReportV1 }
  | { ok: false; issues: QualityIssue[] };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 200): value is string =>
  typeof value === 'string' && value.length <= max && !!value.trim();
const keys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const sha = (value: unknown, length: number): value is string =>
  typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const providerId = (value: unknown) =>
  typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().replace('.000Z', 'Z') === value.replace('.000Z', 'Z');

/** 严格的纯结构检查：不联网、不运行测试、不签发或推断提供方证明。 */
export function analyzeCiResultReport(input: unknown): CiResultReportParseResult {
  const issues: QualityIssue[] = [];
  const invalid = (location: string, message: string) =>
    issues.push({ code: 'CI_REPORT_INVALID', severity: 'ERROR', location, message });
  if (!object(input))
    return {
      ok: false,
      issues: [
        {
          code: 'CI_REPORT_INVALID',
          severity: 'ERROR',
          location: '$',
          message: 'CI 结果报告必须是对象',
        },
      ],
    };
  if (
    input.kind !== 'WORKMESH_CI_RESULTS' ||
    input.schemaVersion !== '1.0' ||
    !keys(input, ['kind', 'schemaVersion', 'run', 'basis', 'environment', 'results'])
  )
    invalid(
      '$',
      '仅支持 WORKMESH_CI_RESULTS 1.0；不得声明 verified、authority 或自身 artifact 身份',
    );
  const run = input.run;
  if (
    !object(run) ||
    !keys(run, [
      'provider',
      'repositoryId',
      'runId',
      'runAttempt',
      'jobId',
      'jobKey',
      'event',
      'headSha',
      'testedCommitSha',
    ]) ||
    run.provider !== 'GITHUB_ACTIONS' ||
    !providerId(run.repositoryId) ||
    !providerId(run.runId) ||
    !Number.isSafeInteger(run.runAttempt) ||
    (run.runAttempt as number) < 1 ||
    (run.jobId !== undefined && !providerId(run.jobId)) ||
    !text(run.jobKey) ||
    !text(run.event, 80) ||
    !sha(run.headSha, 40) ||
    !sha(run.testedCommitSha, 40)
  )
    invalid('run', '运行声明需提供方、十进制身份、正整数 attempt、job key、事件与完整提交');
  const basis = input.basis;
  if (
    !object(basis) ||
    !keys(basis, ['prdRevisionId', 'snapshotId', 'projectRepositoryId', 'commitSha']) ||
    !text(basis.prdRevisionId) ||
    !text(basis.snapshotId) ||
    !text(basis.projectRepositoryId) ||
    !sha(basis.commitSha, 40)
  )
    invalid('basis', '报告需精确 PRD、快照、登记仓库与被测提交');
  else if (object(run) && basis.commitSha !== run.testedCommitSha)
    invalid('basis.commitSha', '报告依据提交必须等于声明的实际被测提交');
  const environment = input.environment;
  if (
    !object(environment) ||
    !keys(environment, ['summary', 'startedAt', 'completedAt']) ||
    !text(environment.summary, 2000) ||
    !timestamp(environment.startedAt) ||
    !timestamp(environment.completedAt) ||
    Date.parse(environment.startedAt) > Date.parse(environment.completedAt)
  )
    invalid('environment', '需环境摘要和顺序正确的 UTC 开始/结束时间');
  if (
    !Array.isArray(input.results) ||
    !input.results.length ||
    input.results.length > CI_RESULT_REPORT_MAX_RESULTS
  )
    invalid('results', `报告必须有 1–${CI_RESULT_REPORT_MAX_RESULTS} 条实际结果；零结果不代表通过`);
  else {
    const ids = new Set<string>();
    const cases = new Set<string>();
    const artifactDigests = new Map<string, string>();
    input.results.forEach((entry: unknown, index: number) => {
      if (
        !object(entry) ||
        !keys(entry, ['id', 'caseRef', 'result', 'durationMs', 'ref']) ||
        !text(entry.id) ||
        !['PASSED', 'FAILED', 'BLOCKED', 'NOT_RUN'].includes(entry.result as string) ||
        (entry.durationMs !== undefined &&
          (!Number.isSafeInteger(entry.durationMs) || (entry.durationMs as number) < 0)) ||
        (entry.ref !== undefined && !text(entry.ref, 2048)) ||
        !object(entry.caseRef) ||
        !keys(entry.caseRef, ['caseId', 'revision']) ||
        !text(entry.caseRef.caseId) ||
        !object(entry.caseRef.revision) ||
        !keys(entry.caseRef.revision, ['artifactId', 'sha256']) ||
        !text(entry.caseRef.revision.artifactId) ||
        !sha(entry.caseRef.revision.sha256, 64)
      ) {
        invalid(
          `results[${index}]`,
          '结果需唯一 ID、精确 CASES 修订与明确状态；未知结论不能当通过',
        );
        return;
      }
      if (ids.has(entry.id)) invalid(`results[${index}].id`, '重复结果标识');
      ids.add(entry.id);
      if (cases.has(entry.caseRef.caseId))
        invalid(`results[${index}].caseRef`, '同一报告的用例 ID 必须唯一，不混合重试或不同修订');
      cases.add(entry.caseRef.caseId);
      const previousDigest = artifactDigests.get(entry.caseRef.revision.artifactId);
      if (previousDigest && previousDigest !== entry.caseRef.revision.sha256)
        invalid(`results[${index}].caseRef.revision`, '相同不可变 CASES 工件不能声明不同摘要');
      artifactDigests.set(entry.caseRef.revision.artifactId, entry.caseRef.revision.sha256);
    });
  }
  return issues.length
    ? { ok: false, issues }
    : { ok: true, authority: 'LOCAL_REPORTED', report: input as unknown as CiResultReportV1 };
}

/** 原始 UTF-8/JSON 入口统一限制字节、深度、重复键和不安全数字。 */
export function parseCiResultReport(input: Uint8Array | string): CiResultReportParseResult {
  const size =
    typeof input === 'string' ? new TextEncoder().encode(input).byteLength : input.byteLength;
  if (size > CI_RESULT_REPORT_MAX_BYTES)
    return {
      ok: false,
      issues: [
        {
          code: 'CI_REPORT_TOO_LARGE',
          severity: 'ERROR',
          location: '$',
          message: 'CI 结果报告不能超过 4 MiB',
        },
      ],
    };
  try {
    return analyzeCiResultReport(parseJsonStrict(input));
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'CI_REPORT_JSON_INVALID',
          severity: 'ERROR',
          location: '$',
          message: '报告必须是无重复键、无浮点数且深度受限的 UTF-8 JSON',
        },
      ],
    };
  }
}
