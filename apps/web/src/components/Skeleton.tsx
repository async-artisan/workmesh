import type { ReactNode } from 'react';

/**
 * 加载反馈的公共积木：页面、列表、弹窗、抽屉都用这一组，避免各处自造转圈或空白。
 *
 * 约定（与 docs/design/ui-foundations.md §3 一致）：
 * - 首次加载且没有可展示数据时：表格用 `TableSkeletonRows`，卡片/正文用 `PageState` 或
 *   `SkeletonLines`，绝对不要先渲染「还没有数据」的空态；
 * - 已有数据时的刷新/追加：保留现有数据，用 `InlineLoading` 或按钮的「加载中…」文案；
 * - 装饰性骨架对读屏隐藏（aria-hidden），可读状态由 `InlineLoading` / `PageState` 的
 *   `role="status"` + `aria-busy="true"` 承担；不要只靠动画表达加载。
 */

export interface SkeletonLinesProps {
  /** 骨架行数，默认 3。 */
  lines?: number;
  className?: string;
}

/** 卡片 / 正文区域的装饰骨架。容器需要自己包 role="status" + aria-busy。 */
export function SkeletonLines({ lines = 3, className }: SkeletonLinesProps) {
  return (
    <div className={`wm-skeleton-lines${className ? ` ${className}` : ''}`} aria-hidden="true">
      {Array.from({ length: Math.max(1, lines) }, (_, index) => (
        <div
          className={`skeleton-line${index === Math.max(1, lines) - 1 && lines > 1 ? ' short' : ''}`}
          key={index}
        />
      ))}
    </div>
  );
}

export interface TableSkeletonRowsProps {
  /** 占位行数，默认 5。 */
  rows?: number;
  /** 表格列数，用于 colSpan，默认 5。 */
  columns?: number;
  className?: string;
}

/**
 * 表格首次加载时的占位行：直接放进 `<tbody>`。
 * 空表格会先闪一下「暂无数据」，所以首屏加载必须用占位行顶住，而不是渲染空态。
 */
export function TableSkeletonRows({ rows = 5, columns = 5, className }: TableSkeletonRowsProps) {
  return (
    <>
      {Array.from({ length: Math.max(1, rows) }, (_, index) => (
        <tr
          className={`wm-skeleton-row${className ? ` ${className}` : ''}`}
          key={index}
          aria-hidden="true"
        >
          <td colSpan={Math.max(1, columns)}>
            <div className="skeleton-line" />
          </td>
        </tr>
      ))}
    </>
  );
}

export interface InlineLoadingProps {
  /** 可读文案，默认「正在加载…」。 */
  label?: string;
  className?: string;
  /** 追加在文案后的内容，例如数量或下一步说明。 */
  children?: ReactNode;
}

/** 一行内联加载提示：表格头、弹窗正文、抽屉正文、按钮旁都能用。 */
export function InlineLoading({ label = '正在加载…', className, children }: InlineLoadingProps) {
  return (
    <p
      className={`wm-inline-loading${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="wm-inline-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
      {children}
    </p>
  );
}
