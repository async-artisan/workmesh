import { describe, expect, it } from 'vitest';
import { adminUrlOf, describeDatabase, maskUrl, parseEnvFile, withDatabase } from './lib/config';
import { backupPaths, backupStamp, parseManifest } from './lib/backup';

const URL_ = 'postgresql://postgres:workmesh_local@127.0.0.1:5432/workmesh?schema=workmesh_v1';

describe('parseEnvFile', () => {
  it('解析键值、忽略注释与空行、去引号', () => {
    const parsed = parseEnvFile(
      ['# comment', 'A=1', '', 'B = "two words"', "C='x=y'", 'D='].join('\n'),
    );
    expect(parsed).toEqual({ A: '1', B: 'two words', C: 'x=y', D: '' });
  });
});

describe('describeDatabase', () => {
  it('解析连接串且展示用 URL 不含密码', () => {
    const target = describeDatabase(URL_);
    expect(target).toMatchObject({
      host: '127.0.0.1',
      port: 5432,
      database: 'workmesh',
      user: 'postgres',
      schema: 'workmesh_v1',
    });
    expect(target.maskedUrl).not.toContain('workmesh_local');
    expect(target.maskedUrl).toContain('***');
  });

  it('切库保留凭据与参数', () => {
    const target = describeDatabase(URL_);
    expect(withDatabase(target.url, 'workmesh_restore_x')).toBe(
      'postgresql://postgres:workmesh_local@127.0.0.1:5432/workmesh_restore_x?schema=workmesh_v1',
    );
    expect(adminUrlOf(target)).toBe('postgresql://postgres:workmesh_local@127.0.0.1:5432/postgres');
  });

  it('非法 URL 的 mask 返回占位符', () => {
    expect(maskUrl('not-a-url')).toBe('<invalid-url>');
  });
});

describe('backup naming and manifest', () => {
  it('目录名是本地时间戳，排序即时间序', () => {
    const stamp = backupStamp(new Date(2026, 10, 3, 9, 5, 7));
    expect(stamp).toBe('20261103-090507');
    const paths = backupPaths('/data', stamp);
    expect(
      paths.dir.endsWith('backups/20261103-090507') ||
        paths.dir.endsWith('backups\\20261103-090507'),
    ).toBe(true);
    expect(paths.dumpFile).toContain('db.sql');
    expect(paths.manifestFile).toContain('manifest.json');
  });

  it('manifest 校验 schemaVersion 与必填字段', () => {
    const manifest = {
      schemaVersion: '1.0',
      createdAt: '2026-11-03T01:05:07.000Z',
      database: { host: '127.0.0.1', port: 5432, name: 'workmesh' },
      dumpFile: 'db.sql',
      dumpBytes: 128,
      migrationsApplied: 12,
    };
    // 1.0 旧清单仍然可读，但完整性/验证字段归一为 null：没有就是没有，不伪造成已验证。
    expect(parseManifest(manifest)).toEqual({
      ...manifest,
      dumpSha256: null,
      tables: null,
      verification: null,
    });
    expect(() => parseManifest({ ...manifest, schemaVersion: '2.0' })).toThrow(/schemaVersion/);
    expect(() => parseManifest(null)).toThrow(/不是对象/);
    const { dumpBytes: _dumpBytes, ...missing } = manifest;
    expect(() => parseManifest(missing)).toThrow(/dumpBytes/);
  });
});
