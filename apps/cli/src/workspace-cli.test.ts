import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeCredential,
  makeTempDir,
  PLATFORM,
  PROJECT,
  readJson,
  REPOSITORY,
  ROLE,
  snapshotTree,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import { buildProgram, main } from './index';
import { saveCredential } from './credential-store';
import { runMigrationApply } from './workspace-migrate';
import { loadUserIndex } from './user-index';

const TASK = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CLAIM = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa';
const SNAPSHOT = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const OPERATION = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';

function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    lines.push(String(chunk).replace(/\n$/, ''));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((): boolean => true);
  return lines;
}

function errorCodeOf(lines: string[]): string | null {
  for (const line of [...lines].reverse()) {
    try {
      const parsed = JSON.parse(line) as { error?: { code?: string } };
      if (parsed.error?.code) return parsed.error.code;
    } catch {
      // 非 JSON 行
    }
  }
  return null;
}

type LegacyCase = { name: string; args: string[] };

function legacyCases(): LegacyCase[] {
  return [
    { name: 'auth login', args: ['auth', 'login', '--credential-store', 'file'] },
    { name: 'login alias', args: ['login', '--credential-store', 'file'] },
    { name: 'auth status', args: ['auth', 'status'] },
    { name: 'auth logout', args: ['auth', 'logout'] },
    { name: 'roles install', args: ['roles', 'install', '--package', '/nonexistent-package'] },
    { name: 'setup', args: ['setup', '--role', ROLE, '--package', '/nonexistent-package'] },
    { name: 'claim', args: ['claim', '--task', TASK] },
    {
      name: 'context',
      args: ['context', '--task', TASK, '--claim', CLAIM, '--expected-version', '1'],
    },
    { name: 'materialize', args: ['materialize', '--snapshot', SNAPSHOT] },
    { name: 'product start', args: ['product', 'start', '--title', 't', '--text', 'x'] },
    {
      name: 'product brainstorm update',
      args: ['product', 'brainstorm', 'update', '--request', 'r', '--brainstorm', '{}'],
    },
    {
      name: 'product brainstorm select',
      args: ['product', 'brainstorm', 'select', '--request', 'r', '--option', 'o'],
    },
    { name: 'product promote', args: ['product', 'promote', '--request', 'r'] },
    { name: 'product resume', args: ['product', 'resume', '--request', 'r'] },
    {
      name: 'product update',
      args: ['product', 'update', '--request', 'r', '--understanding', '{}'],
    },
    {
      name: 'product answer',
      args: [
        'product',
        'answer',
        '--request',
        'r',
        '--question',
        'q',
        '--answer',
        'a',
        '--apply-to',
        'x',
      ],
    },
    { name: 'product confirm', args: ['product', 'confirm', '--request', 'r'] },
    { name: 'product draft', args: ['product', 'draft', '--request', 'r'] },
    { name: 'candidate', args: ['candidate', '--kind', 'PRD', '--file', '/nonexistent.md'] },
    {
      name: 'deliver',
      args: [
        'deliver',
        '--task',
        TASK,
        '--claim',
        CLAIM,
        '--snapshot',
        SNAPSHOT,
        '--expected-version',
        '1',
        '--manifest',
        '/nonexistent.json',
      ],
    },
    { name: 'review', args: ['review', '--artifact-set', SNAPSHOT, '--expected-version', '1'] },
    { name: 'receipt show', args: ['receipt', 'show', '--operation', OPERATION] },
    { name: 'receipt reconcile', args: ['receipt', 'reconcile', '--operation', OPERATION] },
    { name: 'changes', args: ['changes'] },
  ];
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('workspace 命令面', () => {
  it('暴露 init/discover/bind/status/migrate，参数面包含 --json 与 --root', () => {
    const program = buildProgram();
    const workspace = program.commands.find((command) => command.name() === 'workspace');
    expect(workspace?.commands.map((command) => command.name())).toEqual([
      'init',
      'discover',
      'bind',
      'status',
      'migrate',
    ]);
    for (const leaf of workspace?.commands ?? []) {
      const flags = leaf.options.map((option) => option.flags).join(' ');
      expect(flags).toContain('--json');
      expect(flags).toContain('--root');
    }
    const migrate = workspace?.commands.find((command) => command.name() === 'migrate');
    const migrateFlags = migrate?.options.map((option) => option.flags).join(' ') ?? '';
    for (const flag of ['--dry-run', '--apply', '--inspect', '--resolve'])
      expect(migrateFlags).toContain(flag);
  });
});

describe('24 个旧命令回归（§14.3 矩阵）', () => {
  it('DUAL_ACTIVE：24 个旧命令全部拒绝 WORKSPACE_DUAL_CONFIG（退出码 5）', async () => {
    const dir = await makeTempDir('wm-reg-');
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    await writeV1Workspace(dir);
    await writeV2Workspace(dir);
    const cases = legacyCases();
    expect(cases).toHaveLength(24);
    for (const testCase of cases) {
      const lines = capture();
      const code = await main([...testCase.args, '--json', '--dir', dir, '--config-home', home]);
      expect({ name: testCase.name, code }).toEqual({ name: testCase.name, code: 5 });
      expect({ name: testCase.name, error: errorCodeOf(lines) }).toEqual({
        name: testCase.name,
        error: 'WORKSPACE_DUAL_CONFIG',
      });
      vi.restoreAllMocks();
    }
  });

  it('NONE：读配置的旧命令返回 CONFIG_NOT_FOUND，不静默回退', async () => {
    const dir = await makeTempDir('wm-reg-');
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    const excluded = new Set(['auth logout', 'receipt show', 'roles install', 'setup']);
    const cases = legacyCases().filter((testCase) => !excluded.has(testCase.name));
    for (const testCase of cases) {
      const lines = capture();
      const code = await main([...testCase.args, '--json', '--dir', dir, '--config-home', home]);
      expect({ name: testCase.name, code }).toEqual({ name: testCase.name, code: 2 });
      expect({ name: testCase.name, error: errorCodeOf(lines) }).toEqual({
        name: testCase.name,
        error: 'CONFIG_NOT_FOUND',
      });
      vi.restoreAllMocks();
    }
  });

  it('V2_ONLY：旧数据命令通过 v2 适配层读取 project/platform/role（claim 成功）', async () => {
    const dir = await makeTempDir('wm-reg-');
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    await writeV2Workspace(dir);
    await saveCredential(home, makeCredential() as never);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(
          JSON.stringify({
            data: { claimId: CLAIM, task: { version: 2 } },
            meta: { requestId: 'req-claim' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const lines = capture();
    const code = await main([
      'claim',
      '--task',
      TASK,
      '--json',
      '--dir',
      dir,
      '--config-home',
      home,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? '') as {
      data: { claimId: string; taskVersion: number };
      meta: { requestId: string };
    };
    expect(parsed.data.claimId).toBe(CLAIM);
    expect(parsed.data.taskVersion).toBe(2);
    expect(calls[0]?.url).toBe(`${PLATFORM.origin}${PLATFORM.apiBasePath}/tasks/${TASK}/claims`);
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer wm_a1\./);
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('MIGRATED：迁移后旧命令按 v2 工作（claim 成功，不读 .bak）', async () => {
    const dir = await makeTempDir('wm-reg-');
    await writeV1Workspace(dir);
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    const migrated = await runMigrationApply({ root: dir, configHome: home });
    expect(migrated.state).toBe('MIGRATED');
    // 篡改 .bak 也不影响旧命令解析（适配层只读 v2）。
    const backup = join(dir, '.workmesh', `config.v1.${migrated.backupFile}.json.bak`);
    await writeFile(backup, '{"schemaVersion":"1.0","projectId":"bad"}', 'utf8');
    await saveCredential(home, makeCredential() as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { claimId: CLAIM, task: { version: 1 } },
              meta: { requestId: 'req-migrated' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const lines = capture();
    const code = await main([
      'claim',
      '--task',
      TASK,
      '--json',
      '--dir',
      dir,
      '--config-home',
      home,
    ]);
    expect(code).toBe(0);
    const parsed = JSON.parse(lines[0] ?? '') as { data: { claimId: string } };
    expect(parsed.data.claimId).toBe(CLAIM);
    const index = await loadUserIndex(home);
    expect(Object.keys(index.workspaces)).toHaveLength(1);
  });

  it('V1_ONLY：数据命令保持现有 v1 行为（claim 继续可用）', async () => {
    const dir = await makeTempDir('wm-reg-');
    await writeV1Workspace(dir);
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    await saveCredential(home, makeCredential() as never);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { claimId: CLAIM, task: { version: 1 } },
              meta: { requestId: 'req-v1' },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ),
    );
    const lines = capture();
    expect(
      await main(['claim', '--task', TASK, '--json', '--dir', dir, '--config-home', home]),
    ).toBe(0);
    expect((JSON.parse(lines[0] ?? '') as { data: { claimId: string } }).data.claimId).toBe(CLAIM);
  });

  it('V1_ONLY：setup / roles install 要求先迁移（exit 2, WORKSPACE_V1_MIGRATION_REQUIRED）', async () => {
    const dir = await makeTempDir('wm-reg-');
    await writeV1Workspace(dir);
    const home = await mkdtemp(join(tmpdir(), 'wm-reg-home-'));
    for (const args of [
      ['roles', 'install', '--package', '/nonexistent-package'],
      ['setup', '--role', ROLE, '--package', '/nonexistent-package'],
    ]) {
      const lines = capture();
      expect(await main([...args, '--json', '--dir', dir, '--config-home', home])).toBe(2);
      expect(errorCodeOf(lines)).toBe('WORKSPACE_V1_MIGRATION_REQUIRED');
      vi.restoreAllMocks();
    }
  });
});

describe('workspace 命令的 DUAL_ACTIVE / dry-run 行为', () => {
  async function dual(): Promise<{ dir: string; home: string }> {
    const dir = await makeTempDir('wm-cli-');
    await writeV1Workspace(dir);
    await writeV2Workspace(dir);
    const home = await mkdtemp(join(tmpdir(), 'wm-cli-home-'));
    return { dir, home };
  }

  it('status 在 DUAL_ACTIVE 只读诊断并退出码 5，stdout 错误 envelope 带两文件摘要', async () => {
    const { dir, home } = await dual();
    const before = await snapshotTree(dir);
    const lines = capture();
    const code = await main([
      'workspace',
      'status',
      '--json',
      '--root',
      dir,
      '--config-home',
      home,
    ]);
    expect(code).toBe(5);
    const envelope = JSON.parse(lines[0] ?? '') as {
      error: {
        code: string;
        details: { status: { state: string; files: { v1: { digest: string } } } };
      };
    };
    expect(envelope.error.code).toBe('WORKSPACE_DUAL_CONFIG');
    expect(envelope.error.details.status.state).toBe('DUAL_ACTIVE');
    expect(envelope.error.details.status.files.v1.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('discover/init/bind/migrate --dry-run 在 DUAL_ACTIVE 下拒绝；migrate --inspect 只读放行', async () => {
    const { dir, home } = await dual();
    for (const args of [
      ['workspace', 'discover'],
      [
        'workspace',
        'init',
        '--join',
        'CODE',
        '--role',
        ROLE,
        '--api',
        'https://workmesh.example.com/api/v1',
      ],
      ['workspace', 'bind', '--repository', REPOSITORY, '--path', '.'],
      ['workspace', 'migrate', '--dry-run'],
      ['workspace', 'migrate', '--apply'],
    ]) {
      const lines = capture();
      expect(await main([...args, '--json', '--root', dir, '--config-home', home])).toBe(5);
      expect(errorCodeOf(lines)).toBe('WORKSPACE_DUAL_CONFIG');
      vi.restoreAllMocks();
    }
    const before = await snapshotTree(dir);
    const lines = capture();
    expect(
      await main([
        'workspace',
        'migrate',
        '--inspect',
        '--json',
        '--root',
        dir,
        '--config-home',
        home,
      ]),
    ).toBe(0);
    const parsed = JSON.parse(lines[0] ?? '') as { data: { state: string; writes: unknown[] } };
    expect(parsed.data.state).toBe('DUAL_ACTIVE');
    expect(parsed.data.writes).toEqual([]);
    expect(await snapshotTree(dir)).toEqual(before);
  });

  it('workspace init 默认只做计划（零写入），缺 --api 时明确报错', async () => {
    const root = await makeTempDir('wm-cli-');
    const home = await mkdtemp(join(tmpdir(), 'wm-cli-home-'));
    const lines = capture();
    expect(
      await main([
        'workspace',
        'init',
        '--join',
        'CODE',
        '--role',
        ROLE,
        '--api',
        'https://workmesh.example.com/api/v1',
        '--json',
        '--root',
        root,
        '--config-home',
        home,
      ]),
    ).toBe(0);
    const parsed = JSON.parse(lines[0] ?? '') as { data: { mode: string; wouldWrite: string[] } };
    expect(parsed.data.mode).toBe('plan');
    expect(parsed.data.wouldWrite.join('\n')).toContain('workspace.json');
    expect(await snapshotTree(root)).toEqual([]);

    vi.restoreAllMocks();
    const missing = capture();
    expect(
      await main([
        'workspace',
        'init',
        '--join',
        'CODE',
        '--role',
        ROLE,
        '--json',
        '--root',
        root,
        '--config-home',
        home,
      ]),
    ).toBe(2);
    expect(errorCodeOf(missing)).toBe('INVALID_REQUEST');
  });

  it('workspace migrate --dry-run 在 V1_ONLY 零写入并输出映射', async () => {
    const dir = await makeTempDir('wm-cli-');
    await writeV1Workspace(dir, { repositoryId: REPOSITORY });
    const home = await mkdtemp(join(tmpdir(), 'wm-cli-home-'));
    const before = await snapshotTree(dir);
    const lines = capture();
    expect(
      await main([
        'workspace',
        'migrate',
        '--dry-run',
        '--json',
        '--root',
        dir,
        '--config-home',
        home,
      ]),
    ).toBe(0);
    const parsed = JSON.parse(lines[0] ?? '') as {
      data: { mode: string; plan: { projectId: string }; writes: unknown[]; wouldWrite: unknown[] };
    };
    expect(parsed.data.mode).toBe('dry-run');
    expect(parsed.data.plan.projectId).toBe(PROJECT);
    expect(parsed.data.writes).toEqual([]);
    expect(parsed.data.wouldWrite.length).toBeGreaterThan(0);
    expect(await snapshotTree(dir)).toEqual(before);
    void readJson;
  });
});
