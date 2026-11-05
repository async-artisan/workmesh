import { useSyncExternalStore } from 'react';

/**
 * 窄屏检测：≤720px 时把数据表格降级为卡片列表。
 * 用 useSyncExternalStore 订阅 matchMedia，而不是在 effect 里 setState，避免首帧闪烁。
 * jsdom 没有 matchMedia 时按桌面渲染，既有测试与读屏结构不变。
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 720px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mediaQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
  mediaQuery.addEventListener('change', onChange);
  return () => mediaQuery.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
