import { expect, test, type Page } from '@playwright/test';
import type { DocumentSummary } from '../../apps/web/src/api/documentSummaries';
import { installReviewFixtures } from './fixtures';

const documents = [
  { id: '11111111-1111-4111-8111-111111111111', title: 'ERP 系统单元说明' },
  { id: '22222222-2222-4222-8222-222222222222', title: 'ERP 前后端接口契约' },
  { id: '33333333-3333-4333-8333-333333333333', title: '第二页共享规范' },
];

type ProjectId = 'p1' | 'p2';
interface SummaryPage {
  items: DocumentSummary[];
  nextCursor: string | null;
  total: number;
}
interface BindingWrite {
  documentId: string;
  roleId: string | null;
  required: boolean;
  expectedVersion: number;
}
interface Binding {
  id: string;
  documentId: string;
  roleId: string | null;
  required: boolean;
}
interface FixtureProject {
  pages: Record<string, SummaryPage | number>;
  bindingReadStatus: number;
  bindingWriteStatus: number;
  bindingReadStatusAfterWrite: number | null;
  canManage: boolean;
  version: number;
  bindings: Binding[];
}
interface NetworkLedger {
  requests: Array<{ method: string; path: string }>;
  writes: Array<{ projectId: ProjectId; body: BindingWrite }>;
  rejectedWrites: string[];
  rejectedDocuments: string[];
}
interface Delay {
  projectId: ProjectId;
  kind: 'summary' | 'binding-read' | 'binding-write';
  ready: Promise<void>;
}
const ledgers = new Map<Page, NetworkLedger>();
const summaryPath = (projectId: ProjectId, cursor = '') =>
  `/api/v1/projects/${projectId}/document-summaries?status=published&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

function publishedSummary(
  document: (typeof documents)[number],
  projectId: ProjectId = 'p1',
): DocumentSummary {
  const revision = {
    id: `revision-${document.id}`,
    documentId: document.id,
    seq: 1,
    title: document.title,
    digest: 'a'.repeat(64),
    state: 'PUBLISHED' as const,
  };
  return {
    document: {
      id: document.id,
      projectId,
      knowledgeBaseId: `kb-${projectId}`,
      requirementId: null,
      kind: 'KNOWLEDGE',
      version: 1,
      currentPublishedRevisionId: revision.id,
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00Z',
    knowledgeBase: { id: `kb-${projectId}`, name: '项目知识', kind: 'BUSINESS' },
    requirement: null,
    latestVisibleRevision: revision,
    publishedRevision: revision,
    visibleRevisionCount: 1,
    candidateRevisionCount: 0,
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

async function installPrerequisiteFixtures(
  page: Page,
  canManage = true,
  empty = false,
  delay?: Delay,
) {
  await installReviewFixtures(page);
  const reply = (data: unknown) => ({
    json: { data, meta: { requestId: 'workflow-prerequisites-fixture' } },
  });
  const failure = (status: number, message: string) => ({
    status,
    json: {
      error: {
        code: status === 409 ? 'RESOURCE_CONFLICT' : 'PREREQUISITE_READ_FAILED',
        message,
        requestId: `workflow-prerequisites-${status}`,
      },
    },
  });
  const roles = [
    ['product', '产品'],
    ['ui', '设计'],
    ['backend', '后端'],
    ['frontend', '前端'],
    ['qa', '测试'],
    ['ops', '运维'],
  ].map(([key, title]) => ({ id: `role-${key}`, key, title, isActive: true }));
  const projectState = (projectId: ProjectId): FixtureProject => ({
    pages: {
      '': {
        items: empty ? [] : documents.slice(0, 2).map((item) => publishedSummary(item, projectId)),
        nextCursor: null,
        total: empty ? 0 : 2,
      },
    },
    bindingReadStatus: 200,
    bindingWriteStatus: 200,
    bindingReadStatusAfterWrite: null,
    canManage,
    version: 3,
    bindings: [],
  });
  const projects: Record<ProjectId, FixtureProject> = {
    p1: projectState('p1'),
    p2: projectState('p2'),
  };
  const additionalReads: Record<string, unknown> = {};
  const ledger: NetworkLedger = {
    requests: [],
    writes: [],
    rejectedWrites: [],
    rejectedDocuments: [],
  };
  ledgers.set(page, ledger);
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const method = request.method();
      ledger.requests.push({ method, path: path + url.search });
      if (/(?:^|\/)(?:documents|document-revisions)(?:\/|$)/.test(path)) {
        ledger.rejectedDocuments.push(`${method} ${path + url.search}`);
        return route.fulfill(failure(500, '禁止旧文档列表、详情、历史、元数据和正文接口'));
      }
      const bindingMatch = /^\/api\/v1\/projects\/(p[12])\/knowledge-bindings$/.exec(path);
      if (method !== 'GET' && !(method === 'PUT' && bindingMatch)) {
        ledger.rejectedWrites.push(`${method} ${path}`);
        return route.fulfill(failure(405, '这里只允许显式资料绑定写入'));
      }
      const summaryMatch = /^\/api\/v1\/projects\/(p[12])\/document-summaries$/.exec(path);
      if (summaryMatch) {
        const projectId = summaryMatch[1] as ProjectId;
        const cursor = url.searchParams.get('cursor') ?? '';
        expect(path + url.search).toBe(summaryPath(projectId, cursor));
        const result = projects[projectId].pages[cursor];
        expect(result, `只允许显式配置的游标 ${cursor}`).toBeDefined();
        if (delay?.projectId === projectId && delay.kind === 'summary') await delay.ready;
        if (typeof result === 'number')
          return route.fulfill(failure(result, '资料列表后续读取失败'));
        return route.fulfill(reply(result));
      }
      if (bindingMatch) {
        const projectId = bindingMatch[1] as ProjectId;
        const state = projects[projectId];
        if (method === 'PUT') {
          if (!state.canManage) {
            ledger.rejectedWrites.push(`${method} ${path}`);
            return route.fulfill(failure(403, '普通成员不能绑定资料'));
          }
          expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
          expect(request.headers()['idempotency-key']).toBeTruthy();
          const body = request.postDataJSON() as BindingWrite;
          ledger.writes.push({ projectId, body });
          if (delay?.projectId === projectId && delay.kind === 'binding-write') await delay.ready;
          if (state.bindingReadStatusAfterWrite !== null)
            state.bindingReadStatus = state.bindingReadStatusAfterWrite;
          if (state.bindingWriteStatus !== 200)
            return route.fulfill(failure(state.bindingWriteStatus, '绑定版本冲突，请读取最新状态'));
          expect(body.expectedVersion).toBe(state.version);
          state.bindings.push({
            id: `binding-${state.bindings.length + 1}`,
            documentId: body.documentId,
            roleId: body.roleId,
            required: body.required,
          });
          state.version += 1;
          return route.fulfill(reply({ version: state.version, binding: state.bindings.at(-1) }));
        }
        const status = state.bindingReadStatus;
        const body = {
          version: state.version,
          canManage: state.canManage,
          items: [...state.bindings],
        };
        if (delay?.projectId === projectId && delay.kind === 'binding-read') await delay.ready;
        return status === 200
          ? route.fulfill(reply(body))
          : route.fulfill(failure(status, '角色绑定状态暂不可读'));
      }
      const roleMatch = /^\/api\/v1\/projects\/(p[12])\/roles$/.exec(path);
      if (roleMatch)
        return route.fulfill(reply(roles.map((role) => ({ ...role, projectId: roleMatch[1] }))));
      if (path in additionalReads) return route.fulfill(reply(additionalReads[path]));
      return route.fallback();
    },
  );
  return {
    projects,
    additionalReads,
    ledger,
    writes: () => ledger.writes.map((entry) => entry.body),
    summaryRequests: () =>
      ledger.requests
        .filter((entry) => entry.path.includes('/document-summaries'))
        .map((entry) => entry.path),
    bindingReads: () =>
      ledger.requests
        .filter((entry) => entry.method === 'GET' && entry.path.endsWith('/knowledge-bindings'))
        .map((entry) => entry.path),
  };
}

for (const width of [1440, 390]) {
  test(`${width}px 同项目载入仍有知识前置的新修订后旧绑定提交不得继续读取或覆盖提示`, async ({
    page,
  }) => {
    const old = latch();
    const fixture = await installPrerequisiteFixtures(page, true, false, {
      projectId: 'p1',
      kind: 'binding-write',
      ready: old.ready,
    });
    const nextDefinition = {
      workflowKey: 'next-delivery',
      title: '下一交付流程',
      steps: [
        {
          key: 'backend',
          roleKey: 'backend',
          inputBindings: [
            {
              inputKey: 'unit-card',
              source: 'PUBLISHED_KNOWLEDGE',
              knowledgeKey: documents[1]!.id,
            },
          ],
        },
        {
          key: 'frontend',
          roleKey: 'frontend',
          inputBindings: [
            { inputKey: 'contract', source: 'PUBLISHED_KNOWLEDGE', knowledgeKey: documents[1]!.id },
          ],
        },
      ],
    };
    fixture.additionalReads['/api/v1/projects/p1/workflow-definitions'] = {
      items: [
        {
          workflowKey: 'next-delivery',
          title: '下一交付流程',
          currentRevision: 4,
          currentPublishedRevisionId: 'next-revision',
          version: 4,
        },
      ],
      nextCursor: null,
    };
    fixture.additionalReads['/api/v1/workflow-definition-revisions/next-revision'] = {
      id: 'next-revision',
      projectId: 'p1',
      workflowKey: 'next-delivery',
      revision: 4,
      digest: 'b'.repeat(64),
      definition: nextDefinition,
    };
    await page.setViewportSize({ width, height: 1000 });
    try {
      const region = await openSoftwarePrerequisites(page);
      const backend = region.getByRole('combobox', {
        name: '选择已发布文档：系统单元说明（后端）',
      });
      await expect(backend).toBeEnabled();
      await backend.selectOption(documents[0]!.id);
      await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
      await expect.poll(() => fixture.writes()).toHaveLength(1);
      const definitionRow = page.getByRole('row').filter({ hasText: 'next-delivery' });
      await definitionRow.getByRole('button', { name: '载入为下一版', exact: true }).click();
      await expect(page.getByText(/已载入 next-delivery 第 4 版作为下一版基线/)).toBeVisible();
      await expect(backend).toBeEnabled();
      await expect(backend).toHaveValue(documents[1]!.id);
      await expect(region.getByRole('button', { name: '绑定给后端', exact: true })).toBeEnabled();
      const before = { summaries: fixture.summaryRequests(), bindings: fixture.bindingReads() };
      const lateResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/projects/p1/knowledge-bindings' &&
          response.request().method() === 'PUT',
      );
      old.release();
      await (await lateResponse).finished();
      await afterBrowserPaint(page);

      await expect(page.getByText(/已载入 next-delivery 第 4 版作为下一版基线/)).toBeVisible();
      await expect(page.getByText(/资料已绑定给接收角色/)).toHaveCount(0);
      await expect(backend).toHaveValue(documents[1]!.id);
      await expect(region.getByText('待绑定', { exact: true })).toHaveCount(2);
      expect(
        JSON.parse(await page.getByLabel('流程定义 JSON', { exact: true }).inputValue()),
      ).toMatchObject({ workflowKey: 'next-delivery', baseRevisionId: 'next-revision' });
      expect(fixture.summaryRequests()).toEqual(before.summaries);
      expect(fixture.bindingReads()).toEqual(before.bindings);
      expect(fixture.writes()).toHaveLength(1);
    } finally {
      old.release();
    }
  });

  test(`${width}px 绑定进行中改选资料立即使旧动作失效，显式重读后才可按新版本绑定`, async ({
    page,
  }) => {
    const old = latch();
    const fixture = await installPrerequisiteFixtures(page, true, false, {
      projectId: 'p1',
      kind: 'binding-write',
      ready: old.ready,
    });
    await page.setViewportSize({ width, height: 1000 });
    try {
      const region = await openSoftwarePrerequisites(page);
      const backend = region.getByRole('combobox', {
        name: '选择已发布文档：系统单元说明（后端）',
      });
      await expect(backend).toBeEnabled();
      await backend.selectOption(documents[0]!.id);
      await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
      await expect.poll(() => fixture.writes()).toHaveLength(1);
      await backend.selectOption(documents[1]!.id);
      await expect(backend).toHaveValue(documents[1]!.id);
      await expect(region.getByRole('alert')).toContainText(
        '流程草稿已变化，请重试绑定状态后再继续绑定',
      );
      await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
      await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
      const before = { summaries: fixture.summaryRequests(), bindings: fixture.bindingReads() };
      const lateResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/v1/projects/p1/knowledge-bindings' &&
          response.request().method() === 'PUT',
      );
      old.release();
      await (await lateResponse).finished();
      await afterBrowserPaint(page);
      await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
      await expect(page.getByText(/资料已绑定给接收角色/)).toHaveCount(0);
      expect(fixture.summaryRequests()).toEqual(before.summaries);
      expect(fixture.bindingReads()).toEqual(before.bindings);
      expect(fixture.writes()).toHaveLength(1);

      await region.getByRole('button', { name: '重试绑定状态', exact: true }).click();
      await expect(region.getByRole('button', { name: '绑定给后端', exact: true })).toBeEnabled();
      await expect(backend).toHaveValue(documents[1]!.id);
      await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
      await expect(
        region
          .getByRole('group', { name: '系统单元说明（后端）', exact: true })
          .getByText('已绑定', { exact: true }),
      ).toBeVisible();
      expect(fixture.writes()[1]).toEqual({
        documentId: documents[1]!.id,
        roleId: 'role-backend',
        required: true,
        expectedVersion: 4,
      });
      expect(fixture.summaryRequests()).toEqual(before.summaries);
    } finally {
      old.release();
    }
  });

  test(`${width}px 切换项目后迟到的概要首屏带游标也不得继续读取旧项目后页`, async ({ page }) => {
    const old = latch();
    const fixture = await installPrerequisiteFixtures(page, true, false, {
      projectId: 'p1',
      kind: 'summary',
      ready: old.ready,
    });
    fixture.projects.p1.pages = {
      '': { items: [publishedSummary(documents[0]!)], nextCursor: 'old-project-page-2', total: 2 },
      'old-project-page-2': {
        items: [publishedSummary(documents[1]!)],
        nextCursor: null,
        total: 2,
      },
    };
    fixture.projects.p2.canManage = false;
    fixture.projects.p2.pages[''] = {
      items: [publishedSummary(documents[2]!, 'p2')],
      nextCursor: null,
      total: 1,
    };
    await page.setViewportSize({ width, height: 1000 });
    try {
      await openSoftwarePrerequisites(page);
      await expect.poll(() => fixture.summaryRequests()).toEqual([summaryPath('p1')]);
      await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
      await expect(page).toHaveURL(/projectId=p2/);
      await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
      const region = page.getByRole('region', { name: '流程前置资料', exact: true });
      const backend = region.getByRole('combobox', {
        name: '选择已发布文档：系统单元说明（后端）',
      });
      await expect(backend).toBeEnabled();
      await expect(
        backend.getByRole('option', { name: documents[2]!.title, exact: true }),
      ).toHaveCount(1);
      const lateResponse = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/api/v1/projects/p1/document-summaries',
      );
      old.release();
      await (await lateResponse).finished();
      await afterBrowserPaint(page);

      expect(fixture.summaryRequests()).toEqual([summaryPath('p1'), summaryPath('p2')]);
      await expect(
        backend.getByRole('option', { name: documents[0]!.title, exact: true }),
      ).toHaveCount(0);
      await expect(
        backend.getByRole('option', { name: documents[1]!.title, exact: true }),
      ).toHaveCount(0);
      await expect(
        backend.getByRole('option', { name: documents[2]!.title, exact: true }),
      ).toHaveCount(1);
      expect(fixture.writes()).toEqual([]);
    } finally {
      old.release();
    }
  });
}

test.afterEach(async ({ page }, testInfo) => {
  const ledger = ledgers.get(page);
  if (!ledger) return;
  ledgers.delete(page);
  await testInfo.attach('workflow-prerequisites-network-ledger', {
    body: JSON.stringify(ledger, null, 2),
    contentType: 'application/json',
  });
  expect(ledger.rejectedDocuments, '资料选择只能读取紧凑 document-summaries').toEqual([]);
  expect(ledger.rejectedWrites, '不允许其他写操作或普通成员绑定').toEqual([]);
});

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 流程资料布局、选择绑定和手动输入`, async ({ page }) => {
    const fixture = await installPrerequisiteFixtures(page);
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
    expect(fixture.writes()).toEqual([
      { documentId: documents[0].id, roleId: 'role-backend', required: true, expectedVersion: 3 },
    ]);
    await frontend.selectOption(documents[1].id);
    await region.getByRole('button', { name: '绑定给前端', exact: true }).click();
    expect(fixture.writes()[1]).toEqual({
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
    expect(fixture.summaryRequests()).toEqual([summaryPath('p1')]);
  });
}

test('普通成员在无已发布资料时保留准备入口与权限提示', async ({ page }) => {
  const fixture = await installPrerequisiteFixtures(page, false, true);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/workflows?projectId=p1');
  await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
  const region = page.getByRole('region', { name: '流程前置资料', exact: true });
  await expect(region.getByRole('combobox').first()).toBeEnabled();
  await expect(region.getByRole('combobox').first().getByRole('option')).toHaveCount(1);
  await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
  await expect(region.getByText(/请项目 OWNER 或 ADMIN 在本页完成资料绑定/).first()).toBeVisible();
  await expect(region.getByRole('link', { name: '准备与发布知识资料', exact: true })).toBeVisible();
  expect(fixture.writes()).toEqual([]);
  expect(fixture.summaryRequests()).toEqual([summaryPath('p1')]);
});

async function openSoftwarePrerequisites(page: Page) {
  await page.goto('/workflows?projectId=p1');
  await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
  const region = page.getByRole('region', { name: '流程前置资料', exact: true });
  await expect(region).toBeVisible();
  return region;
}

for (const width of [1440, 390]) {
  test(`${width}px 自动读取第二页概要并可选择后页文档`, async ({ page }) => {
    const fixture = await installPrerequisiteFixtures(page);
    fixture.projects.p1.pages = {
      '': { items: [publishedSummary(documents[0]!)], nextCursor: 'published-page-2', total: 2 },
      'published-page-2': { items: [publishedSummary(documents[2]!)], nextCursor: null, total: 2 },
    };
    await page.setViewportSize({ width, height: 1000 });
    const region = await openSoftwarePrerequisites(page);
    const backend = region.getByRole('combobox', { name: '选择已发布文档：系统单元说明（后端）' });
    await expect(backend).toBeEnabled();
    await expect(
      backend.getByRole('option', { name: documents[2]!.title, exact: true }),
    ).toHaveCount(1);
    await backend.selectOption(documents[2]!.id);
    await expect(backend).toHaveValue(documents[2]!.id);
    await expect(region.getByRole('button', { name: '绑定给后端', exact: true })).toBeEnabled();
    expect(fixture.summaryRequests()).toEqual([
      summaryPath('p1'),
      summaryPath('p1', 'published-page-2'),
    ]);
    expect(fixture.writes()).toEqual([]);
  });

  test(`${width}px 第二页失败保留首屏选项与错误，绑定不清列表错误且列表可独立重试`, async ({
    page,
  }) => {
    const fixture = await installPrerequisiteFixtures(page);
    fixture.projects.p1.pages = {
      '': { items: [publishedSummary(documents[0]!)], nextCursor: 'published-page-2', total: 2 },
      'published-page-2': 503,
    };
    await page.setViewportSize({ width, height: 1000 });
    const region = await openSoftwarePrerequisites(page);
    const backend = region.getByRole('combobox', { name: '选择已发布文档：系统单元说明（后端）' });
    await expect(backend).toBeEnabled();
    await expect(region.getByRole('alert')).toContainText('资料列表后续读取失败');
    await expect(region.getByText(/^暂无可选的已发布资料/)).toHaveCount(0);
    await expect(
      backend.getByRole('option', { name: documents[0]!.title, exact: true }),
    ).toHaveCount(1);
    await expect(
      backend.getByRole('option', { name: documents[2]!.title, exact: true }),
    ).toHaveCount(0);
    await backend.selectOption(documents[0]!.id);
    await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
    await expect(
      region.getByRole('group', { name: '系统单元说明（后端）', exact: true }),
    ).toContainText('已绑定');
    await expect(region.getByRole('alert')).toContainText('资料列表后续读取失败');
    expect(fixture.summaryRequests()).toEqual([
      summaryPath('p1'),
      summaryPath('p1', 'published-page-2'),
    ]);
    const bindingReads = fixture.bindingReads();
    fixture.projects.p1.pages['published-page-2'] = {
      items: [publishedSummary(documents[2]!)],
      nextCursor: null,
      total: 2,
    };
    await region.getByRole('button', { name: '重试资料列表', exact: true }).click();
    await expect(backend).toBeEnabled();
    await expect(
      backend.getByRole('option', { name: documents[2]!.title, exact: true }),
    ).toHaveCount(1);
    await expect(backend).toHaveValue(documents[0]!.id);
    await expect(region.getByRole('button', { name: '重试资料列表', exact: true })).toHaveCount(0);
    expect(fixture.bindingReads()).toEqual(bindingReads);
    expect(fixture.summaryRequests()).toEqual([
      summaryPath('p1'),
      summaryPath('p1', 'published-page-2'),
      summaryPath('p1'),
      summaryPath('p1', 'published-page-2'),
    ]);
  });

  test(`${width}px 首次资料列表失败不能显示空列表，绑定失败也可独立恢复`, async ({ page }) => {
    const fixture = await installPrerequisiteFixtures(page);
    fixture.projects.p1.pages[''] = 503;
    fixture.projects.p1.bindingReadStatus = 503;
    await page.setViewportSize({ width, height: 1000 });
    const region = await openSoftwarePrerequisites(page);
    const backend = region.getByRole('combobox', { name: '选择已发布文档：系统单元说明（后端）' });
    await expect(region.getByRole('button', { name: '重试资料列表', exact: true })).toBeEnabled();
    await expect(region.getByRole('button', { name: '重试绑定状态', exact: true })).toBeEnabled();
    await expect(region.getByText(/^暂无可选的已发布资料/)).toHaveCount(0);
    await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
    await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
    fixture.projects.p1.pages[''] = {
      items: documents.slice(0, 2).map((item) => publishedSummary(item)),
      nextCursor: null,
      total: 2,
    };
    const bindingReads = fixture.bindingReads();
    await region.getByRole('button', { name: '重试资料列表', exact: true }).click();
    await expect(
      backend.getByRole('option', { name: documents[0]!.title, exact: true }),
    ).toHaveCount(1);
    await expect(backend).toBeEnabled();
    await backend.selectOption(documents[0]!.id);
    await expect(backend).toHaveValue(documents[0]!.id);
    await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
    await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
    expect(fixture.bindingReads()).toEqual(bindingReads);
    const summaryRequests = fixture.summaryRequests();
    fixture.projects.p1.bindingReadStatus = 200;
    await region.getByRole('button', { name: '重试绑定状态', exact: true }).click();
    await expect(region.getByRole('button', { name: '绑定给后端', exact: true })).toBeEnabled();
    await expect(backend).toHaveValue(documents[0]!.id);
    await expect(region.getByText('待绑定', { exact: true })).toHaveCount(2);
    expect(fixture.summaryRequests()).toEqual(summaryRequests);
    expect(fixture.bindingReads()).toHaveLength(bindingReads.length + 1);
    expect(fixture.writes()).toEqual([]);
  });

  test(`${width}px 绑定409后状态刷新失败保留两类错误与待确认，重试前禁止再次写入`, async ({
    page,
  }) => {
    const fixture = await installPrerequisiteFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    const region = await openSoftwarePrerequisites(page);
    const backend = region.getByRole('combobox', { name: '选择已发布文档：系统单元说明（后端）' });
    await expect(backend).toBeEnabled();
    await backend.selectOption(documents[0]!.id);
    fixture.projects.p1.bindingWriteStatus = 409;
    fixture.projects.p1.bindingReadStatusAfterWrite = 503;
    await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
    await expect(region.getByRole('alert')).toContainText('绑定版本冲突，请读取最新状态');
    await expect(region.getByRole('alert')).toContainText('绑定状态刷新失败');
    await expect(region.getByRole('alert')).toContainText('角色绑定状态暂不可读');
    await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
    await expect(region.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
    await expect(backend).toHaveValue(documents[0]!.id);
    const manual = region.getByRole('group', { name: '系统单元说明（后端）', exact: true });
    await manual.getByText('手动填写文档标识', { exact: true }).click();
    await manual
      .getByRole('textbox', { name: '文档标识：系统单元说明（后端）' })
      .fill(documents[1]!.id);
    await expect(backend).toHaveValue(documents[1]!.id);
    await afterBrowserPaint(page);
    expect(fixture.writes()).toHaveLength(1);
    expect(fixture.bindingReads()).toHaveLength(2);
    const summaryRequests = fixture.summaryRequests();
    fixture.projects.p1.bindingReadStatus = 200;
    fixture.projects.p1.bindingReadStatusAfterWrite = null;
    fixture.projects.p1.bindingWriteStatus = 200;
    fixture.projects.p1.version = 8;
    await region.getByRole('button', { name: '重试绑定状态', exact: true }).click();
    await expect(region.getByRole('button', { name: '绑定给后端', exact: true })).toBeEnabled();
    await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
    await expect(manual.getByText('已绑定', { exact: true })).toBeVisible();
    expect(fixture.writes()[1]).toEqual({
      documentId: documents[1]!.id,
      roleId: 'role-backend',
      required: true,
      expectedVersion: 8,
    });
    expect(fixture.summaryRequests()).toEqual(summaryRequests);
  });

  for (const kind of ['summary', 'binding-read', 'binding-write'] as const) {
    test(`${width}px 切换项目隔离旧项目迟到${kind}结果`, async ({ page }) => {
      const old = latch();
      const fixture = await installPrerequisiteFixtures(page, true, false, {
        projectId: 'p1',
        kind,
        ready: old.ready,
      });
      fixture.projects.p2.canManage = false;
      fixture.projects.p2.pages[''] = {
        items: [publishedSummary(documents[2]!, 'p2')],
        nextCursor: null,
        total: 1,
      };
      await page.setViewportSize({ width, height: 1000 });
      try {
        const region = await openSoftwarePrerequisites(page);
        const backend = region.getByRole('combobox', {
          name: '选择已发布文档：系统单元说明（后端）',
        });
        if (kind === 'summary') {
          await expect.poll(() => fixture.summaryRequests()).toEqual([summaryPath('p1')]);
          await expect(backend).toBeDisabled();
        } else if (kind === 'binding-read') {
          await expect(backend).toBeEnabled();
          await expect.poll(() => fixture.bindingReads()).toHaveLength(1);
          await expect(region.getByText('待确认', { exact: true })).toHaveCount(2);
        } else {
          await expect(backend).toBeEnabled();
          await backend.selectOption(documents[0]!.id);
          await region.getByRole('button', { name: '绑定给后端', exact: true }).click();
          await expect.poll(() => fixture.writes()).toHaveLength(1);
          await expect(
            region.getByRole('button', { name: '绑定中…', exact: true }).first(),
          ).toBeDisabled();
        }
        await page.getByRole('combobox', { name: '选择项目', exact: true }).selectOption('p2');
        await expect(page).toHaveURL(/projectId=p2/);
        await page.getByRole('button', { name: '载入软件交付模板', exact: true }).click();
        const current = page.getByRole('region', { name: '流程前置资料', exact: true });
        const currentBackend = current.getByRole('combobox', {
          name: '选择已发布文档：系统单元说明（后端）',
        });
        await expect(currentBackend).toBeEnabled();
        await expect(
          currentBackend.getByRole('option', { name: documents[2]!.title, exact: true }),
        ).toHaveCount(1);
        await expect(
          current.getByText(/请项目 OWNER 或 ADMIN 在本页完成资料绑定/).first(),
        ).toBeVisible();
        const before = { summaries: fixture.summaryRequests(), bindings: fixture.bindingReads() };
        const lateResponse = page.waitForResponse((response) => {
          const url = new URL(response.url());
          return kind === 'summary'
            ? url.pathname === '/api/v1/projects/p1/document-summaries'
            : url.pathname === '/api/v1/projects/p1/knowledge-bindings' &&
                response.request().method() === (kind === 'binding-write' ? 'PUT' : 'GET');
        });
        old.release();
        await (await lateResponse).finished();
        await afterBrowserPaint(page);
        await expect(page.getByRole('combobox', { name: '选择项目', exact: true })).toHaveValue(
          'p2',
        );
        await expect(
          currentBackend.getByRole('option', { name: documents[0]!.title, exact: true }),
        ).toHaveCount(0);
        await expect(
          currentBackend.getByRole('option', { name: documents[2]!.title, exact: true }),
        ).toHaveCount(1);
        await expect(current.getByRole('button', { name: /^绑定给/ })).toHaveCount(0);
        await expect(current.getByText('已绑定', { exact: true })).toHaveCount(0);
        await expect(page.getByText(/资料已绑定给接收角色/)).toHaveCount(0);
        await expect(
          current.getByRole('link', { name: '准备与发布知识资料', exact: true }),
        ).toHaveAttribute('href', '/knowledge?projectId=p2');
        expect(fixture.summaryRequests()).toEqual(before.summaries);
        expect(fixture.bindingReads()).toEqual(before.bindings);
        expect(fixture.writes()).toHaveLength(kind === 'binding-write' ? 1 : 0);
      } finally {
        old.release();
      }
    });
  }
}
