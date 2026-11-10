import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Script } from 'node:vm';
import ts from 'typescript';
import {
  assertDedicatedTarget,
  assertLoopbackProbe,
  assertNoBuiltinRolePackageRows,
  checkAuthorization,
  cleanChildEnv,
  cleanupAndCheckDatabase,
  cleanupFixture,
  createFixture,
  endpoints,
  measureEndpoint,
  parseArguments,
  seedFixture,
  summarize,
  verifyBoardPagination,
  verifyResponse,
} from './benchmark-api.mjs';

function loadBootstrapFromSource(env) {
  const source = new URL(
    '../apps/api/src/workflows/v1-role-package-builtin.seeder.ts',
    import.meta.url,
  );
  const { outputText, diagnostics } = ts.transpileModule(readFileSync(source, 'utf8'), {
    fileName: fileURLToPath(source),
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
    reportDiagnostics: true,
  });
  assert.deepEqual(
    diagnostics.filter(({ category }) => category === ts.DiagnosticCategory.Error),
    [],
  );
  const dependencies = {
    '@nestjs/common': {
      Injectable: () => (target) => target,
      Logger: class {
        log() {}
      },
    },
    '@workmesh/shared': {},
    '@workmesh/role-packages': { BUILTIN_ROLE_PACKAGES: [] },
    '../prisma/prisma.service': { PrismaService: class {} },
    '../../../node_modules/.prisma/workmesh-v1-client': { Prisma: {} },
  };
  const exports = {};
  new Script(outputText, { filename: fileURLToPath(source) }).runInNewContext({
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected bootstrap dependency: ${name}`);
      return dependencies[name];
    },
    process: { env },
  });
  return exports.V1BuiltinRolePackageSeeder;
}

function responseOf(name, f) {
  const data = {
    documents: {
      nextCursor: null,
      items: f.documents.map((document) => ({
        document,
        revisions: f.revisions
          .filter((revision) => revision.documentId === document.id)
          .map(({ id, seq }) => ({ id, seq })),
      })),
    },
    board: {
      projectId: f.projectId,
      queryKey: 'fixture-query',
      summary: {
        total: f.tasks.length,
        matchedTotal: f.tasks.length,
        requirementTotal: f.requirements.length,
        columns: ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'].map(
          (key) => ({
            key,
            total: key === 'BACKLOG' ? f.tasks.length : 0,
          }),
        ),
      },
      columns: ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'].map((key) => ({
        key,
        total: key === 'BACKLOG' ? f.tasks.length : 0,
        cards: key === 'BACKLOG' ? f.tasks.map((task) => ({ taskId: task.id })) : [],
        nextCursor: null,
      })),
    },
    requirement: {
      requirement: f.requirements[0],
      tasks: [f.tasks[0]],
      reviews: [f.review],
      changes: [f.change],
    },
    workbench: {
      warnings: [],
      readyTasks: f.tasks.map((task) => ({ taskId: task.id })),
      reviews: [{ reviewId: f.review.id }],
      changes: [{ eventId: f.change.id }],
    },
  }[name];
  return { data, meta: { requestId: 'fixture-request-id' } };
}

function boardPageServer(f, mutate = () => {}) {
  const columns = ['BACKLOG', 'ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED', 'DELIVERED'];
  const counts = Object.fromEntries(columns.map((key) => [key, key === 'BACKLOG' ? 1 : 0]));
  const requirements = [...f.requirements].sort((a, b) => (a.code < b.code ? -1 : 1));
  const routes = {
    '/columns/BACKLOG': {
      key: 'BACKLOG',
      total: f.tasks.length,
      cards: f.tasks
        .map(({ id }) => ({ taskId: id }))
        .sort((a, b) => (a.taskId < b.taskId ? -1 : 1)),
    },
    '/requirements': {
      summary: responseOf('board', f).data.summary,
      items: requirements.map(({ code, title }) => ({
        code,
        title,
        total: 1,
        counts,
        roles: ['Worker'],
        roleTotal: 1,
        rolesNextCursor: null,
      })),
    },
    '/filters/roles': { total: 1, items: [{ value: 'Worker', label: 'Worker' }] },
    '/filters/requirements': {
      total: requirements.length,
      items: requirements.map(({ code, title }) => ({ value: code, label: `${code} · ${title}` })),
    },
  };
  const calls = [];
  const send = async (port, path, cookie) => {
    assert.equal(port, 12345);
    assert.equal(cookie, `wm_session=wm_s1.${f.sessionId}.${f.secret}`);
    const url = new URL(path, 'http://127.0.0.1:12345');
    const prefix = `/api/v1/projects/${f.projectId}/board`;
    assert.ok(url.pathname.startsWith(prefix));
    const route = url.pathname.slice(prefix.length);
    assert.ok(Object.hasOwn(routes, route), `Unexpected route ${route}`);
    assert.deepEqual(
      [...url.searchParams.keys()].sort(),
      url.searchParams.has('cursor') ? ['cursor', 'limit'] : ['limit'],
    );
    assert.equal(url.searchParams.get('limit'), '7');
    const offset = url.searchParams.has('cursor')
      ? Number(Buffer.from(url.searchParams.get('cursor'), 'base64url').toString())
      : 0;
    assert.ok(Number.isSafeInteger(offset) && offset >= 0);
    calls.push({ route, offset });
    const source = globalThis.structuredClone(routes[route]);
    const key = route.startsWith('/columns/') ? 'cards' : 'items';
    const data = {
      ...source,
      projectId: f.projectId,
      queryKey: `fixture-${route}`,
      [key]: source[key].slice(offset, offset + 7),
      nextCursor:
        offset + 7 < source[key].length
          ? Buffer.from(String(offset + 7)).toString('base64url')
          : null,
    };
    const result = { status: 200, body: { data, meta: { requestId: `page-${calls.length}` } } };
    mutate({ route, offset, result, data, key, source });
    return result;
  };
  return { calls, send };
}

test('bounded arguments keep the API workload small', () => {
  assert.deepEqual(parseArguments([]), {
    dataset: 'small',
    samples: 20,
    concurrency: 4,
    warmup: 2,
  });
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.deepEqual(parseArguments(['--samples', '4', '--concurrency', '2', '--warmup', '1']), {
    dataset: 'small',
    samples: 4,
    concurrency: 2,
    warmup: 1,
  });
  assert.deepEqual(
    parseArguments(['--dataset', 'history', '--samples', '20', '--concurrency', '8']),
    { dataset: 'history', samples: 20, concurrency: 8, warmup: 2 },
  );
  for (const args of [
    ['--samples', '0'],
    ['--samples', '101'],
    ['--samples', '4', '--concurrency', '8'],
    ['--concurrency', '1'],
    ['--warmup', '0'],
    ['--samples', '10', '--samples', '20'],
    ['--samples', '1e2'],
    ['--skip-guard'],
    ['--benchmark-child'],
    ['--dataset'],
    ['--dataset', 'production'],
    ['--dataset', '__proto__'],
    ['--dataset', 'history', '--dataset', 'small'],
  ])
    assert.throws(() => parseArguments(args));
});

test('only the explicit local dedicated database with no endpoint override is accepted', () => {
  const target = {
    env: 'local',
    database: 'workmesh_test_api_benchmark_unit',
    host: '127.0.0.1',
    user: 'bench',
    url: 'postgresql://bench@127.0.0.1:5432/workmesh_test_api_benchmark_unit?schema=workmesh_v1',
  };
  const env = { WORKMESH_TEST_DATABASE_USERS: 'bench' };
  assert.doesNotThrow(() => assertDedicatedTarget(target, env));
  for (const changed of [
    { env: 'ci' },
    { database: 'workmesh_test_existing' },
    { host: 'db.example' },
    { url: `${target.url}&host=db.example` },
  ])
    assert.throws(() => assertDedicatedTarget({ ...target, ...changed }, env));
  assert.throws(() => assertDedicatedTarget(target, {}), /EXPLICIT_LOCAL_TEST_USER_REQUIRED/);
  assert.throws(
    () => assertDedicatedTarget(target, { WORKMESH_TEST_DATABASE_USERS: ' , ' }),
    /EXPLICIT_LOCAL_TEST_USER_REQUIRED/,
  );
  assert.throws(
    () => assertDedicatedTarget(target, { ...env, WORKMESH_V1_DATABASE_URL: target.url }),
    /TEST_DATABASE_IS_API_DATABASE/,
  );
});

test('identity check additionally requires the actual server address to be loopback', () => {
  const guard = { evaluateIdentityProbe: () => ({ ok: true }) };
  for (const address of ['127.0.0.1', '127.12.0.9', '::1', '0:0:0:0:0:0:0:1'])
    assert.doesNotThrow(() =>
      assertLoopbackProbe({ server_addr: address, client_addr: '127.0.0.1' }, {}, guard),
    );
  for (const address of ['192.0.2.1', '127.evil', '127.0.0.1/32', null, '::ffff:192.0.2.1'])
    assert.throws(
      () => assertLoopbackProbe({ server_addr: address }, {}, guard),
      /DATABASE_SERVER_NOT_LOOPBACK/,
    );
  assert.throws(
    () => assertLoopbackProbe({ server_addr: '127.0.0.1', client_addr: '192.0.2.1' }, {}, guard),
    /DATABASE_CLIENT_NOT_LOOPBACK/,
  );
  assert.throws(
    () =>
      assertLoopbackProbe(
        { server_addr: '127.0.0.1' },
        {},
        {
          evaluateIdentityProbe: () => ({
            ok: false,
            rejection: { code: 'TEST_DATABASE_PROBE_MISMATCH' },
          }),
        },
      ),
    /TEST_DATABASE_PROBE_MISMATCH/,
  );
});

test('child environment does not inherit credentials, external endpoints or Node preloads', () => {
  const env = cleanChildEnv('postgresql://fixture', {
    PATH: 'node-path',
    SystemRoot: 'windows',
    GITHUB_TOKEN: 'canary',
    OPENAI_API_KEY: 'canary',
    DATABASE_URL: 'canary',
    WORKMESH_GITHUB_API_URL: 'https://canary.invalid',
    NODE_OPTIONS: '--require canary',
    HTTP_PROXY: 'canary',
  });
  assert.equal(env.PATH, 'node-path');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.WORKMESH_RETENTION_DISABLED, '1');
  assert.equal(env.WORKMESH_SEED_BUILTIN_ROLE_PACKAGES, 'false');
  assert.equal(env.WORKMESH_V1_DATABASE_URL, 'postgresql://fixture');
  assert.ok(!JSON.stringify(env).includes('canary'));
});

test('application bootstrap source honors the existing switch without API build artifacts', async () => {
  const childEnv = cleanChildEnv('postgresql://fixture', {
    WORKMESH_SEED_BUILTIN_ROLE_PACKAGES: 'true',
  });
  const V1BuiltinRolePackageSeeder = loadBootstrapFromSource(childEnv);
  const sentinel = new Error('Unexpected bootstrap database access');
  let databaseAccess = false;
  const prisma = new Proxy(
    {},
    {
      get() {
        databaseAccess = true;
        throw sentinel;
      },
    },
  );
  await new V1BuiltinRolePackageSeeder(prisma).onApplicationBootstrap();
  assert.equal(databaseAccess, false);
  for (const enabled of ['true', undefined]) {
    if (enabled === undefined) delete childEnv.WORKMESH_SEED_BUILTIN_ROLE_PACKAGES;
    else childEnv.WORKMESH_SEED_BUILTIN_ROLE_PACKAGES = enabled;
    databaseAccess = false;
    await assert.rejects(
      new V1BuiltinRolePackageSeeder(prisma).onApplicationBootstrap(),
      (error) => error === sentinel,
    );
    assert.equal(databaseAccess, true);
  }
  delete childEnv.WORKMESH_V1_DATABASE_URL;
  databaseAccess = false;
  await new V1BuiltinRolePackageSeeder(prisma).onApplicationBootstrap();
  assert.equal(databaseAccess, false);
});

test('bootstrap data verification rejects residual rows in either role-package table', async () => {
  const prisma = (versions, resources) => ({
    rolePackageVersion: { count: async () => versions },
    rolePackageResource: { count: async () => resources },
  });
  assert.deepEqual(await assertNoBuiltinRolePackageRows(prisma(0, 0)), {
    versions: 0,
    resources: 0,
  });
  for (const counts of [
    [6, 55],
    [1, 0],
    [0, 1],
  ]) {
    await assert.rejects(
      assertNoBuiltinRolePackageRows(prisma(...counts)),
      /UNEXPECTED_BUILTIN_ROLE_PACKAGE_ROWS/,
    );
  }
});

test('fixture is fixed, isolated, and seeds atomically using real session hashes', async () => {
  const f = createFixture();
  const another = createFixture();
  assert.notEqual(f.projectId, another.projectId);
  assert.equal(f.documents.length, 10);
  assert.equal(f.revisions.length, 30);
  assert.equal(f.tasks.length, 5);
  assert.equal(f.secret.length, 43);
  const calls = [];
  let transactionCount = 0;
  const tx = new Proxy(
    {},
    {
      get: (_, table) => ({
        create: async (query) => {
          calls.push({ table, ...query });
        },
        createMany: async (query) => {
          calls.push({ table, ...query });
        },
      }),
    },
  );
  await seedFixture(
    {
      $transaction: async (callback, options) => {
        transactionCount++;
        assert.equal(options.timeout, 30_000);
        return callback(tx);
      },
    },
    f,
  );
  assert.equal(transactionCount, 1);
  const sessions = calls.find((call) => call.table === 'webSession').data;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].tokenHash.length, 64);
  assert.ok(!JSON.stringify(calls).includes(f.secret));
  assert.ok(calls.every((call) => call.data));
});

test('history fixture is bounded, owns every row, and fits the existing 50-task workbench preview', () => {
  const f = createFixture('history');
  assert.deepEqual(f.dataset, {
    name: 'history',
    documents: 100,
    revisionsPerDocument: 100,
    requirements: 50,
    tasks: 50,
    reviews: 1,
    changes: 1,
  });
  assert.equal(f.revisions.length, 10_000);
  assert.equal(new Set(f.revisions.map(({ id }) => id)).size, 10_000);
  assert.equal(f.tasks.length, 50);
  assert.deepEqual(
    f.instances.map(({ requirementId }) => requirementId),
    f.requirements.map(({ id }) => id),
  );
  assert.deepEqual(
    f.tasks.map(({ workflowInstanceId }) => workflowInstanceId),
    f.instances.map(({ id }) => id),
  );
  for (const document of f.documents) {
    const revisions = f.revisions.filter(({ documentId }) => documentId === document.id);
    assert.equal(revisions.length, 100);
    assert.deepEqual(
      revisions.map(({ seq }) => seq),
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    assert.ok(revisions.every((revision) => revision.projectId === f.projectId));
    assert.ok(f.requirements.some(({ id }) => id === document.requirementId));
  }
  assert.ok(Object.values(endpoints(f)).every((path) => path.includes(f.projectId)));
  assert.throws(() => createFixture('production'), /INVALID_DATASET/);
  assert.throws(() => createFixture('__proto__'), /INVALID_DATASET/);
});

const expectedCounts = {
  changeRecipient: 1,
  changeEvent: 1,
  approvalSlot: 1,
  reviewRequest: 1,
  task: 5,
  workflowInstance: 5,
  workflowRevision: 1,
  workflowDefinition: 1,
  documentRevision: 30,
  knowledgeDocument: 10,
  knowledgeBase: 1,
  requirement: 5,
  projectRole: 1,
  projectMember: 1,
  project: 1,
  webSession: 2,
  user: 2,
};
const expectedRemoved = {
  recipients: 1,
  changes: 1,
  slots: 1,
  reviews: 1,
  tasks: 5,
  instances: 5,
  workflowRevisions: 1,
  definitions: 1,
  revisions: 30,
  documents: 10,
  knowledgeBases: 1,
  requirements: 5,
  roles: 1,
  members: 1,
  projects: 1,
  sessions: 2,
  users: 2,
};

function cleanupPrisma({
  versions = 0,
  resources = 0,
  occupied = false,
  counts = expectedCounts,
} = {}) {
  const tx = new Proxy(
    {},
    {
      get: (_, table) => ({ deleteMany: async () => ({ count: counts[table] }) }),
    },
  );
  return {
    $transaction: async (callback) => callback(tx),
    rolePackageVersion: { count: async () => versions },
    rolePackageResource: { count: async () => resources },
    $queryRawUnsafe: async (sql) =>
      sql.includes('information_schema.tables')
        ? ['RolePackageVersion', 'RolePackageResource', 'Task'].map((table_name) => ({
            table_name,
          }))
        : [{ occupied }],
  };
}

function cleanupReport() {
  return {
    status: 'PASS',
    cleanup: { status: 'NOT_SEEDED' },
    bootstrapData: { builtinRolePackages: {} },
  };
}

test('cleanup predicates contain only exact fixture IDs and ownership checks', async () => {
  const f = createFixture();
  const calls = [];
  const tx = new Proxy(
    {},
    {
      get: (_, table) => ({
        deleteMany: async ({ where }) => {
          calls.push({ table, where });
          return { count: expectedCounts[table] };
        },
      }),
    },
  );
  const result = await cleanupFixture({ $transaction: async (callback) => callback(tx) }, f);
  assert.equal(result.status, 'REMOVED_EXACT_FIXTURE');
  assert.equal(calls.length, 17);
  for (const call of calls) {
    assert.ok(Object.keys(call.where).length > 0);
    if (!['user', 'webSession'].includes(call.table))
      assert.equal(call.table === 'project' ? call.where.id : call.where.projectId, f.projectId);
  }
  assert.deepEqual(
    calls.find((call) => call.table === 'task').where.id.in,
    f.tasks.map((task) => task.id),
  );
  assert.deepEqual(calls.find((call) => call.table === 'webSession').where.OR, [
    { id: f.sessionId, userId: f.userId },
    { id: f.outsiderSessionId, userId: f.outsiderId },
  ]);
});

test('cleanup count mismatch aborts its enclosing transaction', async () => {
  const tx = new Proxy(
    {},
    {
      get: (_, table) => ({
        deleteMany: async () => ({ count: table === 'task' ? 4 : expectedCounts[table] }),
      }),
    },
  );
  await assert.rejects(
    cleanupFixture({ $transaction: async (callback) => callback(tx) }, createFixture()),
    /Expected values to be strictly deep-equal/,
  );
});

test('history cleanup counts the exact larger fixture and rejects even one missing revision', async () => {
  const fixture = createFixture('history');
  const counts = {
    ...expectedCounts,
    task: 50,
    workflowInstance: 50,
    documentRevision: 10_000,
    knowledgeDocument: 100,
    requirement: 50,
  };
  const result = await cleanupFixture(cleanupPrisma({ counts }), fixture);
  assert.deepEqual(result.removed, {
    ...expectedRemoved,
    tasks: 50,
    instances: 50,
    revisions: 10_000,
    documents: 100,
    requirements: 50,
  });
  await assert.rejects(
    cleanupFixture(cleanupPrisma({ counts: { ...counts, documentRevision: 9_999 } }), fixture),
    /Expected values to be strictly deep-equal/,
  );
});

test('cleanup postchecks preserve all committed exact deletion counts on either failure', async () => {
  const fixture = createFixture();
  for (const options of [{ versions: 1 }, { resources: 1 }, { occupied: true }]) {
    const report = cleanupReport();
    await cleanupAndCheckDatabase(report, cleanupPrisma(options), fixture);
    assert.equal(report.status, 'FAILED');
    assert.equal(report.cleanup.status, 'POSTCHECK_FAILED');
    assert.deepEqual(report.cleanup.removed, expectedRemoved);
    assert.equal(report.cleanup.runId, fixture.runId);
    assert.equal(report.cleanup.projectId, fixture.projectId);
    assert.equal(
      report.cleanup.code,
      options.occupied
        ? 'NONEMPTY_BENCHMARK_DATABASE_REFUSED'
        : 'UNEXPECTED_BUILTIN_ROLE_PACKAGE_ROWS',
    );
    assert.deepEqual(report.failure, {
      stage: 'cleanup',
      code: 'EXACT_CLEANUP_OR_EMPTY_CHECK_FAILED',
    });
  }
});

test('successful cleanup completes both postchecks and records the checked business table count', async () => {
  const report = cleanupReport();
  await cleanupAndCheckDatabase(report, cleanupPrisma(), createFixture());
  assert.equal(report.status, 'PASS');
  assert.deepEqual(report.cleanup, {
    status: 'REMOVED_EXACT_FIXTURE',
    removed: expectedRemoved,
    emptyBusinessTablesChecked: 3,
  });
  assert.deepEqual(report.bootstrapData.builtinRolePackages.afterCleanup, {
    versions: 0,
    resources: 0,
  });
  assert.equal(report.failure, undefined);
});

test('cleanup transaction failures never report committed deletions or replace the original failure', async () => {
  const fixture = createFixture();
  for (const prisma of [
    cleanupPrisma({ counts: { ...expectedCounts, task: 4 } }),
    {
      $transaction: async () => {
        throw new Error('credential-canary');
      },
    },
  ]) {
    const report = cleanupReport();
    report.failure = { stage: 'measure-board', code: 'MEASURED_REQUEST_FAILURES' };
    await cleanupAndCheckDatabase(report, prisma, fixture);
    assert.equal(report.status, 'FAILED');
    assert.equal(report.cleanup.status, 'FAILED');
    assert.equal(report.cleanup.removed, undefined);
    assert.equal(report.cleanup.runId, fixture.runId);
    assert.equal(report.cleanup.projectId, fixture.projectId);
    assert.deepEqual(report.failure, { stage: 'measure-board', code: 'MEASURED_REQUEST_FAILURES' });
    assert.ok(!JSON.stringify(report).includes('credential-canary'));
  }
});

test('response assertions reject missing records, body leaks and partial workbench results', () => {
  const f = createFixture();
  for (const name of Object.keys(endpoints(f)))
    assert.doesNotThrow(() => verifyResponse(name, responseOf(name, f), f));
  const docs = responseOf('documents', f);
  docs.data.items[0].revisions[0].bodyBytes = 'leak';
  assert.throws(() => verifyResponse('documents', docs, f));
  const board = responseOf('board', f);
  board.data.columns[0].cards.pop();
  assert.throws(() => verifyResponse('board', board, f));
  const inaccurateCount = responseOf('board', f);
  inaccurateCount.data.summary.total--;
  assert.throws(() => verifyResponse('board', inaccurateCount, f));
  const incompletePage = responseOf('board', f);
  incompletePage.data.columns[0].nextCursor = 'unexpected-next-page';
  assert.throws(() => verifyResponse('board', incompletePage, f));
  const workbench = responseOf('workbench', f);
  workbench.data.warnings.push('partial failure');
  assert.throws(() => verifyResponse('workbench', workbench, f));
});

test('history response verification rejects truncated nested history and partial task previews', () => {
  const fixture = createFixture('history');
  for (const name of Object.keys(endpoints(fixture)))
    assert.doesNotThrow(() => verifyResponse(name, responseOf(name, fixture), fixture));
  const documents = responseOf('documents', fixture);
  documents.data.items[99].revisions.pop();
  assert.throws(() => verifyResponse('documents', documents, fixture));
  const board = responseOf('board', fixture);
  board.data.columns[0].cards.pop();
  assert.throws(() => verifyResponse('board', board, fixture));
  const workbench = responseOf('workbench', fixture);
  workbench.data.readyTasks.pop();
  assert.throws(() => verifyResponse('workbench', workbench, fixture));
});

test('authorization probes cover every endpoint and fail if nonmembers see data', async () => {
  const f = createFixture();
  const calls = [];
  const send = async (_, path, cookie) => {
    calls.push({ path, authenticated: !!cookie });
    if (!cookie) return { status: 401, body: { error: { code: 'AUTH_REQUIRED' } } };
    if (path.includes('/workbench?'))
      return {
        status: 200,
        body: {
          data: {
            counts: { total: 0 },
            readyTasks: [],
            reviews: [],
            changes: [],
            overdueApprovals: [],
            warnings: [],
          },
        },
      };
    return { status: 404, body: { error: { code: 'RESOURCE_NOT_FOUND' } } };
  };
  assert.equal((await checkAuthorization(1, f, send)).requests, 16);
  assert.equal(calls.length, 16);
  assert.deepEqual(
    [...new Set(calls.map(({ path }) => path))].sort(),
    [
      ...Object.values(endpoints(f)),
      `/api/v1/projects/${f.projectId}/board/columns/BACKLOG?limit=7`,
      `/api/v1/projects/${f.projectId}/board/requirements?limit=7`,
      `/api/v1/projects/${f.projectId}/board/filters/roles?limit=7`,
      `/api/v1/projects/${f.projectId}/board/filters/requirements?limit=7`,
    ].sort(),
  );
  for (let index = 0; index < calls.length; index += 2) {
    assert.equal(calls[index].authenticated, false);
    assert.equal(calls[index + 1].authenticated, true);
    assert.equal(calls[index].path, calls[index + 1].path);
  }
  await assert.rejects(
    checkAuthorization(1, f, async () => ({ status: 200 })),
    /ANONYMOUS_AUTHORIZATION_CHECK_FAILED/,
  );
  await assert.rejects(
    checkAuthorization(1, f, async (_, path, cookie) =>
      cookie
        ? { status: 200, body: responseOf(path.includes('/workbench?') ? 'workbench' : 'board', f) }
        : { status: 401, body: { error: { code: 'AUTH_REQUIRED' } } },
    ),
    /NONMEMBER_AUTHORIZATION_CHECK_FAILED/,
  );
});

for (const dataset of ['small', 'history']) {
  test(`Board correctness probes traverse all ${dataset} fixture pages outside latency samples`, async () => {
    const f = createFixture(dataset);
    const server = boardPageServer(f);
    const report = await verifyBoardPagination(12345, f, server.send);
    const pages = Math.ceil(f.tasks.length / 7);
    assert.deepEqual(report, {
      status: 'PASS',
      requests: pages * 3 + 1,
      pageSize: 7,
      taskIdsCheckedInOrder: f.tasks.length,
      requirementGroupsCheckedInOrder: f.requirements.length,
      roleOptionsChecked: 1,
      requirementOptionsCheckedInOrder: f.requirements.length,
      includedInLatencySamples: false,
    });
    for (const route of ['/columns/BACKLOG', '/requirements', '/filters/requirements'])
      assert.deepEqual(
        server.calls.filter((call) => call.route === route).map(({ offset }) => offset),
        Array.from({ length: pages }, (_, index) => index * 7),
      );
    assert.deepEqual(
      server.calls.filter((call) => call.route === '/filters/roles'),
      [{ route: '/filters/roles', offset: 0 }],
    );
  });
}

test('Board correctness probes reject partial, misordered, duplicate and malformed pages', async (t) => {
  const f = createFixture('history');
  const cases = [
    [
      'non-200',
      '/columns/BACKLOG',
      ({ result }) => {
        result.status = 503;
      },
    ],
    [
      'missing request ID',
      '/columns/BACKLOG',
      ({ result }) => {
        delete result.body.meta.requestId;
      },
    ],
    [
      'wrong project',
      '/columns/BACKLOG',
      ({ data }) => {
        data.projectId = f.outsiderId;
      },
    ],
    [
      'empty query scope',
      '/columns/BACKLOG',
      ({ data }) => {
        data.queryKey = '';
      },
    ],
    [
      'wrong column',
      '/columns/BACKLOG',
      ({ data }) => {
        data.key = 'ACTIVE';
      },
    ],
    [
      'wrong column total',
      '/columns/BACKLOG',
      ({ data }) => {
        data.total--;
      },
    ],
    [
      'missing task',
      '/columns/BACKLOG',
      ({ data }) => {
        data.cards.pop();
      },
    ],
    [
      'duplicate task',
      '/columns/BACKLOG',
      ({ data }) => {
        data.cards[1] = data.cards[0];
      },
    ],
    [
      'misordered tasks',
      '/columns/BACKLOG',
      ({ data }) => {
        data.cards.reverse();
      },
    ],
    [
      'early end',
      '/columns/BACKLOG',
      ({ data }) => {
        data.nextCursor = null;
      },
    ],
    [
      'missing cursor',
      '/columns/BACKLOG',
      ({ data }) => {
        delete data.nextCursor;
      },
    ],
    [
      'oversized page',
      '/columns/BACKLOG',
      ({ data, source }) => {
        data.cards = source.cards.slice(0, 8);
      },
    ],
    [
      'empty cursor',
      '/columns/BACKLOG',
      ({ data }) => {
        data.nextCursor = '';
      },
    ],
    [
      'nonstring cursor',
      '/columns/BACKLOG',
      ({ data }) => {
        data.nextCursor = 7;
      },
    ],
    [
      'oversized cursor',
      '/columns/BACKLOG',
      ({ data }) => {
        data.nextCursor = 'a'.repeat(2049);
      },
    ],
    [
      'wrong group total',
      '/requirements',
      ({ data }) => {
        data.summary.requirementTotal--;
      },
    ],
    [
      'wrong summary column count',
      '/requirements',
      ({ data }) => {
        data.summary.columns[0].total--;
      },
    ],
    [
      'wrong group count',
      '/requirements',
      ({ data }) => {
        data.items[0].counts.ACTIVE++;
      },
    ],
    [
      'wrong group title',
      '/requirements',
      ({ data }) => {
        data.items[0].title = 'wrong title';
      },
    ],
    [
      'missing requirement group',
      '/requirements',
      ({ data }) => {
        data.items.pop();
      },
    ],
    [
      'misordered requirement groups',
      '/requirements',
      ({ data }) => {
        data.items.reverse();
      },
    ],
    [
      'incomplete group roles',
      '/requirements',
      ({ data }) => {
        data.items[0].roles = [];
      },
    ],
    [
      'wrong role total',
      '/filters/roles',
      ({ data }) => {
        data.total = 2;
      },
    ],
    [
      'wrong role label',
      '/filters/roles',
      ({ data }) => {
        data.items[0].label = 'wrong';
      },
    ],
    [
      'missing requirement option',
      '/filters/requirements',
      ({ data }) => {
        data.items.pop();
      },
    ],
    [
      'misordered requirement options',
      '/filters/requirements',
      ({ data }) => {
        data.items.reverse();
      },
    ],
    [
      'wrong requirement label',
      '/filters/requirements',
      ({ data }) => {
        data.items[0].label = 'wrong';
      },
    ],
    [
      'wrong requirement option total',
      '/filters/requirements',
      ({ data }) => {
        data.total--;
      },
    ],
  ];
  for (const [name, route, mutate] of cases) {
    await t.test(name, async () => {
      const server = boardPageServer(f, (page) => {
        if (page.route === route && page.offset === 0) mutate(page);
      });
      await assert.rejects(verifyBoardPagination(12345, f, server.send), {
        name: 'AssertionError',
      });
    });
  }
});

test('Board continuation rejects cursor cycles, missing records and changed query scopes', async (t) => {
  const f = createFixture('history');
  const changes = [
    [
      'cursor cycle',
      ({ data }) => {
        data.nextCursor = Buffer.from('7').toString('base64url');
      },
    ],
    [
      'missing later task',
      ({ data }) => {
        data.cards.pop();
      },
    ],
    [
      'duplicate across pages',
      ({ data, source }) => {
        data.cards[0] = source.cards[0];
      },
    ],
    [
      'changed query scope',
      ({ data }) => {
        data.queryKey += '-other';
      },
    ],
  ];
  for (const [name, mutate] of changes) {
    await t.test(name, async () => {
      const server = boardPageServer(f, (page) => {
        if (page.route === '/columns/BACKLOG' && page.offset === 7) mutate(page);
      });
      await assert.rejects(verifyBoardPagination(12345, f, server.send), {
        name: 'AssertionError',
      });
      assert.ok(server.calls.length <= 8);
    });
  }
});

test('bounded measurement accounts for responses, transport errors and invalid success bodies without retry', async () => {
  const f = createFixture();
  let calls = 0;
  let active = 0;
  let maximum = 0;
  const send = async () => {
    const index = calls++;
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (index === 2) throw new Error('transport');
    return {
      status: index === 3 ? 500 : 200,
      byteLength: 123,
      body: index === 4 ? {} : responseOf('board', f),
    };
  };
  const result = await measureEndpoint(
    1,
    '/fixture',
    'board',
    f,
    { samples: 4, warmup: 1 },
    2,
    send,
  );
  assert.equal(calls, 5);
  assert.equal(maximum, 2);
  assert.equal(result.requests, 4);
  assert.equal(result.errors, 3);
  assert.deepEqual(result.statuses, { 200: 2, 500: 1, transport: 1 });
  assert.equal(result.responseBytes, 369);
  assert.equal(result.latencySamples, 3);
});

test('nearest rank percentiles retain small-sample meaning', () => {
  assert.deepEqual(summarize([10, 2, 4, 8]), { p50Ms: 4, p95Ms: 10 });
  assert.deepEqual(summarize([]), { p50Ms: null, p95Ms: null });
});

test('CLI guard works without any API build artifacts and never logs credential canaries', () => {
  const env = {
    ...process.env,
    WORKMESH_TEST_ENV: 'local',
    WORKMESH_TEST_DATABASE_USERS: 'bench',
    WORKMESH_TEST_DATABASE_URL:
      'postgresql://bench:credential-canary@127.0.0.1:1/workmesh_test_api_benchmark_guard?schema=workmesh_v1',
  };
  const root = mkdtempSync(join(tmpdir(), 'workmesh-api-benchmark-guard-'));
  try {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const path of [
      'scripts/benchmark-api.mjs',
      'scripts/benchmark-revision-summary.mjs',
      'scripts/lib/test-database-guard.mjs',
      'packages/shared/dist/index.js',
    ]) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(new URL(`../${path}`, import.meta.url), target);
    }
    assert.equal(existsSync(join(root, 'apps/api')), false);
    const script = join(root, 'scripts/benchmark-api.mjs');
    const result = spawnSync(process.execPath, [script], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 2);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('credential-canary'));
    const report = JSON.parse(result.stdout);
    assert.equal(report.failure.stage, 'test-database-guard');
    assert.equal(report.failure.code, 'TEST_DATABASE_PASSWORD_FORBIDDEN');
    assert.equal(report.cleanup.status, 'NOT_SEEDED');
    assert.equal(report.implementation, undefined);

    env.WORKMESH_TEST_DATABASE_URL =
      'postgresql://bench@127.0.0.1:1/workmesh_test_api_benchmark_guard?schema=workmesh_v1';
    env.DATABASE_URL = '';
    env.WORKMESH_V1_DATABASE_URL = '';
    const validTarget = spawnSync(process.execPath, [script], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(validTarget.status, 2);
    const missingBuild = JSON.parse(validTarget.stdout);
    assert.equal(missingBuild.failure.stage, 'implementation-fingerprint');
    assert.equal(missingBuild.failure.code, 'BENCHMARK_FAILED');
    assert.equal(missingBuild.cleanup.status, 'NOT_SEEDED');
  } finally {
    const resolved = realpathSync(root);
    assert.equal(dirname(resolved), realpathSync(tmpdir()));
    assert.ok(basename(resolved).startsWith('workmesh-api-benchmark-guard-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});
