#!/usr/bin/env node
/**
 * A3 first run: from zero to a real human sign-off, over the official /api/v1 only.
 *
 * Why a script: the acceptance criterion is "a stranger reaches human sign-off",
 * so the path must be repeatable, timed, and fail with the server envelope
 * (including requestId) instead of a vague message.
 *
 * Deliberately not automated: CLI device authorization needs a browser approval.
 * This script performs the agent-side writes with the same HUMAN session to
 * prove the server chain holds; it never bypasses a gate: publish and approve
 * both use real one-time confirmation tickets obtained via password re-auth.
 *
 * Usage: node scripts/first-run-demo.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { createFirstRunIdentity } from './first-run-demo-key.mjs';
import { prepareFirstRunWorkflow } from './lib/first-run-workflow.mjs';

const BASE = process.env.WORKMESH_API ?? 'http://127.0.0.1:3000';
const ORIGIN = process.env.WORKMESH_ORIGIN ?? 'http://127.0.0.1:5173';

const cookieJar = new Map();
let csrfToken = '';
const timeline = [];

function fail(message, detail) {
  throw new Error(`${message}\n${JSON.stringify(detail, null, 2)}`);
}

function absorbCookies(response) {
  for (const entry of response.headers.getSetCookie?.() ?? []) {
    const [pair, ...attributes] = entry.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1);
    if (value === '' || attributes.some((item) => /^\s*max-age=0\s*$/i.test(item)))
      cookieJar.delete(name);
    else cookieJar.set(name, value);
    if (name.endsWith('wm_csrf')) csrfToken = value;
  }
}

async function call(method, path, options = {}) {
  const headers = { Accept: 'application/json', Origin: ORIGIN };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const cookies = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  if (cookies) headers.Cookie = cookies;
  if (csrfToken && method !== 'GET') headers['X-CSRF-Token'] = csrfToken;
  if (method !== 'GET') headers['Idempotency-Key'] = options.idempotency ?? randomUUID();

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  absorbCookies(response);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) fail(`${method} ${path} -> HTTP ${response.status}`, payload?.error ?? payload);
  return payload?.data ?? payload;
}

async function step(name, run) {
  const started = Date.now();
  const result = await run();
  const ms = Date.now() - started;
  timeline.push({ name, ms });
  process.stdout.write(`  ok  ${name} (${ms}ms)\n`);
  return result;
}

async function ticketFor(binding, password) {
  const preview = await call('POST', '/api/v1/auth/action-previews', { body: binding });
  return call('POST', '/api/v1/auth/confirmation-tickets', {
    body: { ...binding, actionDigest: preview.actionDigest, password },
  });
}

const { runId: stamp, email, projectKey } = createFirstRunIdentity();
const password = 'Demo-Passw0rd!';

process.stdout.write(`\nWorkMesh first run against ${BASE}\n\n`);

let userId = '';
await step('register and establish web session', async () => {
  const anonymous = await call('GET', '/api/v1/auth/session');
  csrfToken = anonymous.csrfToken;
  await call('POST', '/api/v1/auth/register', { body: { email, password, name: 'First Run' } });
  const session = await call('GET', '/api/v1/auth/session');
  userId = session.user?.id ?? '';
  if (!userId) fail('session has no user.id', session);
});

const project = await step('create project', () =>
  call('POST', '/api/v1/projects', { body: { name: 'First Run Project', key: projectKey } }),
);

const roles = await step('read seeded roles', () =>
  call('GET', `/api/v1/projects/${project.id}/roles`),
);
const roleIdByKey = new Map(
  roles.filter((role) => role.isActive).map((role) => [role.key, role.id]),
);

const { requirement, published, understanding, prd } = await step(
  'publish baseline and create workflow with implementation retained',
  () =>
    prepareFirstRunWorkflow({
      call: (method, path, body) => call(method, '/api/v1' + path, { body }),
      project,
      password,
      title: 'First run: human QA acceptance',
      workflowKey: 'first-run',
      roleId: (key) => {
        const id = roleIdByKey.get(key);
        if (!id) fail('No active role for ' + key, roles);
        return id;
      },
      userId,
    }),
);
const ready = await step('read ready tasks', () =>
  call('GET', `/api/v1/projects/${project.id}/tasks/ready?limit=10`),
);
const task = ready.items?.find((item) => item.stepKey === 'cases');
if (!task) fail('no ready QA task after instance creation', ready);
if (
  ready.items
    .map((item) => item.stepKey)
    .sort()
    .join(',') !== 'cases,impl'
)
  fail('first-run must retain a pending implementation task', ready);

const claim = await step('claim task', () =>
  call('POST', `/api/v1/tasks/${task.id}/claims`, { body: {}, idempotency: randomUUID() }),
);
const claimId = claim.claimId ?? claim.task?.currentClaim?.id;
if (!claimId) fail('claim response has no claimId', claim);

const snapshot = await step('build context snapshot', () =>
  call('POST', `/api/v1/tasks/${task.id}/context-snapshots`, {
    body: { expectedVersion: claim.task.version, claimId },
    idempotency: randomUUID(),
  }),
);
const snapshotId = snapshot.id ?? snapshot.snapshot?.id;
if (!snapshotId) fail('snapshot response has no id', snapshot);
const baseline = snapshot.snapshot?.manifest?.productBaseline;
if (
  baseline?.prdRevisionId !== prd.revisionId ||
  baseline?.understandingRevisionId !== understanding.revisionId
)
  fail('snapshot does not contain the actual published product baseline', snapshot);

// 快照落盘会推进 Task.version，后续写操作必须用最新版本，而不是认领时的版本。
const afterSnapshot = await call('GET', `/api/v1/tasks/${task.id}`);
const taskVersion = afterSnapshot.version;

const bodyBytes = Buffer.from(`# First run delivery\n\n${new Date().toISOString()}\n`, 'utf8');
const delivered = await step('deliver artifact set', () =>
  call('POST', `/api/v1/tasks/${task.id}/artifact-sets`, {
    body: {
      expectedVersion: taskVersion,
      claimId,
      snapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: `demo-${stamp}`,
      candidateRevisionIds: [],
      items: [
        {
          kind: 'CASES',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/markdown',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'),
          byteLength: bodyBytes.byteLength,
          bodyBase64: bodyBytes.toString('base64'),
          summary: 'first run delivery',
          checks: [{ code: 'demo-smoke', passed: true }],
        },
      ],
    },
    idempotency: randomUUID(),
  }),
);
const artifactSetId = delivered.artifactSet?.id ?? delivered.artifactSetId;
if (!artifactSetId) fail('deliver response has no artifact set id', delivered);

// 交付会自动派生任务验收请求，不需要再手工 POST /review-requests。
const reviewId = delivered.reviewRequestId ?? delivered.review?.id;
if (!reviewId) fail('deliver response has no reviewRequestId', delivered);
const review = await step('read review created by delivery', () =>
  call('GET', `/api/v1/review-requests/${reviewId}`),
);

const slot = review.slots?.find((item) => !item.decided && item.viewerCanDecide);
if (!slot) fail('review has no approval slot', review);

await step('human QA sign-off (approve)', async () => {
  const binding = {
    action: 'REVIEW_DECIDE',
    projectId: project.id,
    targetType: 'REVIEW_REQUEST',
    targetId: review.id,
    expectedVersion: review.version,
    roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
    payload: {
      slotId: slot.id,
      decision: 'APPROVE',
      subjectDigest: review.subjectDigest,
      comment: null,
    },
  };
  const ticket = await ticketFor(binding, password);
  return call('POST', `/api/v1/review-requests/${review.id}/decisions`, {
    body: {
      slotId: slot.id,
      decision: 'APPROVE',
      expectedVersion: review.version,
      comment: null,
      confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
    },
    idempotency: randomUUID(),
  });
});

const persisted = await step('verify persisted QA approval and release blocking', async () => {
  const reviewAfter = await call('GET', `/api/v1/review-requests/${review.id}`);
  const taskAfter = await call('GET', `/api/v1/tasks/${task.id}`);
  const readyAfter = await call('GET', `/api/v1/projects/${project.id}/tasks/ready?limit=10`);
  const requirementAfter = await call(
    'GET',
    `/api/v1/projects/${project.id}/requirements/${requirement.code}`,
  );
  const release = requirementAfter.tasks?.find((item) => item.stepKey === 'release');
  const implementation = requirementAfter.tasks?.find((item) => item.stepKey === 'impl');
  if (
    reviewAfter.status !== 'APPROVED' ||
    taskAfter.executionStatus !== 'DONE' ||
    taskAfter.currentClaim !== null
  )
    fail('QA approval did not persist or its claim was not released', { reviewAfter, taskAfter });
  if (readyAfter.items.map((item) => item.stepKey).join(',') !== 'impl')
    fail('implementation must remain ready and release must remain blocked', readyAfter);
  if (
    !release ||
    release.executionStatus !== 'OPEN' ||
    release.currentClaimId !== null ||
    !implementation ||
    implementation.executionStatus !== 'OPEN' ||
    implementation.currentClaimId !== null
  )
    fail('release must remain waiting for implementation', requirementAfter);
  return { review: reviewAfter, task: taskAfter, release, releaseState: 'WAITING_PREDECESSOR' };
});

const total = timeline.reduce((sum, item) => sum + item.ms, 0);
process.stdout.write(
  `\nRESULT: QA review ${review.id} -> ${persisted.review.status}; QA task -> ${persisted.task.executionStatus}\n`,
);
process.stdout.write('Implementation remains unfinished; release remains WAITING_PREDECESSOR.\n');
process.stdout.write(
  'Not covered: live Agent device authorization, implementation evidence, release sign-off, change propagation.\n',
);
process.stdout.write(`task ${task.id}\n\n`);
for (const item of timeline)
  process.stdout.write(`  ${String(item.ms).padStart(5)}ms  ${item.name}\n`);
process.stdout.write(`  ${String(total).padStart(5)}ms  TOTAL (server time only)\n\n`);
process.stdout.write(`account ${email}\nproject ${project.id}\nsign in at ${ORIGIN} to inspect.\n`);
