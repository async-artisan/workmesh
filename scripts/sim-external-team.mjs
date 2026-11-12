#!/usr/bin/env node
/**
 * G0 外部团队模拟脚本：owner + frontend dev + qa reviewer 三角色完整闭环。
 *
 * 覆盖范围：
 *   owner   注册 → 创建项目 → 发布流程 + PRD/Understanding → 邀请成员
 *   dev     接受邀请 → 认领 IMPL 任务 → 交付 → 收到返修 → 重新交付
 *   qa      接受邀请 → 认领 CASES 任务 → 交付 → 批准 dev 交付（APPROVE）→ 被批准 CASES
 *   owner   认领 RELEASE 任务 → 批准发布
 *
 * 不覆盖：
 *   CLI 设备授权（需浏览器）、真实代码仓库证据、跨平台安装验证。
 *
 * 用法：
 *   node scripts/sim-external-team.mjs
 *   WORKMESH_API=http://your-server:3000 WORKMESH_ORIGIN=http://your-server:5173 node scripts/sim-external-team.mjs
 *
 * 输出：
 *   .tmp/sim-external-<timestamp>/result.json  — 机器可读的运行摘要
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareFirstRunWorkflow } from './lib/first-run-workflow.mjs';

const BASE = (process.env.WORKMESH_API ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const ORIGIN = process.env.WORKMESH_ORIGIN ?? 'http://127.0.0.1:5173';
const PASSWORD = 'SimTeam-2026!';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = resolve(root, `.tmp/sim-external-${stamp}`);
const resultPath = resolve(outDir, 'result.json');

// ---------------------------------------------------------------------------
// HTTP client factory (each actor has an isolated session)
// ---------------------------------------------------------------------------

function makeClient(label) {
  const jar = new Map();
  let csrf = '';

  async function call(method, path, options = {}) {
    const headers = { Accept: 'application/json', Origin: ORIGIN };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const cookie = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
    if (method !== 'GET') headers['Idempotency-Key'] = options.idempotency ?? randomUUID();

    const response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    for (const entry of response.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = entry.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1);
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
      if (name.endsWith('wm_csrf')) csrf = value;
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { error: { code: 'NON_JSON_RESPONSE', raw: text.slice(0, 200) } };
    }
    if (!response.ok) {
      const err = payload?.error ?? payload;
      const code = err?.code ?? 'REQUEST_FAILED';
      const reqId = err?.requestId ? ` (requestId: ${err.requestId})` : '';
      throw new Error(`[${label}] ${method} ${path} -> HTTP ${response.status} ${code}${reqId}`);
    }
    return payload?.data ?? payload;
  }

  async function bootstrap() {
    const session = await call('GET', '/api/v1/auth/session');
    csrf = session.csrfToken ?? csrf;
    return session;
  }

  // Shorthand for the workflow lib (strips /api/v1 prefix)
  function apiCall(method, path, body) {
    return call(method, '/api/v1' + path, { body });
  }

  async function ticketFor(binding) {
    const preview = await call('POST', '/api/v1/auth/action-previews', { body: binding });
    return call('POST', '/api/v1/auth/confirmation-tickets', {
      body: { ...binding, actionDigest: preview.actionDigest, password: PASSWORD },
    });
  }

  return { call: (m, p, o) => call(m, '/api/v1' + p, o), rawCall: call, apiCall, bootstrap, ticketFor, label };
}

// ---------------------------------------------------------------------------
// Step helper
// ---------------------------------------------------------------------------

const timeline = [];

async function step(name, run) {
  const t0 = Date.now();
  const result = await run();
  const ms = Date.now() - t0;
  timeline.push({ name, ms });
  process.stdout.write(`  ok  ${name} (${ms}ms)\n`);
  return result;
}

function fail(msg, detail) {
  throw new Error(`${msg}\n${JSON.stringify(detail ?? {}, null, 2)}`);
}

// ---------------------------------------------------------------------------
// Identity helpers
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomKey(len = 6) {
  let k = '';
  for (let i = 0; i < len; i++) k += LETTERS[randomInt(LETTERS.length)];
  return k;
}

function emailFor(role) {
  return `sim-${role}-${stamp}@workmesh.local`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

process.stdout.write(`\nWorkMesh external team simulation against ${BASE}\n\n`);

const owner = makeClient('owner');
const dev = makeClient('dev');
const qa = makeClient('qa');

// 1. Owner: register + create project
let project, ownerUserId, roleIdByKey;

await step('owner: register and establish session', async () => {
  await owner.bootstrap();
  await owner.rawCall('POST', `${BASE}/api/v1/auth/register`, {
    body: { email: emailFor('owner'), password: PASSWORD, name: 'Sim Owner' },
  });
  const session = await owner.rawCall('GET', `${BASE}/api/v1/auth/session`);
  ownerUserId = session.user?.id;
  if (!ownerUserId) fail('owner session has no user.id', session);
});

await step('owner: create project', async () => {
  project = await owner.call('POST', '/projects', {
    body: { name: `Sim External Team ${stamp}`, key: randomKey() },
  });
});

await step('owner: read roles', async () => {
  const roles = await owner.call('GET', `/projects/${project.id}/roles`);
  roleIdByKey = new Map(
    roles.filter((r) => r.isActive).map((r) => [r.key, r.id]),
  );
  for (const key of ['product', 'frontend', 'qa', 'ops']) {
    if (!roleIdByKey.has(key)) fail(`missing active role: ${key}`, roles);
  }
});

// 2. Owner: publish workflow + PRD/Understanding (reuses first-run-workflow lib)
let requirement, published, understanding, prd;

await step('owner: publish workflow and product baseline', async () => {
  const result = await prepareFirstRunWorkflow({
    call: owner.apiCall,
    project,
    password: PASSWORD,
    title: 'Sim: external team full delivery cycle',
    workflowKey: 'sim-external',
    roleId: (key) => {
      const id = roleIdByKey.get(key);
      if (!id) fail('No role for key: ' + key, [...roleIdByKey.keys()]);
      return id;
    },
    userId: ownerUserId,
  });
  ({ requirement, published, understanding, prd } = result);
});

// 3. Owner: invite dev (frontend) and qa
let devInviteToken, qaInviteToken;

async function inviteMember(actor, projectId, roleKey, inviteEmail, expectedProjectVersion) {
  const roleId = roleIdByKey.get(roleKey);
  if (!roleId) fail(`No active role: ${roleKey}`);
  const binding = {
    action: 'PROJECT_INVITATION_CREATE',
    projectId,
    targetType: 'PROJECT_INVITATION',
    targetId: projectId,
    expectedVersion: expectedProjectVersion,
    roleSlot: null,
    payload: { roleIds: [roleId], email: inviteEmail.toLowerCase(), expiresInHours: 72 },
  };
  const ticket = await actor.ticketFor(binding);
  const invitation = await actor.call(
    'POST',
    `/projects/${projectId}/invitations`,
    {
      body: {
        roleKeys: [roleKey],
        email: inviteEmail,
        expiresInHours: 72,
        expectedVersion: expectedProjectVersion,
        confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
      },
      idempotency: randomUUID(),
    },
  );
  if (!invitation.token?.startsWith('wmi_')) fail('invite token missing', invitation);
  return invitation.token;
}

let currentProjectVersion = project.version;

await step('owner: invite frontend dev', async () => {
  const proj = await owner.call('GET', `/projects/${project.id}`);
  currentProjectVersion = proj.version;
  devInviteToken = await inviteMember(owner, project.id, 'frontend', emailFor('dev'), currentProjectVersion);
});

await step('owner: invite qa reviewer', async () => {
  const proj = await owner.call('GET', `/projects/${project.id}`);
  currentProjectVersion = proj.version;
  qaInviteToken = await inviteMember(owner, project.id, 'qa', emailFor('qa'), currentProjectVersion);
});

// 4. Dev: accept invitation and join project
let devUserId;

await step('dev: accept invitation and join project', async () => {
  await dev.bootstrap();
  const resolved = await dev.call('GET', `/invitations/${devInviteToken}`);
  if (resolved.status !== 'PENDING') fail('dev invitation not PENDING', resolved);
  const joined = await dev.call('POST', `/invitations/${devInviteToken}/accept`, {
    body: { email: emailFor('dev'), password: PASSWORD, name: 'Sim Developer' },
  });
  if (joined.invitation?.projectId !== project.id) fail('dev joined wrong project', joined);
  const session = await dev.call('GET', '/auth/session');
  devUserId = session.user?.id;
});

// 5. QA: accept invitation and join project
let qaUserId;

await step('qa: accept invitation and join project', async () => {
  await qa.bootstrap();
  const resolved = await qa.call('GET', `/invitations/${qaInviteToken}`);
  if (resolved.status !== 'PENDING') fail('qa invitation not PENDING', resolved);
  const joined = await qa.call('POST', `/invitations/${qaInviteToken}/accept`, {
    body: { email: emailFor('qa'), password: PASSWORD, name: 'Sim QA Reviewer' },
  });
  if (joined.invitation?.projectId !== project.id) fail('qa joined wrong project', joined);
  const session = await qa.call('GET', '/auth/session');
  qaUserId = session.user?.id;
});

// 6. Dev: claim IMPL task → deliver → auto-review created
let implTask, implClaimId, implSnapshotId, implReviewId, implTaskVersion;

await step('dev: claim IMPL task', async () => {
  const ready = await dev.call('GET', `/projects/${project.id}/tasks/ready?limit=20`);
  implTask = ready.items?.find((t) => t.stepKey === 'impl');
  if (!implTask) fail('no IMPL task found in ready queue', ready);
  const claim = await dev.call('POST', `/tasks/${implTask.id}/claims`, {
    body: {},
    idempotency: randomUUID(),
  });
  implClaimId = claim.claimId ?? claim.task?.currentClaim?.id;
  if (!implClaimId) fail('no claimId in claim response', claim);
  implTaskVersion = claim.task?.version;
});

await step('dev: build context snapshot', async () => {
  const snap = await dev.call('POST', `/tasks/${implTask.id}/context-snapshots`, {
    body: { expectedVersion: implTaskVersion, claimId: implClaimId },
    idempotency: randomUUID(),
  });
  implSnapshotId = snap.id ?? snap.snapshot?.id;
  if (!implSnapshotId) fail('no snapshot id', snap);
  const after = await dev.call('GET', `/tasks/${implTask.id}`);
  implTaskVersion = after.version;
});

await step('dev: deliver IMPL (first attempt)', async () => {
  const bodyBytes = Buffer.from(
    `# Implementation\n\nSimulated IMPL delivery at ${new Date().toISOString()}.\n\n` +
    `This placeholder represents the work product for simulation purposes.\n`,
    'utf8',
  );
  const delivered = await dev.call('POST', `/tasks/${implTask.id}/artifact-sets`, {
    body: {
      expectedVersion: implTaskVersion,
      claimId: implClaimId,
      snapshotId: implSnapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: `sim-impl-${stamp}`,
      candidateRevisionIds: [],
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/markdown',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'),
          byteLength: bodyBytes.byteLength,
          bodyBase64: bodyBytes.toString('base64'),
          summary: 'Simulated implementation delivery',
          checks: [{ code: 'sim-smoke', passed: true }],
        },
      ],
    },
    idempotency: randomUUID(),
  });
  implReviewId = delivered.reviewRequestId ?? delivered.review?.id;
  if (!implReviewId) fail('no reviewRequestId in deliver response', delivered);
});

// 7. QA: request rework on IMPL review
await step('qa: request rework on IMPL review', async () => {
  const review = await qa.call('GET', `/review-requests/${implReviewId}`);
  const slot = review.slots?.find((s) => !s.decided && s.viewerCanDecide);
  if (!slot) {
    // QA might not have a slot on IMPL — post a discussion comment instead
    // then the owner can formally request rework. Try REWORK via owner below.
    process.stdout.write('    (qa has no direct slot on IMPL; will rework via owner)\n');
    return;
  }
  const binding = {
    action: 'REVIEW_DECIDE',
    projectId: project.id,
    targetType: 'REVIEW_REQUEST',
    targetId: review.id,
    expectedVersion: review.version,
    roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
    payload: { slotId: slot.id, decision: 'REWORK', subjectDigest: review.subjectDigest, comment: 'Needs revision: placeholder content detected.' },
  };
  const ticket = await qa.ticketFor(binding);
  await qa.call('POST', `/review-requests/${implReviewId}/decisions`, {
    body: {
      slotId: slot.id,
      decision: 'REWORK',
      expectedVersion: review.version,
      comment: 'Needs revision: placeholder content detected.',
      confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
    },
    idempotency: randomUUID(),
  });
});

// Owner requests rework if qa could not
await step('owner: request rework on IMPL review (if still open)', async () => {
  const review = await owner.call('GET', `/review-requests/${implReviewId}`);
  if (review.status !== 'OPEN') {
    process.stdout.write('    (review already decided; skipping)\n');
    return;
  }
  const slot = review.slots?.find((s) => !s.decided && s.viewerCanDecide);
  if (!slot) {
    process.stdout.write('    (owner has no open slot; skipping)\n');
    return;
  }
  const binding = {
    action: 'REVIEW_DECIDE',
    projectId: project.id,
    targetType: 'REVIEW_REQUEST',
    targetId: review.id,
    expectedVersion: review.version,
    roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
    payload: { slotId: slot.id, decision: 'REWORK', subjectDigest: review.subjectDigest, comment: 'Please revise implementation evidence.' },
  };
  const ticket = await owner.ticketFor(binding);
  await owner.call('POST', `/review-requests/${implReviewId}/decisions`, {
    body: {
      slotId: slot.id,
      decision: 'REWORK',
      expectedVersion: review.version,
      comment: 'Please revise implementation evidence.',
      confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
    },
    idempotency: randomUUID(),
  });
});

// 8. Dev: re-claim and re-deliver IMPL after rework
await step('dev: re-claim IMPL after rework', async () => {
  const task = await dev.call('GET', `/tasks/${implTask.id}`);
  if (task.executionStatus !== 'OPEN') fail('IMPL task not back to OPEN after rework', task);
  const claim = await dev.call('POST', `/tasks/${implTask.id}/claims`, {
    body: {},
    idempotency: randomUUID(),
  });
  implClaimId = claim.claimId ?? claim.task?.currentClaim?.id;
  if (!implClaimId) fail('no claimId after re-claim', claim);
  implTaskVersion = claim.task?.version;
});

await step('dev: rebuild context snapshot', async () => {
  const snap = await dev.call('POST', `/tasks/${implTask.id}/context-snapshots`, {
    body: { expectedVersion: implTaskVersion, claimId: implClaimId },
    idempotency: randomUUID(),
  });
  implSnapshotId = snap.id ?? snap.snapshot?.id;
  if (!implSnapshotId) fail('no snapshot id on re-claim', snap);
  const after = await dev.call('GET', `/tasks/${implTask.id}`);
  implTaskVersion = after.version;
});

await step('dev: re-deliver IMPL (after rework)', async () => {
  const bodyBytes = Buffer.from(
    `# Implementation (revised)\n\nRevised IMPL delivery at ${new Date().toISOString()}.\n\n` +
    `Addressed review feedback. All acceptance criteria met.\n`,
    'utf8',
  );
  const delivered = await dev.call('POST', `/tasks/${implTask.id}/artifact-sets`, {
    body: {
      expectedVersion: implTaskVersion,
      claimId: implClaimId,
      snapshotId: implSnapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: `sim-impl-rework-${stamp}`,
      candidateRevisionIds: [],
      items: [
        {
          kind: 'IMPL',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/markdown',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'),
          byteLength: bodyBytes.byteLength,
          bodyBase64: bodyBytes.toString('base64'),
          summary: 'Revised implementation delivery',
          checks: [{ code: 'sim-smoke', passed: true }],
        },
      ],
    },
    idempotency: randomUUID(),
  });
  implReviewId = delivered.reviewRequestId ?? delivered.review?.id;
  if (!implReviewId) fail('no reviewRequestId after re-deliver', delivered);
});

// 9. QA + owner: approve IMPL
await step('qa + owner: approve revised IMPL', async () => {
  for (const actor of [qa, owner]) {
    const review = await actor.call('GET', `/review-requests/${implReviewId}`);
    if (review.status === 'APPROVED') break;
    const slot = review.slots?.find((s) => !s.decided && s.viewerCanDecide);
    if (!slot) continue;
    const binding = {
      action: 'REVIEW_DECIDE',
      projectId: project.id,
      targetType: 'REVIEW_REQUEST',
      targetId: review.id,
      expectedVersion: review.version,
      roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
      payload: { slotId: slot.id, decision: 'APPROVE', subjectDigest: review.subjectDigest, comment: null },
    };
    const ticket = await actor.ticketFor(binding);
    await actor.call('POST', `/review-requests/${implReviewId}/decisions`, {
      body: {
        slotId: slot.id,
        decision: 'APPROVE',
        expectedVersion: review.version,
        comment: null,
        confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
      },
      idempotency: randomUUID(),
    });
  }
});

// 10. QA: claim CASES task → deliver → owner approves
let casesTask, casesClaimId, casesSnapshotId, casesReviewId, casesTaskVersion;

await step('qa: claim CASES task', async () => {
  const ready = await qa.call('GET', `/projects/${project.id}/tasks/ready?limit=20`);
  casesTask = ready.items?.find((t) => t.stepKey === 'cases');
  if (!casesTask) fail('no CASES task in ready queue', ready);
  const claim = await qa.call('POST', `/tasks/${casesTask.id}/claims`, {
    body: {},
    idempotency: randomUUID(),
  });
  casesClaimId = claim.claimId ?? claim.task?.currentClaim?.id;
  if (!casesClaimId) fail('no claimId for CASES', claim);
  casesTaskVersion = claim.task?.version;
});

await step('qa: build context snapshot for CASES', async () => {
  const snap = await qa.call('POST', `/tasks/${casesTask.id}/context-snapshots`, {
    body: { expectedVersion: casesTaskVersion, claimId: casesClaimId },
    idempotency: randomUUID(),
  });
  casesSnapshotId = snap.id ?? snap.snapshot?.id;
  if (!casesSnapshotId) fail('no snapshot id for CASES', snap);
  const after = await qa.call('GET', `/tasks/${casesTask.id}`);
  casesTaskVersion = after.version;
});

await step('qa: deliver CASES', async () => {
  const bodyBytes = Buffer.from(
    `# QA Acceptance Cases\n\nSimulated CASES delivery at ${new Date().toISOString()}.\n\n` +
    `## ac-first-run\n\n- Given the implementation is delivered\n- When QA reviews the evidence\n- Then the human approval persists after reload\n\n` +
    `**Result:** PASS\n`,
    'utf8',
  );
  const delivered = await qa.call('POST', `/tasks/${casesTask.id}/artifact-sets`, {
    body: {
      expectedVersion: casesTaskVersion,
      claimId: casesClaimId,
      snapshotId: casesSnapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: `sim-cases-${stamp}`,
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
          summary: 'Simulated QA acceptance cases',
          checks: [{ code: 'sim-smoke', passed: true }],
        },
      ],
    },
    idempotency: randomUUID(),
  });
  casesReviewId = delivered.reviewRequestId ?? delivered.review?.id;
  if (!casesReviewId) fail('no reviewRequestId for CASES', delivered);
});

await step('owner: approve CASES review', async () => {
  for (const actor of [owner, qa]) {
    const review = await actor.call('GET', `/review-requests/${casesReviewId}`);
    if (review.status === 'APPROVED') break;
    const slot = review.slots?.find((s) => !s.decided && s.viewerCanDecide);
    if (!slot) continue;
    const binding = {
      action: 'REVIEW_DECIDE',
      projectId: project.id,
      targetType: 'REVIEW_REQUEST',
      targetId: review.id,
      expectedVersion: review.version,
      roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
      payload: { slotId: slot.id, decision: 'APPROVE', subjectDigest: review.subjectDigest, comment: null },
    };
    const ticket = await actor.ticketFor(binding);
    await actor.call('POST', `/review-requests/${casesReviewId}/decisions`, {
      body: {
        slotId: slot.id,
        decision: 'APPROVE',
        expectedVersion: review.version,
        comment: null,
        confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
      },
      idempotency: randomUUID(),
    });
  }
});

// 11. Owner: claim RELEASE task → deliver → approve release
let releaseTask, releaseClaimId, releaseSnapshotId, releaseReviewId, releaseTaskVersion;

await step('owner: claim RELEASE task', async () => {
  const ready = await owner.call('GET', `/projects/${project.id}/tasks/ready?limit=20`);
  releaseTask = ready.items?.find((t) => t.stepKey === 'release');
  if (!releaseTask) fail('no RELEASE task in ready queue after IMPL+CASES done', ready);
  const claim = await owner.call('POST', `/tasks/${releaseTask.id}/claims`, {
    body: {},
    idempotency: randomUUID(),
  });
  releaseClaimId = claim.claimId ?? claim.task?.currentClaim?.id;
  if (!releaseClaimId) fail('no claimId for RELEASE', claim);
  releaseTaskVersion = claim.task?.version;
});

await step('owner: build context snapshot for RELEASE', async () => {
  const snap = await owner.call('POST', `/tasks/${releaseTask.id}/context-snapshots`, {
    body: { expectedVersion: releaseTaskVersion, claimId: releaseClaimId },
    idempotency: randomUUID(),
  });
  releaseSnapshotId = snap.id ?? snap.snapshot?.id;
  if (!releaseSnapshotId) fail('no snapshot id for RELEASE', snap);
  const after = await owner.call('GET', `/tasks/${releaseTask.id}`);
  releaseTaskVersion = after.version;
});

await step('owner: deliver RELEASE artifact', async () => {
  const bodyBytes = Buffer.from(
    `# Release Sign-off\n\nRelease delivery at ${new Date().toISOString()}.\n\n` +
    `All prerequisite tasks (IMPL + CASES) have been approved.\n` +
    `This release is authorized by the project owner.\n`,
    'utf8',
  );
  const delivered = await owner.call('POST', `/tasks/${releaseTask.id}/artifact-sets`, {
    body: {
      expectedVersion: releaseTaskVersion,
      claimId: releaseClaimId,
      snapshotId: releaseSnapshotId,
      workflowDefinitionRevisionId: published.definitionRevisionId,
      localRunId: `sim-release-${stamp}`,
      candidateRevisionIds: [],
      items: [
        {
          kind: 'RELEASE',
          schemaVersion: '1.0',
          storage: 'HOSTED',
          mediaType: 'text/markdown',
          sha256: createHash('sha256').update(bodyBytes).digest('hex'),
          byteLength: bodyBytes.byteLength,
          bodyBase64: bodyBytes.toString('base64'),
          summary: 'Simulated release sign-off',
          checks: [{ code: 'sim-smoke', passed: true }],
        },
      ],
    },
    idempotency: randomUUID(),
  });
  releaseReviewId = delivered.reviewRequestId ?? delivered.review?.id;
  if (!releaseReviewId) fail('no reviewRequestId for RELEASE', delivered);
});

await step('owner: approve RELEASE review', async () => {
  for (const actor of [owner, qa]) {
    const review = await actor.call('GET', `/review-requests/${releaseReviewId}`);
    if (review.status === 'APPROVED') break;
    const slot = review.slots?.find((s) => !s.decided && s.viewerCanDecide);
    if (!slot) continue;
    const binding = {
      action: 'REVIEW_DECIDE',
      projectId: project.id,
      targetType: 'REVIEW_REQUEST',
      targetId: review.id,
      expectedVersion: review.version,
      roleSlot: slot.requiredRoleId ? { roleId: slot.requiredRoleId, approvalSlotId: slot.id } : null,
      payload: { slotId: slot.id, decision: 'APPROVE', subjectDigest: review.subjectDigest, comment: null },
    };
    const ticket = await actor.ticketFor(binding);
    await owner.call('POST', `/review-requests/${releaseReviewId}/decisions`, {
      body: {
        slotId: slot.id,
        decision: 'APPROVE',
        expectedVersion: review.version,
        comment: null,
        confirmation: { ticketId: ticket.ticketId, ticketSecret: ticket.ticketSecret },
      },
      idempotency: randomUUID(),
    });
  }
});

// 12. Final verification
const finalState = await step('verify final state', async () => {
  const implFinal = await owner.call('GET', `/tasks/${implTask.id}`);
  const casesFinal = await owner.call('GET', `/tasks/${casesTask.id}`);
  const releaseFinal = await owner.call('GET', `/tasks/${releaseTask.id}`);
  const implReviewFinal = await owner.call('GET', `/review-requests/${implReviewId}`);
  const casesReviewFinal = await owner.call('GET', `/review-requests/${casesReviewId}`);
  const releaseReviewFinal = await owner.call('GET', `/review-requests/${releaseReviewId}`);

  const checks = [
    ['IMPL task DONE', implFinal.executionStatus === 'DONE'],
    ['CASES task DONE', casesFinal.executionStatus === 'DONE'],
    ['RELEASE task DONE', releaseFinal.executionStatus === 'DONE'],
    ['IMPL review APPROVED', implReviewFinal.status === 'APPROVED'],
    ['CASES review APPROVED', casesReviewFinal.status === 'APPROVED'],
    ['RELEASE review APPROVED', releaseReviewFinal.status === 'APPROVED'],
  ];
  for (const [label, ok] of checks) {
    if (!ok) fail(`Final check failed: ${label}`, { implFinal, casesFinal, releaseFinal });
  }
  return { implFinal, casesFinal, releaseFinal };
});

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const total = timeline.reduce((sum, t) => sum + t.ms, 0);

process.stdout.write('\n');
process.stdout.write(`RESULT: All 3 tasks (IMPL + CASES + RELEASE) DONE and APPROVED\n`);
process.stdout.write(`project ${project.id}  requirement ${requirement.code}\n`);
process.stdout.write(`sign in at ${ORIGIN} to inspect.\n\n`);
for (const t of timeline)
  process.stdout.write(`  ${String(t.ms).padStart(5)}ms  ${t.name}\n`);
process.stdout.write(`  ${String(total).padStart(5)}ms  TOTAL\n\n`);

process.stdout.write(`accounts:\n`);
process.stdout.write(`  owner    ${emailFor('owner')}\n`);
process.stdout.write(`  dev      ${emailFor('dev')}\n`);
process.stdout.write(`  qa       ${emailFor('qa')}\n`);
process.stdout.write(`  password ${PASSWORD}\n\n`);

// Write machine-readable result
const result = {
  schemaVersion: '1.0',
  simulatedAt: new Date().toISOString(),
  serverBase: BASE,
  projectId: project.id,
  projectKey: project.key,
  requirementCode: requirement.code,
  accounts: {
    owner: emailFor('owner'),
    dev: emailFor('dev'),
    qa: emailFor('qa'),
    password: PASSWORD,
  },
  reviews: {
    impl: implReviewId,
    cases: casesReviewId,
    release: releaseReviewId,
  },
  finalStatus: {
    implTask: finalState.implFinal.executionStatus,
    casesTask: finalState.casesFinal.executionStatus,
    releaseTask: finalState.releaseFinal.executionStatus,
  },
  timeline,
  totalMs: total,
  notCovered: [
    'CLI device authorization (requires browser)',
    'real code repository and commit evidence',
    'cross-platform installation',
    'production database migration',
    'change propagation after requirement update',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`result written to ${resultPath}\n`);
