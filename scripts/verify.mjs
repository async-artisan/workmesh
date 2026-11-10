#!/usr/bin/env node
// Complete local quality gate. External release/adoption gates remain separate.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadGuard, resolveTestDatabase } from './lib/test-database-guard.mjs';
import { resolvePnpmEntry } from './lib/pnpm-runner.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = resolve(ROOT, 'apps/api/prisma/schema.prisma');
const PLACEHOLDER = 'postgresql://placeholder@127.0.0.1:1/placeholder?schema=workmesh_v1';
const USAGE = [
  'Usage: pnpm verify [--apply-migrations]',
  'Requires Node >=20.19.0, the pinned pnpm, installed dependencies and Chromium,',
  'and an explicit isolated WORKMESH_TEST_DATABASE_URL with WORKMESH_TEST_ENV.',
  'The default requires an already migrated schema. --apply-migrations authorizes',
  'formal migrations only after the database identity probe passes.',
  'No database creation, browser installation, publication or external live calls.',
  'Success means LOCAL_QUALITY_PASSED, not release approval.',
  '',
].join('\n');

export const SCRIPT_TESTS = [
  'scripts/verify-release.test.mjs',
  'scripts/release-readiness.test.mjs',
  'scripts/verify-bundle-evidence.test.mjs',
  'scripts/validate-cyclonedx.test.mjs',
  'scripts/merge-bundle-sbom.test.mjs',
  'scripts/verify-cli-package.test.mjs',
  'scripts/package-licenses.test.mjs',
  'scripts/lib/isolated-prisma-paths.test.mjs',
  'scripts/test-integration.test.mjs',
  'scripts/first-run-demo-key.test.mjs',
  'scripts/box/dependency-links.test.mjs',
  'scripts/box/web-server.test.mjs',
  'scripts/api-agent-poc/runtime.test.mjs',
  'scripts/api-agent-poc/workmesh-http.test.mjs',
  'scripts/benchmark-revision-summary.test.mjs',
  'scripts/benchmark-api.test.mjs',
  'patches/deepmerge.test.mjs',
  'scripts/verify.test.mjs',
];

export const EXTERNAL_GATES_NOT_RUN = [
  'clean-source-remote-ci-and-platform-release-smoke',
  'release-authorization-and-maintainer-governance',
  'real-github-pr-and-webhook',
  'live-model-and-external-team-adoption',
  'complete-artifact-sbom-native-licenses-and-security-scans',
  'new-machine-upgrade-uninstall-and-rollback',
  'production-recovery-capacity-and-long-running-stability',
  'complete-delivery-cross-browser-and-accessibility',
];

function fail(code, status = 'FAILED', exitCode = 1) {
  const error = new Error(code);
  error.verifyCode = code;
  error.verifyStatus = status;
  error.exitCode = exitCode;
  throw error;
}

export function parseArguments(args) {
  const normalized = args[0] === '--' ? args.slice(1) : args;
  if (normalized.length === 1 && normalized[0] === '--help') return { help: true };
  if (normalized.length === 0) return { help: false, applyMigrations: false };
  if (normalized.length === 1 && normalized[0] === '--apply-migrations')
    return { help: false, applyMigrations: true };
  // Do not echo arbitrary arguments: a mistaken URL argument may contain secrets.
  fail('INVALID_ARGUMENTS', 'REFUSED', 2);
}

export function checkNodeVersion(version = process.versions.node) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match || Number(match[1]) < 20 || (Number(match[1]) === 20 && Number(match[2]) < 19))
    fail('NODE_20_19_OR_NEWER_REQUIRED', 'REFUSED', 2);
}

// Generator output is relative to the schema, not the API package directory.
export function resolveGeneratedClientPath(schemaPath = SCHEMA, text) {
  const schema = schemaPath instanceof URL ? fileURLToPath(schemaPath) : resolve(schemaPath);
  const source = text ?? readFileSync(schema, 'utf8');
  const generator = source.match(/^\s*generator\s+client\s*\{([^}]+)\}/m)?.[1];
  const output = generator?.match(/^\s*output\s*=\s*"([^"\r\n]+)"\s*(?:\/\/.*)?$/m)?.[1];
  if (!output) fail('PRISMA_GENERATOR_OUTPUT_UNAVAILABLE');
  return resolve(dirname(schema), output);
}

function loopbackAddress(address) {
  return (
    typeof address === 'string' &&
    (address === '127.0.0.1' || address === '::1' || address.toLowerCase() === '::ffff:127.0.0.1')
  );
}

export function evaluateProbe(probe, target, guard, applyMigrations = false) {
  if (!probe || !loopbackAddress(probe.server_addr))
    fail('TEST_DATABASE_SERVER_IDENTITY_MISMATCH', 'REFUSED', 2);
  if (typeof probe.schema_exists !== 'boolean')
    fail('TEST_DATABASE_SCHEMA_IDENTITY_UNAVAILABLE', 'REFUSED', 2);
  if (!probe.schema_exists && !applyMigrations)
    fail('MIGRATED_TEST_DATABASE_SCHEMA_REQUIRED', 'REFUSED', 2);
  // An absent schema is allowed only for the explicitly authorized migration.
  // Database, user and server identity still have to match before that write.
  const identity = guard.evaluateIdentityProbe(
    !probe.schema_exists && applyMigrations ? { ...probe, schema: target.schema } : probe,
    target,
  );
  if (!identity.ok) fail('TEST_DATABASE_PROBE_MISMATCH', 'REFUSED', 2);
}

export async function probeDatabase(target, { applyMigrations = false, schemaPath = SCHEMA } = {}) {
  const guard = await loadGuard();
  if (guard.error) fail('TEST_DATABASE_GUARD_UNAVAILABLE', 'REFUSED', 2);
  const module = createRequire(pathToFileURL(schemaPath))(resolveGeneratedClientPath(schemaPath));
  const client = new module.PrismaClient({
    datasources: { db: { url: target.url } },
    log: [],
    errorFormat: 'minimal',
  });
  try {
    // Cast inet because Prisma raw queries do not deserialize PostgreSQL inet.
    const sql = guard.TEST_DATABASE_IDENTITY_PROBE_SQL.replace(
      'inet_server_addr() as server_addr',
      "host(inet_server_addr()) as server_addr, to_regnamespace('workmesh_v1') is not null as schema_exists",
    );
    const rows = await client.$queryRawUnsafe(sql);
    if (!Array.isArray(rows) || rows.length !== 1)
      fail('TEST_DATABASE_PROBE_RESULT_INVALID', 'REFUSED', 2);
    evaluateProbe(rows[0], target, guard, applyMigrations);
  } catch (error) {
    if (error?.verifyCode) throw error;
    // ORM errors may contain the connection URL; never propagate their text.
    fail('TEST_DATABASE_IDENTITY_PROBE_FAILED', 'REFUSED', 2);
  } finally {
    try {
      await client.$disconnect();
    } catch {
      fail('TEST_DATABASE_DISCONNECT_FAILED', 'REFUSED', 2);
    }
  }
}

export function runCommand(command, args, options, spawn = spawnSync) {
  return spawn(command, args, {
    ...options,
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
}

// Keep the native Prisma DLL out of the long-lived verifier on Windows. Later
// package pretest/prebuild hooks must be able to regenerate the formal client.
export function probeDatabaseInChild(target, { applyMigrations = false } = {}, spawn = spawnSync) {
  const worker = [
    'const { resolveTestDatabase } = await import(process.env.WORKMESH_VERIFY_GUARD_MODULE);',
    'const { probeDatabase } = await import(process.env.WORKMESH_VERIFY_MODULE);',
    'try {',
    '  const selected = await resolveTestDatabase();',
    '  if (!selected.ok) throw new Error();',
    '  await probeDatabase(selected.target, { applyMigrations: process.env.WORKMESH_VERIFY_APPLY_MIGRATIONS === "1" });',
    '  process.stdout.write(JSON.stringify({ status: "IDENTITY_PASSED" }));',
    '} catch (error) {',
    '  const allowed = ["MIGRATED_TEST_DATABASE_SCHEMA_REQUIRED", "TEST_DATABASE_SERVER_IDENTITY_MISMATCH", "TEST_DATABASE_SCHEMA_IDENTITY_UNAVAILABLE", "TEST_DATABASE_PROBE_MISMATCH", "TEST_DATABASE_PROBE_RESULT_INVALID", "TEST_DATABASE_IDENTITY_PROBE_FAILED", "TEST_DATABASE_DISCONNECT_FAILED"];',
    '  process.stdout.write(JSON.stringify({ status: "REFUSED", code: allowed.includes(error?.verifyCode) ? error.verifyCode : "TEST_DATABASE_IDENTITY_PROBE_FAILED" }));',
    '  process.exitCode = 2;',
    '}',
  ].join('\n');
  const result = spawn(process.execPath, ['--input-type=module', '-e', worker], {
    cwd: ROOT,
    env: {
      ...childEnvironment(process.env, target),
      WORKMESH_VERIFY_MODULE: import.meta.url,
      WORKMESH_VERIFY_GUARD_MODULE: new URL('./lib/test-database-guard.mjs', import.meta.url).href,
      WORKMESH_VERIFY_APPLY_MIGRATIONS: applyMigrations ? '1' : '0',
    },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 64 * 1024,
  });
  // Never forward stdout/stderr from an ORM worker: both can contain secrets.
  let report;
  try {
    report = JSON.parse(result?.stdout ?? '');
  } catch {
    /* fail closed below */
  }
  if (
    !result ||
    result.error ||
    result.signal ||
    result.status !== 0 ||
    report?.status !== 'IDENTITY_PASSED'
  ) {
    const allowed = [
      'MIGRATED_TEST_DATABASE_SCHEMA_REQUIRED',
      'TEST_DATABASE_SERVER_IDENTITY_MISMATCH',
      'TEST_DATABASE_SCHEMA_IDENTITY_UNAVAILABLE',
      'TEST_DATABASE_PROBE_MISMATCH',
      'TEST_DATABASE_PROBE_RESULT_INVALID',
      'TEST_DATABASE_IDENTITY_PROBE_FAILED',
      'TEST_DATABASE_DISCONNECT_FAILED',
    ];
    fail(
      allowed.includes(report?.code) ? report.code : 'TEST_DATABASE_IDENTITY_PROBE_FAILED',
      'REFUSED',
      2,
    );
  }
}

function childEnvironment(source, target) {
  const env = {
    ...source,
    CI: '1',
    NODE_ENV: 'test',
    PRISMA_HIDE_UPDATE_MESSAGE: 'true',
    PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
    CHECKPOINT_DISABLE: '1',
    WORKMESH_POC_LIVE: '0',
    WORKMESH_GITHUB_LIVE: '0',
    WORKMESH_UI_REVIEW_PORT: source.WORKMESH_UI_REVIEW_PORT || '55444',
    WORKMESH_V1_DATABASE_URL: target?.url ?? PLACEHOLDER,
  };
  // Never expose the application fallback to a write-capable child suite.
  delete env.DATABASE_URL;
  if (target) {
    env.WORKMESH_TEST_ENV = target.env;
    env.WORKMESH_TEST_DATABASE_URL = target.url;
    env.WORKMESH_TEST_DATABASE_USERS = target.allowedUsers.join(',');
  }
  return env;
}

/** Dependencies are injectable for fail-closed orchestration tests, not skip flags. */
export async function verify(args = [], dependencies = {}) {
  const emit = dependencies.emit ?? ((event) => process.stdout.write(JSON.stringify(event) + '\n'));
  const env = dependencies.env ?? process.env;
  const run = dependencies.run ?? runCommand;
  let currentStep = 'arguments';
  const completedSteps = [];
  try {
    const options = parseArguments(args);
    if (options.help) {
      (dependencies.writeHelp ?? ((text) => process.stdout.write(text)))(USAGE);
      return 0;
    }
    currentStep = 'node-version';
    checkNodeVersion(dependencies.nodeVersion ?? process.versions.node);
    currentStep = 'pinned-pnpm';
    const pnpm = (dependencies.resolvePnpm ?? resolvePnpmEntry)(resolve(ROOT, 'package.json'), env);
    let childEnv = childEnvironment(env);
    const step = async (name, commandArgs, nodeEnv = 'test') => {
      currentStep = name;
      emit({ suite: 'local-quality', step: name, status: 'RUNNING' });
      const result = await run(process.execPath, commandArgs, {
        cwd: ROOT,
        env: { ...childEnv, NODE_ENV: nodeEnv },
      });
      if (!result || result.error || result.signal || result.status !== 0)
        fail(
          'COMMAND_FAILED',
          'FAILED',
          Number.isInteger(result?.status) && result.status > 0 ? result.status : 1,
        );
      completedSteps.push(name);
      emit({ suite: 'local-quality', step: name, status: 'PASSED' });
    };
    const pnpmStep = (name, commandArgs, nodeEnv) => step(name, [pnpm, ...commandArgs], nodeEnv);

    await pnpmStep('build-shared-guard', ['--filter', '@workmesh/shared', 'build'], 'production');
    currentStep = 'test-database-target';
    const selected = await (dependencies.resolveDatabase ?? resolveTestDatabase)();
    if (!selected?.ok) fail('TEST_DATABASE_TARGET_REFUSED', 'REFUSED', 2);
    const target = selected.target;
    childEnv = childEnvironment(env, target);
    emit({
      suite: 'local-quality',
      step: currentStep,
      status: 'PASSED',
      databaseTarget: selected.describe,
    });
    completedSteps.push(currentStep);

    await pnpmStep('generate-formal-client', [
      '--filter',
      '@workmesh/api',
      'exec',
      'prisma',
      'generate',
      '--schema',
      'prisma/schema.prisma',
    ]);
    currentStep = 'test-database-identity';
    await (dependencies.probe ?? probeDatabaseInChild)(target, {
      applyMigrations: options.applyMigrations,
    });
    emit({ suite: 'local-quality', step: currentStep, status: 'PASSED' });
    completedSteps.push(currentStep);

    await pnpmStep('format', ['format:check']);
    for (const task of ['lint', 'type-check', 'test']) {
      await pnpmStep('workspace-' + task, [
        'exec',
        'turbo',
        'run',
        task,
        '--force',
        '--env-mode=loose',
        '--concurrency=1',
      ]);
      if (task === 'lint') await pnpmStep('eslint', ['lint:eslint']);
    }
    await step('script-guards', ['--test', ...SCRIPT_TESTS]);
    await step('isolated-prisma', [resolve(ROOT, 'scripts/lib/isolated-prisma.mjs')]);
    await step('contracts', [resolve(ROOT, 'scripts/test-contracts.mjs')]);
    await pnpmStep('api-integration', [
      'test:integration',
      ...(options.applyMigrations ? ['--apply-migrations'] : []),
    ]);
    await pnpmStep('schema-drift', [
      '--filter',
      '@workmesh/api',
      'exec',
      'prisma',
      'migrate',
      'diff',
      '--from-schema-datasource',
      'prisma/schema.prisma',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--exit-code',
    ]);
    await pnpmStep(
      'workspace-build',
      ['exec', 'turbo', 'run', 'build', '--force', '--env-mode=loose', '--concurrency=1'],
      'production',
    );
    for (const directory of ['packages/shared/dist', 'apps/cli/dist', 'apps/web/dist'])
      await step('bundle-' + directory.split('/')[1], [
        resolve(ROOT, 'scripts/verify-bundle-evidence.mjs'),
        directory,
      ]);
    await pnpmStep('real-browser', ['test:browser:run']);
    await pnpmStep('ui-contracts', ['test:ui-review']);
    await pnpmStep('api-coverage', ['--filter', '@workmesh/api', 'test:coverage']);
    emit({
      suite: 'local-quality',
      status: 'LOCAL_QUALITY_PASSED',
      completedSteps,
      externalGatesNotRun: EXTERNAL_GATES_NOT_RUN,
    });
    return 0;
  } catch (error) {
    emit({
      suite: 'local-quality',
      step: currentStep,
      status: error?.verifyStatus ?? 'FAILED',
      code: error?.verifyCode ?? 'VERIFICATION_FAILED',
      completedSteps,
    });
    return error?.exitCode ?? 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = await verify(process.argv.slice(2));
