import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { createEsbuildEvidenceHooks } from './lib/bundle-evidence.mjs';
import { packageLicenses } from './package-licenses.mjs';

function put(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}
function pkg(root, name, version, license = 'MIT') {
  put(join(root, 'package.json'), { name, version, license, main: 'index.js' });
  put(join(root, 'index.js'), 'export const value = 1;');
  put(join(root, 'LICENSE'), 'license for ' + name);
}
async function build(root, dir, modules) {
  const hooks = createEsbuildEvidenceHooks({ repoRoot: root, packageDir: dir });
  let end;
  hooks.esbuildPlugins[0].setup({
    onEnd(callback) {
      end = callback;
    },
  });
  put(join(dir, 'dist', 'index.js'), 'bundled content for ' + dir);
  end({
    errors: [],
    metafile: {
      inputs: Object.fromEntries(modules.map(([path]) => [path, {}])),
      outputs: {
        [join(dir, 'dist', 'index.js')]: {
          inputs: Object.fromEntries(
            modules.map(([path, bytes]) => [path, { bytesInOutput: bytes }]),
          ),
          imports: [],
        },
      },
    },
  });
  await hooks.onSuccess();
}
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workmesh-license-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.match(root, /workmesh-license-test-[^/\\]+$/);
    rmSync(root, { recursive: true, force: true });
  });
  const repo = join(root, 'repo');
  const stage = join(root, 'stage');
  const tool = join(repo, 'apps', 'cli');
  const shared = join(repo, 'packages', 'shared');
  const direct = join(repo, 'node_modules', 'direct');
  const inner = join(repo, 'node_modules', 'inner');
  const unused = join(repo, 'node_modules', 'unused');
  put(join(repo, 'LICENSE'), 'project license');
  pkg(tool, '@workmesh/cli', '1.0.0');
  pkg(shared, '@workmesh/shared', '1.0.0');
  pkg(direct, 'direct', '2.0.0');
  pkg(inner, 'inner', '3.0.0');
  pkg(unused, 'unused', '4.0.0');
  pkg(join(repo, 'node_modules', 'tsup'), 'tsup', '1.0.0');
  pkg(join(repo, 'node_modules', 'esbuild'), 'esbuild', '1.0.0');
  await build(repo, shared, [
    [join(shared, 'index.js'), 20],
    [join(inner, 'index.js'), 5],
    [join(unused, 'index.js'), 0],
  ]);
  await build(repo, tool, [
    [join(tool, 'index.js'), 20],
    [join(direct, 'index.js'), 5],
    [join(shared, 'dist', 'index.js'), 8],
    [join(unused, 'index.js'), 0],
  ]);
  mkdirSync(join(stage, 'app', 'cli'), { recursive: true });
  cpSync(join(tool, 'dist'), join(stage, 'app', 'cli'), { recursive: true });
  const deployed = join(
    stage,
    'app',
    'api',
    'node_modules',
    '.pnpm',
    'deployed@1.0.0',
    'node_modules',
    'deployed',
  );
  pkg(deployed, 'deployed', '1.0.0');
  put(join(deployed, 'NOTICE.txt'), 'deployed notice');
  const runtime = join(root, 'runtime');
  put(join(runtime, 'LICENSE'), 'runtime license');
  return { repo, stage, direct, runtime, deployed };
}
function supplement(repo, deployed, { installed = false, text = 'exact upstream MIT text' } = {}) {
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const commit = 'a'.repeat(40);
  const path = installed ? 'README.md' : 'canvas/LICENSE';
  put(join(installed ? deployed : join(repo, 'scripts/vendor/license-texts'), path), text);
  const manifestHash = hash(readFileSync(join(deployed, 'package.json')));
  const record = {
    name: 'deployed',
    version: '1.0.0',
    licenseDeclared: 'MIT',
    packageJsonSha256: manifestHash,
    kind: installed ? 'installed-license-section' : 'exact-upstream-revision',
    gitCommit: commit,
    sourceUrl: installed
      ? 'https://registry.npmjs.org/deployed/-/deployed-1.0.0.tgz'
      : 'https://raw.githubusercontent.com/vendor/repo/' + commit + '/LICENSE',
    ...(!installed
      ? {
          manifestUrl: 'https://raw.githubusercontent.com/vendor/repo/' + commit + '/package.json',
          manifestSha256: manifestHash,
        }
      : {}),
    file: { path, bytes: Buffer.byteLength(text), sha256: hash(text) },
    scope: 'Exact fixture text; native scope remains unproven',
  };
  put(join(repo, 'scripts/vendor/license-texts/provenance.json'), {
    schemaVersion: '1.0',
    records: [record],
  });
  return record;
}

test('copies rendered and candidate license texts, deployed notices, runtime notices and project license', async (t) => {
  const { repo, stage, runtime } = await fixture(t);
  const index = packageLicenses({
    sourceRoot: repo,
    stageRoot: stage,
    bundles: ['app/cli'],
    deployedModules: ['app/api/node_modules'],
    runtimes: [{ name: 'node', root: runtime }],
  });
  assert.equal(index.status, 'PARTIAL_COVERAGE');
  assert.equal(readFileSync(join(stage, 'LICENSE'), 'utf8'), 'project license');
  assert.equal(
    index.records.find((entry) => entry.name === 'direct').scope,
    'RENDERED_BUNDLE_COMPONENT',
  );
  assert.equal(index.records.find((entry) => entry.name === 'inner').scope, 'PREBUNDLED_CANDIDATE');
  assert.equal(
    index.records.some((entry) => entry.name === 'unused'),
    false,
  );
  const deployed = index.records.find((entry) => entry.name === 'deployed');
  assert.equal(deployed.scope, 'DEPLOYED_NPM_PACKAGE');
  assert.deepEqual(
    deployed.files.map((entry) => readFileSync(join(stage, entry.path), 'utf8')).sort(),
    ['deployed notice', 'license for deployed'],
  );
  const runtimeRecord = index.records.find((entry) => entry.name === 'node');
  assert.equal(readFileSync(join(stage, runtimeRecord.files[0].path), 'utf8'), 'runtime license');
  assert.equal(JSON.stringify(index).includes(repo), false);
  assert.equal(JSON.stringify(index).includes(stage), false);
  assert.match(
    readFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), 'utf8'),
    /Partial license-text inventory/,
  );
});

test('rejects altered license bytes before writing any distribution files', async (t) => {
  const { repo, stage, direct } = await fixture(t);
  put(join(direct, 'LICENSE'), 'changed after build');
  assert.throws(
    () => packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['app/cli'] }),
    /differs from its bundle evidence/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
  assert.equal(existsSync(join(stage, 'LICENSE')), false);
});

test('rejects changed bundle output before writing any distribution files', async (t) => {
  const { repo, stage } = await fixture(t);
  put(join(stage, 'app', 'cli', 'index.js'), 'changed bundle');
  assert.throws(
    () => packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['app/cli'] }),
    /differs from evidence/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
});

test('rejects changed component metadata and a bundle escaping the stage', async (t) => {
  const { repo, stage, direct } = await fixture(t);
  const manifestPath = join(direct, 'package.json');
  const original = readFileSync(manifestPath);
  const manifest = JSON.parse(original);
  manifest.license = 'ISC';
  put(manifestPath, manifest);
  assert.throws(
    () => packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['app/cli'] }),
    /metadata is missing or changed/,
  );
  writeFileSync(manifestPath, original);
  assert.throws(
    () =>
      packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['../repo/apps/cli/dist'] }),
    /stay inside/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
});

test('records a runtime whose supplied directory has no notices and refuses overwrite', async (t) => {
  const { repo, stage } = await fixture(t);
  const index = packageLicenses({
    sourceRoot: repo,
    stageRoot: stage,
    bundles: ['app/cli'],
    runtimes: [{ name: 'node', root: join(repo, 'empty') }],
  });
  assert.equal(index.records.find((entry) => entry.name === 'node').status, 'MISSING_RUNTIME_TEXT');
  assert.throws(() => packageLicenses({ sourceRoot: repo, stageRoot: stage }), /already exists/);
});

test('rejects a directory junction escaping the distribution root', async (t) => {
  const { repo, stage } = await fixture(t);
  symlinkSync(join(repo, 'apps', 'cli', 'dist'), join(stage, 'app', 'escape'), 'junction');
  assert.throws(
    () => packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['app/escape'] }),
    /stay inside/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
});

test('produces identical notice metadata and text bytes for equivalent stages', async (t) => {
  const { repo, stage } = await fixture(t);
  const secondStage = join(dirname(stage), 'second-stage');
  cpSync(stage, secondStage, { recursive: true });
  const first = packageLicenses({ sourceRoot: repo, stageRoot: stage, bundles: ['app/cli'] });
  const second = packageLicenses({
    sourceRoot: repo,
    stageRoot: secondStage,
    bundles: ['app/cli'],
  });
  assert.deepEqual(first, second);
  assert.deepEqual(
    readFileSync(join(stage, 'licenses', 'index.json')),
    readFileSync(join(secondStage, 'licenses', 'index.json')),
  );
  for (const record of first.records)
    for (const file of record.files)
      assert.deepEqual(
        readFileSync(join(stage, file.path)),
        readFileSync(join(secondStage, file.path)),
      );
});

test('copies exact supplemental upstream text with stable public provenance and explicit PG vendor notices', async (t) => {
  const { repo, stage, runtime, deployed } = await fixture(t);
  const expected = supplement(repo, deployed);
  put(join(runtime, 'server_license.txt'), 'PG server license');
  put(join(runtime, 'commandlinetools_3rd_party_licenses.txt'), 'PG distribution notices');
  const index = packageLicenses({
    sourceRoot: repo,
    stageRoot: stage,
    deployedModules: ['app/api/node_modules'],
    runtimes: [{ name: 'postgresql', root: runtime }],
  });
  const record = index.records.find((entry) => entry.name === 'deployed');
  assert.equal(record.supplementalProvenance.sourceUrl, expected.sourceUrl);
  const file = record.files.find((entry) => entry.path.includes('/supplemental/'));
  assert.equal(readFileSync(join(stage, file.path), 'utf8'), 'exact upstream MIT text');
  assert.equal(index.records.find((entry) => entry.name === 'postgresql').files.length, 3);
  assert.equal(index.status, 'PARTIAL_COVERAGE');
  assert.equal(JSON.stringify(record).includes(repo), false);
});

test('refuses tampered supplemental bytes and mismatched package manifest before writing output', async (t) => {
  const { repo, stage, deployed } = await fixture(t);
  supplement(repo, deployed);
  put(join(repo, 'scripts/vendor/license-texts/canvas/LICENSE'), 'altered text');
  assert.throws(
    () =>
      packageLicenses({
        sourceRoot: repo,
        stageRoot: stage,
        deployedModules: ['app/api/node_modules'],
      }),
    /differs from its bundle evidence/,
  );
  supplement(repo, deployed);
  put(join(deployed, 'package.json'), {
    name: 'deployed',
    version: '1.0.0',
    license: 'MIT',
    changed: true,
  });
  assert.throws(
    () =>
      packageLicenses({
        sourceRoot: repo,
        stageRoot: stage,
        deployedModules: ['app/api/node_modules'],
      }),
    /manifest hash mismatch/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
});

test('copies exact installed README license section and refuses a prose-only replacement', async (t) => {
  const { repo, stage, deployed } = await fixture(t);
  const text =
    '## Licence\n\n(The MIT License)\nPermission is hereby granted, free of charge\nTHE SOFTWARE IS PROVIDED';
  supplement(repo, deployed, { installed: true, text });
  const index = packageLicenses({
    sourceRoot: repo,
    stageRoot: stage,
    deployedModules: ['app/api/node_modules'],
  });
  const record = index.records.find((entry) => entry.name === 'deployed');
  assert.equal(record.supplementalProvenance.kind, 'installed-license-section');
  assert.equal(
    readFileSync(
      join(stage, record.files.find((entry) => entry.path.endsWith('README.md')).path),
      'utf8',
    ),
    text,
  );
  const second = join(dirname(stage), 'readme-refusal');
  mkdirSync(join(second, 'node_modules'), { recursive: true });
  cpSync(deployed, join(second, 'node_modules/deployed'), { recursive: true });
  supplement(repo, join(second, 'node_modules/deployed'), {
    installed: true,
    text: 'MIT mentioned but no actual permission text',
  });
  assert.throws(
    () =>
      packageLicenses({ sourceRoot: repo, stageRoot: second, deployedModules: ['node_modules'] }),
    /no complete expected license section/,
  );
  assert.equal(existsSync(join(second, 'licenses')), false);
});

test('refuses non-exact upstream revision provenance', async (t) => {
  const { repo, stage, deployed } = await fixture(t);
  const record = supplement(repo, deployed);
  record.sourceUrl = 'https://raw.githubusercontent.com/vendor/repo/main/LICENSE';
  put(join(repo, 'scripts/vendor/license-texts/provenance.json'), {
    schemaVersion: '1.0',
    records: [record],
  });
  assert.throws(
    () =>
      packageLicenses({
        sourceRoot: repo,
        stageRoot: stage,
        deployedModules: ['app/api/node_modules'],
      }),
    /exact revision/,
  );
  assert.equal(existsSync(join(stage, 'licenses')), false);
});
