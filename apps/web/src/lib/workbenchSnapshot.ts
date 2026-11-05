import { workbenchApi, type WorkbenchSnapshot } from '../api/resources';

/**
 * 工作台快照的共享缓存：顶部铃铛（App）、工作台页面、项目页待办列都读同一份 `/workbench`。
 * - 20s TTL 内复用，避免一次进入首页就发 2–3 个相同请求；
 * - 并发去重：同一 scope 同时只飞一个请求；
 * - force=true 时跳过缓存（用户点刷新、决定/批量操作之后）。
 */
const TTL_MS = 20_000;

interface CacheEntry {
  at: number;
  value: WorkbenchSnapshot;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<WorkbenchSnapshot>>();

function keyOf(scope?: string | null): string {
  return scope || '__all__';
}

export function getWorkbenchSnapshot(
  scope?: string | null,
  options: { force?: boolean } = {},
): Promise<WorkbenchSnapshot> {
  const key = keyOf(scope);
  const cached = cache.get(key);
  if (!options.force && cached && Date.now() - cached.at < TTL_MS) {
    return Promise.resolve(cached.value);
  }
  const existing = inflight.get(key);
  if (existing && !options.force) return existing;
  const request = workbenchApi
    .get(scope ?? null)
    .then((value) => {
      cache.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => {
      // 只有仍是当前在飞请求时才清理，避免 force 请求把新请求的登记删掉。
      if (inflight.get(key) === request) inflight.delete(key);
    });
  inflight.set(key, request);
  return request;
}

/** 会话/项目变化后让缓存失效；不传 scope 时清空全部。 */
export function invalidateWorkbenchSnapshot(scope?: string | null): void {
  if (scope === undefined) {
    cache.clear();
    return;
  }
  cache.delete(keyOf(scope));
}

/** 测试隔离：避免模块级缓存跨用例污染。 */
export function resetWorkbenchSnapshotCacheForTests(): void {
  cache.clear();
  inflight.clear();
}
