import { join } from 'node:path';
import type { BoxContext } from '../context';
import {
  COUNT_TABLES_SQL,
  backupStamp,
  readManifest,
  sha256File,
  type BackupManifest,
} from '../lib/backup';
import { maskUrl } from '../lib/config';
import {
  createDatabase,
  databaseExists,
  databaseUrlFor,
  dropDatabase,
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
  const dumpFile = join(input.from, manifest.dumpFile);

  // 清单里有 sha256 就先校验字节：损坏的备份应该在建库之前就被拒绝，而不是恢复出半个库。
  if (manifest.dumpSha256 !== null) {
    const actual = await sha256File(dumpFile);
    if (actual !== manifest.dumpSha256)
      throw new Error(
        `备份文件校验失败：${dumpFile}\n期望 sha256 ${manifest.dumpSha256}\n实际 ${actual}`,
      );
  }

  const stamp = backupStamp(ctx.now).replace(/-/g, '_').toLowerCase();
  const name = input.database ?? `workmesh_restore_${stamp}`;

  if (await databaseExists({ tools: ctx.pg, target: ctx.database, name }))
    throw new Error(`目标数据库已存在：${name}；换一个 --database 或先删除它`);

  await createDatabase({ tools: ctx.pg, target: ctx.database, name });
  const targetUrl = databaseUrlFor(ctx.database, name);
  try {
    await restoreDatabase({ tools: ctx.pg, targetUrl, file: dumpFile });
  } catch (caught) {
    // 半成品库必须清掉：否则下次同名恢复只会报"目标数据库已存在"，需要人工 drop。
    await dropDatabase({ tools: ctx.pg, target: ctx.database, name }).catch(() => undefined);
    throw caught;
  }

  const tables = await queryScalar({
    tools: ctx.pg,
    url: targetUrl,
    sql: COUNT_TABLES_SQL,
  });

  return {
    database: name,
    maskedUrl: maskUrl(targetUrl),
    tables: Number(tables ?? 0),
    manifest,
  };
}
