import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertDedicatedTarget,
  assertEmptyDatabase,
  cleanupFixture,
  createFixture,
  expectedSummaries,
  legacyListRevisions,
  loadGeneratedClient,
  measureQueries,
  parseArguments,
  resultSize,
  resolveGeneratedClientPath,
  seedFixture,
  summarize,
  verifyResult,
} from './benchmark-revision-summary.mjs';

const script = fileURLToPath(new URL('./benchmark-revision-summary.mjs', import.meta.url));
const options = { revisions: 6, bodyBytes: 1024, warmup: 1, repeats: 3 };

test('generated client follows the formal schema output and loads without a database connection', () => {
  const schemaUrl = new URL('../apps/api/prisma/schema.prisma', import.meta.url);
  const schemaDirectory = dirname(fileURLToPath(schemaUrl));
  assert.equal(
    resolveGeneratedClientPath(),
    resolve(schemaDirectory, '../../node_modules/.prisma/workmesh-v1-client'),
  );
  assert.notEqual(
    resolveGeneratedClientPath(),
    resolve(schemaDirectory, '../node_modules/.prisma/workmesh-v1-client'),
  );
  assert.equal(typeof loadGeneratedClient().PrismaClient, 'function');
});

test('generator path resolution preserves spaces and follows a changed relative output', () => {
  const schemaUrl = pathToFileURL(
    resolve('Fixture 空间', 'apps', 'api', 'prisma', 'schema.prisma'),
  );
  const schema =
    'generator client {\n provider = "prisma-client-js"\n output = "../../../generated client"\n}';
  assert.equal(
    resolveGeneratedClientPath(schemaUrl, schema),
    resolve(dirname(fileURLToPath(schemaUrl)), '../../../generated client'),
  );
  assert.throws(
    () =>
      resolveGeneratedClientPath(
        schemaUrl,
        'generator client {\n provider = "prisma-client-js"\n}',
      ),
    /PRISMA_GENERATOR_OUTPUT_UNAVAILABLE/,
  );
});

test('benchmark defaults and bounded arguments prevent accidental unbounded load', () => {
  assert.deepEqual(parseArguments([]), {
    revisions: 100,
    bodyBytes: 131072,
    warmup: 2,
    repeats: 7,
  });
  assert.deepEqual(parseArguments(['--help']), { help: true });
  assert.deepEqual(
    parseArguments(['--revisions', '6', '--body-bytes', '1024', '--warmup', '1', '--repeats', '3']),
    options,
  );
  for (const args of [
    ['--skip-guard'],
    ['--revisions', '1'],
    ['--revisions', '101', '--revisions', '102'],
    ['--body-bytes', '1e6'],
    ['--repeats', '0'],
    ['--warmup', '0'],
    ['--revisions', '1000', '--body-bytes', '1048576'],
  ]) {
    assert.throws(() => parseArguments(args));
  }
});

test('benchmark requires a dedicated database name plus explicit local user allowlist', () => {
  const target = { env: 'local', database: 'workmesh_test_revision_benchmark_unique' };
  assert.doesNotThrow(() =>
    assertDedicatedTarget(target, { WORKMESH_TEST_DATABASE_USERS: 'postgres' }),
  );
  assert.throws(() => assertDedicatedTarget(target, {}), /EXPLICIT_LOCAL_TEST_USER_REQUIRED/);
  assert.throws(
    () =>
      assertDedicatedTarget({ ...target, env: 'ci' }, { WORKMESH_TEST_DATABASE_USERS: 'postgres' }),
    /EXPLICIT_LOCAL_TEST_USER_REQUIRED/,
  );
  assert.throws(
    () =>
      assertDedicatedTarget(
        { ...target, database: 'workmesh_test_existing_project' },
        { WORKMESH_TEST_DATABASE_USERS: 'postgres' },
      ),
    /DEDICATED_BENCHMARK_DATABASE_REQUIRED/,
  );
});

for (const [name, additions, code] of [
  ['no explicit environment', {}, 'TEST_ENV_MISSING'],
  ['no explicit test URL', { WORKMESH_TEST_ENV: 'local' }, 'TEST_DATABASE_URL_MISSING'],
  [
    'production database',
    {
      WORKMESH_TEST_ENV: 'local',
      WORKMESH_TEST_DATABASE_USERS: 'postgres',
      WORKMESH_TEST_DATABASE_URL:
        'postgresql://postgres:private-canary@127.0.0.1:1/workmesh_prod?schema=workmesh_v1',
    },
    'TEST_DATABASE_NAME_PREFIX',
  ],
  [
    'ordinary test database',
    {
      WORKMESH_TEST_ENV: 'local',
      WORKMESH_TEST_DATABASE_USERS: 'postgres',
      WORKMESH_TEST_DATABASE_URL:
        'postgresql://postgres@127.0.0.1:1/workmesh_test_existing_project?schema=workmesh_v1',
    },
    'DEDICATED_BENCHMARK_DATABASE_REQUIRED',
  ],
]) {
  test('runner refuses ' + name + ' before Prisma connection and redacts credentials', () => {
    const env = { ...process.env };
    for (const key of [
      'WORKMESH_TEST_ENV',
      'WORKMESH_TEST_DATABASE_USERS',
      'WORKMESH_TEST_DATABASE_URL',
    ])
      delete env[key];
    env.DATABASE_URL = 'postgresql://private-canary@127.0.0.1:1/workmesh_prod';
    env.WORKMESH_V1_DATABASE_URL = env.DATABASE_URL;
    Object.assign(env, additions);
    const result = spawnSync(process.execPath, [script], {
      env,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'REFUSED');
    assert.equal(report.failure.stage, 'test-database-guard');
    assert.equal(report.failure.code, code);
    assert.equal(report.cleanup.status, 'NOT_SEEDED');
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /private-canary|postgresql:\/\/|PrismaClient/,
    );
  });
}

test('empty check reads all business tables and refuses populated or unmigrated target', async () => {
  const calls = [];
  const prisma = {
    $queryRawUnsafe: async (sql) => {
      calls.push(sql);
      return sql.includes('information_schema')
        ? [{ table_name: 'User' }, { table_name: 'Project' }]
        : [{ occupied: false }];
    },
  };
  assert.equal(await assertEmptyDatabase(prisma), 2);
  assert.match(calls[0], /table_name <> '_prisma_migrations'/);
  assert.match(calls[1], /SELECT EXISTS.*"workmesh_v1"\."User"/);
  assert.ok(calls.every((sql) => sql.startsWith('SELECT ')));
  await assert.rejects(
    () =>
      assertEmptyDatabase({
        $queryRawUnsafe: async (sql) =>
          sql.includes('information_schema') ? [{ table_name: 'User' }] : [{ occupied: true }],
      }),
    /NONEMPTY_BENCHMARK_DATABASE_REFUSED/,
  );
  await assert.rejects(
    () => assertEmptyDatabase({ $queryRawUnsafe: async () => [] }),
    /MIGRATED_SCHEMA_REQUIRED/,
  );
  await assert.rejects(
    () => assertEmptyDatabase({ $queryRawUnsafe: async () => [{ table_name: 'User";DELETE' }] }),
    /UNEXPECTED_TABLE_IDENTIFIER/,
  );
});

test('seed is atomic with unique owned rows and optional JSON omissions', async () => {
  const fixture = createFixture(options);
  const other = createFixture(options);
  assert.notEqual(fixture.projectId, other.projectId);
  assert.deepEqual(
    fixture.revisions.map((row) => row.sha256),
    other.revisions.map((row) => row.sha256),
  );
  const calls = [];
  const tx = Object.fromEntries(
    [
      'user',
      'project',
      'knowledgeBase',
      'knowledgeDocument',
      'documentRevision',
      'reviewRequest',
    ].map((name) => [
      name,
      {
        create: async (args) => calls.push({ name, ...args }),
        createMany: async (args) => calls.push({ name, ...args }),
      },
    ]),
  );
  let transactions = 0;
  await seedFixture(
    {
      $transaction: async (fn) => {
        transactions++;
        await fn(tx);
      },
    },
    fixture,
  );
  assert.equal(transactions, 1);
  assert.equal(calls.find((row) => row.name === 'user').data.id, fixture.userId);
  const revisions = calls.find((row) => row.name === 'documentRevision').data;
  assert.equal(revisions.length, options.revisions);
  assert.ok(
    revisions.every(
      (row) => row.projectId === fixture.projectId && row.documentId === fixture.documentId,
    ),
  );
  assert.equal(Object.hasOwn(revisions[0], 'deliveryScope'), false);
  assert.equal(Object.hasOwn(revisions[0], 'acceptance'), false);
  assert.deepEqual(revisions[1].acceptance, fixture.revisions[1].acceptance);
});

test('cleanup uses exact fixture IDs in FK order and refuses unexpected counts', async () => {
  const fixture = createFixture(options);
  const names = [
    'reviewRequest',
    'documentRevision',
    'knowledgeDocument',
    'knowledgeBase',
    'project',
    'user',
  ];
  const counts = [fixture.reviews.length, fixture.revisions.length, 1, 1, 1, 1];
  const calls = [];
  const tx = Object.fromEntries(
    names.map((name, index) => [
      name,
      {
        deleteMany: async (args) => {
          calls.push({ name, ...args });
          return { count: counts[index] };
        },
      },
    ]),
  );
  const prisma = { $transaction: async (fn) => fn(tx) };
  const result = await cleanupFixture(prisma, fixture);
  assert.equal(result.status, 'REMOVED_EXACT_FIXTURE');
  assert.deepEqual(
    calls.map((row) => row.name),
    names,
  );
  assert.deepEqual(
    calls[0].where.id.in,
    fixture.reviews.map((row) => row.id),
  );
  assert.deepEqual(calls[1].where, {
    id: { in: fixture.revisions.map((row) => row.id) },
    projectId: fixture.projectId,
    documentId: fixture.documentId,
  });
  for (const call of calls) assert.ok(Object.hasOwn(call.where, 'id'));
  assert.deepEqual(calls.at(-1).where, { id: fixture.userId, email: fixture.email });
  counts[0]--;
  await assert.rejects(
    () => cleanupFixture(prisma, fixture),
    /Expected values to be strictly deep-equal/,
  );
});

function queryFixture(fixture) {
  return {
    knowledgeDocument: {
      findUnique: async () => ({
        knowledgeBaseId: fixture.knowledgeBaseId,
        currentPublishedRevisionId: fixture.publishedRevisionId,
      }),
    },
    documentRevision: {
      findMany: async (args) => {
        assert.equal(args.select, undefined);
        assert.equal(args.include.reviewRequests.take, 1);
        return [...fixture.revisions].reverse().map((row) => ({
          ...row,
          reviewRequests: fixture.reviews
            .filter((review) => review.documentRevisionId === row.id)
            .reverse()
            .slice(0, 1),
        }));
      },
    },
  };
}

test('legacy and new views preserve all metadata and order while new view forbids body', async () => {
  const fixture = createFixture(options);
  const expected = expectedSummaries(fixture);
  const legacy = await legacyListRevisions(queryFixture(fixture), fixture.documentId);
  verifyResult(legacy, expected, true);
  verifyResult(expected, expected, false);
  assert.equal(expected[0].state, 'PUBLISHED');
  assert.equal(expected[1].reviewRequestId, null);
  assert.notEqual(expected[0].reviewRequestId, null);
  assert.throws(() =>
    verifyResult(
      [{ ...expected[0], bodyBytes: new Uint8Array() }, ...expected.slice(1)],
      expected,
      false,
    ),
  );
  assert.throws(() =>
    verifyResult([{ ...expected[0], digest: 'changed' }, ...expected.slice(1)], expected, false),
  );
  assert.throws(() => verifyResult([...expected].reverse(), expected, false));
  const corrupt = legacy.map((row) => ({ ...row }));
  corrupt[0].bodyBytes = Buffer.alloc(options.bodyBytes);
  assert.throws(() => verifyResult(corrupt, expected, true));
});

test('measurement retains finite samples and separates JSON size from query timing', async () => {
  const fixture = createFixture(options);
  const expected = expectedSummaries(fixture);
  const legacy = await legacyListRevisions(queryFixture(fixture), fixture.documentId);
  assert.equal(
    resultSize(legacy).repositoryResultJsonBytes,
    Buffer.byteLength(JSON.stringify(legacy)),
  );
  assert.equal(resultSize(legacy).logicalBodyBytes, options.revisions * options.bodyBytes);
  assert.equal(resultSize(expected).logicalBodyBytes, 0);
  assert.deepEqual(summarize([7, 1, 5, 3, 4, 6, 2]), {
    samplesMs: [7, 1, 5, 3, 4, 6, 2],
    p50Ms: 4,
    p95Ms: 7,
  });
  let newCalls = 0;
  const measured = await measureQueries(
    queryFixture(fixture),
    {
      listRevisions: async () => {
        newCalls++;
        return expected;
      },
    },
    fixture,
    options,
  );
  assert.equal(newCalls, 1 + options.warmup + options.repeats);
  for (const result of Object.values(measured)) {
    assert.equal(result.queryAndMapping.samplesMs.length, options.repeats);
    assert.ok(result.queryAndMapping.p50Ms >= 0);
  }
  assert.ok(
    measured.legacyFullBody.repositoryResultJsonBytes >
      measured.metadataOnly.repositoryResultJsonBytes,
  );
  assert.equal(measured.metadataOnly.logicalBodyBytes, 0);
  assert.doesNotMatch(JSON.stringify(measured), /bodyBytes|Benchmark revision|revision-benchmark-/);
});
