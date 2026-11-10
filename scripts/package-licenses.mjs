import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_FILE, verifyBundleEvidence } from './lib/bundle-evidence.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (path) => path.split(sep).join('/');
const licenseName = /^(?:licen[cs]e|copying|notice|copyright)(?:$|[._-])/i;
const vendorNoticeNames = new Set([
  'server_license.txt',
  'commandlinetools_3rd_party_licenses.txt',
]);
const sorted = (values, key) => values.sort((a, b) => key(a).localeCompare(key(b), 'en'));

function local(root, path) {
  const rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel))
    throw new Error('License path must stay inside its source directory');
  return slash(rel);
}
function regular(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error('License inputs must be regular files');
  return readFileSync(path);
}
function metadata(root) {
  const bytes = regular(join(root, 'package.json'));
  const value = JSON.parse(bytes);
  if (typeof value.name !== 'string' || typeof value.version !== 'string') return null;
  return { name: value.name, version: value.version, packageJsonSha256: sha256(bytes), root };
}
function directPackages(directory, add) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(directory, entry.name);
    if (entry.name.startsWith('@') && (entry.isDirectory() || entry.isSymbolicLink()))
      directPackages(path, add);
    else if (
      (entry.isDirectory() || entry.isSymbolicLink()) &&
      existsSync(join(path, 'package.json'))
    )
      add(realpathSync(path));
  }
}
function sourcePackages(root) {
  const packages = new Map();
  function add(path) {
    const item = metadata(path);
    if (item) packages.set(item.name + '@' + item.version + '#' + item.packageJsonSha256, item);
  }
  for (const name of ['apps', 'packages']) directPackages(join(root, name), add);
  directPackages(join(root, 'node_modules'), add);
  const store = join(root, 'node_modules', '.pnpm');
  if (existsSync(store))
    for (const entry of readdirSync(store, { withFileTypes: true }))
      if (entry.isDirectory()) directPackages(join(store, entry.name, 'node_modules'), add);
  return packages;
}
function noticeFiles(root, vendor = false) {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (licenseName.test(entry.name) || (vendor && vendorNoticeNames.has(entry.name))),
    )
    .map((entry) => {
      const bytes = regular(join(root, entry.name));
      return { path: entry.name, bytes: bytes.length, sha256: sha256(bytes) };
    });
}
function supplementalRecords(sourceRoot) {
  const root = join(sourceRoot, 'scripts', 'vendor', 'license-texts');
  const path = join(root, 'provenance.json');
  if (!existsSync(path)) return { root, records: [] };
  const value = JSON.parse(regular(path));
  if (value.schemaVersion !== '1.0' || !Array.isArray(value.records))
    throw new Error('Invalid supplemental license provenance');
  const identities = new Set();
  for (const item of value.records) {
    if (
      typeof item.name !== 'string' ||
      typeof item.version !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.packageJsonSha256) ||
      !/^[a-f0-9]{40}$/.test(item.gitCommit) ||
      item.licenseDeclared !== 'MIT' ||
      !['exact-upstream-revision', 'installed-license-section'].includes(item.kind) ||
      !item.file ||
      !Number.isSafeInteger(item.file.bytes) ||
      item.file.bytes < 1 ||
      !/^[a-f0-9]{64}$/.test(item.file.sha256) ||
      typeof item.file.path !== 'string' ||
      item.file.path.includes('\\') ||
      item.file.path.includes(':') ||
      item.file.path.split('/').some((part) => !part || part === '.' || part === '..') ||
      typeof item.scope !== 'string' ||
      /[\r\n]/.test(item.scope)
    )
      throw new Error('Invalid supplemental license provenance');
    const url = new URL(item.sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search)
      throw new Error('Unsafe supplemental license source URL');
    if (item.kind === 'exact-upstream-revision') {
      const manifest = new URL(item.manifestUrl);
      if (
        url.hostname !== 'raw.githubusercontent.com' ||
        !url.pathname.includes('/' + item.gitCommit + '/') ||
        manifest.hostname !== url.hostname ||
        manifest.protocol !== 'https:' ||
        manifest.username ||
        manifest.password ||
        manifest.search ||
        manifest.hash ||
        !manifest.pathname.includes('/' + item.gitCommit + '/') ||
        item.manifestSha256 !== item.packageJsonSha256
      )
        throw new Error(
          'Supplemental upstream source must bind the exact revision and package manifest',
        );
    } else if (url.hostname !== 'registry.npmjs.org' || item.file.path !== 'README.md')
      throw new Error('Unsupported installed license source');
    const identity = item.name + '@' + item.version;
    if (identities.has(identity)) throw new Error('Duplicate supplemental license identity');
    identities.add(identity);
  }
  return { root, records: value.records };
}
function stagedPackages(root) {
  const packages = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (existsSync(join(path, 'package.json'))) {
        const item = metadata(path);
        if (item) packages.push(item);
        if (existsSync(join(path, 'node_modules'))) visit(join(path, 'node_modules'));
      } else visit(path);
    }
  }
  if (existsSync(root)) visit(root);
  return packages;
}

/** Copy actual texts, bound to verified bundles or physically deployed package manifests. */
export function packageLicenses({
  sourceRoot,
  stageRoot,
  bundles = [],
  deployedModules = [],
  runtimes = [],
}) {
  sourceRoot = resolve(sourceRoot);
  stageRoot = resolve(stageRoot);
  if (lstatSync(stageRoot).isSymbolicLink())
    throw new Error('License stage may not be a symbolic link');
  const output = join(stageRoot, 'licenses');
  if (existsSync(output))
    throw new Error('License output already exists; refusing to overwrite it');
  if (
    existsSync(join(stageRoot, 'LICENSE')) ||
    existsSync(join(stageRoot, 'THIRD-PARTY-NOTICES.txt'))
  )
    throw new Error('License destination already exists; refusing to overwrite it');
  const rootLicense = regular(join(sourceRoot, 'LICENSE'));
  const sources = sourcePackages(sourceRoot);
  const supplements = supplementalRecords(sourceRoot);
  const records = [];
  const planned = new Map();
  const limitations = [
    'Partial license-text inventory, not a complete SBOM or a license-compliance conclusion',
    'Prebundled candidate texts are included conservatively; candidate attribution does not prove final inclusion',
    'Native embedded components, unclassified binary dependencies, generated modules and source-map contents require separate review',
    'Available runtime notices are copied from supplied inputs; their presence does not establish complete native coverage',
  ];
  function plan(source, destination, expected) {
    const bytes = regular(source);
    const actual = { bytes: bytes.length, sha256: sha256(bytes) };
    if (expected && (expected.bytes !== actual.bytes || expected.sha256 !== actual.sha256))
      throw new Error('License text differs from its bundle evidence');
    const previous = planned.get(destination);
    if (previous && previous.sha256 !== actual.sha256)
      throw new Error('Conflicting license output bytes');
    planned.set(destination, { source, ...actual });
    return { path: destination, ...actual };
  }
  function packageRecord(item, root, scope, files, extra = {}) {
    const key = sha256(item.name + '@' + item.version + '#' + item.packageJsonSha256);
    const copied = sorted(files, (entry) => entry.path).map((file) =>
      plan(join(root, file.path), 'licenses/npm/' + key + '/' + file.path, file),
    );
    const supplement = supplements.records.find(
      (entry) => entry.name === item.name && entry.version === item.version,
    );
    let supplementalProvenance;
    if (supplement) {
      if (
        supplement.packageJsonSha256 !== item.packageJsonSha256 ||
        supplement.licenseDeclared !== item.licenseDeclared
      )
        throw new Error('Supplemental license package identity or manifest hash mismatch');
      const installed = supplement.kind === 'installed-license-section';
      const source = join(installed ? root : supplements.root, supplement.file.path);
      if (!installed) local(realpathSync(supplements.root), realpathSync(source));
      const text = regular(source).toString('utf8');
      if (
        installed &&
        (!/^## Licence\s*$/m.test(text) ||
          !text.includes('(The MIT License)') ||
          !text.includes('Permission is hereby granted, free of charge') ||
          !text.includes('THE SOFTWARE IS PROVIDED'))
      )
        throw new Error('Installed supplemental README has no complete expected license section');
      const destination = 'licenses/npm/' + key + '/supplemental/' + basename(supplement.file.path);
      copied.push(plan(source, destination, supplement.file));
      supplementalProvenance = {
        kind: supplement.kind,
        gitCommit: supplement.gitCommit,
        sourceUrl: supplement.sourceUrl,
        ...(supplement.manifestUrl
          ? { manifestUrl: supplement.manifestUrl, manifestSha256: supplement.manifestSha256 }
          : {}),
        scope: supplement.scope,
      };
    }
    records.push({
      name: item.name,
      version: item.version,
      packageJsonSha256: item.packageJsonSha256,
      scope,
      licenseDeclared: item.licenseDeclared ?? 'UNKNOWN',
      status: copied.length ? 'TEXTS_INCLUDED' : 'MISSING_LICENSE_TEXT',
      files: copied,
      ...(supplementalProvenance ? { supplementalProvenance } : {}),
      ...extra,
    });
  }
  const evidenceRecords = [];
  for (const bundle of bundles) {
    const bundleRoot = resolve(stageRoot, bundle);
    const bundlePath = local(stageRoot, bundleRoot);
    local(realpathSync(stageRoot), realpathSync(bundleRoot));
    verifyBundleEvidence(bundleRoot);
    const evidenceBytes = regular(join(bundleRoot, EVIDENCE_FILE));
    const evidence = JSON.parse(evidenceBytes);
    const states = new Map();
    function modules(entries, candidate = false) {
      for (const entry of entries) {
        if (entry.contribution.state === 'tree-shaken' || entry.contribution.bytes <= 0) continue;
        if (entry.component) {
          const state = candidate ? 'PREBUNDLED_CANDIDATE' : 'RENDERED_BUNDLE_COMPONENT';
          if (!states.has(entry.component) || !candidate) states.set(entry.component, state);
        }
        if (entry.prebundle && !entry.prebundle.opaque) modules(entry.prebundle.modules, true);
      }
    }
    evidence.outputs.forEach((entry) => modules(entry.modules));
    for (const item of evidence.components) {
      if (!states.has(item.id)) continue;
      const source = sources.get(item.name + '@' + item.version + '#' + item.packageJsonSha256);
      if (!source)
        throw new Error('Bundle license source metadata is missing or changed: ' + item.name);
      packageRecord(item, source.root, states.get(item.id), item.licenseFiles, {
        bundle: bundlePath,
      });
    }
    evidenceRecords.push({ path: bundlePath + '/' + EVIDENCE_FILE, sha256: sha256(evidenceBytes) });
  }
  for (const modules of deployedModules) {
    const directory = resolve(stageRoot, modules);
    local(stageRoot, directory);
    local(realpathSync(stageRoot), realpathSync(directory));
    for (const item of stagedPackages(directory)) {
      const manifest = JSON.parse(regular(join(item.root, 'package.json')));
      packageRecord(
        {
          ...item,
          licenseDeclared: typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN',
        },
        item.root,
        'DEPLOYED_NPM_PACKAGE',
        noticeFiles(item.root),
        { packagePath: local(stageRoot, item.root) },
      );
    }
  }
  for (const runtime of runtimes) {
    if (!/^[a-z0-9-]+$/.test(runtime.name)) throw new Error('Invalid runtime license label');
    const root = resolve(runtime.root);
    const files = [];
    for (const directory of [root, ...['doc', 'docs', 'share'].map((name) => join(root, name))]) {
      if (!existsSync(directory) || !lstatSync(directory).isDirectory()) continue;
      for (const file of noticeFiles(directory, runtime.name === 'postgresql')) {
        const source = join(directory, file.path);
        files.push(
          plan(source, 'licenses/runtime/' + runtime.name + '/' + local(root, source), file),
        );
      }
    }
    records.push({
      name: runtime.name,
      scope: 'SUPPLIED_RUNTIME_NOTICES',
      status: files.length ? 'AVAILABLE_TEXTS_INCLUDED' : 'MISSING_RUNTIME_TEXT',
      files: sorted(files, (entry) => entry.path),
    });
  }
  const index = {
    schemaVersion: '1.0',
    kind: 'workmesh-license-texts',
    status: 'PARTIAL_COVERAGE',
    project: { path: 'LICENSE', bytes: rootLicense.length, sha256: sha256(rootLicense) },
    bundleEvidence: sorted(evidenceRecords, (entry) => entry.path),
    records: sorted(records, (entry) =>
      [entry.name, entry.version ?? '', entry.scope, entry.bundle ?? entry.packagePath ?? ''].join(
        '|',
      ),
    ),
    limitations,
  };
  // Validate every input before creating any distribution content.
  mkdirSync(output);
  writeFileSync(join(stageRoot, 'LICENSE'), rootLicense);
  for (const [path, file] of planned) {
    const destination = join(stageRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(file.source, destination);
    if (sha256(regular(destination)) !== file.sha256)
      throw new Error('Copied license bytes changed during packaging');
  }
  writeFileSync(join(output, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  writeFileSync(
    join(stageRoot, 'THIRD-PARTY-NOTICES.txt'),
    [
      'WorkMesh includes third-party software. Its license and notice texts are under licenses/.',
      'licenses/index.json identifies copied text hashes and their bundle/deployment provenance.',
      ...limitations,
      '',
    ].join('\n'),
  );
  return index;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, sourceRoot, stageRoot, nodeExe, postgresRoot] = process.argv.slice(2);
    if (
      !['box', 'cli'].includes(mode) ||
      !sourceRoot ||
      !stageRoot ||
      !nodeExe ||
      (mode === 'box' ? !postgresRoot : postgresRoot !== undefined)
    )
      throw new Error(
        'Usage: package-licenses.mjs box|cli <source-root> <stage-root> <node-exe> [postgres-root]',
      );
    const nodeDirectory = dirname(resolve(nodeExe));
    const nodeRoot =
      basename(nodeDirectory).toLowerCase() === 'bin' ? dirname(nodeDirectory) : nodeDirectory;
    const index = packageLicenses({
      sourceRoot,
      stageRoot,
      bundles: mode === 'box' ? ['app/cli/dist', 'app/web/dist'] : ['app/cli'],
      deployedModules: mode === 'box' ? ['app/api/node_modules'] : [],
      runtimes: [
        { name: 'node', root: nodeRoot },
        ...(mode === 'box' ? [{ name: 'postgresql', root: postgresRoot }] : []),
      ],
    });
    console.log(
      JSON.stringify({
        status: index.status,
        records: index.records.length,
        missingTexts: index.records.filter((entry) => entry.status.startsWith('MISSING')).length,
      }),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
