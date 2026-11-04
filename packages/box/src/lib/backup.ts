import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 1.1 起清单带 dump 的 sha256、源库表数量与一次真实恢复的核对结果。 */
export const BACKUP_SCHEMA_VERSION = '1.1';
/** 旧清单（1.0）仍可读：没有完整性字段时按 null 归一，不假装它验证过。 */
const SUPPORTED_SCHEMA_VERSIONS = new Set(['1.0', '1.1']);

/** 源库与恢复库都用同一条口径数表，避免两边统计方式不同带来假不一致。 */
export const COUNT_TABLES_SQL =
  "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'workmesh_v1'";
export const COUNT_MIGRATIONS_SQL =
  'SELECT count(*) FROM workmesh_v1."_prisma_migrations" WHERE finished_at IS NOT NULL';

export type BackupVerification = {
  verifiedAt: string;
  tables: number;
  migrationsApplied: number | null;
};

export type BackupManifest = {
  schemaVersion: string;
  createdAt: string;
  /** 只记录实例定位信息，不落密码。 */
  database: { host: string; port: number; name: string };
  dumpFile: string;
  dumpBytes: number;
  /** dump 文件的 sha256；1.0 旧清单没有这个字段。 */
  dumpSha256: string | null;
  migrationsApplied: number | null;
  /** dump 时源库 workmesh_v1 的表数量，作为恢复核对的期望值。 */
  tables: number | null;
  /** `backup --verify` 真的恢复过一次之后才有值；未验证一律 null。 */
  verification: BackupVerification | null;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 备份目录名：本地时间 20261103-101530，排序即时间序。 */
export function backupStamp(now = new Date()): string {
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function backupPaths(dataDir: string, stamp: string) {
  const dir = join(dataDir, 'backups', stamp);
  return {
    dir,
    dumpFile: join(dir, 'db.sql'),
    manifestFile: join(dir, 'manifest.json'),
  };
}

/**
 * 备份目录名只精确到秒，同一秒内连跑两次会撞目录，写出来的两个 dump 互相截断，
 * 而 manifest 记的是后完成者的字节数——那种"看起来成功、实际损坏"的备份最难发现。
 * 这里按秒退避抢占目录，遇到已存在就试下一秒。
 */
export function reserveBackupDir(input: { dataDir: string; now: Date; attempts?: number }): {
  dir: string;
  dumpFile: string;
  manifestFile: string;
} {
  const root = join(input.dataDir, 'backups');
  const attempts = input.attempts ?? 30;
  for (let offset = 0; offset < attempts; offset += 1) {
    const paths = backupPaths(
      input.dataDir,
      backupStamp(new Date(input.now.getTime() + offset * 1000)),
    );
    try {
      // 非 recursive：目录已存在就抛 EEXIST，用来抢锁。
      mkdirSync(root, { recursive: true });
      mkdirSync(paths.dir);
      return paths;
    } catch (caught) {
      if ((caught as { code?: string }).code === 'EEXIST') continue;
      throw caught;
    }
  }
  throw new Error(`无法在 ${input.dataDir}/backups 下分配备份目录（${attempts} 次都冲突）`);
}

/** 按流式计算文件的 sha256，避免把整库 dump 读进内存。 */
export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseVerification(raw: unknown): BackupVerification | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.verifiedAt !== 'string') return null;
  if (typeof record.tables !== 'number') return null;
  return {
    verifiedAt: record.verifiedAt,
    tables: record.tables,
    migrationsApplied:
      typeof record.migrationsApplied === 'number' ? record.migrationsApplied : null,
  };
}

export function parseManifest(raw: unknown): BackupManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('manifest.json 不是对象');
  const record = raw as Record<string, unknown>;
  if (
    typeof record.schemaVersion !== 'string' ||
    !SUPPORTED_SCHEMA_VERSIONS.has(record.schemaVersion)
  )
    throw new Error(`manifest schemaVersion 不受支持：${String(record.schemaVersion)}`);
  if (typeof record.createdAt !== 'string') throw new Error('manifest 缺少 createdAt');
  if (!record.database || typeof record.database !== 'object')
    throw new Error('manifest 缺少 database');
  if (typeof record.dumpFile !== 'string') throw new Error('manifest 缺少 dumpFile');
  if (typeof record.dumpBytes !== 'number') throw new Error('manifest 缺少 dumpBytes');
  // 新字段缺失时归一为 null：1.0 备份本来就没验证过，不能伪装成已验证。
  return {
    ...(record as unknown as BackupManifest),
    dumpSha256: typeof record.dumpSha256 === 'string' ? record.dumpSha256 : null,
    tables: typeof record.tables === 'number' ? record.tables : null,
    verification: parseVerification(record.verification),
  };
}

export function readManifest(dir: string): BackupManifest {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) throw new Error(`${dir} 不是备份目录（缺 manifest.json）`);
  return parseManifest(JSON.parse(readFileSync(file, 'utf8')) as unknown);
}

/** 列出备份目录（新的在前），忽略没有 manifest 的目录。 */
export function listBackups(dataDir: string): BackupManifest[] {
  const root = join(dataDir, 'backups');
  if (!existsSync(root)) return [];
  const manifest: BackupManifest[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      manifest.push(readManifest(join(root, entry.name)));
    } catch {
      // 半成品或手工目录直接忽略。
    }
  }
  return manifest.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export type VerificationComparison = { ok: boolean; issues: string[] };

/**
 * 把「备份时记录的期望值」与「真的恢复进新库之后读到的值」对比。
 *
 * 备份的完成标准不是 dump 文件存在，而是"恢复得回来"。这里只比对能稳定复现的量：
 * 表数量与已应用迁移数。行数在并发写入下会漂移，不适合做硬性断言。
 */
export function compareVerification(input: {
  expectedTables: number | null;
  restoredTables: number | null;
  expectedMigrations: number | null;
  restoredMigrations: number | null;
}): VerificationComparison {
  const issues: string[] = [];
  if (input.restoredTables === null) issues.push('无法读取恢复库的表数量');
  else if (input.expectedTables !== null && input.restoredTables !== input.expectedTables)
    issues.push(`表数量不一致：源库 ${input.expectedTables} / 恢复库 ${input.restoredTables}`);

  if (input.restoredMigrations === null) issues.push('无法读取恢复库的迁移数量');
  else if (
    input.expectedMigrations !== null &&
    input.restoredMigrations !== input.expectedMigrations
  )
    issues.push(
      `迁移数量不一致：源库 ${input.expectedMigrations} / 恢复库 ${input.restoredMigrations}`,
    );

  return { ok: issues.length === 0, issues };
}
