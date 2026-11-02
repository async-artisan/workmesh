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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.WORKMESH_API ?? 'http://127.0.0.1:3000';
const ORIGIN = process.env.WORKMESH_ORIGIN ?? 'http://127.0.0.1:5173';

const { usedWorkflowRoleKeys } = await import(
  new URL(`file://${join(root, 'packages/shared/dist/index.js').replace(/\\/g, '/')}`)
);

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
  if (options.idempotency) headers['Idempotency-Key'] = options.idempotency;

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

const stamp = Date.now().toString(36);
const email = `demo-${stamp}@workmesh.local`;
const password = 'Demo-Passw0rd!';
const projectKey = `RUN${String.fromCharCode(65 + Math.floor((Date.now() % 676) / 26))}${String.fromCharCode(65 + (Date.now() % 26))}`;

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

const packages = await step(
  'read builtin role packages',
  async () => (await call('GET', `/api/v1/projects/${project.id}/role-packages?limit=100`)).items,
);

/**
 * 首跑用最小流程（impl -> release），而不是标准五步流程：
 * 标准流程的 impl 依赖 prd，而 prd 需要先走完候选文档 + 评审 + 发布，
 * 那是"真实项目"的路径，不是"十分钟首跑"该验证的东西。
 * 这里验证的是机制本身：票据发布、认领、快照、交付自动派生验收、人工签字。
 */
const definition = {
  schemaVersion: '1.0',
  protocolVersion: '1.0',
  workflowKey: 'first-run',
  title: 'First run',
  baseRevisionId: null,
  roleExclusions: [],
  stepRemovals: [],
  roleSlots: [
    { key: 'task-acceptance', roleKey: 'frontend', kind: 'TASK_ACCEPTANCE' },
    { key: 'release-acceptance', roleKey: 'ops', kind: 'RELEASE_ACCEPTANCE' },
  ],
  steps: [
    {
      key: 'cases',
      roleKey: 'frontend',
      kind: 'VERIFY',
      deps: [],
      outputKinds: ['CASES'],
      gates: [{ mode: 'ALL', reviewerSlots: ['task-acceptance'] }],
    },
    {
      key: 'release',
      roleKey: 'ops',
      kind: 'RELEASE',
      deps: ['cases'],
      outputKinds: ['RELEASE'],
      gates: [{ mode: 'ALL', reviewerSlots: ['release-acceptance'] }],
    },
  ],
};
const locks = usedWorkflowRoleKeys(definition)
  .map((roleKey) => {
    const candidates = packages.filter((item) => item.roleKey === roleKey);
    if (candidates.length === 0) fail(`role ${roleKey} has no registered package`, packages);
    const best = [...candidates].sort((a, b) => a.version.localeCompare(b.version)).at(-1);
    return {
      roleKey,
      packageId: best.packageId,
      version: best.version,
      packageDigest: best.manifestDigest,
    };
  })
  .sort((left, right) => left.roleKey.localeCompare(right.roleKey));

const validation = await step('validate standard template', () =>
  call('POST', `/api/v1/projects/${project.id}/workflow-definitions/validate`, {
    body: { definition, packageLocks: locks },
  }),
);
if (!validation.valid) fail('template invalid', validation.issues);

const published = await step('publish workflow (confirmation ticket)', async () => {
  const binding = {
    action: 'WORKFLOW_CONFIG_PUBLISH',
    projectId: project.id,
    targetType: 'WORKFLOW_DEFINITION',
    targetId: definition.workflowKey,
    expectedVersion: project.version,
    roleSlot: null,
    payload: { expectedCurrentRevision: 0, compiledDigest: validation.digest, packageLocks: locks },
  };
  const ticket = await ticketFor(binding, password);
  return call(
    'POST',
    `/api/v1/projects/${project.id}/workflow-definitions/${definition.workflowKey}/publish`,
    {
      body: {
        expectedVersion: project.version,
        expectedCurrentRevision: 0,
        definition,
        packageLocks: locks,
        confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
      },
      idempotency: randomUUID(),
    },
  );
});

const requirement = await step('create requirement', () =>
  call('POST', `/api/v1/projects/${project.id}/requirements`, {
    body: { title: 'First run: checkout revamp', description: 'created by first-run-demo.mjs' },
  }),
);

const repository = await step('register project repository', () =>
  call('POST', `/api/v1/projects/${project.id}/repositories`, {
    body: {
      adapter: 'github',
      externalId: `demo-${stamp}`,
      owner: 'demo',
      name: projectKey.toLowerCase(),
    },
  }),
);

await step('create workflow instance', () =>
  call('POST', `/api/v1/requirements/${requirement.id}/workflow-instances`, {
    body: {
      definitionRevisionId: published.definitionRevisionId,
      expectedRequirementVersion: requirement.version,
      stepBindings: definition.steps.map((item) => ({
        stepKey: item.key,
        roleId: roleIdByKey.get(item.roleKey),
        responsibleUserId: userId,
        repositoryIds: (item.outputKinds ?? []).includes('IMPL') ? [repository.id] : [],
      })),
      roleSlotBindings: definition.roleSlots.map((item) => ({
        slotKey: item.key,
        roleId: roleIdByKey.get(item.roleKey),
        userId,
      })),
    },
    idempotency: randomUUID(),
  }),
);

const ready = await step('read ready tasks', () =>
  call('GET', `/api/v1/projects/${project.id}/tasks/ready?limit=10`),
);
const task = ready.items?.[0];
if (!task) fail('no ready task after instance creation', ready);

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

const slot = review.slots?.[0];
if (!slot) fail('review has no approval slot', review);

const decided = await step('human sign-off (approve)', async () => {
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

const total = timeline.reduce((sum, item) => sum + item.ms, 0);
process.stdout.write(`\nRESULT: review ${review.id} -> ${decided.review?.status ?? 'APPROVED'}\n`);
process.stdout.write(`task ${task.id}\n\n`);
for (const item of timeline)
  process.stdout.write(`  ${String(item.ms).padStart(5)}ms  ${item.name}\n`);
process.stdout.write(`  ${String(total).padStart(5)}ms  TOTAL (server time only)\n\n`);
process.stdout.write(`account ${email}\nproject ${project.id}\nsign in at ${ORIGIN} to inspect.\n`);
