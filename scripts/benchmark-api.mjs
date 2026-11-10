import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { assertEmptyDatabase, loadGeneratedClient } from './benchmark-revision-summary.mjs';
import { loadGuard, resolveTestDatabase } from './lib/test-database-guard.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const API_ENTRY = new URL('../apps/api/dist/app.module.js', import.meta.url);
const DATASETS = Object.freeze({
  small: Object.freeze({
    documents: 10,
    revisionsPerDocument: 3,
    requirements: 5,
    tasks: 5,
    reviews: 1,
    changes: 1,
  }),
  history: Object.freeze({
    documents: 100,
    revisionsPerDocument: 100,
    requirements: 50,
    tasks: 50,
    reviews: 1,
    changes: 1,
  }),
});
const DATABASE_NAME = /^workmesh_test_api_benchmark_[a-z0-9_]+$/;
const USAGE =
  'node scripts/benchmark-api.mjs [--dataset small|history] [--samples 20] [--concurrency 4] [--warmup 2]';
const SUITE = 'local-api-http-benchmark';
const BOARD_COLUMNS = ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'];

function fail(code) {
  const error = new Error(code);
  error.benchmarkCode = code;
  throw error;
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { dataset: 'small', samples: 20, concurrency: 4, warmup: 2 };
  const flags = {
    '--samples': ['samples', 4, 100],
    '--concurrency': ['concurrency', 2, 8],
    '--warmup': ['warmup', 1, 5],
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (seen.has(flag)) fail('INVALID_ARGUMENTS');
    if (flag === '--dataset') {
      if (!Object.hasOwn(DATASETS, args[i + 1] ?? '')) fail('INVALID_ARGUMENTS');
      seen.add(flag);
      options.dataset = args[i + 1];
      continue;
    }
    const spec = flags[flag];
    if (!spec || !/^\d+$/.test(args[i + 1] ?? '')) fail('INVALID_ARGUMENTS');
    seen.add(flag);
    const value = Number(args[i + 1]);
    if (!Number.isSafeInteger(value) || value < spec[1] || value > spec[2])
      fail('INVALID_ARGUMENTS');
    options[spec[0]] = value;
  }
  if (options.concurrency > options.samples) fail('CONCURRENCY_EXCEEDS_SAMPLES');
  return options;
}

export function assertDedicatedTarget(target, env = process.env) {
  if (target.env !== 'local' || !env.WORKMESH_TEST_DATABASE_USERS?.trim())
    fail('EXPLICIT_LOCAL_TEST_USER_REQUIRED');
  const allowedUsers = env.WORKMESH_TEST_DATABASE_USERS.split(',')
    .map((user) => user.trim())
    .filter(Boolean);
  if (!target.user || !allowedUsers.includes(target.user))
    fail('EXPLICIT_LOCAL_TEST_USER_REQUIRED');
  if (!DATABASE_NAME.test(target.database)) fail('DEDICATED_BENCHMARK_DATABASE_REQUIRED');
  if (env.WORKMESH_V1_DATABASE_URL === target.url) fail('TEST_DATABASE_IS_API_DATABASE');
  const url = new URL(target.url);
  // Additional connection parameters, including endpoint overrides, are not accepted.
  if ([...url.searchParams.keys()].some((key) => key !== 'schema') || url.hash)
    fail('DATABASE_CONNECTION_PARAMETERS_REFUSED');
  if (!['127.0.0.1', 'localhost', '::1'].includes(target.host)) fail('DATABASE_HOST_NOT_LOOPBACK');
}

export function assertLoopbackProbe(probe, target, guard) {
  const result = guard.evaluateIdentityProbe(probe, target);
  if (!result.ok) fail(result.rejection.code);
  const address = typeof probe.server_addr === 'string' ? probe.server_addr.toLowerCase() : '';
  const clientAddress =
    typeof probe.client_addr === 'string' ? probe.client_addr.toLowerCase() : '';
  const isLocalV4 = isIP(address) === 4 && address.startsWith('127.');
  const isLocalV6 = isIP(address) === 6 && (address === '::1' || address === '0:0:0:0:0:0:0:1');
  if (!isLocalV4 && !isLocalV6) fail('DATABASE_SERVER_NOT_LOOPBACK');
  const clientLocalV4 = isIP(clientAddress) === 4 && clientAddress.startsWith('127.');
  const clientLocalV6 =
    isIP(clientAddress) === 6 && (clientAddress === '::1' || clientAddress === '0:0:0:0:0:0:0:1');
  if (!clientLocalV4 && !clientLocalV6) fail('DATABASE_CLIENT_NOT_LOOPBACK');
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function assertNoBuiltinRolePackageRows(prisma) {
  const [versions, resources] = await Promise.all([
    prisma.rolePackageVersion.count(),
    prisma.rolePackageResource.count(),
  ]);
  if (versions !== 0 || resources !== 0) fail('UNEXPECTED_BUILTIN_ROLE_PACKAGE_ROWS');
  return { versions, resources };
}

export function createFixture(datasetName = 'small') {
  if (!Object.hasOwn(DATASETS, datasetName)) fail('INVALID_DATASET');
  const dataset = DATASETS[datasetName];
  const runId = randomUUID();
  const userId = randomUUID();
  const outsiderId = randomUUID();
  const sessionId = randomUUID();
  const outsiderSessionId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const outsiderSecret = randomBytes(32).toString('base64url');
  const projectId = randomUUID();
  const projectKey = `B${runId.replaceAll('-', '').slice(0, 5).toUpperCase()}`;
  const requirements = Array.from({ length: dataset.requirements }, (_, index) => ({
    id: randomUUID(),
    projectId,
    seq: index + 1,
    code: `${projectKey}-${index + 1}`,
    title: `Benchmark requirement ${index + 1}`,
  }));
  const roleId = randomUUID();
  const definitionId = randomUUID();
  const workflowRevisionId = randomUUID();
  const instances = requirements.map((requirement) => ({
    id: randomUUID(),
    projectId,
    definitionId,
    definitionRevisionId: workflowRevisionId,
    requirementId: requirement.id,
  }));
  const tasks = instances.map((instance) => ({
    id: randomUUID(),
    projectId,
    workflowInstanceId: instance.id,
    stepKey: 'work',
    roleId,
    responsibleUserId: userId,
  }));
  const knowledgeBaseId = randomUUID();
  const documents = Array.from({ length: dataset.documents }, (_, index) => ({
    id: randomUUID(),
    projectId,
    knowledgeBaseId,
    requirementId: requirements[index % requirements.length].id,
    kind: 'PRD',
    nextRevisionSeq: dataset.revisionsPerDocument + 1,
  }));
  const bodyBytes = Buffer.from('Local HTTP benchmark fixture body.');
  const revisions = documents.flatMap((document) =>
    Array.from({ length: dataset.revisionsPerDocument }, (_, index) => ({
      id: randomUUID(),
      projectId,
      documentId: document.id,
      seq: index + 1,
      title: `Benchmark revision ${index + 1}`,
      mimeType: 'text/plain',
      bodyBytes,
      byteLength: bodyBytes.length,
      sha256: digest(bodyBytes),
      createdById: userId,
    })),
  );
  const review = {
    id: randomUUID(),
    projectId,
    kind: 'KNOWLEDGE_PUBLICATION',
    documentRevisionId: revisions[0].id,
    subjectDigest: revisions[0].sha256,
  };
  const slot = {
    id: randomUUID(),
    projectId,
    reviewRequestId: review.id,
    slotKey: 'review',
    kind: 'KNOWLEDGE_PUBLICATION',
    requiredUserId: userId,
  };
  const change = {
    id: randomUUID(),
    projectId,
    requirementId: requirements[0].id,
    sourceKind: 'BENCHMARK',
    sourceId: randomUUID(),
    changedFields: ['title'],
    targets: {},
  };
  const recipient = { id: randomUUID(), projectId, eventId: change.id, userId };
  return {
    dataset: { name: datasetName, ...dataset },
    runId,
    userId,
    outsiderId,
    sessionId,
    outsiderSessionId,
    secret,
    outsiderSecret,
    projectId,
    projectKey,
    knowledgeBaseId,
    roleId,
    definitionId,
    workflowRevisionId,
    requirements,
    instances,
    tasks,
    documents,
    revisions,
    review,
    slot,
    change,
    recipient,
  };
}

export async function seedFixture(prisma, fixture) {
  const f = fixture;
  const expiresAt = new Date(Date.now() + 3_600_000);
  await prisma.$transaction(
    async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: f.userId,
            email: `api-benchmark-${f.runId}@workmesh.test`,
            passwordHash: 'fixture-no-login',
          },
          {
            id: f.outsiderId,
            email: `api-benchmark-outsider-${f.runId}@workmesh.test`,
            passwordHash: 'fixture-no-login',
          },
        ],
      });
      await tx.webSession.createMany({
        data: [
          {
            id: f.sessionId,
            userId: f.userId,
            tokenHash: digest(f.secret),
            csrfTokenHash: digest(`csrf-${f.secret}`),
            userAuthVersion: 1,
            idleExpiresAt: expiresAt,
            expiresAt,
          },
          {
            id: f.outsiderSessionId,
            userId: f.outsiderId,
            tokenHash: digest(f.outsiderSecret),
            csrfTokenHash: digest(`csrf-${f.outsiderSecret}`),
            userAuthVersion: 1,
            idleExpiresAt: expiresAt,
            expiresAt,
          },
        ],
      });
      await tx.project.create({
        data: { id: f.projectId, key: f.projectKey, name: 'HTTP benchmark', createdById: f.userId },
      });
      await tx.projectMember.create({
        data: { projectId: f.projectId, userId: f.userId, role: 'OWNER' },
      });
      await tx.projectRole.create({
        data: { id: f.roleId, projectId: f.projectId, key: 'worker', title: 'Worker' },
      });
      await tx.requirement.createMany({ data: f.requirements });
      await tx.knowledgeBase.create({
        data: {
          id: f.knowledgeBaseId,
          projectId: f.projectId,
          key: 'fixture',
          name: 'Benchmark',
          visibility: 'PROJECT',
          publicationApproverUserId: f.userId,
        },
      });
      await tx.knowledgeDocument.createMany({ data: f.documents });
      await tx.documentRevision.createMany({ data: f.revisions });
      await tx.workflowDefinition.create({
        data: { id: f.definitionId, projectId: f.projectId, workflowKey: 'fixture' },
      });
      await tx.workflowRevision.create({
        data: {
          id: f.workflowRevisionId,
          projectId: f.projectId,
          definitionId: f.definitionId,
          revision: 1,
          digest: digest('benchmark-workflow'),
          definition: {
            steps: [
              {
                key: 'work',
                kind: 'PRODUCT',
                baselinePolicy: 'NONE',
                deps: [],
                outputKinds: ['PRD'],
              },
            ],
          },
          compiledRules: {},
        },
      });
      await tx.workflowInstance.createMany({ data: f.instances });
      await tx.task.createMany({ data: f.tasks });
      await tx.reviewRequest.create({ data: f.review });
      await tx.approvalSlot.create({ data: f.slot });
      await tx.changeEvent.create({ data: f.change });
      await tx.changeRecipient.create({ data: f.recipient });
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
}

export async function cleanupFixture(prisma, f) {
  const ids = (rows) => rows.map((row) => row.id);
  const removed = await prisma.$transaction(
    async (tx) => {
      const counts = {};
      const remove = async (name, table, where) => {
        counts[name] = (await table.deleteMany({ where })).count;
      };
      await remove('recipients', tx.changeRecipient, {
        id: f.recipient.id,
        eventId: f.change.id,
        projectId: f.projectId,
        userId: f.userId,
      });
      await remove('changes', tx.changeEvent, {
        id: f.change.id,
        projectId: f.projectId,
        requirementId: f.requirements[0].id,
      });
      await remove('slots', tx.approvalSlot, {
        id: f.slot.id,
        projectId: f.projectId,
        reviewRequestId: f.review.id,
      });
      await remove('reviews', tx.reviewRequest, {
        id: f.review.id,
        projectId: f.projectId,
        documentRevisionId: f.review.documentRevisionId,
      });
      await remove('tasks', tx.task, {
        id: { in: ids(f.tasks) },
        projectId: f.projectId,
        workflowInstanceId: { in: ids(f.instances) },
      });
      await remove('instances', tx.workflowInstance, {
        id: { in: ids(f.instances) },
        projectId: f.projectId,
        definitionId: f.definitionId,
      });
      await remove('workflowRevisions', tx.workflowRevision, {
        id: f.workflowRevisionId,
        projectId: f.projectId,
        definitionId: f.definitionId,
      });
      await remove('definitions', tx.workflowDefinition, {
        id: f.definitionId,
        projectId: f.projectId,
      });
      await remove('revisions', tx.documentRevision, {
        id: { in: ids(f.revisions) },
        projectId: f.projectId,
        documentId: { in: ids(f.documents) },
      });
      await remove('documents', tx.knowledgeDocument, {
        id: { in: ids(f.documents) },
        projectId: f.projectId,
        knowledgeBaseId: f.knowledgeBaseId,
      });
      await remove('knowledgeBases', tx.knowledgeBase, {
        id: f.knowledgeBaseId,
        projectId: f.projectId,
        publicationApproverUserId: f.userId,
      });
      await remove('requirements', tx.requirement, {
        id: { in: ids(f.requirements) },
        projectId: f.projectId,
      });
      await remove('roles', tx.projectRole, { id: f.roleId, projectId: f.projectId });
      await remove('members', tx.projectMember, { projectId: f.projectId, userId: f.userId });
      await remove('projects', tx.project, { id: f.projectId, createdById: f.userId });
      await remove('sessions', tx.webSession, {
        OR: [
          { id: f.sessionId, userId: f.userId },
          { id: f.outsiderSessionId, userId: f.outsiderId },
        ],
      });
      await remove('users', tx.user, {
        OR: [
          { id: f.userId, email: `api-benchmark-${f.runId}@workmesh.test` },
          { id: f.outsiderId, email: `api-benchmark-outsider-${f.runId}@workmesh.test` },
        ],
      });
      assert.deepEqual(counts, {
        recipients: 1,
        changes: 1,
        slots: 1,
        reviews: 1,
        tasks: f.tasks.length,
        instances: f.instances.length,
        workflowRevisions: 1,
        definitions: 1,
        revisions: f.revisions.length,
        documents: f.documents.length,
        knowledgeBases: 1,
        requirements: f.requirements.length,
        roles: 1,
        members: 1,
        projects: 1,
        sessions: 2,
        users: 2,
      });
      return counts;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  return { status: 'REMOVED_EXACT_FIXTURE', removed };
}

export async function cleanupAndCheckDatabase(report, prisma, fixture) {
  try {
    report.cleanup = await cleanupFixture(prisma, fixture);
    report.bootstrapData.builtinRolePackages.afterCleanup =
      await assertNoBuiltinRolePackageRows(prisma);
    report.cleanup.emptyBusinessTablesChecked = await assertEmptyDatabase(prisma);
  } catch (error) {
    report.status = 'FAILED';
    report.cleanup = {
      ...report.cleanup,
      status: report.cleanup.status === 'REMOVED_EXACT_FIXTURE' ? 'POSTCHECK_FAILED' : 'FAILED',
      code: error?.benchmarkCode ?? 'EXACT_CLEANUP_OR_EMPTY_CHECK_FAILED',
      runId: fixture.runId,
      projectId: fixture.projectId,
    };
    report.failure ??= { stage: 'cleanup', code: 'EXACT_CLEANUP_OR_EMPTY_CHECK_FAILED' };
  }
}

export function endpoints(f) {
  return {
    documents: `/api/v1/projects/${f.projectId}/documents?limit=100`,
    board: `/api/v1/projects/${f.projectId}/board?limit=100`,
    requirement: `/api/v1/projects/${f.projectId}/requirements/${f.requirements[0].id}`,
    workbench: `/api/v1/workbench?projectId=${f.projectId}`,
  };
}

function sameIds(actual, expected) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

export function verifyResponse(name, body, f) {
  assert.ok(body && typeof body === 'object' && typeof body.meta?.requestId === 'string');
  const data = body.data;
  assert.ok(data && typeof data === 'object');
  if (name === 'documents') {
    assert.equal(data.nextCursor, null);
    sameIds(
      data.items.map((item) => item.document.id),
      f.documents.map((document) => document.id),
    );
    for (const item of data.items) {
      const expected = f.revisions.filter((revision) => revision.documentId === item.document.id);
      sameIds(
        item.revisions.map((revision) => revision.id),
        expected.map((revision) => revision.id),
      );
      assert.ok(item.revisions.every((revision) => !Object.hasOwn(revision, 'bodyBytes')));
    }
  } else if (name === 'board') {
    assert.equal(data.projectId, f.projectId);
    assert.equal(typeof data.queryKey, 'string');
    assert.deepEqual(data.summary, boardFixtureSummary(f));
    assert.deepEqual(
      data.columns.map((column) => column.key),
      BOARD_COLUMNS,
    );
    for (const column of data.columns) {
      assert.equal(column.total, column.key === 'BACKLOG' ? f.tasks.length : 0);
      assert.equal(column.nextCursor, null);
    }
    sameIds(
      data.columns.flatMap((column) => column.cards.map((card) => card.taskId)),
      f.tasks.map((task) => task.id),
    );
  } else if (name === 'requirement') {
    assert.equal(data.requirement.id, f.requirements[0].id);
    sameIds(
      data.tasks.map((task) => task.id),
      [f.tasks[0].id],
    );
    assert.ok(data.reviews.some((review) => review.id === f.review.id));
    assert.ok(data.changes.some((change) => change.id === f.change.id));
  } else if (name === 'workbench') {
    assert.deepEqual(data.warnings, []);
    sameIds(
      data.readyTasks.map((task) => task.taskId),
      f.tasks.map((task) => task.id),
    );
    assert.ok(data.reviews.some((review) => review.reviewId === f.review.id));
    assert.ok(data.changes.some((change) => change.eventId === f.change.id));
  } else fail('UNKNOWN_ENDPOINT');
}

export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (percent) => (sorted.length ? sorted[Math.ceil(sorted.length * percent) - 1] : null);
  return { p50Ms: at(0.5), p95Ms: at(0.95) };
}

async function request(port, path, cookie, signal) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let body;
  try {
    body = JSON.parse(bytes.toString('utf8'));
  } catch {
    body = null;
  }
  return { status: response.status, byteLength: bytes.byteLength, body };
}

export async function checkAuthorization(port, f, send = request) {
  const outsider = `wm_session=wm_s1.${f.outsiderSessionId}.${f.outsiderSecret}`;
  const projectBoard = `/api/v1/projects/${f.projectId}/board`;
  const paths = {
    ...endpoints(f),
    boardColumn: `${projectBoard}/columns/BACKLOG?limit=7`,
    boardRequirements: `${projectBoard}/requirements?limit=7`,
    boardRoles: `${projectBoard}/filters/roles?limit=7`,
    boardRequirementOptions: `${projectBoard}/filters/requirements?limit=7`,
  };
  for (const [name, path] of Object.entries(paths)) {
    const anonymous = await send(port, path);
    if (anonymous.status !== 401 || anonymous.body?.error?.code !== 'AUTH_REQUIRED')
      fail('ANONYMOUS_AUTHORIZATION_CHECK_FAILED');
    const nonmember = await send(port, path, outsider);
    if (name === 'workbench') {
      const data = nonmember.body?.data;
      if (
        nonmember.status !== 200 ||
        !data ||
        data.counts?.total !== 0 ||
        data.readyTasks?.length !== 0 ||
        data.reviews?.length !== 0 ||
        data.changes?.length !== 0 ||
        data.overdueApprovals?.length !== 0 ||
        data.warnings?.length !== 0
      )
        fail('NONMEMBER_AUTHORIZATION_CHECK_FAILED');
    } else if (nonmember.status !== 404 || nonmember.body?.error?.code !== 'RESOURCE_NOT_FOUND')
      fail('NONMEMBER_AUTHORIZATION_CHECK_FAILED');
  }
  return {
    requests: Object.keys(paths).length * 2,
    anonymous: '401 for all routes',
    nonmember: '404 project routes; scoped workbench empty',
  };
}

/** Correctness probes are outside the measured phases and use the real HTTP stack. */
function boardFixtureSummary(f) {
  return {
    total: f.tasks.length,
    matchedTotal: f.tasks.length,
    requirementTotal: f.requirements.length,
    columns: BOARD_COLUMNS.map((key) => ({ key, total: key === 'BACKLOG' ? f.tasks.length : 0 })),
  };
}

export async function verifyBoardPagination(port, f, send = request) {
  const root = `/api/v1/projects/${f.projectId}/board`;
  const cookie = `wm_session=wm_s1.${f.sessionId}.${f.secret}`;
  const limit = 7;
  let requests = 0;
  async function collect(path, key, check) {
    const collected = [];
    const cursors = new Set();
    let cursor = null;
    let queryKey;
    do {
      assert.ok(cursors.size < 64, 'Board pagination exceeded its bounded fixture budget');
      const result = await send(
        port,
        `${root}${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        cookie,
      );
      requests++;
      assert.equal(result.status, 200);
      assert.ok(typeof result.body?.meta?.requestId === 'string' && result.body.meta.requestId);
      const data = result.body.data;
      assert.ok(data && typeof data === 'object');
      assert.equal(data.projectId, f.projectId);
      assert.ok(typeof data.queryKey === 'string' && data.queryKey);
      queryKey ??= data.queryKey;
      assert.equal(data.queryKey, queryKey);
      assert.ok(Array.isArray(data[key]) && data[key].length <= limit);
      check(data);
      collected.push(...data[key]);
      cursor = data.nextCursor;
      if (cursor !== null) {
        assert.equal(typeof cursor, 'string');
        assert.ok(cursor.length > 0 && cursor.length <= 2048 && !cursors.has(cursor));
        assert.equal(data[key].length, limit);
        cursors.add(cursor);
      }
    } while (cursor !== null);
    return collected;
  }
  const cards = await collect('/columns/BACKLOG', 'cards', (data) => {
    assert.equal(data.key, 'BACKLOG');
    assert.equal(data.total, f.tasks.length);
  });
  assert.deepEqual(
    cards.map(({ taskId }) => taskId),
    f.tasks.map(({ id }) => id).sort(),
  );
  const groups = await collect('/requirements', 'items', (data) => {
    assert.deepEqual(data.summary, boardFixtureSummary(f));
    for (const item of data.items) {
      assert.equal(item.total, 1);
      assert.deepEqual(
        item.counts,
        Object.fromEntries(BOARD_COLUMNS.map((key) => [key, key === 'BACKLOG' ? 1 : 0])),
      );
      assert.deepEqual(item.roles, ['Worker']);
      assert.equal(item.roleTotal, 1);
      assert.equal(item.rolesNextCursor, null);
    }
  });
  const expectedCodes = f.requirements.map(({ code }) => code).sort();
  assert.deepEqual(
    groups.map(({ code }) => code),
    expectedCodes,
  );
  assert.deepEqual(
    groups.map(({ title }) => title),
    expectedCodes.map(
      (code) => f.requirements.find((requirement) => requirement.code === code).title,
    ),
  );
  const roles = await collect('/filters/roles', 'items', (data) => assert.equal(data.total, 1));
  assert.deepEqual(roles, [{ value: 'Worker', label: 'Worker' }]);
  const requirements = await collect('/filters/requirements', 'items', (data) =>
    assert.equal(data.total, f.requirements.length),
  );
  assert.deepEqual(
    requirements,
    expectedCodes.map((code) => ({
      value: code,
      label: `${code} · ${f.requirements.find((requirement) => requirement.code === code).title}`,
    })),
  );
  return {
    status: 'PASS',
    requests,
    pageSize: limit,
    taskIdsCheckedInOrder: cards.length,
    requirementGroupsCheckedInOrder: groups.length,
    roleOptionsChecked: roles.length,
    requirementOptionsCheckedInOrder: requirements.length,
    includedInLatencySamples: false,
  };
}

export async function measureEndpoint(port, path, name, f, options, concurrency, send = request) {
  const cookie = `wm_session=wm_s1.${f.sessionId}.${f.secret}`;
  const elapsed = [];
  const statuses = {};
  const deadline = AbortSignal.timeout(45_000);
  let errors = 0;
  let attempted = 0;
  let responseBytes = 0;
  async function one(measured) {
    const start = performance.now();
    let result;
    try {
      result = await send(port, path, cookie, deadline);
      const duration = performance.now() - start;
      if (measured) {
        elapsed.push(duration);
        statuses[result.status] = (statuses[result.status] ?? 0) + 1;
        responseBytes += result.byteLength;
      }
      if (result.status !== 200) throw new Error('HTTP_STATUS');
      verifyResponse(name, result.body, f);
    } catch {
      if (measured) {
        if (!result) statuses.transport = (statuses.transport ?? 0) + 1;
        errors++;
      } else fail('WARMUP_OR_CORRECTNESS_FAILED');
    }
  }
  for (let i = 0; i < options.warmup; i++) await one(false);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < options.samples && !deadline.aborted) {
        next++;
        attempted++;
        await one(true);
      }
    }),
  );
  return {
    plannedRequests: options.samples,
    requests: attempted,
    notAttempted: options.samples - attempted,
    concurrency,
    errors,
    deadlineExceeded: deadline.aborted,
    statuses,
    responseBytes,
    latency: summarize(elapsed),
    latencySamples: elapsed.length,
  };
}

export function cleanChildEnv(databaseUrl, envSource = process.env) {
  const env = {};
  for (const key of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'])
    if (envSource[key]) env[key] = envSource[key];
  return {
    ...env,
    NODE_ENV: 'test',
    WORKMESH_RETENTION_DISABLED: '1',
    WORKMESH_SEED_BUILTIN_ROLE_PACKAGES: 'false',
    WORKMESH_COOKIE_MODE: 'LOCAL_INSECURE',
    WORKMESH_PUBLIC_ORIGIN: 'http://127.0.0.1',
    WORKMESH_V1_DATABASE_URL: databaseUrl,
  };
}

// Measured endpoints need only Prisma's native local database connection.
// Forbid Node outbound connections, including integration HTTP/fetch clients.
function disableChildOutboundNetwork() {
  const refuse = () => fail('CHILD_OUTBOUND_NETWORK_REFUSED');
  globalThis.fetch = refuse;
  http.request = refuse;
  http.get = refuse;
  https.request = refuse;
  https.get = refuse;
  net.Socket.prototype.connect = refuse;
  syncBuiltinESMExports();
}

async function childMain() {
  if (!process.send || process.env.NODE_ENV !== 'test' || !process.env.WORKMESH_V1_DATABASE_URL)
    fail('INVALID_CHILD_CONTEXT');
  let closing = false;
  // Cover parent loss during asynchronous application startup as well as measurement.
  process.on('disconnect', () => {
    if (!closing) process.exit(2);
  });
  disableChildOutboundNetwork();
  const require = createRequire(API_ENTRY);
  require('reflect-metadata');
  const { NestFactory } = require('@nestjs/core');
  const { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require(fileURLToPath(API_ENTRY));
  const app = await NestFactory.create(AppModule, {
    logger: false,
    rawBody: true,
    abortOnError: false,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1')
    fail('INVALID_CHILD_LISTENER');
  process.send({ type: 'ready', port: address.port, rssBytes: process.memoryUsage().rss });
  process.on('message', (message) => {
    if (message?.type === 'rss')
      process.send?.({ type: 'rss', rssBytes: process.memoryUsage().rss });
    if (message?.type === 'stop' && !closing) {
      closing = true;
      void app
        .close()
        .then(() => {
          process.send?.({ type: 'closed' }, () => process.disconnect());
        })
        .catch(() => process.exit(1));
    }
  });
}

function startChild(databaseUrl) {
  const child = fork(SCRIPT, ['--benchmark-child'], {
    execArgv: [],
    env: cleanChildEnv(databaseUrl),
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  const rss = [];
  let closed = false;
  let settled = false;
  const readyPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('CHILD_START_TIMEOUT'));
      }
    }, 30_000);
    child.on('message', (message) => {
      if (Number.isSafeInteger(message?.rssBytes) && message.rssBytes > 0)
        rss.push(message.rssBytes);
      if (
        message?.type === 'ready' &&
        !settled &&
        Number.isInteger(message.port) &&
        message.port > 0 &&
        message.port <= 65535
      ) {
        settled = true;
        clearTimeout(timer);
        resolve(message.port);
      }
      if (message?.type === 'closed') closed = true;
    });
    child.once('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('CHILD_START_FAILED'));
      }
    });
    child.once('exit', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error('CHILD_START_FAILED'));
      }
    });
  });
  const sample = () => {
    if (child.connected) child.send({ type: 'rss' }, () => {});
  };
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null)
      return { stopped: true, graceful: closed };
    const exited = new Promise((resolve) =>
      child.once('exit', (code) => resolve({ stopped: true, graceful: closed && code === 0 })),
    );
    if (child.connected) child.send({ type: 'stop' }, () => {});
    let killTimer;
    let deadlineTimer;
    const deadline = new Promise((resolve) => {
      killTimer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      deadlineTimer = setTimeout(() => resolve({ stopped: false, graceful: false }), 15_000);
    });
    const result = await Promise.race([exited, deadline]);
    clearTimeout(killTimer);
    clearTimeout(deadlineTimer);
    return result;
  };
  return { readyPromise, sample, stop, rss };
}

export async function main(args) {
  const report = {
    suite: SUITE,
    status: 'FAILED',
    startedAt: new Date().toISOString(),
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    cleanup: { status: 'NOT_SEEDED' },
  };
  let prisma;
  let fixture;
  let child;
  let seeded = false;
  let stage = 'arguments';
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 20 || (major === 20 && minor < 19)) fail('NODE_20_19_OR_NEWER_REQUIRED');
    report.options = options;
    stage = 'test-database-guard';
    const gate = await resolveTestDatabase();
    if (!gate.ok) fail(gate.rejection.code);
    assertDedicatedTarget(gate.target);
    const { host, port, database, schema, env } = gate.describe;
    report.databaseTarget = { host, port, database, schema, env };
    stage = 'implementation-fingerprint';
    report.implementation = {
      bootstrap:
        'Built AppModule with real guards, services, Prisma and interceptors; benchmark-specific loopback transport',
      files: [
        'app.module',
        'knowledge/v1-publication.service',
        'knowledge/v1-publication.prisma-repository',
        'tasks/v1-board.prisma-repository',
        'tasks/v1-board.service',
        'tasks/v1-board.controller',
        'tasks/v1-board.pagination',
        'projects/requirements.service',
        'workbench/v1-workbench.service',
      ].map((name) => ({
        path: name,
        builtSha256: digest(readFileSync(new URL(`../apps/api/dist/${name}.js`, import.meta.url))),
        sourceSha256: digest(readFileSync(new URL(`../apps/api/src/${name}.ts`, import.meta.url))),
      })),
      buildCorrespondence:
        'Source and built fingerprints are recorded separately; rebuild API before running',
    };
    const { PrismaClient } = loadGeneratedClient();
    prisma = new PrismaClient({ datasources: { db: { url: gate.target.url } }, log: [] });
    const guard = await loadGuard();
    stage = 'database-identity-probe';
    const sql = guard.TEST_DATABASE_IDENTITY_PROBE_SQL.replace(
      'inet_server_addr() as server_addr',
      'host(inet_server_addr()) as server_addr, host(inet_client_addr()) as client_addr',
    );
    if (sql === guard.TEST_DATABASE_IDENTITY_PROBE_SQL) fail('DATABASE_PROBE_FORMAT_UNSUPPORTED');
    const probes = await prisma.$queryRawUnsafe(sql);
    assertLoopbackProbe(probes[0] ?? {}, gate.target, guard);
    report.runtime.postgresql = (
      await prisma.$queryRawUnsafe("SELECT current_setting('server_version') AS version")
    )[0]?.version;
    stage = 'empty-business-database-check';
    report.emptyBusinessTablesChecked = await assertEmptyDatabase(prisma);
    report.bootstrapData = {
      builtinRolePackages: {
        policy: 'DISABLED_BY_EXISTING_APPLICATION_SWITCH',
        environment: { WORKMESH_SEED_BUILTIN_ROLE_PACKAGES: 'false' },
        expectedRows: { versions: 0, resources: 0 },
        beforeStartup: await assertNoBuiltinRolePackageRows(prisma),
      },
    };
    fixture = createFixture(options.dataset);
    report.fixture = {
      runId: fixture.runId,
      projectId: fixture.projectId,
      ...fixture.dataset,
      revisions: fixture.revisions.length,
      logicalBodyBytes: fixture.revisions.reduce((sum, revision) => sum + revision.byteLength, 0),
      sessions: 2,
    };
    stage = 'seed-fixture';
    await seedFixture(prisma, fixture);
    seeded = true;
    stage = 'start-application';
    child = startChild(gate.target.url);
    const apiPort = await child.readyPromise;
    stage = 'verify-bootstrap-data';
    report.bootstrapData.builtinRolePackages.afterStartup =
      await assertNoBuiltinRolePackageRows(prisma);
    stage = 'authorization-check';
    report.authorization = await checkAuthorization(apiPort, fixture);
    stage = 'board-pagination-correctness';
    report.boardPagination = await verifyBoardPagination(apiPort, fixture);
    report.results = {};
    let failures = 0;
    for (const [name, path] of Object.entries(endpoints(fixture))) {
      stage = `measure-${name}`;
      child.sample();
      const serial = await measureEndpoint(apiPort, path, name, fixture, options, 1);
      child.sample();
      const concurrent = await measureEndpoint(
        apiPort,
        path,
        name,
        fixture,
        options,
        options.concurrency,
      );
      child.sample();
      report.results[name] = { serial, concurrent };
      failures += serial.errors + concurrent.errors + serial.notAttempted + concurrent.notAttempted;
    }
    report.measurement = {
      method:
        'HTTP GET through loopback; elapsed time through full response-body read and JSON parse, excluding fixture assertion; nearest-rank percentiles over completed responses, errors counted separately',
      excludes:
        'main.ts IP limiter, TLS, proxy, external integrations, public write workflow, production capacity and SLA',
    };
    if (failures) fail('MEASURED_REQUEST_FAILURES');
    report.status = 'PASS';
  } catch (error) {
    report.failure = { stage, code: error?.benchmarkCode ?? 'BENCHMARK_FAILED' };
  } finally {
    if (child) {
      try {
        child.sample();
        report.childShutdown = await child.stop();
        report.childRss = {
          samples: child.rss.length,
          maxObservedBytes: child.rss.length ? Math.max(...child.rss) : null,
          method:
            'process.memoryUsage().rss sampled at child start and between measurement phases; not a peak or whole-system measurement',
        };
        if (!report.childShutdown.graceful) {
          report.status = 'FAILED';
          report.failure ??= { stage: 'stop-application', code: 'CHILD_DID_NOT_CLOSE_GRACEFULLY' };
        }
      } catch {
        report.status = 'FAILED';
        report.failure ??= { stage: 'stop-application', code: 'CHILD_STOP_FAILED' };
      }
    }
    if (seeded && (!child || report.childShutdown?.stopped)) {
      await cleanupAndCheckDatabase(report, prisma, fixture);
    } else if (seeded) {
      report.status = 'FAILED';
      report.cleanup = {
        status: 'SKIPPED_CHILD_NOT_CONFIRMED_STOPPED',
        runId: fixture.runId,
        projectId: fixture.projectId,
      };
    }
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        report.status = 'FAILED';
        report.failure ??= { stage: 'disconnect', code: 'DATABASE_DISCONNECT_FAILED' };
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report.status === 'PASS' ? 0 : 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv[2] === '--benchmark-child') {
    childMain().catch(() => process.exit(2));
  } else {
    main(process.argv.slice(2))
      .then((code) => {
        process.exitCode = code;
      })
      .catch(() => {
        process.exitCode = 2;
      });
  }
}
