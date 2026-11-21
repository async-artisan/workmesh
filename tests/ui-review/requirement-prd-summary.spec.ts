import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import type { DocumentSummary } from '../../apps/web/src/api/documentSummaries';
import type { RevisionView } from '../../apps/web/src/api/resources';
import {
  installReviewFixtures,
  requirement as baseRequirement,
  task as baseTask,
} from './fixtures';

type RequirementKey = 'DEMO-001' | 'DEMO-002';
interface ApiFailure {
  status: number;
  code: string;
  message: string;
}
interface Gate {
  pathname: string;
  query?: Record<string, string>;
  ready: Promise<void>;
  used?: boolean;
}
interface Ledger {
  requests: Array<{ method: string; path: string }>;
  rejectedLegacyReads: string[];
  rejectedWrites: string[];
}
const ledgers = new Map<Page, Ledger>();
const requirementIds: Record<RequirementKey, string> = {
  'DEMO-001': '50000000-0000-4000-8000-000000000001',
  'DEMO-002': '50000000-0000-4000-8000-000000000002',
};
const requirementTitles: Record<RequirementKey, string> = {
  'DEMO-001': '远页PRD需求',
  'DEMO-002': '另一需求独立PRD',
};
const targetIndex = 107;
const documentId = (index: number) => `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const revisionId = (index: number, seq: number) =>
  `70000000-0000-4000-8000-${String(index).padStart(4, '0')}${String(seq).padStart(8, '0')}`;
const targetId = documentId(targetIndex);
const targetRevision = (seq: number) => revisionId(targetIndex, seq);
const title = (index: number) =>
  index === targetIndex ? '远页需求PRD' : `项目PRD ${String(index).padStart(3, '0')}`;
const revisionTitle = (index: number, seq = 2) => `${title(index)} · 修订 ${seq}`;
const ownerOf = (index: number): RequirementKey => (index <= 50 ? 'DEMO-002' : 'DEMO-001');
const summaryPath = '/api/v1/projects/p1/document-summaries';
const historyPath = (id = targetId) => `/api/v1/documents/${id}/history`;
const metadataPath = (id = targetRevision(2), document = targetId) =>
  `/api/v1/documents/${document}/revisions/${id}/metadata`;
const contentPath = (id: string) => `/api/v1/document-revisions/${id}/content`;
const historyCursor = (version: number, offset: number) => `history-${version}-${offset}`;
const catalogCursor = (key: RequirementKey, offset: number) =>
  `requirement-${requirementIds[key]}-${offset}`;

function latch() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}
async function finishOrAbort(request: Request) {
  const response = await request.response();
  if (response) await response.finished();
}
async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
function waitForRead(page: Page, pathname: string, query: Record<string, string> = {}) {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    return (
      url.pathname === pathname &&
      Object.entries(query).every(([key, value]) => url.searchParams.get(key) === value)
    );
  });
}

async function installRequirementPrdFixtures(page: Page) {
  await installReviewFixtures(page);
  const ledger: Ledger = { requests: [], rejectedLegacyReads: [], rejectedWrites: [] };
  ledgers.set(page, ledger);
  const controls = {
    gates: [] as Gate[],
    catalogFailures: new Map<string, ApiFailure>(),
    historyFailures: new Map<string, ApiFailure>(),
    metadataFailures: new Map<string, ApiFailure>(),
    versions: new Map<string, number>([[targetId, 17]]),
    totals: new Map<string, number>(),
    publishedSeq: new Map<string, number>([[targetId, 2]]),
    allowProjectCatalog: false,
    allowedReviewContent: new Set<string>(),
  };
  const revisionIdentities = new Map<string, { index: number; seq: number }>();
  for (let index = 1; index <= 107; index += 1) {
    for (let seq = 1; seq <= (index === targetIndex ? 123 : 3); seq += 1)
      revisionIdentities.set(revisionId(index, seq), { index, seq });
  }
  const version = (id: string) => controls.versions.get(id) ?? 3;
  const revisionCount = (index: number) =>
    controls.totals.get(documentId(index)) ?? (index === targetIndex ? 123 : 3);
  const publishedSeq = (index: number) => controls.publishedSeq.get(documentId(index)) ?? 2;
  function revision(index: number, seq: number): RevisionView {
    return {
      id: revisionId(index, seq),
      documentId: documentId(index),
      seq,
      title: revisionTitle(index, seq),
      mimeType: 'text/markdown; charset=utf-8',
      byteLength: 80,
      digest: seq.toString(16).padStart(64, '0'),
      state: seq === publishedSeq(index) ? 'PUBLISHED' : 'CANDIDATE',
      createdBy: 'fixture-user',
      basisUnderstandingRevisionId: null,
      deliveryScope: null,
      acceptance: [
        { key: 'requirement-prd-summary', text: '按真实需求和修订标识读取', verification: 'TEST' },
      ],
      reviewRequestId: `requirement-review-${revisionId(index, seq)}`,
    };
  }
  function summary(index: number): DocumentSummary {
    const key = ownerOf(index);
    const compact = (seq: number) => {
      const item = revision(index, seq);
      return {
        id: item.id,
        documentId: item.documentId,
        seq,
        title: item.title,
        digest: item.digest,
        state: item.state as 'PUBLISHED' | 'CANDIDATE',
      };
    };
    return {
      document: {
        id: documentId(index),
        projectId: 'p1',
        knowledgeBaseId: 'kb-1',
        requirementId: requirementIds[key],
        kind: 'PRD',
        version: version(documentId(index)),
        currentPublishedRevisionId: revisionId(index, publishedSeq(index)),
        archivedAt: null,
      },
      updatedAt: new Date(Date.UTC(2026, 10, 10, 0, 0, 108 - index)).toISOString(),
      knowledgeBase: { id: 'kb-1', name: '需求PRD验收知识库', kind: 'BUSINESS' },
      requirement: { id: requirementIds[key], code: key, title: requirementTitles[key] },
      latestVisibleRevision: compact(index === targetIndex ? 123 : 3),
      publishedRevision: compact(publishedSeq(index)),
      visibleRevisionCount: index === targetIndex ? 123 : 3,
      candidateRevisionCount: index === targetIndex ? 122 : 2,
    };
  }
  const getRequests = (pathname: string) =>
    ledger.requests.filter(
      (entry) =>
        entry.method === 'GET' && new URL(entry.path, 'http://fixture').pathname === pathname,
    );
  async function gate(url: URL) {
    const item = controls.gates.find(
      (item) =>
        !item.used &&
        item.pathname === url.pathname &&
        Object.entries(item.query ?? {}).every(
          ([key, value]) => url.searchParams.get(key) === value,
        ),
    );
    if (item) {
      item.used = true;
      await item.ready;
    }
  }
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      ledger.requests.push({ method, path: path + url.search });
      const reply = async (data: unknown, status = 200) => {
        await gate(url);
        return route.fulfill({
          status,
          json: { data, meta: { requestId: 'requirement-prd-summary-fixture' } },
        });
      };
      const fail = async (error: ApiFailure) => {
        await gate(url);
        return route.fulfill({
          status: error.status,
          json: {
            error: {
              code: error.code,
              message: error.message,
              requestId: 'requirement-prd-summary-fixture',
            },
          },
        });
      };
      if (method !== 'GET') {
        ledger.rejectedWrites.push(`${method} ${path}`);
        return fail({
          status: 405,
          code: 'UNEXPECTED_WRITE',
          message: '需求PRD浏览验收不允许写入',
        });
      }
      const content = /^\/api\/v1\/document-revisions\/([^/]+)\/content$/.exec(path);
      if (content && controls.allowedReviewContent.has(content[1]!)) {
        const identity = revisionIdentities.get(content[1]!);
        expect(identity).toBeDefined();
        expect([...url.searchParams]).toEqual([]);
        const text = `共同开头\n${identity!.seq === 2 ? '当前发布第2版' : `准确PRD修订第${identity!.seq}版`}\n共同结尾`;
        return reply({
          revisionId: content[1],
          mimeType: 'text/markdown',
          encoding: 'base64',
          bodyBase64: Buffer.from(text).toString('base64'),
          byteLength: Buffer.byteLength(text),
          sha256: identity!.seq.toString(16).padStart(64, '0'),
        });
      }
      if (
        /^\/api\/v1\/(?:projects\/[^/]+\/documents|knowledge-bases\/[^/]+\/documents|documents\/[^/]+(?:\/revisions(?:\/[^/]+)?)?|document-revisions\/[^/]+(?:\/content)?)$/.test(
          path,
        )
      ) {
        ledger.rejectedLegacyReads.push(path + url.search);
        return fail({
          status: 500,
          code: 'UNBOUNDED_DOCUMENT_READ',
          message: '需求PRD只读概要、分页历史、精确metadata和本例显式允许的评审正文',
        });
      }
      const detail = /^\/api\/v1\/projects\/p1\/requirements\/([^/]+)$/.exec(path);
      if (detail) {
        const key = (Object.keys(requirementIds) as RequirementKey[]).find(
          (key) => detail[1] === key || detail[1] === requirementIds[key],
        );
        if (!key)
          return fail({
            status: 404,
            code: 'RESOURCE_NOT_FOUND',
            message: 'REQUIREMENT_NOT_FOUND',
          });
        return reply({
          requirement: {
            ...baseRequirement,
            id: requirementIds[key],
            code: key,
            title: requirementTitles[key],
            seq: key === 'DEMO-001' ? 1 : 2,
          },
          acceptanceKeys: [],
          tasks: [{ ...baseTask, id: key === 'DEMO-001' ? 'task-1' : 'task-2' }],
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: 1, artifacts: 0, reviews: 0, changes: 0 },
        });
      }
      if (path === summaryPath) {
        expect(url.searchParams.get('kind')).toBe('PRD');
        expect(url.searchParams.get('limit')).toBe('50');
        expect(url.searchParams.get('status')).toBe('all');
        expect(
          [...url.searchParams.keys()].every((key) =>
            ['kind', 'limit', 'status', 'requirementId', 'cursor', 'searchProfile'].includes(key),
          ),
        ).toBe(true);
        const requirementId = url.searchParams.get('requirementId');
        const key = (Object.keys(requirementIds) as RequirementKey[]).find(
          (key) => requirementIds[key] === requirementId,
        );
        // The general project page is allowed only after explicitly following its generic navigation button.
        expect(key !== undefined || (controls.allowProjectCatalog && requirementId === null)).toBe(
          true,
        );
        const cursor = url.searchParams.get('cursor') ?? '';
        const error = controls.catalogFailures.get(`${requirementId ?? 'project'}|${cursor}`);
        if (error) return fail(error);
        const prefix = key ? `requirement-${requirementId}-` : 'project-';
        expect(cursor === '' || cursor.startsWith(prefix)).toBe(true);
        const offset = cursor ? Number(cursor.slice(prefix.length)) : 0;
        expect([0, 50, 100]).toContain(offset);
        const all = Array.from({ length: 107 }, (_, index) => summary(index + 1)).filter(
          (item) => requirementId === null || item.document.requirementId === requirementId,
        );
        return reply({
          items: all.slice(offset, offset + 50),
          total: all.length,
          nextCursor: offset + 50 < all.length ? `${prefix}${offset + 50}` : null,
        });
      }
      const singleSummary = /^\/api\/v1\/documents\/([^/]+)\/summary$/.exec(path);
      if (singleSummary) {
        const index = Array.from({ length: 107 }, (_, i) => i + 1).find(
          (index) => documentId(index) === singleSummary[1],
        );
        expect(index).toBeDefined();
        return reply(summary(index!));
      }
      const history = /^\/api\/v1\/documents\/([^/]+)\/history$/.exec(path);
      if (history) {
        const id = history[1]!;
        const index = Array.from({ length: 107 }, (_, i) => i + 1).find(
          (index) => documentId(index) === id,
        );
        expect(index).toBeDefined();
        expect(url.searchParams.get('limit')).toBe('50');
        expect([...url.searchParams.keys()].every((key) => ['limit', 'cursor'].includes(key))).toBe(
          true,
        );
        const cursor = url.searchParams.get('cursor') ?? '';
        const error = controls.historyFailures.get(`${id}|${cursor}`);
        if (error) return fail(error);
        const match = cursor ? /^history-(\d+)-(\d+)$/.exec(cursor) : null;
        if (cursor && (!match || Number(match[1]) !== version(id)))
          return fail({
            status: 409,
            code: 'RESOURCE_CONFLICT',
            message: 'HISTORY_REFRESH_REQUIRED',
          });
        const offset = match ? Number(match[2]) : 0;
        const total = revisionCount(index!);
        return reply({
          items: Array.from({ length: total }, (_, i) => revision(index!, total - i)).slice(
            offset,
            offset + 50,
          ),
          nextCursor: offset + 50 < total ? historyCursor(version(id), offset + 50) : null,
          total,
          documentVersion: version(id),
        });
      }
      const metadata = /^\/api\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/metadata$/.exec(path);
      if (metadata) {
        const id = metadata[2]!;
        const error = controls.metadataFailures.get(id);
        if (error) return fail(error);
        const index = Array.from({ length: 107 }, (_, i) => i + 1).find(
          (index) => documentId(index) === metadata[1],
        );
        const seq = index
          ? Array.from({ length: index === targetIndex ? 123 : 3 }, (_, i) => i + 1).find(
              (seq) => revisionId(index, seq) === id,
            )
          : undefined;
        if (!index || !seq)
          return fail({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'REVISION_NOT_FOUND' });
        return reply(revision(index, seq));
      }
      const discussions =
        /^\/api\/v1\/review-requests\/requirement-review-([^/]+)\/discussions$/.exec(path);
      if (discussions) {
        expect(revisionIdentities.has(discussions[1]!)).toBe(true);
        expect([...url.searchParams]).toEqual([]);
        return reply({ items: [], nextCursor: null, unresolvedCount: 0, canCreate: false });
      }
      const review = /^\/api\/v1\/review-requests\/requirement-review-([^/]+)$/.exec(path);
      if (review) {
        const identity = revisionIdentities.get(review[1]!);
        expect(identity).toBeDefined();
        const item = revision(identity!.index, identity!.seq);
        return reply({
          id: `requirement-review-${item.id}`,
          projectId: 'p1',
          kind: 'PRD_PUBLICATION',
          status: 'OPEN',
          version: 2,
          subjectDigest: item.digest,
          documentRevisionId: item.id,
          artifactSetId: null,
          taskId: null,
          slots: [],
          decisions: [],
          subject: {
            documentId: item.documentId,
            knowledgeBaseId: 'kb-1',
            documentVersion: version(item.documentId),
            currentPublishedRevisionId: revisionId(identity!.index, publishedSeq(identity!.index)),
            revisionId: item.id,
            revisionDigest: item.digest,
          },
          requirement: {
            id: requirementIds[ownerOf(identity!.index)],
            code: ownerOf(identity!.index),
            title: requirementTitles[ownerOf(identity!.index)],
          },
        });
      }
      return route.fallback();
    },
  );
  return { ledger, controls, getRequests };
}

function prdTab(page: Page) {
  return page.getByRole('tab', { name: /^PRD/ });
}
function panel(page: Page) {
  return page.getByRole('region', { name: '需求 PRD 文档', exact: true });
}
function historyRegion(page: Page) {
  return page.getByRole('region', { name: 'PRD 修订历史', exact: true });
}
function publication(page: Page) {
  return page.getByTestId('requirement-prd-published-revision');
}
function historyRow(page: Page, seq: number): Locator {
  return historyRegion(page)
    .getByRole('listitem')
    .filter({ has: page.locator('span.cell-mono').filter({ hasText: new RegExp(`^v${seq}$`) }) });
}

async function visitRequirement(page: Page, key: RequirementKey = 'DEMO-001', active = false) {
  await page.goto(`/requirements/${key}?projectId=p1${active ? '&tab=prd' : ''}`);
  await expect(
    page.getByRole('heading', { name: requirementTitles[key], exact: true }),
  ).toBeVisible();
}
async function openTarget(page: Page) {
  await visitRequirement(page, 'DEMO-001', true);
  await expect(prdTab(page)).toContainText('57');
  await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
  await expect(
    panel(page).getByRole('button', {
      name: `查看修订 ${revisionTitle(targetIndex)}`,
      exact: true,
    }),
  ).toBeVisible();
  await panel(page)
    .getByRole('button', { name: `查看修订 ${revisionTitle(targetIndex)}`, exact: true })
    .click();
  await expect(
    historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
  ).toBeVisible();
}
async function switchRequirement(page: Page, key: RequirementKey, active = true) {
  await page.evaluate(
    ({ key, active }) => {
      window.history.pushState(
        null,
        '',
        `/requirements/${key}?projectId=p1${active ? '&tab=prd' : ''}`,
      );
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    { key, active },
  );
  await expect(
    page.getByRole('heading', { name: requirementTitles[key], exact: true }),
  ).toBeVisible();
}

test.afterEach(async ({ page }, testInfo) => {
  const ledger = ledgers.get(page);
  if (!ledger) return;
  ledgers.delete(page);
  await testInfo.attach('requirement-prd-summary-network-ledger', {
    body: JSON.stringify(ledger, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.rejectedLegacyReads, '需求PRD只使用有界入口与显式允许的评审正文').toEqual([]);
  expect(ledger.rejectedWrites, '需求PRD只读验收不得写入').toEqual([]);
  expect(JSON.stringify(ledger)).not.toMatch(/ticketSecret|password|authorization|cookie/i);
});

for (const width of [1440, 390]) {
  test(`${width}px PRD未激活只读按真实需求UUID过滤的一页概要，badge来自57准确总数而非项目首50`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitRequirement(page);
    await expect(prdTab(page)).toContainText('57');
    await expect(prdTab(page)).toHaveAttribute('aria-selected', 'false');
    expect(fixture.getRequests(summaryPath)).toHaveLength(1);
    const query = new URL(fixture.getRequests(summaryPath)[0]!.path, 'http://fixture').searchParams;
    expect(query.get('requirementId')).toBe(requirementIds['DEMO-001']);
    expect(query.get('requirementId')).not.toBe('DEMO-001');
    expect(query.has('cursor')).toBe(false);
    expect(
      fixture.ledger.requests.filter(
        (entry) =>
          entry.path.includes('/history') ||
          entry.path.includes('/metadata') ||
          entry.path.endsWith('/content'),
      ),
    ).toEqual([]);
    await prdTab(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('57');
    await expect(page.getByTestId('requirement-prd-catalog').getByRole('article')).toHaveCount(50);
    expect(fixture.getRequests(summaryPath)).toHaveLength(1);
    await expect(
      panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(51)}`, exact: true }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(1)}`, exact: true }),
    ).toHaveCount(0);
    await expect(historyRegion(page)).toHaveCount(0);
    await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
    await expect(
      panel(page).getByRole('button', {
        name: `查看修订 ${revisionTitle(targetIndex)}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByTestId('requirement-prd-catalog').getByRole('article')).toHaveCount(7);
    await expect(
      panel(page).getByRole('button', { name: '下一页 PRD', exact: true }),
    ).toBeDisabled();
    const queries = fixture
      .getRequests(summaryPath)
      .map((entry) => new URL(entry.path, 'http://fixture').searchParams);
    expect(queries.map((query) => query.get('cursor'))).toEqual([
      null,
      catalogCursor('DEMO-001', 50),
    ]);
    expect(
      queries.every((query) => query.get('requirementId') === requirementIds['DEMO-001']),
    ).toBe(true);
    await expect(panel(page)).toContainText('候选 122 个');
    await expect(panel(page)).toContainText('可见修订 123 个');
    expect(fixture.getRequests(historyPath())).toHaveLength(0);
    await panel(page).getByRole('button', { name: '上一页 PRD', exact: true }).click();
    await expect(
      panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(51)}`, exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(summaryPath)).toHaveLength(3);
  });

  test(`${width}px badge在概要未读或首次503时显示未知，失败不显示0或没有PRD，独立重试恢复`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    const pending = latch();
    fixture.controls.gates.push({ pathname: summaryPath, ready: pending.ready });
    fixture.controls.catalogFailures.set(`${requirementIds['DEMO-001']}|`, {
      status: 503,
      code: 'SUMMARY_UNAVAILABLE',
      message: '需求PRD概要暂不可用',
    });
    await page.setViewportSize({ width, height: 1000 });
    try {
      await visitRequirement(page);
      await expect(prdTab(page)).toContainText('—');
      await expect(prdTab(page)).not.toContainText('0');
      pending.release();
      await prdTab(page).click();
      await expect(panel(page).getByRole('alert')).toContainText('需求PRD概要暂不可用');
      await expect(prdTab(page)).toContainText('—');
      await expect(panel(page)).not.toContainText('该需求还没有');
      fixture.controls.catalogFailures.clear();
      await panel(page).getByRole('button', { name: '刷新 PRD 列表', exact: true }).click();
      await expect(prdTab(page)).toContainText('57');
      expect(fixture.getRequests(summaryPath)).toHaveLength(2);
      expect(fixture.getRequests(historyPath())).toHaveLength(0);
    } finally {
      pending.release();
    }
  });

  test(`${width}px 目录续页503保留旧页并标过期，badge不把旧数当当前事实且重试同游标`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitRequirement(page, 'DEMO-001', true);
    await expect(prdTab(page)).toContainText('57');
    fixture.controls.catalogFailures.set(
      `${requirementIds['DEMO-001']}|${catalogCursor('DEMO-001', 50)}`,
      { status: 503, code: 'SUMMARY_PAGE_UNAVAILABLE', message: 'PRD目录续页暂不可用' },
    );
    await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
    await expect(panel(page).getByRole('alert')).toContainText('PRD目录续页暂不可用');
    await expect(panel(page)).toContainText(/过期/);
    await expect(
      panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(51)}`, exact: true }),
    ).toBeVisible();
    await expect(
      panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(51)}`, exact: true }),
    ).toBeDisabled();
    await expect(prdTab(page)).toContainText('—');
    fixture.controls.catalogFailures.clear();
    await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
    await expect(
      panel(page).getByRole('button', {
        name: `查看修订 ${revisionTitle(targetIndex)}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(prdTab(page)).toContainText('57');
    expect(
      fixture
        .getRequests(summaryPath)
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, catalogCursor('DEMO-001', 50), catalogCursor('DEMO-001', 50)]);
  });

  test(`${width}px 仅显式展开文档才读唯一历史，按50/100/123顺序去重且准确候选不取已读条数`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await expect(historyRegion(page)).toHaveCount(1);
    await expect(historyRegion(page).getByRole('listitem')).toHaveCount(50);
    await expect(historyRow(page, 123)).toBeVisible();
    await expect(historyRow(page, 2)).toHaveCount(0);
    await expect(panel(page)).toContainText('候选 122 个');
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 100 / 123 条历史', { exact: true }),
    ).toBeVisible();
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 123 / 123 条历史', { exact: true }),
    ).toBeVisible();
    const sequence = await historyRegion(page)
      .getByRole('listitem')
      .locator('span.cell-mono')
      .allTextContents();
    expect(sequence.map((value) => Number(value.trim().slice(1)))).toEqual(
      Array.from({ length: 123 }, (_, index) => 123 - index),
    );
    expect(new Set(sequence).size).toBe(123);
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), historyCursor(17, 100)]);
    await panel(page)
      .getByRole('button', { name: `查看修订 ${revisionTitle(101)}`, exact: true })
      .click();
    await expect(historyRegion(page)).toHaveCount(1);
    await expect(
      historyRegion(page).getByText('已加载 3 / 3 条历史', { exact: true }),
    ).toBeVisible();
    await expect(historyRegion(page)).not.toContainText(title(targetIndex));
    expect(fixture.getRequests(historyPath(documentId(101)))).toHaveLength(1);
  });

  test(`${width}px 首历史页外的发布r2按准确metadata读取并进入canonical评审，可见评审UI与修订一致`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await expect(publication(page)).toContainText('v2');
    expect(fixture.getRequests(metadataPath())).toHaveLength(0);
    await publication(page)
      .getByRole('button', { name: '查看当前发布修订信息', exact: true })
      .click();
    await expect(publication(page)).toContainText(revisionTitle(targetIndex));
    await expect.poll(() => fixture.getRequests(metadataPath()).length).toBe(1);
    await expect(publication(page)).toContainText('已读取准确修订 v2');
    await expect(
      historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(historyPath())).toHaveLength(1);
    expect(fixture.getRequests(metadataPath(targetRevision(123)))).toHaveLength(0);
    expect(fixture.ledger.requests.filter((entry) => entry.path.endsWith('/content'))).toEqual([]);
    fixture.controls.allowedReviewContent.add(targetRevision(2));
    const reviewPath = `/api/v1/review-requests/requirement-review-${targetRevision(2)}`;
    const reviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reviewPath && response.request().method() === 'GET',
    );
    await publication(page).getByRole('button', { name: '评审当前发布修订', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reviews/requirement-review-${targetRevision(2)}$`));
    await expect.poll(() => fixture.getRequests(reviewPath).length).toBe(1);
    expect(await (await reviewResponse).json()).toMatchObject({
      data: {
        id: `requirement-review-${targetRevision(2)}`,
        documentRevisionId: targetRevision(2),
        subject: {
          documentId: targetId,
          revisionId: targetRevision(2),
          currentPublishedRevisionId: targetRevision(2),
        },
      },
    });
    await expect(
      page.getByRole('heading', { level: 2, name: revisionTitle(targetIndex, 2), exact: true }),
    ).toBeVisible();
    await expect(page.locator('.req-head').getByText('PRD 发布', { exact: true })).toBeVisible();
    await expect(page.locator('pre.paper-content')).toHaveText('共同开头\n当前发布第2版\n共同结尾');
    expect(fixture.getRequests(metadataPath())).toHaveLength(2);
    expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(1);
    await expect(
      page
        .getByRole('region', { name: '结构化评审问题', exact: true })
        .getByText('没有本轮问题或此前轮次的未解决问题。', { exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(`${reviewPath}/discussions`)).toHaveLength(1);
  });

  test(`${width}px 历史第二页候选评审保留准确r73而不替换成发布r2`, async ({ page }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 100 / 123 条历史', { exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(metadataPath())).toHaveLength(0);
    expect(fixture.ledger.requests.filter((entry) => entry.path.endsWith('/content'))).toEqual([]);
    fixture.controls.allowedReviewContent.add(targetRevision(73));
    fixture.controls.allowedReviewContent.add(targetRevision(2));
    const reviewPath = `/api/v1/review-requests/requirement-review-${targetRevision(73)}`;
    const reviewResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === reviewPath && response.request().method() === 'GET',
    );
    await historyRow(page, 73).getByRole('button', { name: '评审修订 v73', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reviews/requirement-review-${targetRevision(73)}$`));
    await expect.poll(() => fixture.getRequests(reviewPath).length).toBe(1);
    expect(await (await reviewResponse).json()).toMatchObject({
      data: {
        id: `requirement-review-${targetRevision(73)}`,
        documentRevisionId: targetRevision(73),
        subject: {
          documentId: targetId,
          revisionId: targetRevision(73),
          currentPublishedRevisionId: targetRevision(2),
        },
      },
    });
    await expect(
      page.getByRole('heading', { level: 2, name: revisionTitle(targetIndex, 73), exact: true }),
    ).toBeVisible();
    await expect(page.locator('.req-head').getByText('PRD 发布', { exact: true })).toBeVisible();
    await expect(page.locator('pre.paper-content')).toHaveText(
      '共同开头\n准确PRD修订第73版\n共同结尾',
    );
    expect(fixture.getRequests(metadataPath(targetRevision(73)))).toHaveLength(1);
    expect(fixture.getRequests(metadataPath())).toHaveLength(0);
    expect(fixture.getRequests(contentPath(targetRevision(73)))).toHaveLength(1);
    expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(1);
    await expect(
      page
        .getByRole('region', { name: '结构化评审问题', exact: true })
        .getByText('没有本轮问题或此前轮次的未解决问题。', { exact: true }),
    ).toBeVisible();
    expect(fixture.getRequests(`${reviewPath}/discussions`)).toHaveLength(1);
  });

  test(`${width}px 历史503保留50条并禁旧评审，同游标重试后可继续`, async ({ page }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    const key = `${targetId}|${historyCursor(17, 50)}`;
    fixture.controls.historyFailures.set(key, {
      status: 503,
      code: 'HISTORY_UNAVAILABLE',
      message: '需求PRD历史续页暂不可用',
    });
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(historyRegion(page).getByRole('alert').first()).toContainText(
      '需求PRD历史续页暂不可用',
    );
    await expect(
      historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
    ).toBeVisible();
    const review = historyRow(page, 123).getByRole('button', {
      name: '评审修订 v123',
      exact: true,
    });
    await expect(review).toBeDisabled();
    fixture.controls.historyFailures.delete(key);
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 100 / 123 条历史', { exact: true }),
    ).toBeVisible();
    await expect(review).toBeEnabled();
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), historyCursor(17, 50)]);
  });

  test(`${width}px 精确发布metadata403清除发布卡历史及所有评审，明确失败而不回退首修订`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    fixture.controls.metadataFailures.set(targetRevision(2), {
      status: 403,
      code: 'FORBIDDEN',
      message: 'PUBLISHED_REVISION_ACCESS_REVOKED',
    });
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await publication(page)
      .getByRole('button', { name: '查看当前发布修订信息', exact: true })
      .click();
    await expect(
      historyRegion(page)
        .getByRole('alert')
        .filter({ hasText: 'PUBLISHED_REVISION_ACCESS_REVOKED' })
        .first(),
    ).toBeVisible();
    await expect(publication(page)).toHaveCount(0);
    await expect(historyRegion(page).getByTestId('requirement-prd-history-list')).toHaveCount(0);
    await expect(historyRegion(page).getByRole('button', { name: /^评审/ })).toHaveCount(0);
    expect(fixture.getRequests(metadataPath(targetRevision(123)))).toHaveLength(0);
    await expect(prdTab(page)).toContainText('57');
    await expect(panel(page)).not.toContainText('该需求还没有');
  });

  test(`${width}px 409停止旧历史续页并刷新版本18，准确metadata缓存随概要发布变化失效`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await publication(page)
      .getByRole('button', { name: '查看当前发布修订信息', exact: true })
      .click();
    await expect(
      publication(page).getByRole('button', { name: '评审当前发布修订', exact: true }),
    ).toBeVisible();
    fixture.controls.versions.set(targetId, 18);
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page)
        .getByRole('alert')
        .filter({ hasText: 'HISTORY_REFRESH_REQUIRED' })
        .first(),
    ).toBeVisible();
    await expect(historyRegion(page)).toContainText('历史已变化，请刷新历史后继续。');
    await expect(
      historyRegion(page).getByRole('button', { name: '加载更多 PRD 修订', exact: true }),
    ).toHaveCount(0);
    await historyRegion(page).getByRole('button', { name: '刷新 PRD 历史', exact: true }).click();
    await expect(
      historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
    ).toBeVisible();
    await expect(historyRegion(page)).toContainText(
      '文档版本已变化，请刷新 PRD 列表后查看当前修订。',
    );
    await expect(
      historyRegion(page).getByRole('button', { name: '加载更多 PRD 修订', exact: true }),
    ).toHaveCount(0);
    await historyRegion(page).getByRole('button', { name: '刷新文档版本', exact: true }).click();
    await expect(historyRegion(page)).toHaveCount(0);
    await expect(prdTab(page)).toContainText('57');
    await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
    await panel(page)
      .getByRole('button', { name: `查看修订 ${revisionTitle(targetIndex)}`, exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
    ).toBeVisible();
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page).getByText('已加载 100 / 123 条历史', { exact: true }),
    ).toBeVisible();
    expect(
      fixture
        .getRequests(historyPath())
        .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, historyCursor(17, 50), null, null, historyCursor(18, 50)]);
    fixture.controls.publishedSeq.set(targetId, 7);
    await panel(page).getByRole('button', { name: '刷新 PRD 列表', exact: true }).click();
    await expect(historyRegion(page)).toHaveCount(0);
    await panel(page).getByRole('button', { name: '下一页 PRD', exact: true }).click();
    await panel(page)
      .getByRole('button', { name: `查看修订 ${revisionTitle(targetIndex, 7)}`, exact: true })
      .click();
    await expect(publication(page)).toContainText('v7');
    await expect(
      publication(page).getByRole('button', { name: '评审当前发布修订', exact: true }),
    ).toHaveCount(0);
    await publication(page)
      .getByRole('button', { name: '查看当前发布修订信息', exact: true })
      .click();
    await expect.poll(() => fixture.getRequests(metadataPath(targetRevision(7))).length).toBe(1);
    await expect(publication(page)).toContainText('已读取准确修订 v7');
    await expect(publication(page)).toContainText(revisionTitle(targetIndex, 7));
  });

  test(`${width}px 同版本历史total改变必须刷新，保留旧50但不混入当前122集合`, async ({ page }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    fixture.controls.totals.set(targetId, 122);
    await historyRegion(page)
      .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
      .click();
    await expect(
      historyRegion(page)
        .getByRole('alert')
        .filter({ hasText: 'HISTORY_REFRESH_REQUIRED' })
        .first(),
    ).toBeVisible();
    await expect(historyRegion(page).getByRole('listitem')).toHaveCount(50);
    await expect(historyRow(page, 73)).toHaveCount(0);
    await historyRegion(page).getByRole('button', { name: '刷新 PRD 历史', exact: true }).click();
    await expect(
      historyRegion(page).getByText('已加载 50 / 122 条历史', { exact: true }),
    ).toBeVisible();
    await expect(historyRow(page, 123)).toHaveCount(0);
    await expect(historyRow(page, 122)).toBeVisible();
    expect(fixture.getRequests(historyPath())).toHaveLength(3);
  });

  test(`${width}px 跨需求迟到概要不覆盖新需求badge列表，也不跟随旧游标继续聚合`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    const old = latch();
    fixture.controls.gates.push({
      pathname: summaryPath,
      query: { requirementId: requirementIds['DEMO-001'] },
      ready: old.ready,
    });
    await page.setViewportSize({ width, height: 1000 });
    try {
      const request = waitForRead(page, summaryPath, { requirementId: requirementIds['DEMO-001'] });
      await visitRequirement(page);
      await expect(prdTab(page)).toContainText('—');
      await expect.poll(() => fixture.controls.gates[0]!.used).toBe(true);
      await switchRequirement(page, 'DEMO-002');
      await expect(prdTab(page)).toContainText('50');
      await expect(
        panel(page).getByRole('button', { name: `查看修订 ${revisionTitle(1)}`, exact: true }),
      ).toBeVisible();
      const before = fixture.ledger.requests.length;
      old.release();
      await finishOrAbort(await request);
      await afterBrowserPaint(page);
      await expect(prdTab(page)).toContainText('50');
      await expect(panel(page)).not.toContainText(title(targetIndex));
      await expect(historyRegion(page)).toHaveCount(0);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 跨需求迟到历史续页和精确metadata不恢复旧发布评审或旧修订`, async ({ page }) => {
    const fixture = await installRequirementPrdFixtures(page);
    const old = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push(
        { pathname: historyPath(), query: { cursor: historyCursor(17, 50) }, ready: old.ready },
        { pathname: metadataPath(), ready: old.ready },
      );
      const historyRequest = waitForRead(page, historyPath(), { cursor: historyCursor(17, 50) });
      const metadataRequest = waitForRead(page, metadataPath());
      await publication(page)
        .getByRole('button', { name: '查看当前发布修订信息', exact: true })
        .click();
      await expect.poll(() => fixture.getRequests(metadataPath()).length).toBe(1);
      await historyRegion(page)
        .getByRole('button', { name: '加载更多 PRD 修订', exact: true })
        .click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(2);
      await switchRequirement(page, 'DEMO-002');
      await expect(prdTab(page)).toContainText('50');
      await panel(page)
        .getByRole('button', { name: `查看修订 ${revisionTitle(1)}`, exact: true })
        .click();
      await expect(
        historyRegion(page).getByText('已加载 3 / 3 条历史', { exact: true }),
      ).toBeVisible();
      const before = fixture.ledger.requests.length;
      old.release();
      await finishOrAbort(await historyRequest);
      await finishOrAbort(await metadataRequest);
      await afterBrowserPaint(page);
      await expect(historyRegion(page)).not.toContainText(title(targetIndex));
      await expect(publication(page)).toContainText(revisionTitle(1));
      await expect(
        publication(page).getByRole('button', { name: '评审当前发布修订', exact: true }),
      ).toHaveCount(0);
      expect(fixture.getRequests(historyPath(documentId(1)))).toHaveLength(1);
      expect(fixture.ledger.requests).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 键盘激活PRD与分页展开，通用项目入口携带projectId且无横向溢出`, async ({
    page,
  }) => {
    const fixture = await installRequirementPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await visitRequirement(page);
    await expect(prdTab(page)).toContainText('57');
    await prdTab(page).focus();
    await page.keyboard.press('Enter');
    await expect(prdTab(page)).toHaveAttribute('aria-selected', 'true');
    const next = panel(page).getByRole('button', { name: '下一页 PRD', exact: true });
    await next.focus();
    await page.keyboard.press('Enter');
    const open = panel(page).getByRole('button', {
      name: `查看修订 ${revisionTitle(targetIndex)}`,
      exact: true,
    });
    await expect(open).toBeVisible();
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(
      historyRegion(page).getByText('已加载 50 / 123 条历史', { exact: true }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    const project = panel(page)
      .getByRole('button', { name: '打开项目文档页', exact: true })
      .first();
    fixture.controls.allowProjectCatalog = true;
    await project.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/prd\?projectId=p1$/);
    expect(fixture.ledger.rejectedWrites).toEqual([]);
  });
}
