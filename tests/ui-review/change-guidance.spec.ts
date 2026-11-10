import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

for (const width of [1440, 390]) {
  test(`变更任务指引在 ${width}px 提供具体动作和键盘直达`, async ({ page }) => {
    await installReviewFixtures(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && request.method() !== 'GET')
        writes.push(request.url());
    });
    await page.route('**/api/v1/workbench**', (route) =>
      route.fulfill({
        json: {
          data: {
            counts: { reviews: 0, changes: 1, readyTasks: 0, overdueApprovals: 0, total: 1 },
            reviews: [],
            readyTasks: [],
            overdueApprovals: [],
            warnings: [],
            changes: [
              {
                recipientId: 'rec-guidance',
                eventId: 'event-guidance',
                projectId: 'p1',
                projectKey: 'DEMO',
                projectName: '验收示例项目',
                requirement: { code: 'DEMO-001', title: '移动端结算与登录改版' },
                changedFields: ['generation'],
                targets: { taskIds: ['task-1'] },
                pendingRoles: [{ key: 'backend', title: '后端' }],
                version: 2,
                createdAt: '2026-11-10T00:00:00Z',
                ageSeconds: 20,
                guidance: {
                  checkedAt: '2026-11-10T00:00:20Z',
                  scope: 'EVENT_TASKS',
                  eventBaseline: 'SUPERSEDED',
                  tasks: [
                    {
                      taskId: 'task-1',
                      requirementId: 'req-1',
                      taskCode: 'DEMO-001/backend-impl',
                      stepKey: 'backend-impl',
                      stepDisplayName: '后端实现',
                      role: { id: 'role-1', key: 'backend', title: '后端' },
                      responsibleUserId: 'fixture-user',
                      relation: 'RESPONSIBLE',
                      version: 3,
                      generation: 2,
                      executionStatus: 'OPEN',
                      workStatus: 'ACTIVE',
                      reason: 'NO_CONTEXT',
                      action: 'INSPECT_AND_CLAIM',
                      href: '/requirements/req-1?projectId=p1&taskId=task-1',
                      inspectCommand: 'workmesh context --task task-1 --inspect',
                    },
                  ],
                },
              },
            ],
          },
          meta: { requestId: 'change-guidance-browser' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: '去确认', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '需求变更 · 需要确认' });
    await expect(dialog.getByText('DEMO-001/backend-impl · 后端实现')).toBeVisible();
    await expect(dialog.getByText('后端 · 由你负责')).toBeVisible();
    await expect(dialog.getByText('当前代次尚无上下文快照')).toBeVisible();
    await expect(dialog.getByText('先检查输入，前置条件满足后重新认领并获取上下文')).toBeVisible();
    await expect(dialog.getByText(/此通知引用的基线已有后续更新/)).toBeVisible();
    await expect(dialog.getByText(/知悉只确认你已收到/)).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(writes).toHaveLength(0);
    const link = dialog.getByRole('link', { name: '查看 DEMO-001/backend-impl 的任务与输入' });
    await link.focus();
    await expect(link).toBeFocused();
    await link.press('Enter');
    await expect(page).toHaveURL(/requirements\/req-1\?projectId=p1&taskId=task-1/);
    expect(writes).toHaveLength(0);
  });
}
