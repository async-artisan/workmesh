import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  BACKUP_SCHEMA_VERSION,
  backupStamp,
  compareVerification,
  parseManifest,
  reserveBackupDir,
  sha256File,
} from './backup';

const scratch: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'workmesh-box-backup-'));
  scratch.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const base = {
  createdAt: '2026-11-04T12:00:00.000Z',
  database: { host: '127.0.0.1', port: 5432, name: 'workmesh' },
  dumpFile: 'db.sql',
  dumpBytes: 1024,
  migrationsApplied: 13,
};

describe('parseManifest', () => {
  it('normalizes a legacy 1.0 manifest without pretending it was verified', () => {
    const manifest = parseManifest({ ...base, schemaVersion: '1.0' });
    expect(manifest.dumpSha256).toBeNull();
    expect(manifest.tables).toBeNull();
    expect(manifest.verification).toBeNull();
  });

  it('keeps integrity and verification fields from the current schema', () => {
    const manifest = parseManifest({
      ...base,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      dumpSha256: 'a'.repeat(64),
      tables: 49,
      verification: { verifiedAt: '2026-11-04T12:01:00.000Z', tables: 49, migrationsApplied: 13 },
    });
    expect(manifest.dumpSha256).toBe('a'.repeat(64));
    expect(manifest.tables).toBe(49);
    expect(manifest.verification).toMatchObject({ tables: 49, migrationsApplied: 13 });
  });

  it('drops a malformed verification block instead of trusting it', () => {
    const manifest = parseManifest({
      ...base,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      verification: { verifiedAt: 123, tables: 'many' },
    });
    expect(manifest.verification).toBeNull();
  });

  it('rejects an unsupported schema version', () => {
    expect(() => parseManifest({ ...base, schemaVersion: '9.9' })).toThrow(
      /schemaVersion 不受支持/,
    );
  });
});

describe('sha256File', () => {
  it('hashes file bytes', async () => {
    const dir = scratchDir();
    const file = join(dir, 'payload.txt');
    writeFileSync(file, 'abc', 'utf8');
    // "abc" 的 sha256 是固定值，用它证明我们算的是字节哈希而不是别的东西。
    await expect(sha256File(file)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('reserveBackupDir', () => {
  it('never reuses a directory when two backups land in the same second', () => {
    const dataDir = scratchDir();
    // backupStamp 用本地时间；这里用本地构造，避免时区把期望值带偏。
    const now = new Date(2026, 10, 4, 12, 0, 0);
    const first = reserveBackupDir({ dataDir, now });
    const second = reserveBackupDir({ dataDir, now });
    // 同秒两次备份必须落到不同目录，否则两个 dump 会互相截断。
    expect(second.dir).not.toBe(first.dir);
    expect(backupStamp(now)).toBe('20261104-120000');
  });
});

describe('compareVerification', () => {
  const expected = { expectedTables: 49, expectedMigrations: 13 };

  it('passes when the restored database matches the backup', () => {
    expect(
      compareVerification({ ...expected, restoredTables: 49, restoredMigrations: 13 }),
    ).toEqual({ ok: true, issues: [] });
  });

  it('reports a table-count mismatch', () => {
    const result = compareVerification({ ...expected, restoredTables: 48, restoredMigrations: 13 });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('表数量不一致');
  });

  it('reports a migration-count mismatch', () => {
    const result = compareVerification({ ...expected, restoredTables: 49, restoredMigrations: 12 });
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toContain('迁移数量不一致');
  });

  it('fails closed when the restored values cannot be read', () => {
    const result = compareVerification({
      ...expected,
      restoredTables: null,
      restoredMigrations: null,
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(2);
  });
});
