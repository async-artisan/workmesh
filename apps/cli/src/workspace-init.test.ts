import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  API,
  CREDENTIAL,
  DEFAULT_LOCATOR,
  makeDefinitionFixture,
  makeTempDir,
  PLATFORM,
  PROJECT,
  readJson,
  REPOSITORY,
  ROLE,
  ROLE_ID,
  snapshotTree,
  USER_ID,
  writeV1Workspace,
  writeV2Workspace,
} from './workspace-fixtures';
import {
  detectWorkspaceState,
  pendingInitPath,
  readDefinitionCache,
  workspaceV2Path,
  type ResolvedWorkspaceDefinition,
} from './workspace-config';
import { loadUserIndex } from './user-index';
import { runWorkspaceInit } from './workspace-init';

const NOW = new Date('2026-11-05T12:00:00.000Z');

function credential(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    origin: PLATFORM.origin,
    apiBasePath: PLATFORM.apiBasePath,
    userId: USER_ID,
    credentialId: CREDENTIAL,
    secret: 's'.repeat(43),
    projectId: PROJECT,
    roleId: ROLE_ID,
    roleKey: ROLE,
    scopes: ['task:read', 'context:read'],
    createdAt: NOW.toISOString(),
    expiresAt: '2027-01-01T00:00:00.000Z',
    ...overrides,
  };
}

type MockState = {
  factoryCalls: Array<{ platform: unknown; bearer?: string }>;
  consumeCalls: string[];
  revisionCalls: Array<{ projectId: string; revisionId: string }>;
  currentDefinitionCalls: number;
};

function mockClient(options: {
  enrolled: Record<string, unknown>;
  parsedRevision: { revision: ResolvedWorkspaceDefinition; digestMatchesPayload: boolean };
  payloadPresent?: boolean;
  consumeError?: unknown;
}): { factory: (...args: never[]) => never; state: MockState } {
  const state: MockState = {
    factoryCalls: [],
    consumeCalls: [],
    revisionCalls: [],
    currentDefinitionCalls: 0,
  };
  const factory = ((input: { platform: unknown; bearer?: string }) => {
    state.factoryCalls.push({ platform: input.platform, bearer: input.bearer });
    return {
      consumeEnrollmentCode: vi.fn(async (code: string) => {
        state.consumeCalls.push(code);
        if (options.consumeError) throw options.consumeError;
        return { data: options.enrolled, requestId: 'req-consume' };
      }),
      getWorkspaceDefinitionRevision: vi.fn(async (projectId: string, revisionId: string) => {
        state.revisionCalls.push({ projectId, revisionId });
        return {
          ...options.parsedRevision,
          payloadPresent: options.payloadPresent ?? true,
          requestId: 'req-revision',
        };
      }),
      getWorkspaceDefinition: vi.fn(async () => {
        state.currentDefinitionCalls += 1;
        throw new Error('init 不得回退当前 revision');
      }),
    };
  }) as never;
  return { factory, state };
}

function baseOptions(root: string, home: string, extra: Record<string, unknown> = {}) {
  return {
    root,
    joinCode: 'JOIN-CODE-123',
    api: API,
    role: ROLE,
    configHome: home,
    apply: true,
    yes: true,
    consent: async () => undefined,
    now: () => NOW,
    ...extra,
  };
}

describe('workspace init 授权与后续接入步骤', () => {
  it('已有凭据在线核验后完成接入，NONE项目直接提示装角色和自检', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: '接入示例',
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: parsed,
    });
    const reusable = vi.fn(async () => credential());
    const login = vi.fn();
    const result = await runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        findReusableCredential: reusable,
        login,
      }) as never,
    );
    expect(reusable).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: PLATFORM,
        projectId: PROJECT,
        roleKey: ROLE,
      }),
    );
    expect(login).not.toHaveBeenCalled();
    expect(result.mode).toBe('applied');
    if (result.mode === 'applied') {
      expect(result.nextActions).toContain('workmesh workspace status');
      expect(result.nextActions.join('\n')).toContain(`workmesh setup --role ${ROLE}`);
      expect(result.nextActions.join('\n')).toContain(`workmesh doctor --role ${ROLE} --online`);
      expect(result.nextActions.join('\n')).not.toContain('workspace bind');
    }
  });
});

describe('workspace init --join 计划（默认 dry-run）', () => {
  it('preflight 在本地校验后且 consent/消费码之前运行，失败不写盘', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const preflight = vi.fn(async () => {
      throw new Error('preflight refused');
    });
    const consent = vi.fn();
    const clientFactory = vi.fn();
    const before = await snapshotTree(root);
    const homeBefore = await snapshotTree(home);
    await expect(
      runWorkspaceInit(baseOptions(root, home, { preflight, consent, clientFactory }) as never),
    ).rejects.toThrow('preflight refused');
    expect(preflight).toHaveBeenCalledOnce();
    expect(consent).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(await snapshotTree(root)).toEqual(before);
    expect(await snapshotTree(home)).toEqual(homeBefore);
    preflight.mockClear();
    await expect(
      runWorkspaceInit(baseOptions(root, home, { role: '', preflight }) as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(preflight).not.toHaveBeenCalled();
  });

  it('计划不执行 preflight 或阶段通知，且不触发 consent 或网络', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const stages: string[] = [];
    const preflight = vi.fn(async () => undefined);
    const consent = vi.fn();
    const clientFactory = vi.fn();
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          apply: false,
          preflight,
          consent,
          clientFactory,
          onStage: (stage: string) => stages.push(stage),
        }) as never,
      ),
    ).resolves.toMatchObject({ mode: 'plan' });
    expect(stages).toEqual([]);
    expect(preflight).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('零网络、零写入，输出计划且不回显接入码', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: '示例项目',
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    const beforeRoot = await snapshotTree(root);
    const result = await runWorkspaceInit(
      baseOptions(root, home, { apply: false, clientFactory: mock.factory }) as never,
    );
    expect(result.mode).toBe('plan');
    if (result.mode === 'plan') {
      expect(result.consumesEnrollmentCode).toBe(false);
      expect(result.applyRequired).toBe(true);
      expect(result.writes).toEqual([]);
      expect(result.wouldWrite.join('\n')).toContain('workspace.json');
      expect(JSON.stringify(result)).not.toContain('JOIN-CODE-123');
      expect(JSON.stringify(result)).not.toContain(root);
    }
    expect(mock.state.factoryCalls).toHaveLength(0);
    expect(await snapshotTree(root)).toEqual(beforeRoot);
    expect(await snapshotTree(home)).toEqual([]);
  });
});

describe('workspace init --join 八步（apply）', () => {
  it('消费码→授权→精确 revision→摘要校验→原子写 workspace + 索引 + 缓存', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({
      layoutKind: 'SINGLE_ROOT',
      repositories: [
        {
          key: 'web',
          projectRepositoryId: REPOSITORY,
          suggestedPath: 'apps/web',
          locators: [[DEFAULT_LOCATOR, 'HTTPS']],
        },
      ],
    });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: '示例项目',
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    const login = vi.fn(async () => ({
      credential: credential(),
      credentialPath: '~/.workmesh/credentials/x.json',
      requestId: 'req-login',
    }));
    const result = await runWorkspaceInit(
      baseOptions(root, home, { clientFactory: mock.factory, login }) as never,
    );
    expect(result.mode).toBe('applied');
    // 接入码只消费一次；先匿名消费（无 bearer），再带凭据取精确 revision。
    expect(mock.state.consumeCalls).toEqual(['JOIN-CODE-123']);
    expect(mock.state.factoryCalls).toHaveLength(2);
    expect(mock.state.factoryCalls[0]?.bearer).toBeUndefined();
    expect(mock.state.factoryCalls[1]?.bearer).toMatch(/^wm_a1\./);
    expect(mock.state.revisionCalls).toEqual([
      { projectId: PROJECT, revisionId: fixture.revisionId },
    ]);
    // 绝不回退当前 revision。
    expect(mock.state.currentDefinitionCalls).toBe(0);

    const v2 = await readJson(workspaceV2Path(root));
    expect(v2).toMatchObject({
      schemaVersion: '2.0',
      projectId: PROJECT,
      definition: { revisionId: fixture.revisionId, sha256: fixture.digest },
      layout: { kind: 'SINGLE_ROOT' },
      defaults: { host: 'codex', roleKey: ROLE },
    });
    expect(v2.repositories).toEqual([
      expect.objectContaining({
        key: 'web',
        projectRepositoryId: REPOSITORY,
        path: 'apps/web',
        remote: 'origin',
      }),
    ]);
    // 用户索引含本机绝对 root（仅存本机）。
    const index = await loadUserIndex(home);
    const workspaceId = String((v2 as Record<string, unknown>).workspaceId);
    expect(index.workspaces[workspaceId]?.root).toBe(await realpath(root));
    expect(index.workspaces[workspaceId]?.projectId).toBe(PROJECT);
    // 定义缓存写入摘要与 payload。
    const cache = await readDefinitionCache(root, fixture.revisionId);
    expect(cache.exists).toBe(true);
    expect(cache.cache?.digest).toBe(fixture.digest);
    // pending 与锁清理。
    await expect(stat(pendingInitPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, '.workmesh', 'local', 'init.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    if (result.mode === 'applied') {
      expect(result.repositoryVerification).toBe('NOT_VERIFIED');
      expect(JSON.stringify(result)).not.toContain(root);
      expect(JSON.stringify(result)).not.toContain(home);
      expect(result.files).toEqual([
        '.workmesh/workspace.json',
        `.workmesh/definitions/${fixture.revisionId}.json`,
      ]);
    }
  });

  it('设备授权失败保留原错误并标记接入码已消费，不写本地配置', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    const { CliError } = await import('./errors');
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => {
            throw new CliError('NETWORK_TIMEOUT', 'device authorization timed out', {
              status: 504,
              requestId: 'req-device',
              details: { phase: 'poll' },
            });
          },
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      exitCode: 7,
      status: 504,
      requestId: 'req-device',
      details: { phase: 'poll', enrollmentConsumed: true },
      message: expect.stringContaining('重新生成接入码'),
    });
    expect(await snapshotTree(root)).toEqual(['d:.workmesh', 'd:.workmesh/local']);
    expect(await snapshotTree(home)).toEqual([]);
  });

  it('设备授权期间收到 SIGINT：报告接入码已消费且不写工作区或用户索引', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    let markLoginStarted!: () => void;
    const loginStarted = new Promise<void>((resolve) => {
      markLoginStarted = resolve;
    });
    const pending = runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async ({ signal }: { signal?: AbortSignal }) => {
          markLoginStarted();
          return new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
      }) as never,
    );

    await loginStarted;
    process.emit('SIGINT');

    await expect(pending).rejects.toMatchObject({
      code: 'USER_INTERRUPTED',
      exitCode: 130,
      details: { enrollmentConsumed: true },
      message: expect.stringContaining('重新生成接入码'),
    });
    expect(mock.state.consumeCalls).toEqual(['JOIN-CODE-123']);
    expect(await snapshotTree(root)).toEqual(['d:.workmesh', 'd:.workmesh/local']);
    expect(await snapshotTree(home)).toEqual([]);
  });

  it('派生定义缓存写失败时成功结果不列出不存在的缓存，并提示在线刷新', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    const result = await runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        __testFailAt: 'CACHE',
      }) as never,
    );
    expect(result.mode).toBe('applied');
    if (result.mode === 'applied') {
      expect(result.files).toEqual(['.workmesh/workspace.json']);
      expect(result.warnings.join('\n')).toContain('离线能力未就绪');
      expect(result.warnings.join('\n')).toContain('workspace bind');
    }
    expect((await readDefinitionCache(root, fixture.revisionId)).exists).toBe(false);
  });

  it('空仓库映射（layout NONE）合法，配置不含仓库', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: {
        revision: parsed.revision,
        digestMatchesPayload: parsed.digestMatchesPayload,
      },
    });
    const result = await runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
      }) as never,
    );
    expect(result.mode).toBe('applied');
    const v2 = await readJson<{ repositories: unknown[]; layout: { kind: string } }>(
      workspaceV2Path(root),
    );
    expect(v2.repositories).toEqual([]);
    expect(v2.layout.kind).toBe('NONE');
  });
});

describe('workspace init --join 失败与重试', () => {
  it('码已消费：不写任何文件，提示重新生成', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const { CliError } = await import('./errors');
    const mock = mockClient({
      enrolled: {},
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
      consumeError: new CliError('ENROLLMENT_CONSUMED', 'consumed', { status: 409 }),
    });
    const login = vi.fn();
    let failure: Error | null = null;
    try {
      await runWorkspaceInit(
        baseOptions(root, home, { clientFactory: mock.factory, login }) as never,
      );
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toMatchObject({ code: 'ENROLLMENT_CONSUMED', exitCode: 5 });
    expect(failure?.message).toContain('已使用');
    expect(failure?.message).toContain('重新生成');
    expect(login).not.toHaveBeenCalled();
    expect(await snapshotTree(root)).toEqual(['d:.workmesh', 'd:.workmesh/local']);
    expect(await snapshotTree(home)).toEqual([]);
  });

  it('digest 与接入码不一致：拒绝写入，不留半份 workspace.json 或 pending', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: 'b'.repeat(64),
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
    });
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        }) as never,
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
    const snapshot = await detectWorkspaceState(root);
    expect(snapshot.v2.exists).toBe(false);
    await expect(stat(pendingInitPath(root))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(root, '.workmesh', 'local', 'init.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('消费请求结果未知时保留原错误并提示重新签发，不能断言未消费', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const { CliError } = await import('./errors');
    const mock = mockClient({
      enrolled: {},
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
      consumeError: new CliError('NETWORK_TIMEOUT', '连接超时'),
    });
    await expect(
      runWorkspaceInit(baseOptions(root, home, { clientFactory: mock.factory }) as never),
    ).rejects.toMatchObject({
      code: 'NETWORK_TIMEOUT',
      details: { enrollmentConsumptionUnknown: true },
      message: expect.stringContaining('重新生成接入码'),
    });
    expect((await detectWorkspaceState(root)).v2.exists).toBe(false);
  });

  it('revisionId 与接入码不一致：拒绝（不静默取当前 revision）', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: '12345678-1234-4123-8123-123456789012',
        definitionDigest: fixture.digest,
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
    });
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        }) as never,
      ),
    ).rejects.toMatchObject({ code: 'CONTENT_INTEGRITY_FAILED' });
    const snapshot = await detectWorkspaceState(root);
    expect(snapshot.v2.exists).toBe(false);
  });

  it.each([null, '12345678-1234-4123-8123-123456789012'])(
    'revision payload 项目缺失或错误（%s）时拒绝，提示已消费且不写配置',
    async (projectId) => {
      const root = await makeTempDir();
      const home = await makeTempDir('wm-home-');
      const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
      const parsed = await (
        await import('./workspace-config')
      ).parseWorkspaceRevision(fixture.revisionData);
      const mock = mockClient({
        enrolled: {
          projectId: PROJECT,
          projectName: null,
          definitionRevisionId: fixture.revisionId,
          definitionDigest: fixture.digest,
        },
        parsedRevision: {
          revision: { ...parsed.revision, payload: { ...parsed.revision.payload, projectId } },
          digestMatchesPayload: true,
        },
      });
      await expect(
        runWorkspaceInit(
          baseOptions(root, home, {
            clientFactory: mock.factory,
            login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
          }) as never,
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_MISMATCH', details: { enrollmentConsumed: true } });
      expect((await detectWorkspaceState(root)).v2.exists).toBe(false);
      expect((await loadUserIndex(home)).workspaces).toEqual({});
    },
  );

  it('revision 的 payload 摘要重算不匹配时拒绝写入配置和索引', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: false },
    });
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'CONTENT_INTEGRITY_FAILED',
      details: { enrollmentConsumed: true },
    });
    expect((await detectWorkspaceState(root)).v2.exists).toBe(false);
    expect((await loadUserIndex(home)).workspaces).toEqual({});
  });

  it('revision 报告 payload 缺失时拒绝并提示重新签发', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
      payloadPresent: false,
    });
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'CONTENT_INTEGRITY_FAILED',
      details: { enrollmentConsumed: true },
      message: expect.stringContaining('重新生成'),
    });
    expect((await detectWorkspaceState(root)).v2.exists).toBe(false);
    expect((await loadUserIndex(home)).workspaces).toEqual({});
  });

  it('本机写盘失败：回滚半份 workspace.json，保留 pending 诊断，消息说明码已使用', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
    });
    let failure: Error | null = null;
    try {
      await runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
          __testFailAt: 'INDEX',
        }) as never,
      );
    } catch (error) {
      failure = error as Error;
    }
    expect(failure).toMatchObject({ code: 'WORKSPACE_WRITE_FAILED', exitCode: 9 });
    expect(failure?.message).toContain('接入码已使用');
    const snapshot = await detectWorkspaceState(root);
    expect(snapshot.v2.exists).toBe(false);
    // pending-init 保留供诊断，锁已清理。
    expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
    await expect(stat(join(root, '.workmesh', 'local', 'init.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('已绑定时拒绝重跑（不重复消费接入码、不改写配置）', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    await writeV2Workspace(root);
    const before = await readFile(workspaceV2Path(root), 'utf8');
    const consumeEnrollmentCode = vi.fn();
    const factory = (() => ({ consumeEnrollmentCode })) as never;
    await expect(
      runWorkspaceInit(baseOptions(root, home, { clientFactory: factory }) as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND', exitCode: 5 });
    expect(consumeEnrollmentCode).not.toHaveBeenCalled();
    expect(await readFile(workspaceV2Path(root), 'utf8')).toBe(before);
  });

  it('已绑定重跑返回当前绑定与操作指引，不建议删除；跨平台或角色请求仍拒绝', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const existing = await writeV2Workspace(root);
    const clientFactory = vi.fn();
    const preflight = vi.fn();
    const same = await runWorkspaceInit(
      baseOptions(root, home, { clientFactory, preflight }) as never,
    ).catch((error: unknown) => error);
    expect(same).toMatchObject({
      code: 'WORKSPACE_ALREADY_BOUND',
      details: {
        enrollmentConsumed: false,
        workspaceId: existing.workspaceId,
        projectId: PROJECT,
        platform: PLATFORM,
        role: ROLE,
        mismatch: [],
        nextAction: 'workmesh workspace status',
      },
    });
    expect((same as Error).message).not.toContain('删除');
    expect((same as Error).message).toContain('workspace recover');
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          api: 'https://other.example.com/api/v1',
          clientFactory,
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_BOUND',
      details: { mismatch: ['platform'], enrollmentConsumed: false },
    });
    await expect(
      runWorkspaceInit(baseOptions(root, home, { role: 'frontend', clientFactory }) as never),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ALREADY_BOUND',
      details: { mismatch: ['role'], enrollmentConsumed: false },
    });
    expect(clientFactory).not.toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
  });

  it('V1_ONLY 要求先迁移；DUAL_ACTIVE 拒绝且不消费码', async () => {
    const home = await makeTempDir('wm-home-');
    const v1 = await makeTempDir();
    await writeV1Workspace(v1);
    const factory = vi.fn() as never;
    await expect(
      runWorkspaceInit(baseOptions(v1, home, { clientFactory: factory }) as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_V1_MIGRATION_REQUIRED', exitCode: 2 });
    expect(factory).not.toHaveBeenCalled();

    const dual = await makeTempDir();
    await writeV1Workspace(dual);
    await writeV2Workspace(dual);
    await expect(
      runWorkspaceInit(baseOptions(dual, home, { clientFactory: factory }) as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_DUAL_CONFIG', exitCode: 5 });
    expect(factory).not.toHaveBeenCalled();
  });

  it('缺 --api / --role 或非法接入码时明确拒绝，不触网', async () => {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const factory = vi.fn() as never;
    await expect(
      runWorkspaceInit(baseOptions(root, home, { api: '', clientFactory: factory }) as never),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      runWorkspaceInit(baseOptions(root, home, { role: '', clientFactory: factory }) as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, { joinCode: '   ', clientFactory: factory }) as never,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('workspace init 锁和提交一致性', () => {
  async function context() {
    const root = await makeTempDir();
    const home = await makeTempDir('wm-home-');
    const fixture = await makeDefinitionFixture({ layoutKind: 'NONE' });
    const parsed = await (
      await import('./workspace-config')
    ).parseWorkspaceRevision(fixture.revisionData);
    const mock = mockClient({
      enrolled: {
        projectId: PROJECT,
        projectName: null,
        definitionRevisionId: fixture.revisionId,
        definitionDigest: fixture.digest,
      },
      parsedRevision: { revision: parsed.revision, digestMatchesPayload: true },
    });
    return { root, home, mock };
  }

  it('持锁的 init 与竞争者同步：竞争者不消费、不删除锁，成功配置不被覆盖', async () => {
    const { root, home, mock } = await context();
    let competitorPreflightDone!: () => void;
    let startCompetitor!: () => void;
    const competitorReady = new Promise<void>((resolve) => {
      competitorPreflightDone = resolve;
    });
    const competitorResume = new Promise<void>((resolve) => {
      startCompetitor = resolve;
    });
    const competitor = runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        consent: async () => {
          competitorPreflightDone();
          await competitorResume;
        },
      }) as never,
    );
    await competitorReady;
    let enterLogin!: () => void;
    let finishLogin!: () => void;
    const entered = new Promise<void>((resolve) => {
      enterLogin = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      finishLogin = resolve;
    });
    const first = runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async () => {
          enterLogin();
          await resume;
          return { credential: credential(), credentialPath: 'x', requestId: 'r' };
        },
      }) as never,
    );
    await entered;
    const lockPath = join(root, '.workmesh', 'local', 'init.lock');
    const owner = await readFile(lockPath, 'utf8');
    startCompetitor();
    await expect(competitor).rejects.toMatchObject({
      code: 'WORKSPACE_INIT_IN_PROGRESS',
      details: { enrollmentConsumed: false },
    });
    expect(await readFile(lockPath, 'utf8')).toBe(owner);
    expect(mock.state.consumeCalls).toHaveLength(1);
    finishLogin();
    await expect(first).resolves.toMatchObject({ mode: 'applied' });
    const result = await readFile(workspaceV2Path(root), 'utf8');
    await expect(
      runWorkspaceInit(baseOptions(root, home, { clientFactory: mock.factory }) as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND' });
    expect(await readFile(workspaceV2Path(root), 'utf8')).toBe(result);
    expect(mock.state.consumeCalls).toHaveLength(1);
  });

  it('取得锁后重新检查配置，前置检查之后出现的 workspace 不被覆盖，也不消费码', async () => {
    const { root, home, mock } = await context();
    let entered!: () => void;
    let release!: () => void;
    const atConsent = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        consent: async () => {
          entered();
          await resume;
        },
      }) as never,
    );
    await atConsent;
    await writeV2Workspace(root);
    const original = await readFile(workspaceV2Path(root), 'utf8');
    release();
    await expect(first).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND' });
    expect(await readFile(workspaceV2Path(root), 'utf8')).toBe(original);
    expect(mock.state.consumeCalls).toEqual([]);
  });

  it('索引已提交但释放锁失败时保留一致的配置和索引，并提供诊断', async () => {
    const { root, home, mock } = await context();
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
          __testFailAt: 'INDEX_LOCK_RELEASE',
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_WRITE_FAILED',
      details: {
        enrollmentConsumed: true,
        indexCommitted: true,
        lockReleaseFailed: true,
        rollback: 'none',
        recovery: expect.stringContaining('workspace.json 和用户索引已提交并保留'),
      },
    });
    const config = await readJson(workspaceV2Path(root));
    const index = await loadUserIndex(home);
    expect(index.workspaces[String(config.workspaceId)]).toMatchObject({
      projectId: PROJECT,
      root: await realpath(root),
    });
    expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
    expect((await stat(join(home, 'workspaces', 'index.lock'))).isFile()).toBe(true);
  });

  it('配置和索引提交后 pending 删除失败，保留一致数据并提供恢复指引', async () => {
    const { root, home, mock } = await context();
    const failure = await runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async () => ({ credential: credential(), credentialPath: 'x', requestId: 'r' }),
        __testFailAt: 'PENDING_REMOVE',
      }) as never,
    ).then(
      () => {
        throw new Error('预期 pending 删除失败');
      },
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      code: 'EACCES',
      exitCode: 9,
      details: {
        enrollmentConsumed: true,
        workspaceCommitted: true,
        indexCommitted: true,
        rollback: 'none',
        pendingInit: '.workmesh/local/pending-init.json',
        recovery: expect.stringContaining('workspace recover'),
      },
    });
    if (!(failure instanceof Error)) throw new Error('预期得到 Error');
    expect(failure.message).toContain('workspace.json 和用户索引已提交并保留');
    expect(failure.message).toContain('无需重新生成接入码或重新执行 init');
    expect(failure.message).not.toContain('请回 Web 重新生成接入码后重试');
    const config = await readJson(workspaceV2Path(root));
    expect((await loadUserIndex(home)).workspaces[String(config.workspaceId)]).toMatchObject({
      projectId: PROJECT,
      root: await realpath(root),
    });
    expect((await stat(pendingInitPath(root))).isFile()).toBe(true);
    await expect(stat(join(root, '.workmesh', 'local', 'init.lock'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      runWorkspaceInit(baseOptions(root, home, { clientFactory: mock.factory }) as never),
    ).rejects.toMatchObject({ code: 'WORKSPACE_ALREADY_BOUND' });
    expect(mock.state.consumeCalls).toHaveLength(1);
  });

  it('锁被替换后持有者不删除新锁，成功提交数据保留并提示检查', async () => {
    const { root, home, mock } = await context();
    let entered!: () => void;
    let release!: () => void;
    const atLogin = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = runWorkspaceInit(
      baseOptions(root, home, {
        clientFactory: mock.factory,
        login: async () => {
          entered();
          await resume;
          return { credential: credential(), credentialPath: 'x', requestId: 'r' };
        },
      }) as never,
    );
    await atLogin;
    const lockPath = join(root, '.workmesh', 'local', 'init.lock');
    const replacement = JSON.stringify({ token: 'another-owner' });
    await writeFile(lockPath, replacement);
    release();
    await expect(operation).rejects.toMatchObject({
      code: 'WORKSPACE_WRITE_FAILED',
      details: { lockReleaseFailed: true, indexCommitted: true },
    });
    expect(await readFile(lockPath, 'utf8')).toBe(replacement);
    const config = await readJson(workspaceV2Path(root));
    expect((await loadUserIndex(home)).workspaces[String(config.workspaceId)]?.projectId).toBe(
      PROJECT,
    );
  });

  it('已有失败且锁被替换时保留原错误并附加锁诊断', async () => {
    const { root, home, mock } = await context();
    const { CliError } = await import('./errors');
    const lockPath = join(root, '.workmesh', 'local', 'init.lock');
    await expect(
      runWorkspaceInit(
        baseOptions(root, home, {
          clientFactory: mock.factory,
          login: async () => {
            await writeFile(lockPath, JSON.stringify({ token: 'new-owner' }));
            throw new CliError('AUTH_DENIED', '授权被拒绝');
          },
        }) as never,
      ),
    ).rejects.toMatchObject({
      code: 'AUTH_DENIED',
      details: { enrollmentConsumed: true },
      message: expect.stringContaining('init 锁释放失败或所有权已变化'),
    });
    expect(await readFile(lockPath, 'utf8')).toBe(JSON.stringify({ token: 'new-owner' }));
  });

  it('中断遗留锁和 pending 记录均在消费前失败关闭，重试不自动删除', async () => {
    const { root, home, mock } = await context();
    const dir = join(root, '.workmesh', 'local');
    await mkdir(dir, { recursive: true });
    const lockPath = join(dir, 'init.lock');
    await writeFile(lockPath, '{partial');
    await expect(
      runWorkspaceInit(baseOptions(root, home, { clientFactory: mock.factory }) as never),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_INIT_IN_PROGRESS',
      details: { enrollmentConsumed: false },
    });
    expect(await readFile(lockPath, 'utf8')).toBe('{partial');
    expect(mock.state.consumeCalls).toEqual([]);
    const otherRoot = await makeTempDir();
    await mkdir(join(otherRoot, '.workmesh', 'local'), { recursive: true });
    await writeFile(pendingInitPath(otherRoot), '{interrupted');
    await expect(
      runWorkspaceInit(baseOptions(otherRoot, home, { clientFactory: mock.factory }) as never),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_INIT_IN_PROGRESS',
      details: { enrollmentConsumed: false },
    });
    expect(await readFile(pendingInitPath(otherRoot), 'utf8')).toBe('{interrupted');
    expect(mock.state.consumeCalls).toEqual([]);
  });
});
