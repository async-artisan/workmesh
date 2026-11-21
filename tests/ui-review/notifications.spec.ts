import { expect, test, type Page } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

// Exercise both the normal dev config and the isolated production-preview config.
function isNotificationModule(url: URL) {
  return (
    /^\/assets\/NotificationPanel-[^/]+\.js$/.test(url.pathname) ||
    url.pathname === '/src/components/NotificationPanel.tsx'
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
  // Let the fulfilled fetch and its React update settle before checking a rejected old result.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

for (const width of [1440, 390]) {
  test(`${width}px 通知区分我的行动与审计，错误可恢复且保留项目上下文`, async ({ page }) => {
    await installReviewFixtures(page);
    let failActivity = false;
    await page.route('**/api/v1/activity?*', (route) =>
      failActivity
        ? route.fulfill({
            status: 503,
            json: { error: { code: 'TEMPORARY', message: '验收临时中断' } },
          })
        : route.fulfill({
            json: {
              data: {
                items: [
                  {
                    id: 'event-document',
                    projectId: 'p2',
                    projectName: '另一项目的知识文档',
                    action: 'KNOWLEDGE_DOCUMENT_CREATE',
                    targetType: 'KNOWLEDGE_DOCUMENT',
                    targetId: 'document-2',
                    targetVersion: 1,
                    outcome: 'OK',
                    details: null,
                    createdAt: '2026-11-09T00:00:00.000Z',
                    actor: null,
                  },
                  {
                    id: 'event-review',
                    projectId: 'p1',
                    projectName: '示例项目评审',
                    action: 'REVIEW_DECIDE',
                    targetType: 'REVIEW_REQUEST',
                    targetId: 'review-1',
                    targetVersion: 1,
                    outcome: 'OK',
                    details: null,
                    createdAt: '2026-11-09T00:00:00.000Z',
                    actor: null,
                  },
                ],
              },
              meta: { requestId: 'notification-browser' },
            },
          }),
    );
    await page.setViewportSize({ width, height: 850 });
    await page.goto('/projects');
    const bell = page.getByRole('button', { name: /^通知：/ });
    await expect(bell).toHaveAttribute('aria-label', '通知：2 件我的待办，2 条未读活动');
    failActivity = true;
    await bell.click();
    const dialog = page.getByRole('dialog', { name: '通知中心' });
    await expect(dialog.getByRole('heading', { name: '我的待办' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '我可领取 1' })).toBeVisible();
    await expect(dialog.getByText(/审计活动未能更新/)).toBeVisible();
    await expect(dialog.getByText('另一项目的知识文档')).toBeVisible();
    await expect(dialog.getByText('暂无审计事件。')).toHaveCount(0);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
      true,
    );
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    failActivity = false;
    await dialog.getByRole('button', { name: '重试活动' }).click();
    await expect(dialog.getByText(/审计活动未能更新/)).toHaveCount(0);
    await dialog.getByRole('button', { name: '将当前活动标为已读' }).click();
    await expect(bell).toHaveAttribute('aria-label', '通知：2 件我的待办');
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('workmesh.activity.seen.v2.fixture-user') ?? '[]'),
      ),
    ).toEqual(['event-document', 'event-review']);
    await page.keyboard.press('Escape');
    await expect(bell).toBeFocused();
    await bell.click();
    await dialog.getByRole('button', { name: /打开项目知识库/ }).click();
    await expect(page).toHaveURL(/\/knowledge\?projectId=p2$/);
  });
}

for (const closeWhileLoading of [false, true]) {
  test(`通知内容只在打开时下载，慢加载${closeWhileLoading ? '关闭后不重开' : '保留焦点与键盘操作'}`, async ({
    page,
  }) => {
    await installReviewFixtures(page);
    const download = latch();
    let moduleRequests = 0;
    await page.route(isNotificationModule, async (route) => {
      moduleRequests += 1;
      await download.ready;
      await route.continue();
    });
    try {
      await page.goto('/');
      await expect(page.locator('.wb-workspace')).toBeVisible();
      const bell = page.getByRole('button', { name: /^通知：/ });
      await expect(bell).toHaveAttribute('aria-label', '通知：2 件我的待办');
      expect(moduleRequests).toBe(0);
      await bell.click();
      const dialog = page.getByRole('dialog', { name: '通知中心', exact: true });
      const close = dialog.getByRole('button', { name: '关闭通知', exact: true });
      await expect(dialog.getByRole('status')).toHaveText('正在加载通知内容…');
      await expect.poll(() => moduleRequests).toBe(1);
      await expect(close).toBeFocused();
      // With no unread activity, the close button is the only enabled shell control.
      await page.keyboard.press('Tab');
      await expect(close).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(close).toBeFocused();
      if (closeWhileLoading) {
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(bell).toBeFocused();
      }
      const response = page.waitForResponse((value) => isNotificationModule(new URL(value.url())));
      download.release();
      await (await response).finished();
      await afterBrowserPaint(page);
      if (closeWhileLoading) {
        await expect(dialog).toHaveCount(0);
        await expect(bell).toBeFocused();
        await bell.click();
      }
      await expect(dialog.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '我可领取 1', exact: true })).toBeVisible();
      await expect(close).toBeFocused();
      expect(moduleRequests).toBe(1);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(bell).toBeFocused();
    } finally {
      download.release();
    }
  });
}

test('通知脚本失败保留工作台与键盘关闭，重试和刷新提供恢复入口', async ({ page }) => {
  await installReviewFixtures(page);
  let failModule = true;
  let moduleRequests = 0;
  await page.route(isNotificationModule, (route) => {
    moduleRequests += 1;
    return failModule ? route.abort('failed') : route.continue();
  });
  await page.goto('/');
  await expect(page.locator('.wb-workspace')).toBeVisible();
  const bell = page.getByRole('button', { name: /^通知：/ });
  await expect(bell).toHaveAttribute('aria-label', '通知：2 件我的待办');
  expect(moduleRequests).toBe(0);
  await bell.click();
  const dialog = page.getByRole('dialog', { name: '通知中心', exact: true });
  const close = dialog.getByRole('button', { name: '关闭通知', exact: true });
  const retry = dialog.getByRole('button', { name: '重试加载', exact: true });
  const refresh = dialog.getByRole('button', { name: '刷新页面', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('无法加载通知内容');
  await expect(retry).toBeEnabled();
  await expect(refresh).toBeEnabled();
  await expect(page.locator('.wb-workspace')).toBeVisible();
  await refresh.focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(refresh).toBeFocused();
  // A native import failure may remain cached by the browser. Verify that local retry
  // is usable and fails honestly while the network is still unavailable, then reload.
  await retry.click();
  await expect(dialog.getByRole('alert')).toContainText('无法加载通知内容');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(bell).toBeFocused();
  await bell.click();
  await expect(dialog.getByRole('alert')).toContainText('无法加载通知内容');
  failModule = false;
  await Promise.all([page.waitForEvent('load'), refresh.click()]);
  await expect(page.locator('.wb-workspace')).toBeVisible();
  await expect(bell).toHaveAttribute('aria-label', '通知：2 件我的待办');
  await expect(dialog).toHaveCount(0);
  await bell.click();
  await expect(dialog.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
  expect(moduleRequests).toBeGreaterThanOrEqual(2);
});

test('邮件请求中关闭重开仍保持忙态，失败保留且显式重试后保留结果', async ({ page }) => {
  await installReviewFixtures(page);
  const firstDelivery = latch();
  let sends = 0;
  await page.route('**/api/v1/notifications/email-digest', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
    sends += 1;
    if (sends === 1) {
      await firstDelivery.ready;
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: 'TEMPORARY',
            message: '验收邮件临时中断',
            requestId: 'notification-mail-failure',
          },
        },
      });
    }
    return route.fulfill({
      json: {
        data: {
          sent: true,
          to: 'fixture@example.test',
          counts: { reviews: 1, changes: 0, readyTasks: 1, total: 2 },
        },
        meta: { requestId: 'notification-mail-success' },
      },
    });
  });
  try {
    await page.goto('/projects');
    const bell = page.getByRole('button', { name: /^通知：/ });
    await bell.click();
    const dialog = page.getByRole('dialog', { name: '通知中心', exact: true });
    await dialog.getByRole('button', { name: '发送邮件摘要', exact: true }).click();
    await expect.poll(() => sends).toBe(1);
    await expect(dialog.getByRole('button', { name: '发送中…', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(bell).toBeFocused();
    await bell.click();
    await expect(dialog.getByRole('button', { name: '发送中…', exact: true })).toBeDisabled();
    expect(sends).toBe(1);
    firstDelivery.release();
    await expect(dialog.getByText(/验收邮件临时中断/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: '发送邮件摘要', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await bell.click();
    await expect(dialog.getByText(/验收邮件临时中断/)).toBeVisible();
    expect(sends).toBe(1);
    await dialog.getByRole('button', { name: '发送邮件摘要', exact: true }).click();
    await expect(
      dialog.getByText('邮件摘要已发送到 fixture@example.test', { exact: true }),
    ).toBeVisible();
    expect(sends).toBe(2);
    await expect(dialog.getByText(/验收邮件临时中断/)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await bell.click();
    await expect(
      dialog.getByText('邮件摘要已发送到 fixture@example.test', { exact: true }),
    ).toBeVisible();
    expect(sends).toBe(2);
  } finally {
    firstDelivery.release();
  }
});

for (const oldRequestFails of [false, true]) {
  test(`重新登录其他账号后，旧邮件${oldRequestFails ? '失败' : '成功'}不覆盖新账号发送状态`, async ({
    page,
  }) => {
    await installReviewFixtures(page);
    const oldDelivery = latch();
    const newDelivery = latch();
    let sends = 0;
    let authenticated = true;
    let currentUser = { id: 'fixture-user', email: 'fixture@example.test' };
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({
        json: {
          data: {
            authenticated,
            csrfToken: 'fixture-csrf',
            user: authenticated ? currentUser : undefined,
            sessionId: `notification-session-${currentUser.id}`,
            expiresAt: '2026-12-01T00:00:00.000Z',
            idleExpiresAt: '2026-12-01T00:00:00.000Z',
          },
          meta: { requestId: 'notification-session' },
        },
      }),
    );
    await page.route('**/api/v1/auth/logout', (route) => {
      expect(route.request().method()).toBe('POST');
      authenticated = false;
      return route.fulfill({ json: { data: {}, meta: { requestId: 'notification-logout' } } });
    });
    await page.route('**/api/v1/auth/login', (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON().email).toBe('next@example.test');
      authenticated = true;
      currentUser = { id: 'fixture-next-user', email: 'next@example.test' };
      return route.fulfill({ json: { data: {}, meta: { requestId: 'notification-login' } } });
    });
    await page.route('**/api/v1/notifications/email-digest', async (route) => {
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['x-csrf-token']).toBe('fixture-csrf');
      sends += 1;
      const old = sends === 1;
      await (old ? oldDelivery.ready : newDelivery.ready);
      if (old && oldRequestFails)
        return route.fulfill({
          status: 503,
          json: {
            error: {
              code: 'TEMPORARY',
              message: '旧账号邮件失败',
              requestId: 'notification-old-mail-error',
            },
          },
        });
      return route.fulfill({
        json: {
          data: {
            sent: true,
            to: old ? 'fixture@example.test' : 'next@example.test',
            counts: { reviews: 1, changes: 0, readyTasks: 1, total: 2 },
          },
          meta: { requestId: old ? 'notification-old-mail' : 'notification-new-mail' },
        },
      });
    });
    try {
      await page.goto('/projects');
      const bell = page.getByRole('button', { name: /^通知：/ });
      await bell.click();
      const dialog = page.getByRole('dialog', { name: '通知中心', exact: true });
      await dialog.getByRole('button', { name: '发送邮件摘要', exact: true }).click();
      await expect.poll(() => sends).toBe(1);
      await expect(dialog.getByRole('button', { name: '发送中…', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await page
        .getByRole('button', { name: '账号菜单：fixture@example.test', exact: true })
        .click();
      await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
      await expect(page.getByRole('heading', { name: '登录工作台', exact: true })).toBeVisible();
      await page.getByLabel('邮箱', { exact: true }).fill('next@example.test');
      await page.getByLabel('密码', { exact: true }).fill('fixture-password');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await expect(
        page.getByRole('button', { name: '账号菜单：next@example.test', exact: true }),
      ).toBeVisible();
      await bell.click();
      await expect(dialog.getByRole('button', { name: '发送邮件摘要', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: '发送邮件摘要', exact: true }).click();
      await expect.poll(() => sends).toBe(2);
      await expect(dialog.getByRole('button', { name: '发送中…', exact: true })).toBeDisabled();
      const oldResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/notifications/email-digest' &&
          response.request().method() === 'POST',
      );
      oldDelivery.release();
      await (await oldResponse).finished();
      await afterBrowserPaint(page);
      await expect(dialog.getByRole('button', { name: '发送中…', exact: true })).toBeDisabled();
      await expect(dialog.getByText(/fixture@example\.test|旧账号邮件失败/)).toHaveCount(0);
      expect(sends).toBe(2);
      newDelivery.release();
      await expect(
        dialog.getByText('邮件摘要已发送到 next@example.test', { exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: '发送邮件摘要', exact: true })).toBeEnabled();
      await expect(dialog.getByText(/fixture@example\.test|旧账号邮件失败/)).toHaveCount(0);
    } finally {
      oldDelivery.release();
      newDelivery.release();
    }
  });
}
