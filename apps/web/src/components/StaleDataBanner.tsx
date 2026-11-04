import { useId } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';

/** 把 ISO 字符串或 Date 格式化为 HH:mm（本地时间）；非法输入返回 undefined。 */
export function formatUpdatedAtClock(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export interface StaleDataBannerProps {
  /** 上次成功加载数据的时间；支持 ISO 字符串或 Date。 */
  updatedAt?: string | Date;
  /** 过期原因说明；默认“本次更新失败，数据可能已经过期。” */
  message?: string;
  /** 标题前缀；默认“当前显示的是上次成功数据”。 */
  title?: string;
  /** 重试回调；提供后才渲染重试按钮。 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 重试按钮的可访问名称；默认“重试更新数据”。 */
  retryAriaLabel?: string;
  className?: string;
}

/**
 * 数据过期提示：页面保留上一次成功数据但本次刷新失败时使用。
 *
 * 语义边界：
 * - 这不是错误红色：页面仍可阅读、可操作，只是数据可能过期；
 * - 也不代表“已同步 / 已连接”：API 连接可用、页面服务可用、业务数据已同步是
 *   三件不同的事，本组件只说明业务数据的新鲜度；
 * - 使用 role="status" 而非 role="alert"，避免打断屏幕阅读器当前阅读。
 */
export function StaleDataBanner({
  updatedAt,
  message = '本次更新失败，数据可能已经过期。',
  title = '当前显示的是上次成功数据',
  onRetry,
  retryLabel = '重试',
  retryAriaLabel,
  className,
}: StaleDataBannerProps) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const messageId = `${autoId}-message`;
  const clock = formatUpdatedAtClock(updatedAt);

  return (
    <section
      className={`wm-stale-banner${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-labelledby={titleId}
      aria-describedby={messageId}
    >
      <TriangleAlert className="wm-stale-banner__icon" size={18} aria-hidden="true" />
      <div className="wm-stale-banner__body">
        <p className="wm-stale-banner__title" id={titleId}>
          {clock ? `${title} · ${clock}` : title}
        </p>
        <p className="wm-stale-banner__message" id={messageId}>
          {message}
        </p>
      </div>
      {onRetry && (
        <button
          type="button"
          className="wm-button wm-button--warning"
          onClick={onRetry}
          aria-label={retryAriaLabel ?? (retryLabel === '重试' ? '重试更新数据' : retryLabel)}
        >
          <RefreshCw size={14} aria-hidden="true" />
          {retryLabel}
        </button>
      )}
    </section>
  );
}
