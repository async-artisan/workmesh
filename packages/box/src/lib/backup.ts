import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const BACKUP_SCHEMA_VERSION = '1.0';

export type BackupManifest = {
  schemaVersion: string;
  createdAt: string;
  /** 只记录实例定位信息，不落密码。 */
  database: { host: string; port: number; name: string };
  dumpFile: string;
  dumpBytes: number;
  migrationsApplied: number | null;
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

export function parseManifest(raw: unknown): BackupManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('manifest.json 不是对象');
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== BACKUP_SCHEMA_VERSION)
    throw new Error(`manifest schemaVersion 不受支持：${String(record.schemaVersion)}`);
  if (typeof record.createdAt !== 'string') throw new Error('manifest 缺少 createdAt');
  if (!record.database || typeof record.database !== 'object')
    throw new Error('manifest 缺少 database');
  if (typeof record.dumpFile !== 'string') throw new Error('manifest 缺少 dumpFile');
  if (typeof record.dumpBytes !== 'number') throw new Error('manifest 缺少 dumpBytes');
  return record as unknown as BackupManifest;
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
