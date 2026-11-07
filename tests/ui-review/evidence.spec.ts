import { expect, test, type Locator, type Page } from '@playwright/test';
import { installReviewFixtures, requirement } from './fixtures';

const reviewId = 'review-evidence';
const artifactSetId = 'set-evidence';
const artifactId = 'artifact-evidence';
const fullText =
  '# 完整交付证据\n' +
  '等待时间、依赖、负责人和下一步均已核对。\n'.repeat(150) +
  'technical/path/'.repeat(35);
const digest = 'e'.repeat(64);

/** Uses the existing review/artifact/task contracts; no live API or write is used. */
async function installEvidenceFixture(page: Page, artifactSetStatus = 200) {
  await installReviewFixtures(page);
  let contentReads = 0;
  let releaseContent: () => void = () => undefined;
  const firstContentGate = new Promise<void>((resolve) => {
    releaseContent = resolve;
  });
  await page.route(
    (url) => url.pathname.startsWith('/api/v1/'),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const reply = (data: unknown) =>
        route.fulfill({ json: { data, meta: { requestId: 'ui-review-evidence' } } });
      if (path === `/api/v1/review-requests/${reviewId}`)
        return reply({
          id: reviewId,
          projectId: 'p1',
          kind: 'TASK_ACCEPTANCE',
          status: 'OPEN',
          version: 3,
          subjectDigest: digest,
          documentRevisionId: null,
          artifactSetId,
          taskId: 'task-evidence',
          subject: null,
          decisions: [],
          slots: [
            {
              id: 'slot-evidence',
              slotKey: 'owner',
              requiredUserId: 'fixture-user',
              requiredRoleId: 'role-1',
              viewerCanDecide: true,
            },
          ],
        });
      if (path === `/api/v1/artifact-sets/${artifactSetId}`) {
        if (artifactSetStatus === 403)
          return route.fulfill({
            status: 403,
            json: {
              error: {
                code: 'FORBIDDEN',
                message: '当前账号无权读取交付物证据',
                requestId: 'ui-review-evidence-403',
              },
            },
          });
        return reply({
          id: artifactSetId,
          taskId: 'task-evidence',
          taskGeneration: 1,
          snapshotId: 'snapshot-evidence',
          manifestDigest: digest,
          workflowDefinitionRevisionId: 'wf-rev-evidence',
          localRunId: 'local-evidence',
          candidateRevisionIds: [],
          createdAt: '2026-11-05T12:00:00.000Z',
          codeReview: { required: false, acceptable: true, evidence: [] },
          artifacts: [
            {
              id: artifactId,
              kind: 'IMPL',
              schemaVersion: '1.0',
              storage: 'HOSTED',
              mediaType: 'text/markdown',
              byteLength: Buffer.byteLength(fullText),
              sha256: digest,
              projectRepositoryId: null,
              commitSha: null,
              repoPath: 'docs/implementation.md',
              summary: '后端交付的截断证据正文',
              contentPreview: { text: '# 截断证据预览', truncated: true },
              checks: [
                { code: 'unit', passed: true, message: '单测通过', source: 'AGENT_REPORTED' },
                { code: 'lint', passed: false, message: '需修复格式', source: 'AGENT_REPORTED' },
              ],
            },
          ],
        });
      }
      if (path === `/api/v1/artifact-sets/${artifactSetId}/artifacts/${artifactId}/content`) {
        contentReads += 1;
        if (contentReads === 1) {
          await firstContentGate;
          return route.fulfill({
            status: 500,
            json: {
              error: {
                code: 'CONTENT_UNAVAILABLE',
                message: '全文暂时不可用，请重试',
                requestId: 'ui-review-evidence-content-500',
              },
            },
          });
        }
        return reply({
          artifactId,
          mediaType: 'text/markdown',
          byteLength: Buffer.byteLength(fullText),
          sha256: digest,
          storage: 'HOSTED',
          text: fullText,
          bodyBase64: Buffer.from(fullText).toString('base64'),
        });
      }
      if (path === '/api/v1/tasks/task-evidence')
        return reply({
          id: 'task-evidence',
          projectId: 'p1',
          workflowInstanceId: 'inst-evidence',
          stepKey: 'backend-impl',
          stepDisplayName: '后端交付',
          roleId: 'role-1',
          responsibleUserId: 'fixture-user',
          version: 2,
          generation: 1,
          executionStatus: 'REVIEW_PENDING',
          workStatus: 'ACTIVE',
          currentClaim: null,
        });
      if (path === '/api/v1/workflow-instances/inst-evidence')
        return reply({ requirementId: requirement.id });
      if (path === '/api/v1/projects/p1/documents') return reply({ items: [], nextCursor: null });
      return route.fallback();
    },
  );
  return { releaseContent: () => releaseContent(), contentReads: () => contentReads };
}

async function readable(locator: Locator, minimum = 12) {
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(minimum);
}

async function noPageOverflow(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(1);
}

for (const width of [1440, 1024, 640, 390]) {
  test(`${width}px 截断证据加载、失败重试、完整摘要和键盘操作`, async ({ page }) => {
    const fixture = await installEvidenceFixture(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/reviews/${reviewId}`);
    await expect(page.getByText('正文预览已截断。', { exact: true })).toBeVisible();
    await expect(page.getByText('不完整', { exact: true })).toBeVisible();
    const artifact = page.locator('.review-artifact-row');
    await readable(artifact.locator('.review-artifact-summary'), 14);
    await readable(artifact.locator('.task-row-meta').first());
    await readable(artifact.locator('.review-checks'));
    await expect(artifact.locator('.review-checks')).toContainText('✓ unit');
    await expect(artifact.locator('.review-checks')).toContainText('✗ lint');
    await noPageOverflow(page);

    await page.getByRole('button', { name: '作出决定', exact: true }).click();
    const next = page.getByRole('button', { name: /下一步：预览并验证/ });
    await expect(next).toBeDisabled();
    const load = page.getByRole('button', { name: '加载完整正文', exact: true });
    await load.focus();
    await expect(load).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('正在读取完整正文…', { exact: true })).toBeVisible();
    fixture.releaseContent();
    await expect(page.getByText(/完整正文加载失败：/)).toBeVisible();
    await expect(next).toBeDisabled();
    await noPageOverflow(page);
    const retry = page.getByRole('button', { name: '重试加载完整正文', exact: true });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(
      artifact.locator('pre').filter({ hasText: '等待时间、依赖、负责人和下一步' }),
    ).toBeVisible();
    await readable(artifact.locator('pre').last(), 14);
    await expect(page.getByText('完整', { exact: true })).toBeVisible();
    await expect(next).toBeEnabled();
    await expect(page.getByRole('button', { name: '下载证据', exact: true })).toBeVisible();
    expect(fixture.contentReads()).toBe(2);

    const digestButton = artifact.getByRole('button', { name: /sha256/ });
    await digestButton.focus();
    await page.keyboard.press('Enter');
    await expect(artifact.getByLabel('sha256完整值')).toHaveText(digest);
    await expect(artifact.getByRole('button', { name: '复制完整值', exact: true })).toBeVisible();
    await noPageOverflow(page);
  });

  test(`${width}px 证据上下文 403 保留权限说明与可访问技术详情`, async ({ page }) => {
    await installEvidenceFixture(page, 403);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/reviews/${reviewId}`);
    await expect(page.getByText('无法读取交付物上下文', { exact: true })).toBeVisible();
    await expect(page.getByText('你没有查看该上下文的权限。', { exact: true })).toBeVisible();
    await expect(page.getByText(/联系项目管理员开通该上下文的权限/)).toBeVisible();
    await expect(page.getByRole('button', { name: '重试读取交付物', exact: true })).toHaveCount(0);
    await expect(page.getByText('该评审没有关联交付物', { exact: true })).toHaveCount(0);
    const details = page.getByText('查看技术详情', { exact: true });
    await details.focus();
    await page.keyboard.press('Enter');
    const detailText = page.locator('.wm-error-state__detail');
    await expect(detailText).toContainText('ui-review-evidence-403');
    await readable(detailText);
    await noPageOverflow(page);
  });

  test(`${width}px 审计活动通知和 Agent 提示可读且可键盘关闭`, async ({ page }) => {
    await installReviewFixtures(page);
    const actorEmail = `${'audit-fixture-'.repeat(6)}@example.test`;
    await page.route('**/api/v1/activity**', (route) =>
      route.fulfill({
        json: {
          data: {
            items: [
              {
                id: 'activity-evidence',
                projectId: 'p1',
                projectName: '验收示例项目',
                action: 'WORKFLOW_PUBLISH',
                targetType: 'WORKFLOW_DEFINITION',
                targetId: 'workflow-evidence',
                targetVersion: 2,
                outcome: 'SUCCESS',
                details: {},
                createdAt: '2026-11-05T12:00:00.000Z',
                actor: { id: 'fixture-user', email: actorEmail },
              },
            ],
          },
          meta: { requestId: 'ui-review-activity' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    // The existing <=1100px layout hides the decorative command rail; task actions remain available.
    const railCommand = page.locator('.rail-command code');
    if (width > 1100) await readable(railCommand);
    else await expect(railCommand).toBeHidden();
    await expect(page.locator('.rail-feed-body small')).toContainText(actorEmail);
    const bell = page.getByRole('button', { name: /^通知：/ });
    await bell.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: '通知中心', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('发布流程定义');
    await readable(panel.locator('.notification-item small'));
    await expect(panel.locator('.notification-item small')).toContainText(actorEmail);
    await noPageOverflow(page);
    const close = panel.getByRole('button', { name: '关闭通知', exact: true });
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toHaveCount(0);
    await expect(bell).toBeFocused();
  });
}
