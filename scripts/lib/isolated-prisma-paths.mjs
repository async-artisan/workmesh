import { fileURLToPath } from 'node:url';

/** Resolve the checkout root from this helper's file URL, including on Windows. */
export function repoRootFromModuleUrl(moduleUrl) {
  return fileURLToPath(new URL('../../', moduleUrl));
}

/** Select a directory link type that works without elevation on Windows. */
export function prismaClientLinkType(platform = process.platform) {
  return platform === 'win32' ? 'junction' : 'dir';
}
