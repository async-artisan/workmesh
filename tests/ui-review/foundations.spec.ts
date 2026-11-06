import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 基础按钮与项目弹窗`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/projects');
    const archive = page.getByRole('button', { name: '归档', exact: true }).first();
    await expect(archive).toBeVisible();
    const matchesTokens = await archive.evaluate((button) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--wm-color-danger-soft)';
      probe.style.color = 'var(--wm-color-danger)';
      document.body.appendChild(probe);
      const result = {
        background:
          getComputedStyle(button).backgroundColor === getComputedStyle(probe).backgroundColor,
        color: getComputedStyle(button).color === getComputedStyle(probe).color,
      };
      probe.remove();
      return result;
    });
    expect(matchesTokens).toEqual({ background: true, color: true });
    await page.keyboard.press('Tab');
    await archive.focus();
    await expect(archive).toBeFocused();
    expect(
      await archive.evaluate((button) => parseFloat(getComputedStyle(button).outlineWidth)),
    ).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: '新建项目', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('项目名称')).toBeVisible();
    await expect(dialog.getByLabel('项目 Key')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}
