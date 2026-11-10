import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

const definition = {
  schemaVersion: '1.0',
  protocolVersion: '1.0',
  workflowKey: 'review-layout',
  title: '评审规则布局夹具',
  baseRevisionId: null,
  roleSlots: [
    { key: 'prd-owner', roleKey: 'product', kind: 'PRD_PUBLICATION' },
    { key: 'task-acceptance', roleKey: 'qa', kind: 'TASK_ACCEPTANCE' },
    { key: 'release-acceptance', roleKey: 'ops', kind: 'RELEASE_ACCEPTANCE' },
  ],
  steps: [
    {
      key: 'backend',
      roleKey: 'backend',
      kind: 'DELIVERY',
      deps: [],
      outputKinds: ['IMPL'],
      gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'], metadata: { retained: true } }],
    },
  ],
};

for (const width of [1920, 1440, 1024, 640, 390]) {
  test(`${width}px 验收规则布局、键盘勾选与增删`, async ({ page }) => {
    await installReviewFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/workflows?projectId=p1');
    await expect(page.getByRole('button', { name: '载入标准模板', exact: true })).toBeEnabled();
    await page.getByLabel('流程定义 JSON', { exact: true }).fill(JSON.stringify(definition));
    await page.getByRole('button', { name: '结构化编辑', exact: true }).click();
    const gates = page.locator('.workflow-gates').first();
    const row = gates.locator('.workflow-gate-row').first();
    await gates.screenshot({
      path: `.tmp/ui-review-captures/workflow-gates-${width}.png`,
      style: '.navbar, .skip-link { visibility: hidden; }',
    });
    const regionBox = await gates.boundingBox();
    const rowBox = await row.boundingBox();
    expect(rowBox!.width).toBeGreaterThanOrEqual(regionBox!.width - 2);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
    expect(
      await gates.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(1);
    const task = row.getByRole('checkbox', { name: 'task-acceptance', exact: true });
    await expect(task).toBeChecked();
    const prd = row.getByRole('checkbox', { name: 'prd-owner', exact: true });
    await prd.focus();
    await page.keyboard.press('Space');
    await expect(prd).toBeChecked();
    await page.getByRole('button', { name: '高级 JSON', exact: true }).click();
    const edited = JSON.parse(await page.getByLabel('流程定义 JSON', { exact: true }).inputValue());
    expect(edited.steps[0].gates).toEqual([
      {
        mode: 'ALL',
        reviewerSlots: ['task-acceptance', 'prd-owner'],
        metadata: { retained: true },
      },
    ]);
    await page.getByRole('button', { name: '结构化编辑', exact: true }).click();
    await gates.getByRole('button', { name: '添加验收/评审规则', exact: true }).click();
    await expect(gates.locator('.workflow-gate-row')).toHaveCount(2);
    await gates
      .locator('.workflow-gate-row')
      .nth(1)
      .getByRole('checkbox', { name: 'release-acceptance', exact: true })
      .check();
    await gates.getByRole('button', { name: '删除步骤 1 评审门槛 1', exact: true }).click();
    await expect(gates.locator('.workflow-gate-row')).toHaveCount(1);
    await expect(
      gates.getByRole('checkbox', { name: 'release-acceptance', exact: true }),
    ).toBeChecked();
    await gates.getByRole('button', { name: '删除步骤 1 评审门槛 1', exact: true }).click();
    await expect(gates.locator('.workflow-gate-row')).toHaveCount(0);
    await gates.getByRole('button', { name: '添加验收/评审规则', exact: true }).click();
    await expect(gates.locator('.workflow-gate-row')).toHaveCount(1);
    await expect(gates.getByRole('checkbox', { checked: true })).toHaveCount(0);
    await expect(gates.getByLabel('步骤 1 评审门槛 1', { exact: true })).toHaveValue('ALL');
  });
}
