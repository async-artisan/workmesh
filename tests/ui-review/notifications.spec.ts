import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

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
