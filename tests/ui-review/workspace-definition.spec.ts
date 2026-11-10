import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

const repositories = ['backend', 'base', 'web-client', 'shared'].map((name, index) => ({
  id: `repository-${index + 1}`,
  identityMode: 'DECLARED',
  adapter: null,
  externalId: null,
  owner: 'nz_erp',
  name,
  defaultBranch: 'main',
  createdAt: '2026-11-09T00:00:00.000Z',
  archivedAt: null,
}));

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 仓库配置布局、键盘编辑与增删`, async ({ page }) => {
    await installReviewFixtures(page);
    const reply = (data: unknown) => ({
      json: { data, meta: { requestId: 'workspace-form-fixture' } },
    });
    await page.route('**/api/v1/projects/p1/repositories', (route) =>
      route.fulfill(reply(repositories)),
    );
    await page.route('**/api/v1/projects/p1/workspace-definition', (route) =>
      route.fulfill(
        reply({
          definitionStatus: 'CONFIGURED',
          projectId: 'p1',
          projectVersion: 3,
          definitionVersion: 1,
          revisionId: 'workspace-revision-1',
          revisionNo: 1,
          digest: 'a'.repeat(64),
          publishedAt: '2026-11-09T00:00:00.000Z',
          payload: {
            schemaVersion: '1.0',
            layout: { kind: 'MULTI_ROOT' },
            repositories: repositories.slice(0, 3).map((repo) => ({
              key: repo.name,
              projectRepositoryId: repo.id,
              suggestedPath: repo.name,
              defaultRef: null,
              description: null,
            })),
          },
          repositories: [],
          draft: null,
          validation: { valid: true, issues: [] },
        }),
      ),
    );
    let submitted: Record<string, unknown> | undefined;
    await page.route('**/api/v1/projects/p1/workspace-definition/validate', (route) => {
      submitted = route.request().postDataJSON();
      return route.fulfill(
        reply({ valid: true, digest: 'b'.repeat(64), definition: null, issues: [] }),
      );
    });

    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/workspace?projectId=p1');
    const editor = page.locator('[aria-label="工作区定义编辑器"]');
    const first = editor.getByRole('group', { name: '仓库 1', exact: true });
    await expect(first.getByLabel('逻辑键 1')).toHaveValue('backend');
    await editor.screenshot({
      path: `.tmp/ui-review-captures/workspace-definition-${width}.png`,
      style: '.navbar { visibility: hidden; }',
    });

    const key = await first.getByLabel('逻辑键 1').boundingBox();
    const repository = await first.getByLabel('平台仓库 1').boundingBox();
    expect(key).not.toBeNull();
    expect(repository).not.toBeNull();
    if (width >= 1024) {
      expect(Math.abs(key!.y - repository!.y)).toBeLessThanOrEqual(1);
      expect(repository!.x).toBeGreaterThan(key!.x + key!.width);
    } else if (width === 390) {
      expect(repository!.y).toBeGreaterThan(key!.y + key!.height);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    expect(
      await editor.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);

    await first.getByLabel('逻辑键 1').focus();
    await page.keyboard.press('Tab');
    await expect(first.getByLabel('平台仓库 1')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first.getByLabel('建议路径 1')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('services/backend');
    await page.keyboard.press('Tab');
    await expect(first.getByLabel('默认引用 1')).toBeFocused();
    await first.getByLabel('职责说明 1').fill('后端服务与接口');
    await editor.getByRole('button', { name: '添加仓库行' }).click();
    await expect(editor.getByRole('group')).toHaveCount(4);
    await editor.getByRole('button', { name: '移除仓库行 4' }).click();
    await expect(editor.getByRole('group')).toHaveCount(3);
    await editor.getByRole('button', { name: '校验定义', exact: true }).click();
    await expect(editor.getByRole('button', { name: '保存草稿', exact: true })).toBeEnabled();
    expect(submitted).toMatchObject({
      definition: {
        layout: { kind: 'MULTI_ROOT' },
        repositories: [
          expect.objectContaining({
            key: 'backend',
            suggestedPath: 'services/backend',
            description: '后端服务与接口',
          }),
          expect.objectContaining({ key: 'base' }),
          expect.objectContaining({ key: 'web-client' }),
        ],
      },
    });

    await editor.getByRole('button', { name: '移除仓库行 3' }).click();
    await editor.getByRole('button', { name: '移除仓库行 2' }).click();
    await expect(editor.getByLabel('布局类型')).toHaveValue('SINGLE_ROOT');
    await expect(first.getByLabel('建议路径 1')).toHaveValue('.');
    await editor.getByRole('button', { name: '移除仓库行 1' }).click();
    await expect(editor.getByLabel('布局类型')).toHaveValue('NONE');
    await expect(editor.getByRole('group')).toHaveCount(0);
  });
}
