import { expect, test } from '@playwright/test';
import { installReviewFixtures, requirement, task } from './fixtures';

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 交付物摘要可用键盘展开`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.route('**/api/v1/projects/p1/requirements/DEMO-001', (route) =>
      route.fulfill({
        json: {
          data: {
            requirement,
            acceptanceKeys: [],
            tasks: [task],
            artifacts: [
              {
                id: 'artifact-1',
                taskId: 'task-1',
                kind: 'IMPL',
                storage: 'HOSTED',
                mediaType: 'text/markdown',
                byteLength: 128,
                sha256: 'a'.repeat(64),
                commitSha: null,
                repoPath: 'src/example.ts',
                summary: '测试交付物',
                checks: [],
                createdAt: '2026-11-02T00:00:00.000Z',
              },
            ],
            reviews: [],
            changes: [],
            counts: { tasks: 1, artifacts: 1, reviews: 0, changes: 0 },
          },
          meta: { requestId: 'ui-review-fixture' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/requirements/DEMO-001?projectId=p1');
    await page.getByRole('tab', { name: /交付物/ }).click();
    const toggle = page.getByRole('button', { name: /sha256/ });
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByLabel('sha256完整值')).toHaveText('a'.repeat(64));
    await expect(page.getByRole('button', { name: '复制完整值' })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
  });
}
