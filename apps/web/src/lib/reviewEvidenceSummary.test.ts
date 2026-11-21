import { describe, expect, it } from 'vitest';
import type { AcceptanceEvidenceRow, EvidenceBasisState } from './acceptanceEvidence';
import {
  buildReviewEvidenceSummary,
  formatReviewEvidenceBasisSummary,
  formatReviewEvidenceSummary,
  selectReviewEvidenceSummary,
} from './reviewEvidenceSummary';

function row(
  status: AcceptanceEvidenceRow['status'],
  basisStates: EvidenceBasisState[] = [],
): AcceptanceEvidenceRow {
  return {
    criterion: { key: 'ac-login', text: '有效账号可以登录', verification: 'TEST' },
    status,
    taskIds: [],
    caseIds: [],
    caseCoverage: [],
    gaps: [],
    evidence: basisStates.map((basisState, index) => ({
      id: 'evidence-' + index,
      acceptanceKeys: ['ac-login'],
      result: 'PASSED',
      source: 'AGENT_REPORTED',
      ref: 'test-report.txt',
      basis: { prdRevisionId: 'prd-1', snapshotId: 'snapshot-1', commitSha: 'a'.repeat(40) },
      artifactId: 'artifact-1',
      artifactLabel: '质量包',
      stage: 'DELIVERY',
      bundleSchemaVersion: '1.0',
      basisState,
      issues: [],
    })),
  };
}

const input = {
  scopeKey: 'review-1:v1:set-1:prd-1',
  loading: false,
  candidateCount: 1,
  readableCount: 1,
  unreadableCount: 0,
};

describe('reviewEvidenceSummary', () => {
  it('加载中保留验收范围但不把暂时没有报告计作最终缺失或版本匹配', () => {
    const summary = buildReviewEvidenceSummary({
      ...input,
      loading: true,
      rows: [row('MISSING'), row('REPORTED_PASS', ['MATCHED'])],
    });
    expect(summary).toMatchObject({ status: 'LOADING', totalAcceptance: 2, readableCount: 0 });
    expect(Object.values(summary.counts).every((count) => count === 0)).toBe(true);
    expect(Object.values(summary.basisCounts).every((count) => count === 0)).toBe(true);
    expect(formatReviewEvidenceSummary(summary)).toContain('待确认');
    expect(formatReviewEvidenceBasisSummary(summary)).toContain('待核对');
  });

  it('全部读取后分别统计失败、阻塞、未运行、缺失与字段依据，不把报告通过变成独立验证', () => {
    const summary = buildReviewEvidenceSummary({
      ...input,
      rows: [
        row('REPORTED_PASS', ['MATCHED', 'MATCHED']),
        row('FAILED', ['MISMATCH']),
        row('BLOCKED', ['UNVERIFIED']),
        row('NOT_RUN'),
        row('MISSING'),
        row('NEEDS_REVIEW'),
        row('UNKNOWN'),
      ],
    });
    expect(summary.status).toBe('READY');
    expect(Object.values(summary.counts)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(summary.basisCounts).toEqual({ MATCHED: 2, MISMATCH: 1, UNVERIFIED: 1 });
    expect(formatReviewEvidenceSummary(summary)).toContain('1 项报告通过，待人工核验');
    expect(formatReviewEvidenceSummary(summary)).toContain('1 项有失败报告');
    expect(formatReviewEvidenceBasisSummary(summary)).toContain('字段匹配不代表执行已验证');
  });

  it('部分质量包不可读时保留已知失败，原报告通过与缺失降为待确认', () => {
    const summary = buildReviewEvidenceSummary({
      ...input,
      candidateCount: 2,
      unreadableCount: 1,
      rows: [row('FAILED', ['MATCHED']), row('REPORTED_PASS', ['MATCHED']), row('MISSING')],
    });
    expect(summary).toMatchObject({
      status: 'PARTIAL',
      readableCount: 1,
      unreadableCount: 1,
      counts: { FAILED: 1, REPORTED_PASS: 0, MISSING: 0, UNKNOWN: 2 },
    });
    expect(formatReviewEvidenceSummary(summary)).toContain('结论不完整');
    expect(formatReviewEvidenceSummary(summary)).toContain('1 项有失败报告');
    expect(formatReviewEvidenceSummary(summary)).not.toContain('报告通过');
    expect(formatReviewEvidenceBasisSummary(summary)).toContain('整体版本仍待确认');
  });

  it('没有验收范围或关联版本时明确未知，范围变更不沿用旧摘要', () => {
    const summary = buildReviewEvidenceSummary({ ...input, rows: [] });
    expect(formatReviewEvidenceSummary(summary)).toContain('验收范围仍需人工确认');
    expect(formatReviewEvidenceBasisSummary(summary)).toContain('不能确认版本匹配');
    expect(selectReviewEvidenceSummary(summary, input.scopeKey)).toBe(summary);
    expect(selectReviewEvidenceSummary(summary, 'review-1:v2:set-2:prd-2')).toBeNull();
    expect(selectReviewEvidenceSummary(undefined, input.scopeKey)).toBeNull();
  });
});
