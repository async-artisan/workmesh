/**
 * 受控仓库 locator 的保守规范化（API/CLI 共用的纯函数）。
 *
 * 规范化只做三件事：去除凭据、规范 host 大小写、去掉显式的默认端口。
 * 仓库路径大小写、`.git` 后缀、协议（HTTPS/SSH）与 SSH host alias 全部保留：
 * HTTPS 与 SSH 形式、自建实例、fork、mirror 或不同路径都不猜测等价，
 * 只有有权限的 HUMAN 才能显式把额外 locator 加为同一仓库的别名。
 *
 * 本模块不访问网络、不读取进程环境，可直接在服务端与 CLI 中复用。
 */

export type RepositoryLocatorSource = 'HTTPS' | 'SSH';

export type CanonicalRepositoryLocator = {
  canonicalLocator: string;
  source: RepositoryLocatorSource;
  /** 小写 host（IPv6 保留方括号）。 */
  host: string;
  /** 以 `/` 开头的仓库路径，保留大小写与 `.git` 后缀。 */
  path: string;
  /** 展示字段：默认由 locator 推导，不是身份字段。 */
  owner: string;
  /** 展示字段：默认由 locator 推导，不是身份字段。 */
  name: string;
};

export class RepositoryLocatorError extends Error {
  readonly code = 'INVALID_REPOSITORY_LOCATOR';

  constructor(readonly reason: string) {
    super(reason);
    this.name = 'RepositoryLocatorError';
  }
}

const MAX_LOCATOR_LENGTH = 500;
const MAX_DISPLAY_LENGTH = 120;
const SCP_LIKE = /^([^@/:\s]+)@([^:/\s]+):(.+)$/;
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;

function fail(reason: string): never {
  throw new RepositoryLocatorError(reason);
}

function truncateDisplay(value: string): string {
  return value.length <= MAX_DISPLAY_LENGTH ? value : value.slice(0, MAX_DISPLAY_LENGTH);
}

function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function displayFields(host: string, path: string): { owner: string; name: string } {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const last = segments.length > 0 ? segments[segments.length - 1]! : host;
  const stripped = last.replace(/\.git$/i, '');
  const name = truncateDisplay(stripped.length > 0 ? stripped : last);
  const owner = truncateDisplay(segments.length >= 2 ? segments[0]! : host);
  return { owner, name };
}

function assertSafePath(path: string): void {
  if (path.length === 0 || path === '/') fail('repository path is required');
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') fail('repository path must not contain dot segments');
  }
}

/**
 * URL 构造器会把 `/a/../b` 静默折叠为 `/b`。locator 不是本机路径，折叠等于猜测等价，
 * 因此先在原始字符串上拒绝 dot segment，再做解析。
 */
function assertNoRawDotSegments(rawPath: string): void {
  for (const segment of rawPath.split('/')) {
    if (segment === '.' || segment === '..') fail('repository path must not contain dot segments');
  }
}

function normalizeHost(hostname: string): string {
  const host = hostname.trim().toLowerCase();
  if (host.length === 0) fail('repository host is required');
  return host;
}

function normalizePort(port: string, source: RepositoryLocatorSource): string {
  if (port.length === 0) return '';
  if (!/^[0-9]{1,5}$/.test(port)) fail('repository port is invalid');
  const numeric = Number(port);
  if (numeric < 1 || numeric > 65535) fail('repository port is out of range');
  if (source === 'HTTPS' && numeric === 443) return '';
  if (source === 'SSH' && numeric === 22) return '';
  return `:${numeric}`;
}

function resultOf(
  canonicalLocator: string,
  source: RepositoryLocatorSource,
  host: string,
  path: string,
): CanonicalRepositoryLocator {
  assertSafePath(path);
  const display = displayFields(host, path);
  return { canonicalLocator, source, host, path, owner: display.owner, name: display.name };
}

/**
 * 规范化受控 locator；输入不受支持时抛出 `RepositoryLocatorError`，不做任何猜测性等价。
 *
 * 支持形式：
 * - `https://host[:port]/path[.git]`
 * - `ssh://[user@]host[:port]/path[.git]`
 * - scp 形式 `user@host:path[.git]`（归一到 ssh://，协议仍是 SSH）
 */
export function canonicalizeRepositoryLocator(input: string): CanonicalRepositoryLocator {
  if (typeof input !== 'string') fail('locator must be a string');
  const raw = input.trim();
  if (raw.length === 0) fail('locator is required');
  // 不依赖 Node Buffer：本包也会被打进浏览器/CLI 产物。
  if (new TextEncoder().encode(raw).length > MAX_LOCATOR_LENGTH) fail('locator is too long');
  if (/\s/.test(raw)) fail('locator must not contain whitespace');
  if (containsControlCharacters(raw)) fail('locator must not contain control characters');
  if (raw.includes('?') || raw.includes('#'))
    fail('locator must not contain a query string or fragment');

  const schemeMatch = SCHEME.exec(raw);
  if (!schemeMatch) {
    const scp = SCP_LIKE.exec(raw);
    if (!scp) fail('unsupported locator form');
    const user = scp[1]!;
    const host = normalizeHost(scp[2]!);
    const rawPath = scp[3]!;
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    assertNoRawDotSegments(path);
    const canonicalLocator = `ssh://${user}@${host}${path}`;
    return resultOf(canonicalLocator, 'SSH', host, path);
  }

  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme !== 'https' && scheme !== 'ssh')
    fail(`unsupported locator scheme "${scheme}"; expected https or ssh`);
  const source: RepositoryLocatorSource = scheme === 'https' ? 'HTTPS' : 'SSH';

  const afterScheme = raw.slice(schemeMatch[0].length);
  const slashIndex = afterScheme.indexOf('/');
  if (slashIndex < 0) fail('repository path is required');
  assertNoRawDotSegments(afterScheme.slice(slashIndex));

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail('locator is not a parseable URL');
  }

  const host = normalizeHost(parsed.hostname);
  const path = parsed.pathname;
  assertSafePath(path);

  // 凭据（password 总是丢弃；https 的 userinfo 也丢弃，ssh 用户名是地址组成而非凭据）。
  const user = source === 'SSH' ? parsed.username : '';
  const port = normalizePort(parsed.port, source);
  const canonicalLocator =
    source === 'HTTPS'
      ? `https://${host}${port}${path}`
      : `ssh://${user.length > 0 ? `${user}@` : ''}${host}${port}${path}`;
  return resultOf(canonicalLocator, source, host, path);
}

/** 不抛错的版本：仅用于「是否可解析」判断，不用于声明入库。 */
export function tryCanonicalizeRepositoryLocator(
  input: unknown,
): CanonicalRepositoryLocator | null {
  if (typeof input !== 'string') return null;
  try {
    return canonicalizeRepositoryLocator(input);
  } catch {
    return null;
  }
}
