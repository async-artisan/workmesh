import { expect, test } from '@playwright/test';
import type { RequirementTrustChain } from '../../packages/shared/src/requirement-trust-chain';
import { installReviewFixtures, requirement, task } from './fixtures';

const chain: RequirementTrustChain = {
  scope: 'FORMAL_FACT_CHAIN',
  checkedAt: '2026-11-10T01:00:00Z',
  requirementGeneration: 1,
  status: 'GAPS',
  visibility: 'FULL',
  baselines: [
    { kind: 'UNDERSTANDING', state: 'CURRENT', seq: 1, title: '结算需求理解' },
    { kind: 'PRD', state: 'CURRENT', seq: 3, title: '结算产品需求与验收条件' },
  ],
  tasks: [
    {
      taskId: 'task-1',
      taskGeneration: 1,
      stepLabel: '后端交付',
      state: 'PENDING',
      baselineRelation: 'CURRENT',
      artifactSetId: 'set-current',
      snapshotId: 'snapshot-current',
      reviewId: 'review-current',
      gapCodes: ['CODE_EVIDENCE_MISSING'],
    },
  ],
  acceptance: [{ key: 'PAYMENT-001', taskIds: ['task-1'], acceptedTaskIds: [] }],
  gaps: [{ code: 'CODE_EVIDENCE_MISSING', taskId: 'task-1' }],
  timeline: [
    {
      id: 'delivery',
      kind: 'DELIVERY',
      at: '2026-11-10T01:00:00Z',
      source: 'AGENT_SUBMITTED',
      applicability: 'CURRENT',
      label: '后端交付',
      actors: [
        { kind: 'AGENT', userId: 'agent', label: 'delivery-agent-with-a-long-name@example.test' },
      ],
      taskId: 'task-1',
      taskGeneration: 1,
      requirementGeneration: 1,
    },
    {
      id: 'decision',
      kind: 'DECISION',
      at: '2026-11-09T01:00:00Z',
      source: 'HUMAN_SIGNED',
      applicability: 'REVOKED',
      label: '旧交付正式批准',
      actors: [{ kind: 'HUMAN', userId: 'owner', label: 'owner@example.test' }],
      reviewId: 'review-old',
      decision: 'APPROVE',
    },
    {
      id: 'withdrawal',
      kind: 'WITHDRAWAL',
      at: '2026-11-08T01:00:00Z',
      source: 'PLATFORM_FACT',
      applicability: 'WITHDRAWN',
      label: '旧产品需求 v2',
      actors: [],
    },
  ],
};

for (const width of [1440, 390]) {
  test(`${width}px 需求信任链展示来源与历史签字并从缺口定位任务`, async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await installReviewFixtures(page);
    await page.route('**/api/v1/projects/p1/requirements/req-1', (route) =>
      route.fulfill({
        json: {
          data: {
            requirement,
            acceptanceKeys: ['PAYMENT-001'],
            tasks: [
              {
                ...task,
                claimEligibility: { canClaim: true, reason: null },
                workflowWorkStatus: 'ACTIVE',
              },
            ],
            artifacts: [],
            reviews: [],
            changes: [],
            counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
            trustChain: chain,
          },
          meta: { requestId: 'trust-chain-fixture' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/requirements/req-1?projectId=p1');
    const trust = page.getByRole('region', { name: '需求证据完整性' });
    await expect(trust).toContainText('存在证据缺口');
    await expect(trust).toContainText('不改变任务或批准状态');
    const open = trust.getByRole('button', { name: '展开信任链时间线（3）' });
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/tab=trace/);
    const timeline = page.getByRole('list', { name: '正式事实时间线' });
    await expect(timeline).toContainText('Agent 提交');
    await expect(timeline).toContainText('已撤销 · HUMAN 签字');
    await expect(timeline).toContainText('撤回操作人未记录；不推断签字人');
    await expect(timeline.getByRole('link', { name: '查看评审与证据' })).toHaveAttribute(
      'href',
      '/reviews/review-old',
    );
    await page.getByLabel('信任链事件类型').selectOption('DECISION');
    await expect(timeline.getByRole('listitem')).toHaveCount(1);
    await page.getByLabel('信任链关联状态').selectOption('CURRENT');
    await expect(page.getByText('当前筛选下没有已登记事实。')).toBeVisible();
    await page.getByLabel('信任链事件类型').selectOption('all');
    await page.getByLabel('信任链关联状态').selectOption('all');
    await page.screenshot({
      path: `.tmp/ui-review-results/trust-chain-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: '定位 后端交付' }).click();
    await expect(page).toHaveURL(/tab=tasks.*taskId=task-1/);
    await expect(page.locator('[data-task-id="task-1"]')).toHaveClass(/is-task-focus/);
    await expect(page.locator('[data-task-id="task-1"]')).toBeFocused();
    expect(writes).toEqual([]);
  });
}
