import { darwinAdapter } from './darwin';
import { linuxAdapter } from './linux';
import { windowsAdapter } from './windows';
import type { BoxAdapter, PlatformId } from './types';

export { darwinAdapter, linuxAdapter, windowsAdapter };
export type { BoxAdapter, PlatformId } from './types';

/** 只要不是 win32/darwin，一律按 Linux 处理；未知平台在入口处显式拒绝。 */
export function adapterFor(platform: NodeJS.Platform = process.platform): BoxAdapter {
  if (platform === 'win32') return windowsAdapter;
  if (platform === 'darwin') return darwinAdapter;
  if (platform === 'linux') return linuxAdapter;
  throw new Error(`不支持的平台：${platform}（支持 Windows / Linux / macOS）`);
}

export function adapterById(id: PlatformId): BoxAdapter {
  if (id === 'windows') return windowsAdapter;
  if (id === 'darwin') return darwinAdapter;
  return linuxAdapter;
}
