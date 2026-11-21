import { expect, test } from '@playwright/test';
import type { CodeEvidenceDiagnostics, QualityBundleV11 } from '@workmesh/shared';
import type { VerificationEvidencePage } from '../../apps/web/src/api/resources';
import { installReviewFixtures, requirement, revisions, task } from './fixtures';

const commit = 'a'.repeat(40);
const basis = {
  prdRevisionId: 'rev-1',
  snapshotId: 'snapshot-1',
  projectRepositoryId: 'repo-1',
  commitSha: commit,
};
const revision = { artifactId: 'cases-1', sha256: 'e'.repeat(64) };
const acceptance = [
  { key: 'ac-pass', text: '有效账号可进入工作台', verification: 'TEST' as const },
  { key: 'ac-fail', text: '重复请求不会重复提交', verification: 'TEST' as const },
  { key: 'ac-missing', text: '超时后保留用户输入', verification: 'TEST' as const },
];
const quality: QualityBundleV11 = {
  schemaVersion: '1.1',
  stage: 'DELIVERY',
  requirementId: 'req-1',
  basis,
  acceptance,
  tasks: acceptance.map((item) => ({
    id: `task-${item.key}`,
    acceptanceKeys: [item.key],
    dependsOn: [],
    files: ['src/workbench.ts'],
  })),
  cases: acceptance.map((item) => ({
    id: `case-${item.key}`,
    covers: [item.key],
    kind: 'TEST',
    revision,
  })),
  evidence: acceptance.slice(0, 2).map((item, index) => ({
    id: `ev-${item.key}`,
    acceptanceKeys: [item.key],
    result: index ? 'FAILED' : 'PASSED',
    source: 'AGENT_REPORTED',
    ref: `reports/${item.key}.json`,
    basis,
    caseRefs: [{ caseId: `case-${item.key}`, revision }],
  })),
};
const diagnostics: CodeEvidenceDiagnostics = {
  checkedAt: '2026-11-12T00:00:00.000Z',
  complete: true,
  currentBinding: 'CURRENT',
  taskGeneration: 2,
  currentTaskGeneration: 2,
  signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
  references: [
    {
      artifactId: 'quality-1',
      projectRepositoryId: 'repo-1',
      commitSha: commit,
      repository: {
        owner: 'fixture',
        name: 'isolated',
        externalId: '42',
        identityMode: 'PROVIDER',
        adapter: 'GITHUB',
        archived: false,
      },
      status: 'SHA_MISMATCH',
      deliveries: [],
      reviews: [
        {
          id: 'code-review-1',
          changeRequestId: '10',
          headSha: 'f'.repeat(40),
          commitSha: 'f'.repeat(40),
          reviewerExternalId: 'reviewer',
          authorExternalId: 'author',
          reviewerKind: 'USER',
          state: 'APPROVED',
          submittedAt: null,
          reasons: ['SHA_MISMATCH'],
        },
      ],
      tickets: [],
    },
  ],
};

const verificationPage: VerificationEvidencePage = {
  checkedAt: '2026-11-12T02:00:00.000Z',
  nextCursor: 'fixture-next',
  items: [
    {
      binding: {
        id: 'binding-1',
        evidenceId: 'verification-1',
        artifactSetId: 'set-evidence',
        createdAt: '2026-11-12T01:30:00.000Z',
        diagnostics: {
          authority: 'ADVISORY',
          origin: { status: 'MATCHED', reasons: [] },
          reportAssociation: { status: 'UNKNOWN', reasons: [] },
          currentness: { status: 'MATCHED', reasons: ['绑定时版本匹配'] },
          definitionIndependence: { status: 'UNKNOWN', reasons: [] },
          outcome: 'REPORTED_PASS',
          reasons: [],
        },
      },
      evidence: {
        id: 'verification-1',
        projectId: 'p1',
        projectRepositoryId: 'repo-1',
        collectedAt: '2026-11-12T01:00:00.000Z',
        payloadDigest: 'd'.repeat(64),
        collection: {
          schemaVersion: '1.0',
          provider: 'GITHUB_ACTIONS',
          origin: 'PROVIDER_OBSERVED',
          collectedAt: '2026-11-12T01:00:00.000Z',
          repositoryId: '42',
          runId: '123',
          attempt: 2,
          event: 'push',
          headSha: commit,
          status: 'completed',
          conclusion: 'success',
          workflowId: '10',
          workflowPath: '.github/workflows/check.yml',
          htmlUrl: 'https://github.com/fixture/isolated/actions/runs/123',
          createdAt: '2026-11-12T00:00:00.000Z',
          updatedAt: '2026-11-12T00:30:00.000Z',
          latestAttempt: 2,
          identityStable: true,
          completeness: 'INCOMPLETE',
          jobs: [
            {
              id: '456',
              runId: '123',
              attempt: 2,
              name: 'unit-tests',
              headSha: commit,
              status: 'completed',
              conclusion: 'success',
              startedAt: null,
              completedAt: null,
              steps: [],
            },
          ],
          reports: [
            {
              artifactId: '789',
              name: 'results.json',
              expired: false,
              archiveSha256: 'b'.repeat(64),
              reportSha256: 'c'.repeat(64),
              reportByteLength: 1000,
              association: 'RUN_ONLY',
              issues: ['报告未证明 attempt 与 job 关联'],
              report: {
                kind: 'WORKMESH_CI_RESULTS',
                schemaVersion: '1.0',
                run: {
                  provider: 'GITHUB_ACTIONS',
                  repositoryId: '42',
                  runId: '123',
                  runAttempt: 2,
                  jobKey: 'unit',
                  event: 'push',
                  headSha: commit,
                  testedCommitSha: commit,
                },
                basis,
                environment: {
                  summary: '隔离浏览器夹具',
                  startedAt: '2026-11-12T00:00:00.000Z',
                  completedAt: '2026-11-12T00:30:00.000Z',
                },
                results: [
                  {
                    id: 'reported-result-1',
                    caseRef: { caseId: 'case-ac-fail', revision },
                    result: 'FAILED',
                  },
                ],
              },
            },
          ],
          issues: ['部分报告关联仍待确认'],
        },
      },
      diagnostics: {
        authority: 'ADVISORY',
        origin: { status: 'MATCHED', reasons: ['提供方身份匹配'] },
        reportAssociation: { status: 'UNKNOWN', reasons: ['仅 run 关联，无法确认 attempt 与 job'] },
        currentness: { status: 'MISMATCH', reasons: ['读取时基线已有变化'] },
        definitionIndependence: { status: 'UNKNOWN', reasons: ['验证定义缺少批准依据'] },
        outcome: 'FAILED',
        reasons: ['本地报告有失败用例'],
      },
    },
  ],
};

for (const width of [1440, 390]) {
  test(`${width}px 评审概览区分报告、未执行和正式签字，恢复入口只读且支持键盘`, async ({
    page,
  }) => {
    await installReviewFixtures(page);
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/') && !['GET', 'HEAD'].includes(request.method()))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    const reply = (data: unknown) => ({
      json: { data, meta: { requestId: 'verification-evidence-fixture' } },
    });
    let releaseContent!: () => void;
    const contentReady = new Promise<void>((resolve) => {
      releaseContent = resolve;
    });
    let contentReads = 0;
    let failDiscussions = false;
    let failVerification = false;
    const text = JSON.stringify(quality);
    const artifact = {
      id: 'quality-1',
      kind: 'CASES',
      schemaVersion: '1.0',
      storage: 'HOSTED',
      mediaType: 'application/json',
      byteLength: Buffer.byteLength(text),
      sha256: 'b'.repeat(64),
      projectRepositoryId: 'repo-1',
      commitSha: commit,
      repoPath: 'quality.json',
      summary: '隔离质量报告',
      checks: [],
      contentPreview: { text: '{"evidence":[', truncated: true },
    };
    await page.route('**/api/v1/review-requests/review-evidence', (route) =>
      route.fulfill(
        reply({
          id: 'review-evidence',
          projectId: 'p1',
          kind: 'TASK_ACCEPTANCE',
          status: 'OPEN',
          version: 2,
          subjectDigest: 'd'.repeat(64),
          documentRevisionId: null,
          subject: null,
          artifactSetId: 'set-evidence',
          taskId: 'task-1',
          requirement: { id: requirement.id, code: requirement.code, title: requirement.title },
          decisions: [],
          slots: [
            {
              id: 'slot-1',
              slotKey: 'qa',
              requiredRoleId: 'role-1',
              requiredUserId: 'fixture-user',
              viewerCanDecide: true,
            },
          ],
        }),
      ),
    );
    await page.route('**/api/v1/tasks/task-1', (route) =>
      route.fulfill(
        reply({
          id: task.id,
          projectId: 'p1',
          workflowInstanceId: 'inst-1',
          stepKey: task.stepKey,
          stepDisplayName: task.stepDisplayName,
          roleId: 'role-1',
          responsibleUserId: 'fixture-user',
          version: 2,
          generation: 2,
          executionStatus: 'REVIEW_PENDING',
          workStatus: 'ACTIVE',
          currentClaim: null,
        }),
      ),
    );
    await page.route('**/api/v1/artifact-sets/set-evidence', (route) =>
      route.fulfill(
        reply({
          id: 'set-evidence',
          taskId: task.id,
          taskGeneration: 2,
          snapshotId: 'snapshot-1',
          manifestDigest: 'c'.repeat(64),
          workflowDefinitionRevisionId: 'wf-rev-1',
          localRunId: 'run-1',
          candidateRevisionIds: [],
          createdAt: '2026-11-12T00:00:00.000Z',
          artifacts: [artifact],
          codeReview: { required: true, acceptable: false, evidence: [], diagnostics },
        }),
      ),
    );
    await page.route(
      '**/api/v1/artifact-sets/set-evidence/artifacts/quality-1/content',
      async (route) => {
        contentReads += 1;
        await contentReady;
        return route.fulfill(
          reply({
            artifactId: artifact.id,
            mediaType: artifact.mediaType,
            storage: 'HOSTED',
            byteLength: artifact.byteLength,
            sha256: artifact.sha256,
            text,
            bodyBase64: '',
          }),
        );
      },
    );
    await page.route('**/api/v1/documents/doc-1/revisions/rev-1/metadata', (route) =>
      route.fulfill(reply({ ...revisions[0], acceptance })),
    );
    await page.route('**/api/v1/review-requests/review-evidence/discussions', (route) =>
      failDiscussions
        ? route.fulfill({
            status: 503,
            json: { error: { code: 'UNAVAILABLE', message: '隔离夹具中的刷新失败' } },
          })
        : route.fulfill(
            reply({ items: [], nextCursor: null, unresolvedCount: 3, canCreate: false }),
          ),
    );
    await page.route(
      '**/api/v1/projects/p1/artifact-sets/set-evidence/verification-evidence*',
      (route) => {
        if (failVerification)
          return route.fulfill({
            status: 503,
            json: { error: { code: 'UNAVAILABLE', message: '隔离验证证据刷新失败' } },
          });
        return route.fulfill(
          reply(
            new URL(route.request().url()).searchParams.has('cursor')
              ? { ...verificationPage, items: [], nextCursor: null }
              : verificationPage,
          ),
        );
      },
    );
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/reviews/review-evidence?projectId=p1');
    const overview = page.getByRole('status', { name: '评审依据概览', exact: true });
    await expect(overview).toContainText('正在读取完整质量包');
    await expect(overview).not.toContainText('1 项缺少关联证据');
    releaseContent();
    await expect(overview).toContainText('1 项报告通过，待人工核验');
    await expect(overview).toContainText('1 项有失败报告');
    await expect(overview).toContainText('1 项缺少关联证据');
    await expect(overview).toContainText('3 个未解决问题');
    await expect(overview).toContainText('等待 HUMAN');
    await expect(overview).toContainText('字段匹配不代表执行已验证');
    // Vite development renders under StrictMode; the summary itself adds no separate reader.
    expect(contentReads).toBeGreaterThan(0);
    expect(contentReads).toBeLessThanOrEqual(2);
    const initialContentReads = contentReads;
    const matrix = page.getByRole('region', { name: '验收条件与证据映射' });
    const cases = matrix.getByText('查看精确用例修订与执行覆盖', { exact: true }).last();
    await cases.focus();
    await page.keyboard.press('Enter');
    await expect(cases.locator('..')).toHaveAttribute('open', '');
    await expect(cases.locator('..')).toContainText('缺少执行关联');
    const compare = page.getByText('查看提交与代次对照', { exact: true });
    await compare.focus();
    await page.keyboard.press('Enter');
    await expect(compare.locator('..')).toContainText(`head 记录值：${'f'.repeat(40)}`);
    await expect(page.getByText(/关联评审 head 是记录值，不代表当前远端 PR head/)).toBeVisible();
    await expect(
      page.locator('#review-code-evidence').getByRole('link', { name: '定位当前任务与交付' }),
    ).toHaveAttribute('href', '/requirements/DEMO-001?tab=tasks&taskId=task-1');
    await matrix.getByRole('button', { name: '重新读取验收映射' }).click();
    await expect(matrix.getByRole('button', { name: '重新读取验收映射' })).toBeEnabled();
    expect(contentReads).toBe(initialContentReads + 1);
    const verification = page.getByRole('region', { name: '提供方运行与验证证据' });
    await expect(verification).toContainText('原始结论：success');
    await expect(verification).toContainText('读取时基线已有变化');
    await expect(verification).toContainText('验证定义缺少批准依据');
    await expect(verification).toContainText('当前列表不完整');
    const reportDetails = verification.getByText('查看结果报告与精确用例修订', { exact: true });
    await reportDetails.focus();
    await page.keyboard.press('Enter');
    await expect(reportDetails.locator('..')).toContainText('报告内容为 LOCAL_REPORTED');
    await expect(reportDetails.locator('..')).toContainText('case-ac-fail · 报告失败');
    await expect(reportDetails.locator('..')).toContainText('仅关联 run，未证明所属 attempt / job');
    const oldBinding = verification.getByText('查看绑定时记录与历史诊断', { exact: true });
    await oldBinding.focus();
    await page.keyboard.press('Enter');
    await expect(oldBinding.locator('..')).toContainText('绑定时报告结果：报告通过，待人工核验');
    await expect(oldBinding.locator('..')).toContainText('不会撤销原 HUMAN 决定');
    await verification.getByRole('button', { name: '加载更多验证证据' }).click();
    await expect(verification.getByRole('button', { name: '加载更多验证证据' })).toHaveCount(0);
    failVerification = true;
    await verification.getByRole('button', { name: '刷新验证证据' }).click();
    await expect(verification.getByRole('alert')).toContainText('不能作为当前适用性结论');
    await expect(verification).toContainText('上次读取时的适用性诊断');
    failDiscussions = true;
    await page
      .getByRole('region', { name: '结构化评审问题' })
      .getByRole('button', { name: '刷新问题', exact: true })
      .click();
    await expect(overview).toContainText('问题刷新失败；上次读取有 3 个未解决问题');
    await page.getByRole('button', { name: '作出决定', exact: true }).click();
    await expect(page.getByRole('button', { name: '下一步：预览并验证' })).toBeDisabled();
    await page.getByRole('combobox', { name: '评审决定' }).selectOption('CHANGES_REQUESTED');
    await page
      .getByRole('textbox', { name: '评审说明' })
      .fill('请补齐失败场景与精确用例执行证据。');
    await expect(page.getByRole('button', { name: '下一步：预览并验证' })).toBeEnabled();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
