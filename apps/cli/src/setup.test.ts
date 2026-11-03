import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RolePackageManifest } from '@workmesh/shared';
import { defaultRoleRoots, runSetup, resolveRolePackageDir } from './setup';

const manifest = {
  id: 'workmesh.role.backend',
  roleKey: 'backend',
  version: '1.1.0',
} as unknown as RolePackageManifest;

type CredentialSlice = {
  credentialId: string;
  projectId: string;
  roleKey: string;
  scopes: string[];
  expiresAt: string;
};

function credential(overrides: Partial<CredentialSlice> = {}) {
  return {
    credential: {
      credentialId: 'cred-1',
      projectId: 'p1',
      roleKey: 'backend',
      scopes: ['task:read'],
      expiresAt: '2026-12-01T00:00:00.000Z',
      ...overrides,
    },
    credentialPath: '/home/u/.workmesh/credentials/cred-1.json',
    requestId: 'req-1',
  } as never;
}

function installResult() {
  return {
    packageId: manifest.id,
    version: manifest.version,
    roleKey: 'backend',
    manifestDigest: 'a'.repeat(64),
    packagePath: '/ws/.workmesh/packages/backend/1.1.0',
    lockPath: '/ws/.workmesh/lock.json',
    workspaceConfigPath: '/ws/.workmesh/config.json',
    files: ['AGENTS.md', 'skills/index.md', 'assets/templates/impl.md'],
    reused: false,
  };
}

async function rolePackageDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workmesh-role-'));
  await writeFile(join(dir, 'manifest.json'), '{}', 'utf8');
  return dir;
}

const base = {
  workspaceDir: '/ws',
  configHome: '/home/u/.workmesh',
  role: 'backend',
  api: 'http://127.0.0.1:3000/api/v1',
};

describe('resolveRolePackageDir', () => {
  it('从给定 roots 里找到角色包', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workmesh-roles-'));
    await mkdir(join(root, 'backend'), { recursive: true });
    await writeFile(join(root, 'backend', 'manifest.json'), '{}', 'utf8');

    await expect(resolveRolePackageDir('backend', { roots: [root] })).resolves.toBe(
      join(root, 'backend'),
    );
  });

  it('从发行 ZIP 的 runtime/node.exe 定位同级 roles/ 包', async () => {
    const distributionRoot = await mkdtemp(join(tmpdir(), 'workmesh-cli-release-'));
    const roleDir = join(distributionRoot, 'roles', 'backend');
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, 'manifest.json'), '{}', 'utf8');

    // scripts/package-box.ps1 emits runtime/node.exe, app/cli/index.js and
    // roles/<role>/ at the same ZIP root.
    const releaseRoleRoot = join(distributionRoot, 'roles');
    const roots = defaultRoleRoots(join(distributionRoot, 'runtime', 'node.exe'));
    expect(roots).toContain(releaseRoleRoot);
    await expect(
      resolveRolePackageDir('backend', { roots: roots.filter((root) => root === releaseRoleRoot) }),
    ).resolves.toBe(roleDir);
  });

  it('找不到时列出所有查找过的路径', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workmesh-empty-'));

    await expect(resolveRolePackageDir('backend', { roots: [root] })).rejects.toThrow(
      /找不到角色包 backend[\s\S]*manifest\.json/,
    );
  });
});

describe('runSetup', () => {
  it('登录后把角色包装到授权返回的项目，并汇总 Agent 入口', async () => {
    const packageDir = await rolePackageDir();
    const login = vi.fn(async () => credential());
    const install = vi.fn(async () => installResult());
    const consent = vi.fn(async () => undefined);

    const result = await runSetup({
      ...base,
      projectId: 'p1',
      host: 'codex',
      packageDir,
      consent,
      login: login as never,
      install: install as never,
      readManifest: (async () => manifest) as never,
    });

    expect(consent).toHaveBeenCalledOnce();
    expect(login).toHaveBeenCalledWith(
      expect.objectContaining({ roleKey: 'backend', projectId: 'p1' }),
    );
    expect(install).toHaveBeenCalledWith(
      expect.objectContaining({
        packageDir,
        workspaceDir: '/ws',
        projectId: 'p1',
        host: 'codex',
      }),
    );
    expect(result.agentEntries).toEqual(['AGENTS.md', 'skills/index.md']);
    expect(result.projectId).toBe('p1');
    expect(result.credentialId).toBe('cred-1');
  });

  it('首次 setup 没有 --project 时给出可操作的提示', async () => {
    const packageDir = await rolePackageDir();

    await expect(
      runSetup({
        ...base,
        packageDir,
        consent: async () => undefined,
        login: (async () => credential()) as never,
        install: (async () => installResult()) as never,
        readManifest: (async () => manifest) as never,
      }),
    ).rejects.toThrow(/--project/);
  });

  it('浏览器批准的角色与角色包不一致时拒绝写入工作区', async () => {
    const packageDir = await rolePackageDir();
    const install = vi.fn(async () => installResult());

    await expect(
      runSetup({
        ...base,
        projectId: 'p1',
        packageDir,
        consent: async () => undefined,
        login: (async () => credential({ roleKey: 'frontend' })) as never,
        install: install as never,
        readManifest: (async () => manifest) as never,
      }),
    ).rejects.toThrow(/ROLE_MISMATCH|frontend/);
    expect(install).not.toHaveBeenCalled();
  });

  it('浏览器批准的项目与 --project 不一致时拒绝', async () => {
    const packageDir = await rolePackageDir();

    await expect(
      runSetup({
        ...base,
        projectId: 'p9',
        packageDir,
        consent: async () => undefined,
        login: (async () => credential()) as never,
        install: (async () => installResult()) as never,
        readManifest: (async () => manifest) as never,
      }),
    ).rejects.toThrow(/PROJECT_MISMATCH|p1/);
  });
});
