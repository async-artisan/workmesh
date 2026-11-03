import { join } from 'node:path';
import type { BoxAdapter } from './types';

/**
 * macOS：数据在 ~/Library/Application Support，程序在 /usr/local，服务用 launchd。
 * PG 优先内置 pgsql/bin，其次 Homebrew（Apple Silicon 与 Intel 两套前缀）。
 */
export const darwinAdapter: BoxAdapter = {
  id: 'darwin',
  label: 'macOS',
  dataDir({ home, env }) {
    if (env.WORKMESH_DATA_DIR) return env.WORKMESH_DATA_DIR;
    const userHome = home ?? env.HOME ?? '';
    return join(userHome, 'Library', 'Application Support', 'workmesh');
  },
  installRoot({ env }) {
    return env.WORKMESH_HOME ?? '/usr/local/workmesh';
  },
  service({ home }) {
    const userHome = home ?? process.env.HOME ?? '';
    const plist = join(userHome, 'Library', 'LaunchAgents', 'com.workmesh.server.plist');
    return {
      manager: 'launchd',
      definitionPath: plist,
      install: [`launchctl load -w "${plist}"`],
      start: [`launchctl start com.workmesh.server`],
      stop: [`launchctl stop com.workmesh.server`],
      status: ['launchctl list com.workmesh.server'],
      uninstall: [`launchctl unload -w "${plist}"`],
    };
  },
  pgCandidates({ installRoot }) {
    return [
      join(installRoot, 'pgsql', 'bin'),
      '/opt/homebrew/opt/postgresql@16/bin',
      '/usr/local/opt/postgresql@16/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];
  },
  tlsHint() {
    return '自签证书（mkcert）；未签名二进制首次运行需右键打开或去隔离属性';
  },
};
