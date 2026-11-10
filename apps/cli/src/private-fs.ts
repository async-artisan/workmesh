import { execFile } from 'node:child_process';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, win32 } from 'node:path';
import { promisify } from 'node:util';
import { platform as osPlatform } from 'node:os';

const run = promisify(execFile);

/**
 * 凭据文件的“只有本人可读”保证在家用操作系统上要分两条实现：
 * - POSIX（macOS/Linux）：0700 目录 + 0600 文件，读取前校验 mode 位与属主。
 * - Windows：没有 mode 位，等价物是 NTFS DACL —— 断开继承，只授予当前用户。
 * 二者强度对齐：都是「同机其他普通用户不可读」。管理员/root 始终能读，
 * 这一点两个平台没有差别，不是本次引入的新风险。
 */
export const IS_WINDOWS = osPlatform() === 'win32';

/** 支持的宿主；未知平台一律拒绝，不做猜测性降级。 */
export function hostSupported(): boolean {
  return ['darwin', 'linux', 'freebsd', 'openbsd', 'win32'].includes(osPlatform());
}

/**
 * Windows 上 icacls 显示的主体名与 whoami 一致（`DOMAIN\user`），用它做比对，
 * 避免解析本地化文本里的权限描述。
 */
let principalLookup: Promise<string> | undefined;

/** Never resolve Windows permission tools through a shell or PATH (including Git Bash). */
export function windowsSystemTool(name: 'whoami' | 'icacls'): string {
  const systemRoot = process.env.SystemRoot ?? process.env.windir;
  if (
    !systemRoot ||
    !win32.isAbsolute(systemRoot) ||
    !/^[a-z]:[\\/]$/i.test(win32.parse(systemRoot).root)
  )
    throw new Error('Windows 系统工具定位失败：SystemRoot / windir 必须是带盘符的绝对路径');
  return win32.join(systemRoot, 'System32', `${name}.exe`);
}

async function runWindowsSystemTool(
  name: 'whoami' | 'icacls',
  args: string[],
  stage: string,
  target?: string,
): Promise<{ stdout: string; executable: string }> {
  const executable = windowsSystemTool(name);
  try {
    const { stdout } = await run(executable, args, { windowsHide: true });
    return { stdout, executable };
  } catch (error: unknown) {
    const code = (error as { code?: unknown } | null)?.code;
    // Do not propagate child stdout/stderr or its command arguments into CLI errors.
    const detail =
      typeof code === 'number' || (typeof code === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(code))
        ? `（${code}）`
        : '';
    const location = target ? `；目标：${target}` : '';
    // eslint-disable-next-line preserve-caught-error -- Raw child errors may contain secret stdout, stderr or command arguments; only the sanitized code crosses this boundary.
    throw new Error(`${stage}失败：无法执行 ${executable}${detail}${location}`);
  }
}

export function currentPrincipal(): Promise<string> {
  // A CLI process keeps one OS identity. Share the lookup across concurrent ACL
  // operations instead of spawning whoami for every file. Failures remain retryable.
  principalLookup ??= (async () => {
    const { stdout, executable } = await runWindowsSystemTool('whoami', [], 'Windows 身份识别');
    const principal = stdout.trim();
    if (!principal.includes('\\'))
      throw new Error(`Windows 身份识别失败：${executable} 未返回 DOMAIN\\user 形式的主体名`);
    return principal.toUpperCase();
  })().catch((error: unknown) => {
    principalLookup = undefined;
    throw error;
  });
  return principalLookup;
}

async function icacls(args: string[], stage: string): Promise<string> {
  const { stdout } = await runWindowsSystemTool('icacls', args, stage, args[0]);
  return stdout;
}

/** 目录只允许当前用户访问：POSIX 用 0700，Windows 用 DACL。 */
export async function ensurePrivateDir(path: string): Promise<void> {
  if (IS_WINDOWS) {
    await mkdir(path, { recursive: true });
    await hardenWindowsPath(path, true);
    return;
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

async function replacePrivateFile(temporary: string, path: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows readers and scanners can briefly deny replacement. Retry the
      // same atomic rename only; never unlink the destination or rewrite bytes.
      if (!IS_WINDOWS || attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? ''))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(20 * 2 ** attempt, 200)));
    }
  }
}

/**
 * 原子写入一个“只有当前用户可读”的文件：先写同目录临时文件并收紧权限，
 * 再 rename 覆盖。POSIX 与 Windows 走各自的私有化实现。
 */
export async function writePrivateFile(
  path: string,
  data: string | Uint8Array,
  options: { flag?: 'w' | 'wx' } = {},
): Promise<void> {
  const directory = dirname(path);
  await ensurePrivateDir(directory);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const flag = options.flag ?? 'w';
  if (IS_WINDOWS) {
    await writeFile(temporary, data, { flag });
    await hardenWindowsPath(temporary, false);
    await replacePrivateFile(temporary, path);
    await hardenWindowsPath(path, false);
    return;
  }
  await writeFile(temporary, data, { mode: 0o600, flag });
  await chmod(temporary, 0o600);
  await replacePrivateFile(temporary, path);
  await chmod(path, 0o600);
}

/** 断开继承并只授权当前用户；目录额外加 (OI)(CI) 让新建文件自动继承。 */
export async function hardenWindowsPath(path: string, isDirectory: boolean): Promise<void> {
  const principal = await currentPrincipal();
  const grant = isDirectory ? `${principal}:(OI)(CI)F` : `${principal}:F`;
  await icacls([path, '/inheritance:r', '/grant:r', grant], 'Windows 凭据权限设置');
}

/**
 * 读取前校验：必须仍然只授予当前用户，且没有任何继承项。
 * 只要出现别的授权主体或 (I) 标记，就按“权限过宽”拒绝，与 POSIX 分支同语义。
 */
export async function verifyWindowsPath(path: string): Promise<void> {
  const principal = await currentPrincipal();
  const output = await icacls([path], 'Windows 凭据权限读取');
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const marker = line.indexOf(':(');
    if (marker < 0) continue;
    const before = line.slice(0, marker);
    const permissions = line.slice(marker);
    // 完整性标签/审核项（(NW)/(NR)）不是访问授权，icacls 会把它们一起打出来，
    // 这类条目普遍带 (I) 继承标记，不能据此判定文件权限过宽。
    if (permissions.includes('NW') || permissions.includes('NR')) continue;
    if (permissions.includes('(I)')) throw new Error(`${path} 含继承权限，拒绝读取`);
    const subject = before.split(/\s+/).pop() ?? '';
    if (!subject) continue;
    if (subject.toUpperCase() !== principal)
      throw new Error(`${path} 对其他主体授予了权限（${subject}），拒绝读取`);
  }
}
