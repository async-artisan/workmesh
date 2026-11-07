import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

/**
 * 页面级权限夹具：成员/角色仍可读取，但知识库访问集合被服务端明确拒绝。
 * 这验证 ACL 页面不会把 403 当作空集合，也不会显示危险的替换入口。
 */
for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px ACL 403 显示权限边界并隐藏替换操作`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.route('**/api/v1/knowledge-bases/kb-1/access', async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: '当前账号没有读取该知识库访问集合的权限',
            requestId: 'ui-review-permission-403',
          },
        }),
      });
    });

    await page.goto('/roles?projectId=p1');
    const manageButton = page.getByRole('button', { name: '管理角色', exact: true }).first();
    await expect(manageButton).toBeVisible();
    await manageButton.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    expect(
      await drawer
        .locator('.role-manage-row small')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    expect(
      await drawer
        .locator('.role-manage-row strong')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(14);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(manageButton).toBeFocused();
    const readButton = page.getByRole('button', { name: '读取访问集合', exact: true });
    await expect(readButton).toBeVisible();
    await readButton.focus();
    await expect(readButton).toBeFocused();
    await page.keyboard.press('Enter');

    const alert = page.getByRole('alert').filter({ hasText: 'FORBIDDEN' });
    await expect(alert).toContainText('当前账号没有读取该知识库访问集合的权限');
    await expect(alert).toContainText('ui-review-permission-403');
    expect(
      await alert.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    await expect(page.getByRole('button', { name: '替换访问集合', exact: true })).toHaveCount(0);
    await expect(page.getByText('当前访问集合没有 grant。', { exact: true })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
  });
}
