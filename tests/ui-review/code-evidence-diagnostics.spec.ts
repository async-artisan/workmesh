import { expect, test } from '@playwright/test';
import { installReviewFixtures, requirement, task } from './fixtures';

for (const width of [1440, 390]) {
  test(`${width}px 代码证据状态按需读取并解释精确阻塞环节`, async ({ page }) => {
    await installReviewFixtures(page);
    const writes: string[] = [];
    let reads = 0;
    page.on('request', (request) => {
      if (request.url().includes('/api/') && !['GET', 'HEAD'].includes(request.method()))
        writes.push(request.method());
    });
    await page.route('**/api/v1/projects/p1/requirements/req-1', (route) =>
      route.fulfill({
        json: {
          data: {
            requirement,
            acceptanceKeys: [],
            tasks: [task],
            reviews: [],
            changes: [],
            counts: { tasks: 1, artifacts: 1, reviews: 0, changes: 0 },
            artifacts: [
              {
                id: 'code-artifact',
                artifactSetId: 'code-set',
                taskId: 'task-1',
                taskGeneration: 1,
                kind: 'IMPL',
                storage: 'GIT_REF',
                commitSha: 'a'.repeat(40),
                repoPath: 'src/index.ts',
                schemaVersion: '1.0',
                mediaType: 'text/plain',
                byteLength: 0,
                sha256: 'b'.repeat(64),
                checks: [],
                createdAt: '2026-11-10T00:00:00Z',
              },
            ],
          },
          meta: { requestId: 'code-detail' },
        },
      }),
    );
    await page.route('**/api/v1/artifact-sets/code-set', (route) => {
      reads += 1;
      return route.fulfill({
        json: {
          data: {
            id: 'code-set',
            codeReview: {
              required: true,
              acceptable: false,
              diagnostics: {
                checkedAt: '2026-11-10T00:00:00Z',
                complete: true,
                currentBinding: 'CURRENT',
                taskGeneration: 1,
                currentTaskGeneration: 1,
                signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
                references: [
                  {
                    artifactId: 'code-artifact',
                    projectRepositoryId: 'repo',
                    commitSha: 'a'.repeat(40),
                    repository: {
                      owner: 'team-with-a-long-name',
                      name: 'source',
                      externalId: '42',
                      identityMode: 'PROVIDER',
                      adapter: 'GITHUB',
                      archived: false,
                    },
                    status: 'SHA_MISMATCH',
                    deliveries: [
                      {
                        id: 'trusted-receipt-long-identifier',
                        signatureValid: true,
                        eventType: 'pull_request',
                        status: 'PROCESSED',
                        receivedAt: '2026-11-10T00:00:00Z',
                        processedAt: null,
                      },
                    ],
                    reviews: [
                      {
                        id: 'review',
                        changeRequestId: '10',
                        headSha: 'f'.repeat(40),
                        commitSha: 'f'.repeat(40),
                        authorExternalId: 'author',
                        reviewerExternalId: 'reviewer',
                        reviewerKind: 'USER',
                        state: 'APPROVED',
                        submittedAt: null,
                        reasons: ['SHA_MISMATCH'],
                      },
                    ],
                    tickets: [],
                  },
                ],
              },
            },
          },
          meta: { requestId: 'code-read' },
        },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/requirements/req-1?projectId=p1&tab=artifacts');
    const button = page.getByRole('button', { name: '代码证据状态' });
    await expect(button).toBeVisible();
    expect(reads).toBe(0);
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByText('仓库已有评审，提交 SHA 与当前工件不匹配')).toBeVisible();
    await expect(page.getByText(/核对交付的完整 commit SHA/)).toBeVisible();
    await expect(page.getByText(/签名失败在创建收据前拒绝/)).toBeVisible();
    await expect(page.getByText(/可信投递.*签名有效.*PROCESSED/)).toBeVisible();
    expect(reads).toBe(1);
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `.tmp/ui-review-results/code-evidence-${width}.png`,
      fullPage: true,
    });
  });
}
