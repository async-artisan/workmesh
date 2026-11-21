import { expect, test, type Page } from '@playwright/test';
import type { DocumentSummary } from '../../apps/web/src/api/documentSummaries';
import { boardSummary, installReviewFixtures } from './fixtures';

type SummaryState = 'published' | 'withdrawn' | 'archived' | 409 | 404 | 503;
type ProjectId = 'p1' | 'p2';
interface NetworkLedger {
  requests: Array<{ method: string; path: string }>;
  rejectedWrites: string[];
  rejectedLegacyDocuments: string[];
}
const ledgers = new Map<Page, NetworkLedger>();
const summaryPath = (id: string) => `/api/v1/documents/${id}/summary`;
const documentId = (projectId: ProjectId) => (projectId === 'p1' ? 'd1' : 'd2');
const revisionId = (projectId: ProjectId, noKnowledge = false) =>
  projectId === 'p1' ? (noKnowledge ? 'rev2' : 'rev1') : noKnowledge ? 'p2-rev2' : 'p2-rev1';

function summary(projectId: ProjectId, state: SummaryState): DocumentSummary {
  const id = documentId(projectId);
  const published = {
    id: `${id}-published`,
    documentId: id,
    seq: 1,
    title: '接口规范',
    digest: 'a'.repeat(64),
    state: 'PUBLISHED' as const,
  };
  const withdrawn = state === 'withdrawn';
  return {
    document: {
      id,
      projectId,
      knowledgeBaseId: `kb-${projectId}`,
      requirementId: null,
      kind: 'KNOWLEDGE',
      version: 1,
      currentPublishedRevisionId: withdrawn ? null : published.id,
      archivedAt: state === 'archived' ? '2026-11-10T01:00:00Z' : null,
    },
    updatedAt: '2026-11-10T00:00:00Z',
    knowledgeBase: { id: `kb-${projectId}`, name: '项目知识', kind: 'BUSINESS' },
    requirement: null,
    latestVisibleRevision: withdrawn ? { ...published, state: 'CANDIDATE' } : published,
    publishedRevision: withdrawn ? null : published,
    visibleRevisionCount: 1,
    candidateRevisionCount: withdrawn ? 1 : 0,
  };
}

function projectFacts(projectId: ProjectId) {
  const suffix = projectId === 'p1' ? '' : '-p2';
  const roles = [
    { id: `r-front${suffix}`, projectId, key: 'frontend', title: '前端', isActive: true },
    { id: `r-product${suffix}`, projectId, key: 'product', title: '产品', isActive: true },
  ];
  const repository = {
    id: `repo${suffix || '1'}`,
    identityMode: 'DECLARED',
    adapter: null,
    externalId: null,
    owner: 'fixture',
    name: `readiness-${projectId}`,
    defaultBranch: 'main',
    createdAt: '2026-11-01T00:00:00Z',
    archivedAt: null,
    locators: [],
  };
  const repositoryRef = {
    key: 'main',
    projectRepositoryId: repository.id,
    suggestedPath: '.',
    defaultRef: 'main',
    description: null,
  };
  const revision = {
    id: revisionId(projectId),
    projectId,
    workflowKey: 'delivery',
    revision: 2,
    digest: 'd'.repeat(64),
    definition: {
      roleSlots: [{ key: 'accept', roleKey: 'product' }],
      steps: [
        {
          key: 'impl',
          roleKey: 'frontend',
          outputKinds: ['IMPL'],
          gates: [{ reviewerSlots: ['accept'] }],
        },
      ],
    },
    compiledRules: {
      resolvedRoles: [{ stepKey: 'impl', roleKey: 'frontend', roleId: roles[0]!.id }],
      inputSources: [
        {
          stepKey: 'impl',
          inputKey: 'contract',
          source: 'PUBLISHED_KNOWLEDGE',
          required: true,
          reference: documentId(projectId),
        },
      ],
    },
  };
  const definition = {
    workflowKey: 'delivery',
    title: '交付流程',
    currentRevision: 2,
    currentPublishedRevisionId: revision.id,
    version: 2,
  };
  return {
    [`/api/v1/projects/${projectId}/members`]: [
      { id: 'fixture-user', email: 'fixture@example.test', role: 'OWNER', version: 1, roles },
      {
        id: 'signer',
        email: 'signer@example.test',
        role: 'MEMBER',
        version: 1,
        roles: [roles[1]],
      },
    ],
    [`/api/v1/projects/${projectId}/roles`]: roles,
    [`/api/v1/projects/${projectId}/workflow-definitions`]: {
      items: [
        definition,
        {
          ...definition,
          workflowKey: 'no-knowledge',
          title: '无需知识流程',
          currentPublishedRevisionId: revisionId(projectId, true),
        },
      ],
      nextCursor: null,
    },
    [`/api/v1/workflow-definition-revisions/${revision.id}`]: revision,
    [`/api/v1/workflow-definition-revisions/${revisionId(projectId, true)}`]: {
      ...revision,
      id: revisionId(projectId, true),
      workflowKey: 'no-knowledge',
      compiledRules: { ...revision.compiledRules, inputSources: [] },
    },
    [`/api/v1/projects/${projectId}/knowledge-bindings`]: {
      version: 1,
      canManage: true,
      items: [
        {
          id: `binding${suffix || '1'}`,
          documentId: documentId(projectId),
          roleId: roles[0]!.id,
          required: true,
        },
      ],
    },
    [`/api/v1/projects/${projectId}/workspace-definition`]: {
      definitionStatus: 'CONFIGURED',
      projectId,
      projectVersion: projectId === 'p1' ? 3 : 2,
      definitionVersion: 1,
      revisionId: `workspace-${projectId}-rev1`,
      revisionNo: 1,
      digest: 'b'.repeat(64),
      publishedAt: '2026-11-10T00:00:00Z',
      payload: {
        schemaVersion: '1.0',
        projectId,
        layout: { kind: 'SINGLE_ROOT' },
        repositories: [repositoryRef],
        relations: [],
        roleHints: {},
        contextPolicy: { requiredDocumentIds: [], roleDocumentIds: {}, repositoryDocuments: [] },
      },
      repositories: [{ ...repository, ...repositoryRef }],
      draft: null,
      validation: { valid: true, issues: [] },
    },
    [`/api/v1/projects/${projectId}/repositories`]: [repository],
    [`/api/v1/projects/${projectId}/board`]: {
      summary: boardSummary({ BACKLOG: 1 }),
      columns: [],
    },
  };
}

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
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function installReadinessFixtures(
  page: Page,
  delayed?: { documentId: string; ready: Promise<void> },
) {
  await installReviewFixtures(page);
  const ledger: NetworkLedger = {
    requests: [],
    rejectedWrites: [],
    rejectedLegacyDocuments: [],
  };
  ledgers.set(page, ledger);
  const controls: { summaryStates: Record<string, SummaryState> } = {
    summaryStates: { d1: 'published', d2: 'published' },
  };
  const facts: Record<string, unknown> = { ...projectFacts('p1'), ...projectFacts('p2') };
  // This fixture is read-only. Old list/detail/history/metadata/content endpoints
  // are rejected before the shared fixtures can accidentally satisfy a regression.
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const entry = { method: request.method(), path: path + url.search };
      ledger.requests.push(entry);
      if (entry.method !== 'GET') {
        ledger.rejectedWrites.push(`${entry.method} ${entry.path}`);
        return route.fulfill({
          status: 405,
          json: {
            error: { code: 'READINESS_WRITE_REJECTED', message: '准备清单只读场景禁止写入' },
          },
        });
      }
      const summaryMatch = /^\/api\/v1\/documents\/([^/]+)\/summary$/.exec(path);
      if (/(?:^|\/)(?:documents|document-revisions)(?:\/|$)/.test(path) && !summaryMatch) {
        ledger.rejectedLegacyDocuments.push(entry.path);
        return route.fulfill({
          status: 500,
          json: {
            error: {
              code: 'READINESS_LEGACY_DOCUMENT_API_REJECTED',
              message: '准备清单只能读取文档概要，禁止文档列表、详情、历史、元数据与正文',
            },
          },
        });
      }
      if (summaryMatch) {
        const id = summaryMatch[1]!;
        const state = controls.summaryStates[id];
        expect(state, `概要必须属于显式配置的文档 ${id}`).toBeDefined();
        if (delayed?.documentId === id) await delayed.ready;
        if (typeof state === 'number')
          return route.fulfill({
            status: state,
            json: {
              error: {
                code:
                  state === 409
                    ? 'RESOURCE_CONFLICT'
                    : state === 404
                      ? 'RESOURCE_NOT_FOUND'
                      : 'UNAVAILABLE',
                message: state === 409 ? 'DOCUMENT_SUMMARY_REFRESH_REQUIRED' : '概要当前不可读取',
                requestId: `readiness-summary-${state}`,
              },
            },
          });
        return route.fulfill({
          json: {
            data: summary(id === 'd1' ? 'p1' : 'p2', state!),
            meta: { requestId: `readiness-summary-${id}` },
          },
        });
      }
      if (path in facts)
        return route.fulfill({
          json: { data: facts[path], meta: { requestId: 'readiness-project-facts' } },
        });
      return route.fallback();
    },
  );
  return {
    controls,
    ledger,
    documentRequests: () =>
      ledger.requests
        .map((entry) => entry.path)
        .filter((path) => /(?:^|\/)(?:documents|document-revisions)(?:\/|$)/.test(path)),
  };
}

const knowledgeRow = (page: Page) =>
  page.getByRole('listitem', { name: '准备已发布并绑定的知识', exact: true });

async function openChecklist(page: Page) {
  await page.getByText('查看项目准备清单', { exact: true }).click();
  await expect(page.getByRole('region', { name: '项目准备清单', exact: true })).toBeVisible();
}

test.afterEach(async ({ page }, testInfo) => {
  const ledger = ledgers.get(page);
  if (!ledger) return;
  ledgers.delete(page);
  await testInfo.attach('readiness-network-ledger', {
    body: JSON.stringify(ledger, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.rejectedWrites, '所有准备清单场景均不得发起写请求').toEqual([]);
  expect(
    ledger.rejectedLegacyDocuments,
    '禁止旧 documents detail/list/history/metadata/content；只允许 summary',
  ).toEqual([]);
});

for (const width of [1440, 390]) {
  test(`${width}px 准备清单展开前不读概要，展开后只读概要并核对全部准备项`, async ({ page }) => {
    const fixture = await installReadinessFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/workspace?projectId=p1');
    await expect(page.getByRole('heading', { name: '定义状态', exact: true })).toBeVisible();
    await afterBrowserPaint(page);
    await expect(page.getByRole('region', { name: '项目准备清单', exact: true })).toHaveCount(0);
    expect(fixture.documentRequests()).toEqual([]);
    expect(
      fixture.ledger.requests.some((entry) => entry.path.endsWith('/knowledge-bindings')),
    ).toBe(false);

    const disclosure = page.getByText('查看项目准备清单', { exact: true });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(knowledgeRow(page).getByText('已具备', { exact: true })).toBeVisible();
    for (const name of ['安排人员与独立签字', '配置仓库与工作区', '发布可用流程', '创建首次任务'])
      await expect(
        page.getByRole('listitem', { name, exact: true }).getByText('已具备', { exact: true }),
      ).toBeVisible();
    await expect(knowledgeRow(page)).toContainText('已核对 1 项必需知识输入');
    await expect(
      knowledgeRow(page).getByRole('link', { name: '选择资料与绑定', exact: true }),
    ).toHaveAttribute('href', '/workflows?projectId=p1');
    expect(fixture.documentRequests()).toEqual([summaryPath('d1')]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });

  for (const status of [409, 404, 503] as const) {
    test(`${width}px 概要 ${status} 保留待确认，显式刷新后恢复且不读旧文档接口`, async ({
      page,
    }) => {
      const fixture = await installReadinessFixtures(page);
      fixture.controls.summaryStates.d1 = status;
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/workspace?projectId=p1');
      await openChecklist(page);
      const knowledge = knowledgeRow(page);
      await expect(knowledge.getByText('待确认', { exact: true })).toBeVisible();
      await expect(knowledge).toContainText('部分必需资料或绑定当前不可确认');
      await expect(knowledge.getByText('待准备', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '刷新准备状态', exact: true })).toBeEnabled();
      expect(fixture.documentRequests()).toEqual([summaryPath('d1')]);

      fixture.controls.summaryStates.d1 = 'published';
      await afterBrowserPaint(page);
      await expect(knowledge.getByText('待确认', { exact: true })).toBeVisible();
      expect(fixture.documentRequests()).toEqual([summaryPath('d1')]);
      await page.getByRole('button', { name: '刷新准备状态', exact: true }).click();
      await expect(knowledge.getByText('已具备', { exact: true })).toBeVisible();
      expect(fixture.documentRequests()).toEqual([summaryPath('d1'), summaryPath('d1')]);
    });
  }

  for (const state of ['withdrawn', 'archived'] as const) {
    test(`${width}px ${state === 'withdrawn' ? '已撤回发布' : '已归档'}知识明确显示待准备`, async ({
      page,
    }) => {
      const fixture = await installReadinessFixtures(page);
      fixture.controls.summaryStates.d1 = state;
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/workspace?projectId=p1');
      await openChecklist(page);
      const knowledge = knowledgeRow(page);
      await expect(knowledge.getByText('待准备', { exact: true })).toBeVisible();
      await expect(knowledge).toContainText('仍需准备或更新：contract');
      await expect(knowledge.getByText('已具备', { exact: true })).toHaveCount(0);
      await expect(knowledge.getByText('待确认', { exact: true })).toHaveCount(0);
      expect(fixture.documentRequests()).toEqual([summaryPath('d1')]);
    });
  }

  test(`${width}px 切换项目后旧项目延迟概要不会覆盖新项目准备结果`, async ({ page }) => {
    const oldSummary = latch();
    const fixture = await installReadinessFixtures(page, {
      documentId: 'd1',
      ready: oldSummary.ready,
    });
    fixture.controls.summaryStates.d2 = 'archived';
    await page.setViewportSize({ width, height: 1000 });
    try {
      await page.goto('/workspace?projectId=p1');
      await openChecklist(page);
      await expect.poll(() => fixture.documentRequests()).toEqual([summaryPath('d1')]);
      await expect(knowledgeRow(page)).toContainText('正在核对已发布知识和角色绑定');

      await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
      await expect(page).toHaveURL(/projectId=p2/);
      await expect(page.getByRole('region', { name: '项目准备清单', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: '定义状态', exact: true })).toBeVisible();
      await openChecklist(page);
      const knowledge = knowledgeRow(page);
      await expect(knowledge.getByText('待准备', { exact: true })).toBeVisible();
      const lateResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === summaryPath('d1'),
      );
      oldSummary.release();
      await (await lateResponse).finished();
      await afterBrowserPaint(page);

      await expect(knowledge.getByText('待准备', { exact: true })).toBeVisible();
      await expect(knowledge).toContainText('仍需准备或更新：contract');
      await expect(knowledge.getByText('已具备', { exact: true })).toHaveCount(0);
      await expect(
        knowledge.getByRole('link', { name: '选择资料与绑定', exact: true }),
      ).toHaveAttribute('href', '/workflows?projectId=p2');
      expect(fixture.documentRequests()).toEqual([summaryPath('d1'), summaryPath('d2')]);
    } finally {
      oldSummary.release();
    }
  });

  test(`${width}px 切换流程后旧流程延迟概要不会覆盖无需知识状态`, async ({ page }) => {
    const oldSummary = latch();
    const fixture = await installReadinessFixtures(page, {
      documentId: 'd1',
      ready: oldSummary.ready,
    });
    await page.setViewportSize({ width, height: 1000 });
    try {
      await page.goto('/workspace?projectId=p1');
      await openChecklist(page);
      await expect.poll(() => fixture.documentRequests()).toEqual([summaryPath('d1')]);
      await page
        .getByRole('combobox', { name: '准备清单使用的流程', exact: true })
        .selectOption('no-knowledge');
      const knowledge = knowledgeRow(page);
      await expect(knowledge.getByText('无需此项', { exact: true })).toBeVisible();
      const lateResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === summaryPath('d1'),
      );
      oldSummary.release();
      await (await lateResponse).finished();
      await afterBrowserPaint(page);

      await expect(
        page.getByRole('combobox', { name: '准备清单使用的流程', exact: true }),
      ).toHaveValue('no-knowledge');
      await expect(knowledge.getByText('无需此项', { exact: true })).toBeVisible();
      await expect(knowledge.getByText('已具备', { exact: true })).toHaveCount(0);
      await expect(knowledge).toContainText('选定流程没有必需的“已发布知识”输入');
      expect(fixture.documentRequests()).toEqual([summaryPath('d1')]);
    } finally {
      oldSummary.release();
    }
  });
}
