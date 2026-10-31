import { useEffect, useRef, type ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: ModalSize;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]';

export function Modal({
  open,
  title,
  description,
  size = 'md',
  onClose,
  children,
  footer,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? cardRef.current)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !cardRef.current) return;
      const nodes = Array.from(cardRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const firstNode = nodes[0];
      const lastNode = nodes[nodes.length - 1];
      if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault();
        firstNode.focus();
      } else if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault();
        lastNode.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`modal-card modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        ref={cardRef}
      >
        <header className="modal-head">
          <div>
            <h3 id="modal-title">{title}</h3>
            {description && <p className="modal-desc">{description}</p>}
          </div>
          <button type="button" className="modal-close" aria-label="关闭弹窗" onClick={onClose}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = '确认删除',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button className="ghost" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="danger" onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-note">删除后关联数据无法恢复。</p>
    </Modal>
  );
}
