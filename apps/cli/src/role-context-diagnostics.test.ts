import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Bytes, type TaskInputStatusView } from '@workmesh/shared';
import { diagnoseRoleContext, renderRoleContext } from './role-context-diagnostics';

async function fixture() {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'wm-role-context-'));
  const bytes = Buffer.from('Task locked SOP\n');
  const sha256 = await sha256Bytes(new Uint8Array(bytes));
  const status: TaskInputStatusView = {
    taskId: 'task-1',
    taskVersion: 2,
    snapshotId: null,
    checkedAt: '2026-11-10T00:00:00Z',
    availability: 'VERIFIED',
    issue: null,
    resources: [],
    comparison: { status: 'NO_SNAPSHOT', changes: [], metadataChanges: [] },
    rolePackage: {
      workflowDefinitionRevisionId: 'wf-locked',
      roleKey: 'backend',
      status: 'LOCKED',
      locked: {
        packageId: 'workmesh.role.backend',
        version: '1.2.0',
        packageDigest: 'a'.repeat(64),
        source: 'BUILTIN',
        resources: [
          {
            refId: 'role:sop',
            path: 'skills/implement/SKILL.md',
            sha256,
            byteLength: bytes.length,
          },
        ],
      },
      latestAvailable: {
        packageId: 'workmesh.role.backend',
        version: '1.3.0',
        packageDigest: 'b'.repeat(64),
        source: 'PROJECT',
      },
      comparison: { status: 'NO_SNAPSHOT', changes: [] },
    },
  };
  const lock = {
    schemaVersion: '1.0',
    packageLocks: [
      {
        packageId: 'workmesh.role.backend',
        roleKey: 'backend',
        version: '1.2.0',
        packageDigest: 'a'.repeat(64),
      },
      {
        packageId: 'workmesh.role.backend',
        roleKey: 'backend',
        version: '1.3.0',
        packageDigest: 'b'.repeat(64),
      },
    ],
  };
  const path = join(
    workspaceDir,
    '.workmesh',
    'packages',
    'workmesh.role.backend',
    '1.2.0',
    'skills',
    'implement',
    'SKILL.md',
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  await writeFile(join(workspaceDir, '.workmesh', 'lock.json'), JSON.stringify(lock));
  const diagnose = () => diagnoseRoleContext({ workspaceDir, status });
  return { workspaceDir, bytes, status, lock, path, diagnose };
}

describe('role context diagnostics', () => {
  it('checks the task exact version bytes when multiple versions are installed; a newer publication is only UPDATE_AVAILABLE', async () => {
    const f = await fixture();
    const result = await f.diagnose();
    expect(result.local.status).toBe('MATCH');
    expect(result.notices).toEqual(['UPDATE_AVAILABLE']);
    expect(result.resourceChanges.status).toBe('NO_SNAPSHOT');
    expect(renderRoleContext(result)).toContain('在途任务仍锁定 1.2.0');
    expect(result.locked?.version).toBe('1.2.0');
  });
  it('detects actual local byte tampering despite a matching lock', async () => {
    const f = await fixture();
    await writeFile(f.path, 'forged bytes');
    expect(await f.diagnose()).toMatchObject({
      local: {
        status: 'MISMATCH',
        issues: [{ path: 'skills/implement/SKILL.md', reason: 'RESOURCE_BYTES_MISMATCH' }],
      },
    });
  });
  it.each(['version', 'roleKey', 'packageDigest'] as const)(
    'requires exact installed %s',
    async (field) => {
      const f = await fixture();
      f.lock.packageLocks[0][field] = field === 'version' ? '1.1.0' : 'other';
      await writeFile(join(f.workspaceDir, '.workmesh', 'lock.json'), JSON.stringify(f.lock));
      expect((await f.diagnose()).local).toMatchObject({
        status: 'MISMATCH',
        issues: [{ reason: 'EXACT_TASK_LOCK_NOT_INSTALLED' }],
      });
    },
  );
  it('keeps missing and corrupt local reports uncertain, never MATCH', async () => {
    const f = await fixture();
    const empty = await mkdtemp(join(tmpdir(), 'wm-no-role-lock-'));
    expect(
      (await diagnoseRoleContext({ workspaceDir: empty, status: f.status })).local.status,
    ).toBe('MISSING');
    await writeFile(join(f.workspaceDir, '.workmesh', 'lock.json'), 'not JSON');
    expect((await f.diagnose()).local.status).toBe('UNREADABLE');
  });
  it('does not treat absent old-server metadata or unavailable task locks as installation matches', async () => {
    const f = await fixture();
    delete f.status.rolePackage;
    expect(await f.diagnose()).toMatchObject({
      metadata: 'UNAVAILABLE',
      local: { status: 'UNAVAILABLE' },
      notices: [],
    });
    expect(renderRoleContext(await f.diagnose())).toContain('不能确认本地安装匹配');
  });
  it('distinguishes unavailable package metadata from an explicitly unconfigured role', async () => {
    const f = await fixture();
    f.status.rolePackage!.status = 'UNAVAILABLE';
    f.status.rolePackage!.locked = null;
    expect(await f.diagnose()).toMatchObject({
      metadata: 'UNAVAILABLE',
      local: { status: 'UNAVAILABLE' },
    });
    f.status.rolePackage!.status = 'NOT_CONFIGURED';
    expect(await f.diagnose()).toMatchObject({
      metadata: 'NOT_CONFIGURED',
      local: { status: 'UNAVAILABLE' },
    });
  });
  it('accepts safe unicode and space-containing resource paths', async () => {
    const f = await fixture();
    const path = '角色说明/实现 SOP.md';
    const installed = join(
      f.workspaceDir,
      '.workmesh',
      'packages',
      'workmesh.role.backend',
      '1.2.0',
      path,
    );
    await mkdir(dirname(installed), { recursive: true });
    await writeFile(installed, f.bytes);
    f.status.rolePackage!.locked!.resources[0].path = path;
    expect((await f.diagnose()).local.status).toBe('MATCH');
  });
  it('emits ROLE_PACKAGE_UPDATED only for exact task role resource changes and lists changed files', async () => {
    const f = await fixture();
    f.status.rolePackage!.comparison = {
      status: 'CHANGED',
      changes: [
        {
          refId: 'role:sop',
          path: 'skills/implement/SKILL.md',
          status: 'CHANGED',
          previousSha256: 'c'.repeat(64),
          currentSha256: f.status.rolePackage!.locked!.resources[0].sha256,
        },
        {
          refId: 'role:old',
          path: 'old.md',
          status: 'REMOVED',
          previousSha256: 'd'.repeat(64),
          currentSha256: null,
        },
      ],
    };
    const result = await f.diagnose();
    expect(result.notices).toContain('ROLE_PACKAGE_UPDATED');
    expect(renderRoleContext(result)).toContain('CHANGED skills/implement/SKILL.md');
    expect(renderRoleContext(result)).toContain('REMOVED old.md');
  });
  it('rejects traversal and absolute paths before reading local resource bytes', async () => {
    const f = await fixture();
    for (const path of ['../../secret.txt', 'C:/secret.txt', '/secret.txt', 'safe\\secret.txt']) {
      f.status.rolePackage!.locked!.resources[0].path = path;
      expect((await f.diagnose()).local).toMatchObject({
        status: 'MISMATCH',
        issues: [{ path, reason: 'UNSAFE_OR_DUPLICATE_RESOURCE_PATH' }],
      });
    }
  });
  it('refuses a symlinked ancestor instead of treating linked bytes as the installed version', async () => {
    const f = await fixture();
    const external = await mkdtemp(join(tmpdir(), 'wm-role-external-'));
    const root = join(f.workspaceDir, '.workmesh', 'packages', 'workmesh.role.backend', '1.2.0');
    await symlink(external, join(root, 'linked'), 'junction');
    await writeFile(join(external, 'SKILL.md'), f.bytes);
    f.status.rolePackage!.locked!.resources[0].path = 'linked/SKILL.md';
    expect((await f.diagnose()).local).toMatchObject({
      status: 'MISMATCH',
      issues: [{ reason: 'RESOURCE_UNREADABLE' }],
    });
  });
  it('never borrows a current task lock to diagnose a historical snapshot', async () => {
    const f = await fixture();
    expect(
      await diagnoseRoleContext({
        workspaceDir: f.workspaceDir,
        status: f.status,
        snapshotRevisionId: 'wf-historical',
      }),
    ).toMatchObject({
      scope: 'SNAPSHOT',
      metadata: 'NOT_COMPARED',
      workflowDefinitionRevisionId: 'wf-historical',
      locked: null,
      latestAvailable: null,
      local: { status: 'NOT_COMPARED' },
      notices: [],
    });
  });
});
