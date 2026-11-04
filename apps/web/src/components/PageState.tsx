import type { ReactNode } from 'react';
import { ApiError, formatApiError } from '../api/client';
import { EmptyState, type EmptyStateVariant } from './EmptyState';
import { ErrorState } from './ErrorState';
import { StaleDataBanner } from './StaleDataBanner';

/**
 * 页面加载状态：把“加载中 / 成功为空 / 失败 / 失败但保留旧数据 / 无权限”拆成
 * 互斥的 kind，页面不再用 boolean + string 自行拼装四五种语义。
 *
 * - loading：请求进行中；
 * - ready：成功且有数据（updatedAt 用于后续 freshness 展示）；
 * - empty：成功但无数据（不是错误）；
 * - error：请求失败且没有可展示数据；
 * - stale：请求失败但保留上次成功数据（页面仍可用，黄色警示）；
 * - forbidden：当前账号无权限（说明权限边界，不诱导重试）。
 */
export type PageLoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; updatedAt?: string }
  | { kind: 'empty' }
  | { kind: 'error'; message: string; detail?: string; requestId?: string }
  | { kind: 'stale'; message: string; updatedAt?: string }
  | { kind: 'forbidden'; message: string };

export interface PageStateAction {
  label: string;
  onClick: () => void;
}

export interface PageStateProps {
  state: PageLoadState;
  /** 覆盖默认标题（加载 / 空态 / 错误 / 无权限）。 */
  title?: string;
  /** 覆盖默认说明；错误态默认使用 state.message。 */
  description?: string;
  /** 空态的语义变体，默认 no-data。 */
  emptyVariant?: EmptyStateVariant;
  /** 可选主操作（空态 / 无权限 / 错误态的次操作）。 */
  action?: PageStateAction;
  /** 空态次操作。 */
  secondaryAction?: PageStateAction;
  /** 错误 / 过期状态的重试回调。 */
  onRetry?: () => void;
  retryLabel?: string;
  retryAriaLabel?: string;
  /** 加载态文案；默认“正在加载…”。 */
  loadingLabel?: string;
  /** ready / stale 状态下要展示的页面内容。 */
  children?: ReactNode;
  className?: string;
}

function actionProps(action: PageStateAction | undefined) {
  return action
    ? {
        actionLabel: action.label,
        onAction: action.onClick,
      }
    : {};
}

/**
 * 统一页面状态组件。页面只负责决定 kind，组件负责文案、可访问性、重试与配色；
 * 错误、空态、过期提示的外观与语义因此不会在每个页面各写一套。
 */
export function PageState({
  state,
  title,
  description,
  emptyVariant = 'no-data',
  action,
  secondaryAction,
  onRetry,
  retryLabel,
  retryAriaLabel,
  loadingLabel,
  children,
  className,
}: PageStateProps) {
  switch (state.kind) {
    case 'loading':
      return (
        <section
          className={`wm-page-state${className ? ` ${className}` : ''}`}
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <span className="wm-page-state__spinner" aria-hidden="true" />
          <p className="wm-page-state__title">{loadingLabel ?? title ?? '正在加载…'}</p>
          {description && <p className="wm-page-state__description">{description}</p>}
        </section>
      );

    case 'ready':
      return <>{children}</>;

    case 'empty':
      return (
        <EmptyState
          className={className}
          variant={emptyVariant}
          title={title ?? '页面已加载，但还没有可展示的内容'}
          description={
            description ?? '当前条件下没有记录。可以调整筛选条件，或先创建一条记录后再回来查看。'
          }
          {...actionProps(action)}
          secondaryActionLabel={secondaryAction?.label}
          onSecondaryAction={secondaryAction?.onClick}
        />
      );

    case 'error':
      return (
        <ErrorState
          className={className}
          title={title ?? '页面加载失败'}
          message={description ?? state.message}
          detail={state.detail}
          requestId={state.requestId}
          onRetry={onRetry}
          retryLabel={retryLabel}
          retryAriaLabel={retryAriaLabel}
          secondaryAction={action ? { label: action.label, onClick: action.onClick } : undefined}
        />
      );

    case 'forbidden':
      return (
        <EmptyState
          className={className}
          variant="no-access"
          title={title ?? '没有访问权限'}
          description={description ?? state.message}
          {...actionProps(action)}
        />
      );

    case 'stale':
      return (
        <>
          <StaleDataBanner
            className={className}
            updatedAt={state.updatedAt}
            message={description ?? state.message}
            onRetry={onRetry}
            retryLabel={retryLabel}
            retryAriaLabel={retryAriaLabel}
          />
          {children}
        </>
      );
  }
}

/**
 * 把 unknown 错误映射成页面状态，避免每个页面各自判断 403 / 网络错误：
 * - 403 → forbidden（权限边界，不诱导重试）；
 * - 其它 → error，保留 error code 与 requestId 供折叠查看。
 */
export function toPageLoadState(
  error: unknown,
  message = '暂时无法加载数据，请稍后重试。',
): PageLoadState {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const detail = formatApiError(error);
  if (error instanceof ApiError && error.status === 403) {
    return {
      kind: 'forbidden',
      message: '当前账号没有访问该内容的权限。如需访问，请联系项目管理员。',
    };
  }
  return { kind: 'error', message, detail, requestId };
}
