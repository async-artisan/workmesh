import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workbenchApi, type WorkbenchSnapshot } from '../api/resources';
import {
  getWorkbenchSnapshot,
  invalidateWorkbenchSnapshot,
  resetWorkbenchSnapshotCacheForTests,
} from './workbenchSnapshot';

const snapshot = (total: number) =>
  ({
    counts: { total },
    reviews: [],
    changes: [],
    readyTasks: [],
    warnings: [],
  }) as unknown as WorkbenchSnapshot;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
describe('工作台缓存的请求代次', () => {
  beforeEach(() => {
    resetWorkbenchSnapshotCacheForTests();
    vi.restoreAllMocks();
  });
  it('刷新请求较快时，旧请求不能覆盖当前缓存', async () => {
    const old = deferred<WorkbenchSnapshot>();
    const spy = vi
      .spyOn(workbenchApi, 'get')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(snapshot(2));
    const slow = getWorkbenchSnapshot('p1');
    await getWorkbenchSnapshot('p1', { force: true });
    old.resolve(snapshot(1));
    await slow;
    expect((await getWorkbenchSnapshot('p1')).counts.total).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('会话或项目缓存失效后，迟到请求不能重新填充缓存', async () => {
    const old = deferred<WorkbenchSnapshot>();
    const spy = vi
      .spyOn(workbenchApi, 'get')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(snapshot(3));
    const slow = getWorkbenchSnapshot('p1');
    invalidateWorkbenchSnapshot();
    old.resolve(snapshot(1));
    await slow;
    expect((await getWorkbenchSnapshot('p1')).counts.total).toBe(3);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
