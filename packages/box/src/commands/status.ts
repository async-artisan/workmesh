import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BoxContext } from '../context';
import { isPortOpen } from '../lib/net';
import { listBackups, type BackupManifest } from '../lib/backup';
import { isVerified, platformLabel } from '../verification';
import { BOX_VERSION } from '../version';

export type StatusCheck = {
  name: string;
  ok: boolean;
  critical: boolean;
  detail: string;
};

export type StatusReport = {
  version: string;
  platform: { id: string; label: string; verified: boolean };
  node: string;
  repoRoot: string | null;
  dataDir: { path: string; exists: boolean; writable: boolean };
  installRoot: string;
  service: { manager: string; definitionPath: string };
  database: {
    configured: boolean;
    maskedUrl: string | null;
    host: string | null;
    port: number | null;
    name: string | null;
    reachable: boolean;
  };
  pgTools: { source: string; version: string | null; binDir: string | null } | null;
  ports: { api: number; web: number; apiListening: boolean; webListening: boolean };
  health: { ok: boolean; detail: string };
  /**
   * 就绪（能否干活）与 health（进程是否活着）分开：
   * health 只证明进程在跑，数据库不可达或迁移没应用时它照样 ok——这正是原先假绿的来源。
   */
  ready: { ok: boolean; detail: string; appliedMigrations: number | null };
  backup: { count: number; latest: BackupManifest | null };
  checks: StatusCheck[];
};

/** 就绪失败的 reason 码转成可操作的说明；不回显底层驱动文本。 */
export function readinessFailureDetail(status: number, reason: unknown): string {
  switch (reason) {
    case 'CONNECT_FAILED':
      return '数据库不可达（端口开着但连接失败？检查 WORKMESH_V1_DATABASE_URL 与库是否已创建）';
    case 'SCHEMA_NOT_MIGRATED':
      return '数据库可连接但 schema 未迁移（运行 prisma migrate deploy）';
    case 'TIMEOUT':
      return '数据库探针超时';
    default:
      return `HTTP ${status}`;
  }
}

/** 仓库内迁移目录数量，用于发现「库里的迁移比代码少」。打包形态无该目录时返回 null。 */
function expectedMigrationCount(repoRoot: string | null): number | null {
  if (!repoRoot) return null;
  const dir = join(repoRoot, 'apps', 'api', 'prisma', 'migrations');
  if (!existsSync(dir)) return null;
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && /^\d{4}_/.test(entry.name),
    ).length;
  } catch {
    return null;
  }
}

function pgVersionOf(pgDump: string): string | null {
  try {
    const result = spawnSync(pgDump, ['--version'], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) return null;
    return result.stdout.trim().replace(/^pg_dump \(PostgreSQL\)\s*/, '');
  } catch {
    return null;
  }
}

export async function collectStatus(ctx: BoxContext): Promise<StatusReport> {
  const dataDirExists = existsSync(ctx.dataDir);
  let writable: boolean;
  try {
    mkdirSync(ctx.dataDir, { recursive: true });
    writable = true;
  } catch {
    writable = false;
  }

  const dbPort = ctx.database?.port ?? 5432;
  const dbHost = ctx.database?.host ?? '127.0.0.1';
  const dbReachable = ctx.database ? await isPortOpen(dbPort, dbHost) : false;
  const apiListening = await isPortOpen(ctx.apiPort);
  const webListening = await isPortOpen(ctx.webPort);

  let health: { ok: boolean; detail: string } = { ok: false, detail: 'API 未监听' };
  if (apiListening) {
    try {
      const response = await fetch(`http://127.0.0.1:${ctx.apiPort}/api/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      health = { ok: response.ok, detail: response.ok ? 'ok' : `HTTP ${response.status}` };
    } catch (caught) {
      health = { ok: false, detail: (caught as Error).message };
    }
  }

  // 就绪探测：只有 API 在监听时才问得出结果；API 未启动时一律留给启动流程去验证。
  let ready: { ok: boolean; detail: string; appliedMigrations: number | null } = {
    ok: false,
    detail: 'API 未监听',
    appliedMigrations: null,
  };
  if (apiListening) {
    try {
      const response = await fetch(`http://127.0.0.1:${ctx.apiPort}/api/health/ready`, {
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await response.json().catch(() => null)) as {
        data?: { database?: { appliedMigrations?: number } };
        error?: { details?: { reason?: string } };
      } | null;
      const appliedMigrations = body?.data?.database?.appliedMigrations ?? null;
      ready = response.ok
        ? {
            ok: true,
            detail: appliedMigrations === null ? 'ok' : `ok · 已应用迁移 ${appliedMigrations} 项`,
            appliedMigrations,
          }
        : {
            ok: false,
            detail: readinessFailureDetail(response.status, body?.error?.details?.reason),
            appliedMigrations,
          };
    } catch (caught) {
      ready = { ok: false, detail: (caught as Error).message, appliedMigrations: null };
    }
  }

  // 库里应用的迁移数少于仓库里的迁移文件，说明这次部署漏跑了迁移。
  const expectedMigrations = expectedMigrationCount(ctx.repoRoot);
  const migrationsInSync =
    ready.appliedMigrations === null || expectedMigrations === null
      ? null
      : ready.appliedMigrations === expectedMigrations;

  const backups = listBackups(ctx.dataDir);
  const service = ctx.adapter.service({
    installRoot: ctx.installRoot,
    dataDir: ctx.dataDir,
    port: ctx.apiPort,
  });

  const checks: StatusCheck[] = [
    {
      name: 'database',
      ok: dbReachable,
      critical: true,
      detail: ctx.database
        ? `${ctx.database.maskedUrl}${dbReachable ? '' : '（端口未监听）'}`
        : '未配置 WORKMESH_V1_DATABASE_URL',
    },
    {
      name: 'postgres-client',
      ok: Boolean(ctx.pg),
      critical: true,
      detail: ctx.pg
        ? `${ctx.pg.source}${ctx.pg.binDir ? ` · ${ctx.pg.binDir}` : ''}`
        : '未找到 pg_dump/psql（设置 WORKMESH_PG_BIN 或随安装包提供 pgsql/bin）',
    },
    {
      name: 'data-dir',
      ok: writable,
      critical: true,
      detail: `${ctx.dataDir}${writable ? '' : '（不可写）'}`,
    },
    {
      name: 'api',
      ok: apiListening && health.ok,
      critical: false,
      detail: apiListening ? health.detail : `端口 ${ctx.apiPort} 未监听`,
    },
    {
      // API 正在跑却不就绪，是真实故障，必须让 doctor 变红；
      // API 根本没启动时这条不成立（交给 dev/install 去验证），所以不判关键。
      name: 'api-ready',
      ok: ready.ok,
      critical: apiListening,
      detail: ready.detail,
    },
    ...(migrationsInSync === null
      ? []
      : [
          {
            name: 'migrations-in-sync',
            ok: migrationsInSync,
            critical: true,
            detail: `数据库 ${ready.appliedMigrations} 项 / 仓库 ${expectedMigrations} 项`,
          },
        ]),
    {
      name: 'web',
      ok: webListening,
      critical: false,
      detail: webListening ? `端口 ${ctx.webPort} 已监听` : `端口 ${ctx.webPort} 未监听`,
    },
    {
      // 未验证过的备份等于没有备份；但旧备份本来就没有 verification 字段，
      // 所以这条只做提示、不让 doctor 变红，避免一升级就全员红。
      name: 'backup-verified',
      ok: backups[0]?.verification != null,
      critical: false,
      detail: backups[0]
        ? backups[0].verification
          ? `最近备份已验证：${backups[0].verification.verifiedAt}，恢复出 ${backups[0].verification.tables} 张表`
          : '最近备份未验证可恢复性（运行 workmesh-box backup --verify）'
        : '还没有备份（运行 workmesh-box backup --verify）',
    },
  ];

  return {
    version: BOX_VERSION,
    platform: {
      id: ctx.adapter.id,
      label: platformLabel(ctx.adapter.id),
      verified: isVerified(ctx.adapter.id),
    },
    node: process.version,
    repoRoot: ctx.repoRoot,
    dataDir: { path: ctx.dataDir, exists: dataDirExists, writable },
    installRoot: ctx.installRoot,
    service: { manager: service.manager, definitionPath: service.definitionPath },
    database: {
      configured: Boolean(ctx.database),
      maskedUrl: ctx.database?.maskedUrl ?? null,
      host: ctx.database?.host ?? null,
      port: ctx.database?.port ?? null,
      name: ctx.database?.database ?? null,
      reachable: dbReachable,
    },
    pgTools: ctx.pg
      ? { source: ctx.pg.source, version: pgVersionOf(ctx.pg.pgDump), binDir: ctx.pg.binDir }
      : null,
    ports: {
      api: ctx.apiPort,
      web: ctx.webPort,
      apiListening,
      webListening,
    },
    health,
    ready,
    backup: { count: backups.length, latest: backups[0] ?? null },
    checks,
  };
}

export function renderStatus(report: StatusReport): string {
  const lines: string[] = [];
  lines.push(`WorkMesh Box ${report.version} · ${report.platform.label}（${report.node}）`);
  lines.push(
    `平台验证：${report.platform.verified ? '已验证（本机实测）' : '未验证（适配器已实现，未在对应系统跑过验收）'}`,
  );
  if (report.repoRoot) lines.push(`仓库根目录：${report.repoRoot}`);
  lines.push(`数据目录：${report.dataDir.path}${report.dataDir.writable ? '' : '（不可写）'}`);
  lines.push(`安装目录：${report.installRoot}`);
  lines.push(`服务管理：${report.service.manager} · ${report.service.definitionPath}`);
  lines.push(
    `数据库：${report.database.configured ? report.database.maskedUrl : '未配置'}${
      report.database.reachable ? ' · 端口已监听' : ' · 不可达'
    }`,
  );
  lines.push(
    `PostgreSQL 客户端：${
      report.pgTools
        ? `${report.pgTools.version ?? 'unknown'}（${report.pgTools.source}${
            report.pgTools.binDir ? ` · ${report.pgTools.binDir}` : ''
          }）`
        : '未找到'
    }`,
  );
  lines.push(
    `端口：API ${report.ports.api}${report.ports.apiListening ? '（监听中）' : '（未监听）'} · Web ${report.ports.web}${
      report.ports.webListening ? '（监听中）' : '（未监听）'
    }`,
  );
  lines.push(`API 存活：${report.health.detail} · 就绪：${report.ready.detail}`);
  lines.push(
    `备份：${report.backup.count} 份${
      report.backup.latest
        ? `，最近 ${report.backup.latest.createdAt}（${report.backup.latest.dumpBytes} 字节` +
          `${report.backup.latest.tables === null ? '' : ` · ${report.backup.latest.tables} 张表`}）` +
          `${
            report.backup.latest.verification
              ? ` · 已验证可恢复（恢复出 ${report.backup.latest.verification.tables} 张表）`
              : ' · 未验证可恢复性'
          }`
        : ''
    }`,
  );
  lines.push('检查项：');
  for (const check of report.checks) {
    lines.push(
      `  ${check.ok ? 'ok ' : '!! '}${check.name}${check.critical ? '' : '（非关键）'}：${check.detail}`,
    );
  }
  return lines.join('\n');
}
