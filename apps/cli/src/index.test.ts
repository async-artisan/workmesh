import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Bytes } from '@workmesh/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, main, readOption, reviewSubjectOf } from './index';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const API = 'https://workmesh.example.com/api/v1';

describe('多词参数的键名兼容', () => {
  // commander 12 只把 --credential-store 存成 credentialStore；
  // 曾经因为按 kebab 键取值，这类参数会被静默忽略（包括 --expected-version）。
  it('kebab 与 camelCase 两种键名都能取到值', () => {
    expect(readOption({ credentialStore: 'file' }, 'credential-store')).toBe('file');
    expect(readOption({ 'credential-store': 'file' }, 'credential-store')).toBe('file');
    expect(readOption({}, 'credential-store')).toBeUndefined();
  });

  it('多段连字符同样兼容', () => {
    expect(readOption({ localRunId: 'run-1' }, 'local-run-id')).toBe('run-1');
    expect(readOption({ 'local-run-id': 'run-1' }, 'local-run-id')).toBe('run-1');
  });
});

describe('review subject 互斥组合', () => {
  const artifactSet = 'aed2efa2-ff73-45c1-8f8a-247ff33e1408';
  const documentRevision = '89a90c56-3345-4834-b9de-bcdac7a4b668';

  it('只提供 artifact-set 时接受 TASK_ARTIFACT_SET', () => {
    expect(reviewSubjectOf(artifactSet, undefined)).toEqual({
      kind: 'TASK_ARTIFACT_SET',
      id: artifactSet,
    });
  });

  it('只提供 document-revision 时接受 DOCUMENT_REVISION', () => {
    expect(reviewSubjectOf(undefined, documentRevision)).toEqual({
      kind: 'DOCUMENT_REVISION',
      id: documentRevision,
    });
  });

  it('两者都缺少或同时提供时拒绝', () => {
    expect(() => reviewSubjectOf(undefined, undefined)).toThrow(
      '必须且只能提供 --artifact-set 或 --document-revision',
    );
    expect(() => reviewSubjectOf(artifactSet, documentRevision)).toThrow(
      '必须且只能提供 --artifact-set 或 --document-revision',
    );
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function capture(): string[] {
  const lines: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  });
  // commander 的 --version / help 直接写 stdout，不经过 console.log。
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    lines.push(String(chunk).replace(/\n$/, ''));
    return true;
  });
  return lines;
}

async function rolePackage(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'wm-cli-pkg-'));
  const content = '后端角色说明。\n';
  const bytes = Buffer.from(content, 'utf8');
  await writeFile(join(dir, 'AGENTS.md'), content, 'utf8');
  const manifest = {
    packageSchemaVersion: '1.0',
    id: 'backend-role',
    version: '1.0.0',
    protocolVersion: '1.0',
    title: 'Backend role',
    roleKey: 'backend',
    compatibility: {
      minCliVersion: '1.0.0',
      maxCliVersionExclusive: '2.0.0',
      contractVersion: '1.0',
    },
    inputs: [],
    outputs: [{ key: 'impl', channel: 'ARTIFACT', kind: 'IMPL', contractVersion: '1.0' }],
    resources: [
      {
        id: 'agents-md',
        kind: 'AGENT_ENTRY',
        path: 'AGENTS.md',
        sha256: await sha256Bytes(new Uint8Array(bytes)),
        byteLength: bytes.length,
        mediaType: 'text/markdown',
      },
    ],
    agentEntries: [
      { host: 'codex', type: 'AGENTS_MD', resourceId: 'agents-md', adapterVersion: '1.0.0' },
    ],
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return dir;
}

describe('CLI command surface', () => {
  it('只暴露 v1 命令面，不含旧命令', () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    for (const expected of [
      'auth',
      'login',
      'roles',
      'claim',
      'context',
      'materialize',
      'candidate',
      'deliver',
      'review',
      'receipt',
      'changes',
      'product',
    ])
      expect(names).toContain(expected);
    for (const legacy of [
      'sync',
      'pull',
      'push',
      'prd-push',
      'ready',
      'sign',
      'ack',
      'spec-version',
      'init',
      'doctor',
      'approve',
    ])
      expect(names).not.toContain(legacy);
    const auth = program.commands.find((command) => command.name() === 'auth');
    expect(auth?.commands.map((command) => command.name())).toEqual(['login', 'status', 'logout']);
    const roles = program.commands.find((command) => command.name() === 'roles');
    expect(roles?.commands.map((command) => command.name())).toEqual(['install']);
    const receipt = program.commands.find((command) => command.name() === 'receipt');
    expect(receipt?.commands.map((command) => command.name())).toEqual(['show', 'reconcile']);
    const candidate = program.commands.find((command) => command.name() === 'candidate');
    expect(candidate?.options.map((option) => option.flags)).toEqual(
      expect.arrayContaining([
        '--basis-understanding-revision <id>',
        '--delivery-scope <json>',
        '--acceptance <json>',
      ]),
    );
  });

  it('无参数输出起步说明并返回 0', async () => {
    const lines = capture();
    expect(await main([])).toBe(0);
    expect(lines.join('\n')).toContain('WorkMesh');
    expect(lines.join('\n')).toContain('auth login --credential-store file');
  });

  it('--version 返回 0', async () => {
    const lines = capture();
    expect(await main(['--version'])).toBe(0);
    expect(lines.join('\n')).toBe('1.0.0');
  });

  it('未知旧命令返回 2，--json 时 stdout 恰好一份错误 envelope', async () => {
    const lines = capture();
    expect(await main(['pull', '--json'])).toBe(2);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      error: { code: string; message: string; requestId: string };
    };
    expect(parsed.error.code).toBe('USAGE');
    expect(parsed.error.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(parsed)).toEqual(['error']);
  });

  it('login 不接受密码参数', async () => {
    expect(await main(['login', '--password', 'secret'])).toBe(2);
  });

  it('roles install --json 返回可分页解析的成功 envelope', async () => {
    const packageDir = await rolePackage();
    const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-cli-ws-'));
    const lines = capture();
    const code = await main([
      'roles',
      'install',
      '--json',
      '--package',
      packageDir,
      '--dir',
      workspaceDir,
      '--project',
      PROJECT,
      '--host',
      'codex',
      '--api',
      API,
    ]);
    expect(code).toBe(0);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '') as {
      data: { packageId: string; reused: boolean; lockPath: string };
      meta: { requestId: string };
    };
    expect(parsed.data.packageId).toBe('backend-role');
    expect(parsed.data.reused).toBe(false);
    expect(parsed.data.lockPath).toContain('lock.json');
    expect(parsed.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
