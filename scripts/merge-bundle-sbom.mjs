import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVIDENCE_FILE, verifyBundleEvidence } from './lib/bundle-evidence.mjs';
import { createCycloneDxValidator } from './validate-cyclonedx.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PREFIX = 'workmesh:bundle:';
const STATUS = 'DRAFT_PARTIAL_COVERAGE';
const LIMITATIONS =
  'Direct rendered npm/workspace modules only. Prebundled candidates, virtual/generated attribution, embedded runtime components, UNKNOWN versions, dependency relationships and license completeness remain outside this merge.';
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
let validate;

function assertSchema(document) {
  const result = (validate ??= createCycloneDxValidator())(document);
  if (!result.valid)
    throw new Error(
      'CycloneDX 1.7 schema/format validation failed: ' + JSON.stringify(result.errors[0]),
    );
}

function fixedVersion(version) {
  const match = typeof version === 'string' && VERSION.exec(version);
  return Boolean(match && (!match[4] || match[4].split('.').every((part) => !/^0\d+$/.test(part))));
}

function identity(name, version) {
  if (typeof name !== 'string' || !NAME.test(name) || !fixedVersion(version))
    throw new Error('Rendered component needs a fixed valid npm name/version');
  return 'pkg:npm/' + name.split('/').map(encodeURIComponent).join('/') + '@' + version;
}

// Qualifiers and subpaths can distinguish packages; never erase them for deduplication.
function canonicalPurl(value) {
  if (typeof value !== 'string' || !value.startsWith('pkg:npm/')) return null;
  const match = /^pkg:npm\/(.+)@([^/?#]+)$/.exec(value);
  if (!match || /[?#]/.test(match[1])) return null;
  try {
    return identity(
      match[1].split('/').map(decodeURIComponent).join('/'),
      decodeURIComponent(match[2]),
    );
  } catch {
    return null;
  }
}

function archivePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    /[\\:]/.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    isAbsolute(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Bundle directory must be a safe archive-relative path');
  return value;
}

function noLinks(path) {
  let current = resolve(path);
  while (true) {
    if (lstatSync(current).isSymbolicLink())
      throw new Error('Symbolic links/reparse points are not allowed in bundle paths');
    const parent = resolve(current, '..');
    if (parent === current) return;
    current = parent;
  }
}

function addProperties(target, additions) {
  const existing = target.properties ?? [];
  const known = new Set(existing.map((item) => JSON.stringify([item.name, item.value])));
  const extra = additions
    .filter((item) => {
      const key = JSON.stringify([item.name, item.value]);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    })
    .sort((a, b) => order(a.name, b.name) || order(a.value, b.value));
  if (extra.length) target.properties = [...existing, ...extra];
}

function packageMetadata(component) {
  return JSON.stringify({
    packageJsonSha256: component.packageJsonSha256,
    licenseDeclared: component.licenseDeclared,
    licenseFileStatus: component.licenseFileStatus,
    licenseFiles: [...component.licenseFiles].sort((a, b) => order(a.path, b.path)),
  });
}

/** The caller binds archiveRoot to archiveSha256 through an exact ZIP/tree check. */
export function mergeBundleSbom(document, { archiveRoot, archiveSha256, bundleDirectories }) {
  assertSchema(document);
  if (!HASH.test(archiveSha256)) throw new Error('A lowercase archive SHA256 is required');
  if (!Array.isArray(bundleDirectories) || !bundleDirectories.length)
    throw new Error('At least one bundle directory is required');
  const directories = bundleDirectories.map(archivePath).sort(order);
  if (new Set(directories).size !== directories.length)
    throw new Error('Duplicate bundle directory');
  const root = resolve(archiveRoot);
  noLinks(root);
  const selected = new Map();
  const sidecars = [];
  let renderedModules = 0;
  for (const directory of directories) {
    const dist = join(root, ...directory.split('/'));
    noLinks(dist);
    const sidecarPath = join(dist, EVIDENCE_FILE);
    noLinks(sidecarPath);
    const bytes = readFileSync(sidecarPath);
    const evidence = JSON.parse(bytes.toString('utf8'));
    verifyBundleEvidence(dist, evidence);
    const evidencePath = directory + '/' + EVIDENCE_FILE;
    const evidenceSha256 = hash(bytes);
    sidecars.push({ path: evidencePath, sha256: evidenceSha256 });
    const components = new Map(evidence.components.map((entry) => [entry.id, entry]));
    // Deliberately do not descend into prebundle.modules or nonRenderedModules.
    for (const output of [...evidence.outputs].sort((a, b) => order(a.path, b.path))) {
      for (const module of [...output.modules].sort((a, b) => order(a.id, b.id))) {
        if (
          module.contribution.state !== 'rendered' ||
          module.contribution.bytes <= 0 ||
          !['npm', 'workspace'].includes(module.sourceKind)
        )
          continue;
        const component = components.get(module.component);
        const id = identity(component.name, component.version);
        if (component.id !== id) throw new Error('Rendered component PURL mismatch');
        let entry = selected.get(id);
        const metadata = packageMetadata(component);
        if (entry && entry.metadata !== metadata)
          throw new Error('Conflicting bundle package metadata: ' + id);
        if (!entry) {
          entry = { component, metadata, proofs: [] };
          selected.set(id, entry);
        }
        entry.proofs.push({
          archiveSha256,
          evidencePath,
          evidenceSha256,
          outputPath: directory + '/' + output.path,
          outputSha256: output.sha256,
          moduleId: module.id,
          moduleSha256: module.sha256,
          sourceKind: module.sourceKind,
          metric: module.contribution.metric,
          renderedBytes: module.contribution.bytes,
        });
        renderedModules++;
      }
    }
    if (!readFileSync(sidecarPath).equals(bytes))
      throw new Error('Bundle evidence changed during merge');
  }
  const result = globalThis.structuredClone(document);
  const existingByPurl = new Map();
  const refs = new Set();
  function index(components) {
    for (const component of components ?? []) {
      const ref = component['bom-ref'];
      if (ref !== undefined) {
        if (refs.has(ref)) throw new Error('Duplicate existing component bom-ref');
        refs.add(ref);
      }
      const id = canonicalPurl(component.purl);
      if (id && selected.has(id)) {
        const name =
          component.group && !component.name.startsWith('@')
            ? component.group + '/' + component.name
            : component.name;
        if (identity(name, component.version) !== id)
          throw new Error('Existing CycloneDX component identity conflicts with its PURL');
        const entries = existingByPurl.get(id) ?? [];
        entries.push(component);
        existingByPurl.set(id, entries);
      }
      index(component.components);
    }
  }
  index(result.components);
  if (result.metadata?.component) index([result.metadata.component]);
  let addedComponents = 0;
  let matchedComponents = 0;
  for (const [id, { component, metadata, proofs }] of [...selected].sort(([a], [b]) =>
    order(a, b),
  )) {
    let targets = existingByPurl.get(id);
    if (!targets) {
      const ref = PREFIX + hash(id);
      if (refs.has(ref))
        throw new Error('Bundle component bom-ref collides with an existing component');
      refs.add(ref);
      const added = {
        'bom-ref': ref,
        type: 'library',
        name: component.name,
        version: component.version,
        purl: id,
      };
      (result.components ??= []).push(added);
      targets = [added];
      addedComponents++;
    } else matchedComponents += targets.length;
    for (const target of targets) {
      const previous = (target.properties ?? []).filter(
        (item) => item.name === PREFIX + 'package-metadata',
      );
      if (previous.some((item) => item.value !== metadata))
        throw new Error('Previously merged bundle package metadata conflicts: ' + id);
      addProperties(target, [
        { name: PREFIX + 'package-metadata', value: metadata },
        ...proofs.map((proof) => ({ name: PREFIX + 'provenance', value: JSON.stringify(proof) })),
      ]);
    }
  }
  result.metadata ??= {};
  const statusProperties = (result.metadata.properties ?? []).filter(
    (item) => item.name === 'workmesh:inventory:status',
  );
  if (statusProperties.some((item) => item.value !== STATUS))
    throw new Error('Existing inventory status conflicts with partial bundle coverage');
  addProperties(result.metadata, [
    { name: 'workmesh:inventory:status', value: STATUS },
    { name: PREFIX + 'limitations', value: LIMITATIONS },
    {
      name: PREFIX + 'merge',
      value: JSON.stringify({
        archiveSha256,
        archiveBinding: 'Caller-verified exact ZIP/tree; bundle output bytes reverified by merger',
        sidecars,
        renderedModules,
        renderedComponents: selected.size,
      }),
    },
  ]);
  assertSchema(result);
  return {
    document: result,
    summary: {
      status: STATUS,
      addedComponents,
      matchedComponents,
      renderedModules,
      renderedComponents: selected.size,
      sidecars,
    },
  };
}

export function runCli(args, { out = console.log, err = console.error } = {}) {
  try {
    if (args.length < 4 || args.some((arg) => arg.startsWith('-')))
      throw new Error(
        'Usage: node scripts/merge-bundle-sbom.mjs <bom.cdx.json> <archive-root> <archive-sha256> <bundle-relative-dir> [more-bundle-dirs ...]',
      );
    const [file, archiveRoot, archiveSha256, ...bundleDirectories] = args;
    const resolvedFile = resolve(file);
    noLinks(resolvedFile);
    const root = resolve(archiveRoot);
    const comparedFile = process.platform === 'win32' ? resolvedFile.toLowerCase() : resolvedFile;
    const comparedRoot = process.platform === 'win32' ? root.toLowerCase() : root;
    if (comparedFile === comparedRoot || comparedFile.startsWith(comparedRoot + sep))
      throw new Error('CycloneDX output must be outside the immutable archive tree');
    const original = readFileSync(resolvedFile);
    const { document, summary } = mergeBundleSbom(
      JSON.parse(original.toString('utf8').replace(/^\uFEFF/, '')),
      { archiveRoot, archiveSha256, bundleDirectories },
    );
    if (!readFileSync(resolvedFile).equals(original))
      throw new Error('CycloneDX input changed during merge');
    writeFileSync(resolvedFile, JSON.stringify(document) + '\n');
    out(JSON.stringify(summary));
    return 0;
  } catch (error) {
    err(error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = runCli(process.argv.slice(2));
