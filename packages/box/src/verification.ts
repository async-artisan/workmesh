/**
 * 平台“支持”的证据分级：只有真正在本机跑过完整验收脚本的平台才写 verified。
 * Linux / macOS 的适配器已经实现，但尚未在对应系统上执行验收，因此这里是 false。
 */
export const VERIFIED_PLATFORMS: ReadonlyArray<'windows' | 'linux' | 'darwin'> = ['windows'];

export function isVerified(platform: 'windows' | 'linux' | 'darwin'): boolean {
  return VERIFIED_PLATFORMS.includes(platform);
}

export function platformLabel(platform: 'windows' | 'linux' | 'darwin'): string {
  if (platform === 'windows') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return 'Linux';
}
