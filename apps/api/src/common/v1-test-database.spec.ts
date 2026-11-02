import { userInfo } from 'node:os';
import { describe, expect, it } from 'vitest';
import { evaluateSuiteTestDatabase, testDatabaseOptions } from './v1-test-database';

/**
 * 套件内核验路径的失败回归。全部只做解析，不发起网络请求，也不创建数据库连接。
 * 注意：verifiedTestDatabase 会在拒绝时退出进程，因此拒绝路径一律用纯函数 evaluateSuiteTestDatabase 断言。
 */

const LOCAL_USER = 'workmesh-dev';
const goodUrl = `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`;

const codeOf = (env: Record<string, string | undefined>) => {
  const result = evaluateSuiteTestDatabase(env);
  return result.ok ? null : result.rejection.code;
};

describe('suite-level test database guard', () => {
  it('uses the local OS user as the default allowlist for local runs', () => {
    const options = testDatabaseOptions({
      WORKMESH_TEST_ENV: 'local',
      WORKMESH_TEST_DATABASE_URL: goodUrl,
    });
    expect(options.allowUsers).toEqual([userInfo().username]);
  });

  it('does not inject an allowlist when the environment declares one', () => {
    const options = testDatabaseOptions({
      WORKMESH_TEST_ENV: 'ci',
      WORKMESH_TEST_DATABASE_URL: goodUrl,
      WORKMESH_TEST_DATABASE_USERS: 'ci-user',
    });
    expect(options.allowUsers).toBeUndefined();
  });

  it('never falls back to the application DATABASE_URL', () => {
    expect(
      codeOf({
        WORKMESH_TEST_ENV: 'local',
        DATABASE_URL: 'postgresql://app@127.0.0.1:5432/workmesh?schema=workmesh_v1',
      }),
    ).toBe('TEST_DATABASE_URL_MISSING');
  });

  it('resolves a compliant target with the v1 schema and loopback host', () => {
    const result = evaluateSuiteTestDatabase({
      WORKMESH_TEST_ENV: 'local',
      WORKMESH_TEST_DATABASE_URL: goodUrl,
      WORKMESH_TEST_DATABASE_USERS: LOCAL_USER,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toMatchObject({
      host: '127.0.0.1',
      database: 'workmesh_test_v1',
      schema: 'workmesh_v1',
      user: LOCAL_USER,
      env: 'local',
    });
  });

  it('refuses a target whose prefix only appears in the query string', () => {
    expect(
      codeOf({
        WORKMESH_TEST_ENV: 'local',
        WORKMESH_TEST_DATABASE_URL: `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh?schema=workmesh_v1&label=workmesh_test_v1`,
        WORKMESH_TEST_DATABASE_USERS: LOCAL_USER,
      }),
    ).toBe('TEST_DATABASE_NAME_PREFIX');
  });

  it('refuses a target with a wrong schema or a remote host', () => {
    expect(
      codeOf({
        WORKMESH_TEST_ENV: 'local',
        WORKMESH_TEST_DATABASE_URL: `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=public`,
        WORKMESH_TEST_DATABASE_USERS: LOCAL_USER,
      }),
    ).toBe('TEST_DATABASE_SCHEMA_MISMATCH');
    expect(
      codeOf({
        WORKMESH_TEST_ENV: 'local',
        WORKMESH_TEST_DATABASE_URL: `postgresql://${LOCAL_USER}@10.1.2.3:5432/workmesh_test_v1?schema=workmesh_v1`,
        WORKMESH_TEST_DATABASE_USERS: LOCAL_USER,
      }),
    ).toBe('TEST_DATABASE_HOST_NOT_LOOPBACK');
  });
});
