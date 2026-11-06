import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  authApi,
  type ActionBindingInput,
  type ActionPreviewView,
  type ConfirmationTicketView,
} from '../api/auth';
import { formatApiError } from '../api/client';
import type { Confirmation } from '../api/resources';
import { ACTION_LABELS, labelFor, targetTypeLabel } from '../lib/labels';
import { formatDateTime } from '../lib/datetime';
import { DecisionSummary, type DecisionSummaryData } from './DecisionSummary';
import { Modal } from './Modal';
import { InlineLoading } from './Skeleton';

export interface ConfirmationPromptProps {
  open: boolean;
  title: string;
  description?: string;
  binding: ActionBindingInput | null;
  submitLabel?: string;
  /** 票据核验通过、执行最终写操作时的按钮忙文案（默认“提交中…”）。 */
  busyLabel?: string;
  /**
   * 业务决定摘要。评审决定等场景必须提供：密码输入前先展示用户实际提交的决定，
   * 技术摘要（actionDigest / 目标 / 期望版本）收进“查看技术详情”折叠区。
   */
  summary?: DecisionSummaryData;
  /** 业务目标名称（例如“PRD：供应商管理 · YFF-021”）；确认前先让人看清改的是哪一条。 */
  targetLabel?: string;
  /** 提交后的业务后果，逐条展示；不提供时只显示服务端动作预览。 */
  impact?: string[];
  /** 票据签发前填写的业务字段（例如撤销原因）。 */
  children?: ReactNode;
  onClose: () => void;
  /** 票据签发后才调用；业务请求必须把 expectedVersion 与 confirmation 一起提交。 */
  onConfirmed: (confirmation: Confirmation) => Promise<void>;
}

/**
 * 动作预览 + 密码二验 + 单次票据。服务端重新计算 actionDigest，客户端只展示与提交，
 * 任何 digest 变化、票据过期或权限拒绝都以 envelope 原样显示。
 */
export function ConfirmationPrompt({
  open,
  title,
  description,
  binding,
  submitLabel = '确认执行',
  busyLabel = '提交中…',
  summary,
  targetLabel,
  impact,
  children,
  onClose,
  onConfirmed,
}: ConfirmationPromptProps) {
  const [preview, setPreview] = useState<ActionPreviewView | null>(null);
  const [ticket, setTicket] = useState<ConfirmationTicketView | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(0);

  // 绑定对象由页面内联构造，每次渲染都是新引用；用内容键避免预览 effect 反复重跑。
  const bindingKey = binding ? JSON.stringify(binding) : '';
  useLayoutEffect(() => {
    const session = ++sessionRef.current;
    setPreview(null);
    setTicket(null);
    setPassword('');
    setBusy(false);
    setError('');
    if (open && binding) {
      authApi
        .preview(binding)
        .then((value) => {
          if (sessionRef.current === session) setPreview(value);
        })
        .catch((caught: unknown) => {
          if (sessionRef.current === session) setError(formatApiError(caught));
        });
    }
    return () => {
      // Invalidate the old session before any later promise continuation can run.
      sessionRef.current += 1;
    };
  }, [open, bindingKey]);

  async function issueTicket() {
    if (!open || !preview || !binding) return;
    const session = sessionRef.current;
    setBusy(true);
    setError('');
    try {
      const issued = await authApi.issueTicket(binding, preview.actionDigest, password);
      if (sessionRef.current === session) {
        setTicket(issued);
        setPassword('');
      }
    } catch (caught) {
      if (sessionRef.current === session) setError(formatApiError(caught));
    } finally {
      if (sessionRef.current === session) setBusy(false);
    }
  }

  async function execute() {
    if (!open || !ticket) return;
    const session = sessionRef.current;
    setBusy(true);
    setError('');
    try {
      await onConfirmed({ ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret });
      if (sessionRef.current === session) onClose();
    } catch (caught) {
      if (sessionRef.current === session) setError(formatApiError(caught));
    } finally {
      if (sessionRef.current === session) setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      size="md"
      busy={busy}
      onClose={onClose}
      footer={
        ticket ? (
          <>
            <button className="ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="primary" onClick={() => void execute()} disabled={busy}>
              {busy ? busyLabel : submitLabel}
            </button>
          </>
        ) : (
          <>
            <button className="ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              className="primary"
              onClick={() => void issueTicket()}
              disabled={busy || !preview || !password}
            >
              {busy ? '校验中…' : preview ? '验证密码并签发票据' : '读取动作预览中…'}
            </button>
          </>
        )
      }
    >
      <div className="form-grid">
        {summary && <DecisionSummary summary={summary} />}
        {children}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        {!preview &&
          !error &&
          (binding ? (
            <InlineLoading label="正在读取服务端动作预览…" />
          ) : (
            <p className="modal-note">确认内容还没有就绪。</p>
          ))}
        {preview && (
          <>
            {!summary && (
              <dl className="signoff-meta">
                <div>
                  <dt>动作</dt>
                  <dd>{labelFor(ACTION_LABELS, preview.display.action)}</dd>
                </div>
                <div>
                  <dt>目标</dt>
                  <dd>{targetLabel ?? targetTypeLabel(preview.display.targetType)}</dd>
                </div>
                <div>
                  <dt>期望版本</dt>
                  <dd>v{preview.display.expectedVersion}</dd>
                </div>
              </dl>
            )}
            {impact && impact.length > 0 && (
              <div className="confirm-impact">
                <p>提交后会发生</p>
                <ul>
                  {impact.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="wm-decision-technical">
              <summary>查看技术详情</summary>
              <dl className="signoff-meta">
                <div>
                  <dt>动作码</dt>
                  <dd>{preview.display.action}</dd>
                </div>
                <div>
                  <dt>目标标识</dt>
                  <dd className="cell-mono">
                    {preview.display.targetType} · {preview.display.targetId}
                  </dd>
                </div>
                <div>
                  <dt>期望版本</dt>
                  <dd>v{preview.display.expectedVersion}</dd>
                </div>
                <div>
                  <dt>动作摘要</dt>
                  <dd className="cell-mono" data-testid="action-digest">
                    {preview.actionDigest}
                  </dd>
                </div>
              </dl>
            </details>
            {ticket ? (
              <p className="confirm-banner">
                票据已签发，单次有效，截止 {formatDateTime(ticket.expiresAt)}。
                执行前如目标版本或内容变化，服务端仍会拒绝。
              </p>
            ) : (
              <div className="field">
                <span>确认密码（二次验证）</span>
                <input
                  type="password"
                  aria-label="确认密码"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
                <small>
                  {summary
                    ? '确认后会提交上述决定；密码只用于签发一次性票据，票据绑定当前动作摘要与版本。'
                    : '密码只用于签发一次性票据；票据绑定当前动作摘要与版本。'}
                </small>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
