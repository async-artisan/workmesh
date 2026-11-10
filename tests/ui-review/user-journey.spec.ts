import { expect, test, type Page } from '@playwright/test';
import { installReviewFixtures, requirement, revisions, task } from './fixtures';
import type { ReviewDiscussion } from '../../apps/web/src/api/reviewDiscussions';

async function taskJourneyFixtures(page: Page) {
  await installReviewFixtures(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          Reflect.set(window, '__copiedTaskValue', value);
        },
      },
    });
  });
  const tasks = [
    {
      ...task,
      id: 'task-before',
      stepKey: 'design',
      stepDisplayName: '上游设计交付',
      executionStatus: 'DONE',
      responsibleUser: { id: 'designer', email: 'designer@example.test' },
      workflowWorkStatus: 'ACTIVE',
      claimEligibility: { canClaim: false, reason: 'NOT_RESPONSIBLE' },
    },
    { ...task, workflowWorkStatus: 'ACTIVE', claimEligibility: { canClaim: true, reason: null } },
    {
      ...task,
      id: 'task-after',
      stepKey: 'qa',
      stepDisplayName: '下游质量验收',
      responsibleUser: { id: 'qa', email: 'qa@example.test' },
      workflowWorkStatus: 'ACTIVE',
      claimEligibility: { canClaim: false, reason: 'NOT_RESPONSIBLE' },
    },
    {
      ...task,
      id: 'task-peer',
      stepKey: 'peer',
      stepDisplayName: '其他成员可领取任务',
      responsibleUser: { id: 'peer', email: 'peer@example.test' },
      workflowWorkStatus: 'ACTIVE',
      claimEligibility: { canClaim: false, reason: 'NOT_RESPONSIBLE' },
    },
  ];
  await page.route('**/api/v1/projects/p1/requirements/req-1', (route) =>
    route.fulfill({
      json: {
        data: {
          requirement,
          acceptanceKeys: [],
          tasks,
          artifacts: [],
          reviews: [],
          changes: [],
          counts: { tasks: tasks.length, artifacts: 0, reviews: 0, changes: 0 },
        },
        meta: { requestId: 'journey-tasks' },
      },
    }),
  );
  await page.route('**/api/v1/workflow-definition-revisions/wf-rev-1', (route) =>
    route.fulfill({
      json: {
        data: {
          id: 'wf-rev-1',
          projectId: 'p1',
          workflowKey: 'standard',
          revision: 1,
          digest: 'fixture',
          definition: {
            steps: [
              { key: 'design', displayName: '上游设计交付', roleKey: 'design', deps: [] },
              {
                key: 'backend-impl',
                displayName: '后端交付',
                roleKey: 'backend',
                deps: ['design'],
              },
              { key: 'qa', displayName: '下游质量验收', roleKey: 'qa', deps: ['backend-impl'] },
              { key: 'peer', displayName: '其他成员可领取任务', roleKey: 'backend', deps: [] },
            ],
            roleSlots: [],
          },
        },
        meta: { requestId: 'journey-definition' },
      },
    }),
  );
  let failInputRead = true;
  const inputReads: string[] = [];
  await page.route('**/api/v1/tasks/*/input-status', (route) => {
    const taskId = new URL(route.request().url()).pathname.split('/')[4];
    inputReads.push(taskId);
    if (taskId === 'task-1' && failInputRead) {
      return route.fulfill({
        status: 503,
        json: { error: { code: 'TEMPORARY', message: '验收输入读取临时失败' } },
      });
    }
    return route.fulfill({
      json: {
        data: {
          taskId,
          taskVersion: 2,
          snapshotId: 'snapshot-before-change',
          checkedAt: '2026-11-09T00:00:00.000Z',
          availability: 'REQUIRES_LOCAL_CHECK',
          issue: null,
          resources: [
            {
              refId: 'prd',
              kind: 'DOCUMENT_REVISION',
              targetId: 'rev-2',
              sha256: 'b'.repeat(64),
              byteLength: 50,
              mediaType: 'text/markdown',
              authority: 'PUBLISHED',
              contentStatus: 'VERIFIED',
            },
            {
              refId: 'implementation-code',
              kind: 'ARTIFACT',
              targetId: 'commit-before-agent-fetch',
              sha256: 'c'.repeat(64),
              byteLength: 0,
              mediaType: 'application/vnd.workmesh.git-ref+json',
              authority: 'GIT_REF',
              contentStatus: 'EXTERNAL_REFERENCE',
            },
          ],
          comparison: {
            status: 'CHANGED',
            metadataChanges: ['deliveryScope'],
            changes: [
              {
                refId: 'prd',
                kind: 'DOCUMENT_REVISION',
                status: 'CHANGED',
                previousTargetId: 'rev-1',
                currentTargetId: 'rev-2',
              },
            ],
          },
        },
        meta: { requestId: 'journey-input-status' },
      },
    });
  });
  return {
    inputReads,
    recoverInputs: () => {
      failInputRead = false;
    },
  };
}

for (const width of [1440, 390]) {
  test(`${width}px 输入诊断定位缺失知识和上游工件并保留只读恢复入口`, async ({ page }) => {
    await taskJourneyFixtures(page);
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && request.method() !== 'GET')
        writes.push(request.url());
    });
    await page.route('**/api/v1/tasks/task-1/input-status', (route) =>
      route.fulfill({
        json: {
          data: {
            taskId: 'task-1',
            taskVersion: 2,
            snapshotId: null,
            checkedAt: '2026-11-09T12:00:00Z',
            availability: 'UNAVAILABLE',
            issue: 'INPUT_UNAVAILABLE',
            issuesComplete: true,
            issues: [
              {
                kind: 'KNOWLEDGE',
                reason: 'NOT_PUBLISHED',
                required: true,
                blocking: true,
                documentId: 'knowledge-policy-long-readable-document-id',
                action: 'PUBLISH_KNOWLEDGE',
                responsible: 'KNOWLEDGE_MAINTAINER',
              },
              {
                kind: 'ARTIFACT',
                reason: 'ACCEPTED_ARTIFACT_MISSING',
                required: true,
                blocking: true,
                inputKey: 'api',
                fromStepKey: 'backend',
                artifactKind: 'API_SPEC',
                action: 'DELIVER_UPSTREAM',
                responsible: 'UPSTREAM_OWNER',
              },
            ],
            resources: [],
            comparison: { status: 'UNAVAILABLE', changes: [], metadataChanges: [] },
          },
          meta: { requestId: 'diagnostic-fixture' },
        },
      }),
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/requirements/req-1?projectId=p1&tab=tasks&taskId=task-1');
    const current = page.locator('[data-task-id="task-1"]');
    const issues = current.getByRole('list', { name: '输入问题与恢复动作' });
    await expect(issues).toContainText('knowledge-policy-long-readable-document-id');
    await expect(issues).toContainText('项目知识维护者：发布必需知识文档后重新核验输入');
    await expect(issues).toContainText('上游步骤 backend · 工件 API_SPEC');
    await expect(issues).toContainText('上游任务负责人');
    const retry = current.getByRole('button', { name: '重新核验输入', exact: true });
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(issues).toBeVisible();
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });
  test(`${width}px 任务详情核对本人资格、真实ID、输入差异与上下游责任人`, async ({ page }) => {
    const { inputReads, recoverInputs } = await taskJourneyFixtures(page);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/requirements/req-1?projectId=p1&tab=tasks&taskId=task-1');
    const current = page.locator('[data-task-id="task-1"]');
    const peer = page.locator('[data-task-id="task-peer"]');
    await expect(current.getByRole('button', { name: '复制领取命令', exact: true })).toBeEnabled();
    await expect(peer).toContainText('前置任务已完成');
    await expect(peer.getByRole('button', { name: '复制领取命令', exact: true })).toBeDisabled();
    await current.getByRole('button', { name: '复制任务 ID', exact: true }).click();
    expect(await page.evaluate(() => Reflect.get(window, '__copiedTaskValue'))).toBe('task-1');
    await current.getByRole('button', { name: '复制领取命令', exact: true }).click();
    expect(await page.evaluate(() => Reflect.get(window, '__copiedTaskValue'))).toBe(
      'workmesh claim --task task-1',
    );
    const inputs = current.getByRole('region', { name: '任务输入与快照对照' });
    await expect(inputs.getByRole('alert')).toContainText('输入状态读取失败');
    await expect(inputs.getByText('必需输入不可用')).toHaveCount(0);
    const initialReads = inputReads.filter((id) => id === 'task-1').length;
    recoverInputs();
    await inputs.getByRole('button', { name: '重试核验输入' }).click();
    await expect(inputs).toContainText('部分输入仍需本机核验');
    await expect(inputs).toContainText('当前输入与任务快照存在变化');
    await inputs.getByText('输入引用与内容核验详情（2 项）').click();
    await expect(inputs).toContainText('代码引用需在本机核验');
    await inputs.getByRole('button', { name: '对照 prd 正文' }).click();
    await expect(inputs.locator('.wm-diff-line[data-kind="remove"]')).toContainText('旧版条款');
    await expect(inputs.locator('.wm-diff-line[data-kind="add"]')).toContainText('新版条款');
    expect(inputReads.filter((id) => id === 'task-1')).toHaveLength(initialReads + 1);
    const relations = current.getByRole('region', { name: '任务依赖关系' });
    await expect(relations).toContainText('designer@example.test');
    await expect(relations).toContainText('qa@example.test');
    await expect(relations).toContainText('已完成');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await relations.getByRole('button', { name: '上游设计交付', exact: true }).click();
    await expect(page).toHaveURL(/taskId=task-before/);
    const before = page.locator('[data-task-id="task-before"]');
    await expect(before).toBeFocused();
    await before
      .getByRole('region', { name: '任务依赖关系' })
      .getByRole('button', { name: '后端交付', exact: true })
      .click();
    await expect(page).toHaveURL(/taskId=task-1/);
    await relations.getByRole('button', { name: '下游质量验收', exact: true }).click();
    await expect(page).toHaveURL(/taskId=task-after/);
    await expect(page.locator('[data-task-id="task-after"]')).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });

  test(`${width}px 评审问题保留来源轮次，写入失败可原内容重试并记录解决与重开`, async ({
    page,
  }) => {
    await installReviewFixtures(page);
    await page.route('**/api/v1/review-requests/review-1', (route) =>
      route.fulfill({
        json: {
          data: {
            id: 'review-1',
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
                id: 'slot-1',
                slotKey: 'owner',
                requiredRoleId: 'role-1',
                requiredUserId: 'fixture-user',
                sourceSlotBindingId: null,
                viewerCanDecide: true,
              },
            ],
            decisions: [],
            subject: {
              documentId: 'doc-1',
              knowledgeBaseId: 'kb-1',
              documentVersion: 2,
              currentPublishedRevisionId: 'rev-1',
              revisionId: 'rev-2',
              revisionDigest: 'b'.repeat(64),
            },
          },
          meta: { requestId: 'journey-review' },
        },
      }),
    );
    await page.route('**/api/v1/documents/doc-1', (route) =>
      route.fulfill({
        json: {
          data: {
            document: {
              id: 'doc-1',
              projectId: 'p1',
              knowledgeBaseId: 'kb-1',
              requirementId: 'req-1',
              kind: 'PRD',
              version: 2,
              currentPublishedRevisionId: 'rev-1',
              archivedAt: null,
            },
            revisions,
            publishedRevision: revisions[0],
          },
          meta: { requestId: 'journey-review-document' },
        },
      }),
    );
    const author = { id: 'fixture-user', email: 'fixture@example.test', kind: 'HUMAN' };
    const currentSource = {
      reviewId: 'review-1',
      artifactSetId: null,
      documentRevisionId: 'rev-2',
      subjectDigest: 'b'.repeat(64),
      createdAt: '2026-11-09T00:00:00.000Z',
    };
    const threads: ReviewDiscussion[] = [
      {
        id: 'discussion-old',
        title: '旧轮次的边界错误',
        body: '请覆盖订单取消后的重复请求。',
        resolved: false,
        version: 1,
        createdAt: '2026-11-08T00:00:00.000Z',
        updatedAt: '2026-11-08T00:00:00.000Z',
        author,
        source: { ...currentSource, reviewId: 'review-before', documentRevisionId: 'rev-1' },
        canReply: true,
        canManage: true,
        entries: [],
        nextEntriesCursor: null,
      },
    ];
    let failList = true;
    let failReply = true;
    const replies: Array<{ body: Record<string, unknown>; key: string | undefined }> = [];
    await page.route('**/api/v1/review-requests/review-1/discussions**', (route) => {
      const request = route.request();
      if (request.method() === 'GET')
        return failList
          ? route.fulfill({
              status: 503,
              json: { error: { code: 'TEMPORARY', message: '问题列表暂不可用' } },
            })
          : route.fulfill({
              json: {
                data: {
                  items: threads,
                  nextCursor: null,
                  unresolvedCount: threads.filter((thread) => !thread.resolved).length,
                  canCreate: true,
                },
                meta: { requestId: 'journey-discussion-list' },
              },
            });
      const body = request.postDataJSON() as Record<string, unknown>;
      if (new URL(request.url()).pathname.endsWith('/entries')) {
        replies.push({ body, key: request.headers()['idempotency-key'] });
        if (failReply) {
          failReply = false;
          return route.fulfill({
            status: 503,
            json: { error: { code: 'TEMPORARY', message: '回应暂未确认' } },
          });
        }
        const thread = threads[0]!;
        thread.version += 1;
        thread.resolved =
          body.kind === 'RESOLVED' ? true : body.kind === 'REOPENED' ? false : thread.resolved;
        thread.entries.push({
          id: `entry-${replies.length}`,
          kind: body.kind as 'REPLY' | 'RESOLVED' | 'REOPENED',
          body: String(body.body),
          createdAt: '2026-11-09T01:00:00.000Z',
          author,
          addressedInReview: body.addressedInReviewId ? currentSource : null,
        });
        return route.fulfill({
          status: 201,
          json: { data: {}, meta: { requestId: 'journey-discussion-entry' } },
        });
      }
      threads.push({
        ...threads[0]!,
        id: 'discussion-current',
        title: String(body.title),
        body: String(body.body),
        source: currentSource,
        entries: [],
        version: 1,
      });
      return route.fulfill({
        status: 201,
        json: { data: {}, meta: { requestId: 'journey-discussion-create' } },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reviews/review-1?projectId=p1');
    const discussions = page.getByRole('region', { name: '结构化评审问题' });
    await expect(discussions.getByRole('alert')).toContainText('问题列表暂不可用');
    await expect(discussions.getByText('没有本轮问题或此前轮次的未解决问题。')).toHaveCount(0);
    failList = false;
    await discussions.getByRole('button', { name: '刷新问题', exact: true }).click();
    const thread = discussions.getByRole('article', { name: '评审问题：旧轮次的边界错误' });
    await expect(thread).toContainText('来自此前评审轮次的未解决问题');
    await expect(thread.getByRole('link', { name: '查看来源评审' })).toHaveAttribute(
      'href',
      '/reviews/review-before',
    );
    await thread
      .getByRole('textbox', { name: '回应 旧轮次的边界错误' })
      .fill('已补充取消后重复请求的测试证据。');
    await thread.getByRole('button', { name: '关联当前交付轮次' }).click();
    await thread.getByRole('button', { name: '提交回应', exact: true }).click();
    await expect(thread.getByRole('alert')).toContainText('可使用相同内容重试');
    await expect(thread.getByRole('textbox', { name: '回应 旧轮次的边界错误' })).toHaveValue(
      '已补充取消后重复请求的测试证据。',
    );
    await thread.getByRole('button', { name: '提交回应', exact: true }).click();
    await expect(thread.locator('ol')).toContainText('已补充取消后重复请求的测试证据。');
    await expect(thread.getByRole('textbox', { name: '回应 旧轮次的边界错误' })).toHaveValue('');
    expect(replies).toHaveLength(2);
    expect(replies[0]!.key).toBeTruthy();
    expect(replies[1]).toEqual(replies[0]);
    expect(replies[1]!.body.addressedInReviewId).toBe('review-1');
    await expect(thread.getByRole('link', { name: '查看回应关联的实际交付轮次' })).toHaveAttribute(
      'href',
      '/reviews/review-1',
    );
    await thread
      .getByRole('textbox', { name: '回应 旧轮次的边界错误' })
      .fill('已对照证据，问题解决。');
    await thread.getByRole('button', { name: '标记问题已解决' }).click();
    await expect(thread.locator('.status-tag')).toHaveText('已解决');
    await thread
      .getByRole('textbox', { name: '回应 旧轮次的边界错误' })
      .fill('新增边界仍需处理，重新打开。');
    await thread.getByRole('button', { name: '重新打开问题' }).click();
    await expect(thread.locator('.status-tag')).toHaveText('未解决');
    await discussions.getByRole('textbox', { name: '评审问题标题' }).fill('本轮新发现');
    await discussions
      .getByRole('textbox', { name: '评审问题内容' })
      .fill('请补充本轮超时重试的验收依据。');
    await discussions.getByRole('button', { name: '提出评审问题' }).click();
    await expect(discussions.getByRole('article', { name: '评审问题：本轮新发现' })).toContainText(
      '本轮问题',
    );
    await expect(discussions).toContainText('人工批准仍需在审批槽位单独提交');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });
}
