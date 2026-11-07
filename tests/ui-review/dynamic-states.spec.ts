import { expect, test } from '@playwright/test';
import { installReviewFixtures, projects, requirement, snapshot } from './fixtures';

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 工作台变更抽屉显示影响面并保持焦点`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.route('**/api/v1/workbench**', async (route) => {
      const payload = {
        ...snapshot,
        counts: { ...snapshot.counts, changes: 1, total: snapshot.counts.total + 1 },
        changes: [
          {
            recipientId: 'change-1',
            eventId: 'event-1',
            projectId: 'p1',
            projectKey: projects[0].key,
            projectName: projects[0].name,
            requirement: { code: requirement.code, title: requirement.title },
            changedFields: ['description', 'acceptance'],
            targets: { 角色: ['后端', '产品'], 版本: 'v3' },
            pendingRoles: [{ key: 'backend', title: '后端' }],
            version: 3,
            createdAt: '2026-11-05T12:00:00.000Z',
            ageSeconds: 3600,
          },
        ],
      };
      await route.fulfill({
        status: 200,
        json: { data: payload, meta: { requestId: 'ui-review-dynamic' } },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(page.getByRole('region', { name: '优先行动' })).toContainText('待确认变更 · 1');
    await page.getByRole('button', { name: '打开待确认变更', exact: true }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('变更字段');
    await expect(drawer).toContainText('description / acceptance');
    await expect(drawer).toContainText('影响面');
    await expect(drawer).toContainText('角色：后端、产品');
    await expect(drawer).toContainText('版本：v3');
    expect(
      await drawer
        .locator('.detail-text')
        .first()
        .evaluate((element) => ({
          fontSize: parseFloat(getComputedStyle(element).fontSize),
          whiteSpace: getComputedStyle(element).whiteSpace,
        })),
    ).toMatchObject({ fontSize: expect.any(Number), whiteSpace: 'pre-wrap' });
    expect(
      await drawer
        .locator('.detail-text')
        .first()
        .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
    ).toBeGreaterThanOrEqual(12);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    const opener = page.getByRole('button', { name: '打开待确认变更', exact: true });
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
