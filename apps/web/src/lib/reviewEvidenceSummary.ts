import type { AcceptanceEvidenceRow, EvidenceBasisState } from './acceptanceEvidence';

/** Read-only UI summary of submitted reports; it is never an approval or verification result. */
export type ReviewEvidenceSummary = {
  scopeKey: string;
  status: 'LOADING' | 'READY' | 'PARTIAL';
  candidateCount: number;
  readableCount: number;
  unreadableCount: number;
  totalAcceptance: number;
  counts: Record<AcceptanceEvidenceRow['status'], number>;
  /** Counts linked evidence entries, not acceptance criteria or independently verified runs. */
  basisCounts: Record<EvidenceBasisState, number>;
};

export function buildReviewEvidenceSummary(input: {
  scopeKey: string;
  loading: boolean;
  candidateCount: number;
  readableCount: number;
  unreadableCount: number;
  rows: AcceptanceEvidenceRow[];
}): ReviewEvidenceSummary {
  const counts: ReviewEvidenceSummary['counts'] = {
    REPORTED_PASS: 0,
    FAILED: 0,
    BLOCKED: 0,
    NOT_RUN: 0,
    MISSING: 0,
    NEEDS_REVIEW: 0,
    UNKNOWN: 0,
  };
  const basisCounts: ReviewEvidenceSummary['basisCounts'] = {
    MATCHED: 0,
    MISMATCH: 0,
    UNVERIFIED: 0,
  };
  const partial = input.unreadableCount > 0;
  if (!input.loading) {
    for (const row of input.rows) {
      // An unreadable report may contain contrary evidence or the missing association.
      const status =
        partial && (row.status === 'REPORTED_PASS' || row.status === 'MISSING')
          ? 'UNKNOWN'
          : row.status;
      counts[status] += 1;
      for (const evidence of row.evidence) basisCounts[evidence.basisState] += 1;
    }
  }
  return {
    scopeKey: input.scopeKey,
    status: input.loading ? 'LOADING' : partial ? 'PARTIAL' : 'READY',
    candidateCount: input.candidateCount,
    readableCount: input.loading ? 0 : input.readableCount,
    unreadableCount: input.loading ? 0 : input.unreadableCount,
    totalAcceptance: input.rows.length,
    counts,
    basisCounts,
  };
}

/** Prevents a previous review/PRD/artifact summary from being reused in a new scope. */
export function selectReviewEvidenceSummary(
  summary: ReviewEvidenceSummary | null | undefined,
  scopeKey: string,
): ReviewEvidenceSummary | null {
  return summary?.scopeKey === scopeKey ? summary : null;
}

export function formatReviewEvidenceSummary(summary: ReviewEvidenceSummary): string {
  if (summary.status === 'LOADING') return '正在读取完整质量包，验收报告待确认。';
  if (summary.totalAcceptance === 0) return '没有可对照的结构化验收标准，验收范围仍需人工确认。';
  const labels: Record<AcceptanceEvidenceRow['status'], string> = {
    REPORTED_PASS: '报告通过，待人工核验',
    FAILED: '有失败报告',
    BLOCKED: '有阻塞报告',
    NOT_RUN: '未执行',
    MISSING: '缺少关联证据',
    NEEDS_REVIEW: '版本或覆盖待核对',
    UNKNOWN: '证据待确认',
  };
  const details = (Object.keys(labels) as AcceptanceEvidenceRow['status'][])
    .filter((status) => summary.counts[status] > 0)
    .map((status) => `${summary.counts[status]} 项${labels[status]}`);
  const prefix =
    summary.status === 'PARTIAL'
      ? `完整质量包 ${summary.readableCount}/${summary.candidateCount} 份可读，结论不完整。`
      : '';
  return `${prefix}共 ${summary.totalAcceptance} 项验收：${details.join('；')}。`;
}

export function formatReviewEvidenceBasisSummary(summary: ReviewEvidenceSummary): string {
  if (summary.status === 'LOADING') return '正在读取证据，版本字段待核对。';
  const { MATCHED, MISMATCH, UNVERIFIED } = summary.basisCounts;
  if (MATCHED + MISMATCH + UNVERIFIED === 0)
    return '没有可核对的关联证据版本字段，不能确认版本匹配。';
  const details = [
    MATCHED > 0 ? `${MATCHED} 条关联证据版本字段匹配` : '',
    MISMATCH > 0 ? `${MISMATCH} 条版本或条款不匹配` : '',
    UNVERIFIED > 0 ? `${UNVERIFIED} 条版本依据待核对` : '',
  ].filter(Boolean);
  const suffix = summary.status === 'PARTIAL' ? '；仅覆盖已读证据，整体版本仍待确认' : '';
  return `${details.join('；')}${suffix}。字段匹配不代表执行已验证。`;
}
