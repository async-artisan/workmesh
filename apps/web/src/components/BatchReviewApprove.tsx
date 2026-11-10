import { useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import { formatApiError } from '../api/client';
import { reviewApi, type ReviewView } from '../api/resources';
import { Modal } from './Modal';
import { InlineLoading } from './Skeleton';

/** 批量批准的一条评审：槽位、版本都来自当前工作台快照，提交时服务端逐条校验。 */
export interface BatchReviewTarget {
  reviewId: string;
  projectId: string;
  slotId: string;
  requiredRoleId: string | null;
  expectedVersion: number;
  label: string;
}

export interface BatchReviewSummary {
  approved: number;
  failed: number;
}

interface BatchReviewApproveProps {
  open: boolean;
  targets: BatchReviewTarget[];
  onClose: () => void;
  /** 收到批量结果后汇总；调用方应保留逐项结果，待用户关闭后刷新工作台。 */
  onCompleted: (summary: BatchReviewSummary) => void;
}

interface BatchReviewResult {
  reviewId: string;
  status: string;
  message?: string;
}

interface BatchReviewCheck {
  target: BatchReviewTarget;
  review?: ReviewView;
  reason?: string;
}

function checkReview(target: BatchReviewTarget, review: ReviewView): string | undefined {
  if (review.id !== target.reviewId || review.projectId !== target.projectId)
    return '评审所属项目或对象与选中项不一致，请刷新后重新选择。';
  if (review.status !== 'OPEN') return '评审已关闭，不能继续批准。';
  if (review.version !== target.expectedVersion)
    return `评审已从 v${target.expectedVersion} 更新到 v${review.version}，请重新阅读后选择。`;
  const slot = review.slots.find((candidate) => candidate.id === target.slotId);
  if (!slot || slot.requiredRoleId !== target.requiredRoleId)
    return '选定的签字槽位或角色已变化，请刷新后重新选择。';
  if (review.decisions.some((decision) => decision.approvalSlotId === slot.id))
    return '该签字槽位已有决定，不能重复批准。';
  if (slot.viewerCanDecide !== true)
    return '服务端未确认你有该槽位的签字资格，请核对角色分配或委托。';
  if (!review.subjectDigest) return '评审缺少可绑定的对象摘要，请打开详情核实。';
  return undefined;
}

/**
 * 批量批准：数量受服务端上限约束（20 条）。
 * 每条评审都需要独立票据，一次密码输入后逐条预览 + 签票，再一次性提交 batch-decisions；
 * 任何一条签票失败都不会提交，避免出现“部分提交但不自知”。
 */
export function BatchReviewApprove({
  open,
  targets,
  onClose,
  onCompleted,
}: BatchReviewApproveProps) {
  const [password, setPassword] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [error, setError] = useState('');
  const [results, setResults] = useState<BatchReviewResult[] | null>(null);
  const [checks, setChecks] = useState<BatchReviewCheck[] | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setComment('');
    setBusy(false);
    setProgress(null);
    setError('');
    setResults(null);
    setChecks(null);
    setChecking(false);
  }, [open]);

  const approved = results?.filter((item) => item.status === 'APPLIED').length ?? 0;
  const failed = results ? results.length - approved : 0;
  const reviewPath = (reviewId: string) => {
    const target = targets.find((item) => item.reviewId === reviewId);
    return `/reviews/${encodeURIComponent(reviewId)}${target ? `?projectId=${encodeURIComponent(target.projectId)}` : ''}`;
  };

  async function submit(allowSubset = false) {
    if (busy) return;
    if (!password.trim()) {
      setError('请输入登录密码以签发一次性票据。');
      return;
    }
    if (targets.length === 0) return;
    if (targets.length > 20) {
      setError('一次最多批量批准 20 条，请减少选择。');
      return;
    }
    setBusy(true);
    setError('');
    setResults(null);
    try {
      setChecking(true);
      const toCheck =
        allowSubset && checks
          ? checks.filter((item) => !item.reason).map((item) => item.target)
          : targets;
      const currentChecks = await Promise.all(
        toCheck.map(async (target): Promise<BatchReviewCheck> => {
          try {
            const review = await reviewApi.get(target.reviewId);
            return { target, review, reason: checkReview(target, review) };
          } catch (caught) {
            return { target, reason: `无法核实当前评审：${formatApiError(caught)}` };
          }
        }),
      );
      const previousInvalid = allowSubset ? (checks ?? []).filter((item) => item.reason) : [];
      const allChecks = [...previousInvalid, ...currentChecks];
      setChecks(allChecks);
      setChecking(false);
      const invalid = allChecks.filter((item) => item.reason);
      const valid = currentChecks.filter((item) => !item.reason && item.review);
      if (
        !valid.length ||
        (invalid.length > 0 && (!allowSubset || currentChecks.some((item) => item.reason)))
      ) {
        setError(
          `预检完成：${valid.length} 条可继续，${invalid.length} 条需处理。尚未签发票据或提交批准。`,
        );
        return;
      }
      const items: Array<{
        reviewId: string;
        slotId: string;
        expectedVersion: number;
        comment?: string;
        confirmation: { ticketId: string; ticketSecret: string };
      }> = [];
      const skipped = invalid.map((item) => ({
        reviewId: item.target.reviewId,
        status: 'SKIPPED',
        message: item.reason,
      }));
      for (const [index, checked] of valid.entries()) {
        const { target, review } = checked;
        if (!review) continue;
        setProgress({ current: index + 1, total: valid.length });
        const slot = review.slots.find((candidate) => candidate.id === target.slotId)!;
        const payload = {
          slotId: slot.id,
          decision: 'APPROVE',
          subjectDigest: review.subjectDigest,
          comment: comment.trim() || null,
        };
        const binding = {
          action: 'REVIEW_DECIDE',
          projectId: target.projectId,
          targetType: 'REVIEW_REQUEST',
          targetId: target.reviewId,
          expectedVersion: review.version,
          roleSlot: slot.requiredRoleId
            ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id }
            : null,
          payload,
        };
        let ticket;
        try {
          const preview = await authApi.preview(binding);
          ticket = await authApi.issueTicket(binding, preview.actionDigest, password);
        } catch (caught) {
          setResults([
            ...skipped,
            ...valid.map((item) => ({
              reviewId: item.target.reviewId,
              status: item.target.reviewId === target.reviewId ? 'TICKET_FAILED' : 'NOT_SUBMITTED',
              message:
                item.target.reviewId === target.reviewId
                  ? `签票失败：${formatApiError(caught)}`
                  : '本次尚未提交批准；已签票项也未提交。',
            })),
          ]);
          setError('本次签票未全部完成，未提交任何批准。请核对逐项结果后重新选择。');
          return;
        }
        items.push({
          reviewId: target.reviewId,
          slotId: slot.id,
          expectedVersion: review.version,
          comment: comment.trim() || undefined,
          confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
        });
      }
      setProgress(null);
      try {
        const response = await reviewApi.batchDecide('APPROVE', items);
        const finalResults = [
          ...skipped,
          ...valid.map(
            ({ target }) =>
              response.results.find((item) => item.reviewId === target.reviewId) ?? {
                reviewId: target.reviewId,
                status: 'UNKNOWN',
                message: '服务端响应缺少该项结果，请打开评审详情核实。',
              },
          ),
        ];
        setResults(finalResults);
        const applied = finalResults.filter((item) => item.status === 'APPLIED').length;
        onCompleted({ approved: applied, failed: finalResults.length - applied });
      } catch (caught) {
        setResults([
          ...skipped,
          ...valid.map(({ target }) => ({
            reviewId: target.reviewId,
            status: 'UNKNOWN',
            message: '提交结果未确认，请打开该评审详情核实后再决定是否重试。',
          })),
        ]);
        setError(`批量请求未取得可确认结果：${formatApiError(caught)}。请逐项核实，避免重复提交。`);
      }
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
      setChecking(false);
      setPassword('');
      setProgress(null);
    }
  }

  return (
    <Modal
      open={open}
      title="批量批准"
      description={`将对 ${targets.length} 条评审提交「批准」；每条仍需通过服务端版本与票据校验。`}
      busy={busy}
      onClose={onClose}
      footer={
        results ? (
          <button className="primary" onClick={onClose}>
            完成
          </button>
        ) : (
          <>
            <button className="ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void submit(Boolean(checks?.some((item) => item.reason)))}
              disabled={busy || Boolean(checks?.length && checks.every((item) => item.reason))}
            >
              {busy
                ? checking
                  ? '正在预检…'
                  : progress
                    ? `签票中 ${progress.current}/${progress.total}…`
                    : '提交中…'
                : checks?.some((item) => item.reason)
                  ? `仅批准可用的 ${checks.filter((item) => !item.reason).length} 条`
                  : '验证密码并批量批准'}
            </button>
          </>
        )
      }
    >
      {results ? (
        <div className="wm-batch-review-result">
          <p>
            已批准 {approved} 条 · 未批准或待核实 {failed} 条
          </p>
          {results.length > 0 && (
            <ul className="detail-list">
              {results.map((item) => (
                <li key={item.reviewId}>
                  {targets.find((target) => target.reviewId === item.reviewId)?.label ??
                    `评审 ${item.reviewId.slice(0, 8)}`}
                  ：{item.status === 'APPLIED' ? '批准已生效' : (item.message ?? item.status)}{' '}
                  <a href={reviewPath(item.reviewId)}>打开评审核实</a>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="wm-batch-review" aria-busy={busy}>
          {busy && (
            <InlineLoading
              label={
                checking
                  ? '正在核对所选评审的当前状态、版本和签字资格…'
                  : progress
                    ? `正在逐条签票并提交（${progress.current}/${progress.total}）…`
                    : '正在提交批量批准…'
              }
            />
          )}
          <ul className="detail-list">
            {targets.map((target) => (
              <li key={target.reviewId}>{target.label}</li>
            ))}
          </ul>
          {checks?.some((item) => item.reason) && (
            <ul className="detail-list" aria-label="逐项预检结果">
              {checks.map((item) => (
                <li key={item.target.reviewId}>
                  {item.target.label}：{item.reason ?? '当前可提交；提交前仍由服务端再次校验。'}
                  {item.reason && (
                    <>
                      {' '}
                      <a href={reviewPath(item.target.reviewId)}>打开评审检查</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="form-grid">
            <label className="field">
              <span>给交付方的说明（可选，所有条目共用）</span>
              <textarea
                value={comment}
                rows={2}
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="例如：证据齐全，统一批准。"
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>登录密码（用于为每条评审签发一次性票据）</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
