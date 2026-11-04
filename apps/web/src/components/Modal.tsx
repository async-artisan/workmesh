import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: ModalSize;
  variant?: 'dialog' | 'drawer';
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]';

/**
 * 模块级图层栈（参考 Radix DismissableLayer）：每个打开的 Modal 在挂载时入栈、卸载时出栈，
 * 最后入栈的实例才是栈顶。只有栈顶实例监听 document 的 keydown。
 *
 * 不能只靠 stopPropagation 解决嵌套：同一个 document 节点上的多个监听器互不影响，
 * 抽屉里再开一次性票据确认框时，按一次 Esc 会把两层一起关掉。
 */
const layerStack: symbol[] = [];
const layerObservers = new Set<() => void>();

function notifyLayerChange() {
  layerObservers.forEach((observer) => observer());
}

/**
 * 注册当前图层并返回它是否是栈顶。栈发生变化（新层打开 / 栈顶关闭）时通过 observer
 * 触发重渲染，让新栈顶重新挂上 document 监听，自然接管 Esc 与 Tab 焦点陷阱。
 */
function useIsHighestLayer(active: boolean): boolean {
  const [layerId] = useState(() => Symbol('modal-layer'));
  const [isHighest, setIsHighest] = useState(false);

  useEffect(() => {
    if (!active) {
      setIsHighest(false);
      return;
    }
    const sync = () => setIsHighest(layerStack[layerStack.length - 1] === layerId);
    layerStack.push(layerId);
    layerObservers.add(sync);
    // 新层入栈会让原栈顶让位；同理出栈后下一层在此接管。
    notifyLayerChange();
    return () => {
      layerObservers.delete(sync);
      const index = layerStack.indexOf(layerId);
      if (index >= 0) layerStack.splice(index, 1);
      notifyLayerChange();
    };
  }, [active, layerId]);

  return active && isHighest;
}

export function Modal({
  open,
  title,
  description,
  size = 'md',
  variant = 'dialog',
  onClose,
  children,
  footer,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  const isHighestLayer = useIsHighestLayer(open);

  // 父组件常传内联 onClose；只同步 ref，避免每次输入都重建 effect 导致焦点跳回第一个输入框
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const first = cardRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? cardRef.current)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  // 只有栈顶图层接管键盘：Esc 关闭自己、Tab 在自身卡片内循环。
  useEffect(() => {
    if (!open || !isHighestLayer) return;

    function onKeyDown(event: KeyboardEvent) {
      // IME 组词中按 Esc 是取消候选，不该关闭弹窗；keyCode 229 是旧输入法的组词标记。
      const legacyKeyCode = (event as KeyboardEvent & { keyCode?: number }).keyCode;
      if (event.isComposing || legacyKeyCode === 229) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
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

    // capture：先于页面/组件内部的冒泡处理器执行，避免冒泡顺序影响。
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [open, isHighestLayer]);

  if (!open) return null;

  return (
    <div
      className={`modal-layer${variant === 'drawer' ? ' is-drawer' : ''}`}
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`modal-card modal-${size}${variant === 'drawer' ? ' is-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={cardRef}
      >
        <header className="modal-head">
          <div>
            <h3 id={titleId}>{title}</h3>
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
  /** 底部的补充说明；默认按“删除”场景提示不可恢复。 */
  note?: string;
  /** 确认按钮语气：删除用 danger，普通确认用 primary。 */
  tone?: 'danger' | 'primary';
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  note = '删除后关联数据无法恢复。',
  tone = 'danger',
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
          <button className={tone} onClick={onConfirm} disabled={busy}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-note">{note}</p>
    </Modal>
  );
}
