import { join } from 'node:path';
import type { BoxAdapter } from './types';

/**
 * Linux：生产目标。数据在 /var/lib，程序在 /opt，服务用 systemd。
 * PG 优先用安装包内置的 pgsql/bin，其次系统发行版包（路径随版本变化）。
 */
export const linuxAdapter: BoxAdapter = {
  id: 'linux',
  label: 'Linux',
  dataDir({ env }) {
    return env.WORKMESH_DATA_DIR ?? '/var/lib/workmesh';
  },
  installRoot({ env }) {
    return env.WORKMESH_HOME ?? '/opt/workmesh';
  },
  service() {
    return {
      manager: 'systemd',
      definitionPath: '/etc/systemd/system/workmesh.service',
      install: ['systemctl daemon-reload', 'systemctl enable workmesh'],
      start: ['systemctl start workmesh'],
      stop: ['systemctl stop workmesh'],
      status: ['systemctl status workmesh --no-pager'],
      uninstall: ['systemctl disable workmesh', 'systemctl daemon-reload'],
    };
  },
  pgCandidates({ installRoot }) {
    return [
      join(installRoot, 'pgsql', 'bin'),
      '/usr/lib/postgresql/16/bin',
      '/usr/lib/postgresql/15/bin',
      '/usr/bin',
    ];
  },
  tlsHint() {
    return 'Caddy（自动证书）或自签证书';
  },
};
