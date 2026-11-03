import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { darwinAdapter, linuxAdapter, windowsAdapter } from './adapters';

const env = {} as NodeJS.ProcessEnv;
const home = 'C:\\Users\\tester';

describe('windows adapter', () => {
  it('数据目录在 LOCALAPPDATA，安装目录在 ProgramData', () => {
    expect(windowsAdapter.dataDir({ home, env })).toBe(
      join('C:\\Users\\tester', 'AppData', 'Local', 'workmesh'),
    );
    expect(windowsAdapter.installRoot({ env })).toBe(join('C:\\ProgramData', 'WorkMesh'));
  });

  it('WORKMESH_DATA_DIR / WORKMESH_HOME 覆盖默认', () => {
    expect(windowsAdapter.dataDir({ home, env: { WORKMESH_DATA_DIR: 'D:\\wm-data' } })).toBe(
      'D:\\wm-data',
    );
    expect(windowsAdapter.installRoot({ env: { WORKMESH_HOME: 'D:\\wm' } })).toBe('D:\\wm');
  });

  it('服务用 WinSW，命令指向安装目录下的 service exe', () => {
    const service = windowsAdapter.service({
      installRoot: 'D:\\wm',
      dataDir: 'D:\\wm-data',
      port: 3000,
    });
    expect(service.manager).toBe('winsw');
    expect(service.definitionPath.toLowerCase()).toContain('workmesh-service.xml');
    expect(service.install[0]).toContain('workmesh-service.exe');
    expect(service.install[0]).toContain('install');
  });

  it('PG 客户端优先安装包 pgsql/bin，其次数据目录与仓库 .tmp', () => {
    const candidates = windowsAdapter.pgCandidates({
      installRoot: 'D:\\wm',
      dataDir: 'D:\\wm-data',
      repoRoot: 'D:\\repo',
    });
    expect(candidates[0]).toBe(join('D:\\wm', 'pgsql', 'bin'));
    expect(candidates[1]).toBe(join('D:\\wm-data', 'pgsql', 'bin'));
    expect(candidates[2]).toBe(join('D:\\repo', '.tmp', 'pgclient', 'pgsql', 'bin'));
  });
});

describe('linux adapter', () => {
  it('使用 /var/lib 与 /opt，服务是 systemd', () => {
    expect(linuxAdapter.dataDir({ home: '/home/u', env })).toBe('/var/lib/workmesh');
    expect(linuxAdapter.installRoot({ env })).toBe('/opt/workmesh');
    const service = linuxAdapter.service({
      installRoot: '/opt/workmesh',
      dataDir: '/var/lib/workmesh',
      port: 3000,
    });
    expect(service.manager).toBe('systemd');
    expect(service.definitionPath).toBe('/etc/systemd/system/workmesh.service');
    expect(service.start).toContain('systemctl start workmesh');
  });

  it('覆盖环境变量生效', () => {
    expect(linuxAdapter.dataDir({ home: '/home/u', env: { WORKMESH_DATA_DIR: '/srv/wm' } })).toBe(
      '/srv/wm',
    );
  });
});

describe('darwin adapter', () => {
  it('使用 ~/Library 与 /usr/local，服务是 launchd', () => {
    expect(darwinAdapter.dataDir({ home: '/Users/u', env })).toBe(
      join('/Users/u', 'Library', 'Application Support', 'workmesh'),
    );
    expect(darwinAdapter.installRoot({ env })).toBe('/usr/local/workmesh');
    const service = darwinAdapter.service({
      installRoot: '/usr/local/workmesh',
      dataDir: '/Users/u/Library/Application Support/workmesh',
      port: 3000,
    });
    expect(service.manager).toBe('launchd');
    expect(service.definitionPath).toContain('LaunchAgents');
    expect(service.install[0]).toContain('launchctl load');
  });
});
