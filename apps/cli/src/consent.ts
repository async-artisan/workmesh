import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CliError } from './errors';
import { IS_WINDOWS } from './private-fs';

/**
 * 凭据只写当前用户可读的本地文件（非系统钥匙串），登录前必须得到显式同意。
 * 非交互环境不接受默认同意：必须显式传 --credential-store file。
 */
export async function confirmFileStore(): Promise<void> {
  if (!stdin.isTTY)
    throw new CliError(
      'APPROVAL_REQUIRED',
      '非交互环境必须显式传 --credential-store file，明确同意使用仅当前用户可读的本地文件存储',
    );
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const permissions = IS_WINDOWS
      ? '凭据将写入当前用户 home 下的本地文件，使用 NTFS 权限关闭继承并仅授权当前用户'
      : '凭据将写入当前用户 home 下的 0600 文件';
    const answer = await prompt.question(
      `${permissions}（非系统钥匙串），不宣称对同一 OS 用户加密隔离。输入 yes 继续：`,
    );
    if (answer.trim().toLowerCase() !== 'yes')
      throw new CliError('APPROVAL_REQUIRED', '未同意本地文件存储，已取消登录');
  } finally {
    prompt.close();
  }
}
