import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { mergeBundleSbom, runCli } from './merge-bundle-sbom.mjs';
import { createCycloneDxValidator } from './validate-cyclonedx.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const archiveSha256 = hash('verified archive fixture');
const PREFIX = 'workmesh:bundle:';
const purl = (name, version = '1.2.3') =>
  'pkg:npm/' + name.split('/').map(encodeURIComponent).join('/') + '@' + version;
function component(name, version = '1.2.3') {
  return {
    id: purl(name, version),
    name,
    version,
    source: 'npm',
    packageJsonSha256: hash(name + version),
    licenseDeclared: 'MIT',
    licenseFiles: [{ path: 'LICENSE', bytes: 3, sha256: hash('MIT') }],
    licenseFileStatus: 'RECORDED',
  };
}
function module(name, state = 'rendered', bytes = state === 'tree-shaken' ? 0 : 2) {
  return {
    id: purl(name) + '#index.js',
    sourceKind: 'npm',
    sha256: hash(name),
    component: purl(name),
    prebundle: null,
    contribution: { state, metric: 'esbuild-bytes-in-output', bytes },
  };
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'workmesh-merge-sbom-'));
  t.after(() => {
    assert.equal(dirname(root), resolve(tmpdir()));
    assert.match(root, /workmesh-merge-sbom-[^/\\]+$/);
    rmSync(root, { recursive: true, force: true });
  });
  const archiveRoot = join(root, 'archive');
  const directory = 'app/cli';
  const dist = join(archiveRoot, directory);
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'index.js'), 'export const fixture=1;');
  const output = readFileSync(join(dist, 'index.js'));
  const direct = module('@fixture/direct');
  direct.prebundle = {
    opaque: false,
    evidenceSha256: hash('prebundle'),
    outputPath: 'index.js',
    outputSha256: direct.sha256,
    attribution: 'prebundled-candidates',
    modules: [module('candidate', 'prebundled-candidate')],
  };
  const generated = module('generated');
  generated.id += '?generated=' + hash('generated');
  generated.sourceKind = 'generated';
  const evidence = {
    schemaVersion: '1.0',
    kind: 'workmesh-bundle-evidence',
    status: 'PARTIAL_MODULE_EVIDENCE',
    package: { name: '@fixture/cli', version: '1.0.0' },
    tool: [{ name: 'esbuild', version: '1.2.3' }],
    scope: {
      outputs: 'archive bundle bytes',
      attribution: 'partial graph',
      limitations: ['prebundle candidates only'],
    },
    components: ['@fixture/direct', 'shaken', 'candidate', 'generated', 'zero', 'nonrendered'].map(
      (name) => component(name),
    ),
    outputs: [
      {
        path: 'index.js',
        kind: 'chunk',
        bytes: output.length,
        sha256: hash(output),
        externalImports: [],
        modules: [
          direct,
          module('shaken', 'tree-shaken'),
          module('zero', 'rendered', 0),
          generated,
          {
            id: 'virtual/' + hash('virtual'),
            sourceKind: 'virtual',
            sha256: null,
            component: null,
            prebundle: null,
            contribution: { state: 'rendered', metric: 'esbuild-bytes-in-output', bytes: 3 },
          },
        ],
      },
    ],
    nonRenderedModules: [module('nonrendered', 'tree-shaken')],
  };
  const write = () => writeFileSync(join(dist, 'bundle-evidence.json'), JSON.stringify(evidence));
  write();
  const document = {
    bomFormat: 'CycloneDX',
    specVersion: '1.7',
    version: 1,
    metadata: { component: { 'bom-ref': 'root', type: 'application', name: 'fixture' } },
    components: [
      { 'bom-ref': 'runtime', type: 'application', name: 'Node.js', version: '20.19.0' },
    ],
    dependencies: [{ ref: 'root', dependsOn: ['runtime'] }],
  };
  const options = { archiveRoot, archiveSha256, bundleDirectories: [directory] };
  return { root, archiveRoot, dist, evidence, write, document, options };
}

test('promotes only direct positive rendered modules, preserves Syft data and edges, records hash-bound provenance', (t) => {
  const f = fixture(t);
  const original = globalThis.structuredClone(f.document);
  const result = mergeBundleSbom(f.document, f.options);
  assert.deepEqual(f.document, original);
  assert.deepEqual(result.document.dependencies, original.dependencies);
  assert.deepEqual(result.document.components[0], original.components[0]);
  assert.equal(result.summary.addedComponents, 1);
  assert.equal(result.summary.renderedModules, 1);
  const added = result.document.components[1];
  assert.equal(added.purl, purl('@fixture/direct'));
  assert.equal(added.licenses, undefined);
  const proof = JSON.parse(
    added.properties.find((entry) => entry.name === PREFIX + 'provenance').value,
  );
  assert.equal(proof.archiveSha256, archiveSha256);
  assert.equal(proof.evidencePath, 'app/cli/bundle-evidence.json');
  assert.equal(proof.evidenceSha256, hash(readFileSync(join(f.dist, 'bundle-evidence.json'))));
  assert.equal(proof.outputSha256, hash(readFileSync(join(f.dist, 'index.js'))));
  assert.equal(proof.renderedBytes, 2);
  assert(!JSON.stringify(result.document).includes(f.root));
  assert.equal(
    result.document.metadata.properties.find((entry) => entry.name === 'workmesh:inventory:status')
      .value,
    'DRAFT_PARTIAL_COVERAGE',
  );
  assert.deepEqual(createCycloneDxValidator()(result.document), { valid: true, errors: [] });
});

test('deduplicates matching encoded npm PURLs while retaining all Syft metadata and dependency references', (t) => {
  const f = fixture(t);
  const existing = {
    'bom-ref': 'syft-id',
    type: 'library',
    name: '@fixture/direct',
    version: '1.2.3',
    purl: 'pkg:npm/@fixture/direct@1.2.3',
    licenses: [{ license: { id: 'Apache-2.0' } }],
    properties: [{ name: 'syft:foundBy', value: 'fixture' }],
  };
  f.document.components.push(existing);
  f.document.dependencies[0].dependsOn.push('syft-id');
  const { document, summary } = mergeBundleSbom(f.document, f.options);
  assert.equal(summary.addedComponents, 0);
  assert.equal(summary.matchedComponents, 1);
  assert.equal(document.components.length, 2);
  assert.deepEqual(document.components[1].licenses, existing.licenses);
  assert.deepEqual(document.components[1].properties[0], existing.properties[0]);
  assert.equal(document.components[1]['bom-ref'], 'syft-id');
  assert.deepEqual(document.dependencies, f.document.dependencies);
});

test('does not collapse qualified package variants or different versions', (t) => {
  const f = fixture(t);
  f.document.components.push(
    {
      type: 'library',
      name: '@fixture/direct',
      version: '1.2.3',
      purl: purl('@fixture/direct') + '?arch=any',
    },
    {
      type: 'library',
      name: '@fixture/direct',
      version: '2.0.0',
      purl: purl('@fixture/direct', '2.0.0'),
    },
  );
  assert.equal(mergeBundleSbom(f.document, f.options).summary.addedComponents, 1);
});

test('merging identical evidence is deterministic and idempotent', (t) => {
  const f = fixture(t);
  const first = mergeBundleSbom(f.document, f.options).document;
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(mergeBundleSbom(f.document, f.options).document),
  );
  assert.equal(JSON.stringify(first), JSON.stringify(mergeBundleSbom(first, f.options).document));
});

test('multiple verified bundles deduplicate components and sort evidence independently of argument order', (t) => {
  const f = fixture(t);
  const second = join(f.archiveRoot, 'app/web');
  mkdirSync(second, { recursive: true });
  for (const name of ['index.js', 'bundle-evidence.json'])
    writeFileSync(join(second, name), readFileSync(join(f.dist, name)));
  const merge = (bundleDirectories) =>
    mergeBundleSbom(f.document, { ...f.options, bundleDirectories });
  const a = merge(['app/web', 'app/cli']);
  assert.equal(a.summary.addedComponents, 1);
  assert.equal(a.summary.renderedModules, 2);
  assert.deepEqual(a.document, merge(['app/cli', 'app/web']).document);
  assert.equal(
    a.document.components[1].properties.filter((entry) => entry.name === PREFIX + 'provenance')
      .length,
    2,
  );
});

test('conflicting rendered package manifests across sidecars fail closed', (t) => {
  const f = fixture(t);
  const second = join(f.archiveRoot, 'app/web');
  mkdirSync(second, { recursive: true });
  writeFileSync(join(second, 'index.js'), readFileSync(join(f.dist, 'index.js')));
  const changed = globalThis.structuredClone(f.evidence);
  changed.components[0].packageJsonSha256 = hash('conflicting package');
  writeFileSync(join(second, 'bundle-evidence.json'), JSON.stringify(changed));
  assert.throws(
    () => mergeBundleSbom(f.document, { ...f.options, bundleDirectories: ['app/web', 'app/cli'] }),
    /Conflicting bundle package metadata/,
  );
});

test('conflicting existing PURL/name or PURL/version and duplicate references fail closed', (t) => {
  const f = fixture(t);
  const item = {
    'bom-ref': 'dup',
    type: 'library',
    name: '@fixture/direct',
    version: '9.0.0',
    purl: purl('@fixture/direct'),
  };
  f.document.components.push(item);
  assert.throws(() => mergeBundleSbom(f.document, f.options), /identity conflicts/);
  item.version = '1.2.3';
  item.name = 'wrong-name';
  assert.throws(() => mergeBundleSbom(f.document, f.options), /identity conflicts/);
  item.name = '@fixture/direct';
  f.document.components.push({ 'bom-ref': 'dup', type: 'library', name: 'another' });
  assert.throws(
    () => mergeBundleSbom(f.document, f.options),
    /Duplicate existing component bom-ref/,
  );
});

test('remerge rejects changed manifest provenance instead of silently accepting a new claim', (t) => {
  const f = fixture(t);
  const first = mergeBundleSbom(f.document, f.options).document;
  f.evidence.components[0].packageJsonSha256 = hash('changed manifest');
  f.write();
  assert.throws(
    () => mergeBundleSbom(first, f.options),
    /Previously merged bundle package metadata conflicts/,
  );
});

test('actual output tampering and additional files are rejected', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.dist, 'index.js'), 'tampered output');
  assert.throws(() => mergeBundleSbom(f.document, f.options), /output differs/);
  writeFileSync(join(f.dist, 'extra.txt'), 'extra');
  assert.throws(() => mergeBundleSbom(f.document, f.options), /file set differs/);
});

test('invalid evidence metadata or non-fixed semver cannot become a merged component', (t) => {
  const f = fixture(t);
  f.evidence.components[0].id = 'pkg:npm/wrong@1.2.3';
  f.write();
  assert.throws(() => mergeBundleSbom(f.document, f.options), /component identity/);
  f.evidence.components[0] = component('@fixture/direct', '01.2.3');
  f.evidence.outputs[0].modules[0].component = purl('@fixture/direct', '01.2.3');
  f.evidence.outputs[0].modules[0].id = purl('@fixture/direct', '01.2.3') + '#index.js';
  f.write();
  assert.throws(() => mergeBundleSbom(f.document, f.options), /fixed valid npm name/);
});

test('rejects traversal, absolute bundle paths, duplicate directories, bad archive hashes, and junctions', (t) => {
  const f = fixture(t);
  for (const directory of [
    '../outside',
    '/rooted',
    'C:/drive',
    'app\\cli',
    'app//cli',
    'app/./cli',
  ])
    assert.throws(
      () => mergeBundleSbom(f.document, { ...f.options, bundleDirectories: [directory] }),
      /safe archive-relative/,
    );
  assert.throws(
    () => mergeBundleSbom(f.document, { ...f.options, bundleDirectories: ['app/cli', 'app/cli'] }),
    /Duplicate bundle/,
  );
  assert.throws(
    () => mergeBundleSbom(f.document, { ...f.options, archiveSha256: 'unbound' }),
    /SHA256/,
  );
  symlinkSync(f.dist, join(f.archiveRoot, 'linked'), 'junction');
  assert.throws(
    () => mergeBundleSbom(f.document, { ...f.options, bundleDirectories: ['linked'] }),
    /Symbolic links/,
  );
});

test('strict input schema and conflicting complete-coverage status are rejected', (t) => {
  const f = fixture(t);
  assert.throws(() => mergeBundleSbom({ ...f.document, specVersion: '1.6' }, f.options), /schema/);
  f.document.components[0].licenses = [{ license: { id: 'Invalid-License' } }];
  assert.throws(() => mergeBundleSbom(f.document, f.options), /schema/);
  delete f.document.components[0].licenses;
  f.document.metadata.properties = [{ name: 'workmesh:inventory:status', value: 'COMPLETE' }];
  assert.throws(() => mergeBundleSbom(f.document, f.options), /status conflicts/);
});

test('CLI updates only an external CDX file after validation and leaves invalid input unchanged', (t) => {
  const f = fixture(t);
  const file = join(f.root, 'fixture.cdx.json');
  writeFileSync(file, JSON.stringify(f.document));
  const output = [];
  const errors = [];
  const io = { out: (value) => output.push(value), err: (value) => errors.push(value) };
  assert.equal(runCli([file, f.archiveRoot, archiveSha256, 'app/cli'], io), 0);
  assert.equal(JSON.parse(output[0]).addedComponents, 1);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).components.length, 2);
  assert.deepEqual(errors, []);
  const before = readFileSync(file);
  assert.equal(runCli([file, f.archiveRoot, archiveSha256, '../outside'], io), 1);
  assert.deepEqual(readFileSync(file), before);
  const inner = join(f.archiveRoot, 'bom.json');
  writeFileSync(inner, JSON.stringify(f.document));
  assert.equal(runCli([inner, f.archiveRoot, archiveSha256, 'app/cli'], io), 1);
  assert.match(errors.at(-1), /outside the immutable archive tree/);
  if (process.platform === 'win32') {
    const caseVariant = f.archiveRoot.replace(/archive$/, 'ARCHIVE');
    assert.equal(runCli([inner, caseVariant, archiveSha256, 'app/cli'], io), 1);
    assert.match(errors.at(-1), /outside the immutable archive tree/);
  }
  assert.equal(runCli([], io), 1);
  assert.match(errors.at(-1), /Usage:/);
});
