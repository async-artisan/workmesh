import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import {
  EXTERNAL_GATES_NOT_RUN,
  SCRIPT_TESTS,
  checkNodeVersion,
  evaluateProbe,
  parseArguments,
  probeDatabaseInChild,
  resolveGeneratedClientPath,
  runCommand,
  verify,
} from './verify.mjs';

test('identity probe awaits a short-lived native worker and keeps credentials out of argv', () => {
  let invocation;
  probeDatabaseInChild(target, { applyMigrations: true }, (...values) => {
    invocation = values;
    return { status: 0, stdout: JSON.stringify({ status: 'IDENTITY_PASSED' }) };
  });
  const [command, args, options] = invocation;
  assert.equal(command, process.execPath);
  assert.deepEqual(args.slice(0, 2), ['--input-type=module', '-e']);
  assert.doesNotMatch(JSON.stringify(args), /private_test_secret|postgresql:/);
  assert.match(args[2], /await probeDatabase/);
  assert.equal(options.env.WORKMESH_TEST_DATABASE_URL, target.url);
  assert.equal(options.env.WORKMESH_VERIFY_APPLY_MIGRATIONS, '1');
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(options.timeout, 30_000);
  assert.equal(options.encoding, 'utf8');
});

test('identity worker refuses failures and never propagates untrusted ORM output', () => {
  for (const result of [
    {
      status: 2,
      stdout: JSON.stringify({ status: 'REFUSED', code: 'MIGRATED_TEST_DATABASE_SCHEMA_REQUIRED' }),
    },
    { status: 0, stdout: target.url },
    { status: null, signal: 'SIGTERM', stderr: target.url },
    {
      status: 0,
      error: new Error(target.url),
      stdout: JSON.stringify({ status: 'IDENTITY_PASSED' }),
    },
    { status: 2, stdout: JSON.stringify({ status: 'REFUSED', code: target.url }) },
  ]) {
    assert.throws(
      () => probeDatabaseInChild(target, {}, () => result),
      (error) => error.exitCode === 2 && !/private_test_secret|postgresql:/.test(error.message),
    );
  }
});

const target = {
  url: 'postgresql://test_user:private_test_secret@127.0.0.1:55449/workmesh_test_verify?schema=workmesh_v1',
  env: 'ci',
  host: '127.0.0.1',
  port: '55449',
  database: 'workmesh_test_verify',
  user: 'test_user',
  schema: 'workmesh_v1',
  allowedUsers: ['test_user'],
};
const safeDescription = { database: target.database, user: target.user, schema: target.schema };
const guard = {
  evaluateIdentityProbe(probe, expected) {
    return { ok: ['database', 'user', 'schema'].every((key) => probe[key] === expected[key]) };
  },
};
const validProbe = {
  database: target.database,
  user: target.user,
  schema: target.schema,
  schema_exists: true,
  server_addr: '127.0.0.1',
};

function fixture(overrides = {}) {
  const calls = [];
  const events = [];
  const probes = [];
  const dependencies = {
    nodeVersion: '20.19.0',
    env: {
      DATABASE_URL: 'postgresql://app:application_secret@production/business',
      WORKMESH_V1_DATABASE_URL: 'postgresql://app:application_secret@production/business',
      WORKMESH_TEST_DATABASE_URL: target.url,
      WORKMESH_TEST_ENV: 'ci',
      WORKMESH_POC_LIVE: '1',
      WORKMESH_GITHUB_LIVE: '1',
    },
    resolvePnpm: () => 'pinned-pnpm.cjs',
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0 };
    },
    resolveDatabase: async () => {
      calls.push({ guard: true });
      return { ok: true, target, describe: safeDescription };
    },
    probe: async (selected, options) => {
      probes.push({ target: selected, options });
      calls.push({ probe: true });
    },
    emit: (event) => events.push(event),
    ...overrides,
  };
  return { dependencies, calls, events, probes };
}

test('only help and explicit migration flags are accepted, including pnpm delimiter', () => {
  assert.deepEqual(parseArguments([]), { help: false, applyMigrations: false });
  assert.deepEqual(parseArguments(['--', '--apply-migrations']), {
    help: false,
    applyMigrations: true,
  });
  assert.deepEqual(parseArguments(['--help']), { help: true });
  for (const args of [
    ['--skip-db'],
    ['--skip-browser'],
    ['--apply-migrations', '--apply-migrations'],
    ['--help', '--apply-migrations'],
    ['postgresql://user:secret@localhost/db'],
    ['--', '--', '--help'],
  ])
    assert.throws(() => parseArguments(args), /INVALID_ARGUMENTS/);
});

test('Node baseline enforces 20.19.0 and permits later supported major versions', () => {
  for (const version of ['20.19.0', '20.20.1', '22.0.0', '24.22.1']) checkNodeVersion(version);
  for (const version of ['20.13.1', '20.18.9', '18.20.0', 'invalid'])
    assert.throws(() => checkNodeVersion(version), /NODE_20_19_OR_NEWER_REQUIRED/);
});

test('help and rejected arguments execute no subprocess, probe or package lookup', async () => {
  for (const args of [['--help'], ['--skip-browser'], [target.url]]) {
    const state = fixture({ resolvePnpm: () => assert.fail('package lookup must not run') });
    let help = '';
    state.dependencies.writeHelp = (text) => {
      help += text;
    };
    assert.equal(await verify(args, state.dependencies), args[0] === '--help' ? 0 : 2);
    assert.equal(state.calls.length, 0);
    assert.equal(state.probes.length, 0);
    assert.doesNotMatch(JSON.stringify(state.events), /private_test_secret|postgresql:/);
    if (args[0] === '--help') assert.match(help, /LOCAL_QUALITY_PASSED/);
  }
});

test('missing or invalid explicit database target refuses after shared build and before any database or unit test', async () => {
  const state = fixture({
    resolveDatabase: async () => ({
      ok: false,
      rejection: { code: 'MISSING', message: target.url },
    }),
  });
  assert.equal(await verify([], state.dependencies), 2);
  assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0].args, [
    'pinned-pnpm.cjs',
    '--filter',
    '@workmesh/shared',
    'build',
  ]);
  assert.equal(state.probes.length, 0);
  assert.equal(state.events.at(-1).status, 'REFUSED');
  assert.doesNotMatch(
    JSON.stringify(state.events),
    /postgresql:|private_test_secret|application_secret/,
  );
});

test('default verifies every local gate in order and reports external gates unrun', async () => {
  const state = fixture();
  assert.equal(await verify([], state.dependencies), 0);
  assert.deepEqual(
    state.calls
      .slice(0, 4)
      .map((call) => (call.guard ? 'guard' : call.probe ? 'probe' : call.args[1])),
    ['--filter', 'guard', '--filter', 'probe'],
  );
  const steps = state.events
    .filter((event) => event.status === 'PASSED')
    .map((event) => event.step);
  for (const [earlier, later] of [
    ['build-shared-guard', 'test-database-target'],
    ['test-database-target', 'generate-formal-client'],
    ['generate-formal-client', 'test-database-identity'],
    ['test-database-identity', 'format'],
    ['workspace-test', 'script-guards'],
    ['script-guards', 'isolated-prisma'],
    ['contracts', 'api-integration'],
    ['api-integration', 'schema-drift'],
    ['workspace-build', 'bundle-shared'],
    ['bundle-web', 'real-browser'],
    ['real-browser', 'ui-contracts'],
    ['ui-contracts', 'api-coverage'],
  ])
    assert.ok(steps.indexOf(earlier) < steps.indexOf(later), earlier + ' must precede ' + later);
  assert.deepEqual(state.probes[0].options, { applyMigrations: false });
  const commands = state.calls.filter((call) => call.args);
  for (const call of commands) assert.equal(call.command, process.execPath);
  for (const call of commands.filter((call) => call.args.includes('turbo'))) {
    assert.ok(call.args.includes('--force'));
    assert.ok(call.args.includes('--env-mode=loose'));
  }
  const scriptGuards = commands.find((call) => call.args[0] === '--test');
  for (const filename of SCRIPT_TESTS) assert.ok(scriptGuards.args.includes(filename));
  const integration = commands.find((call) => call.args.includes('test:integration'));
  assert.ok(!integration.args.includes('--apply-migrations'));
  assert.ok(!commands.some((call) => call.args.includes('deploy')));
  const drift = commands.find((call) => call.args.includes('diff'));
  assert.ok(drift.args.includes('--from-schema-datasource'));
  assert.ok(!drift.args.includes('--from-url'));
  assert.ok(!commands.some((call) => call.args.some((arg) => arg.includes('postgresql:'))));
  assert.equal(state.events.at(-1).status, 'LOCAL_QUALITY_PASSED');
  assert.deepEqual(state.events.at(-1).externalGatesNotRun, EXTERNAL_GATES_NOT_RUN);
  assert.doesNotMatch(
    JSON.stringify(state.events),
    /private_test_secret|application_secret|postgresql:/,
  );
});

test('child environment isolates the verified target, disables external calls and does not mutate parent', async () => {
  const state = fixture();
  const original = { ...state.dependencies.env };
  assert.equal(await verify([], state.dependencies), 0);
  const commands = state.calls.filter((call) => call.options);
  for (const call of commands) {
    assert.equal(call.options.env.DATABASE_URL, undefined);
    assert.equal(call.options.env.WORKMESH_POC_LIVE, '0');
    assert.equal(call.options.env.WORKMESH_GITHUB_LIVE, '0');
    assert.equal(call.options.env.CI, '1');
    assert.equal(call.options.env.WORKMESH_UI_REVIEW_PORT, '55444');
    assert.equal(call.options.env.NODE_ENV, call.args.includes('build') ? 'production' : 'test');
  }
  assert.match(commands[0].options.env.WORKMESH_V1_DATABASE_URL, /placeholder@127\.0\.0\.1:1/);
  for (const call of commands.slice(1)) {
    assert.equal(call.options.env.WORKMESH_V1_DATABASE_URL, target.url);
    assert.equal(call.options.env.WORKMESH_TEST_DATABASE_URL, target.url);
    assert.equal(call.options.env.WORKMESH_TEST_DATABASE_USERS, 'test_user');
  }
  assert.deepEqual(state.dependencies.env, original);
});

test('only build steps use production without leaking their environment into tests or the caller', async () => {
  const processNodeEnv = process.env.NODE_ENV;
  for (const parentNodeEnv of [undefined, 'development', 'test', 'production']) {
    const state = fixture();
    if (parentNodeEnv === undefined) delete state.dependencies.env.NODE_ENV;
    else state.dependencies.env.NODE_ENV = parentNodeEnv;
    const original = { ...state.dependencies.env };
    const environments = [];
    state.dependencies.run = (_command, _args, options) => {
      environments.push({ step: state.events.at(-1).step, nodeEnv: options.env.NODE_ENV });
      // A child adapter receives its own copy, including across the build boundary.
      options.env.NODE_ENV = 'mutated-by-child';
      return { status: 0 };
    };
    assert.equal(await verify([], state.dependencies), 0);
    assert.deepEqual(
      environments.filter(({ nodeEnv }) => nodeEnv === 'production').map(({ step }) => step),
      ['build-shared-guard', 'workspace-build'],
    );
    for (const { step, nodeEnv } of environments)
      assert.equal(
        nodeEnv,
        ['build-shared-guard', 'workspace-build'].includes(step) ? 'production' : 'test',
        step,
      );
    for (const step of [
      'generate-formal-client',
      'workspace-test',
      'api-integration',
      'schema-drift',
      'real-browser',
      'ui-contracts',
      'api-coverage',
    ])
      assert.ok(environments.some((entry) => entry.step === step && entry.nodeEnv === 'test'));
    assert.deepEqual(state.dependencies.env, original);
    assert.equal(process.env.NODE_ENV, processNodeEnv);
  }
});

test('migration authorization is forwarded only after successful identity probe', async () => {
  const state = fixture();
  assert.equal(await verify(['--apply-migrations'], state.dependencies), 0);
  assert.equal(state.probes[0].options.applyMigrations, true);
  const integrationIndex = state.calls.findIndex((call) => call.args?.includes('test:integration'));
  assert.ok(integrationIndex > state.calls.findIndex((call) => call.probe));
  assert.ok(state.calls[integrationIndex].args.includes('--apply-migrations'));
});

test('a failed identity probe runs neither write-capable suites nor migration commands and redacts errors', async () => {
  const state = fixture({
    probe: async () => {
      throw new Error(target.url);
    },
  });
  assert.equal(await verify(['--apply-migrations'], state.dependencies), 1);
  const commands = state.calls.filter((call) => call.args);
  assert.equal(commands.length, 2);
  assert.ok(!commands.some((call) => call.args.includes('test:integration')));
  assert.doesNotMatch(JSON.stringify(state.events), /private_test_secret|postgresql:/);
});

for (const result of [
  { status: 7 },
  { status: null },
  { status: null, signal: 'SIGTERM' },
  { status: 0, signal: 'SIGTERM' },
  { status: 0, error: new Error(target.url) },
  undefined,
])
  test(
    'subprocess nonzero, null, signal and spawn error each stop immediately: ' +
      JSON.stringify(result),
    async () => {
      const state = fixture({ run: () => result });
      assert.equal(await verify([], state.dependencies), result?.status === 7 ? 7 : 1);
      assert.equal(state.calls.length, 0);
      assert.equal(state.probes.length, 0);
      assert.equal(state.events.at(-1).step, 'build-shared-guard');
      assert.doesNotMatch(JSON.stringify(state.events), /private_test_secret|postgresql:/);
    },
  );

test('a late failure prevents all subsequent gates and cannot print success', async () => {
  const state = fixture();
  const originalRun = state.dependencies.run;
  state.dependencies.run = (command, args, options) =>
    args.includes('test:browser:run') ? { status: 4 } : originalRun(command, args, options);
  assert.equal(await verify([], state.dependencies), 4);
  assert.ok(!state.calls.some((call) => call.args?.includes('test:ui-review')));
  assert.ok(!state.calls.some((call) => call.args?.includes('test:coverage')));
  assert.ok(!state.events.some((event) => event.status === 'LOCAL_QUALITY_PASSED'));
});

test('real process adapter passes argument arrays without shell, hides Windows console and keeps cwd/env', () => {
  let invocation;
  const args = ['path with spaces/pnpm.cjs', '--filter', '@workmesh/api'];
  const options = { cwd: 'G:/project with spaces', env: { ONLY_THIS: 'value' } };
  assert.deepEqual(
    runCommand(process.execPath, args, options, (...values) => {
      invocation = values;
      return { status: 0 };
    }),
    { status: 0 },
  );
  assert.deepEqual(invocation, [
    process.execPath,
    args,
    { ...options, stdio: 'inherit', shell: false, windowsHide: true },
  ]);
});

test('identity checks database, user, schema and actual loopback server; migration only permits absent schema', () => {
  evaluateProbe(validProbe, target, guard);
  for (const override of [
    { database: 'business' },
    { user: 'wrong_user' },
    { schema: 'public' },
    { server_addr: '192.0.2.10' },
    { server_addr: null },
    { schema_exists: undefined },
  ])
    assert.throws(
      () => evaluateProbe({ ...validProbe, ...override }, target, guard),
      /IDENTITY|PROBE_MISMATCH/,
    );
  const absent = { ...validProbe, schema: '', schema_exists: false };
  assert.throws(
    () => evaluateProbe(absent, target, guard),
    /MIGRATED_TEST_DATABASE_SCHEMA_REQUIRED/,
  );
  evaluateProbe(absent, target, guard, true);
  assert.throws(
    () => evaluateProbe({ ...absent, database: 'business' }, target, guard, true),
    /PROBE_MISMATCH/,
  );
  assert.throws(
    () => evaluateProbe({ ...validProbe, schema: 'public' }, target, guard, true),
    /PROBE_MISMATCH/,
  );
  for (const server_addr of ['::1', '::ffff:127.0.0.1'])
    evaluateProbe({ ...validProbe, server_addr }, target, guard);
});

test('formal generated client output follows schema location including paths with spaces', () => {
  const schema = resolve('project with spaces/apps/api/prisma/schema.prisma');
  const source =
    'generator client {\n provider = "prisma-client-js"\n output = "../../node_modules/.prisma/workmesh-v1-client"\n}';
  assert.equal(
    resolveGeneratedClientPath(schema, source),
    resolve('project with spaces/apps/node_modules/.prisma/workmesh-v1-client'),
  );
  assert.throws(
    () => resolveGeneratedClientPath(schema, 'generator client {}'),
    /PRISMA_GENERATOR_OUTPUT_UNAVAILABLE/,
  );
});
