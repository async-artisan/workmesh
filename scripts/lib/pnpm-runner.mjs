import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function readPnpmPackage(cliPath) {
  let directory = path.dirname(cliPath);
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = path.join(directory, 'package.json');
    if (existsSync(manifest)) {
      try {
        const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
        if (metadata.name === 'pnpm') return metadata;
      } catch {}
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function candidates(expectedVersion, env) {
  const result = [];
  if (env.npm_execpath) result.push(env.npm_execpath);
  const prefixes = [env.npm_config_prefix, env.PNPM_HOME];
  if (process.platform === 'win32') {
    prefixes.push(env.APPDATA ? path.join(env.APPDATA, 'npm') : undefined);
    prefixes.push(
      env.LOCALAPPDATA
        ? path.join(env.LOCALAPPDATA, 'node', 'corepack', 'v1', 'pnpm', expectedVersion, 'bin')
        : undefined,
    );
  } else {
    prefixes.push('/usr/local/lib/node_modules', '/usr/lib/node_modules');
    prefixes.push(path.join(os.homedir(), '.local', 'share', 'pnpm'));
    prefixes.push(
      path.join(os.homedir(), '.cache', 'node', 'corepack', 'v1', 'pnpm', expectedVersion, 'bin'),
    );
  }
  if (env.COREPACK_HOME)
    prefixes.push(path.join(env.COREPACK_HOME, 'v1', 'pnpm', expectedVersion, 'bin'));
  for (const prefix of prefixes.filter(Boolean)) {
    result.push(path.join(prefix, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'));
    result.push(path.join(prefix, 'pnpm', 'bin', 'pnpm.cjs'));
    result.push(path.join(prefix, 'pnpm.cjs'));
  }
  return [...new Set(result.map((candidate) => path.resolve(candidate)))];
}

/** Resolve the repository-pinned pnpm CLI without invoking shell shims. */
export function resolvePnpmEntry(packageJsonPath, env = process.env) {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const match = /^pnpm@(\d+\.\d+\.\d+)(?:\+.*)?$/.exec(packageJson.packageManager ?? '');
  if (!match) throw new Error('Root package.json must pin pnpm with packageManager.');
  const expectedVersion = match[1];
  for (const candidate of candidates(expectedVersion, env)) {
    if (existsSync(candidate) && readPnpmPackage(candidate)?.version === expectedVersion)
      return candidate;
  }
  throw new Error(
    `Could not resolve the repository-pinned pnpm ${expectedVersion} JavaScript entry point.`,
  );
}
