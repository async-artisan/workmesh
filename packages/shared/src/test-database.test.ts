import { describe, expect, it } from 'vitest';
import {
  TEST_DATABASE_SCHEMA,
  TEST_DATABASE_URL_ENV,
  TEST_ENV_ENV,
  checkTestDatabase,
  describeTestDatabaseTarget,
  evaluateIdentityProbe,
  isLoopbackHost,
  normalizeHost,
  redactDatabaseUrl,
  resolveAllowedUsers,
  type TestEnvSource,
} from './test-database';

/**
 * 这些用例全部只做 URL 解析与比较，不发任何网络请求，也不创建数据库连接。
 * 目的是证明不合格目标会在创建连接之前被拒绝。
 */

const LOCAL_USER = 'workmesh-dev';
const BASE_ENV: TestEnvSource = {
  [TEST_ENV_ENV]: 'local',
  [TEST_DATABASE_URL_ENV]: `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=${TEST_DATABASE_SCHEMA}`,
  USER: LOCAL_USER,
};

const withUrl = (url: string, extra: TestEnvSource = {}): TestEnvSource => ({
  ...BASE_ENV,
  [TEST_DATABASE_URL_ENV]: url,
  ...extra,
});

const codeOf = (env: TestEnvSource) => {
  const result = checkTestDatabase({ env });
  return result.ok ? null : result.rejection.code;
};

describe('isolated test database guard', () => {
  it('accepts a loopback workmesh_test_* target with the v1 schema and an allowed user', () => {
    const result = checkTestDatabase({ env: BASE_ENV });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.target).toMatchObject({
      scheme: 'postgresql:',
      host: '127.0.0.1',
      port: '5432',
      database: 'workmesh_test_v1',
      user: LOCAL_USER,
      schema: TEST_DATABASE_SCHEMA,
      env: 'local',
    });
  });

  it('does not describe the target with a password or full connection string', () => {
    const result = checkTestDatabase({ env: BASE_ENV });
    if (!result.ok) throw new Error('expected the base target to validate');
    const described = describeTestDatabaseTarget(result.target);
    expect(Object.values(described).join(' ')).not.toContain('@');
    expect(redactDatabaseUrl('postgresql://alice:s3cr3t@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1')).toBe(
      'postgresql://127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1',
    );
  });

  it('refuses when the explicit test URL is missing instead of falling back to the app URL', () => {
    const env: TestEnvSource = {
      [TEST_ENV_ENV]: 'local',
      DATABASE_URL: 'postgresql://app@127.0.0.1:5432/workmesh?schema=workmesh_v1',
      USER: LOCAL_USER,
    };
    expect(codeOf(env)).toBe('TEST_DATABASE_URL_MISSING');
  });

  it('refuses a test URL that is only the application DATABASE_URL', () => {
    const appUrl = `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=${TEST_DATABASE_SCHEMA}`;
    expect(codeOf({ ...BASE_ENV, DATABASE_URL: appUrl })).toBe('TEST_DATABASE_URL_IS_APP_URL');
  });

  it('refuses an unparseable or non-postgresql URL', () => {
    expect(codeOf(withUrl('not-a-url'))).toBe('TEST_DATABASE_URL_INVALID');
    expect(codeOf(withUrl('mysql://root@127.0.0.1:3306/workmesh_test_v1?schema=workmesh_v1'))).toBe(
      'TEST_DATABASE_SCHEME_INVALID',
    );
  });

  it('refuses a non-loopback host', () => {
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@db.internal:5432/workmesh_test_v1?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_HOST_NOT_LOOPBACK',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@10.0.0.9:5432/workmesh_test_v1?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_HOST_NOT_LOOPBACK',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@workmesh.example.com:5432/workmesh_test_v1?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_HOST_NOT_LOOPBACK',
    );
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('127.0.0.2')).toBe(false);
    expect(normalizeHost('[::1]')).toBe('::1');
  });

  it('refuses a database name that is missing or outside the workmesh_test_ prefix', () => {
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_NAME_MISSING',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_NAME_PREFIX',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_prod?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_NAME_PREFIX',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/my_workmesh_test_db?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_NAME_PREFIX',
    );
  });

  it('refuses a spoofed prefix that only appears in the user, password or query parameters', () => {
    const userSpoof = `postgresql://workmesh_test_x@127.0.0.1:5432/workmesh?schema=workmesh_v1`;
    expect(codeOf(withUrl(userSpoof))).toBe('TEST_DATABASE_NAME_PREFIX');

    const passwordSpoof = `postgresql://${LOCAL_USER}:workmesh_test_x@127.0.0.1:5432/workmesh?schema=workmesh_v1`;
    expect(codeOf(withUrl(passwordSpoof))).toBe('TEST_DATABASE_NAME_PREFIX');

    const querySpoof = `postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh?schema=workmesh_v1&label=workmesh_test_x`;
    expect(codeOf(withUrl(querySpoof))).toBe('TEST_DATABASE_NAME_PREFIX');
  });

  it('refuses a missing or wrong schema parameter', () => {
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1`))).toBe(
      'TEST_DATABASE_SCHEMA_MISSING',
    );
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=public`))).toBe(
      'TEST_DATABASE_SCHEMA_MISMATCH',
    );
    expect(
      codeOf(withUrl(`postgresql://${LOCAL_USER}@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1&schema=public`)),
    ).toBe('TEST_DATABASE_SCHEMA_MISSING');
  });

  it('refuses a missing user and a user outside the allowlist', () => {
    expect(codeOf(withUrl(`postgresql://127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_USER_MISSING',
    );
    expect(
      codeOf(withUrl(`postgresql://someone-else@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`)),
    ).toBe('TEST_DATABASE_USER_NOT_ALLOWED');
  });

  it('refuses when no allowed user can be resolved', () => {
    const env: TestEnvSource = {
      [TEST_ENV_ENV]: 'ci',
      [TEST_DATABASE_URL_ENV]: `postgresql://ci-user@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`,
    };
    expect(codeOf(env)).toBe('TEST_DATABASE_USER_ALLOWLIST_MISSING');
  });

  it('honours an explicit allowlist over the environment', () => {
    const env = withUrl(`postgresql://ci-user@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`, {
      [TEST_ENV_ENV]: 'ci',
    });
    expect(codeOf(env)).toBe('TEST_DATABASE_USER_ALLOWLIST_MISSING');
    expect(checkTestDatabase({ env, allowUsers: ['ci-user'] }).ok).toBe(true);
    expect(
      codeOf({ ...env, WORKMESH_TEST_DATABASE_USERS: 'ci-user, other-user' } as TestEnvSource),
    ).toBeNull();
    expect(resolveAllowedUsers({ WORKMESH_TEST_DATABASE_USERS: ' a , b ' }, 'ci')).toEqual(['a', 'b']);
    expect(resolveAllowedUsers({ USER: 'local-me' }, 'local')).toEqual(['local-me']);
    expect(resolveAllowedUsers({ USER: 'local-me' }, 'ci')).toEqual([]);
  });

  it('refuses a local target that carries a password but allows a ci target with one', () => {
    expect(codeOf(withUrl(`postgresql://${LOCAL_USER}:pw@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`))).toBe(
      'TEST_DATABASE_PASSWORD_FORBIDDEN',
    );
    const ciEnv = withUrl(`postgresql://ci-user:pw@127.0.0.1:5432/workmesh_test_v1?schema=workmesh_v1`, {
      [TEST_ENV_ENV]: 'ci',
      WORKMESH_TEST_DATABASE_USERS: 'ci-user',
    });
    expect(codeOf(ciEnv)).toBeNull();
  });

  it('refuses a missing or unknown WORKMESH_TEST_ENV', () => {
    expect(codeOf({ ...BASE_ENV, [TEST_ENV_ENV]: undefined })).toBe('TEST_ENV_MISSING');
    expect(codeOf({ ...BASE_ENV, [TEST_ENV_ENV]: 'staging' })).toBe('TEST_ENV_INVALID');
    // NODE_ENV=test 不能单独豁免目标检查。
    expect(codeOf({ ...BASE_ENV, [TEST_ENV_ENV]: undefined, NODE_ENV: 'test' })).toBe('TEST_ENV_MISSING');
  });

  it('rejects a probe result that disagrees with the verified target', () => {
    const result = checkTestDatabase({ env: BASE_ENV });
    if (!result.ok) throw new Error('expected the base target to validate');
    const ok = evaluateIdentityProbe(
      { database: 'workmesh_test_v1', user: LOCAL_USER, schema: 'workmesh_v1' },
      result.target,
    );
    expect(ok.ok).toBe(true);
    expect(
      evaluateIdentityProbe({ database: 'workmesh', user: LOCAL_USER, schema: 'workmesh_v1' }, result.target).ok,
    ).toBe(false);
    expect(
      evaluateIdentityProbe({ database: 'workmesh_test_v1', user: 'other', schema: 'workmesh_v1' }, result.target).ok,
    ).toBe(false);
    expect(
      evaluateIdentityProbe({ database: 'workmesh_test_v1', user: LOCAL_USER, schema: 'public' }, result.target).ok,
    ).toBe(false);
  });
});
