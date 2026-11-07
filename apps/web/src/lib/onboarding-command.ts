export type OnboardingShell = 'git-bash' | 'powershell';
export type OnboardingHost = 'codex' | 'claude-code';

export interface OnboardingCommandInput {
  shell: string;
  host: string;
  code: string;
  role: string;
  root: string;
  api: string;
}

export type OnboardingCommandResult =
  { command: string; error: null } | { command: null; error: string };

// Both shells receive literal arguments. Never interpolate user input into
// double quotes, where $, backticks and command substitutions can execute.
function quote(value: string, shell: OnboardingShell): string {
  return shell === 'git-bash'
    ? `'${value.replaceAll("'", "'\"'\"'")}'`
    : `'${value.replace(/['\u2018\u2019]/g, (character) => character + character)}'`;
}

export function onboardingRoot(root: string, shell: OnboardingShell): string {
  if (shell === 'git-bash') {
    return root
      .replace(/^([a-z]):[\\/]/i, (_match, drive: string) => `/${drive.toLowerCase()}/`)
      .replaceAll('\\', '/');
  }
  return root.replace(
    /^\/([a-z])(?:\/|$)/i,
    (_match, drive: string) => `${drive.toUpperCase()}:\\`,
  );
}

/** Build only the existing, non-consuming preview command; apply stays explicit. */
export function buildOnboardingCommand(input: OnboardingCommandInput): OnboardingCommandResult {
  const invalid = (error: string): OnboardingCommandResult => ({ command: null, error });
  if (input.shell !== 'git-bash' && input.shell !== 'powershell')
    return invalid('请选择要使用的 Shell。');
  if (input.host !== 'codex' && input.host !== 'claude-code')
    return invalid('请选择 Agent 客户端。');
  if (!input.code.trim()) return invalid('请先生成接入码。');
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(input.role)) return invalid('请选择有效的项目角色。');
  if (!input.root.trim()) return invalid('请填写本地业务代码的工作区根目录。');
  if (!input.api.trim()) return invalid('请填写管理员提供的完整 WorkMesh API 地址。');
  if (Object.values(input).some((value) => /[\p{Cc}\u2028\u2029]/u.test(value)))
    return invalid('参数不能包含换行符或控制字符，请使用单行内容。');

  const root = onboardingRoot(input.root.trim(), input.shell);
  if (!/^(?:[a-z]:[\\/]|[\\/]{2}|\/)/i.test(root))
    return invalid('请填写绝对目录，例如 G:\\projects\\app 或 /g/projects/app。');
  const api = input.api.trim().replace(/\/$/, '');
  if (/\s/.test(api)) return invalid('API 地址不能包含空白字符。');
  let url: URL;
  try {
    url = new URL(api);
  } catch {
    return invalid('API 地址必须是完整的 http(s) 地址，并以 /api/v1 结尾。');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    return invalid('API 地址需要 HTTPS；本机 localhost 或 127.0.0.1 可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/v1'))
    return invalid('API 地址应以 /api/v1 结尾，且不能包含账号、密码、查询参数或片段。');
  if (
    url.pathname.includes('//') ||
    url.pathname.includes('..') ||
    /%[0-9a-fA-F]{2}/.test(url.pathname)
  )
    return invalid('API 路径不能包含空段、点段或编码字符。');

  const args = [
    '--join',
    input.code,
    '--root',
    root,
    '--api',
    api,
    '--role',
    input.role,
    '--host',
    input.host,
  ];
  return {
    command: `workmesh workspace init ${args.map((value, index) => (index % 2 ? quote(value, input.shell as OnboardingShell) : value)).join(' ')}`,
    error: null,
  };
}
