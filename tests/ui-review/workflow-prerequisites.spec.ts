import { expect, test, type Page } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

const documents = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'ERP 系统单元说明' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'ERP 前后端接口契约' },
];

async function installPrerequisiteFixtures(page: Page, canManage = true, empty = false) {
  await installReviewFixtures(page);
  const reply = (data: unknown) => ({
    json: { data, meta: { requestId: 'workflow-prerequisites-fixture' } },
  });
  const roles = [
    ['product', '产品'],
    ['ui', '设计'],
    ['backend', '后端'],
    ['frontend', '前端'],
    ['qa', '测试'],
    ['ops', '运维'],
  ].map(([key, title]) => ({ id: `role-${key}`, projectId: 'p1', key, title, isActive: true }));
  await page.route('**/api/v1/projects/p1/roles', (route) => route.fulfill(reply(roles)));
  await page.route('**/api/v1/projects/p1/documents**', (route) =>
    route.fulfill(
      reply({
        items: empty
          ? []
          : documents.map((document) => ({
              document: {
                id: document.id,
                projectId: 'p1',
                kind: 'KNOWLEDGE',
                currentPublishedRevisionId: `revision-${document.id}`,
                archivedAt: null,
              },
              revisions: [],
              publishedRevision: { id: `revision-${document.id}`, title: document.title },
            })),
        nextCursor: null,
      }),
    ),
  );
  const writes: unknown[] = [];
  const bindings: Array<{
    id: string;
    documentId: string;
    roleId: string | null;
    required: boolean;
  }> = [];
  await page.route('**/api/v1/projects/p1/knowledge-bindings', (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      writes.push(body);
      bindings.push({
        id: `binding-${bindings.length + 1}`,
        documentId: body.documentId,
        roleId: body.roleId,
        required: body.required,
      });
      return route.fulfill(reply({ version: 3 + bindings.length, binding: bindings.at(-1) }));
    }
    return route.fulfill(reply({ version: 3 + bindings.length, canManage, items: bindings }));
  });
  return { writes };
}

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 流程资料布局、选择绑定和手动输入`, async ({ page }) => {
    const { writes } = await installPrerequisiteFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/workflows?projectId=p1');
    await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
    const region = page.getByRole('region', { name: '流程前置资料', exact: true });
    const backend = region.getByRole('combobox', { name: '选择已发布文档：系统单元说明（后端）' });
    const frontend = region.getByRole('combobox', { name: '选择已发布文档：接口契约（前端）' });
    await expect(backend).toBeEnabled();
    await expect(frontend).toBeEnabled();
    await region.screenshot({
      path: `.tmp/ui-review-captures/workflow-prerequisites-${width}.png`,
      style: '.navbar, .skip-link { visibility: hidden; }',
    });
    const backendBox = await backend.boundingBox();
    const frontendBox = await frontend.boundingBox();
    expect(backendBox!.height).toBeGreaterThanOrEqual(40);
    if (width === 1440) {
      expect(Math.abs(backendBox!.y - frontendBox!.y)).toBeLessThanOrEqual(1);
      expect(frontendBox!.x).toBeGreaterThan(backendBox!.x + backendBox!.width);
    } else {
      expect(frontendBox!.y).toBeGreaterThan(backendBox!.y + backendBox!.height);
    }
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    expect(
      await region.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);

    const bindBackend = region.getByRole('button', { name: '绑定给后端', exact: true });
    await expect(bindBackend).toBeDisabled();
    await backend.selectOption(documents[0].id);
    await backend.focus();
    await page.keyboard.press('Tab');
    await expect(bindBackend).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(bindBackend).toHaveCount(0);
    expect(writes).toEqual([
      { documentId: documents[0].id, roleId: 'role-backend', required: true, expectedVersion: 3 },
    ]);
    await frontend.selectOption(documents[1].id);
    await region.getByRole('button', { name: '绑定给前端', exact: true }).click();
    expect(writes[1]).toEqual({
      documentId: documents[1].id,
      roleId: 'role-frontend',
      required: true,
      expectedVersion: 4,
    });
    await expect(region.getByText('已绑定', { exact: true })).toHaveCount(2);
    await region.getByText('手动填写文档标识', { exact: true }).first().click();
    const manual = region.getByRole('textbox', { name: '文档标识：系统单元说明（后端）' });
    await expect(manual).toHaveValue(documents[0].id);
    await manual.fill(documents[1].id);
    await expect(backend).toHaveValue(documents[1].id);
    const definition = JSON.parse(
      await page.getByLabel('流程定义 JSON', { exact: true }).inputValue(),
    );
    expect(
      definition.steps.find((step: { key: string }) => step.key === 'backend').inputBindings,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inputKey: 'unit-card', knowledgeKey: documents[1].id }),
      ]),
    );
    await expect(
      region.getByRole('link', { name: '准备与发布知识资料', exact: true }),
    ).toHaveAttribute('href', '/knowledge?projectId=p1');
    await expect(region.getByRole('link', { name: '安排资料负责人', exact: true })).toHaveAttribute(
      'href',
      '/roles?projectId=p1',
    );
    expect(
      await region.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    await region.screenshot({
      path: `.tmp/ui-review-captures/workflow-prerequisites-expanded-${width}.png`,
      style: '.navbar, .skip-link { visibility: hidden; }',
    });
  });
}

test('普通成员在无已发布资料时保留准备入口与权限提示', async ({ page }) => {
  const { writes } = await installPrerequisiteFixtures(page, false, true);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/workflows?projectId=p1');
  await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
  const region = page.getByRole('region', { name: '流程前置资料', exact: true });
  await expect(region.getByRole('combobox').first()).toBeEnabled();
  await expect(region.getByRole('combobox').first().getByRole('option')).toHaveCount(1);
  await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
  await expect(region.getByText(/请项目 OWNER 或 ADMIN 在本页完成资料绑定/).first()).toBeVisible();
  await expect(region.getByRole('link', { name: '准备与发布知识资料', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});
