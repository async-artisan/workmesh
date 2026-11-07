import { expect, test, type Page, type Route } from '@playwright/test';

const project = { id: 'p1', key: 'DEMO', name: 'Browser demo', version: 7 };
const roles = [
  { id: 'r-product', projectId: 'p1', key: 'product', title: '产品', isActive: true },
  { id: 'r-frontend', projectId: 'p1', key: 'frontend', title: '前端', isActive: true },
  { id: 'r-qa', projectId: 'p1', key: 'qa', title: '测试', isActive: true },
  { id: 'r-ops', projectId: 'p1', key: 'ops', title: '运维', isActive: true },
];
const packages = roles.map((role) => ({
  id: 'pv-' + role.key,
  packageId: role.key + '-pack',
  version: '1.0.0',
  roleKey: role.key,
  manifestDigest: role.key.padEnd(2, '0').repeat(32).slice(0, 64),
  scope: 'BUILTIN',
}));
const digest = 'd'.repeat(64);

function envelope(data: unknown) {
  return { data, meta: { requestId: 'ui-review' } };
}

async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(envelope(data)),
  });
}

async function setup(page: Page) {
  const requestBodies = {
    validate: [] as unknown[],
    previews: [] as unknown[],
    tickets: [] as unknown[],
    publishes: [] as unknown[],
    publishHeaders: [] as Array<Record<string, string>>,
  };
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('workmesh.projectId', 'p1');
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      if (path === '/api/health') {
        await json(route, { status: 'ok' });
        return;
      }
      if (path === '/api/v1/activity') {
        await json(route, { items: [], nextCursor: null });
        return;
      }
      if (path === '/api/v1/workbench') {
        await json(route, {
          counts: { reviews: 0, changes: 0, readyTasks: 0, total: 0 },
          reviews: [],
          changes: [],
          readyTasks: [],
          warnings: [],
        });
        return;
      }
      if (path === '/api/v1/auth/session') {
        await json(route, {
          authenticated: true,
          sessionId: 'session-ui',
          expiresAt: '2099-01-01T00:00:00.000Z',
          idleExpiresAt: '2099-01-01T00:00:00.000Z',
          csrfToken: 'csrf-ui',
          user: { id: 'user-ui', email: 'ui@example.test' },
        });
        return;
      }
      if (path === '/api/v1/projects' && request.method() === 'GET') {
        await json(route, [project]);
        return;
      }
      if (path === '/api/v1/projects/p1/roles') {
        await json(route, roles);
        return;
      }
      if (path === '/api/v1/projects/p1/role-packages') {
        await json(route, { items: packages, nextCursor: null });
        return;
      }
      if (path === '/api/v1/projects/p1/workflow-definitions') {
        await json(route, { items: [], nextCursor: null });
        return;
      }
      if (path === '/api/v1/projects/p1/workflow-definitions/validate') {
        requestBodies.validate.push(request.postDataJSON());
        await json(route, { valid: true, issues: [], digest });
        return;
      }
      if (path === '/api/v1/auth/action-previews') {
        const body = request.postDataJSON();
        requestBodies.previews.push(body);
        await json(route, {
          binding: body,
          actionDigest: 'a'.repeat(64),
          display: {
            action: body.action,
            targetType: body.targetType,
            targetId: body.targetId,
            expectedVersion: body.expectedVersion,
            projectId: body.projectId,
            roleSlot: null,
          },
        });
        return;
      }
      if (path === '/api/v1/auth/confirmation-tickets') {
        requestBodies.tickets.push(request.postDataJSON());
        await json(route, {
          ticketId: 'ticket-ui',
          ticketSecret: 'secret-ui',
          expiresAt: '2099-01-01T00:00:00.000Z',
          actionDigest: 'a'.repeat(64),
        });
        return;
      }
      if (path === '/api/v1/projects/p1/workflow-definitions/standard/publish') {
        requestBodies.publishes.push(request.postDataJSON());
        requestBodies.publishHeaders.push(request.headers());
        await json(
          route,
          {
            definitionRevisionId: 'revision-ui',
            revision: 1,
            digest,
            projectVersion: 8,
            replayed: false,
          },
          201,
        );
        return;
      }
      await json(route, {});
    },
  );
  return requestBodies;
}

async function openWorkflows(page: Page) {
  await page.goto('/workflows');
  await expect(page.getByRole('heading', { name: '流程配置' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '选择项目' })).toHaveValue('p1');
}

test.describe('流程配置结构化编辑器', () => {
  test('切换结构化模式、未知字段保留、依赖错误可见', async ({ page }) => {
    await setup(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openWorkflows(page);
    const fixture = {
      schemaVersion: '1.0',
      protocolVersion: '1.0',
      workflowKey: 'demo',
      title: 'Demo',
      baseRevisionId: null,
      roleExclusions: [],
      stepRemovals: [],
      roleSlots: [{ key: 'approve', roleKey: 'product', kind: 'TASK_ACCEPTANCE' }],
      steps: [
        {
          key: 'build',
          roleKey: 'product',
          kind: 'DELIVERY',
          deps: ['release'],
          outputKinds: ['IMPL'],
          gates: [],
        },
        {
          key: 'release',
          roleKey: 'ops',
          kind: 'RELEASE',
          deps: ['build'],
          outputKinds: ['RELEASE'],
          gates: [],
        },
      ],
      unknownConfig: { keep: true },
    };
    const editor = page.getByLabel('流程定义 JSON');
    await editor.fill(JSON.stringify(fixture, null, 2));
    await page.getByRole('button', { name: '结构化编辑' }).click();
    await page.getByLabel('流程名称').fill('浏览器修改流程');
    await expect(page.getByLabel('流程名称')).toHaveValue('浏览器修改流程');
    await page.getByRole('button', { name: '高级 JSON' }).click();
    await expect(page.getByLabel('流程定义 JSON')).toHaveValue(/unknownConfig/);
    await page.getByRole('button', { name: '结构化编辑' }).click();
    await expect(page.locator('body')).toContainText('步骤依赖存在循环');
    await expect(page.getByRole('checkbox', { name: 'release' })).toBeChecked();
    await expect(page.locator('body')).toContainText('结构化编辑不会绕过服务端编译');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: '.tmp/ui-review-captures/workflow-1440.png', fullPage: true });
  });

  test('无效 JSON 可在高级模式中修复并保持编辑能力', async ({ page }) => {
    await setup(page);
    await openWorkflows(page);
    await page.getByRole('button', { name: '高级 JSON' }).click();
    const editor = page.getByLabel('流程定义 JSON');
    await editor.fill('{ invalid');
    await expect(editor).toHaveValue('{ invalid');
    await page.getByRole('button', { name: '结构化编辑' }).click();
    await expect(page.getByRole('status')).toContainText('不是 JSON 对象');
    await page.getByRole('button', { name: '高级 JSON' }).click();
    await editor.fill(
      JSON.stringify(
        {
          schemaVersion: '1.0',
          protocolVersion: '1.0',
          workflowKey: 'standard',
          title: '修复',
          roleExclusions: [],
          stepRemovals: [],
          roleSlots: [],
          steps: [],
        },
        null,
        2,
      ),
    );
    await page.getByRole('button', { name: '结构化编辑' }).click();
    await expect(page.getByLabel('流程名称')).toHaveValue('修复');
  });

  test('草稿自动保存，发布请求携带真实摘要和 CAS 字段', async ({ page }) => {
    const requestBodies = await setup(page);
    await openWorkflows(page);
    await page.getByRole('button', { name: '载入标准模板' }).click();
    const editor = page.getByLabel('流程定义 JSON');
    const definition = JSON.parse(await editor.inputValue()) as {
      steps: Array<Record<string, unknown>>;
      unknownConfig?: unknown;
    };
    definition.unknownConfig = { keep: true };
    definition.steps[0].displayName = '产品方案';
    definition.steps[0].vendorConfig = { keep: 'nested' };
    await editor.fill(JSON.stringify(definition, null, 2));
    await expect(page.getByText('未发布草稿')).toBeVisible();
    await page.waitForTimeout(750);
    expect(await page.evaluate(() => localStorage.getItem('workmesh.workflowDraft.p1'))).toContain(
      'standard',
    );
    const savedDefinition = await page.evaluate(() => {
      const draft = JSON.parse(localStorage.getItem('workmesh.workflowDraft.p1') ?? '{}');
      return JSON.parse(draft.text);
    });
    expect(savedDefinition.steps[0]).toMatchObject({
      displayName: '产品方案',
      vendorConfig: { keep: 'nested' },
    });
    expect(savedDefinition.unknownConfig).toEqual({ keep: true });
    await page.getByRole('button', { name: '校验并准备发布' }).click();
    await expect(page.getByText('校验结果')).toBeVisible();
    await page.getByRole('button', { name: '发布（需要二次验证）' }).click();
    await page.getByRole('dialog').getByLabel('确认密码').fill('ui-password');
    await page.getByRole('button', { name: '验证密码并签发票据' }).click();
    await page.getByRole('button', { name: '确认发布流程' }).click();
    await expect(page.getByText(/流程 standard 已发布/)).toBeVisible();
    await expect(page.getByText('未发布草稿', { exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('workmesh.workflowDraft.p1'))).toBeNull();

    expect(requestBodies.validate).toHaveLength(1);
    const validateBody = requestBodies.validate[0] as {
      definition: Record<string, unknown>;
      packageLocks: Array<Record<string, unknown>>;
    };
    expect(validateBody.definition.unknownConfig).toEqual({ keep: true });
    expect(validateBody.definition.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: '产品方案', vendorConfig: { keep: 'nested' } }),
      ]),
    );
    expect(validateBody.packageLocks.map((lock) => lock.roleKey)).toEqual([
      'frontend',
      'ops',
      'product',
      'qa',
    ]);

    expect(requestBodies.previews).toHaveLength(1);
    const previewBody = requestBodies.previews[0] as {
      action: string;
      projectId: string;
      targetType: string;
      targetId: string;
      expectedVersion: number;
      roleSlot: unknown;
      payload: {
        expectedCurrentRevision: number;
        compiledDigest: string;
        packageLocks: Array<Record<string, unknown>>;
      };
    };
    expect(previewBody).toMatchObject({
      action: 'WORKFLOW_CONFIG_PUBLISH',
      projectId: 'p1',
      targetType: 'WORKFLOW_DEFINITION',
      targetId: 'standard',
      expectedVersion: 7,
      roleSlot: null,
    });
    expect(previewBody.payload.expectedCurrentRevision).toBe(0);
    expect(previewBody.payload.compiledDigest).toBe(digest);
    expect(previewBody.payload.packageLocks.map((lock) => lock.roleKey)).toEqual([
      'frontend',
      'ops',
      'product',
      'qa',
    ]);

    expect(requestBodies.tickets).toHaveLength(1);
    expect(requestBodies.tickets[0]).toMatchObject({
      action: 'WORKFLOW_CONFIG_PUBLISH',
      projectId: 'p1',
      targetType: 'WORKFLOW_DEFINITION',
      targetId: 'standard',
      expectedVersion: 7,
      actionDigest: 'a'.repeat(64),
      password: 'ui-password',
    });

    expect(requestBodies.publishes).toHaveLength(1);
    const publishBody = requestBodies.publishes[0] as {
      expectedVersion: number;
      expectedCurrentRevision: number;
      definition: Record<string, unknown>;
      packageLocks: Array<Record<string, unknown>>;
      confirmation: { ticketId: string; ticketSecret: string };
    };
    expect(publishBody.expectedVersion).toBe(7);
    expect(publishBody.expectedCurrentRevision).toBe(0);
    expect(publishBody.definition.unknownConfig).toEqual({ keep: true });
    expect(publishBody.definition.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: '产品方案', vendorConfig: { keep: 'nested' } }),
      ]),
    );
    expect(publishBody.packageLocks.map((lock) => lock.roleKey)).toEqual([
      'frontend',
      'ops',
      'product',
      'qa',
    ]);
    expect(publishBody.confirmation).toEqual({ ticketId: 'ticket-ui', ticketSecret: 'secret-ui' });
    expect(requestBodies.publishHeaders[0]['idempotency-key']).toBeTruthy();
  });

  for (const width of [1440, 1024, 640, 390]) {
    test(`${width}px 结构化编辑器显示中文类型且无页面级横向溢出`, async ({ page }) => {
      await setup(page);
      await page.setViewportSize({ width, height: 844 });
      await openWorkflows(page);
      await page.getByRole('button', { name: '载入标准模板' }).click();
      await page.getByRole('button', { name: '结构化编辑' }).click();
      const type = page.getByLabel('步骤 1 类型');
      await expect(type.locator('option[value="PRODUCT"]')).toHaveText('产品');
      await expect(type.locator('option[value="DELIVERY"]')).toHaveText('交付');
      await expect(type.locator('option[value="VERIFY"]')).toHaveText('验证');
      await expect(type.locator('option[value="RELEASE"]')).toHaveText('发布');
      await expect(type).toHaveValue('PRODUCT');
      const displayName = page.getByLabel('步骤 1 显示名称');
      await displayName.fill('产品方案');
      await expect(displayName).toHaveValue('产品方案');
      await page.getByRole('button', { name: '高级 JSON' }).click();
      expect(
        JSON.parse(await page.getByLabel('流程定义 JSON').inputValue()).steps[0].displayName,
      ).toBe('产品方案');
      await page.getByRole('button', { name: '结构化编辑' }).click();
      await expect(page.getByLabel('步骤 1 显示名称')).toHaveValue('产品方案');
      await type.focus();
      await expect(type).toBeFocused();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow).toBe(false);
      await page.screenshot({
        path: `.tmp/ui-review-captures/workflow-${width}.png`,
        fullPage: true,
      });
    });
  }
});
