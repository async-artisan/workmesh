import { useId } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';

export interface ErrorStateSecondaryAction {
  label: string;
  onClick: () => void;
}

export interface ErrorStateProps {
  /** 页面级错误标题，例如“项目加载失败”。 */
  title?: string;
  /** 用户可理解的错误说明；禁止只展示技术错误码。 */
  message: string;
  /** 技术细节（错误码、服务端 message 等），默认折叠。 */
  detail?: string;
  /** 请求追踪 ID，放在“查看详细信息”里，便于核对审计。 */
  requestId?: string;
  /** 重试回调；不提供时不渲染重试按钮。 */
  onRetry?: () => void;
  retryLabel?: string;
  /** 重试按钮的可访问名称；默认与 retryLabel 相同。 */
  retryAriaLabel?: string;
  /** 可选的次操作，例如“刷新页面”。 */
  secondaryAction?: ErrorStateSecondaryAction;
  className?: string;
}

/**
 * 页面级错误组件：请求失败不能显示成空数据，也不能只弹 Toast。
 * 用户先看到可理解的中文说明与重试入口，错误码 / requestId 收在
 * “查看详细信息”的折叠区域，不占据主要界面。
 */
export function ErrorState({
  title = '页面加载失败',
  message,
  detail,
  requestId,
  onRetry,
  retryLabel = '重试',
  retryAriaLabel,
  secondaryAction,
  className,
}: ErrorStateProps) {
  const autoId = useId();
  const titleId = `${autoId}-title`;
  const descriptionId = `${autoId}-description`;
  // formatApiError 的输出本身可能已包含 requestId；避免折叠区里重复出现两次。
  const detailText = detail?.trim() ?? '';
  const detailHasRequestId = Boolean(requestId && detailText.includes(requestId));
  const technical = [detailText, requestId && !detailHasRequestId ? `requestId: ${requestId}` : '']
    .filter((item): item is string => Boolean(item && item.trim()))
    .join('\n');

  return (
    <section
      className={`wm-error-state${className ? ` ${className}` : ''}`}
      role="alert"
      aria-live="assertive"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="wm-error-state__header">
        <CircleAlert className="wm-error-state__icon" size={20} aria-hidden="true" />
        <h3 className="wm-error-state__title" id={titleId}>
          {title}
        </h3>
      </div>
      <p className="wm-error-state__message" id={descriptionId}>
        {message}
      </p>
      {technical && (
        <details className="wm-error-state__details">
          <summary className="wm-error-state__summary">查看详细信息</summary>
          <pre className="wm-error-state__detail">{technical}</pre>
        </details>
      )}
      {(onRetry || secondaryAction) && (
        <div className="wm-error-state__actions">
          {onRetry && (
            <button
              type="button"
              className="wm-button wm-button--primary"
              onClick={onRetry}
              aria-label={retryAriaLabel ?? retryLabel}
            >
              <RefreshCw size={14} aria-hidden="true" />
              {retryLabel}
            </button>
          )}
          {secondaryAction && (
            <button
              type="button"
              className="wm-button wm-button--secondary"
              onClick={secondaryAction.onClick}
              aria-label={secondaryAction.label}
            >
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
