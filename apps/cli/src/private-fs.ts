import { execFile } from 'node:child_process';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
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

export function currentPrincipal(): Promise<string> {
  // A CLI process keeps one OS identity. Share the lookup across concurrent ACL
  // operations instead of spawning whoami for every file. Failures remain retryable.
  principalLookup ??= (async () => {
    const { stdout } = await run('whoami', [], { windowsHide: true });
    const principal = stdout.trim();
    if (!principal.includes('\\')) throw new Error('whoami 未返回 DOMAIN\\user 形式的主体名');
    return principal.toUpperCase();
  })().catch((error: unknown) => {
    principalLookup = undefined;
    throw error;
  });
  return principalLookup;
}

async function icacls(args: string[]): Promise<string> {
  const { stdout } = await run('icacls', args, { windowsHide: true });
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
    await rename(temporary, path);
    await hardenWindowsPath(path, false);
    return;
  }
  await writeFile(temporary, data, { mode: 0o600, flag });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

/** 断开继承并只授权当前用户；目录额外加 (OI)(CI) 让新建文件自动继承。 */
export async function hardenWindowsPath(path: string, isDirectory: boolean): Promise<void> {
  const principal = await currentPrincipal();
  const grant = isDirectory ? `${principal}:(OI)(CI)F` : `${principal}:F`;
  await icacls([path, '/inheritance:r', '/grant:r', grant]);
}

/**
 * 读取前校验：必须仍然只授予当前用户，且没有任何继承项。
 * 只要出现别的授权主体或 (I) 标记，就按“权限过宽”拒绝，与 POSIX 分支同语义。
 */
export async function verifyWindowsPath(path: string): Promise<void> {
  const principal = await currentPrincipal();
  const output = await icacls([path]);
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
