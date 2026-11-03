import { mkdirSync, writeFileSync } from 'node:fs';
import type { BoxContext } from '../context';
import {
  BACKUP_SCHEMA_VERSION,
  backupPaths,
  backupStamp,
  type BackupManifest,
} from '../lib/backup';
import { dumpDatabase, queryScalar } from '../lib/pg';

export type BackupResult = { dir: string; manifest: BackupManifest };

/** 备份 = 一份 plain SQL dump + 一份不含密码的 manifest；目录名即时间序。 */
export async function runBackup(ctx: BoxContext): Promise<BackupResult> {
  if (!ctx.database || !ctx.databaseUrl)
    throw new Error('未配置数据库连接串：设置 WORKMESH_V1_DATABASE_URL 或 apps/api/.env');
  if (!ctx.pg)
    throw new Error(
      '未找到 pg_dump/psql：设置 WORKMESH_PG_BIN，或把 PostgreSQL 客户端放到安装包的 pgsql/bin',
    );

  const stamp = backupStamp(ctx.now);
  const paths = backupPaths(ctx.dataDir, stamp);
  mkdirSync(paths.dir, { recursive: true });

  const { bytes } = await dumpDatabase({
    tools: ctx.pg,
    target: ctx.database,
    outFile: paths.dumpFile,
  });
  const migrations = await queryScalar({
    tools: ctx.pg,
    url: ctx.databaseUrl,
    sql: 'SELECT count(*) FROM workmesh_v1."_prisma_migrations" WHERE finished_at IS NOT NULL',
  });

  const manifest: BackupManifest = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: ctx.now.toISOString(),
    database: {
      host: ctx.database.host,
      port: ctx.database.port,
      name: ctx.database.database,
    },
    dumpFile: 'db.sql',
    dumpBytes: bytes,
    migrationsApplied: migrations === null ? null : Number(migrations),
  };
  writeFileSync(paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { dir: paths.dir, manifest };
}
