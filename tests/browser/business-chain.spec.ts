import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type APIResponse } from '@playwright/test';
import { prepareFirstRunWorkflow } from '../../scripts/lib/first-run-workflow.mjs';

type Task = {
  id: string;
  stepKey: string;
  version: number;
  executionStatus: string;
  currentClaim: { id: string } | null;
};
type Review = {
  id: string;
  status: string;
  decisions: Array<{
    id: string;
    decision: string;
    comment: string | null;
    actor: { email: string } | null;
  }>;
};

async function dataOf<T>(response: APIResponse, operation: string): Promise<T> {
  const payload = await response.json();
  expect(
    response.ok(),
    operation + ': HTTP ' + response.status() + ' ' + JSON.stringify(payload),
  ).toBe(true);
  return payload.data as T;
}

/**
 * No mock requests or direct database inserts. The browser registers the human,
 * reads delivered evidence and approves through real password-confirmed tickets.
 * Setup, device authorization and Agent claim/snapshot/delivery use the real API.
 * Published baseline setup uses the API. QA acceptance is exercised in the UI;
 * implementation stays unfinished and release must remain blocked.
 * The runner owns a disposable database; retain its audit graph until teardown.
 */
test('real Agent QA delivery is approved in the browser while release stays blocked after reload', async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  test.setTimeout(90_000);
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const email = 'chain-' + randomUUID() + '@acceptance.test';
  const password = 'Chain-' + randomUUID() + '!';
  const title = 'Browser task acceptance ' + randomUUID();
  const projectKey = Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join(
    '',
  );
  const summary = 'Browser delivery evidence ' + randomUUID();
  const comment = 'Browser approval after reading the delivered acceptance cases.';
  const errors: string[] = [];
  const apiFailures: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400)
      apiFailures.push(response.status() + ' ' + response.url());
  });

  await test.step('register the human in the browser', async () => {
    await page.goto('/register');
    await page.getByLabel('姓名（可选）', { exact: true }).fill('Business chain acceptance');
    await page.getByLabel('邮箱', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByLabel('确认密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await expect(page.getByRole('button', { name: '账号菜单：' + email })).toBeVisible();
  });

  const session = await dataOf<{ csrfToken: string; user: { id: string } }>(
    await page.request.get(origin + '/api/v1/auth/session'),
    'read session',
  );
  async function human<T>(method: string, path: string, body?: unknown): Promise<T> {
    return dataOf<T>(
      await page.request.fetch(origin + '/api/v1' + path, {
        method,
        data: body,
        headers: {
          Origin: origin,
          'X-CSRF-Token': session.csrfToken,
          ...(method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() }),
        },
      }),
      method + ' ' + path,
    );
  }
  const project = await human<{ id: string; key: string; version: number }>('POST', '/projects', {
    name: 'Browser business chain',
    key: projectKey,
  });
  const roles = await human<Array<{ id: string; key: string; isActive: boolean }>>(
    'GET',
    '/projects/' + project.id + '/roles',
  );
  const roleId = (key: string) => {
    const role = roles.find((item) => item.key === key && item.isActive);
    expect(role, 'seeded ' + key + ' role').toBeTruthy();
    return role!.id;
  };
  const { requirement, published, understanding, prd } = await prepareFirstRunWorkflow({
    call: human,
    project,
    password,
    title,
    workflowKey: 'browser-acceptance',
    roleId,
    userId: session.user.id,
  });
  const ready = await human<{ items: Task[] }>(
    'GET',
    '/projects/' + project.id + '/tasks/ready?limit=10',
  );
  expect(ready.items.map((task) => task.stepKey).sort()).toEqual(['cases', 'impl']);
  const task = ready.items.find((item) => item.stepKey === 'cases')!;
  const detailPath =
    '/requirements/' + requirement.code + '?projectId=' + project.id + '&taskId=' + task.id;
  await page.goto(detailPath);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('[data-task-id]').filter({ hasText: '后续发布任务' })).toHaveAttribute(
    'data-task-state',
    'WAITING_PREDECESSOR',
  );

  const verifier = randomBytes(32).toString('base64url');
  const credentialSecret = randomBytes(32).toString('base64url');
  const device = await human<{ authorizationId: string; deviceCode: string; userCode: string }>(
    'POST',
    '/auth/cli-authorizations',
    {
      clientName: 'Browser business chain Agent',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      credentialSecretHash: createHash('sha256').update(credentialSecret).digest('hex'),
    },
  );
  const viewed = await human<{ version: number }>('POST', '/auth/cli-authorizations/lookup', {
    userCode: device.userCode,
  });
  await human('POST', '/auth/cli-authorizations/' + device.authorizationId + '/approve', {
    expectedVersion: viewed.version,
    projectId: project.id,
    roleId: roleId('qa'),
    scopes: [
      'project:read',
      'requirement:read',
      'knowledge:read',
      'task:read',
      'task:claim',
      'task:deliver',
      'context:create',
    ],
    expiresInDays: 1,
  });
  const issued = await human<{ status: string; credential: { credentialId: string } }>(
    'POST',
    '/auth/cli-authorizations/poll',
    {
      authorizationId: device.authorizationId,
      deviceCode: device.deviceCode,
      codeVerifier: verifier,
    },
  );
  expect(issued.status).toBe('ISSUED');
  const agent = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Authorization: 'Bearer wm_a1.' + issued.credential.credentialId + '.' + credentialSecret,
    },
  });
  try {
    const agentCall = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
      const response = await agent.fetch('/api/v1' + path, {
        method,
        data: body,
        headers: method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() },
      });
      return dataOf<T>(response, 'Agent ' + method + ' ' + path);
    };
    const claim = await agentCall<{ claimId: string; task: Task }>(
      'POST',
      '/tasks/' + task.id + '/claims',
      {},
    );
    const snapshot = await agentCall<{
      snapshot: {
        id: string;
        manifest: {
          productBaseline: { prdRevisionId: string; understandingRevisionId: string } | null;
        };
      };
      taskVersion: number;
    }>('POST', '/tasks/' + task.id + '/context-snapshots', {
      expectedVersion: claim.task.version,
      claimId: claim.claimId,
    });
    expect(snapshot.snapshot.manifest.productBaseline).toMatchObject({
      prdRevisionId: prd.revisionId,
      understandingRevisionId: understanding.revisionId,
    });
    const current = await agentCall<Task>('GET', '/tasks/' + task.id);
    const bytes = Buffer.from(
      '# Browser acceptance cases\n\nRead evidence and sign off.\n',
      'utf8',
    );
    const delivered = await agentCall<{ reviewRequestId: string }>(
      'POST',
      '/tasks/' + task.id + '/artifact-sets',
      {
        expectedVersion: current.version,
        claimId: claim.claimId,
        snapshotId: snapshot.snapshot.id,
        workflowDefinitionRevisionId: published.definitionRevisionId,
        localRunId: 'browser-' + randomUUID(),
        candidateRevisionIds: [],
        items: [
          {
            kind: 'CASES',
            schemaVersion: '1.0',
            storage: 'HOSTED',
            mediaType: 'text/markdown',
            sha256: createHash('sha256').update(bytes).digest('hex'),
            byteLength: bytes.byteLength,
            bodyBase64: bytes.toString('base64'),
            summary,
            checks: [{ code: 'browser-acceptance-cases', passed: true }],
          },
        ],
      },
    );
    await test.step('allow the production IP request budget to reset before UI approval', async () => {
      // Unmount the app so its normal background reads do not consume the
      // next budget while the real published-baseline setup cools down.
      await page.goto('about:blank');
      await page.waitForTimeout(60_000);
    });
    await test.step('read delivered evidence from requirement details and open its review', async () => {
      await page.goto(detailPath);
      const row = page.locator('[data-task-id="' + task.id + '"]');
      await expect(row).toHaveAttribute('data-task-state', 'WAITING_APPROVAL');
      await expect(row).toContainText('工件 1 件');
      await page.getByRole('tab', { name: /^交付物/ }).click();
      await expect(page.getByText(summary, { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: /^任务/ }).click();
      await row.getByRole('button', { name: '去签字', exact: true }).click();
      await expect(page).toHaveURL(new RegExp('/reviews/' + delivered.reviewRequestId + '$'));
      await expect(page.getByText(summary, { exact: true })).toBeVisible();
      await expect(page.locator('.artifact-preview')).toContainText('Read evidence and sign off.');
    });
    await test.step('approve through browser password confirmation and retain the decision after reload', async () => {
      await page.getByRole('button', { name: '作出决定', exact: true }).click();
      await page.getByLabel('评审决定', { exact: true }).selectOption('APPROVE');
      await page.getByLabel('评审说明', { exact: true }).fill(comment);
      const nextStep = page.getByRole('button', { name: '下一步：预览并验证' });
      try {
        await expect(nextStep).toBeEnabled();
      } catch {
        const contextDetails = await page.locator('.wm-error-state__detail').allTextContents();
        throw new Error(
          'Review approval is blocked: ' + JSON.stringify({ contextDetails, apiFailures }),
        );
      }
      await nextStep.click();
      const dialog = page.getByRole('dialog', { name: '确认评审决定' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(title);
      await expect(dialog).toContainText(comment);
      await dialog.getByLabel('确认密码', { exact: true }).fill(password);
      const ticketIssued = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/v1/auth/confirmation-tickets') &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '验证密码并签发票据', exact: true }).click();
      const ticketResponse = await ticketIssued;
      expect(ticketResponse.status(), await ticketResponse.text()).toBe(201);
      const decided = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith('/api/v1/review-requests/' + delivered.reviewRequestId + '/decisions') &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: '提交决定', exact: true }).click();
      const response = await decided;
      expect(response.status(), await response.text()).toBe(201);
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText('该评审已结束，只读。', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('row').filter({ hasText: comment })).toContainText(email);
      await expect(page.getByText('该评审已结束，只读。', { exact: true })).toBeVisible();
    });
    const persisted = await human<Review>('GET', '/review-requests/' + delivered.reviewRequestId);
    expect(persisted.status).toBe('APPROVED');
    expect(persisted.decisions).toHaveLength(1);
    expect(persisted.decisions[0]).toMatchObject({
      decision: 'APPROVE',
      comment,
      actor: { email },
    });
    const completed = await human<Task>('GET', '/tasks/' + task.id);
    expect(completed.executionStatus).toBe('DONE');
    expect(completed.currentClaim).toBeNull();
    const next = await human<{ items: Task[] }>(
      'GET',
      '/projects/' + project.id + '/tasks/ready?limit=10',
    );
    expect(next.items.map((item) => item.stepKey)).toEqual(['impl']);
    await page.goto(detailPath);
    await expect(page.locator('[data-task-id="' + task.id + '"]')).toHaveAttribute(
      'data-task-state',
      'DONE',
    );
    await expect(
      page.locator('[data-task-id]').filter({ hasText: '后续发布任务' }),
    ).toHaveAttribute('data-task-state', 'WAITING_PREDECESSOR');
    await expect(page.locator('[data-task-id="' + task.id + '"]')).toContainText(email);
    expect(errors).toEqual([]);
    const resultPath = testInfo.outputPath('business-chain-result.json');
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          projectId: project.id,
          requirementId: requirement.id,
          taskId: task.id,
          reviewId: persisted.id,
          decisionId: persisted.decisions[0].id,
          reviewStatus: persisted.status,
          taskStatus: completed.executionStatus,
          nextReadySteps: next.items.map((item) => item.stepKey),
          coverage:
            'Real API setup and Agent delivery; browser evidence, password confirmation and task approval.',
          baseline: {
            prdRevisionId: prd.revisionId,
            understandingRevisionId: understanding.revisionId,
          },
          releaseState: 'WAITING_PREDECESSOR',
          notCovered: [
            'knowledge publication in browser',
            'implementation completion',
            'release sign-off',
            'change propagation',
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    await testInfo.attach('business-chain-result', {
      contentType: 'application/json',
      path: resultPath,
    });
  } finally {
    await agent.dispose();
  }
});
