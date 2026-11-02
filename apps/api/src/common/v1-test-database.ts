/**
 * 套件内测试数据库核验（06 §3.1）。
 *
 * 入口脚本已核验一次；每个数据库套件在加载任何 Nest 模块或创建 PrismaClient 之前
 * 必须再调用 `verifiedTestDatabase()`，不合格目标直接 exit 2，不执行 DDL/DML。
 * 这里不读取 `.env*`，只信任显式 `WORKMESH_TEST_DATABASE_URL`。
 */
import { userInfo } from 'node:os';
import {
  checkTestDatabase,
  describeTestDatabaseTarget,
  type TestDatabaseOptions,
  type TestDatabaseTarget,
  type TestEnvSource,
} from '@workmesh/shared';

export function testDatabaseOptions(env: TestEnvSource = process.env): TestDatabaseOptions {
  const testEnv = env.WORKMESH_TEST_ENV;
  if (testEnv === 'local' && !env.WORKMESH_TEST_DATABASE_USERS) {
    try {
      return { env, allowUsers: [userInfo().username] };
    } catch {
      return { env };
    }
  }
  return { env };
}

export class TestDatabaseGuardRefusedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'TestDatabaseGuardRefusedError';
    this.code = code;
  }
}

/**
 * 纯函数版本：返回核验结果，不产生副作用。套件测试与诊断均可用。
 */
export function evaluateSuiteTestDatabase(
  env: TestEnvSource = process.env,
): ReturnType<typeof checkTestDatabase> {
  return checkTestDatabase(testDatabaseOptions(env));
}

/**
 * 返回核验通过的目标；不合格时写 stderr 并立即退出，绝不回退应用连接配置。
 * 只在套件入口调用：进程退出是刻意的，单元测试不要用它验证拒绝路径。
 */
export function verifiedTestDatabase(env: TestEnvSource = process.env): TestDatabaseTarget {
  const result = evaluateSuiteTestDatabase(env);
  if (!result.ok) {
    const payload = {
      suite: 'test-database-guard',
      status: 'REFUSED',
      code: result.rejection.code,
      reason: result.rejection.message,
    };

    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(2);
  }
  return result.target;
}

export function describeTarget(target: TestDatabaseTarget): Record<string, string> {
  return describeTestDatabaseTarget(target);
}
