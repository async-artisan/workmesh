import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestName = 'dependency-links.json';

function inside(root, value) {
  const result = relative(root, value);
  return result !== '' && result !== '..' && !result.startsWith(`..${sep}`) && !isAbsolute(result);
}

function localPath(root, value, allowRoot = false) {
  if (typeof value !== 'string' || !value || isAbsolute(value)) throw new Error('Dependency link must be relative');
  const result = resolve(root, value);
  if (!(allowRoot && result === root) && !inside(root, result)) throw new Error(`Dependency link escapes package: ${value}`);
  return result;
}

function portable(root, value, allowRoot = false) {
  if (allowRoot && value === root) return '.';
  if (!inside(root, value)) throw new Error(`Dependency link target is outside the deployment: ${value}`);
  return relative(root, value).split(sep).join('/');
}

/** ZIP does not carry Windows pnpm junctions. Store their package-relative locations. */
export function collectDependencyLinks(packageDir) {
  const root = resolve(packageDir);
  const packageName = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;
  const selfAlias = typeof packageName === 'string' ? join(root, 'node_modules', '.pnpm', 'node_modules', packageName) : null;
  const links = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) {
        let target = resolve(dirname(path), readlinkSync(path));
        if (path === selfAlias && !inside(root, target)) {
          if (JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name !== packageName) throw new Error('Deployment self-link has the wrong package name');
          target = root;
        }
        links.push({ path: portable(root, path), target: portable(root, target, true) });
      } else if (info.isDirectory()) visit(path);
    }
  }
  visit(join(root, 'node_modules'));
  links.sort((a, b) => a.path.localeCompare(b.path));
  writeFileSync(join(root, manifestName), `${JSON.stringify({ schemaVersion: '1', links }, null, 2)}\n`);
  return { links: links.length };
}

/** Restore relative dependencies into this extraction, with no references to the build machine. */
export function restoreDependencyLinks(packageDir) {
  const root = resolve(packageDir);
  const manifest = JSON.parse(readFileSync(join(root, manifestName), 'utf8'));
  if (manifest.schemaVersion !== '1' || !Array.isArray(manifest.links)) throw new Error('Invalid dependency link manifest');
  const validated = manifest.links.map((entry) => ({ path: localPath(root, entry.path), target: localPath(root, entry.target, true) }));
  for (const entry of validated) if (!existsSync(entry.target)) throw new Error(`Dependency link has no target: ${entry.path}`);
  let restored = 0;
  for (const entry of validated) {
    let current;
    try { current = lstatSync(entry.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (current) {
      if (!current.isSymbolicLink() || resolve(dirname(entry.path), readlinkSync(entry.path)).toLowerCase() !== entry.target.toLowerCase())
        throw new Error(`Refusing to replace an unexpected dependency: ${entry.path}`);
      continue;
    }
    mkdirSync(dirname(entry.path), { recursive: true });
    symlinkSync(entry.target, entry.path, 'junction');
    restored += 1;
  }
  for (const entry of validated) if (!existsSync(entry.path)) throw new Error(`Dependency link has no target: ${entry.path}`);
  return { links: validated.length, restored };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, packageDir] = process.argv.slice(2);
    if (!packageDir || !['collect', 'restore'].includes(mode)) throw new Error('Usage: dependency-links.mjs collect|restore <api-package-directory>');
    console.log(JSON.stringify(mode === 'collect' ? collectDependencyLinks(packageDir) : restoreDependencyLinks(packageDir)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
