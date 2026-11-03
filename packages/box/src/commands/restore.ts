import { join } from 'node:path';
import type { BoxContext } from '../context';
import { backupStamp, readManifest, type BackupManifest } from '../lib/backup';
import { maskUrl } from '../lib/config';
import {
  createDatabase,
  databaseExists,
  databaseUrlFor,
  queryScalar,
  restoreDatabase,
} from '../lib/pg';

export type RestoreResult = {
  database: string;
  maskedUrl: string;
  tables: number;
  manifest: BackupManifest;
};

/**
 * 恢复到新数据库（默认 workmesh_restore_<时间>），不动现有库。
 * 这是可验证的演练路径：恢复完可以对比表数量，再把 API 指向新库。
 */
export async function runRestore(
  ctx: BoxContext,
  input: { from: string; database?: string; yes: boolean },
): Promise<RestoreResult> {
  if (!input.yes) throw new Error('恢复会创建新数据库并写入数据：确认后加 --yes');
  if (!ctx.database || !ctx.databaseUrl)
    throw new Error('未配置数据库连接串：设置 WORKMESH_V1_DATABASE_URL 或 apps/api/.env');
  if (!ctx.pg) throw new Error('未找到 pg_dump/psql：设置 WORKMESH_PG_BIN');

  const manifest = readManifest(input.from);
  const stamp = backupStamp(ctx.now).replace(/-/g, '_').toLowerCase();
  const name = input.database ?? `workmesh_restore_${stamp}`;

  if (await databaseExists({ tools: ctx.pg, target: ctx.database, name }))
    throw new Error(`目标数据库已存在：${name}；换一个 --database 或先删除它`);

  await createDatabase({ tools: ctx.pg, target: ctx.database, name });
  const targetUrl = databaseUrlFor(ctx.database, name);
  await restoreDatabase({
    tools: ctx.pg,
    targetUrl,
    file: join(input.from, manifest.dumpFile),
  });

  const tables = await queryScalar({
    tools: ctx.pg,
    url: targetUrl,
    sql: "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'workmesh_v1'",
  });

  return {
    database: name,
    maskedUrl: maskUrl(targetUrl),
    tables: Number(tables ?? 0),
    manifest,
  };
}
