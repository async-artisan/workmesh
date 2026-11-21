import { expect, test, type Page } from '@playwright/test';
import { installReviewFixtures, revisions, texts } from './fixtures';

interface RequestEntry {
  method: string;
  path: string;
}
interface Ledger {
  requests: RequestEntry[];
  rejectedWrites: string[];
  rejectedLegacyReads: string[];
}
const ledgers = new Map<Page, Ledger>();
const defaultReviewId = 'review-legacy-route';
const encodedReviewId = 'review/encoded';
const reviewPath = (id: string) => `/api/v1/review-requests/${encodeURIComponent(id)}`;
const canonicalPath = (id: string) => `/reviews/${encodeURIComponent(id)}`;

/** These requests exercise routing and read permissions only; all API writes are rejected. */
async function installRouteFixtures(page: Page, { forbidden = false } = {}) {
  await installReviewFixtures(page);
  await page.addInitScript(() => localStorage.setItem('workmesh.projectId', 'p2'));
  const ledger: Ledger = { requests: [], rejectedWrites: [], rejectedLegacyReads: [] };
  ledgers.set(page, ledger);
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      ledger.requests.push({ method: request.method(), path: path + url.search });
      const reply = (data: unknown) =>
        route.fulfill({ json: { data, meta: { requestId: 'review-route-fixture' } } });
      const fail = (status: number, code: string, message: string) =>
        route.fulfill({
          status,
          json: { error: { code, message, requestId: 'review-route-fixture' } },
        });
      if (request.method() !== 'GET') {
        ledger.rejectedWrites.push(`${request.method()} ${path}`);
        return fail(405, 'READ_ONLY_ROUTE_FIXTURE', '路由兼容验证禁止写入');
      }
      if (
        /^\/api\/v1\/(?:projects\/[^/]+\/documents|knowledge-bases\/[^/]+\/documents|documents\/[^/]+(?:\/revisions(?:\/[^/]+)?)?|document-revisions\/[^/]+)$/.test(
          path,
        )
      ) {
        ledger.rejectedLegacyReads.push(path + url.search);
        return fail(500, 'LEGACY_DOCUMENT_READ', '评审路由不得退回完整文档读取');
      }
      const id = [defaultReviewId, encodedReviewId].find(
        (candidate) => reviewPath(candidate) === path,
      );
      if (id) {
        if (forbidden) return fail(403, 'FORBIDDEN', '当前账号无权读取这条评审');
        return reply({
          id,
          projectId: 'p1',
          kind: 'PRD_PUBLICATION',
          status: 'OPEN',
          version: 2,
          subjectDigest: 'd'.repeat(64),
          documentRevisionId: 'rev-2',
          artifactSetId: null,
          taskId: null,
          slots: [
            {
              id: 'slot-route',
              slotKey: 'owner',
              requiredUserId: 'fixture-user',
              requiredRoleId: null,
              sourceSlotBindingId: null,
              viewerCanDecide: false,
            },
          ],
          decisions: [],
          subject: {
            documentId: 'doc-1',
            knowledgeBaseId: 'kb-1',
            documentVersion: 3,
            currentPublishedRevisionId: 'rev-1',
            revisionId: 'rev-2',
            revisionDigest: revisions[1]!.digest,
          },
        });
      }
      if (
        [defaultReviewId, encodedReviewId].some(
          (candidate) => `${reviewPath(candidate)}/discussions` === path,
        )
      )
        return reply({ items: [], nextCursor: null, unresolvedCount: 0, canCreate: false });
      return route.fallback();
    },
  );
  return {
    requests: ledger.requests,
    reviewReads: (id: string) =>
      ledger.requests.filter((entry) => entry.method === 'GET' && entry.path === reviewPath(id)),
  };
}

async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function expectReview(page: Page, id: string) {
  await expect(page).toHaveURL((url) => url.pathname === canonicalPath(id) && url.search === '');
  await expect(page.getByRole('heading', { name: revisions[1]!.title, exact: true })).toBeVisible();
  await expect(page.locator('.paper-content')).toHaveText(texts[1]!);
  await expect(page.getByRole('heading', { name: '审批槽位', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '作出决定', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('当前项目', { exact: true })).toHaveCount(0);
  await afterBrowserPaint(page);
  await expect(page).toHaveURL((url) => url.pathname === canonicalPath(id) && url.search === '');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}

/** Simulate a history navigation to an old bookmark while preserving the already loaded app. */
async function visitLegacyInLoadedApp(page: Page, path: string) {
  await page.evaluate((target) => {
    const currentIndex = Number(window.history.state?.idx ?? 0);
    window.history.pushState({ ...window.history.state, idx: currentIndex + 1 }, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

test.afterEach(async ({ page }) => {
  const ledger = ledgers.get(page);
  ledgers.delete(page);
  if (!ledger) return;
  expect(ledger.rejectedWrites, '路由兼容场景不得提交 API 写入').toEqual([]);
  expect(ledger.rejectedLegacyReads, '规范评审应读取准确修订').toEqual([]);
});

for (const width of [1440, 390]) {
  for (const [label, projectQuery] of [
    ['无项目参数', ''],
    ['评审所属项目参数', '&projectId=p1'],
    ['当前记忆中的其他项目参数', '&projectId=p2'],
    ['不在项目列表中的参数', '&projectId=missing'],
  ])
    test(`${width}px 旧评审链接${label}规范替换且后退不经过空白旧地址`, async ({ page }) => {
      const fixture = await installRouteFixtures(page);
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/reviews?projectId=p2');
      await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue('p2');
      await expect(page.getByRole('heading', { name: '评审', exact: true })).toBeVisible();
      await expect(page.getByText('已显示 1 条', { exact: true })).toBeVisible();
      const before = fixture.requests.length;
      await visitLegacyInLoadedApp(
        page,
        `/reviews?id=${encodeURIComponent(defaultReviewId)}${projectQuery}`,
      );
      await expectReview(page, defaultReviewId);
      await expect.poll(() => fixture.reviewReads(defaultReviewId).length).toBeGreaterThan(0);
      expect(
        fixture.requests
          .slice(before)
          .some((entry) => /^\/api\/v1\/projects\/[^/]+\/review-requests\?/.test(entry.path)),
        '跳转期间不能打开某个项目的评审收件箱代替目标详情',
      ).toBe(false);
      expect(
        fixture.requests.some(
          (entry) => entry.path === '/api/v1/documents/doc-1/revisions/rev-2/metadata',
        ),
      ).toBe(true);
      await page.goBack();
      await expect(page).toHaveURL(
        (url) => url.pathname === '/reviews' && url.search === '?projectId=p2',
      );
      await expect(page.getByRole('heading', { name: '评审', exact: true })).toBeVisible();
      await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue('p2');
      await expect(
        page.getByRole('heading', { name: revisions[1]!.title, exact: true }),
      ).toHaveCount(0);
      await page.goForward();
      await expectReview(page, defaultReviewId);
    });

  test(`${width}px 直接打开已编码的旧评审 ID 后读取同一准确对象，刷新仍可见`, async ({ page }) => {
    const fixture = await installRouteFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/reviews?id=${encodeURIComponent(encodedReviewId)}`);
    await expectReview(page, encodedReviewId);
    expect(fixture.reviewReads(encodedReviewId).length).toBeGreaterThan(0);
    expect(
      fixture.requests.some((entry) => entry.path.includes('review%252Fencoded')),
      '已编码路径不能再次编码成另一个评审 ID',
    ).toBe(false);
    const reads = fixture.reviewReads(encodedReviewId).length;
    await page.reload();
    await expectReview(page, encodedReviewId);
    await expect.poll(() => fixture.reviewReads(encodedReviewId).length).toBeGreaterThan(reads);
  });

  test(`${width}px 旧链接跳转后保留准确评审的 403，不展示正文或决定入口`, async ({ page }) => {
    const fixture = await installRouteFixtures(page, { forbidden: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/reviews?id=${defaultReviewId}&projectId=p2`);
    await expect(page).toHaveURL((url) => url.pathname === canonicalPath(defaultReviewId));
    await expect(page.getByRole('heading', { name: '评审决定', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('当前账号无权读取这条评审');
    await expect(page.getByRole('alert')).toContainText('FORBIDDEN');
    expect(fixture.reviewReads(defaultReviewId).length).toBeGreaterThan(0);
    await expect(page.locator('.paper-content')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '作出决定', exact: true })).toHaveCount(0);
    expect(fixture.requests.some((entry) => /\/(?:metadata|content)$/.test(entry.path))).toBe(
      false,
    );
  });

  test(`${width}px 旧链接的空 id 仍按普通收件箱恢复当前项目`, async ({ page }) => {
    const fixture = await installRouteFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reviews?id=');
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/reviews' &&
        url.searchParams.get('id') === '' &&
        url.searchParams.get('projectId') === 'p2',
    );
    await expect(page.getByRole('heading', { name: '评审', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue('p2');
    expect(fixture.reviewReads(defaultReviewId)).toHaveLength(0);
    await expect(page.getByLabel('当前项目', { exact: true })).toContainText('另一验收项目');
  });
}
