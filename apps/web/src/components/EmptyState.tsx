import { useId, type ReactNode } from 'react';
import { Clock3, Inbox, SearchX, ShieldAlert } from 'lucide-react';

/**
 * 空态语义：不同原因必须给出不同说明与下一步，禁止只写“暂无数据”。
 *
 * - no-data：加载成功，但还没有数据（应提供创建入口）；
 * - no-access：当前账号无权限（说明需要谁开通权限）；
 * - no-match：有数据，但当前筛选条件无匹配（提示调整筛选）；
 * - waiting：暂时没有内容，等待异步处理或他人操作（说明在等什么）。
 */
export type EmptyStateVariant = 'no-data' | 'no-access' | 'no-match' | 'waiting';

const VARIANT_ICONS = {
  'no-data': Inbox,
  'no-access': ShieldAlert,
  'no-match': SearchX,
  waiting: Clock3,
} as const;

/** 没有操作入口时，必须说明在等待什么，而不是留给用户一个死胡同。 */
const VARIANT_DEFAULT_HINTS: Record<EmptyStateVariant, string> = {
  'no-data': '创建第一条记录后，这里会显示内容。',
  'no-access': '权限开通后，重新加载页面即可访问。',
  'no-match': '可以调整或清除筛选条件后重试。',
  waiting: '等待数据处理完成或他人完成操作后，这里会自动更新。',
};

export interface EmptyStateProps {
  /** 空态原因标题，例如“还没有可访问的项目”。 */
  title: string;
  /** 原因说明 + 下一步建议，例如“你可以创建项目，或通过邀请加入已有项目。” */
  description: string;
  /** 语义变体；影响图标、默认等待说明与视觉色调。 */
  variant?: EmptyStateVariant;
  /** 主操作按钮文案；与 onAction 同时提供才会渲染。 */
  actionLabel?: string;
  onAction?: () => void;
  /** 次操作按钮文案；与 onSecondaryAction 同时提供才会渲染。 */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** 自定义“等待什么”的说明；没有操作入口时默认使用变体说明。 */
  hint?: string;
  className?: string;
  /** 追加内容，例如帮助链接或筛选表单。 */
  children?: ReactNode;
}

/**
 * 统一空态组件。使用 role="status" 让屏幕阅读器读到完整原因与下一步，
 * 操作按钮带显式中文 aria-label，键盘可触发。
 */
export function EmptyState({
  title,
  description,
  variant = 'no-data',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  hint,
  className,
  children,
}: EmptyStateProps) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descriptionId = `${autoId}-description`;
  const Icon = VARIANT_ICONS[variant];
  const hasPrimary = Boolean(actionLabel && onAction);
  const hasSecondary = Boolean(secondaryActionLabel && onSecondaryAction);
  const hasActions = hasPrimary || hasSecondary;
  const hintText = hint ?? (hasActions ? undefined : VARIANT_DEFAULT_HINTS[variant]);

  return (
    <section
      className={`wm-empty-state${className ? ` ${className}` : ''}`}
      data-variant={variant}
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <span className="wm-empty-state__icon" aria-hidden="true">
        <Icon size={24} strokeWidth={1.75} />
      </span>
      <h3 className="wm-empty-state__title" id={titleId}>
        {title}
      </h3>
      <p className="wm-empty-state__description" id={descriptionId}>
        {description}
      </p>
      {hintText && <p className="wm-empty-state__hint">{hintText}</p>}
      {hasActions && (
        <div className="wm-empty-state__actions">
          {hasPrimary && (
            <button
              type="button"
              className="wm-button wm-button--primary"
              aria-label={actionLabel}
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
          {hasSecondary && (
            <button
              type="button"
              className="wm-button wm-button--secondary"
              aria-label={secondaryActionLabel}
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
