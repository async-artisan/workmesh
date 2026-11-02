import { useEffect, useState, type ReactNode } from 'react';
import {
  authApi,
  type ActionBindingInput,
  type ActionPreviewView,
  type ConfirmationTicketView,
} from '../api/auth';
import { formatApiError } from '../api/client';
import type { Confirmation } from '../api/resources';
import { Modal } from './Modal';

export interface ConfirmationPromptProps {
  open: boolean;
  title: string;
  description?: string;
  binding: ActionBindingInput | null;
  submitLabel?: string;
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
  children,
  onClose,
  onConfirmed,
}: ConfirmationPromptProps) {
  const [preview, setPreview] = useState<ActionPreviewView | null>(null);
  const [ticket, setTicket] = useState<ConfirmationTicketView | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 绑定对象由页面内联构造，每次渲染都是新引用；用内容键避免预览 effect 反复重跑。
  const bindingKey = binding ? JSON.stringify(binding) : '';
  useEffect(() => {
    if (!open || !binding) return;
    let alive = true;
    setPreview(null);
    setTicket(null);
    setPassword('');
    setError('');
    authApi
      .preview(binding)
      .then((value) => {
        if (alive) setPreview(value);
      })
      .catch((caught: unknown) => {
        if (alive) setError(formatApiError(caught));
      });
    return () => {
      alive = false;
    };
  }, [open, bindingKey]);

  async function issueTicket() {
    if (!preview || !binding) return;
    setBusy(true);
    setError('');
    try {
      const issued = await authApi.issueTicket(binding, preview.actionDigest, password);
      setTicket(issued);
      setPassword('');
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!ticket) return;
    setBusy(true);
    setError('');
    try {
      await onConfirmed({ ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret });
      onClose();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      size="md"
      onClose={onClose}
      footer={
        ticket ? (
          <>
            <button className="ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button className="primary" onClick={() => void execute()} disabled={busy}>
              {busy ? '提交中…' : submitLabel}
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
              disabled={busy || !password}
            >
              {busy ? '校验中…' : '验证密码并签发票据'}
            </button>
          </>
        )
      }
    >
      <div className="form-grid">
        {children}
        {error && (
          <p className="modal-error" role="alert">
            {error}
          </p>
        )}
        {!preview && !error && <p className="modal-note">正在读取服务端动作预览…</p>}
        {preview && (
          <>
            <dl className="signoff-meta">
              <div>
                <dt>动作</dt>
                <dd>{preview.display.action}</dd>
              </div>
              <div>
                <dt>目标</dt>
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
            {ticket ? (
              <p className="confirm-banner">
                票据已签发，单次有效，截止 {new Date(ticket.expiresAt).toLocaleString('zh-CN')}。
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
                <small>密码只用于签发一次性票据；票据绑定当前动作摘要与版本。</small>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
