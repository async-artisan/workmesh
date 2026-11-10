import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test';
import { prepareFirstRunWorkflow } from '../../scripts/lib/first-run-workflow.mjs';

type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;
type Task = {
  id: string;
  stepKey: string;
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  currentClaim: { id: string } | null;
};
type Snapshot = {
  id: string;
  taskGeneration: number;
  requirementGeneration: number;
  manifestDigest: string;
  resources: Array<{ refId: string }>;
  manifest: {
    productBaseline: { prdRevisionId: string; understandingRevisionId: string } | null;
  };
};
type Review = {
  id: string;
  version: number;
  status: string;
  subjectDigest: string;
  slots: Array<{
    id: string;
    decided: boolean;
    viewerCanDecide: boolean;
    requiredRoleId: string | null;
  }>;
  decisions: Array<{ id: string; decision: string; comment: string | null }>;
};
type Recipient = {
  id: string;
  eventId: string;
  userId: string;
  roleId: string | null;
  version: number;
  ackedAt: string | null;
};
type Detail = {
  requirement: { id: string; version: number; generation: number };
  tasks: Array<Task & { currentClaimId: string | null; currentArtifactSetId: string | null }>;
  artifacts: Array<{ id: string; taskId: string; sha256: string }>;
  changes: Array<{
    id: string;
    sourceKind: string;
    sourceId: string;
    changedFields: string[];
    targets: {
      taskIds: string[];
      documentId: string;
      previousDocumentRevisionId: string;
      documentRevisionId: string;
      requirementGeneration: number;
    };
    recipients: Recipient[];
  }>;
};
type Delivery = {
  artifactSet: { id: string; snapshotId: string; artifacts: Array<{ id: string; sha256: string }> };
  reviewRequestId: string;
};
type DecisionResult = { published: boolean; publicationId: string | null };

// Resource rows have no API ordering contract; compare their full contents by stable refId.
function normalizedSnapshot(snapshot: Snapshot) {
  return {
    ...snapshot,
    resources: [...snapshot.resources].sort((left, right) => left.refId.localeCompare(right.refId)),
  };
}

async function expectTaskState(row: Locator, state: string, apiFailures: string[]) {
  try {
    await expect(row).toHaveAttribute('data-task-state', state);
  } catch (error) {
    throw new Error(
      'Task state assertion failed; browser HTTP failures: ' + JSON.stringify(apiFailures),
      {
        cause: error,
      },
    );
  }
}

async function dataOf<T>(response: APIResponse, operation: string): Promise<T> {
  const payload = await response.json();
  expect(
    response.ok(),
    operation + ': HTTP ' + response.status() + ' ' + JSON.stringify(payload),
  ).toBe(true);
  return payload.data as T;
}

async function approveSetup(call: Call, projectId: string, reviewId: string, password: string) {
  const review = await call<Review>('GET', '/review-requests/' + reviewId);
  const slot = review.slots.find((item) => !item.decided && item.viewerCanDecide);
  expect(slot, 'initial QA has a real human approval slot').toBeTruthy();
  const binding = {
    action: 'REVIEW_DECIDE',
    projectId,
    targetType: 'REVIEW_REQUEST',
    targetId: review.id,
    expectedVersion: review.version,
    roleSlot: slot!.requiredRoleId
      ? { roleId: slot!.requiredRoleId, approvalSlotId: slot!.id }
      : null,
    payload: {
      slotId: slot!.id,
      decision: 'APPROVE',
      subjectDigest: review.subjectDigest,
      comment: 'Initial QA acceptance before the baseline change.',
    },
  };
  const preview = await call<{ actionDigest: string }>('POST', '/auth/action-previews', binding);
  const ticket = await call<{ ticketId: string; ticketSecret: string }>(
    'POST',
    '/auth/confirmation-tickets',
    { ...binding, actionDigest: preview.actionDigest, password },
  );
  await call('POST', '/review-requests/' + review.id + '/decisions', {
    slotId: slot!.id,
    decision: 'APPROVE',
    comment: binding.payload.comment,
    expectedVersion: review.version,
    confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
  });
}

async function approveInBrowser(
  page: Page,
  reviewId: string,
  password: string,
  comment: string,
): Promise<DecisionResult> {
  await page.getByRole('button', { name: '作出决定', exact: true }).click();
  await page.getByLabel('评审决定', { exact: true }).selectOption('APPROVE');
  await page.getByLabel('评审说明', { exact: true }).fill(comment);
  const next = page.getByRole('button', { name: '下一步：预览并验证' });
  await expect(next).toBeEnabled();
  await next.click();
  const dialog = page.getByRole('dialog', { name: '确认评审决定' });
  await expect(dialog).toContainText(comment);
  await dialog.getByLabel('确认密码', { exact: true }).fill(password);
  const ticketIssued = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/confirmation-tickets') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '验证密码并签发票据', exact: true }).click();
  const ticket = await ticketIssued;
  expect(ticket.status(), await ticket.text()).toBe(201);
  const decided = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/review-requests/' + reviewId + '/decisions') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '提交决定', exact: true }).click();
  const response = await decided;
  expect(response.status(), await response.text()).toBe(201);
  const result = (await response.json()).data as DecisionResult;
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('该评审已结束，只读。', { exact: true })).toBeVisible();
  return result;
}

/**
 * G4: real published baseline -> accepted QA -> changed PRD -> new QA acceptance.
 * Setup uses only public APIs; publication, role-specific change ACKs and the new
 * QA decision use the real browser. Historical decisions/artifact bytes survive.
 * IMPL is only claimed/snapshotted, never delivered using fabricated code evidence.
 */
test('publishing a changed PRD invalidates current QA evidence and requires new baseline acceptance', async ({
  page,
  playwright,
  baseURL,
}, testInfo) => {
  // Three bounded production limiter windows; limits and retries stay unchanged.
  test.setTimeout(240_000);
  await test.step('start with a fresh production IP request window after previous browser tests', async () => {
    // The new page is about:blank, so no app polling runs during this bounded cooldown.
    await page.waitForTimeout(60_000);
  });
  expect(baseURL).toBeTruthy();
  const origin = new URL(baseURL!).origin;
  const email = 'baseline-' + randomUUID() + '@acceptance.test';
  const password = 'Baseline-' + randomUUID() + '!';
  const title = 'Baseline change acceptance ' + randomUUID();
  const projectKey = Array.from({ length: 6 }, () => String.fromCharCode(65 + randomInt(26))).join(
    '',
  );
  const pageErrors: string[] = [];
  const apiFailures: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/') && response.status() >= 400) {
      const headers = response.headers();
      apiFailures.push(
        JSON.stringify({
          method: response.request().method(),
          path: new URL(response.url()).pathname,
          status: response.status(),
          remaining: headers['x-ratelimit-remaining'] ?? null,
          retryAfter: headers['retry-after'] ?? null,
        }),
      );
    }
  });
  await page.goto('/register');
  await page.getByLabel('姓名（可选）', { exact: true }).fill('Baseline acceptance');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await expect(page.getByRole('button', { name: '账号菜单：' + email })).toBeVisible();
  await page.goto('about:blank');
  const session = await dataOf<{ csrfToken: string; user: { id: string } }>(
    await page.request.get(origin + '/api/v1/auth/session'),
    'session',
  );
  const human: Call = async <T>(method: string, path: string, body?: unknown) =>
    dataOf<T>(
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
  const project = await human<{ id: string; key: string }>('POST', '/projects', {
    name: title,
    key: projectKey,
  });
  const roles = await human<Array<{ id: string; key: string; isActive: boolean }>>(
    'GET',
    '/projects/' + project.id + '/roles',
  );
  const roleId = (key: string) => {
    const role = roles.find((item) => item.key === key && item.isActive);
    expect(role, 'seeded role ' + key).toBeTruthy();
    return role!.id;
  };
  const { requirement, published, understanding, prd } = await prepareFirstRunWorkflow({
    call: human,
    project,
    password,
    title,
    workflowKey: 'baseline-change',
    roleId,
    userId: session.user.id,
  });
  const detailPath = '/projects/' + project.id + '/requirements/' + requirement.code;
  const initial = await human<Detail>('GET', detailPath);
  expect(initial.changes).toEqual([]);
  const cases = initial.tasks.find((item) => item.stepKey === 'cases')!;
  const impl = initial.tasks.find((item) => item.stepKey === 'impl')!;
  const release = initial.tasks.find((item) => item.stepKey === 'release');
  expect(release, 'workflow contains the release task').toBeTruthy();

  const verifier = randomBytes(32).toString('base64url');
  const secret = randomBytes(32).toString('base64url');
  const device = await human<{ authorizationId: string; deviceCode: string; userCode: string }>(
    'POST',
    '/auth/cli-authorizations',
    {
      clientName: 'Baseline change QA Agent',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      codeChallengeMethod: 'S256',
      credentialSecretHash: createHash('sha256').update(secret).digest('hex'),
    },
  );
  const lookup = await human<{ version: number }>('POST', '/auth/cli-authorizations/lookup', {
    userCode: device.userCode,
  });
  await human('POST', '/auth/cli-authorizations/' + device.authorizationId + '/approve', {
    expectedVersion: lookup.version,
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
      Authorization: 'Bearer wm_a1.' + issued.credential.credentialId + '.' + secret,
    },
  });
  const agentCall: Call = async <T>(method: string, path: string, body?: unknown) =>
    dataOf<T>(
      await agent.fetch('/api/v1' + path, {
        method,
        data: body,
        headers: method === 'GET' ? {} : { 'Idempotency-Key': randomUUID() },
      }),
      'Agent ' + method + ' ' + path,
    );
  const createSnapshot = (call: Call, taskId: string, claim: { claimId: string; task: Task }) =>
    call<{ snapshot: Snapshot }>('POST', '/tasks/' + taskId + '/context-snapshots', {
      expectedVersion: claim.task.version,
      claimId: claim.claimId,
    });
  const deliveryBody = (task: Task, claimId: string, snapshotId: string, summary: string) => {
    const bytes = Buffer.from('# QA cases\n\n' + summary + '\n', 'utf8');
    return {
      expectedVersion: task.version,
      claimId,
      snapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: 'baseline-' + randomUUID(),
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
          checks: [{ code: 'baseline-cases', passed: true, source: 'AGENT_REPORTED' }],
        },
      ],
    };
  };
  try {
    const firstClaim = await agentCall<{ claimId: string; task: Task }>(
      'POST',
      '/tasks/' + cases.id + '/claims',
      {},
    );
    const first = await createSnapshot(agentCall, cases.id, firstClaim);
    expect(first.snapshot.manifest.productBaseline).toMatchObject({
      prdRevisionId: prd.revisionId,
      understandingRevisionId: understanding.revisionId,
    });
    const firstTask = await agentCall<Task>('GET', '/tasks/' + cases.id);
    const oldDelivery = await agentCall<Delivery>(
      'POST',
      '/tasks/' + cases.id + '/artifact-sets',
      deliveryBody(firstTask, firstClaim.claimId, first.snapshot.id, 'Cases for original PRD.'),
    );
    await approveSetup(human, project.id, oldDelivery.reviewRequestId, password);
    const oldReview = await human<Review>('GET', '/review-requests/' + oldDelivery.reviewRequestId);
    expect(oldReview.status).toBe('APPROVED');
    expect(oldReview.decisions).toHaveLength(1);
    expect((await human<Task>('GET', '/tasks/' + cases.id)).executionStatus).toBe('DONE');
    const implClaim = await human<{ claimId: string; task: Task }>(
      'POST',
      '/tasks/' + impl.id + '/claims',
      {},
    );
    const implSnapshot = await createSnapshot(human, impl.id, implClaim);
    const before = await human<Detail>('GET', detailPath);
    const newAcceptance = 'Changed acceptance requires fresh QA evidence against this PRD.';
    const candidate = await human<{ revision: { id: string }; reviewRequestId: string }>(
      'POST',
      '/documents/' + prd.documentId + '/revisions',
      {
        title: 'Changed PRD baseline',
        mimeType: 'text/markdown; charset=utf-8',
        bodyBase64: Buffer.from('# Changed PRD\n\n' + newAcceptance + '\n').toString('base64'),
        basisUnderstandingRevisionId: understanding.revisionId,
        deliveryScope: {
          participatingRoleIds: ['frontend', 'qa', 'ops'].map(roleId),
          requiredOutputKinds: ['IMPL', 'CASES', 'RELEASE'],
          excludedRoles: [],
        },
        acceptance: [{ key: 'ac-first-run', text: newAcceptance, verification: 'TEST' }],
      },
    );
    await test.step('reset the normal request window after real API baseline preparation', async () => {
      await page.waitForTimeout(60_000);
    });
    const publication =
      await test.step('read the changed PRD and publish through browser password tickets', async () => {
        await page.goto('/reviews/' + candidate.reviewRequestId);
        await expect(page.locator('.paper-content')).toContainText(newAcceptance);
        await expect(page.getByRole('heading', { name: '与已发布版本的差异' })).toBeVisible();
        await expect(page.locator('.wm-diff')).toContainText(newAcceptance);
        return approveInBrowser(
          page,
          candidate.reviewRequestId,
          password,
          'Publish changed acceptance; previous QA evidence must be revalidated.',
        );
      });
    expect(publication.published).toBe(true);
    expect(publication.publicationId).toBeTruthy();
    await page.goto('about:blank');
    const after = await human<Detail>('GET', detailPath);
    expect(after.requirement.generation).toBe(before.requirement.generation + 1);
    expect(after.requirement.version).toBe(before.requirement.version + 1);
    for (const task of after.tasks) {
      const previous = before.tasks.find((item) => item.id === task.id)!;
      expect(task).toMatchObject({
        generation: previous.generation + 1,
        version: previous.version + 1,
        executionStatus: 'OPEN',
        workStatus: 'ACTIVE',
        currentClaimId: null,
        currentArtifactSetId: null,
      });
    }
    const document = await human<{ publishedRevision: { id: string } }>(
      'GET',
      '/documents/' + prd.documentId,
    );
    expect(document.publishedRevision.id).toBe(candidate.revision.id);
    const historicalReview = await human<Review>('GET', '/review-requests/' + oldReview.id);
    expect(historicalReview).toMatchObject({ status: 'APPROVED', decisions: oldReview.decisions });
    const historicalSnapshot = await human<Snapshot>(
      'GET',
      '/context-snapshots/' + first.snapshot.id,
    );
    expect(historicalSnapshot.manifestDigest).toBe(first.snapshot.manifestDigest);
    expect(historicalSnapshot.manifest).toEqual(first.snapshot.manifest);
    expect(normalizedSnapshot(historicalSnapshot)).toEqual(normalizedSnapshot(first.snapshot));
    const historicalSet = await human<Delivery['artifactSet']>(
      'GET',
      '/artifact-sets/' + oldDelivery.artifactSet.id,
    );
    expect(historicalSet.snapshotId).toBe(first.snapshot.id);
    expect(historicalSet.artifacts.map((item) => item.sha256)).toEqual(
      oldDelivery.artifactSet.artifacts.map((item) => item.sha256),
    );
    const events = after.changes.filter((item) => item.sourceKind === 'DOCUMENT_PUBLICATION');
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.sourceId).toBe(publication.publicationId);
    expect(event.changedFields).toEqual(['currentPrdRevisionId', 'generation']);
    expect(event.targets).toEqual({
      taskIds: after.tasks.map((item) => item.id).sort(),
      documentId: prd.documentId,
      previousDocumentRevisionId: prd.revisionId,
      documentRevisionId: candidate.revision.id,
      requirementGeneration: after.requirement.generation,
    });
    expect(event.recipients).toHaveLength(3);
    expect(event.recipients.map((item) => item.roleId).sort()).toEqual(
      ['frontend', 'qa', 'ops'].map(roleId).sort(),
    );
    expect(event.recipients.every((item) => item.userId === session.user.id && !item.ackedAt)).toBe(
      true,
    );
    const invalidClaim = await page.request.post(
      origin + '/api/v1/tasks/' + impl.id + '/context-snapshots',
      {
        headers: {
          Origin: origin,
          'X-CSRF-Token': session.csrfToken,
          'Idempotency-Key': randomUUID(),
        },
        data: {
          expectedVersion: after.tasks.find((item) => item.id === impl.id)!.version,
          claimId: implClaim.claimId,
        },
      },
    );
    expect(invalidClaim.status()).toBe(409);
    expect((await invalidClaim.json()).error.code).toBe('CLAIM_INVALID');
    const historicalImplSnapshot = await human<Snapshot>(
      'GET',
      '/context-snapshots/' + implSnapshot.snapshot.id,
    );
    expect(historicalImplSnapshot.manifestDigest).toBe(implSnapshot.snapshot.manifestDigest);
    expect(historicalImplSnapshot.manifest).toEqual(implSnapshot.snapshot.manifest);
    expect(normalizedSnapshot(historicalImplSnapshot)).toEqual(
      normalizedSnapshot(implSnapshot.snapshot),
    );
    await test.step('reset the normal request window before change ACK and new QA acceptance', async () => {
      await page.waitForTimeout(60_000);
    });
    const ackedIds: string[] = [];
    await test.step('acknowledge each role notification in the browser without accepting the QA task', async () => {
      await page.goto('/?type=changes&project=' + project.id);
      for (let index = 0; index < event.recipients.length; index += 1) {
        const rows = page.locator('article.is-change').filter({ hasText: requirement.code });
        await expect(rows).toHaveCount(event.recipients.length - index);
        await rows.first().getByRole('button', { name: '去确认', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: '需求变更 · 需要确认' });
        await expect(dialog).toContainText(requirement.code);
        await expect(
          dialog.getByText('开始或继续任务前，重新获取上下文，并核对本次变更与当前交付的差异。', {
            exact: false,
          }),
        ).toBeVisible();
        await dialog.getByText('查看技术详情', { exact: true }).click();
        const technicalDetails = dialog.locator('details');
        await expect(technicalDetails).toHaveAttribute('open', '');
        await expect(technicalDetails).toContainText(candidate.revision.id);
        const acknowledged = page.waitForResponse(
          (response) =>
            /\/api\/v1\/change-recipients\/[^/]+\/ack$/.test(response.url()) &&
            response.request().method() === 'POST',
        );
        await dialog.getByRole('button', { name: '确认已知悉', exact: true }).click();
        const response = await acknowledged;
        expect(response.status(), await response.text()).toBe(201);
        const result = (await response.json()).data as { recipient: Recipient };
        const recipient = event.recipients.find((item) => item.id === result.recipient.id)!;
        expect(recipient).toBeTruthy();
        expect(result.recipient.version).toBe(recipient.version + 1);
        expect(result.recipient.ackedAt).toBeTruthy();
        ackedIds.push(result.recipient.id);
        await expect(dialog).not.toBeVisible();
      }
      await expect(
        page.locator('article.is-change').filter({ hasText: requirement.code }),
      ).toHaveCount(0);
      await page.reload();
      await expect(
        page.locator('article.is-change').filter({ hasText: requirement.code }),
      ).toHaveCount(0);
    });
    expect(new Set(ackedIds).size).toBe(3);
    const acked = await human<{ items: Recipient[] }>(
      'GET',
      '/change-recipients?projectId=' + project.id + '&ackedOnly=true&limit=100',
    );
    expect(acked.items.filter((item) => item.eventId === event.id)).toHaveLength(3);
    expect((await human<Task>('GET', '/tasks/' + cases.id)).executionStatus).toBe('OPEN');
    await page.goto('about:blank');
    const newClaim = await agentCall<{ claimId: string; task: Task }>(
      'POST',
      '/tasks/' + cases.id + '/claims',
      {},
    );
    const staleDelivery = await agent.post('/api/v1/tasks/' + cases.id + '/artifact-sets', {
      headers: { 'Idempotency-Key': randomUUID() },
      data: deliveryBody(
        newClaim.task,
        newClaim.claimId,
        first.snapshot.id,
        'Rejected old snapshot reuse.',
      ),
    });
    expect(staleDelivery.status()).toBe(409);
    expect((await staleDelivery.json()).error.code).toBe('BASELINE_STALE');
    const fresh = await createSnapshot(agentCall, cases.id, newClaim);
    expect(fresh.snapshot.id).not.toBe(first.snapshot.id);
    expect(fresh.snapshot.requirementGeneration).toBe(after.requirement.generation);
    expect(fresh.snapshot.manifest.productBaseline).toMatchObject({
      prdRevisionId: candidate.revision.id,
      understandingRevisionId: understanding.revisionId,
    });
    const newTask = await agentCall<Task>('GET', '/tasks/' + cases.id);
    const summary = 'Fresh QA cases verify the changed PRD ' + candidate.revision.id;
    const newDelivery = await agentCall<Delivery>(
      'POST',
      '/tasks/' + cases.id + '/artifact-sets',
      deliveryBody(newTask, newClaim.claimId, fresh.snapshot.id, summary),
    );
    expect(newDelivery.reviewRequestId).not.toBe(oldReview.id);
    await test.step('read new baseline evidence and approve the new QA delivery in the browser', async () => {
      await page.goto('/reviews/' + newDelivery.reviewRequestId);
      await expect(page.locator('.artifact-preview')).toContainText(summary);
      await expect(page.getByText(newAcceptance, { exact: false })).toBeVisible();
      await approveInBrowser(
        page,
        newDelivery.reviewRequestId,
        password,
        'Fresh QA acceptance of the changed PRD.',
      );
      await page.reload();
      await expect(
        page.getByRole('row').filter({ hasText: 'Fresh QA acceptance of the changed PRD.' }),
      ).toContainText(email);
    });
    const final = await human<Detail>('GET', detailPath);
    expect(final.tasks.find((item) => item.id === cases.id)).toMatchObject({
      executionStatus: 'DONE',
      currentClaimId: null,
      currentArtifactSetId: newDelivery.artifactSet.id,
    });
    expect(final.tasks.find((item) => item.id === impl.id)?.executionStatus).toBe('OPEN');
    const ready = await human<{ items: Task[] }>(
      'GET',
      '/projects/' + project.id + '/tasks/ready?limit=10',
    );
    expect(ready.items.map((item) => item.stepKey)).toEqual(['impl']);
    await page.goto(
      '/requirements/' + requirement.code + '?projectId=' + project.id + '&taskId=' + cases.id,
    );
    await expectTaskState(page.locator('[data-task-id="' + cases.id + '"]'), 'DONE', apiFailures);
    await expectTaskState(
      page.locator('[data-task-id="' + release!.id + '"]'),
      'WAITING_PREDECESSOR',
      apiFailures,
    );
    expect(pageErrors).toEqual([]);
    expect(apiFailures).toEqual([]);
    const resultPath = testInfo.outputPath('baseline-change-result.json');
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          projectId: project.id,
          requirementId: requirement.id,
          previousPrdRevisionId: prd.revisionId,
          publishedPrdRevisionId: candidate.revision.id,
          publicationId: publication.publicationId,
          requirementGeneration: {
            before: before.requirement.generation,
            after: after.requirement.generation,
          },
          historicalReviewId: oldReview.id,
          historicalDecisionIds: oldReview.decisions.map((item) => item.id),
          historicalArtifactSetId: oldDelivery.artifactSet.id,
          oldSnapshotId: first.snapshot.id,
          newSnapshotId: fresh.snapshot.id,
          newArtifactSetId: newDelivery.artifactSet.id,
          newReviewId: newDelivery.reviewRequestId,
          changeEventId: event.id,
          acknowledgedRecipientIds: ackedIds.sort(),
          releaseState: 'WAITING_PREDECESSOR',
          notCovered: [
            'GitHub implementation evidence',
            'implementation completion',
            'release sign-off',
            'cross-browser or external-team acceptance',
          ],
        },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    await testInfo.attach('baseline-change-result', {
      contentType: 'application/json',
      path: resultPath,
    });
  } finally {
    await agent.dispose();
  }
});
