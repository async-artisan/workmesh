import { expect, test } from '@playwright/test';
import { boardSummary, installReviewFixtures } from './fixtures';

test('390px 看板按列续页保留精确总数，按需求读取独立聚合页且无页面溢出', async ({ page }) => {
  await installReviewFixtures(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  const requests: URL[] = [];
  const summary = boardSummary({ BACKLOG: 3, ACTIVE: 1, CANCELLED: 1 }, 2);
  const queryKey = 'ui-review-board-pagination';
  const base = {
    projectId: 'p1',
    roleId: 'role-1',
    roleTitle: '后端',
    requirementCode: 'DEMO-001',
    requirementTitle: '聚合完整需求',
    stepKey: 'backend-impl',
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    currentArtifactSetId: null,
    claimedUserId: null,
    claimedAt: null,
    generation: 1,
  };
  const card = (id: string) => ({ ...base, taskId: id, stepDisplayName: id });
  const group = {
    code: 'DEMO-001',
    title: '聚合完整需求',
    total: 4,
    counts: { BACKLOG: 3, ACTIVE: 0, BLOCKED: 0, PAUSED: 0, CANCELLED: 1, DELIVERED: 0 },
    roles: ['后端'],
    roleTotal: 1,
    rolesNextCursor: null,
  };
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/projects/p1/board'),
    async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      const reply = (data: unknown) =>
        route.fulfill({
          status: 200,
          json: { data, meta: { requestId: 'ui-review-board-pagination' } },
        });
      if (url.pathname.endsWith('/filters/roles'))
        return reply({
          projectId: 'p1',
          queryKey,
          total: 1,
          items: [{ value: '后端', label: '后端' }],
          nextCursor: null,
        });
      if (url.pathname.endsWith('/filters/requirements'))
        return reply({
          projectId: 'p1',
          queryKey,
          total: 2,
          items: [
            { value: 'DEMO-001', label: 'DEMO-001 · 聚合完整需求' },
            { value: 'DEMO-002', label: 'DEMO-002 · 第二条聚合需求' },
          ],
          nextCursor: null,
        });
      if (url.pathname.endsWith('/board'))
        return reply({
          projectId: 'p1',
          queryKey,
          summary,
          columns: summary.columns.map((column) => ({
            ...column,
            cards:
              column.key === 'BACKLOG'
                ? [card('第一批任务')]
                : column.key === 'ACTIVE'
                  ? [
                      {
                        ...card('进行中任务'),
                        currentClaimId: 'claim-1',
                        claimedUserId: 'fixture-user',
                        requirementCode: 'DEMO-002',
                        requirementTitle: '第二条聚合需求',
                      },
                    ]
                  : column.key === 'CANCELLED'
                    ? [
                        {
                          ...card('已取消任务'),
                          currentClaimId: 'claim-cancelled',
                          claimedUserId: 'fixture-user',
                          workStatus: 'CANCELLED',
                        },
                      ]
                    : [],
            nextCursor: column.key === 'BACKLOG' ? 'backlog-next' : null,
          })),
        });
      if (url.pathname.endsWith('/columns/BACKLOG')) {
        expect(url.searchParams.get('cursor')).toBe('backlog-next');
        return reply({
          projectId: 'p1',
          queryKey,
          key: 'BACKLOG',
          total: 3,
          cards: [card('第二批任务'), card('第三批任务')],
          nextCursor: null,
        });
      }
      if (url.pathname.endsWith('/board/requirements')) {
        const cursor = url.searchParams.get('cursor');
        expect(cursor === null || cursor === 'requirements-next').toBe(true);
        return reply({
          projectId: 'p1',
          queryKey,
          summary,
          items:
            cursor === null
              ? [group]
              : [
                  {
                    ...group,
                    code: 'DEMO-002',
                    title: '第二条聚合需求',
                    total: 1,
                    counts: {
                      BACKLOG: 0,
                      ACTIVE: 1,
                      BLOCKED: 0,
                      PAUSED: 0,
                      CANCELLED: 0,
                      DELIVERED: 0,
                    },
                  },
                ],
          nextCursor: cursor === null ? 'requirements-next' : null,
        });
      }
      return route.fulfill({ status: 404, json: { error: { code: 'UNEXPECTED_BOARD_ROUTE' } } });
    },
  );

  await page.goto('/board?projectId=p1');
  const backlog = page.locator('.board-col[aria-label="未开始列"]');
  const totals = page.locator('.board-toolbar-count');
  await expect(backlog.getByRole('article')).toHaveCount(1);
  await expect(backlog.locator('.board-count')).toHaveText('3');
  await expect(totals).toHaveText('显示 5 / 5（匹配任务，已加载页面可继续读取）');
  await expect(page.locator('.board-card')).toHaveCount(3);
  const snapshotRequestCount = requests.filter((url) => url.pathname.endsWith('/board')).length;
  expect(snapshotRequestCount).toBeGreaterThan(0);
  await page.getByRole('button', { name: '加载更多未开始任务', exact: true }).click();
  await expect(backlog.getByRole('article')).toHaveCount(3);
  await expect(backlog.getByRole('article', { name: /^第三批任务，状态：/ })).toBeVisible();
  await expect(backlog.locator('.board-count')).toHaveText('3');
  await expect(totals).toHaveText('显示 5 / 5（匹配任务，已加载页面可继续读取）');
  await expect(page.locator('.board-card')).toHaveCount(5);
  await expect(page.getByRole('button', { name: '加载更多未开始任务', exact: true })).toHaveCount(
    0,
  );
  expect(
    requests.filter((url) => url.pathname.includes('/board/columns/')).map((url) => url.pathname),
  ).toEqual(['/api/v1/projects/p1/board/columns/BACKLOG']);
  expect(requests.filter((url) => url.pathname.endsWith('/board'))).toHaveLength(
    snapshotRequestCount,
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);

  await page.getByRole('button', { name: '按需求', exact: true }).click();
  const groupedRow = page.getByRole('row').filter({ hasText: 'DEMO-001 · 聚合完整需求' });
  await expect(groupedRow).toBeVisible();
  await expect(groupedRow.getByRole('cell').nth(1)).toHaveText('4');
  await expect(groupedRow.getByRole('cell').nth(2)).toHaveText('3');
  await expect(groupedRow.getByRole('cell').nth(6)).toHaveText('1');
  await expect(page.getByText('已加载 1 / 2 个匹配需求', { exact: true })).toBeVisible();
  expect(requests.filter((url) => url.pathname.endsWith('/board/requirements'))).toHaveLength(1);
  await page.getByRole('button', { name: '加载更多需求', exact: true }).click();
  await expect(
    page.getByRole('row').filter({ hasText: 'DEMO-002 · 第二条聚合需求' }),
  ).toBeVisible();
  await expect(page.getByText('已加载 2 / 2 个匹配需求', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '加载更多需求', exact: true })).toHaveCount(0);
  expect(requests.filter((url) => url.pathname.endsWith('/board/requirements'))).toHaveLength(2);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
});
