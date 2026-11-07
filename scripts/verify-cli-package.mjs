import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILTIN_ROLES = ['product', 'ui', 'frontend', 'backend', 'qa', 'ops'];

function requireFile(path) {
  if (!statSync(path, { throwIfNoEntry: false })?.isFile())
    throw new Error(`CLI package is missing a required file: ${path}`);
}

/** Verify the staged files, not the source tree that may have hidden omissions. */
export function verifyCliPackage(directory, { smoke = true } = {}) {
  const root = resolve(directory);
  const node = join(root, 'runtime', 'node.exe');
  const cli = join(root, 'app', 'cli', 'index.js');
  for (const path of [node, cli, join(root, 'workmesh.cmd')]) requireFile(path);
  let resources = 0;
  for (const role of BUILTIN_ROLES) {
    const roleDir = join(root, 'roles', role);
    const manifestPath = join(roleDir, 'manifest.json');
    requireFile(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (manifest.roleKey !== role || manifest.id !== `workmesh.role.${role}`)
      throw new Error(`CLI package role mismatch: ${manifestPath}`);
    if (!Array.isArray(manifest.resources) || !manifest.resources.length)
      throw new Error(`CLI package has no resources: ${manifestPath}`);
    for (const resource of manifest.resources) {
      if (
        typeof resource.path !== 'string' ||
        resource.path.includes('\\') ||
        resource.path.split('/').some((part) => !part || part === '.' || part === '..') ||
        isAbsolute(resource.path) ||
        /^[a-zA-Z]:/.test(resource.path)
      )
        throw new Error(`CLI package has an invalid resource path: ${manifestPath}`);
      const path = join(roleDir, resource.path);
      requireFile(path);
      const resolved = relative(realpathSync(roleDir), realpathSync(path));
      if (
        resolved === '..' ||
        resolved.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) ||
        isAbsolute(resolved)
      )
        throw new Error(`CLI package resource escapes its role: ${path}`);
      const bytes = readFileSync(path);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== resource.byteLength || hash !== resource.sha256)
        throw new Error(`CLI package resource differs from manifest: ${path}`);
      resources++;
    }
  }
  if (smoke) {
    const workspace = mkdtempSync(join(tmpdir(), 'workmesh-cli-package-'));
    try {
      // No project is intentional: setup must locate and parse the built-in
      // role before that error, without authorization, networking or home I/O.
      const result = spawnSync(
        node,
        [
          cli,
          'setup',
          '--role',
          'frontend',
          '--host',
          'codex',
          '--api',
          'http://127.0.0.1:1/api/v1',
          '--config-home',
          join(workspace, 'home'),
          '--json',
        ],
        { cwd: workspace, encoding: 'utf8', timeout: 15_000, windowsHide: true },
      );
      if (result.error) throw result.error;
      let response;
      try {
        response = JSON.parse(result.stdout.trim());
      } catch {
        /* report bounded diagnostics below */
      }
      if (
        result.status !== 2 ||
        response?.error?.code !== 'INVALID_REQUEST' ||
        !String(response?.error?.message).includes('--project')
      )
        throw new Error(
          `Packaged CLI cannot resolve frontend without --package: ${String(result.stderr || result.stdout).slice(0, 1500)}`,
        );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
  return { roles: BUILTIN_ROLES.length, resources, smoke };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3)
      throw new Error('Usage: node scripts/verify-cli-package.mjs <staged-cli-directory>');
    process.stdout.write(`${JSON.stringify(verifyCliPackage(process.argv[2]))}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
