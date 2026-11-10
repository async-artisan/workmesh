import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

export const EVIDENCE_FILE = 'bundle-evidence.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (path) => path.split(sep).join('/');
const sort = (values, key) => values.sort((a, b) => key(a).localeCompare(key(b), 'en'));
const HASH = /^[a-f0-9]{64}$/;
const control = (value) => [...value].some((character) => character.charCodeAt(0) < 32);
const NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function safePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    isAbsolute(path) ||
    path.includes(':') ||
    control(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  )
    throw new Error('Bundle evidence contains an unsafe relative path');
  return path;
}

function contained(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel);
}

function covered(path) {
  return path !== EVIDENCE_FILE && !/\.d\.(?:c|m)?ts(?:\.map)?$/.test(path);
}

function files(root) {
  const found = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Bundle output contains a symbolic link');
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const name = safePath(slash(relative(root, path)));
        if (covered(name)) found.push(name);
      } else throw new Error('Bundle output contains a non-regular file');
    }
  }
  visit(root);
  return found.sort();
}

function fileRecord(path) {
  const bytes = readFileSync(path);
  return { bytes: bytes.length, sha256: sha256(bytes) };
}

function packageRoot(path) {
  let directory = dirname(path);
  while (true) {
    if (existsSync(join(directory, 'package.json'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Input module has no package.json');
    directory = parent;
  }
}

function purl(name, version) {
  return 'pkg:npm/' + name.split('/').map(encodeURIComponent).join('/') + '@' + version;
}

function toolVersion(packageDir, name, parent) {
  let require = createRequire(join(packageDir, 'package.json'));
  if (parent) require = createRequire(join(packageRoot(require.resolve(parent)), 'package.json'));
  const root = packageRoot(require.resolve(name));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  return { name: manifest.name, version: manifest.version };
}

function collector(repoRoot, packageDir) {
  const components = new Map();
  const modules = new Map();
  const packages = new Map();
  const prebundles = new Map();
  function component(root) {
    if (packages.has(root)) return packages.get(root);
    const bytes = readFileSync(join(root, 'package.json'));
    const manifest = JSON.parse(bytes);
    if (!NAME.test(manifest.name) || !VERSION.test(manifest.version))
      throw new Error('Bundle input package needs a fixed npm name and version');
    const id = purl(manifest.name, manifest.version);
    const item = {
      id,
      name: manifest.name,
      version: manifest.version,
      source:
        contained(repoRoot, root) && !slash(relative(repoRoot, root)).includes('node_modules/')
          ? 'workspace'
          : 'npm',
      packageJsonSha256: sha256(bytes),
      licenseDeclared: licenseDeclaration(
        typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN',
      ),
      licenseFiles: sort(
        readdirSync(root, { withFileTypes: true })
          .filter(
            (entry) =>
              entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(entry.name),
          )
          .map((entry) => ({ path: safePath(entry.name), ...fileRecord(join(root, entry.name)) })),
        (entry) => entry.path,
      ),
    };
    const previous = components.get(id);
    item.licenseFileStatus = item.licenseFiles.length ? 'RECORDED' : 'UNKNOWN';
    if (previous && JSON.stringify(previous) !== JSON.stringify(item))
      throw new Error('Conflicting installed package metadata for ' + id);
    components.set(id, item);
    packages.set(root, item);
    return item;
  }
  function loadPrebundle(path, root) {
    if (!slash(relative(root, path)).startsWith('dist/') || !/\.(?:c|m)?js$/.test(path))
      return null;
    const evidencePath = join(root, 'dist', EVIDENCE_FILE);
    if (!existsSync(evidencePath)) return { opaque: true };
    if (!prebundles.has(evidencePath)) {
      const evidenceBytes = readFileSync(evidencePath);
      const evidence = JSON.parse(evidenceBytes);
      verifyBundleEvidence(join(root, 'dist'), evidence);
      prebundles.set(evidencePath, { evidence, hash: sha256(evidenceBytes) });
    }
    const { evidence, hash } = prebundles.get(evidencePath);
    const output = evidence.outputs.find(
      (entry) => entry.path === slash(relative(join(root, 'dist'), path)),
    );
    if (!output || output.sha256 !== fileRecord(path).sha256)
      throw new Error('Prebundle output does not match its module graph');
    for (const item of evidence.components) {
      const previous = components.get(item.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(item))
        throw new Error('Prebundle package metadata conflicts');
      components.set(item.id, item);
    }
    const candidates = (entries) =>
      entries.map((entry) => ({
        ...entry,
        contribution: {
          ...entry.contribution,
          state:
            entry.contribution.state === 'tree-shaken' ? 'tree-shaken' : 'prebundled-candidate',
        },
        prebundle:
          entry.prebundle && !entry.prebundle.opaque
            ? { ...entry.prebundle, modules: candidates(entry.prebundle.modules) }
            : entry.prebundle,
      }));
    return {
      opaque: false,
      evidenceSha256: hash,
      outputPath: output.path,
      outputSha256: output.sha256,
      attribution: 'prebundled-candidates',
      modules: candidates(output.modules),
    };
  }
  function module(rawId) {
    if (modules.has(rawId)) return modules.get(rawId);
    const generated = rawId.includes('\0') || rawId.includes('?');
    const stripped = rawId.replace(/^\0/, '').split('?')[0];
    const candidate = isAbsolute(stripped) ? stripped : resolve(packageDir, stripped);
    let item;
    if (!existsSync(candidate) || !lstatSync(candidate).isFile()) {
      if (!generated && rawId !== '<runtime>')
        throw new Error('Bundle input file is missing from disk');
      item = {
        id: 'virtual/' + sha256(rawId),
        sourceKind: 'virtual',
        sha256: null,
        component: null,
        prebundle: null,
      };
    } else {
      const path = realpathSync(candidate);
      const root = packageRoot(path);
      const pkg = component(root);
      item = {
        id:
          pkg.id +
          '#' +
          safePath(slash(relative(root, path))) +
          (generated ? '?generated=' + sha256(rawId) : ''),
        sourceKind: generated ? 'generated' : pkg.source,
        sha256: fileRecord(path).sha256,
        component: pkg.id,
        prebundle: pkg.source === 'workspace' ? loadPrebundle(path, root) : null,
      };
    }
    modules.set(rawId, item);
    return item;
  }
  return { components, module };
}

function externalImport(specifier) {
  text(specifier);
  if (
    typeof specifier !== 'string' ||
    !specifier ||
    specifier.includes('\\') ||
    control(specifier) ||
    /^[a-z]:/i.test(specifier) ||
    specifier.startsWith('/')
  )
    throw new Error('Bundle external import contains a host path');
  return { specifier, kind: specifier.startsWith('node:') ? 'node-builtin' : 'unmapped-external' };
}

function writeEvidence({ repoRoot, packageDir, outputDir, graphs, tool }) {
  const collect = collector(repoRoot, packageDir);
  const rendered = new Set();
  const allInputs = new Set();
  const byOutput = new Map();
  for (const graph of graphs) {
    for (const id of graph.inputs) allInputs.add(id);
    for (const output of graph.outputs) {
      const path = safePath(slash(relative(outputDir, resolve(packageDir, output.path))));
      if (!contained(outputDir, resolve(outputDir, path)))
        throw new Error('Bundler output escapes dist');
      const inputs = output.modules.map(({ id, bytes, metric }) => {
        if (bytes > 0) rendered.add(id);
        return {
          ...collect.module(id),
          contribution: { state: bytes > 0 ? 'rendered' : 'tree-shaken', metric, bytes },
        };
      });
      byOutput.set(path, {
        path,
        kind: output.kind,
        modules: sort(inputs, (entry) => entry.id),
        externalImports: sort(
          [...new Set(output.externalImports)].map(externalImport),
          (entry) => entry.specifier,
        ),
      });
    }
  }
  const outputs = files(outputDir).map((path) => ({
    ...(byOutput.get(path) ?? { path, kind: 'asset', modules: [], externalImports: [] }),
    ...fileRecord(join(outputDir, path)),
  }));
  for (const path of byOutput.keys())
    if (!outputs.some((entry) => entry.path === path))
      throw new Error('Bundler output is missing from disk');
  const nonRenderedModules = sort(
    [...allInputs]
      .filter((id) => !rendered.has(id))
      .map((id) => ({
        ...collect.module(id),
        contribution: { state: 'tree-shaken', metric: 'not-rendered-in-any-output', bytes: 0 },
      })),
    (entry) => entry.id,
  );
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const evidence = {
    schemaVersion: '1.0',
    kind: 'workmesh-bundle-evidence',
    status: 'PARTIAL_MODULE_EVIDENCE',
    package: { name: manifest.name, version: manifest.version },
    tool,
    scope: {
      outputs: 'All dist files except declaration files and this evidence file',
      attribution:
        'Direct bundler contributions; prebundled inner modules are candidates after downstream tree shaking',
      limitations: [
        'Not a complete SBOM',
        'Module contribution bytes are bundler metrics, not an exact final-byte partition',
        'Virtual/generated modules may lack package attribution',
        'Prebundled candidates do not prove final inclusion',
        'License metadata and file hashes do not establish license compliance',
        'Native runtime components and source-map contents are not enumerated',
        'Input hashes bind on-disk sources before bundler transforms; virtual identifiers are hashed only',
      ],
    },
    outputs,
    nonRenderedModules,
    components: sort([...collect.components.values()], (entry) => entry.id),
  };
  validateEvidence(evidence);
  writeFileSync(join(outputDir, EVIDENCE_FILE), JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}

/** Capture esbuild graphs in memory, then hash tsup final post-plugin bytes. */
export function createEsbuildEvidenceHooks({
  repoRoot,
  packageDir,
  outputDir = join(packageDir, 'dist'),
}) {
  let graphs = [];
  return {
    esbuildPlugins: [
      {
        name: 'workmesh-bundle-evidence',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length) return;
            if (!result.metafile) throw new Error('Bundle evidence requires the esbuild metafile');
            graphs.push({
              inputs: Object.keys(result.metafile.inputs),
              outputs: Object.entries(result.metafile.outputs).map(([path, output]) => ({
                path,
                kind: /\.(?:c|m)?js$/.test(path) ? 'chunk' : 'asset',
                modules: Object.entries(output.inputs).map(([id, input]) => ({
                  id,
                  bytes: input.bytesInOutput,
                  metric: 'esbuild-bytes-in-output',
                })),
                externalImports: output.imports
                  .filter((entry) => entry.external)
                  .map((entry) => entry.path),
              })),
            });
          });
        },
      },
    ],
    async onSuccess() {
      if (!graphs.length) throw new Error('No esbuild module graph was captured');
      writeEvidence({
        repoRoot,
        packageDir,
        outputDir,
        graphs,
        tool: [toolVersion(packageDir, 'tsup'), toolVersion(packageDir, 'esbuild', 'tsup')],
      });
      graphs = [];
    },
  };
}

/** Rollup chunk.modules is the rendered graph; loaded but omitted inputs stay separate. */
export function createRollupEvidencePlugin({ repoRoot, packageDir }) {
  return {
    name: 'workmesh-bundle-evidence',
    apply: 'build',
    enforce: 'post',
    writeBundle(options, bundle) {
      if (!options.dir) throw new Error('Bundle evidence requires an output directory');
      const outputDir = resolve(packageDir, options.dir);
      const names = new Set(Object.keys(bundle));
      const graph = {
        inputs: [...this.getModuleIds()].filter((id) => !this.getModuleInfo(id)?.isExternal),
        outputs: Object.values(bundle).map((output) => ({
          path: join(outputDir, output.fileName),
          kind: output.type === 'chunk' ? 'chunk' : 'asset',
          modules:
            output.type === 'chunk'
              ? Object.entries(output.modules).map(([id, module]) => ({
                  id,
                  bytes: module.renderedLength,
                  metric: 'rollup-rendered-length',
                }))
              : [],
          externalImports:
            output.type === 'chunk'
              ? [...new Set([...output.imports, ...output.dynamicImports])].filter(
                  (id) => !names.has(id),
                )
              : [],
        })),
      };
      writeEvidence({
        repoRoot,
        packageDir,
        outputDir,
        graphs: [graph],
        tool: [toolVersion(packageDir, 'vite'), toolVersion(packageDir, 'rollup', 'vite')],
      });
    },
  };
}

function object(value, required, optional = []) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error('Bundle evidence has an invalid schema or unknown fields');
}
function hash(value) {
  if (typeof value !== 'string' || !HASH.test(value))
    throw new Error('Bundle evidence has an invalid SHA256');
}
function size(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Bundle evidence has an invalid byte count');
}
function list(value) {
  if (!Array.isArray(value)) throw new Error('Bundle evidence expects an array');
  return value;
}
function unique(values) {
  if (new Set(values).size !== values.length)
    throw new Error('Bundle evidence has duplicate entries');
}
function text(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\\') ||
    control(value) ||
    /file:/i.test(value) ||
    /(?:^|[^A-Za-z0-9._%+-])(?:[a-z]:\/|\/|~\/)/i.test(
      value.replace(/\bhttps?:\/\/[^\s<>"']+/gi, '<public-url>'),
    )
  )
    throw new Error('Bundle evidence contains an invalid or host-specific string');
}

function licenseDeclaration(value) {
  text(value);
  const reference = /^SEE LICENSE IN (.+)$/i.exec(value);
  if (reference) safePath(reference[1].replace(/^(?:\.\/)+/, ''));
  return value;
}

export function validateEvidence(evidence) {
  object(evidence, [
    'schemaVersion',
    'kind',
    'status',
    'package',
    'tool',
    'scope',
    'outputs',
    'nonRenderedModules',
    'components',
  ]);
  if (
    evidence.schemaVersion !== '1.0' ||
    evidence.kind !== 'workmesh-bundle-evidence' ||
    evidence.status !== 'PARTIAL_MODULE_EVIDENCE'
  )
    throw new Error('Unsupported bundle evidence schema');
  object(evidence.package, ['name', 'version']);
  if (!NAME.test(evidence.package.name) || !VERSION.test(evidence.package.version))
    throw new Error('Invalid bundle package');
  for (const tool of list(evidence.tool)) {
    object(tool, ['name', 'version']);
    text(tool.name);
    text(tool.version);
  }
  object(evidence.scope, ['outputs', 'attribution', 'limitations']);
  text(evidence.scope.outputs);
  text(evidence.scope.attribution);
  list(evidence.scope.limitations).forEach(text);
  const components = list(evidence.components);
  unique(components.map((entry) => entry.id));
  const ids = new Set(components.map((entry) => entry.id));
  for (const item of components) {
    object(item, [
      'id',
      'name',
      'version',
      'source',
      'packageJsonSha256',
      'licenseDeclared',
      'licenseFiles',
      'licenseFileStatus',
    ]);
    if (
      !NAME.test(item.name) ||
      !VERSION.test(item.version) ||
      item.id !== purl(item.name, item.version) ||
      !['npm', 'workspace'].includes(item.source)
    )
      throw new Error('Invalid bundle component identity');
    hash(item.packageJsonSha256);
    licenseDeclaration(item.licenseDeclared);
    unique(list(item.licenseFiles).map((entry) => entry.path));
    if (item.licenseFileStatus !== (item.licenseFiles.length ? 'RECORDED' : 'UNKNOWN'))
      throw new Error('Invalid license file coverage status');
    for (const file of item.licenseFiles) {
      object(file, ['path', 'bytes', 'sha256']);
      safePath(file.path);
      size(file.bytes);
      hash(file.sha256);
    }
  }
  function modules(entries, depth = 0) {
    if (depth > 8) throw new Error('Bundle prebundle graph is too deep');
    unique(list(entries).map((entry) => entry.id));
    for (const module of entries) {
      object(module, ['id', 'sourceKind', 'sha256', 'component', 'prebundle', 'contribution']);
      text(module.id);
      if (!['npm', 'workspace', 'generated', 'virtual'].includes(module.sourceKind))
        throw new Error('Invalid module source kind');
      if (module.sourceKind === 'virtual') {
        if (
          !/^virtual\/[a-f0-9]{64}$/.test(module.id) ||
          module.sha256 !== null ||
          module.component !== null ||
          module.prebundle !== null
        )
          throw new Error('Invalid virtual module');
      } else {
        hash(module.sha256);
        if (!ids.has(module.component) || !module.id.startsWith(module.component + '#'))
          throw new Error('Module has no matching component');
        const suffix = module.id.slice(module.component.length + 1).split('?generated=');
        safePath(suffix[0]);
        if (
          suffix.length > 2 ||
          (suffix.length === 2 && !HASH.test(suffix[1])) ||
          (module.sourceKind === 'generated') !== (suffix.length === 2)
        )
          throw new Error('Invalid generated module identity');
      }
      object(module.contribution, ['state', 'metric', 'bytes']);
      if (
        !['rendered', 'tree-shaken', 'prebundled-candidate'].includes(module.contribution.state) ||
        ![
          'esbuild-bytes-in-output',
          'rollup-rendered-length',
          'not-rendered-in-any-output',
        ].includes(module.contribution.metric)
      )
        throw new Error('Invalid module contribution');
      size(module.contribution.bytes);
      if (module.contribution.state === 'tree-shaken' && module.contribution.bytes !== 0)
        throw new Error('Tree-shaken module cannot have contributed bytes');
      if (depth && module.contribution.state === 'rendered')
        throw new Error('Prebundle inner modules must be candidates');
      if (module.prebundle !== null) {
        if (module.prebundle.opaque === true) object(module.prebundle, ['opaque']);
        else {
          object(module.prebundle, [
            'opaque',
            'evidenceSha256',
            'outputPath',
            'outputSha256',
            'attribution',
            'modules',
          ]);
          if (
            module.prebundle.opaque !== false ||
            module.prebundle.attribution !== 'prebundled-candidates' ||
            module.prebundle.outputSha256 !== module.sha256
          )
            throw new Error('Invalid prebundle output binding');
          hash(module.prebundle.evidenceSha256);
          hash(module.prebundle.outputSha256);
          safePath(module.prebundle.outputPath);
          modules(module.prebundle.modules, depth + 1);
        }
      }
    }
  }
  const outputs = list(evidence.outputs);
  if (!outputs.length) throw new Error('Bundle evidence contains no outputs');
  unique(outputs.map((entry) => entry.path));
  for (const output of outputs) {
    object(output, ['path', 'kind', 'modules', 'externalImports', 'bytes', 'sha256']);
    safePath(output.path);
    if (!covered(output.path) || !['chunk', 'asset'].includes(output.kind))
      throw new Error('Invalid bundle output');
    if (/\.(?:c|m)?js$/.test(output.path) && output.kind !== 'chunk')
      throw new Error('JavaScript output requires a module graph');
    size(output.bytes);
    hash(output.sha256);
    modules(output.modules);
    if (output.kind === 'chunk' && !output.modules.length)
      throw new Error('Chunk has no module graph');
    unique(list(output.externalImports).map((entry) => entry.specifier));
    for (const item of output.externalImports) {
      object(item, ['specifier', 'kind']);
      const expected = externalImport(item.specifier);
      if (expected.kind !== item.kind) throw new Error('Invalid external import');
    }
  }
  modules(evidence.nonRenderedModules);
  if (evidence.nonRenderedModules.some((entry) => entry.contribution.state !== 'tree-shaken'))
    throw new Error('Non-rendered module claims inclusion');
  return evidence;
}

export function verifyBundleEvidence(directory, supplied) {
  const root = resolve(directory);
  if (lstatSync(root).isSymbolicLink()) throw new Error('Bundle output root is a symbolic link');
  const evidencePath = join(root, EVIDENCE_FILE);
  if (!supplied && lstatSync(evidencePath).isSymbolicLink())
    throw new Error('Bundle evidence is a symbolic link');
  const evidence = validateEvidence(supplied ?? JSON.parse(readFileSync(evidencePath, 'utf8')));
  const actualFiles = files(root);
  if (
    JSON.stringify(actualFiles) !==
    JSON.stringify(evidence.outputs.map((entry) => entry.path).sort())
  )
    throw new Error('Bundle output file set differs from evidence');
  for (const output of evidence.outputs) {
    const actual = fileRecord(join(root, output.path));
    if (actual.bytes !== output.bytes || actual.sha256 !== output.sha256)
      throw new Error('Bundle output differs from evidence: ' + output.path);
  }
  const counts = {
    rendered: 0,
    treeShaken: evidence.nonRenderedModules.length,
    prebundledCandidates: 0,
    virtual: 0,
    opaquePrebundles: 0,
  };
  function count(modules) {
    for (const module of modules) {
      if (module.contribution.state === 'rendered') counts.rendered++;
      if (module.contribution.state === 'prebundled-candidate') counts.prebundledCandidates++;
      if (module.sourceKind === 'virtual') counts.virtual++;
      if (module.prebundle?.opaque) counts.opaquePrebundles++;
      else if (module.prebundle) count(module.prebundle.modules);
    }
  }
  evidence.outputs.forEach((entry) => count(entry.modules));
  return {
    schemaVersion: evidence.schemaVersion,
    status: evidence.status,
    package: evidence.package,
    files: actualFiles.length,
    components: evidence.components.length,
    ...counts,
  };
}
