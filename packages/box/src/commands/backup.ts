import { writeFileSync } from 'node:fs';
import type { BoxContext } from '../context';
import {
  BACKUP_SCHEMA_VERSION,
  COUNT_MIGRATIONS_SQL,
  COUNT_TABLES_SQL,
  backupStamp,
  compareVerification,
  reserveBackupDir,
  sha256File,
  type BackupManifest,
  type BackupVerification,
} from '../lib/backup';
import {
  createDatabase,
  databaseExists,
  databaseUrlFor,
  dropDatabase,
  dumpDatabase,
  queryScalar,
  restoreDatabase,
} from '../lib/pg';

export type BackupResult = {
  dir: string;
  manifest: BackupManifest;
  /** 只有 `--verify` 才非空：真的把这份 dump 恢复进临时库核对过。 */
  verification: BackupVerification | null;
};

function verifyDatabaseName(now: Date): string {
  return `workmesh_backup_verify_${backupStamp(now).replace(/-/g, '_').toLowerCase()}`;
}

/**
 * 把刚写好的 dump 真的恢复进一个临时库，核对表数量与已应用迁移数，然后无论成败都删库。
 *
 * 备份的完成标准不是"文件存在"，而是"恢复得回来"——未验证过的备份等于没有备份。
 */
async function verifyDump(
  ctx: BoxContext,
  input: {
    dumpFile: string;
    expectedTables: number | null;
    expectedMigrations: number | null;
    now: Date;
  },
): Promise<BackupVerification> {
  const tools = ctx.pg!;
  const target = ctx.database!;
  const name = verifyDatabaseName(input.now);

  // 上一次被强杀可能留下同名库，先清掉，否则 CREATE 会失败。
  if (await databaseExists({ tools, target, name })) await dropDatabase({ tools, target, name });

  await createDatabase({ tools, target, name });
  const targetUrl = databaseUrlFor(target, name);
  try {
    await restoreDatabase({ tools, targetUrl, file: input.dumpFile });
    const restoredTables = await queryScalar({ tools, url: targetUrl, sql: COUNT_TABLES_SQL });
    const restoredMigrations = await queryScalar({
      tools,
      url: targetUrl,
      sql: COUNT_MIGRATIONS_SQL,
    });

    const comparison = compareVerification({
      expectedTables: input.expectedTables,
      restoredTables: restoredTables === null ? null : Number(restoredTables),
      expectedMigrations: input.expectedMigrations,
      restoredMigrations: restoredMigrations === null ? null : Number(restoredMigrations),
    });
    if (!comparison.ok) throw new Error(`备份验证失败：${comparison.issues.join('；')}`);

    return {
      verifiedAt: new Date().toISOString(),
      tables: Number(restoredTables),
      migrationsApplied: restoredMigrations === null ? null : Number(restoredMigrations),
    };
  } finally {
    // 清理失败不能掩盖真实验证结果：这里吞掉错误，临时库残留由下次 verify 先清理。
    await dropDatabase({ tools, target, name }).catch(() => undefined);
  }
}

/**
 * 备份 = plain SQL dump + 不含密码的 manifest；目录名即时间序。
 *
 * `verify` 会把 dump 真的恢复一次；用它产出的备份才有"可恢复"的证据，
 * 否则 manifest 只证明文件写成功了。
 */
export async function runBackup(
  ctx: BoxContext,
  input: { verify?: boolean } = {},
): Promise<BackupResult> {
  if (!ctx.database || !ctx.databaseUrl)
    throw new Error('未配置数据库连接串：设置 WORKMESH_V1_DATABASE_URL 或 apps/api/.env');
  if (!ctx.pg)
    throw new Error(
      '未找到 pg_dump/psql：设置 WORKMESH_PG_BIN，或把 PostgreSQL 客户端放到安装包的 pgsql/bin',
    );

  const paths = reserveBackupDir({ dataDir: ctx.dataDir, now: ctx.now });

  const { bytes } = await dumpDatabase({
    tools: ctx.pg,
    target: ctx.database,
    outFile: paths.dumpFile,
  });
  const dumpSha256 = await sha256File(paths.dumpFile);
  const tables = await queryScalar({ tools: ctx.pg, url: ctx.databaseUrl, sql: COUNT_TABLES_SQL });
  const migrations = await queryScalar({
    tools: ctx.pg,
    url: ctx.databaseUrl,
    sql: COUNT_MIGRATIONS_SQL,
  });

  const expectedTables = tables === null ? null : Number(tables);
  const expectedMigrations = migrations === null ? null : Number(migrations);

  const verification = input.verify
    ? await verifyDump(ctx, {
        dumpFile: paths.dumpFile,
        expectedTables,
        expectedMigrations,
        now: ctx.now,
      })
    : null;

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
    dumpSha256,
    migrationsApplied: expectedMigrations,
    tables: expectedTables,
    verification,
  };
  writeFileSync(paths.manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return { dir: paths.dir, manifest, verification };
}
