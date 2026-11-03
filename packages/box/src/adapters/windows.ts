import { join } from 'node:path';
import type { BoxAdapter } from './types';

/**
 * Windows：数据在 %LOCALAPPDATA%，程序装到 %ProgramData%，服务用 WinSW 注册。
 * 这里只生成命令，不执行——执行由 `workmesh-box install` 决定，测试可以断言命令文本。
 */
export const windowsAdapter: BoxAdapter = {
  id: 'windows',
  label: 'Windows',
  dataDir({ home, env }) {
    if (env.WORKMESH_DATA_DIR) return env.WORKMESH_DATA_DIR;
    const localAppData =
      env.LOCALAPPDATA ?? join(home ?? env.USERPROFILE ?? '', 'AppData', 'Local');
    return join(localAppData, 'workmesh');
  },
  installRoot({ env }) {
    if (env.WORKMESH_HOME) return env.WORKMESH_HOME;
    return join(env.ProgramData ?? 'C:\\ProgramData', 'WorkMesh');
  },
  service({ installRoot }) {
    const exe = join(installRoot, 'workmesh-service.exe');
    return {
      manager: 'winsw',
      definitionPath: join(installRoot, 'workmesh-service.xml'),
      install: [`"${exe}" install`],
      start: [`"${exe}" start`],
      stop: [`"${exe}" stop`],
      status: [`"${exe}" status`],
      uninstall: [`"${exe}" uninstall`],
    };
  },
  pgCandidates({ installRoot, dataDir, repoRoot }) {
    return [
      join(installRoot, 'pgsql', 'bin'),
      join(dataDir, 'pgsql', 'bin'),
      ...(repoRoot ? [join(repoRoot, '.tmp', 'pgclient', 'pgsql', 'bin')] : []),
    ];
  },
  tlsHint() {
    return '自签证书（mkcert）或放在公司反向代理之后';
  },
};
