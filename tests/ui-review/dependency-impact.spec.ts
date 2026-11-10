import { expect, test } from '@playwright/test';
import { installReviewFixtures } from './fixtures';

for (const width of [1440, 390]) {
  test(`${width}px 工作台区分下游影响与前置就绪且排序可操作`, async ({ page }) => {
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
            counts: { reviews: 2, changes: 0, readyTasks: 0, overdueApprovals: 0, total: 2 },
            changes: [],
            readyTasks: [],
            overdueApprovals: [],
            warnings: [],
            reviews: [0, 1].map((index) => ({
              reviewId: `impact-review-${index}`,
              kind: 'TASK_ACCEPTANCE',
              status: 'OPEN',
              version: 1,
              projectId: 'p1',
              projectKey: 'DEMO',
              projectName: '验收示例项目',
              requirement: {
                code: `DEMO-00${index + 1}`,
                title: index ? '高影响流程' : '等待其他签字',
              },
              subjectLabel: 'backend-impl',
              role: { id: 'backend', key: 'backend', title: '后端' },
              slots: [
                {
                  id: `slot-${index}`,
                  slotKey: 'owner',
                  requiredUserId: 'fixture-user',
                  requiredRoleId: null,
                  decided: false,
                  viewerCanDecide: true,
                },
              ],
              ageSeconds: index ? 10 : 100,
              evidence: {
                artifactCount: 1,
                hasPr: false,
                artifactKinds: ['IMPL'],
                checks: { total: 0, failed: 0 },
                codeRefs: 0,
              },
              blocking: index ? 8 : 4,
              dependencyImpact: {
                status: 'AVAILABLE',
                checkedAt: '2026-11-10T09:00:00Z',
                blocking: index ? 8 : 4,
                readyAfterAction: index ? 2 : 0,
                scenario: 'TASK_APPROVAL',
                reason: index ? 'LAST_REQUIRED_SLOT' : 'OTHER_SLOTS_PENDING',
              },
            })),
          },
          meta: { requestId: 'impact-fixture' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/?projectId=p1');
    await expect(page.getByText(/仍有其他审批槽待决定/)).toBeVisible();
    await expect(page.getByText(/下游未完成任务：8 项/)).toContainText('2 项可满足前置任务条件');
    const sort = page.getByRole('combobox', { name: '待办排序' });
    await sort.selectOption('impact');
    await expect(page.locator('.wb-row').first()).toContainText('高影响流程');
    await sort.focus();
    await page.keyboard.press('ArrowUp');
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });
}
