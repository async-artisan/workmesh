import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
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
  backup: { count: number; latest: BackupManifest | null };
  checks: StatusCheck[];
};

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
      name: 'web',
      ok: webListening,
      critical: false,
      detail: webListening ? `端口 ${ctx.webPort} 已监听` : `端口 ${ctx.webPort} 未监听`,
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
    } · API 健康：${report.health.detail}`,
  );
  lines.push(
    `备份：${report.backup.count} 份${
      report.backup.latest
        ? `，最近 ${report.backup.latest.createdAt}（${report.backup.latest.dumpBytes} 字节）`
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
