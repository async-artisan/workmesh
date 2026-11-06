import { CliError } from './errors';

export type Platform = {
  origin: string;
  apiBasePath: string;
};

const API_ROOT = '/api/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/**
 * 平台标识由 origin 与 apiBasePath 组成；正式环境必须 HTTPS，
 * 只有用户明确选择的 loopback 本地开发允许 HTTP。
 */
export function parsePlatform(input: string): Platform {
  const value = input.trim();
  if (!value) throw new CliError('INVALID_REQUEST', '缺少平台地址 --api');
  if (/\s/.test(value)) throw new CliError('INVALID_REQUEST', '平台地址不能包含空白字符');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError('INVALID_REQUEST', `平台地址不是合法 URL：${value}`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new CliError('INVALID_REQUEST', '平台地址必须是 http(s)');
  if (url.username || url.password)
    throw new CliError('INVALID_REQUEST', '平台地址不能包含用户名或密码');
  if (url.search || url.hash)
    throw new CliError('INVALID_REQUEST', '平台地址不能包含 query 或 fragment');
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname))
    throw new CliError('INVALID_REQUEST', '只有 loopback 本地开发允许 HTTP，正式平台必须 HTTPS');

  const hostname = url.hostname.toLowerCase();
  const origin = `${url.protocol}//${hostname}${url.port ? `:${url.port}` : ''}`.toLowerCase();

  let path = url.pathname;
  if (path === '' || path === '/') path = API_ROOT;
  if (path.endsWith('/')) path = path.slice(0, -1);
  if (!path.endsWith(API_ROOT))
    clampThrow(`API 路径必须以 ${API_ROOT} 结尾（允许明确的反向代理前缀）`);
  if (path.includes('//') || path.includes('..')) clampThrow('API 路径不能包含空段或点段');
  if (/%[0-9a-fA-F]{2}/.test(path)) clampThrow('API 路径不能包含编码分隔符');

  return { origin, apiBasePath: path };
}

function clampThrow(message: string): never {
  throw new CliError('INVALID_REQUEST', message);
}

/** 从 workspace 配置里的 {origin,apiBasePath} 还原并再次验证。 */
export function platformFromParts(origin: string, apiBasePath: string): Platform {
  if (apiBasePath !== apiBasePath.trim() || !apiBasePath.startsWith('/'))
    clampThrow('apiBasePath 必须以 / 开头');
  if (apiBasePath.includes('//') || apiBasePath.includes('..'))
    clampThrow('apiBasePath 不能包含空段或点段');
  return parsePlatform(`${origin}${apiBasePath}`);
}

/** 浏览器授权链接只允许固定站内页面；loopback 本地 Web/API 可使用不同端口。 */
export function verificationUrl(platform: Platform, verificationUri: string): string {
  if (/\s|deviceCode|userCode|codeVerifier|secret|token/i.test(verificationUri))
    clampThrow('verificationUri 不能携带设备码、验证器或凭据');
  const platformUrl = new URL(platform.origin);
  let target: URL;
  try {
    if (verificationUri.startsWith('/') && !verificationUri.startsWith('//')) {
      target = new URL(verificationUri, platform.origin);
    } else {
      target = new URL(verificationUri);
    }
  } catch {
    clampThrow('verificationUri 必须是合法站内地址');
  }
  if (
    (target.protocol !== 'https:' && target.protocol !== 'http:') ||
    target.protocol !== platformUrl.protocol ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/cli/authorize'
  )
    clampThrow('verificationUri 必须指向固定的设备授权页');

  const isLoopback = (hostname: string) => LOOPBACK.has(hostname.toLowerCase());
  if (
    target.origin !== platformUrl.origin &&
    !(isLoopback(platformUrl.hostname) && isLoopback(target.hostname))
  )
    clampThrow('verificationUri 必须与平台同源（本地 loopback 允许不同端口）');

  return target.toString();
}
