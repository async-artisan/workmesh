import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

for (const width of [1440, 390]) {
  test(`${width}px 接入先校验参数再签发并保留安全偏好`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.route('**/api/v1/projects/p1/workspace-definition', (route) =>
      route.fulfill({
        json: {
          data: {
            definitionStatus: 'CONFIGURED',
            projectId: 'p1',
            projectVersion: 3,
            definitionVersion: 1,
            revisionId: 'workspace-rev-1',
            revisionNo: 1,
            digest: 'a'.repeat(64),
            publishedAt: '2026-11-09T00:00:00.000Z',
            payload: { schemaVersion: '1.0', layout: { kind: 'NONE' }, repositories: [] },
            repositories: [],
            draft: null,
            validation: { valid: true, issues: [] },
          },
          meta: { requestId: 'onboarding-definition' },
        },
      }),
    );
    await page.route('**/api/v1/projects/p1/members', (route) =>
      route.fulfill({
        json: {
          data: [
            {
              id: 'fixture-user',
              email: 'fixture@example.test',
              role: 'MEMBER',
              version: 1,
              roles: [{ id: 'role-1', key: 'backend', title: '后端' }],
            },
          ],
          meta: { requestId: 'onboarding-members' },
        },
      }),
    );
    let issued = 0;
    await page.route('**/api/v1/projects/p1/workspace-enrollments', (route) => {
      issued += 1;
      return route.fulfill({
        status: 201,
        json: {
          data: {
            enrollmentId: 'fixture-enrollment',
            code: 'FIXTURE-ONE-TIME-CODE',
            projectId: 'p1',
            definitionRevisionId: 'workspace-rev-1',
            definitionDigest: 'a'.repeat(64),
            expiresAt: '2026-11-09T23:00:00.000Z',
          },
          meta: { requestId: 'onboarding-code' },
        },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/workspace?projectId=p1');
    const opener = page.getByRole('button', { name: '生成接入码', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: '生成一次性接入码' });
    await expect(dialog.getByRole('combobox', { name: 'Shell', exact: true })).toBeFocused();
    await expect(dialog.getByLabel('项目角色')).toHaveValue('backend');
    const generate = dialog.getByRole('button', { name: '生成接入码', exact: true });
    await expect(generate).toBeDisabled();
    expect(issued).toBe(0);
    await dialog.getByRole('combobox', { name: 'Shell', exact: true }).selectOption('powershell');
    await dialog.getByLabel('Agent 客户端').selectOption('codex');
    await dialog.getByLabel('本地工作区根目录').fill('G:\\Business Projects\\app');
    await dialog.getByLabel('WorkMesh API 地址').fill('https://mesh.example.com/platform/api/v1');
    await expect(generate).toBeEnabled();
    await generate.click();
    await expect(dialog.getByLabel('一次性接入码')).toHaveValue('FIXTURE-ONE-TIME-CODE');
    await expect(dialog.getByLabel('CLI 预览命令')).toHaveValue(
      /--api 'https:\/\/mesh\.example\.com\/platform\/api\/v1'/,
    );
    expect(issued).toBe(1);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
      'FIXTURE-ONE-TIME-CODE',
    );
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    expect(
      await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    await opener.click();
    await expect(dialog.getByRole('combobox', { name: 'Shell', exact: true })).toHaveValue(
      'powershell',
    );
    await expect(dialog.getByLabel('Agent 客户端')).toHaveValue('codex');
    await expect(dialog.getByLabel('本地工作区根目录')).toHaveValue('');
    await expect(dialog.getByLabel('一次性接入码')).toHaveCount(0);
  });
}
