import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 看板步骤显示名称和无名称历史回退`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.route('**/api/v1/projects/p1/board', async (route) => {
      const baseCard = {
        projectId: 'p1',
        roleId: 'role-1',
        roleTitle: '后端',
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
        currentClaimId: null,
        requirementCode: 'DEMO-001',
        requirementTitle: '名称与历史回退',
      };
      await route.fulfill({
        status: 200,
        json: {
          data: {
            columns: [
              {
                key: 'BACKLOG',
                cards: [
                  {
                    ...baseCard,
                    taskId: 'task-named',
                    stepKey: 'backend-impl',
                    stepDisplayName: '结算服务交付',
                  },
                  { ...baseCard, taskId: 'task-legacy', stepKey: 'backend-impl' },
                  { ...baseCard, taskId: 'task-custom', stepKey: 'custom-legacy-step' },
                ],
              },
            ],
            metrics: {},
          },
          meta: { requestId: 'ui-review-step-names' },
        },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/board?projectId=p1');
    const named = page.getByRole('article', { name: /^结算服务交付，状态：/ });
    const mapped = page.getByRole('article', { name: /^后端实现，状态：/ });
    const fallback = page.getByRole('article', { name: /^custom-legacy-step，状态：/ });
    for (const card of [named, mapped, fallback]) {
      await expect(card).toBeVisible();
      await card.focus();
      await expect(card).toBeFocused();
    }
    await expect(named.locator('.board-code')).toHaveText('结算服务交付');
    await expect(mapped.locator('.board-code')).toHaveText('后端实现');
    await expect(fallback.locator('.board-code')).toHaveText('custom-legacy-step');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(1);
  });
}
