import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Bytes } from '@workmesh/shared';
import { describe, expect, it } from 'vitest';
import { installRolePackage } from './roles';
import { loadWorkspace, lockPath } from './config';

const PROJECT = '2f6c1c4b-6b0e-4f5d-9c2d-2b1b4b0f9b4a';
const API = 'https://workmesh.example.com/api/v1';
const AGENTS = '你是一个后端角色。\n';

/** 已有 v2 绑定（MIGRATED）：重装角色包不再写配置，直接复用 v2 的 project/role。 */
async function writeV2Workspace(workspaceDir: string, roleKey = 'backend'): Promise<void> {
  await mkdir(join(workspaceDir, '.workmesh'), { recursive: true });
  await writeFile(
    join(workspaceDir, '.workmesh', 'workspace.json'),
    JSON.stringify(
      {
        schemaVersion: '2.0',
        workspaceId: '11111111-1111-4111-8111-111111111111',
        platform: { origin: 'https://workmesh.example.com', apiBasePath: '/api/v1' },
        projectId: PROJECT,
        definition: {
          revisionId: '22222222-2222-4222-8222-222222222222',
          sha256: 'a'.repeat(64),
        },
        layout: { kind: 'NONE' },
        repositories: [],
        defaults: { profile: 'default', host: 'codex', roleKey },
      },
      null,
      2,
    ),
    'utf8',
  );
}

type PackageFixture = {
  packageDir: string;
  workspaceDir: string;
  resourcePath: string;
};

async function makePackage(
  overrides: {
    version?: string;
    minCliVersion?: string;
    resourcePath?: string;
    content?: string;
  } = {},
): Promise<PackageFixture> {
  const packageDir = await mkdtemp(join(tmpdir(), 'wm-pkg-'));
  const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-ws-'));
  const resourcePath = overrides.resourcePath ?? 'AGENTS.md';
  const content = overrides.content ?? AGENTS;
  const bytes = Buffer.from(content, 'utf8');
  await mkdir(packageDir, { recursive: true });
  if (overrides.resourcePath === undefined || overrides.resourcePath === 'AGENTS.md') {
    await writeFile(join(packageDir, 'AGENTS.md'), content, 'utf8');
  }
  const manifest = {
    packageSchemaVersion: '1.0',
    id: 'backend-role',
    version: overrides.version ?? '1.0.0',
    protocolVersion: '1.0',
    title: 'Backend role',
    roleKey: 'backend',
    compatibility: {
      minCliVersion: overrides.minCliVersion ?? '1.0.0',
      maxCliVersionExclusive: '2.0.0',
      contractVersion: '1.0',
    },
    inputs: [],
    outputs: [{ key: 'impl', channel: 'ARTIFACT', kind: 'IMPL', contractVersion: '1.0' }],
    resources: [
      {
        id: 'agents-md',
        kind: 'AGENT_ENTRY',
        path: resourcePath,
        sha256: await sha256Bytes(new Uint8Array(bytes)),
        byteLength: bytes.length,
        mediaType: 'text/markdown',
      },
    ],
    agentEntries: [
      { host: 'codex', type: 'AGENTS_MD', resourceId: 'agents-md', adapterVersion: '1.0.0' },
    ],
  };
  await writeFile(join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return { packageDir, workspaceDir, resourcePath };
}

describe('roles install', () => {
  it('完整校验后安装到 .workmesh/packages 并写 lock.json 与工作区配置', async () => {
    const fixture = await makePackage();
    const result = await installRolePackage({
      packageDir: fixture.packageDir,
      workspaceDir: fixture.workspaceDir,
      projectId: PROJECT,
      host: 'codex',
      api: API,
    });
    expect(result.roleKey).toBe('backend');
    expect(result.reused).toBe(false);
    const installed = join(
      fixture.workspaceDir,
      '.workmesh',
      'packages',
      'backend-role',
      '1.0.0',
      'AGENTS.md',
    );
    expect(await readFile(installed, 'utf8')).toBe(AGENTS);
    const lock = JSON.parse(await readFile(lockPath(fixture.workspaceDir), 'utf8')) as {
      packageLocks: Array<{ packageId: string; version: string; packageDigest: string }>;
      managedFiles: Array<{ path: string; sha256: string }>;
    };
    expect(lock.packageLocks[0]).toMatchObject({
      packageId: 'backend-role',
      version: '1.0.0',
      packageDigest: result.manifestDigest,
    });
    expect(lock.managedFiles).toHaveLength(1);
    expect(lock.managedFiles[0]?.path).toBe('.workmesh/packages/backend-role/1.0.0/AGENTS.md');
    const workspace = await loadWorkspace(fixture.workspaceDir);
    expect(workspace.projectId).toBe(PROJECT);
    expect(workspace.roleKey).toBe('backend');
    expect(workspace.host).toBe('codex');
  });

  it('资源被篡改 → PACKAGE_TAMPERED（exit 8），不安装', async () => {
    const fixture = await makePackage();
    await writeFile(join(fixture.packageDir, 'AGENTS.md'), '被改过的内容', 'utf8');
    await expect(
      installRolePackage({
        packageDir: fixture.packageDir,
        workspaceDir: fixture.workspaceDir,
        projectId: PROJECT,
        api: API,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_TAMPERED', exitCode: 8 });
    await expect(
      stat(join(fixture.workspaceDir, '.workmesh', 'packages', 'backend-role')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('路径穿越被拒绝', async () => {
    const fixture = await makePackage({ resourcePath: '../escape.md' });
    await expect(
      installRolePackage({
        packageDir: fixture.packageDir,
        workspaceDir: fixture.workspaceDir,
        projectId: PROJECT,
        api: API,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_MANIFEST_INVALID', exitCode: 2 });
  });

  it('同版本同摘要重复安装不改 bytes/mtime，返回 reused', async () => {
    const fixture = await makePackage();
    await writeV2Workspace(fixture.workspaceDir);
    await installRolePackage({
      packageDir: fixture.packageDir,
      workspaceDir: fixture.workspaceDir,
      projectId: PROJECT,
      api: API,
    });
    const installed = join(
      fixture.workspaceDir,
      '.workmesh',
      'packages',
      'backend-role',
      '1.0.0',
      'AGENTS.md',
    );
    const before = await stat(installed);
    const second = await installRolePackage({
      packageDir: fixture.packageDir,
      workspaceDir: fixture.workspaceDir,
    });
    expect(second.reused).toBe(true);
    const after = await stat(installed);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('本地受管文件被修改 → LOCAL_MANAGED_FILE_MODIFIED，保留本地修改', async () => {
    const fixture = await makePackage();
    await writeV2Workspace(fixture.workspaceDir);
    await installRolePackage({
      packageDir: fixture.packageDir,
      workspaceDir: fixture.workspaceDir,
      projectId: PROJECT,
      api: API,
    });
    const installed = join(
      fixture.workspaceDir,
      '.workmesh',
      'packages',
      'backend-role',
      '1.0.0',
      'AGENTS.md',
    );
    await writeFile(installed, '本地人工改动', 'utf8');
    await expect(
      installRolePackage({ packageDir: fixture.packageDir, workspaceDir: fixture.workspaceDir }),
    ).rejects.toMatchObject({ code: 'LOCAL_MANAGED_FILE_MODIFIED', exitCode: 8 });
    expect(await readFile(installed, 'utf8')).toBe('本地人工改动');
  });

  it('同版本不同摘要不能替换已登记包', async () => {
    const first = await makePackage();
    await writeV2Workspace(first.workspaceDir);
    await installRolePackage({
      packageDir: first.packageDir,
      workspaceDir: first.workspaceDir,
      projectId: PROJECT,
      api: API,
    });
    const second = await makePackage({ content: '另一个内容\n' });
    await expect(
      installRolePackage({
        packageDir: second.packageDir,
        workspaceDir: first.workspaceDir,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_TAMPERED', exitCode: 8 });
  });

  it('CLI 版本不在兼容范围时拒绝，不执行脚本', async () => {
    const fixture = await makePackage({ minCliVersion: '2.0.0' });
    await expect(
      installRolePackage({
        packageDir: fixture.packageDir,
        workspaceDir: fixture.workspaceDir,
        projectId: PROJECT,
        api: API,
      }),
    ).rejects.toMatchObject({ code: 'PACKAGE_INCOMPATIBLE', exitCode: 2 });
  });

  it('工作区已有不同角色时拒绝混装', async () => {
    const fixture = await makePackage();
    await writeV2Workspace(fixture.workspaceDir, 'product');
    await expect(
      installRolePackage({ packageDir: fixture.packageDir, workspaceDir: fixture.workspaceDir }),
    ).rejects.toMatchObject({ code: 'LOCAL_INPUT_INVALID' });
  });

  it('v1 工作区的 roles install 要求先迁移（不静默覆盖 v1）', async () => {
    const fixture = await makePackage();
    await installRolePackage({
      packageDir: fixture.packageDir,
      workspaceDir: fixture.workspaceDir,
      projectId: PROJECT,
      api: API,
    });
    await expect(
      installRolePackage({ packageDir: fixture.packageDir, workspaceDir: fixture.workspaceDir }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_V1_MIGRATION_REQUIRED',
      exitCode: 2,
    });
  });
});
