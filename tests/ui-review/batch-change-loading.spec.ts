import { expect, test, type Page } from '@playwright/test';
import type { WorkbenchChangeItem, WorkbenchSnapshot } from '../../apps/web/src/api/resources';
import { installReviewFixtures, projects } from './fixtures';

// Browser fixtures exercise the production UI contract, not real API writes.
function isBatchChangeModule(url: URL) {
  return (
    /^\/assets\/BatchChangeAcknowledge-[^/]+\.js$/.test(url.pathname) ||
    url.pathname === '/src/components/BatchChangeAcknowledge.tsx'
  );
}

function latch() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  return { ready, release };
}

async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function change(index: number, version = index): WorkbenchChangeItem {
  return {
    recipientId: `batch-recipient-${index}`,
    eventId: `batch-event-${index}`,
    projectId: 'p1',
    projectKey: projects[0]!.key,
    projectName: projects[0]!.name,
    requirement: { code: `BATCH-00${index}`, title: `批量变更 ${index}` },
    changedFields: ['description'],
    targets: { taskIds: [`batch-task-${index}`] },
    pendingRoles: [{ key: 'backend', title: '后端' }],
    version,
    createdAt: '2026-11-10T00:00:00.000Z',
    ageSeconds: 100 - index,
  };
}

interface AckCall {
  recipientId: string;
  expectedVersion: number;
}

interface BatchFixtureState {
  changes: WorkbenchChangeItem[];
  failWorkbench: boolean;
  writes: AckCall[];
}

type AckReply = { status: number; code: string; message: string } | undefined;

async function installBatchFixtures(
  page: Page,
  changes = [change(1), change(2), change(3)],
  acknowledge?: (call: AckCall, state: BatchFixtureState) => AckReply | Promise<AckReply>,
) {
  await installReviewFixtures(page);
  const state: BatchFixtureState = { changes, failWorkbench: false, writes: [] };
  await page.route('**/api/v1/workbench**', (route) => {
    expect(route.request().method()).toBe('GET');
    if (state.failWorkbench)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'TEMPORARY', message: '批量确认后的快照暂时不可读' } },
      });
    const data: WorkbenchSnapshot = {
      counts: {
        reviews: 0,
        changes: state.changes.length,
        readyTasks: 0,
        total: state.changes.length,
      },
      reviews: [],
      changes: state.changes,
      readyTasks: [],
      overdueApprovals: [],
      warnings: [],
    };
    return route.fulfill({ json: { data, meta: { requestId: 'batch-change-snapshot-fixture' } } });
  });
  await page.route('**/api/v1/change-recipients/*/ack', async (route) => {
    const request = route.request();
    expect(request.method()).toBe('POST');
    expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
    expect(request.headers()['idempotency-key']).toBeTruthy();
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['expectedVersion']);
    expect(typeof body.expectedVersion).toBe('number');
    const call = {
      recipientId: new URL(request.url()).pathname.split('/').at(-2)!,
      expectedVersion: body.expectedVersion as number,
    };
    state.writes.push(call);
    const failure = await acknowledge?.(call, state);
    return failure
      ? route.fulfill({
          status: failure.status,
          json: {
            error: {
              code: failure.code,
              message: failure.message,
              requestId: 'batch-change-write-fixture',
            },
          },
        })
      : route.fulfill({ json: { data: {}, meta: { requestId: 'batch-change-write-fixture' } } });
  });
  return state;
}

async function selectChanges(page: Page, changes: WorkbenchChangeItem[]) {
  for (const item of changes) {
    await page
      .getByRole('checkbox', {
        name: `选择变更 ${item.requirement!.code} · ${item.requirement!.title}`,
        exact: true,
      })
      .check();
  }
  return page.getByRole('button', { name: `批量确认 ${changes.length} 条`, exact: true });
}

for (const width of [1440, 390]) {
  test(`${width}px 批量确认仅在点击时下载，慢加载关闭后迟到脚本不重开窗口`, async ({ page }) => {
    const state = await installBatchFixtures(page);
    const download = latch();
    let moduleRequests = 0;
    await page.route(isBatchChangeModule, async (route) => {
      moduleRequests += 1;
      await download.ready;
      await route.continue();
    });
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/?type=changes');
      await expect(page.locator('.wb-workspace')).toBeVisible();
      const opener = await selectChanges(page, state.changes);
      expect(moduleRequests).toBe(0);
      await opener.click();
      const dialog = page.getByRole('dialog', { name: '批量确认变更', exact: true });
      const close = dialog.getByRole('button', { name: '关闭弹窗', exact: true });
      await expect(dialog.getByRole('status')).toHaveText('正在加载批量确认变更…');
      await expect.poll(() => moduleRequests).toBe(1);
      await expect(close).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      const response = page.waitForResponse((value) => isBatchChangeModule(new URL(value.url())));
      download.release();
      await (await response).finished();
      await afterBrowserPaint(page);
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(state.writes).toHaveLength(0);
      await opener.click();
      await expect(dialog.getByRole('list', { name: '待提交变更列表' }).locator('li')).toHaveCount(
        3,
      );
      expect(moduleRequests).toBe(1);
      await close.click();
      await expect(dialog).toHaveCount(0);
      await expect(opener).toBeFocused();
      expect(state.writes).toHaveLength(0);
    } finally {
      download.release();
    }
  });
}

test('批量确认脚本失败保留工作台，显式重试诚实失败并可刷新恢复', async ({ page }) => {
  const state = await installBatchFixtures(page);
  let failModule = true;
  let moduleRequests = 0;
  await page.route(isBatchChangeModule, (route) => {
    moduleRequests += 1;
    return failModule ? route.abort('failed') : route.continue();
  });
  await page.goto('/?type=changes');
  await expect(page.locator('.wb-workspace')).toBeVisible();
  const opener = await selectChanges(page, state.changes);
  expect(moduleRequests).toBe(0);
  await opener.click();
  const dialog = page.getByRole('dialog', { name: '批量确认变更', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('无法加载此窗口');
  const retry = dialog.getByRole('button', { name: '重试加载', exact: true });
  const refresh = dialog.getByRole('button', { name: '刷新页面', exact: true });
  await expect(retry).toBeEnabled();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('.wb-workspace')).toBeVisible();
  // Native dynamic-import failures can remain cached. Local retry must remain usable
  // and report failure honestly; a page reload provides the independent recovery path.
  await retry.click();
  await expect(dialog.getByRole('alert')).toContainText('无法加载此窗口');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(dialog.getByRole('alert')).toContainText('无法加载此窗口');
  failModule = false;
  const beforeReload = moduleRequests;
  await Promise.all([page.waitForEvent('load'), refresh.click()]);
  await expect(page.locator('.wb-workspace')).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(moduleRequests).toBe(beforeReload);
  await (await selectChanges(page, state.changes)).click();
  await expect(dialog.getByRole('list', { name: '待提交变更列表' }).locator('li')).toHaveCount(3);
  expect(moduleRequests).toBeGreaterThan(beforeReload);
  expect(state.writes).toHaveLength(0);
});

for (const width of [1440, 390]) {
  test(`${width}px 批量确认逐条首错停止，重试使用新版本且保留刷新失败后的成功结果`, async ({
    page,
  }) => {
    const firstWrite = latch();
    const lastRetryWrite = latch();
    const state = await installBatchFixtures(
      page,
      [change(1), change(2), change(3), change(4)],
      async (call, current) => {
        if (call.recipientId === 'batch-recipient-1') await firstWrite.ready;
        if (call.recipientId === 'batch-recipient-2' && call.expectedVersion === 2) {
          current.changes = [change(2, 20), change(3, 30)];
          return { status: 409, code: 'VERSION_CONFLICT', message: '变更版本已更新' };
        }
        if (call.recipientId === 'batch-recipient-3') {
          await lastRetryWrite.ready;
          current.failWorkbench = true;
        }
        return undefined;
      },
    );
    try {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/?type=changes');
      await (await selectChanges(page, state.changes)).click();
      await page.getByRole('button', { name: '确认开始', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '批量确认结果', exact: true });
      await expect
        .poll(() => state.writes)
        .toEqual([{ recipientId: 'batch-recipient-1', expectedVersion: 1 }]);
      await expect(dialog).toContainText('正在处理 1 / 4');
      firstWrite.release();
      await expect(dialog).toContainText('已确认 1 条 · 失败 1 条 · 未处理 2 条');
      const results = dialog.getByRole('list', { name: '批量确认结果', exact: true });
      await expect(results.locator('li').filter({ hasText: 'BATCH-002' })).toContainText(
        '数据已变化，请重新加载',
      );
      await expect(results.locator('li').filter({ hasText: 'BATCH-004' })).toContainText(
        '已不在当前列表中',
      );
      expect(state.writes).toEqual([
        { recipientId: 'batch-recipient-1', expectedVersion: 1 },
        { recipientId: 'batch-recipient-2', expectedVersion: 2 },
      ]);
      const retry = dialog.getByRole('button', { name: '重试失败项（2）', exact: true });
      await expect(retry).toBeEnabled();
      await retry.click();
      await expect
        .poll(() => state.writes)
        .toEqual([
          { recipientId: 'batch-recipient-1', expectedVersion: 1 },
          { recipientId: 'batch-recipient-2', expectedVersion: 2 },
          { recipientId: 'batch-recipient-2', expectedVersion: 20 },
          { recipientId: 'batch-recipient-3', expectedVersion: 30 },
        ]);
      await expect(dialog).toContainText('正在处理 2 / 2');
      await expect(results.locator('li').filter({ hasText: 'BATCH-001' })).toContainText('已确认');
      await expect(results.locator('li').filter({ hasText: 'BATCH-001' })).not.toContainText(
        '处理中',
      );
      await expect(results.locator('li').filter({ hasText: 'BATCH-002' })).toContainText(
        'v20 · 已确认',
      );
      await expect(results.locator('li').filter({ hasText: 'BATCH-003' })).toContainText(
        'v30 · 处理中',
      );
      lastRetryWrite.release();
      await expect(dialog).toContainText('已确认 3 条 · 失败 0 条 · 未处理 0 条');
      await expect(dialog.getByRole('alert')).toHaveText(
        '批量确认已完成，但刷新工作台失败；当前显示的是上次成功的数据。',
      );
      await expect(results.locator('li')).toHaveCount(3);
      await expect(dialog.getByRole('button', { name: /^重试失败项/ })).toHaveCount(0);
      const stale = page.getByRole('status', { name: /^当前显示的是上次成功数据/ });
      await expect(stale).toBeVisible();
      await afterBrowserPaint(page);
      await expect(results.locator('li')).toHaveCount(3);
      expect(state.writes).toHaveLength(4);
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      state.failWorkbench = false;
      state.changes = [];
      await stale.getByRole('button', { name: '重试更新工作台数据', exact: true }).click();
      await expect(stale).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: /^选择变更/ })).toHaveCount(0);
      expect(state.writes).toHaveLength(4);
      expect(state.writes.some((call) => call.recipientId === 'batch-recipient-4')).toBe(false);
      expect(state.writes.filter((call) => call.recipientId === 'batch-recipient-1')).toHaveLength(
        1,
      );
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);
    } finally {
      firstWrite.release();
      lastRetryWrite.release();
    }
  });
}

test('批量提交同步防重，忙时按钮遮罩Escape均不能关闭，结束后恢复入口焦点', async ({ page }) => {
  const write = latch();
  const state = await installBatchFixtures(page, [change(1)], async () => {
    await write.ready;
    return { status: 503, code: 'TEMPORARY', message: '该变更暂未确认，请显式重试' };
  });
  try {
    await page.goto('/?type=changes');
    const opener = await selectChanges(page, state.changes);
    await opener.click();
    const start = page.getByRole('button', { name: '确认开始', exact: true });
    await start.evaluate((element: HTMLButtonElement) => {
      element.click();
      element.click();
    });
    const dialog = page.getByRole('dialog', { name: '批量确认结果', exact: true });
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog.getByRole('button', { name: '关闭弹窗', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '处理中…', exact: true })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: '项目范围', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.locator('.modal-layer').click({ position: { x: 4, y: 4 } });
    await expect(dialog).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
      .toBe(true);
    expect(state.writes).toHaveLength(1);
    write.release();
    await expect(dialog).toContainText('已确认 0 条 · 失败 1 条 · 未处理 0 条');
    await expect(dialog.getByText(/该变更暂未确认，请显式重试/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '关闭弹窗', exact: true })).toBeEnabled();
    await expect(
      dialog.getByRole('button', { name: '重试失败项（1）', exact: true }),
    ).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    const reopened = page.getByRole('dialog', { name: '批量确认变更', exact: true });
    await expect(reopened.getByRole('list', { name: '待提交变更列表' })).toBeVisible();
    await expect(reopened.getByRole('list', { name: '批量确认结果', exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    await reopened.getByRole('button', { name: '取消', exact: true }).click();
    await expect(opener).toBeFocused();
  } finally {
    write.release();
  }
});
