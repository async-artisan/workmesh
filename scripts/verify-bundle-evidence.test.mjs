import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import {
  createEsbuildEvidenceHooks,
  createRollupEvidencePlugin,
  EVIDENCE_FILE,
  validateEvidence,
  verifyBundleEvidence,
} from './lib/bundle-evidence.mjs';

function put(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}
function tools(packageDir) {
  for (const name of ['tsup', 'esbuild', 'vite', 'rollup']) {
    put(join(packageDir, 'node_modules', name, 'package.json'), {
      name,
      version: '1.2.3',
      main: 'index.js',
    });
    put(join(packageDir, 'node_modules', name, 'index.js'), '');
  }
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workmesh-bundle-evidence-'));
  const packageDir = join(root, 'apps', 'tool');
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.match(root, /workmesh-bundle-evidence-[^/\\]+$/);
    rmSync(root, { recursive: true, force: true });
  });
  put(join(packageDir, 'package.json'), { name: '@fixture/tool', version: '1.0.0' });
  put(join(packageDir, 'src', 'index.js'), 'export const answer = 42; // private fixture source');
  put(join(packageDir, 'src', 'unused.js'), 'export const unused = true;');
  put(join(packageDir, 'dist', 'index.js'), 'export const answer=42;');
  put(join(packageDir, 'dist', 'index.js.map'), '{}');
  put(join(packageDir, 'node_modules', '@fixture', 'dependency', 'package.json'), {
    name: '@fixture/dependency',
    version: '2.3.4',
    license: 'MIT',
  });
  put(
    join(packageDir, 'node_modules', '@fixture', 'dependency', 'index.js'),
    'export const used = 1;',
  );
  put(join(packageDir, 'node_modules', '@fixture', 'dependency', 'LICENSE'), 'MIT fixture license');
  tools(packageDir);
  return { root, packageDir, dist: join(packageDir, 'dist') };
}
function runGraph(
  root,
  packageDir,
  { extraInputs = [], extraModules = {}, externalImports = ['node:fs', 'node:fs'] } = {},
) {
  const hooks = createEsbuildEvidenceHooks({ repoRoot: root, packageDir });
  let end;
  hooks.esbuildPlugins[0].setup({
    onEnd(callback) {
      end = callback;
    },
  });
  end({
    errors: [],
    metafile: {
      inputs: Object.fromEntries(
        [
          'src/index.js',
          'src/unused.js',
          'node_modules/@fixture/dependency/index.js',
          ...extraInputs,
        ].map((id) => [id, {}]),
      ),
      outputs: {
        'dist/index.js': {
          inputs: {
            'src/index.js': { bytesInOutput: 12 },
            'node_modules/@fixture/dependency/index.js': { bytesInOutput: 4 },
            ...extraModules,
          },
          imports: externalImports.map((path) => ({ path, external: true })),
        },
        'dist/index.js.map': { inputs: {}, imports: [] },
      },
    },
  });
  return hooks.onSuccess();
}
async function built(t) {
  const f = fixture(t);
  await runGraph(f.root, f.packageDir);
  f.read = () => JSON.parse(readFileSync(join(f.dist, EVIDENCE_FILE), 'utf8'));
  f.write = (evidence) => put(join(f.dist, EVIDENCE_FILE), evidence);
  return f;
}

test('esbuild graph binds final files, actual fixed package metadata, licenses and omitted inputs', async (t) => {
  const f = await built(t);
  const evidence = f.read();
  const summary = verifyBundleEvidence(f.dist);
  assert.equal(summary.files, 2);
  assert.equal(summary.rendered, 2);
  assert.equal(summary.treeShaken, 1);
  assert.equal(evidence.outputs[0].externalImports.length, 1);
  assert.equal(
    evidence.outputs[0].sha256,
    createHash('sha256')
      .update(readFileSync(join(f.dist, 'index.js')))
      .digest('hex'),
  );
  const dep = evidence.components.find((entry) => entry.name === '@fixture/dependency');
  assert.equal(dep.id, 'pkg:npm/%40fixture/dependency@2.3.4');
  assert.equal(dep.licenseDeclared, 'MIT');
  assert.equal(dep.licenseFiles.length, 1);
  assert.equal(dep.licenseFileStatus, 'RECORDED');
  assert.equal(
    evidence.components.find((entry) => entry.name === '@fixture/tool').licenseFileStatus,
    'UNKNOWN',
  );
  assert.equal(
    evidence.components.find((entry) => entry.name === '@fixture/tool').licenseDeclared,
    'UNKNOWN',
  );
  assert.equal(evidence.nonRenderedModules[0].contribution.state, 'tree-shaken');
  assert(!JSON.stringify(evidence).includes(f.root));
  assert(!JSON.stringify(evidence).includes('private fixture source'));
  put(join(f.dist, 'index.d.ts'), 'export declare const answer: number;');
  assert.equal(verifyBundleEvidence(f.dist).files, 2);
});

test('same-length output tampering, missing files and extra files are rejected', async (t) => {
  const f = await built(t);
  const output = join(f.dist, 'index.js');
  const original = readFileSync(output);
  put(output, original.toString().replace('42', '43'));
  assert.throws(() => verifyBundleEvidence(f.dist), /differs from evidence/);
  writeFileSync(output, original);
  renameSync(output, join(f.dist, 'renamed.js'));
  assert.throws(() => verifyBundleEvidence(f.dist), /file set differs/);
  renameSync(join(f.dist, 'renamed.js'), output);
  put(join(f.dist, 'extra.js'), 'injected');
  assert.throws(() => verifyBundleEvidence(f.dist), /file set differs/);
});

test('output links are rejected without following an external target', async (t) => {
  const f = await built(t);
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(f.dist, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyBundleEvidence(f.dist), /symbolic link/);
});

const invalid = [
  [
    'JavaScript without graph',
    (e) => {
      e.outputs[0].kind = 'asset';
      e.outputs[0].modules = [];
    },
  ],
  [
    'false license file coverage',
    (e) => {
      e.components.find((entry) => !entry.licenseFiles.length).licenseFileStatus = 'RECORDED';
    },
  ],
  [
    'unknown schema',
    (e) => {
      e.schemaVersion = '2.0';
    },
  ],
  [
    'unknown field',
    (e) => {
      e.hostPath = 'private';
    },
  ],
  [
    'absolute path',
    (e) => {
      e.outputs[0].path = 'C:/private/index.js';
    },
  ],
  [
    'traversal',
    (e) => {
      e.outputs[0].path = '../index.js';
    },
  ],
  [
    'duplicate output',
    (e) => {
      e.outputs.push(e.outputs[0]);
    },
  ],
  [
    'duplicate module',
    (e) => {
      e.outputs[0].modules.push(e.outputs[0].modules[0]);
    },
  ],
  [
    'unknown component',
    (e) => {
      e.outputs[0].modules[0].component = 'pkg:npm/absent@1.0.0';
    },
  ],
  [
    'version range',
    (e) => {
      e.components[0].version = '^1.0.0';
    },
  ],
  [
    'invalid hash',
    (e) => {
      e.outputs[0].sha256 = 'not-a-hash';
    },
  ],
  [
    'empty chunk graph',
    (e) => {
      e.outputs[0].modules = [];
    },
  ],
  [
    'false tree-shaken bytes',
    (e) => {
      e.outputs[0].modules[0].contribution.state = 'tree-shaken';
    },
  ],
  [
    'non-rendered inclusion',
    (e) => {
      e.nonRenderedModules[0].contribution.state = 'rendered';
    },
  ],
];
for (const [name, mutate] of invalid)
  test('schema rejects ' + name, async (t) => {
    const f = await built(t);
    const evidence = f.read();
    mutate(evidence);
    assert.throws(() => validateEvidence(evidence));
  });

test('prebundle graph requires matching bytes and labels inner modules as candidates', async (t) => {
  const f = fixture(t);
  const child = join(f.root, 'packages', 'prebuilt');
  put(join(child, 'package.json'), { name: '@fixture/prebuilt', version: '1.0.0' });
  for (const path of [
    'src/index.js',
    'src/unused.js',
    'node_modules/@fixture/dependency/package.json',
    'node_modules/@fixture/dependency/index.js',
    'node_modules/@fixture/dependency/LICENSE',
    'dist/index.js',
    'dist/index.js.map',
  ]) {
    const bytes = readFileSync(join(f.packageDir, path));
    mkdirSync(dirname(join(child, path)), { recursive: true });
    writeFileSync(join(child, path), bytes);
  }
  tools(child);
  await runGraph(f.root, child);
  const input = '../../packages/prebuilt/dist/index.js';
  const graph = { extraInputs: [input], extraModules: { [input]: { bytesInOutput: 3 } } };
  await runGraph(f.root, f.packageDir, graph);
  const evidence = JSON.parse(readFileSync(join(f.dist, EVIDENCE_FILE), 'utf8'));
  const module = evidence.outputs[0].modules.find(
    (entry) => entry.component === 'pkg:npm/%40fixture/prebuilt@1.0.0',
  );
  assert.equal(module.prebundle.opaque, false);
  assert(
    module.prebundle.modules.every((entry) => entry.contribution.state === 'prebundled-candidate'),
  );
  assert.equal(verifyBundleEvidence(f.dist).prebundledCandidates, 2);
  const falseInclusion = JSON.parse(JSON.stringify(evidence));
  falseInclusion.outputs[0].modules
    .find((entry) => entry.prebundle)
    ?.prebundle.modules.forEach((entry) => {
      entry.contribution.state = 'rendered';
    });
  assert.throws(() => validateEvidence(falseInclusion), /must be candidates/);
  put(join(child, 'dist', 'index.js'), 'export const answer=43;');
  await assert.rejects(runGraph(f.root, f.packageDir, graph), /differs from evidence/);
});

test('workspace prebundle without a graph stays explicitly opaque', async (t) => {
  const f = fixture(t);
  const child = join(f.root, 'packages', 'prebuilt');
  put(join(child, 'package.json'), { name: '@fixture/prebuilt', version: '1.0.0' });
  put(join(child, 'dist', 'index.js'), 'export const a=1;');
  const input = '../../packages/prebuilt/dist/index.js';
  await runGraph(f.root, f.packageDir, {
    extraInputs: [input],
    extraModules: { [input]: { bytesInOutput: 2 } },
  });
  assert.equal(verifyBundleEvidence(f.dist).opaquePrebundles, 1);
});

test('missing real bundler input is rejected instead of disguised as virtual', async (t) => {
  const f = fixture(t);
  await assert.rejects(
    runGraph(f.root, f.packageDir, { extraInputs: ['src/missing.js'] }),
    /input file is missing/,
  );
});

test('Rollup records rendered, zero-byte and virtual modules without publishing host paths', (t) => {
  const f = fixture(t);
  const rendered = join(f.packageDir, 'src', 'index.js');
  const unused = join(f.packageDir, 'src', 'unused.js');
  const virtual = '\0' + join(f.root, 'private-generated-module');
  const plugin = createRollupEvidencePlugin({ repoRoot: f.root, packageDir: f.packageDir });
  plugin.writeBundle.call(
    {
      getModuleIds: () => [rendered, unused, virtual],
      getModuleInfo: () => ({ isExternal: false }),
    },
    { dir: f.dist },
    {
      'index.js': {
        type: 'chunk',
        fileName: 'index.js',
        modules: {
          [rendered]: { renderedLength: 12 },
          [unused]: { renderedLength: 0 },
          [virtual]: { renderedLength: 1 },
        },
        imports: [],
        dynamicImports: [],
      },
    },
  );
  const evidence = JSON.parse(readFileSync(join(f.dist, EVIDENCE_FILE), 'utf8'));
  assert.equal(verifyBundleEvidence(f.dist).rendered, 2);
  assert.equal(verifyBundleEvidence(f.dist).virtual, 1);
  assert(evidence.outputs[0].modules.some((entry) => entry.contribution.state === 'tree-shaken'));
  assert(!JSON.stringify(evidence).includes(f.root));
});

const unsafeLicenses = [
  'SEE LICENSE IN /Users/alice/private/LICENSE',
  'SEE LICENSE IN file:///C:/Users/alice/private/LICENSE',
  'SEE LICENSE IN file:///home/alice/private/LICENSE',
  'file:/home/alice/private/LICENSE',
  'See license at C:/Users/alice/private/LICENSE',
  'License=/home/alice/private/LICENSE',
  'SEE LICENSE IN ../private/LICENSE',
  'SEE LICENSE IN licenses/../../private/LICENSE',
  'SEE LICENSE IN ~/private/LICENSE',
];
for (const [index, license] of unsafeLicenses.entries())
  test('collector and validator reject unsafe license metadata ' + index, async (t) => {
    const f = await built(t);
    const evidence = f.read();
    evidence.components.find((entry) => entry.name === '@fixture/dependency').licenseDeclared =
      license;
    assert.throws(() => validateEvidence(evidence));
    put(join(f.packageDir, 'node_modules', '@fixture', 'dependency', 'package.json'), {
      name: '@fixture/dependency',
      version: '2.3.4',
      license,
    });
    await assert.rejects(runGraph(f.root, f.packageDir));
  });

for (const license of [
  'MIT',
  '(MIT OR Apache-2.0)',
  'GPL-2.0-only WITH Classpath-exception-2.0',
  'BSD-2-Clause/MIT',
  'https://opensource.org/licenses/MIT',
  'See license at https://example.org/licenses/MIT',
  'SEE LICENSE IN licenses/MIT.txt',
  'SEE LICENSE IN ./LICENSE',
])
  test('safe license metadata is preserved: ' + license, async (t) => {
    const f = fixture(t);
    put(join(f.packageDir, 'node_modules', '@fixture', 'dependency', 'package.json'), {
      name: '@fixture/dependency',
      version: '2.3.4',
      license,
    });
    await runGraph(f.root, f.packageDir);
    const evidence = JSON.parse(readFileSync(join(f.dist, EVIDENCE_FILE), 'utf8'));
    assert.equal(
      evidence.components.find((entry) => entry.name === '@fixture/dependency').licenseDeclared,
      license,
    );
    assert.equal(verifyBundleEvidence(f.dist).components, 2);
  });

for (const [index, specifier] of [
  'file:///C:/Users/alice/private/dependency.js',
  'file:///home/alice/private/dependency.js',
  'file:/home/alice/private/dependency.js',
  '/home/alice/private/dependency.js',
  'C:/Users/alice/private/dependency.js',
  '~/private/dependency.js',
].entries())
  test('collector and validator reject unsafe external import ' + index, async (t) => {
    const f = await built(t);
    const evidence = f.read();
    evidence.outputs[0].externalImports = [{ specifier, kind: 'unmapped-external' }];
    assert.throws(() => validateEvidence(evidence));
    await assert.rejects(runGraph(f.root, f.packageDir, { externalImports: [specifier] }));
  });

test('safe package, builtin and HTTPS external imports remain visible and unmapped where appropriate', async (t) => {
  const f = fixture(t);
  await runGraph(f.root, f.packageDir, {
    externalImports: ['node:fs', 'some-package/subpath', 'https://cdn.example.org/module.js'],
  });
  const evidence = JSON.parse(readFileSync(join(f.dist, EVIDENCE_FILE), 'utf8'));
  assert.equal(evidence.outputs[0].externalImports.length, 3);
  assert.equal(verifyBundleEvidence(f.dist).files, 2);
});
