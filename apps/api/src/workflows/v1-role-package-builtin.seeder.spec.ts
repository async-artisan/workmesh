import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { BUILTIN_ROLE_PACKAGES } from '@workmesh/role-packages';
import { PrismaService } from '../prisma/prisma.service';
import { seedBuiltinRolePackages } from './v1-role-package-builtin.seeder';

type VersionRow = {
  id: string;
  packageId: string;
  version: string;
  manifestDigest: string;
  roleKey: string;
};
type ResourceRow = { rolePackageVersionId: string; resourceKey: string; bodyBytes: Buffer };

/** 只实现 seeder 用到的操作；不引入真实 Prisma。 */
function fakePrisma() {
  const versions: VersionRow[] = [];
  const resources: ResourceRow[] = [];
  let sequence = 0;

  const prisma = {
    versions,
    resources,
    async $transaction<T>(run: (client: unknown) => Promise<T>): Promise<T> {
      const client = {
        // 咨询锁用 executeRaw：pg_advisory_xact_lock 返回 void，queryRaw 无法反序列化。
        async $executeRaw() {
          return 1;
        },
        rolePackageVersion: {
          findFirst: async (input: { where: { packageId: string; version: string } }) => {
            return (
              versions.find(
                (row) =>
                  row.packageId === input.where.packageId && row.version === input.where.version,
              ) ?? null
            );
          },
          create: async (input: {
            data: { packageId: string; version: string; manifestDigest: string; roleKey: string };
          }) => {
            sequence += 1;
            const row: VersionRow = { id: `pv-${sequence}`, ...input.data };
            versions.push(row);
            return { id: row.id };
          },
        },
        rolePackageResource: {
          createMany: async (input: { data: ResourceRow[]; skipDuplicates?: boolean }) => {
            for (const row of input.data) {
              const exists = resources.some(
                (item) =>
                  item.rolePackageVersionId === row.rolePackageVersionId &&
                  item.resourceKey === row.resourceKey,
              );
              if (exists && input.skipDuplicates) continue;
              if (exists) throw new Error('duplicate resource');
              resources.push(row);
            }
          },
        },
      };
      return run(client);
    },
  };
  return { prisma: prisma as unknown as PrismaService, versions, resources };
}

describe('内置角色包播种', () => {
  it('首次播种写入每个角色的版本与资源，摘要为 canonical JSON 摘要', async () => {
    const { prisma, versions, resources } = fakePrisma();
    const result = await seedBuiltinRolePackages(prisma);

    expect(result.created).toBe(BUILTIN_ROLE_PACKAGES.length);
    expect(result.existing).toBe(0);
    expect(versions).toHaveLength(BUILTIN_ROLE_PACKAGES.length);
    const expectedResources = BUILTIN_ROLE_PACKAGES.reduce(
      (sum, entry) => sum + entry.resources.length,
      0,
    );
    expect(resources).toHaveLength(expectedResources);

    for (const entry of BUILTIN_ROLE_PACKAGES) {
      const row = versions.find((item) => item.packageId === entry.packageId);
      expect(row).toBeDefined();
      const expected = await sha256Bytes(
        new TextEncoder().encode(
          canonicalJson(entry.manifest as unknown as Record<string, unknown>),
        ),
      );
      expect(row?.manifestDigest).toBe(expected);
      expect(row?.roleKey).toBe(entry.roleKey);
    }
    // 资源字节必须是可解码的真实 markdown，而不是占位符。
    const markdown = resources.filter((item) =>
      item.bodyBytes.toString('utf8').trimStart().startsWith('#'),
    );
    expect(markdown.length).toBeGreaterThan(0);
    expect(markdown.some((item) => item.bodyBytes.byteLength > 200)).toBe(true);
  });

  it('重复播种保持不变：不新增版本、不重复插入资源', async () => {
    const { prisma, versions, resources } = fakePrisma();
    await seedBuiltinRolePackages(prisma);
    const firstVersions = versions.length;
    const firstResources = resources.length;

    const second = await seedBuiltinRolePackages(prisma);
    expect(second.created).toBe(0);
    expect(second.existing).toBe(BUILTIN_ROLE_PACKAGES.length);
    expect(versions).toHaveLength(firstVersions);
    expect(resources).toHaveLength(firstResources);
  });

  it('已存在版本但资源缺失时补齐，而不是新建版本', async () => {
    const { prisma, versions, resources } = fakePrisma();
    await seedBuiltinRolePackages(prisma);
    resources.length = 0; // 模拟历史上只写了版本行、资源没落库

    const result = await seedBuiltinRolePackages(prisma);
    expect(result.created).toBe(0);
    expect(versions).toHaveLength(BUILTIN_ROLE_PACKAGES.length);
    const expectedResources = BUILTIN_ROLE_PACKAGES.reduce(
      (sum, entry) => sum + entry.resources.length,
      0,
    );
    expect(resources).toHaveLength(expectedResources);
  });

  it('同版本内容变化但摘要不同时拒绝覆盖，提示提升 SemVer', async () => {
    const { prisma, versions } = fakePrisma();
    await seedBuiltinRolePackages(prisma);
    versions[0]!.manifestDigest = 'f'.repeat(64);

    await expect(seedBuiltinRolePackages(prisma)).rejects.toThrow(/版本号未提升/);
  });
});
