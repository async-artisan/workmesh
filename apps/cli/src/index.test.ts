import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sha256Bytes } from '@workmesh/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, main, readOption, reviewSubjectOf } from './index';
import { snapshotTree } from './workspace-fixtures';
import { saveWorkspace } from './config';
import { saveCredential } from './credential-store';

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
  vi.unstubAllGlobals();
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
      'doctor',
      'workspace',
      'tasks',
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
      'approve',
    ])
      expect(names).not.toContain(legacy);
    const auth = program.commands.find((command) => command.name() === 'auth');
    expect(auth?.commands.map((command) => command.name())).toEqual(['login', 'status', 'logout']);
    const roles = program.commands.find((command) => command.name() === 'roles');
    expect(roles?.commands.map((command) => command.name())).toEqual(['install']);
    const receipt = program.commands.find((command) => command.name() === 'receipt');
    expect(receipt?.commands.map((command) => command.name())).toEqual([
      'list',
      'show',
      'reconcile',
    ]);
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
    expect(lines.join('\n')).toContain('workspace init 默认预览');
    expect(lines.join('\n')).not.toContain('roles install --package');
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

async function authenticatedWorkspace() {
  const dir = await mkdtemp(join(tmpdir(), 'wm-cli-actions-'));
  const home = join(dir, 'user-home');
  const platform = { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' };
  const credentialId = randomUUID();
  await saveWorkspace(dir, {
    schemaVersion: '1.0',
    profile: 'default',
    platform,
    projectId: PROJECT,
    roleKey: 'backend',
    repositoryId: null,
    host: 'codex',
    workflowDefinitionRevisionId: null,
  });
  await saveCredential(home, {
    version: '1.0',
    ...platform,
    userId: randomUUID(),
    credentialId,
    secret: 'a'.repeat(43),
    projectId: PROJECT,
    roleId: randomUUID(),
    roleKey: 'backend',
    scopes: ['task:read', 'context:read', 'artifact:write', 'review:read'],
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  });
  return { dir, home, credentialId, args: ['--dir', dir, '--config-home', home, '--json'] };
}

describe('read-only context inspection', () => {
  it('requires no claim or version and only performs the input-status GET', async () => {
    const ws = await authenticatedWorkspace();
    const taskId = randomUUID();
    const network = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              taskId,
              taskVersion: 2,
              availability: 'UNAVAILABLE',
              issuesComplete: true,
              issues: [{ kind: 'ARTIFACT', fromStepKey: 'backend', artifactKind: 'API_SPEC' }],
            },
            meta: { requestId: 'inspect' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', network);
    const lines = capture();
    expect(await main(['context', '--task', taskId, '--inspect', ...ws.args])).toBe(0);
    expect(network).toHaveBeenCalledTimes(1);
    expect(network.mock.calls[0]).toEqual([
      `${API}/tasks/${taskId}/input-status`,
      expect.objectContaining({ method: 'GET' }),
    ]);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      data: { taskId, availability: 'UNAVAILABLE', issuesComplete: true },
      meta: { requestId: 'inspect' },
    });
  });
  it.each([
    ['--claim', randomUUID()],
    ['--expected-version', '2'],
    ['--materialize'],
    ['--snapshot', randomUUID()],
  ])('rejects mixed creation options before making a request: %s', async (...options) => {
    const ws = await authenticatedWorkspace();
    const network = vi.fn();
    vi.stubGlobal('fetch', network);
    capture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await main(['context', '--task', randomUUID(), '--inspect', ...options, ...ws.args]),
    ).not.toBe(0);
    expect(network).not.toHaveBeenCalled();
  });
});

describe('CLI recipient task guidance', () => {
  it('reads one exact artifact set with its diagnostic envelope and performs no mutation', async () => {
    const ws = await authenticatedWorkspace();
    const setId = randomUUID();
    const diagnostics = {
      checkedAt: 'now',
      complete: true,
      currentBinding: 'CURRENT',
      taskGeneration: 1,
      currentTaskGeneration: 1,
      signaturePolicy: 'REJECTED_BEFORE_RECEIPT',
      references: [],
    };
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: { id: setId, codeReview: { required: true, acceptable: false, diagnostics } },
            meta: { requestId: 'artifact-read' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', request);
    const lines = capture();
    expect(await main(['artifact', '--artifact-set', setId, ...ws.args])).toBe(0);
    expect(request.mock.calls).toEqual([
      [`${API}/artifact-sets/${setId}`, expect.objectContaining({ method: 'GET' })],
    ]);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      data: { id: setId, codeReview: { diagnostics, acceptable: false } },
      meta: { requestId: 'artifact-read' },
    });
  });
  it('returns the server guidance in the envelope and only performs the paginated GET', async () => {
    const ws = await authenticatedWorkspace();
    const guidance = {
      checkedAt: '2026-11-10T00:00:00Z',
      scope: 'EVENT_TASKS',
      eventBaseline: 'CURRENT',
      tasks: [{ taskId: 'task-1', reason: 'NO_CONTEXT', action: 'INSPECT_AND_CLAIM' }],
    };
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: {
              items: [{ id: 'rec-1', eventId: 'event-1', guidance }],
              nextCursor: 'next-recipient',
            },
            meta: { requestId: 'changes-guidance' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', request);
    const lines = capture();
    expect(
      await main(['changes', '--cursor', 'previous-recipient', '--limit', '20', ...ws.args]),
    ).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      expect.stringContaining('/change-recipients?'),
      expect.objectContaining({ method: 'GET' }),
    ]);
    const url = new URL(String((request.mock.calls as unknown as Array<[string]>)[0]![0]));
    expect(url.searchParams.get('cursor')).toBe('previous-recipient');
    expect(url.searchParams.get('projectId')).toBe(PROJECT);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      data: { items: [{ guidance }], nextCursor: 'next-recipient', hasMore: true },
      meta: { requestId: 'changes-guidance' },
    });
  });
});

describe('CLI actionable task and review results', () => {
  it('explains unsupported Git-only inputs before suggesting another context command', async () => {
    const ws = await authenticatedWorkspace();
    const taskId = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              data: url.endsWith('/input-status')
                ? {
                    availability: 'REQUIRES_LOCAL_CHECK',
                    issue: 'SNAPSHOT_EXTERNAL_INPUT_UNSUPPORTED',
                    comparison: { status: 'NO_SNAPSHOT' },
                  }
                : {
                    version: 3,
                    executionStatus: 'IN_PROGRESS',
                    workStatus: 'ACTIVE',
                    currentClaim: {
                      id: randomUUID(),
                      principalScopeKey: `agent:${ws.credentialId}`,
                      releasedAt: null,
                    },
                  },
              meta: { requestId: 'task-input' },
            }),
            { status: 200 },
          ),
      ),
    );
    const lines = capture();
    expect(
      await main(['tasks', 'show', '--task', taskId, ...ws.args.filter((arg) => arg !== '--json')]),
    ).toBe(0);
    expect(lines.join('\n')).toContain('补交并验收 HOSTED 正文');
    expect(lines.join('\n')).not.toContain('workmesh context');
  });

  it('keeps read subcommand I/O options on the selected leaf command', async () => {
    const program = buildProgram();
    const review = program.commands.find((command) => command.name() === 'review')!;
    const show = review.commands.find((command) => command.name() === 'show')!;
    let received: unknown;
    show.action((options) => {
      received = options;
    });
    await program.parseAsync(
      [
        'review',
        'show',
        '--review',
        PROJECT,
        '--dir',
        'selected-workspace',
        '--config-home',
        'selected-home',
        '--json',
      ],
      { from: 'user' },
    );
    expect(received).toMatchObject({
      dir: 'selected-workspace',
      configHome: 'selected-home',
      json: true,
    });
    expect(review.opts()).not.toHaveProperty('dir');
  });

  it('review show bypasses create-only parameters and preserves failed discussion reads', async () => {
    const ws = await authenticatedWorkspace();
    const reviewId = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.includes('/discussions')
                ? { error: { code: 'FORBIDDEN', message: 'scope denied' } }
                : {
                    data: {
                      id: reviewId,
                      status: 'CHANGES_REQUESTED',
                      version: 2,
                      decisions: [{ decision: 'CHANGES_REQUESTED', comment: '补充边界场景' }],
                    },
                    meta: { requestId: 'review-read' },
                  },
            ),
            { status: url.includes('/discussions') ? 403 : 200 },
          ),
      ),
    );
    const lines = capture();
    expect(await main(['review', 'show', '--review', reviewId, ...ws.args])).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      data: {
        id: reviewId,
        decisions: [{ comment: '补充边界场景' }],
        webUrl: `https://workmesh.example.com/reviews/${reviewId}`,
        discussions: null,
        discussionError: { code: 'FORBIDDEN' },
      },
    });
  });

  it('deliver returns the auto-created review and stores it in the operation receipt', async () => {
    const ws = await authenticatedWorkspace();
    const taskId = randomUUID();
    const reviewRequestId = randomUUID();
    const operationId = randomUUID();
    const manifest = join(ws.dir, 'deliver.json');
    await writeFile(
      manifest,
      JSON.stringify({
        workflowDefinitionRevisionId: randomUUID(),
        localRunId: 'run-1',
        items: [
          {
            kind: 'IMPL',
            schemaVersion: '1.0',
            storage: 'GIT_REF',
            mediaType: 'text/x-source',
            sha256: 'b'.repeat(64),
            byteLength: 0,
            projectRepositoryId: randomUUID(),
            commitSha: 'a'.repeat(40),
            repoPath: 'src/main.ts',
            checks: [],
          },
        ],
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                artifactSet: { id: randomUUID() },
                task: { version: 5, executionStatus: 'REVIEW_PENDING' },
                reviewRequestId,
              },
              meta: { requestId: 'delivery' },
            }),
            { status: 200 },
          ),
      ),
    );
    const lines = capture();
    expect(
      await main([
        'deliver',
        '--task',
        taskId,
        '--claim',
        randomUUID(),
        '--snapshot',
        randomUUID(),
        '--expected-version',
        '4',
        '--manifest',
        manifest,
        '--operation',
        operationId,
        ...ws.args,
      ]),
    ).toBe(0);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      data: {
        reviewRequestId,
        reviewWebUrl: `https://workmesh.example.com/reviews/${reviewRequestId}`,
        taskVersion: 5,
        operationId,
      },
    });
    const { readReceipt } = await import('./receipts');
    expect(await readReceipt(ws.dir, operationId)).toMatchObject({
      status: 'COMMITTED',
      resultRefs: { reviewRequestId },
    });
  });
});

describe('CLI discussion operations', () => {
  it('shows the discussion version separately from the review version in human output', async () => {
    const ws = await authenticatedWorkspace();
    const reviewId = randomUUID();
    const discussionId = randomUUID();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              data: url.includes('/discussions')
                ? {
                    unresolvedCount: 1,
                    items: [
                      {
                        id: discussionId,
                        version: 7,
                        resolved: false,
                        title: '补充权限边界',
                        body: '请核对凭据撤回后的操作。',
                        source: { reviewId },
                        entries: [],
                      },
                    ],
                  }
                : { id: reviewId, status: 'OPEN', version: 2, decisions: [] },
              meta: { requestId: 'discussion-read' },
            }),
            { status: 200 },
          ),
      ),
    );
    const lines = capture();
    expect(
      await main([
        'review',
        'show',
        '--review',
        reviewId,
        ...ws.args.filter((arg) => arg !== '--json'),
      ]),
    ).toBe(0);
    expect(lines.join('\n')).toContain(`评审 ${reviewId} · OPEN · v2`);
    expect(lines.join('\n')).toContain(`问题 ${discussionId} · v7 · 未解决`);
  });

  it.each(['issue', 'reply'] as const)(
    '%s prints the server-returned discussion ID and version in human output',
    async (action) => {
      const ws = await authenticatedWorkspace();
      const reviewId = randomUUID();
      const discussionId = randomUUID();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                data: {
                  discussionId,
                  entryId: action === 'reply' ? randomUUID() : null,
                  version: 9,
                },
                meta: { requestId: 'discussion-write' },
              }),
              { status: 200 },
            ),
        ),
      );
      const lines = capture();
      expect(
        await main([
          'review',
          action,
          '--review',
          reviewId,
          ...(action === 'issue'
            ? ['--title', '补充权限边界']
            : ['--discussion', discussionId, '--expected-version', '4']),
          '--body',
          '请核对凭据撤回后的操作。',
          ...ws.args.filter((arg) => arg !== '--json'),
        ]),
      ).toBe(0);
      expect(lines.join('\n')).toContain(`问题 ${discussionId} · v9`);
      expect(lines.join('\n')).toContain(`workmesh review show --review ${reviewId}`);
    },
  );

  it('paginates entries using the exact source review and opaque cursor', async () => {
    const ws = await authenticatedWorkspace();
    const reviewId = randomUUID();
    const discussionId = randomUUID();
    const request = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ data: { items: [], nextCursor: null }, meta: { requestId: 'entries' } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', request);
    const lines = capture();
    expect(
      await main([
        'review',
        'entries',
        '--review',
        reviewId,
        '--discussion',
        discussionId,
        '--cursor',
        'opaque+/==',
        ...ws.args,
      ]),
    ).toBe(0);
    const url = new URL(request.mock.calls[0]![0]);
    expect(url.pathname).toBe(
      `/api/v1/review-requests/${reviewId}/discussions/${discussionId}/entries`,
    );
    expect(url.searchParams.get('cursor')).toBe('opaque+/==');
    expect(JSON.parse(lines[0]!)).toMatchObject({ data: { items: [], nextCursor: null } });
  });

  it('records an issue and a version-bound reply with separate operation receipts', async () => {
    const ws = await authenticatedWorkspace();
    const reviewId = randomUUID();
    const discussionId = randomUUID();
    const addressedInReviewId = randomUUID();
    const issueOperation = randomUUID();
    const replyOperation = randomUUID();
    const request = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Response(
          JSON.stringify({
            data: {
              discussionId,
              entryId: JSON.parse(String(init.body)).kind ? 'entry' : null,
              version: JSON.parse(String(init.body)).kind ? 2 : 1,
            },
            meta: { requestId: 'discussion-write' },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', request);
    const lines = capture();
    expect(
      await main([
        'review',
        'issue',
        '--review',
        reviewId,
        '--title',
        '补充边界用例',
        '--body',
        '请覆盖权限撤回',
        '--operation',
        issueOperation,
        ...ws.args,
      ]),
    ).toBe(0);
    expect(
      await main([
        'review',
        'reply',
        '--review',
        reviewId,
        '--discussion',
        discussionId,
        '--expected-version',
        '1',
        '--body',
        '已补覆盖，见本次交付',
        '--addressed-in-review',
        addressedInReviewId,
        '--operation',
        replyOperation,
        ...ws.args,
      ]),
    ).toBe(0);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[1]![1].body))).toEqual({
      kind: 'REPLY',
      expectedVersion: 1,
      body: '已补覆盖，见本次交付',
      addressedInReviewId,
    });
    expect(JSON.parse(lines[1]!)).toMatchObject({
      data: { discussionId, entryId: 'entry', operationId: replyOperation, version: 2 },
    });
    const { readReceipt } = await import('./receipts');
    expect(await readReceipt(ws.dir, issueOperation)).toMatchObject({
      status: 'COMMITTED',
      resultRefs: { discussionId, version: 1 },
    });
    expect(await readReceipt(ws.dir, replyOperation)).toMatchObject({
      status: 'COMMITTED',
      resultRefs: { discussionId, entryId: 'entry', version: 2 },
    });
  });

  it('retains the original reply operation when the write result is unknown', async () => {
    const ws = await authenticatedWorkspace();
    const operationId = randomUUID();
    const request = vi.fn(async () => {
      throw new Error('connection lost');
    });
    vi.stubGlobal('fetch', request);
    const lines = capture();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(
      await main([
        'review',
        'reply',
        '--review',
        randomUUID(),
        '--discussion',
        randomUUID(),
        '--expected-version',
        '1',
        '--body',
        '回应依据',
        '--operation',
        operationId,
        ...ws.args,
      ]),
    ).not.toBe(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      error: { details: { operationId, operationOutcome: 'UNKNOWN' } },
    });
    const { readReceipt } = await import('./receipts');
    expect(await readReceipt(ws.dir, operationId)).toMatchObject({ status: 'PENDING' });
  });
});

describe('接入诊断 CLI 边界', () => {
  it.each([
    ['pending-init.json', 6, 'INVALID_PENDING'],
    ['init.lock', 5, 'LOCKED'],
  ] as const)('恢复 %s 返回非零且只输出一份 JSON，保留诊断文件', async (file, exitCode, state) => {
    const root = await mkdtemp(join(tmpdir(), 'wm-cli-recover-'));
    const home = join(root, 'user-home');
    const local = join(root, '.workmesh', 'local');
    await mkdir(local, { recursive: true });
    await writeFile(join(local, file), 'invalid or owned by another command');
    const before = await snapshotTree(root);
    const lines = capture();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    expect(
      await main([
        'workspace',
        'recover',
        '--root',
        root,
        '--config-home',
        home,
        '--apply',
        '--json',
      ]),
    ).toBe(exitCode);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      error: { code: 'WORKSPACE_RECOVERY_BLOCKED', details: { recovery: { state, writes: [] } } },
    });
    expect(await snapshotTree(root)).toEqual(before);
  });

  it('init 命令的预检失败不消费码、不创建绑定或凭据', async () => {
    const root = await mkdtemp(join(tmpdir(), 'wm-cli-preflight-'));
    const home = join(root, 'user-home');
    const before = await snapshotTree(root);
    const network = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', network);
    const lines = capture();
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(
        await main([
          'workspace',
          'init',
          '--join',
          'valid-preview-code',
          '--root',
          root,
          '--api',
          API,
          '--role',
          'backend',
          '--host',
          'codex',
          '--config-home',
          home,
          '--apply',
          '--yes',
          '--json',
        ]),
      ).toBe(2);
      expect(network).toHaveBeenCalledOnce();
      expect((network.mock.calls[0] as unknown as [string])[0]).toBe(
        'https://workmesh.example.com/api/health/ready',
      );
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        error: { code: 'PREFLIGHT_FAILED', details: { enrollmentConsumed: false } },
      });
      expect(await snapshotTree(root)).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
