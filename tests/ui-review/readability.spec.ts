import { expect, test, type Locator, type Page } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

async function readable(locator: Locator) {
  await expect(locator).toBeVisible();
  const size = await locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);
}

async function noPageOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 工作台和业务元数据可读`, async ({ page }) => {
    test.setTimeout(60000);
    await installReviewFixtures(page);
    await page.setViewportSize({ width, height: 1000 });

    await page.goto('/');
    await readable(page.getByText('数据状态', { exact: true }));
    if (width >= 901) {
      await readable(page.locator('.console-label'));
      await readable(page.locator('.console-clock'));
    }
    await readable(page.locator('.rail-status'));
    await readable(page.locator('.rail-meta dd').first());
    await noPageOverflow(page);

    await page.goto('/requirements/DEMO-001?projectId=p1');
    await readable(page.locator('.gate-list-role').filter({ hasText: '产品' }).first());
    await readable(page.locator('.gate-list-state').first());
    await noPageOverflow(page);

    await page.goto('/reviews?projectId=p1');
    await readable(page.getByText('已显示 1 条', { exact: true }));
    await readable(page.getByText('已加载全部', { exact: true }));
    await noPageOverflow(page);

    await page.goto('/board?projectId=p1');
    await readable(page.locator('.board-toolbar-count'));
    await noPageOverflow(page);

    for (const route of ['/prd?projectId=p1', '/knowledge?projectId=p1']) {
      await page.goto(route);
      if (route.startsWith('/knowledge?')) {
        const metadata = page.locator('.collection-document-meta').first();
        const status = metadata.locator('.collection-document-status');
        await expect(status).toHaveText('当前生效 · v1');
        await readable(metadata);
        await readable(status);
      } else {
        await readable(page.locator('.task-row-meta').filter({ hasText: '已发布 v1' }).first());
      }
      await noPageOverflow(page);
    }

    await page.goto('/roles?projectId=p1');
    await readable(page.locator('.acl-kb-label'));
    await noPageOverflow(page);
  });
}
