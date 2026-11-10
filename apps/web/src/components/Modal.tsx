import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type ModalSize = 'sm' | 'md' | 'lg';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  size?: ModalSize;
  variant?: 'dialog' | 'drawer';
  /**
   * 有异步提交在飞行中：锁定所有关闭入口（关闭按钮 / 遮罩点击 / Esc），
   * 避免提交进行中被误关丢失结果；卡片同时标记 aria-busy 供读屏感知。
   */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

const FOCUSABLE =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href]';

/**
 * 模块级图层栈（参考 Radix DismissableLayer）：每个打开的 Modal 在挂载时入栈、卸载时出栈，
 * 最后入栈的实例才是栈顶。keydown 发生时同步检查栈顶，避免异步更新监听资格。
 *
 * 不能只靠 stopPropagation 解决嵌套：同一个 document 节点上的多个监听器互不影响，
 * 抽屉里再开一次性票据确认框时，按一次 Esc 会把两层一起关掉。
 */
const layerStack: symbol[] = [];

/**
 * DOM 提交后、浏览器绘制前注册图层；键盘监听直接读取栈，关闭上层后下一层立即接管。
 * 不经由 state/effect 再挂监听，避免弹窗已可见但 Esc 仍会丢失的窗口。
 */
function useModalLayer(active: boolean): symbol {
  const [layerId] = useState(() => Symbol('modal-layer'));

  useLayoutEffect(() => {
    if (!active) return;
    layerStack.push(layerId);
    return () => {
      const index = layerStack.indexOf(layerId);
      if (index >= 0) layerStack.splice(index, 1);
    };
  }, [active, layerId]);

  return layerId;
}

export function Modal({
  open,
  title,
  description,
  size = 'md',
  variant = 'dialog',
  busy = false,
  onClose,
  children,
  footer,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  const layerId = useModalLayer(open);

  // 父组件常传内联 onClose；只同步 ref，避免每次输入都重建 effect 导致焦点跳回第一个输入框
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 初始焦点优先落在第一个可编辑控件（输入/下拉/文本域），没有表单字段时再退回第一个可聚焦元素。
    const card = cardRef.current;
    const firstEditable = card?.querySelector<HTMLElement>(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
    );
    const firstFocusable = card?.querySelector<HTMLElement>(FOCUSABLE);
    (firstEditable ?? firstFocusable ?? card)?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  // 只有栈顶图层接管键盘：Esc 关闭自己、Tab 在自身卡片内循环。
  useLayoutEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (layerStack[layerStack.length - 1] !== layerId) return;
      // IME 组词中按 Esc 是取消候选，不该关闭弹窗；keyCode 229 是旧输入法的组词标记。
      const legacyKeyCode = (event as KeyboardEvent & { keyCode?: number }).keyCode;
      if (event.isComposing || legacyKeyCode === 229) return;

      if (event.key === 'Escape') {
        // 提交进行中不允许关闭：否则用户既看不到结果，也可能在别处重复提交。
        if (busy) return;
        // 同一 document 上的下层监听也不能再处理这次 Esc，即使关闭同步更新了图层栈。
        event.stopImmediatePropagation();
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
  }, [open, layerId, busy]);

  if (!open) return null;

  return (
    <div
      className={`modal-layer${variant === 'drawer' ? ' is-drawer' : ''}`}
      role="presentation"
      onMouseDown={(e) => {
        // 提交进行中点击遮罩不关闭：与 Esc 保持一致，避免半途丢失结果。
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal-card modal-${size}${variant === 'drawer' ? ' is-drawer' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        ref={cardRef}
      >
        <header className="modal-head">
          <div>
            <h3 id={titleId}>{title}</h3>
            {description && (
              <p className="modal-desc" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="modal-close"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
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
      busy={busy}
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
