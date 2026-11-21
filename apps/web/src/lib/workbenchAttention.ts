import type {
  WorkbenchAttentionReasonCode,
  WorkbenchCoverage,
  WorkbenchStreamCoverage,
} from '@workmesh/shared';
import type { WorkbenchReviewItem } from '../api/resources';

export type WorkbenchReasonFilter = '' | WorkbenchAttentionReasonCode;

export const WORKBENCH_REASON_LABELS: Record<WorkbenchAttentionReasonCode, string> = {
  REPORTED_CHECK_FAILED: '提交报告含失败检查',
  DETAILS_NOT_QUERIED: '详细证据待核验',
};

/** A summary for a different review/version must not explain the current row. */
export function currentWorkbenchAttention(review: WorkbenchReviewItem) {
  const attention = review.attention;
  return attention?.reviewId === review.reviewId && attention.reviewVersion === review.version
    ? attention
    : null;
}

export function workbenchReviewMatchesReason(
  review: WorkbenchReviewItem,
  reason: WorkbenchReasonFilter,
): boolean {
  if (!reason) return true;
  const attention = currentWorkbenchAttention(review);
  if (!attention) return reason === 'DETAILS_NOT_QUERIED';
  return attention.reasons.some((item) => item.code === reason);
}

export function workbenchCoverageStatus(coverage?: WorkbenchCoverage) {
  if (!coverage || coverage.streams.length === 0) return 'UNKNOWN' as const;
  if (coverage.streams.some((stream) => stream.status === 'ERROR')) return 'ERROR' as const;
  if (coverage.streams.some((stream) => stream.status === 'PARTIAL')) return 'PARTIAL' as const;
  if (coverage.streams.some((stream) => stream.status === 'UNKNOWN')) return 'UNKNOWN' as const;
  return 'COMPLETE' as const;
}

const STREAM_LABELS = {
  REVIEWS: '评审',
  CHANGES: '待确认变更',
  READY_TASKS: '前置就绪任务',
  OVERDUE_APPROVALS: '逾期审批',
};

export function workbenchStreamDescription(stream: WorkbenchStreamCoverage): string {
  const scope = stream.projectKey ?? `所选 ${stream.projectIds.length} 个项目合计`;
  const status =
    stream.status === 'ERROR'
      ? '读取失败，不能据此判断没有待办'
      : stream.reason === 'PERMISSIONS_UNAVAILABLE'
        ? '权限状态未读取，行动资格需刷新核对'
        : stream.status === 'PARTIAL'
          ? '仍有后续记录，本工作台未继续加载'
          : stream.status === 'UNKNOWN'
            ? '分页范围未知'
            : '待办列表已读完';
  return `${scope} · ${STREAM_LABELS[stream.stream]}：已加载 ${stream.loadedCount} 条；${status}`;
}

export function workbenchStreamPath(stream: WorkbenchStreamCoverage): string {
  const path =
    stream.stream === 'REVIEWS' || stream.stream === 'OVERDUE_APPROVALS'
      ? '/reviews'
      : stream.stream === 'READY_TASKS'
        ? '/board'
        : '/requirements';
  return stream.projectIds.length === 1
    ? `${path}?projectId=${encodeURIComponent(stream.projectIds[0])}`
    : path;
}
