/**
 * 隔离测试数据库目标的安全门禁（06 §3.1）。
 *
 * 约束：
 * - 本模块是纯函数，不发起任何网络连接；连接必须在校验通过之后才允许创建。
 * - 只认显式 `WORKMESH_TEST_DATABASE_URL`，缺失或不合规一律拒绝，绝不回退应用 `DATABASE_URL`。
 * - 数据库名前缀只在 pathname 解析出的库名上判定：用户名、密码或查询参数里出现前缀不算合规。
 * - `WORKMESH_TEST_ENV=ci|local` 必须显式给出，`NODE_ENV=test` 不作为豁免。
 */

export const TEST_DATABASE_PREFIX = 'workmesh_test_';
export const TEST_DATABASE_SCHEMA = 'workmesh_v1';
export const TEST_DATABASE_URL_ENV = 'WORKMESH_TEST_DATABASE_URL';
export const TEST_DATABASE_USERS_ENV = 'WORKMESH_TEST_DATABASE_USERS';
export const TEST_ENV_ENV = 'WORKMESH_TEST_ENV';
export const APP_DATABASE_URL_ENV = 'DATABASE_URL';

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const;
export const TEST_ENV_VALUES = ['local', 'ci'] as const;
export const ALLOWED_SCHEMES = ['postgresql:', 'postgres:'] as const;

export type TestEnv = (typeof TEST_ENV_VALUES)[number];
export type TestEnvSource = Record<string, string | undefined>;

export type TestDatabaseRejectCode =
  | 'TEST_ENV_MISSING'
  | 'TEST_ENV_INVALID'
  | 'TEST_DATABASE_URL_MISSING'
  | 'TEST_DATABASE_URL_INVALID'
  | 'TEST_DATABASE_SCHEME_INVALID'
  | 'TEST_DATABASE_HOST_NOT_LOOPBACK'
  | 'TEST_DATABASE_NAME_MISSING'
  | 'TEST_DATABASE_NAME_PREFIX'
  | 'TEST_DATABASE_SCHEMA_MISSING'
  | 'TEST_DATABASE_SCHEMA_MISMATCH'
  | 'TEST_DATABASE_PASSWORD_FORBIDDEN'
  | 'TEST_DATABASE_USER_MISSING'
  | 'TEST_DATABASE_USER_ALLOWLIST_MISSING'
  | 'TEST_DATABASE_USER_NOT_ALLOWED'
  | 'TEST_DATABASE_URL_IS_APP_URL'
  | 'TEST_DATABASE_PROBE_MISMATCH';

export type TestDatabaseTarget = {
  url: string;
  scheme: string;
  host: string;
  port: string;
  database: string;
  user: string;
  schema: string;
  env: TestEnv;
  allowedUsers: readonly string[];
};

export type TestDatabaseRejection = {
  code: TestDatabaseRejectCode;
  message: string;
};

export type TestDatabaseResult =
  | { ok: true; target: TestDatabaseTarget }
  | { ok: false; rejection: TestDatabaseRejection };

export type TestDatabaseOptions = {
  env?: TestEnvSource;
  /** 显式允许用户；未给出时回退受控环境变量。 */
  allowUsers?: readonly string[];
};

function sourceOf(options: TestDatabaseOptions): TestEnvSource {
  if (options.env) return options.env;
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

function readEnv(source: TestEnvSource, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 剥离 IPv6 方括号并小写，便于与 loopback 白名单比较。 */
export function normalizeHost(hostname: string): string {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function isLoopbackHost(hostname: string): boolean {
  return (LOOPBACK_HOSTS as readonly string[]).includes(normalizeHost(hostname));
}

/**
 * 解析允许的数据库用户白名单。
 * 优先级：显式入参 > `WORKMESH_TEST_DATABASE_USERS` > 本机 `USER`/`LOGNAME`（仅 local）。
 */
export function resolveAllowedUsers(
  source: TestEnvSource,
  env: TestEnv,
  explicit?: readonly string[],
): readonly string[] {
  if (explicit && explicit.length > 0) return explicit;
  const declared = readEnv(source, TEST_DATABASE_USERS_ENV);
  if (declared) {
    const users = declared
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (users.length > 0) return users;
  }
  if (env === 'local') {
    const localUser = readEnv(source, 'USER') ?? readEnv(source, 'LOGNAME');
    if (localUser) return [localUser];
  }
  return [];
}

function reject(code: TestDatabaseRejectCode, message: string): TestDatabaseResult {
  return { ok: false, rejection: { code, message } };
}

/**
 * 校验显式测试数据库 URL。返回 target 表示可在其后创建连接；否则必须停止，不得执行 DDL/DML。
 */
export function evaluateTestDatabase(options: TestDatabaseOptions = {}): TestDatabaseResult {
  const source = sourceOf(options);

  const envRaw = readEnv(source, TEST_ENV_ENV);
  if (!envRaw) {
    return reject(
      'TEST_ENV_MISSING',
      `${TEST_ENV_ENV} must be set explicitly to one of ${TEST_ENV_VALUES.join('|')}; NODE_ENV=test does not waive the target check`,
    );
  }
  if (!(TEST_ENV_VALUES as readonly string[]).includes(envRaw)) {
    return reject('TEST_ENV_INVALID', `${TEST_ENV_ENV} must be one of ${TEST_ENV_VALUES.join('|')}, received "${envRaw}"`);
  }
  const env = envRaw as TestEnv;

  const url = readEnv(source, TEST_DATABASE_URL_ENV);
  if (!url) {
    return reject(
      'TEST_DATABASE_URL_MISSING',
      `${TEST_DATABASE_URL_ENV} is required; falling back to ${APP_DATABASE_URL_ENV} is forbidden`,
    );
  }

  const appUrl = readEnv(source, APP_DATABASE_URL_ENV);
  if (appUrl && appUrl === url) {
    return reject(
      'TEST_DATABASE_URL_IS_APP_URL',
      `${TEST_DATABASE_URL_ENV} must not be the application ${APP_DATABASE_URL_ENV}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return reject('TEST_DATABASE_URL_INVALID', `${TEST_DATABASE_URL_ENV} is not a parseable absolute URL`);
  }

  if (!(ALLOWED_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return reject(
      'TEST_DATABASE_SCHEME_INVALID',
      `database URL scheme must be one of ${ALLOWED_SCHEMES.join('|')}, received "${parsed.protocol}"`,
    );
  }

  const host = normalizeHost(parsed.hostname);
  if (!isLoopbackHost(host)) {
    return reject(
      'TEST_DATABASE_HOST_NOT_LOOPBACK',
      `database host must be loopback (${LOOPBACK_HOSTS.join(', ')}), received "${host}"`,
    );
  }

  // 库名只来自 pathname；用户名/密码/查询参数中的前缀不算合规目标。
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (database.length === 0) {
    return reject('TEST_DATABASE_NAME_MISSING', 'database URL must carry a database name in its path');
  }
  if (!database.startsWith(TEST_DATABASE_PREFIX)) {
    return reject(
      'TEST_DATABASE_NAME_PREFIX',
      `database name must start with "${TEST_DATABASE_PREFIX}", received "${database}"`,
    );
  }

  const schemaValues = parsed.searchParams.getAll('schema');
  if (schemaValues.length !== 1) {
    return reject(
      'TEST_DATABASE_SCHEMA_MISSING',
      `database URL must carry exactly one schema query parameter, received ${schemaValues.length}`,
    );
  }
  const schema = schemaValues[0]!;
  if (schema !== TEST_DATABASE_SCHEMA) {
    return reject(
      'TEST_DATABASE_SCHEMA_MISMATCH',
      `database URL schema must be "${TEST_DATABASE_SCHEMA}", received "${schema}"`,
    );
  }

  const user = decodeURIComponent(parsed.username);
  if (user.length === 0) {
    return reject('TEST_DATABASE_USER_MISSING', 'database URL must carry an explicit user');
  }

  if (env === 'local' && parsed.password.length > 0) {
    return reject(
      'TEST_DATABASE_PASSWORD_FORBIDDEN',
      'local test targets must not carry a password; use the local peer/trust identity',
    );
  }

  const allowedUsers = resolveAllowedUsers(source, env, options.allowUsers);
  if (allowedUsers.length === 0) {
    return reject(
      'TEST_DATABASE_USER_ALLOWLIST_MISSING',
      `no allowed test database user resolved; set ${TEST_DATABASE_USERS_ENV} or pass allowUsers`,
    );
  }
  if (!allowedUsers.includes(user)) {
    return reject(
      'TEST_DATABASE_USER_NOT_ALLOWED',
      `database user "${user}" is not in the allowed test user set`,
    );
  }

  return {
    ok: true,
    target: {
      url,
      scheme: parsed.protocol,
      host,
      port: parsed.port,
      database,
      user,
      schema,
      env,
      allowedUsers,
    },
  };
}

export class TestDatabaseGuardError extends Error {
  readonly code: TestDatabaseRejectCode;

  constructor(rejection: TestDatabaseRejection) {
    super(rejection.message);
    this.name = 'TestDatabaseGuardError';
    this.code = rejection.code;
  }
}

/** 校验失败即抛错，供套件在加载 AppModule 之前调用。 */
export function assertTestDatabase(options: TestDatabaseOptions = {}): TestDatabaseTarget {
  const result = evaluateTestDatabase(options);
  if (!result.ok) throw new TestDatabaseGuardError(result.rejection);
  return result.target;
}

/** 供脚本使用：返回 {ok:true,target} 或 {ok:false,rejection}，不抛错。 */
export function checkTestDatabase(options: TestDatabaseOptions = {}): TestDatabaseResult {
  return evaluateTestDatabase(options);
}

export type TestDatabaseProbe = {
  database?: unknown;
  user?: unknown;
  schema?: unknown;
  server_addr?: unknown;
  version?: unknown;
};

/**
 * 连接建立后、任何 DDL/DML 之前执行的只读身份探针。
 * `schema` 一列只在目标 schema 确实存在且当前连接确实指向它时等于 workmesh_v1，
 * 避免只凭 session 默认 search_path 或只凭 schema 存在就放行。
 */
export const TEST_DATABASE_IDENTITY_PROBE_SQL = [
  'select current_database() as database,',
  '       current_user as user,',
  '       case',
  `         when to_regnamespace('${TEST_DATABASE_SCHEMA}') is not null`,
  `              and (current_schema() = '${TEST_DATABASE_SCHEMA}'`,
  `                   or current_setting('search_path', true) like '%${TEST_DATABASE_SCHEMA}%')`,
  `         then '${TEST_DATABASE_SCHEMA}'`,
  "         else coalesce(current_schema(), '')",
  '       end as schema,',
  '       inet_server_addr() as server_addr',
].join('\n');

/** 探针结果必须与校验通过的目标一致，否则不得继续。 */
export function evaluateIdentityProbe(
  probe: TestDatabaseProbe,
  target: TestDatabaseTarget,
): TestDatabaseResult {
  const actualDatabase = typeof probe.database === 'string' ? probe.database : '';
  if (actualDatabase !== target.database) {
    return reject(
      'TEST_DATABASE_PROBE_MISMATCH',
      `probe database "${actualDatabase}" does not match the verified target "${target.database}"`,
    );
  }
  const actualUser = typeof probe.user === 'string' ? probe.user : '';
  if (actualUser !== target.user) {
    return reject(
      'TEST_DATABASE_PROBE_MISMATCH',
      `probe user "${actualUser}" does not match the verified target "${target.user}"`,
    );
  }
  const actualSchema = typeof probe.schema === 'string' ? probe.schema : '';
  if (actualSchema !== target.schema) {
    return reject(
      'TEST_DATABASE_PROBE_MISMATCH',
      `probe schema "${actualSchema}" does not match the verified target "${target.schema}"`,
    );
  }
  return { ok: true, target };
}

/** 日志/报告里只输出脱敏目标，永不回显密码或完整连接串。 */
export function describeTestDatabaseTarget(target: TestDatabaseTarget): Record<string, string> {
  return {
    scheme: target.scheme,
    host: target.host,
    port: target.port || '(default)',
    database: target.database,
    user: target.user,
    schema: target.schema,
    env: target.env,
  };
}

/** 脱敏 URL：保留 scheme/host/库名/schema，去掉密码与用户名。 */
export function redactDatabaseUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = '';
    parsed.password = '';
    const host = parsed.host.replace(/^[^@]+@/, '');
    const base = `${parsed.protocol}//${host}${parsed.pathname}`;
    const schema = parsed.searchParams.get('schema');
    return schema ? `${base}?schema=${schema}` : base;
  } catch {
    return '(unparseable database url)';
  }
}
