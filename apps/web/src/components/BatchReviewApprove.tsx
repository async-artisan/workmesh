import { useEffect, useState } from 'react';
import { authApi } from '../api/auth';
import { formatApiError } from '../api/client';
import { reviewApi } from '../api/resources';
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
  /** 批量提交结束后调用（无论部分失败），用于刷新工作台与清空选择。 */
  onCompleted: (summary: BatchReviewSummary) => void;
}

interface BatchReviewResult {
  reviewId: string;
  status: string;
  message?: string;
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

  useEffect(() => {
    if (!open) return;
    setPassword('');
    setComment('');
    setBusy(false);
    setProgress(null);
    setError('');
    setResults(null);
  }, [open]);

  const approved = results?.filter((item) => item.status === 'APPLIED').length ?? 0;
  const failed = results ? results.length - approved : 0;

  async function submit() {
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
      const items: Array<{
        reviewId: string;
        slotId: string;
        expectedVersion: number;
        comment?: string;
        confirmation: { ticketId: string; ticketSecret: string };
      }> = [];
      for (const [index, target] of targets.entries()) {
        setProgress({ current: index + 1, total: targets.length });
        // 票据摘要绑定的是服务端当前 subjectDigest：先取最新评审，避免用快照里的旧摘要签票。
        const review = await reviewApi.get(target.reviewId);
        const slot = review.slots.find((candidate) => candidate.id === target.slotId);
        if (!slot) throw new Error('评审槽位已变化，请关闭后刷新工作台重试。');
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
        const preview = await authApi.preview(binding);
        const ticket = await authApi.issueTicket(binding, preview.actionDigest, password);
        items.push({
          reviewId: target.reviewId,
          slotId: slot.id,
          expectedVersion: review.version,
          comment: comment.trim() || undefined,
          confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
        });
      }
      setProgress({ current: targets.length, total: targets.length });
      const response = await reviewApi.batchDecide('APPROVE', items);
      setResults(response.results);
      const applied = response.results.filter((item) => item.status === 'APPLIED').length;
      onCompleted({ approved: applied, failed: response.results.length - applied });
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
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
            <button className="primary" onClick={() => void submit()} disabled={busy}>
              {busy
                ? progress
                  ? `签票中 ${progress.current}/${progress.total}…`
                  : '提交中…'
                : '验证密码并批量批准'}
            </button>
          </>
        )
      }
    >
      {results ? (
        <div className="wm-batch-review-result">
          <p>
            已批准 {approved} 条 · 失败 {failed} 条
          </p>
          {failed > 0 && (
            <ul className="detail-list">
              {results
                .filter((item) => item.status !== 'APPLIED')
                .map((item) => (
                  <li key={item.reviewId}>
                    评审 {item.reviewId.slice(0, 8)}：{item.message ?? item.status}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="wm-batch-review" aria-busy={busy}>
          {busy && (
            <InlineLoading
              label={
                progress
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
          <div className="form-grid">
            <label className="field">
              <span>给交付方的说明（可选，所有条目共用）</span>
              <textarea
                value={comment}
                rows={2}
                maxLength={2000}
                onChange={(event) => setComment(event.target.value)}
                placeholder="例如：证据齐全，统一批准。"
              />
            </label>
            <label className="field">
              <span>登录密码（用于为每条评审签发一次性票据）</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
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
