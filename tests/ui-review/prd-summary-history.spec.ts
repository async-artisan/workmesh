import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import type { DocumentSummary } from '../../apps/web/src/api/documentSummaries';
import type { RevisionView } from '../../apps/web/src/api/resources';
import { installReviewFixtures } from './fixtures';

type ProjectId = 'p1' | 'p2';
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
interface RequestEntry {
  method: string;
  path: string;
}
interface ActionBinding {
  action: string;
  projectId: string;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  roleSlot: null;
  payload: { reason: string };
}
interface WithdrawalEntry {
  documentId: string;
  expectedVersion: number;
  reason: string;
  ticketId: string;
}
interface Ledger {
  requests: RequestEntry[];
  rejectedLegacyReads: string[];
  rejectedWrites: string[];
  previews: ActionBinding[];
  ticketBindings: ActionBinding[];
  withdrawals: WithdrawalEntry[];
}

const ledgers = new Map<Page, Ledger>();
const targetIndex = 107;
const earlySearch = '归档税率条款';
const actionDigest = 'd'.repeat(64);
const documentId = (index: number, projectId: ProjectId = 'p1') =>
  `${projectId === 'p1' ? '10000000' : '20000000'}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const revisionId = (index: number, seq: number, projectId: ProjectId = 'p1') =>
  `${projectId === 'p1' ? '30000000' : '40000000'}-0000-4000-8000-${String(index).padStart(4, '0')}${String(seq).padStart(8, '0')}`;
const targetId = documentId(targetIndex);
const targetRevision = (seq: number) => revisionId(targetIndex, seq);
const title = (index: number, projectId: ProjectId = 'p1') =>
  projectId === 'p2'
    ? '另一项目独立 PRD'
    : index === targetIndex
      ? '远页税率 PRD'
      : `目录 PRD ${String(index).padStart(3, '0')}`;
const historyPath = (id = targetId) => `/api/v1/documents/${id}/history`;
const metadataPath = (id: string, document = targetId) =>
  `/api/v1/documents/${document}/revisions/${id}/metadata`;
const contentPath = (id: string) => `/api/v1/document-revisions/${id}/content`;
const summaryPath = (projectId: ProjectId = 'p1') =>
  `/api/v1/projects/${projectId}/document-summaries`;
const historyCursor = (version: number, offset: number) => `history-${version}-${offset}`;

function latch() {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { ready, release };
}

async function afterBrowserPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function finishOrAbort(request: Request) {
  const response = await request.response();
  if (response) await response.finished();
}

async function installPrdFixtures(page: Page) {
  await installReviewFixtures(page);
  const ledger: Ledger = {
    requests: [],
    rejectedLegacyReads: [],
    rejectedWrites: [],
    previews: [],
    ticketBindings: [],
    withdrawals: [],
  };
  ledgers.set(page, ledger);
  const controls = {
    gates: [] as Gate[],
    historyFailures: new Map<string, ApiFailure>(),
    metadataFailures: new Map<string, ApiFailure>(),
    contentFailures: new Map<string, ApiFailure>(),
    versions: new Map<string, number>([[targetId, 17]]),
    withdrawn: new Set<string>(),
    allowWithdraw: false,
    conflictOnNextWithdraw: false,
  };
  const identities = new Map<string, { index: number; projectId: ProjectId }>();
  const revisionIdentities = new Map<
    string,
    { index: number; seq: number; projectId: ProjectId }
  >();
  for (const projectId of ['p1', 'p2'] as const) {
    for (let index = 1; index <= (projectId === 'p1' ? 107 : 1); index += 1) {
      identities.set(documentId(index, projectId), { index, projectId });
      const count = projectId === 'p1' && index === targetIndex ? 123 : 3;
      for (let seq = 1; seq <= count; seq += 1)
        revisionIdentities.set(revisionId(index, seq, projectId), { index, seq, projectId });
    }
  }
  const version = (id: string) => controls.versions.get(id) ?? 3;
  function revision(
    index: number,
    seq: number,
    projectId: ProjectId = 'p1',
  ): RevisionView & { projectId: ProjectId; knowledgeBaseId: string } {
    const id = documentId(index, projectId);
    return {
      id: revisionId(index, seq, projectId),
      documentId: id,
      projectId,
      knowledgeBaseId: `kb-${projectId}`,
      seq,
      title: `${title(index, projectId)} · ${seq === 1 && index === targetIndex && projectId === 'p1' ? earlySearch : `修订 ${seq}`}`,
      mimeType: seq === 7 ? 'text/plain; charset=utf-8' : 'text/markdown; charset=utf-8',
      byteLength: 80,
      digest: seq.toString(16).padStart(64, '0'),
      state: seq === 2 && !controls.withdrawn.has(id) ? 'PUBLISHED' : 'CANDIDATE',
      createdBy: 'fixture-user',
      basisUnderstandingRevisionId: null,
      deliveryScope: null,
      acceptance: [
        { key: 'catalog-behavior', text: '文档与修订始终使用真实标识', verification: 'TEST' },
      ],
      reviewRequestId: seq === 2 ? null : `review-${revisionId(index, seq, projectId)}`,
    };
  }
  function summary(index: number, projectId: ProjectId = 'p1'): DocumentSummary {
    const id = documentId(index, projectId);
    const count = projectId === 'p1' && index === targetIndex ? 123 : 3;
    const compact = (seq: number) => {
      const item = revision(index, seq, projectId);
      return {
        id: item.id,
        documentId: id,
        seq,
        title: item.title,
        digest: item.digest,
        state: item.state as 'CANDIDATE' | 'PUBLISHED',
      };
    };
    return {
      document: {
        id,
        projectId,
        knowledgeBaseId: `kb-${projectId}`,
        requirementId: projectId === 'p1' ? 'req-1' : null,
        kind: 'PRD',
        version: version(id),
        currentPublishedRevisionId: controls.withdrawn.has(id)
          ? null
          : revisionId(index, 2, projectId),
        archivedAt: null,
      },
      updatedAt: new Date(Date.UTC(2026, 10, 10, 0, 0, 108 - index)).toISOString(),
      knowledgeBase: { id: `kb-${projectId}`, name: 'PRD 验收知识库', kind: 'BUSINESS' },
      requirement:
        projectId === 'p1'
          ? { id: 'req-1', code: 'DEMO-001', title: '移动端结算与登录改版' }
          : null,
      latestVisibleRevision: compact(count),
      publishedRevision: controls.withdrawn.has(id) ? null : compact(2),
      visibleRevisionCount: count,
      candidateRevisionCount: count - (controls.withdrawn.has(id) ? 0 : 1),
    };
  }
  const getRequests = (pathname: string) =>
    ledger.requests.filter(
      (entry) =>
        entry.method === 'GET' && new URL(entry.path, 'http://fixture').pathname === pathname,
    );
  const gates = async (url: URL) => {
    const gate = controls.gates.find(
      (item) =>
        !item.used &&
        item.pathname === url.pathname &&
        Object.entries(item.query ?? {}).every(
          ([key, value]) => url.searchParams.get(key) === value,
        ),
    );
    if (gate) {
      gate.used = true;
      await gate.ready;
    }
  };
  let ticketNo = 0;
  const tickets = new Map<string, { binding: ActionBinding; secret: string; used: boolean }>();
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      ledger.requests.push({ method, path: path + url.search });
      const reply = async (data: unknown, status = 200) => {
        await gates(url);
        return route.fulfill({
          status,
          json: { data, meta: { requestId: 'prd-summary-history-fixture' } },
        });
      };
      const fail = async (error: ApiFailure) => {
        await gates(url);
        return route.fulfill({
          status: error.status,
          json: {
            error: {
              code: error.code,
              message: error.message,
              requestId: 'prd-summary-history-fixture',
            },
          },
        });
      };
      const withdrawMatch = /^\/api\/v1\/documents\/([^/]+)\/withdraw$/.exec(path);
      if (method !== 'GET') {
        const allowed =
          controls.allowWithdraw &&
          method === 'POST' &&
          (path === '/api/v1/auth/action-previews' ||
            path === '/api/v1/auth/confirmation-tickets' ||
            withdrawMatch);
        if (!allowed) {
          ledger.rejectedWrites.push(`${method} ${path}`);
          return fail({
            status: 405,
            code: 'UNEXPECTED_WRITE',
            message: '只有明确撤销场景允许写入',
          });
        }
        expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
        const body = request.postDataJSON();
        if (
          path === '/api/v1/auth/action-previews' ||
          path === '/api/v1/auth/confirmation-tickets'
        ) {
          const binding: ActionBinding = {
            action: body.action,
            projectId: body.projectId,
            targetType: body.targetType,
            targetId: body.targetId,
            expectedVersion: body.expectedVersion,
            roleSlot: body.roleSlot,
            payload: body.payload,
          };
          expect(binding).toMatchObject({
            action: 'KNOWLEDGE_WITHDRAW',
            projectId: 'p1',
            targetType: 'KNOWLEDGE_DOCUMENT',
            targetId,
            roleSlot: null,
          });
          if (path.endsWith('/action-previews')) {
            ledger.previews.push(binding);
            return reply({ binding, actionDigest, display: { ...binding } });
          }
          expect(body.actionDigest).toBe(actionDigest);
          expect(body.password).toBe('fixture-password');
          ledger.ticketBindings.push(binding);
          ticketNo += 1;
          const ticketId = `prd-ticket-${ticketNo}`;
          const secret = `fixture-ticket-secret-${ticketNo}`;
          tickets.set(ticketId, { binding, secret, used: false });
          return reply(
            { ticketId, ticketSecret: secret, expiresAt: '2099-01-01T00:00:00.000Z', actionDigest },
            201,
          );
        }
        const id = withdrawMatch![1]!;
        expect(request.headers()['idempotency-key']).toBeTruthy();
        const ticket = tickets.get(body.confirmation?.ticketId);
        expect(ticket, '撤销必须使用已经签发的票据').toBeDefined();
        expect(ticket!.used).toBe(false);
        expect(body.confirmation.ticketSecret).toBe(ticket!.secret);
        expect(body).toEqual({
          expectedVersion: ticket!.binding.expectedVersion,
          reason: ticket!.binding.payload.reason,
          confirmation: { ticketId: body.confirmation.ticketId, ticketSecret: ticket!.secret },
        });
        ticket!.used = true;
        ledger.withdrawals.push({
          documentId: id,
          expectedVersion: body.expectedVersion,
          reason: body.reason,
          ticketId: body.confirmation.ticketId,
        });
        if (controls.conflictOnNextWithdraw) {
          controls.conflictOnNextWithdraw = false;
          controls.versions.set(id, version(id) + 1);
          return fail({
            status: 409,
            code: 'VERSION_CONFLICT',
            message: '文档版本已变化，请刷新后重新确认',
          });
        }
        expect(body.expectedVersion).toBe(version(id));
        controls.withdrawn.add(id);
        controls.versions.set(id, version(id) + 1);
        return reply({ documentVersion: version(id), publicationId: null });
      }
      if (
        /^\/api\/v1\/(?:projects\/[^/]+\/documents|knowledge-bases\/[^/]+\/documents|documents\/[^/]+(?:\/revisions(?:\/[^/]+)?)?|document-revisions\/[^/]+)$/.test(
          path,
        )
      ) {
        ledger.rejectedLegacyReads.push(path + url.search);
        return fail({
          status: 500,
          code: 'LEGACY_DOCUMENT_READ',
          message: 'PRD 目录不得退回全量文档或修订读取',
        });
      }
      const summaries = /^\/api\/v1\/projects\/(p[12])\/document-summaries$/.exec(path);
      if (summaries) {
        const projectId = summaries[1] as ProjectId;
        const query = url.searchParams.get('q')?.trim().toLowerCase() ?? '';
        const status = url.searchParams.get('status') ?? 'all';
        expect(url.searchParams.get('kind')).toBe('PRD');
        expect(url.searchParams.get('searchProfile')).toBe('prd');
        expect(url.searchParams.get('limit')).toBe('50');
        expect(query.length).toBeLessThanOrEqual(100);
        expect(['all', 'candidate', 'published']).toContain(status);
        expect(
          [...url.searchParams.keys()].every((key) =>
            ['kind', 'searchProfile', 'q', 'status', 'limit', 'cursor'].includes(key),
          ),
        ).toBe(true);
        const items = Array.from({ length: projectId === 'p1' ? 107 : 1 }, (_, index) =>
          summary(index + 1, projectId),
        ).filter((item) => {
          if (status === 'published' && !item.publishedRevision) return false;
          if (status === 'candidate' && !item.candidateRevisionCount) return false;
          if (!query) return true;
          const identity = identities.get(item.document.id)!;
          const revisions = Array.from({ length: item.visibleRevisionCount }, (_, seq) =>
            revision(identity.index, seq + 1, projectId),
          );
          return [
            'PRD',
            item.requirement?.code ?? '',
            item.requirement?.title ?? '',
            ...revisions.flatMap((item) => [
              item.title,
              `v${item.seq}`,
              item.state,
              item.state === 'PUBLISHED' ? '已发布' : '候选',
            ]),
          ]
            .join(' ')
            .toLowerCase()
            .includes(query);
        });
        const cursor = url.searchParams.get('cursor');
        const prefix = `catalog-${projectId}-${encodeURIComponent(query)}-${status}-`;
        expect(cursor === null || cursor.startsWith(prefix)).toBe(true);
        const offset = cursor ? Number(cursor.slice(prefix.length)) : 0;
        expect([0, 50, 100]).toContain(offset);
        return reply({
          items: items.slice(offset, offset + 50),
          nextCursor: offset + 50 < items.length ? `${prefix}${offset + 50}` : null,
          total: items.length,
        });
      }
      const singleSummary = /^\/api\/v1\/documents\/([^/]+)\/summary$/.exec(path);
      if (singleSummary) {
        const identity = identities.get(singleSummary[1]!);
        expect(identity).toBeDefined();
        return reply(summary(identity!.index, identity!.projectId));
      }
      const history = /^\/api\/v1\/documents\/([^/]+)\/history$/.exec(path);
      if (history) {
        const id = history[1]!;
        const identity = identities.get(id)!;
        expect(identity).toBeDefined();
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
        const count = identity.projectId === 'p1' && identity.index === targetIndex ? 123 : 3;
        const items = Array.from({ length: count }, (_, index) =>
          revision(identity.index, count - index, identity.projectId),
        );
        return reply({
          items: items.slice(offset, offset + 50),
          nextCursor: offset + 50 < count ? historyCursor(version(id), offset + 50) : null,
          total: count,
          documentVersion: version(id),
        });
      }
      const metadata = /^\/api\/v1\/documents\/([^/]+)\/revisions\/([^/]+)\/metadata$/.exec(path);
      if (metadata) {
        const id = metadata[2]!;
        const error = controls.metadataFailures.get(id);
        if (error) return fail(error);
        const identity = revisionIdentities.get(id);
        if (!identity || documentId(identity.index, identity.projectId) !== metadata[1])
          return fail({ status: 404, code: 'RESOURCE_NOT_FOUND', message: 'REVISION_NOT_FOUND' });
        return reply(revision(identity.index, identity.seq, identity.projectId));
      }
      const content = /^\/api\/v1\/document-revisions\/([^/]+)\/content$/.exec(path);
      if (content) {
        const id = content[1]!;
        const error = controls.contentFailures.get(id);
        if (error) return fail(error);
        const identity = revisionIdentities.get(id);
        expect(identity).toBeDefined();
        const text = `共同开头\n${identity!.projectId === 'p2' ? '另一项目正文' : identity!.seq === 2 ? '当前发布第2版' : `准确修订第${identity!.seq}版`}\n共同结尾`;
        return reply({
          revisionId: id,
          mimeType: identity!.seq === 7 ? 'text/plain' : 'text/markdown',
          encoding: 'base64',
          bodyBase64: Buffer.from(text).toString('base64'),
          byteLength: Buffer.byteLength(text),
          sha256: identity!.seq.toString(16).padStart(64, '0'),
        });
      }
      const overview = /^\/api\/v1\/projects\/(p[12])\/document-summary-overview$/.exec(path);
      if (overview) {
        const projectId = overview[1] as ProjectId;
        const total = projectId === 'p1' ? 107 : 1;
        return reply({
          total,
          totalsByDocumentKind: { UNDERSTANDING: 0, DECISION: 0, PRD: total, KNOWLEDGE: 0 },
          collections: ['BUSINESS', 'SYSTEM', 'PRACTICE'].map((knowledgeBaseKind) => ({
            knowledgeBaseKind,
            knowledgeBaseCount: knowledgeBaseKind === 'BUSINESS' ? 1 : 0,
            documentCount: knowledgeBaseKind === 'BUSINESS' ? total : 0,
            recentItems:
              knowledgeBaseKind === 'BUSINESS'
                ? [summary(1, projectId), ...(projectId === 'p1' ? [summary(2, projectId)] : [])]
                : [],
          })),
        });
      }
      const review = /^\/api\/v1\/review-requests\/review-([^/]+)$/.exec(path);
      if (review) {
        const identity = revisionIdentities.get(review[1]!);
        expect(identity).toBeDefined();
        const item = revision(identity!.index, identity!.seq, identity!.projectId);
        return reply({
          id: `review-${item.id}`,
          projectId: identity!.projectId,
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
            knowledgeBaseId: `kb-${identity!.projectId}`,
            documentVersion: version(item.documentId),
            currentPublishedRevisionId: revisionId(identity!.index, 2, identity!.projectId),
            revisionId: item.id,
            revisionDigest: item.digest,
          },
        });
      }
      return route.fallback();
    },
  );
  return { ledger, controls, getRequests };
}

function catalog(page: Page) {
  return page.getByRole('table').nth(0);
}

function history(page: Page) {
  return page.getByRole('table').nth(1);
}

function revisionRow(page: Page, seq: number): Locator {
  return history(page)
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: `v${seq}`, exact: true }) });
}

async function openTarget(page: Page) {
  await page.goto('/prd?projectId=p1');
  await page.getByRole('textbox', { name: '搜索 PRD', exact: true }).fill(earlySearch);
  const row = catalog(page)
    .getByRole('row')
    .filter({ hasText: title(targetIndex) });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: /^(查看版本|当前)$/ }).click();
  await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
  await expect(page.getByText('122 个候选待处理', { exact: true })).toBeVisible();
}

async function readExactPair(page: Page, oldSeq: number, newSeq: number) {
  const oldInput = page.getByRole('textbox', { name: '比较旧修订 ID', exact: true });
  await oldInput.fill(targetRevision(oldSeq));
  await page
    .getByRole('textbox', { name: '比较新修订 ID', exact: true })
    .fill(targetRevision(newSeq));
  await page.getByRole('button', { name: '读取比较版本', exact: true }).click();
}

test.afterEach(async ({ page }, testInfo) => {
  const ledger = ledgers.get(page);
  if (!ledger) return;
  ledgers.delete(page);
  await testInfo.attach('prd-summary-history-network-ledger', {
    body: JSON.stringify(ledger, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.rejectedLegacyReads, 'PRD 列表、历史与精确修订只能使用有界入口').toEqual([]);
  expect(ledger.rejectedWrites, '浏览与比较不能产生写入').toEqual([]);
});

for (const width of [1440, 390]) {
  test(`${width}px 107份目录每页50按需翻页，早期历史搜索与状态筛选走服务端`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/prd?projectId=p1');
    await expect(catalog(page).locator('tbody tr')).toHaveCount(50);
    await expect(page.getByRole('heading', { level: 3, name: /^PRD本页/ })).toContainText('107');
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeEnabled();
    expect(fixture.getRequests(summaryPath())).toHaveLength(1);
    await expect
      .poll(() => fixture.ledger.requests.filter((entry) => entry.path.includes('/history')).length)
      .toBe(1);
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(catalog(page).locator('tbody tr')).toHaveCount(50);
    await expect(catalog(page)).toContainText(title(51));
    await expect(catalog(page)).not.toContainText(title(1));
    await page.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(catalog(page).locator('tbody tr')).toHaveCount(7);
    await expect(catalog(page)).toContainText(title(targetIndex));
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
    const summaries = fixture.getRequests(summaryPath());
    expect(summaries).toHaveLength(3);
    expect(
      summaries.map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor')),
    ).toEqual([null, 'catalog-p1--all-50', 'catalog-p1--all-100']);
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    await expect(catalog(page)).toContainText(title(51));
    await page.getByRole('textbox', { name: '搜索 PRD', exact: true }).fill(earlySearch);
    await expect(catalog(page).locator('tbody tr')).toHaveCount(1);
    await expect(catalog(page)).toContainText(title(targetIndex));
    await expect(page.getByRole('heading', { level: 3, name: /^PRD本页/ })).toContainText(
      '本页 1 / 共 1 个文档',
    );
    const query = new URL(fixture.getRequests(summaryPath()).at(-1)!.path, 'http://fixture')
      .searchParams;
    expect(query.get('q')).toBe(earlySearch);
    expect(query.has('cursor')).toBe(false);
    expect(fixture.getRequests(historyPath())).toHaveLength(0);
    await page
      .getByRole('combobox', { name: 'PRD 状态筛选', exact: true })
      .selectOption('published');
    await expect
      .poll(() =>
        new URL(fixture.getRequests(summaryPath()).at(-1)!.path, 'http://fixture').searchParams.get(
          'status',
        ),
      )
      .toBe('published');
    await expect(catalog(page)).toContainText(title(targetIndex));
    expect(
      new URL(fixture.getRequests(summaryPath()).at(-1)!.path, 'http://fixture').searchParams.has(
        'cursor',
      ),
    ).toBe(false);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
      .toBeLessThanOrEqual(1);
  });

  test(`${width}px 123修订的当前发布为seq2，精确比较不计入历史页且更多历史保留真实选择`, async ({
    page,
  }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    await expect(revisionRow(page, 123)).toHaveCount(1);
    await expect(revisionRow(page, 2)).toHaveCount(0);
    await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
    await expect(page.locator('pre.search-result')).toContainText('当前发布第2版');
    expect(fixture.getRequests(contentPath(targetRevision(2)))).toHaveLength(1);
    await revisionRow(page, 123)
      .getByRole('button', { name: /^查看内容/ })
      .click();
    const diff = page.getByTestId('prd-diff');
    await expect(diff).toContainText('当前发布第2版');
    await expect(diff).toContainText('准确修订第123版');
    const before = fixture.getRequests(historyPath()).length;
    await readExactPair(page, 7, 3);
    const oldSelect = page.getByRole('combobox', { name: '对比旧版本', exact: true });
    const newSelect = page.getByRole('combobox', { name: '对比新版本', exact: true });
    await expect(oldSelect).toHaveValue(targetRevision(7));
    await expect(newSelect).toHaveValue(targetRevision(3));
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    expect(fixture.getRequests(metadataPath(targetRevision(7)))).toHaveLength(1);
    expect(fixture.getRequests(metadataPath(targetRevision(3)))).toHaveLength(1);
    expect(fixture.getRequests(historyPath())).toHaveLength(before);
    await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
    await expect(diff).toContainText('准确修订第7版');
    await expect(diff).toContainText('准确修订第3版');
    await diff.getByRole('button', { name: '仅看修改', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(diff.getByRole('button', { name: '显示完整上下文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    await expect(oldSelect).toHaveValue(targetRevision(7));
    await expect(newSelect).toHaveValue(targetRevision(3));
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 123 / 123 条历史', { exact: true })).toBeVisible();
    const seqs = await history(page).locator('tbody tr td:first-child').allTextContents();
    expect(seqs).toEqual(Array.from({ length: 123 }, (_, index) => `v${123 - index}`));
    await expect(oldSelect).toHaveValue(targetRevision(7));
    await expect(newSelect).toHaveValue(targetRevision(3));
    await newSelect.selectOption(targetRevision(7));
    await expect(page.getByRole('button', { name: '对比所选版本', exact: true })).toBeDisabled();
    await expect(diff).toHaveCount(0);
    expect(fixture.getRequests(historyPath())).toHaveLength(before + 2);
  });

  test(`${width}px 后续历史503保留首屏与选择，重试相同游标后继续`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await readExactPair(page, 7, 3);
    const key = `${targetId}|${historyCursor(17, 50)}`;
    fixture.controls.historyFailures.set(key, {
      status: 503,
      code: 'HISTORY_UNAVAILABLE',
      message: '历史第二页暂时不可用',
    });
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: '历史第二页暂时不可用' })).toBeVisible();
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(history(page).locator('tbody tr')).toHaveCount(50);
    await expect(page.getByRole('combobox', { name: '对比旧版本', exact: true })).toHaveValue(
      targetRevision(7),
    );
    fixture.controls.historyFailures.delete(key);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    const cursors = fixture
      .getRequests(historyPath())
      .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor'));
    expect(cursors).toEqual([null, historyCursor(17, 50), historyCursor(17, 50)]);
    await expect(page.getByRole('alert').filter({ hasText: '历史第二页暂时不可用' })).toHaveCount(
      0,
    );
  });

  test(`${width}px 历史409停止旧游标，刷新从新版本首页开始`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    fixture.controls.versions.set(targetId, 18);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HISTORY_REFRESH_REQUIRED' }),
    ).toBeVisible();
    const before = fixture.getRequests(historyPath()).length;
    await afterBrowserPaint(page);
    expect(fixture.getRequests(historyPath())).toHaveLength(before);
    await page.getByRole('button', { name: '刷新历史', exact: true }).click();
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('alert').filter({ hasText: 'HISTORY_REFRESH_REQUIRED' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    const cursors = fixture
      .getRequests(historyPath())
      .map((entry) => new URL(entry.path, 'http://fixture').searchParams.get('cursor'));
    expect(cursors).toEqual([null, historyCursor(17, 50), null, historyCursor(18, 50)]);
  });

  test(`${width}px 切换搜索后旧概要即使带下一页也不能覆盖或继续读取`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    const old = latch();
    fixture.controls.gates.push({ pathname: summaryPath(), query: { q: 'prd' }, ready: old.ready });
    await page.setViewportSize({ width, height: 1000 });
    try {
      await page.goto('/prd?projectId=p1');
      await expect(catalog(page).locator('tbody tr')).toHaveCount(50);
      const search = page.getByRole('textbox', { name: '搜索 PRD', exact: true });
      const oldRequest = page.waitForRequest(
        (item) =>
          new URL(item.url()).pathname === summaryPath() &&
          new URL(item.url()).searchParams.get('q') === 'prd',
      );
      await search.fill('prd');
      await expect
        .poll(() =>
          fixture
            .getRequests(summaryPath())
            .some((entry) => new URL(entry.path, 'http://fixture').searchParams.get('q') === 'prd'),
        )
        .toBe(true);
      await search.fill(earlySearch);
      await expect(catalog(page).locator('tbody tr')).toHaveCount(1);
      await expect(catalog(page)).toContainText(title(targetIndex));
      const before = fixture.getRequests(summaryPath()).length;
      old.release();
      await finishOrAbort(await oldRequest);
      await afterBrowserPaint(page);
      await expect(search).toHaveValue(earlySearch);
      await expect(catalog(page).locator('tbody tr')).toHaveCount(1);
      await expect(catalog(page)).toContainText(title(targetIndex));
      expect(fixture.getRequests(summaryPath())).toHaveLength(before);
    } finally {
      old.release();
    }
  });

  test(`${width}px 项目切换隔离迟到目录与历史续页，不恢复旧修订也不继续拉页`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    const oldSummary = latch();
    const oldHistory = latch();
    const oldContent = latch();
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openTarget(page);
      fixture.controls.gates.push({
        pathname: historyPath(),
        query: { cursor: historyCursor(17, 50) },
        ready: oldHistory.ready,
      });
      fixture.controls.gates.push({
        pathname: summaryPath(),
        query: { q: 'prd' },
        ready: oldSummary.ready,
      });
      fixture.controls.gates.push({
        pathname: contentPath(targetRevision(2)),
        ready: oldContent.ready,
      });
      const oldSummaryRequest = page.waitForRequest(
        (item) =>
          new URL(item.url()).pathname === summaryPath() &&
          new URL(item.url()).searchParams.get('q') === 'prd',
      );
      const oldHistoryRequest = page.waitForRequest(
        (item) =>
          new URL(item.url()).pathname === historyPath() &&
          new URL(item.url()).searchParams.get('cursor') === historyCursor(17, 50),
      );
      const oldContentRequest = page.waitForRequest(
        (item) => new URL(item.url()).pathname === contentPath(targetRevision(2)),
      );
      await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
      await expect.poll(() => fixture.getRequests(contentPath(targetRevision(2))).length).toBe(1);
      await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
      await expect.poll(() => fixture.getRequests(historyPath()).length).toBe(2);
      await page.getByRole('textbox', { name: '搜索 PRD', exact: true }).fill('prd');
      await expect
        .poll(() =>
          fixture
            .getRequests(summaryPath())
            .some((entry) => new URL(entry.path, 'http://fixture').searchParams.get('q') === 'prd'),
        )
        .toBe(true);
      await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
      await expect(page).toHaveURL(/projectId=p2/);
      await expect(catalog(page)).toContainText(title(1, 'p2'));
      await expect(history(page).locator('tbody tr')).toHaveCount(3);
      const before = fixture.ledger.requests.filter(
        (entry) => entry.path.includes('/document-summaries') || entry.path.includes('/history'),
      ).length;
      oldSummary.release();
      oldHistory.release();
      oldContent.release();
      await finishOrAbort(await oldSummaryRequest);
      await finishOrAbort(await oldHistoryRequest);
      await finishOrAbort(await oldContentRequest);
      await afterBrowserPaint(page);
      await expect(catalog(page).locator('tbody tr')).toHaveCount(1);
      await expect(catalog(page)).toContainText(title(1, 'p2'));
      await expect(history(page).locator('tbody tr')).toHaveCount(3);
      await expect(history(page)).not.toContainText(title(targetIndex));
      expect(
        fixture.ledger.requests.filter(
          (entry) => entry.path.includes('/document-summaries') || entry.path.includes('/history'),
        ),
      ).toHaveLength(before);
      await expect(page.getByTestId('prd-diff')).toHaveCount(0);
      await expect(page.locator('pre.search-result')).toHaveCount(0);
    } finally {
      oldSummary.release();
      oldHistory.release();
      oldContent.release();
    }
  });

  test(`${width}px 指定旧版404清除旧差异并展示真实错误，不替换为其他修订`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await readExactPair(page, 7, 3);
    await expect(page.getByRole('combobox', { name: '对比旧版本', exact: true })).toHaveValue(
      targetRevision(7),
    );
    await page.getByRole('button', { name: '对比所选版本', exact: true }).click();
    await expect(page.getByTestId('prd-diff')).toContainText('准确修订第7版');
    fixture.controls.metadataFailures.set(targetRevision(8), {
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
      message: 'REVISION_NOT_FOUND',
    });
    const before = fixture.ledger.requests.filter((entry) =>
      entry.path.endsWith('/content'),
    ).length;
    await readExactPair(page, 8, 4);
    await expect(
      page.getByRole('alert').filter({ hasText: 'REVISION_NOT_FOUND' }).first(),
    ).toBeVisible();
    await expect(page.getByTestId('prd-diff')).toHaveCount(0);
    await expect(page.locator('pre.search-result')).toHaveCount(0);
    expect(fixture.ledger.requests.filter((entry) => entry.path.endsWith('/content'))).toHaveLength(
      before,
    );
    expect(fixture.getRequests(contentPath(targetRevision(8)))).toHaveLength(0);
    await expect(revisionRow(page, 123)).toHaveCount(0);
  });

  test(`${width}px 更多历史里的候选仍能打开绑定的准确评审`, async ({ page }) => {
    const fixture = await installPrdFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await page.getByRole('button', { name: '加载更多历史', exact: true }).click();
    await expect(page.getByText('已加载 100 / 123 条历史', { exact: true })).toBeVisible();
    await revisionRow(page, 73).getByRole('button', { name: '进入评审', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reviews/review-${targetRevision(73)}$`));
    await expect
      .poll(
        () => fixture.getRequests(`/api/v1/review-requests/review-${targetRevision(73)}`).length,
      )
      .toBe(1);
    expect(fixture.ledger.withdrawals).toEqual([]);
    expect(fixture.ledger.previews).toEqual([]);
  });

  test(`${width}px 首屏外发布撤销保留预览和票据，冲突需刷新重新确认且成功后清旧内容`, async ({
    page,
  }) => {
    const fixture = await installPrdFixtures(page);
    fixture.controls.allowWithdraw = true;
    fixture.controls.conflictOnNextWithdraw = true;
    await page.setViewportSize({ width, height: 1000 });
    await openTarget(page);
    await page.getByRole('button', { name: '查看当前发布', exact: true }).click();
    await expect(page.locator('pre.search-result')).toContainText('当前发布第2版');
    async function confirmWithdrawal() {
      await page.getByRole('button', { name: '撤销发布', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '撤销发布（需二次验证）', exact: true });
      await dialog.getByRole('textbox', { name: '撤销原因', exact: true }).fill('发布内容需要返修');
      await dialog.getByLabel('确认密码', { exact: true }).fill('fixture-password');
      await dialog.getByRole('button', { name: '验证密码并签发票据', exact: true }).click();
      await expect(dialog.getByText(/票据已签发，单次有效/)).toBeVisible();
      await dialog.getByRole('button', { name: '撤销发布', exact: true }).click();
      return dialog;
    }
    const failed = await confirmWithdrawal();
    await expect(failed.getByRole('alert')).toContainText('VERSION_CONFLICT');
    await expect(failed.getByRole('alert')).toContainText('文档版本已变化');
    await expect(page.getByText(/发布已撤销；历史修订仍保留/)).toHaveCount(0);
    expect(fixture.ledger.withdrawals).toEqual([
      {
        documentId: targetId,
        expectedVersion: 17,
        reason: '发布内容需要返修',
        ticketId: 'prd-ticket-1',
      },
    ]);
    await failed.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '刷新文档', exact: true }).click();
    await expect(
      catalog(page)
        .getByRole('row')
        .filter({ hasText: title(targetIndex) }),
    ).toContainText('v18');
    await expect(page.getByText('已加载 50 / 123 条历史', { exact: true })).toBeVisible();
    await confirmWithdrawal();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByText(/发布已撤销；历史修订仍保留/)).toBeVisible();
    await expect(page.getByRole('button', { name: '查看当前发布', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '撤销发布', exact: true })).toHaveCount(0);
    await expect(page.getByText('123 个候选待处理', { exact: true })).toBeVisible();
    await expect(page.locator('pre.search-result')).toHaveCount(0);
    await expect(page.getByTestId('prd-diff')).toHaveCount(0);
    expect(fixture.ledger.withdrawals[1]).toEqual({
      documentId: targetId,
      expectedVersion: 18,
      reason: '发布内容需要返修',
      ticketId: 'prd-ticket-2',
    });
    expect(fixture.ledger.ticketBindings.map((binding) => binding.expectedVersion)).toEqual([
      17, 18,
    ]);
    expect(
      fixture.ledger.previews.some(
        (binding) =>
          binding.expectedVersion === 18 && binding.payload.reason === '发布内容需要返修',
      ),
    ).toBe(true);
  });
}
