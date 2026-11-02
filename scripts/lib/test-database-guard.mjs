// 脚本侧共用入口：在建立任何数据库连接之前解析并核验隔离测试目标。
// 只使用已构建的 shared 产物，避免脚本里再抄一份正则。
import { userInfo } from 'node:os';

const SHARED_DIST = new URL('../../packages/shared/dist/index.js', import.meta.url);

export async function loadGuard() {
  try {
    return await import(SHARED_DIST.href);
  } catch (error) {
    return { error };
  }
}

function localUser() {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

/**
 * 返回 { ok:true, target } 或 { ok:false, rejection }。
 * 进程退出由调用方决定，保证 SKIPPED 与 REFUSED 语义分别可控。
 */
export async function resolveTestDatabase() {
  const guard = await loadGuard();
  if (guard.error) {
    return {
      ok: false,
      rejection: {
        code: 'TEST_DATABASE_GUARD_UNAVAILABLE',
        message: 'packages/shared dist is missing; run `corepack pnpm --filter @workmesh/shared build` first',
      },
    };
  }

  const env = process.env.WORKMESH_TEST_ENV;
  if (!env || !['local', 'ci'].includes(env)) {
    return {
      ok: false,
      rejection: {
        code: env ? 'TEST_ENV_INVALID' : 'TEST_ENV_MISSING',
        message: 'WORKMESH_TEST_ENV must be set explicitly to local or ci before any database suite runs',
      },
    };
  }

  if (!process.env.WORKMESH_TEST_DATABASE_URL) {
    return {
      ok: false,
      rejection: {
        code: 'TEST_DATABASE_URL_MISSING',
        message: 'WORKMESH_TEST_DATABASE_URL must be set explicitly; falling back to DATABASE_URL is forbidden',
      },
    };
  }

  const allowUsers = env === 'local' && !process.env.WORKMESH_TEST_DATABASE_USERS ? [localUser()].filter(Boolean) : undefined;
  const result = guard.checkTestDatabase({ allowUsers });
  return result.ok
    ? { ok: true, target: result.target, describe: guard.describeTestDatabaseTarget(result.target) }
    : { ok: false, rejection: result.rejection };
}

export function refuseAndExit(rejection) {
  process.stderr.write(
    `${JSON.stringify({ suite: 'database-guard', status: 'REFUSED', code: rejection.code, reason: rejection.message }, null, 2)}\n`,
  );
  process.exit(2);
}
