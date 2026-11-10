import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { analyzeQualityBundle, parseJsonStrict, type QualityReport } from '@workmesh/shared';
import { CliError } from './errors';

/** 只读取显式指定的本地 JSON；不解析或访问证据 URL，不执行任务。 */
export async function checkQualityFile(file: string, root: string): Promise<QualityReport> {
  const maxBytes = 4 * 1024 * 1024;
  let bytes: Buffer;
  try {
    const handle = await open(resolve(root, file), 'r');
    try {
      if (!(await handle.stat()).isFile())
        throw new CliError('LOCAL_INPUT_INVALID', '质量包必须是普通文件');
      const buffer = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset > maxBytes) throw new CliError('LOCAL_INPUT_INVALID', '质量包不能超过 4 MiB');
      bytes = buffer.subarray(0, offset);
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError('LOCAL_INPUT_INVALID', '无法读取指定质量包');
  }
  let input: unknown;
  try {
    input = parseJsonStrict(bytes);
  } catch {
    throw new CliError('LOCAL_INPUT_INVALID', '质量包必须是无重复键的 UTF-8 JSON');
  }
  return analyzeQualityBundle(input);
}
