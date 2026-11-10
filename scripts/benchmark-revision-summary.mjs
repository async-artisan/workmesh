#!/usr/bin/env node
// Query microbenchmark only: no HTTP server, capacity claim, migration, or database creation.
// Build shared and API first, migrate a NEW workmesh_test_revision_benchmark_* database,
// then explicitly set WORKMESH_TEST_ENV=local, WORKMESH_TEST_DATABASE_USERS and
// WORKMESH_TEST_DATABASE_URL. This script refuses any nonempty business database.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGuard, resolveTestDatabase } from './lib/test-database-guard.mjs';

const SUITE = 'revision-summary-query-microbenchmark';
const DATABASE_PREFIX = /^workmesh_test_revision_benchmark_[a-z0-9_]+$/;
const REPOSITORY_URL = new URL(
  '../apps/api/dist/knowledge/v1-publication.prisma-repository.js',
  import.meta.url,
);
const SOURCE_URL = new URL(
  '../apps/api/src/knowledge/v1-publication.prisma-repository.ts',
  import.meta.url,
);
const SCHEMA_URL = new URL('../apps/api/prisma/schema.prisma', import.meta.url);
const USAGE =
  'node scripts/benchmark-revision-summary.mjs [--revisions 100] [--body-bytes 131072] [--warmup 2] [--repeats 7]';

function fail(code) {
  const error = new Error(code);
  error.benchmarkCode = code;
  throw error;
}

// Prisma resolves generator output relative to schema.prisma, not apps/api/package.json.
// Read the formal declaration so this runner follows future output-directory changes.
export function resolveGeneratedClientPath(
  schemaUrl = SCHEMA_URL,
  schemaText = readFileSync(schemaUrl, 'utf8'),
) {
  const generator = schemaText.match(/\bgenerator\s+client\s*\{([^}]*)\}/)?.[1];
  const output = generator?.match(/^\s*output\s*=\s*"([^"\r\n]+)"\s*(?:\/\/.*)?$/m)?.[1];
  if (!output) fail('PRISMA_GENERATOR_OUTPUT_UNAVAILABLE');
  return resolve(dirname(fileURLToPath(schemaUrl)), output);
}

export function loadGeneratedClient(schemaUrl = SCHEMA_URL) {
  return createRequire(schemaUrl)(resolveGeneratedClientPath(schemaUrl));
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const options = { revisions: 100, bodyBytes: 128 * 1024, warmup: 2, repeats: 7 };
  const flags = {
    '--revisions': ['revisions', 2, 1000],
    '--body-bytes': ['bodyBytes', 1024, 1024 * 1024],
    '--warmup': ['warmup', 1, 5],
    '--repeats': ['repeats', 3, 31],
  };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const definition = flags[flag];
    const raw = args[index + 1];
    if (!definition || seen.has(flag) || !/^\d+$/.test(raw ?? '')) fail('INVALID_ARGUMENTS');
    seen.add(flag);
    const [key, minimum, maximum] = definition;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
      fail('INVALID_ARGUMENTS');
    options[key] = value;
  }
  if (options.revisions * options.bodyBytes > 128 * 1024 * 1024) fail('DATASET_TOO_LARGE');
  return options;
}

export function assertDedicatedTarget(target, env = process.env) {
  if (target.env !== 'local' || !env.WORKMESH_TEST_DATABASE_USERS?.trim())
    fail('EXPLICIT_LOCAL_TEST_USER_REQUIRED');
  if (!DATABASE_PREFIX.test(target.database)) fail('DEDICATED_BENCHMARK_DATABASE_REQUIRED');
}

export async function assertEmptyDatabase(prisma) {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'workmesh_v1' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  );
  if (tables.length === 0) fail('MIGRATED_SCHEMA_REQUIRED');
  for (const { table_name: table } of tables) {
    // Identifiers come only from the database catalog and this restricted alphabet.
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(table)) fail('UNEXPECTED_TABLE_IDENTIFIER');
    const rows = await prisma.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM "workmesh_v1"."${table}" LIMIT 1) AS occupied`,
    );
    if (rows[0]?.occupied !== false) fail('NONEMPTY_BENCHMARK_DATABASE_REFUSED');
  }
  return tables.length;
}

// Fixed pseudorandom data avoids highly compressible repeated-byte fixtures.
function fixtureBody(seq, size) {
  const body = Buffer.allocUnsafe(size);
  let state = (0x9e3779b9 ^ seq) >>> 0;
  for (let index = 0; index < size; index++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    body[index] = state & 255;
  }
  return body;
}

export function createFixture(options) {
  const runId = randomUUID();
  const fixture = {
    runId,
    userId: randomUUID(),
    projectId: randomUUID(),
    knowledgeBaseId: randomUUID(),
    documentId: randomUUID(),
    revisions: [],
    reviews: [],
  };
  fixture.email = `revision-benchmark-${runId}@workmesh.test`;
  for (let seq = 1; seq <= options.revisions; seq++) {
    const bodyBytes = fixtureBody(seq, options.bodyBytes);
    const revision = {
      id: randomUUID(),
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      seq,
      title: `Benchmark revision ${seq}`,
      mimeType: 'application/octet-stream',
      bodyBytes,
      byteLength: bodyBytes.length,
      sha256: createHash('sha256').update(bodyBytes).digest('hex'),
      createdById: fixture.userId,
      basisUnderstandingRevisionId: seq % 2 === 0 ? fixture.revisions[seq - 2].id : null,
      deliveryScope:
        seq % 3 === 0
          ? { participatingRoleIds: [], requiredOutputKinds: ['PRD'], excludedRoles: [] }
          : null,
      acceptance:
        seq % 2 === 0
          ? [
              {
                key: 'benchmark-check',
                text: 'Preserve summary metadata',
                verification: 'INSPECTION',
              },
            ]
          : null,
    };
    fixture.revisions.push(revision);
    if (seq % 5 !== 0) {
      for (let index = 0; index < 2; index++) {
        fixture.reviews.push({
          id: randomUUID(),
          projectId: fixture.projectId,
          kind: 'KNOWLEDGE_PUBLICATION',
          documentRevisionId: revision.id,
          subjectDigest: revision.sha256,
          createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, seq * 2 + index)),
        });
      }
    }
  }
  fixture.publishedRevisionId = fixture.revisions.at(-1).id;
  return fixture;
}

export async function seedFixture(prisma, fixture) {
  await prisma.$transaction(
    async (tx) => {
      await tx.user.create({
        data: {
          id: fixture.userId,
          email: fixture.email,
          passwordHash: 'benchmark-fixture-not-a-login',
        },
      });
      await tx.project.create({
        data: {
          id: fixture.projectId,
          key: `b${fixture.runId.replaceAll('-', '').slice(0, 5)}`,
          name: 'Isolated revision summary benchmark',
          createdById: fixture.userId,
        },
      });
      await tx.knowledgeBase.create({
        data: {
          id: fixture.knowledgeBaseId,
          projectId: fixture.projectId,
          key: 'benchmark',
          name: 'Revision benchmark',
          visibility: 'RESTRICTED',
          publicationApproverUserId: fixture.userId,
        },
      });
      await tx.knowledgeDocument.create({
        data: {
          id: fixture.documentId,
          projectId: fixture.projectId,
          knowledgeBaseId: fixture.knowledgeBaseId,
          kind: 'KNOWLEDGE',
          currentPublishedRevisionId: fixture.publishedRevisionId,
          nextRevisionSeq: fixture.revisions.length + 1,
        },
      });
      // Bounded batches keep parameters and transaction memory predictable.
      for (let offset = 0; offset < fixture.revisions.length; offset += 20) {
        const data = fixture.revisions.slice(offset, offset + 20).map((revision) => {
          const row = { ...revision };
          // Omitted optional JSON columns use database NULL, independent of Prisma JSON-null sentinels.
          if (row.deliveryScope === null) delete row.deliveryScope;
          if (row.acceptance === null) delete row.acceptance;
          return row;
        });
        await tx.documentRevision.createMany({ data });
      }
      await tx.reviewRequest.createMany({ data: fixture.reviews });
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

export async function cleanupFixture(prisma, fixture) {
  const removed = await prisma.$transaction(
    async (tx) => {
      // Every mutation has exact IDs plus the fixture's ownership fields. Never truncate or drop.
      const reviews = await tx.reviewRequest.deleteMany({
        where: {
          id: { in: fixture.reviews.map((row) => row.id) },
          projectId: fixture.projectId,
          documentRevisionId: { in: fixture.revisions.map((row) => row.id) },
        },
      });
      const revisions = await tx.documentRevision.deleteMany({
        where: {
          id: { in: fixture.revisions.map((row) => row.id) },
          projectId: fixture.projectId,
          documentId: fixture.documentId,
        },
      });
      const documents = await tx.knowledgeDocument.deleteMany({
        where: {
          id: fixture.documentId,
          projectId: fixture.projectId,
          knowledgeBaseId: fixture.knowledgeBaseId,
        },
      });
      const knowledgeBases = await tx.knowledgeBase.deleteMany({
        where: { id: fixture.knowledgeBaseId, projectId: fixture.projectId },
      });
      const projects = await tx.project.deleteMany({
        where: { id: fixture.projectId, createdById: fixture.userId },
      });
      const users = await tx.user.deleteMany({
        where: { id: fixture.userId, email: fixture.email },
      });
      const counts = {
        reviews: reviews.count,
        revisions: revisions.count,
        documents: documents.count,
        knowledgeBases: knowledgeBases.count,
        projects: projects.count,
        users: users.count,
      };
      assert.deepEqual(counts, {
        reviews: fixture.reviews.length,
        revisions: fixture.revisions.length,
        documents: 1,
        knowledgeBases: 1,
        projects: 1,
        users: 1,
      });
      return counts;
    },
    { maxWait: 10_000, timeout: 30_000 },
  );
  return { status: 'REMOVED_EXACT_FIXTURE', removed };
}

// Reproduces the pre-optimization listRevisions query and full-view mapping.
export async function legacyListRevisions(prisma, documentId) {
  const document = await prisma.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: { knowledgeBaseId: true, currentPublishedRevisionId: true },
  });
  if (!document) return [];
  const revisions = await prisma.documentRevision.findMany({
    where: { documentId },
    orderBy: { seq: 'desc' },
    include: { reviewRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } } },
  });
  return revisions.map((revision) => ({
    id: revision.id,
    documentId: revision.documentId,
    knowledgeBaseId: document.knowledgeBaseId,
    projectId: revision.projectId,
    seq: revision.seq,
    title: revision.title,
    mimeType: revision.mimeType,
    byteLength: revision.byteLength,
    digest: revision.sha256,
    state: document.currentPublishedRevisionId === revision.id ? 'PUBLISHED' : 'CANDIDATE',
    createdBy: revision.createdById,
    basisUnderstandingRevisionId: revision.basisUnderstandingRevisionId,
    deliveryScope: revision.deliveryScope ?? null,
    acceptance: revision.acceptance ?? null,
    reviewRequestId: revision.reviewRequests?.[0]?.id ?? null,
    bodyBytes: revision.bodyBytes,
  }));
}

function withoutBody(row) {
  const summary = { ...row };
  delete summary.bodyBytes;
  return summary;
}

export function expectedSummaries(fixture) {
  return [...fixture.revisions].reverse().map((revision) => ({
    id: revision.id,
    documentId: fixture.documentId,
    knowledgeBaseId: fixture.knowledgeBaseId,
    projectId: fixture.projectId,
    seq: revision.seq,
    title: revision.title,
    mimeType: revision.mimeType,
    byteLength: revision.byteLength,
    digest: revision.sha256,
    state: revision.id === fixture.publishedRevisionId ? 'PUBLISHED' : 'CANDIDATE',
    createdBy: fixture.userId,
    basisUnderstandingRevisionId: revision.basisUnderstandingRevisionId,
    deliveryScope: revision.deliveryScope,
    acceptance: revision.acceptance,
    reviewRequestId:
      fixture.reviews.findLast((review) => review.documentRevisionId === revision.id)?.id ?? null,
  }));
}

export function verifyResult(rows, expected, legacy) {
  assert.deepEqual(rows.map(withoutBody), expected);
  for (const row of rows) {
    if (legacy) {
      assert.ok(row.bodyBytes instanceof Uint8Array);
      assert.equal(row.bodyBytes.byteLength, row.byteLength);
      assert.equal(createHash('sha256').update(row.bodyBytes).digest('hex'), row.digest);
    } else {
      assert.equal(Object.hasOwn(row, 'bodyBytes'), false);
    }
  }
}

export function resultSize(rows) {
  const start = performance.now();
  // Exact JSON.stringify(array) UTF-8 length without keeping a large array string alive.
  const jsonBytes =
    2 +
    Math.max(rows.length - 1, 0) +
    rows.reduce((size, row) => size + Buffer.byteLength(JSON.stringify(row)), 0);
  return {
    rows: rows.length,
    logicalBodyBytes: rows.reduce((size, row) => size + (row.bodyBytes?.byteLength ?? 0), 0),
    repositoryResultJsonBytes: jsonBytes,
    serializationMeasurementMs: performance.now() - start,
  };
}

export function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (percent) => sorted[Math.max(0, Math.ceil(sorted.length * percent) - 1)];
  return { samplesMs: samples, p50Ms: percentile(0.5), p95Ms: percentile(0.95) };
}

export async function measureQueries(prisma, repository, fixture, options) {
  const expected = expectedSummaries(fixture);
  const variants = {
    legacyFullBody: () => legacyListRevisions(prisma, fixture.documentId),
    metadataOnly: () => repository.listRevisions(fixture.documentId),
  };
  const samples = { legacyFullBody: [], metadataOnly: [] };
  const sizes = {};
  // Correctness and size measurements are deliberately outside query/mapping timing.
  for (const [name, query] of Object.entries(variants)) {
    const rows = await query();
    verifyResult(rows, expected, name === 'legacyFullBody');
    sizes[name] = resultSize(rows);
  }
  for (let pass = 0; pass < options.warmup + options.repeats; pass++) {
    const order = pass % 2 === 0 ? Object.keys(variants) : Object.keys(variants).reverse();
    for (const name of order) {
      const start = performance.now();
      const rows = await variants[name]();
      const elapsed = performance.now() - start;
      verifyResult(rows, expected, name === 'legacyFullBody');
      if (pass >= options.warmup) samples[name].push(elapsed);
    }
  }
  return Object.fromEntries(
    Object.keys(variants).map((name) => [
      name,
      { queryAndMapping: summarize(samples[name]), ...sizes[name] },
    ]),
  );
}

function fingerprint(url) {
  return createHash('sha256').update(readFileSync(url)).digest('hex');
}

export async function main(args) {
  const report = {
    suite: SUITE,
    status: 'FAILED',
    startedAt: new Date().toISOString(),
    scope:
      'One serial Prisma repository query plus mapping; not HTTP/API throughput, concurrency, capacity, SLA, or a cold-cache experiment.',
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    cleanup: { status: 'NOT_SEEDED' },
  };
  let stage = 'arguments';
  let prisma;
  let fixture;
  let seeded = false;
  let exitCode;
  try {
    const options = parseArguments(args);
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
      return 0;
    }
    report.dataset = options;
    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 20 || (major === 20 && minor < 19)) fail('NODE_20_19_OR_NEWER_REQUIRED');
    stage = 'test-database-guard';
    const gate = await resolveTestDatabase();
    if (!gate.ok) fail(gate.rejection.code);
    assertDedicatedTarget(gate.target);
    const { host, port, database, schema, env } = gate.describe;
    report.databaseTarget = { host, port, database, schema, env };
    stage = 'load-built-repository';
    const { PrismaClient } = loadGeneratedClient();
    const { V1PublicationPrismaRepository } = await import(REPOSITORY_URL.href);
    report.implementation = {
      repository: 'apps/api/dist/knowledge/v1-publication.prisma-repository.js',
      builtSha256: fingerprint(REPOSITORY_URL),
      sourceSha256: fingerprint(SOURCE_URL),
      legacy:
        'Pre-optimization findUnique + findMany/include + full body view mapping reproduced in this runner; not a checkout/build of the historical commit.',
    };
    prisma = new PrismaClient({ datasources: { db: { url: gate.target.url } }, log: [] });
    stage = 'database-identity-probe';
    const guard = await loadGuard();
    const probes = await prisma.$queryRawUnsafe(guard.TEST_DATABASE_IDENTITY_PROBE_SQL);
    const identity = guard.evaluateIdentityProbe(probes[0] ?? {}, gate.target);
    if (!identity.ok) fail(identity.rejection.code);
    const versions = await prisma.$queryRawUnsafe(
      "SELECT current_setting('server_version') AS version",
    );
    report.runtime.postgresql = versions[0]?.version;
    stage = 'empty-business-database-check';
    report.emptyBusinessTablesChecked = await assertEmptyDatabase(prisma);
    stage = 'seed-fixture';
    fixture = createFixture(options);
    report.fixture = {
      runId: fixture.runId,
      projectId: fixture.projectId,
      documentId: fixture.documentId,
      revisions: fixture.revisions.length,
      reviewRequests: fixture.reviews.length,
      totalStoredBodyBytes: options.revisions * options.bodyBytes,
      bodyGenerator: 'Fixed xorshift32 seed per seq; binary pseudorandom bytes; no body logged.',
    };
    await seedFixture(prisma, fixture);
    seeded = true;
    // No longer retain input bodies while measuring the returned query data.
    for (const revision of fixture.revisions) delete revision.bodyBytes;
    stage = 'query-and-mapping-measurement';
    report.results = await measureQueries(
      prisma,
      new V1PublicationPrismaRepository(prisma),
      fixture,
      options,
    );
    report.method = {
      concurrency: 1,
      verificationQueriesPerVariant: 1,
      warmupPairs: options.warmup,
      measuredPairs: options.repeats,
      order: 'Alternating legacy/new then new/legacy; no service requests.',
      clock:
        'performance.now wall clock includes Prisma/database read + JS mapping; excludes verification and serialization.',
      percentiles:
        'Nearest rank; with 7 samples p95 is the maximum, not a production tail estimate.',
      size: 'Logical body bytes and UTF-8 JSON.stringify repository-result bytes, measured separately once per variant; not PostgreSQL wire bytes or HTTP response bytes.',
      correctness:
        'Every query checked against all expected summary fields, ids, seq, digests, state, nullable metadata, and latest review request; legacy body length/digest checked; new body property forbidden.',
      limits:
        'Single local run with warmed caches. No full API/service/authorization/N+1 measurement, concurrent clients, CPU/RSS peak, history pagination, or general product capacity conclusion.',
    };
    report.status = 'PASSED';
    exitCode = 0;
  } catch (error) {
    report.status =
      stage === 'arguments' ||
      stage === 'test-database-guard' ||
      stage === 'empty-business-database-check'
        ? 'REFUSED'
        : 'FAILED';
    // Never print Prisma/URL/row/error message content; it can contain body data or credentials.
    report.failure = {
      stage,
      code: /^[A-Z][A-Z0-9_]{0,80}$/.test(error?.benchmarkCode ?? '')
        ? error.benchmarkCode
        : error?.code === 'ERR_ASSERTION'
          ? 'RESULT_OR_CLEANUP_ASSERTION_FAILED'
          : 'BENCHMARK_OPERATION_FAILED',
      details: 'Raw error and database payload intentionally omitted.',
    };
    exitCode = report.status === 'REFUSED' ? 2 : 1;
  } finally {
    if (seeded) {
      try {
        report.cleanup = await cleanupFixture(prisma, fixture);
      } catch {
        report.cleanup = {
          status: 'FAILED_FIXTURE_RETAINED',
          runId: fixture.runId,
          projectId: fixture.projectId,
          documentId: fixture.documentId,
          reason: 'Exact-ID cleanup transaction failed; no broad deletion attempted.',
        };
        report.status = 'FAILED';
        exitCode = 1;
      }
    }
    if (prisma) {
      try {
        await prisma.$disconnect();
      } catch {
        report.disconnect = 'FAILED';
        report.status = 'FAILED';
        exitCode = 1;
      }
    }
  }
  report.finishedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
