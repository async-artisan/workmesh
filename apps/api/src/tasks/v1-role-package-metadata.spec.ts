import { describe, expect, it, vi } from 'vitest';
import { V1SnapshotPrismaRepository } from './v1-snapshot.prisma-repository';
import type { PrismaService } from '../prisma/prisma.service';

const digest = 'a'.repeat(64);
const input = { projectId: 'project-1', roleKey: 'backend', revisionId: 'revision-1' };
function setup() {
  const lock = {
    roleKey: 'backend',
    packageId: 'workmesh.role.backend',
    version: '1.2.0',
    packageDigest: digest,
  };
  const versions = [
    {
      id: 'builtin',
      projectId: null,
      packageId: lock.packageId,
      version: '1.2.0',
      manifestDigest: digest,
    },
    {
      id: 'new-project',
      projectId: 'project-1',
      packageId: lock.packageId,
      version: '1.10.0',
      manifestDigest: 'b'.repeat(64),
    },
    {
      id: 'new-builtin',
      projectId: null,
      packageId: lock.packageId,
      version: '1.10.0',
      manifestDigest: 'c'.repeat(64),
    },
    {
      id: 'invalid',
      projectId: null,
      packageId: lock.packageId,
      version: 'latest',
      manifestDigest: 'd'.repeat(64),
    },
    {
      id: 'prerelease',
      projectId: null,
      packageId: lock.packageId,
      version: '1.10.0-rc.1',
      manifestDigest: 'e'.repeat(64),
    },
  ];
  const revision = { projectId: 'project-1', compiledRules: { packageLocks: [lock] } };
  const prisma = {
    workflowRevision: { findUnique: vi.fn(async () => revision) },
    rolePackageVersion: { findMany: vi.fn(async () => versions) },
    rolePackageResource: {
      findMany: vi.fn(async () => [
        { resourceKey: 'sop', path: 'skills/implement/SKILL.md', sha256: digest, byteLength: 10 },
      ]),
    },
  };
  return {
    lock,
    versions,
    revision,
    prisma,
    repository: new V1SnapshotPrismaRepository(prisma as unknown as PrismaService),
  };
}
describe('snapshot role package read metadata', () => {
  it('keeps exact workflow lock and selects strict SemVer latest within accessible same package and role', async () => {
    const f = setup();
    expect(await f.repository.inspectRolePackage(input)).toEqual({
      workflowDefinitionRevisionId: 'revision-1',
      roleKey: 'backend',
      status: 'LOCKED',
      locked: {
        packageId: 'workmesh.role.backend',
        version: '1.2.0',
        packageDigest: digest,
        source: 'BUILTIN',
        resources: [
          { refId: 'role:sop', path: 'skills/implement/SKILL.md', sha256: digest, byteLength: 10 },
        ],
      },
      latestAvailable: {
        packageId: 'workmesh.role.backend',
        version: '1.10.0',
        packageDigest: 'b'.repeat(64),
        source: 'PROJECT',
      },
    });
    expect(f.prisma.rolePackageVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          packageId: 'workmesh.role.backend',
          roleKey: 'backend',
          OR: [{ projectId: 'project-1' }, { projectId: null }],
        },
      }),
    );
    expect(f.prisma.rolePackageResource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { rolePackageVersionId: 'builtin' } }),
    );
    expect(f.lock.version).toBe('1.2.0');
  });
  it('does not accept another digest at the locked version as matching', async () => {
    const f = setup();
    f.versions[0].manifestDigest = 'f'.repeat(64);
    expect(await f.repository.inspectRolePackage(input)).toMatchObject({
      status: 'UNAVAILABLE',
      locked: null,
    });
    expect(f.prisma.rolePackageResource.findMany).not.toHaveBeenCalled();
  });
  it('does not invent an exact lock digest for legacy incomplete compiled rules', async () => {
    const f = setup();
    delete (f.lock as Partial<typeof f.lock>).packageDigest;
    expect(await f.repository.inspectRolePackage(input)).toMatchObject({
      status: 'UNAVAILABLE',
      locked: null,
    });
  });
  it('distinguishes an unconfigured role from an unavailable package', async () => {
    const f = setup();
    f.revision.compiledRules.packageLocks = [];
    expect(await f.repository.inspectRolePackage(input)).toMatchObject({
      status: 'NOT_CONFIGURED',
      locked: null,
      latestAvailable: null,
    });
    expect(f.prisma.rolePackageVersion.findMany).not.toHaveBeenCalled();
  });
  it('does not leak version metadata for a foreign workflow revision', async () => {
    const f = setup();
    f.revision.projectId = 'another-project';
    expect(await f.repository.inspectRolePackage(input)).toMatchObject({
      status: 'UNAVAILABLE',
      latestAvailable: null,
    });
    expect(f.prisma.rolePackageVersion.findMany).not.toHaveBeenCalled();
  });
});
