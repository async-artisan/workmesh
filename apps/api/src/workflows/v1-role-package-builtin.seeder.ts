import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { canonicalJson, sha256Bytes } from '@workmesh/shared';
import { BUILTIN_ROLE_PACKAGES } from '@workmesh/role-packages';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';

/** 同一把咨询锁保证多实例同时启动时只有一个实例播种。 */
const SEED_LOCK_KEY = 'workmesh:builtin-role-packages';

export type V1BuiltinSeedResult = {
  created: number;
  existing: number;
  packages: Array<{ roleKey: string; packageId: string; version: string; manifestDigest: string }>;
};

/**
 * 内置角色包落库（幂等）。
 *
 * 为什么需要它：发布工作流要求每个被引用角色都有**已登记**的角色包版本，
 * 否则 `compile()` 会以 `WORKFLOW_PACKAGE_INCOMPATIBLE` 拒绝。
 * 没有内置包时，一个新项目必须先在 CLI 里逐个 `roles install` 才能发布——
 * 这就是"装完跑不起来"的最后一道门槛。
 *
 * 语义约束：
 * - `projectId = null` 表示内置，所有项目可见（`findPackageVersion` 的 `OR` 查询）。
 * - 一旦登记不可覆盖：同 packageId+version 若摘要不同，说明内容改了却没升版本，
 *   直接报错要求改 SemVer，而不是悄悄替换已锁定的字节。
 */
export async function seedBuiltinRolePackages(prisma: PrismaService): Promise<V1BuiltinSeedResult> {
  const prepared = await Promise.all(
    BUILTIN_ROLE_PACKAGES.map(async (entry) => ({
      entry,
      manifestDigest: await sha256Bytes(
        new TextEncoder().encode(
          canonicalJson(entry.manifest as unknown as Record<string, unknown>),
        ),
      ),
    })),
  );

  return prisma.$transaction(async (tx) => {
    // 咨询锁：两个实例同时启动时，第二个在锁释放后才判断"已存在"。
    // 用 $executeRaw 而不是 $queryRaw：pg_advisory_xact_lock 返回 void，
    // Prisma 无法反序列化 void 列（P2010）；executeRaw 只关心影响行数。
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${SEED_LOCK_KEY})::bigint)`,
    );

    const result: V1BuiltinSeedResult = { created: 0, existing: 0, packages: [] };

    for (const { entry, manifestDigest } of prepared) {
      const existing = await tx.rolePackageVersion.findFirst({
        where: { projectId: null, packageId: entry.packageId, version: entry.version },
        select: { id: true, manifestDigest: true },
      });

      if (existing) {
        if (existing.manifestDigest !== manifestDigest)
          throw new Error(
            `内置角色包 ${entry.packageId}@${entry.version} 内容发生变化但版本号未提升；请提升 SemVer 后重新登记。`,
          );
        await tx.rolePackageResource.createMany({
          data: entry.resources.map((resource) => ({
            rolePackageVersionId: existing.id,
            resourceKey: resource.resourceId,
            path: resource.path,
            mediaType: resource.mediaType,
            byteLength: resource.byteLength,
            sha256: resource.sha256,
            bodyBytes: Buffer.from(resource.bodyBase64, 'base64'),
          })),
          skipDuplicates: true,
        });
        result.existing += 1;
        result.packages.push({
          roleKey: entry.roleKey,
          packageId: entry.packageId,
          version: entry.version,
          manifestDigest,
        });
        continue;
      }

      const created = await tx.rolePackageVersion.create({
        data: {
          projectId: null,
          packageId: entry.packageId,
          version: entry.version,
          roleKey: entry.roleKey,
          manifest: entry.manifest as unknown as Prisma.InputJsonValue,
          manifestDigest,
          sourceRef: `builtin:${entry.resources[0]?.path ?? entry.packageId}`,
        },
        select: { id: true },
      });
      await tx.rolePackageResource.createMany({
        data: entry.resources.map((resource) => ({
          rolePackageVersionId: created.id,
          resourceKey: resource.resourceId,
          path: resource.path,
          mediaType: resource.mediaType,
          byteLength: resource.byteLength,
          sha256: resource.sha256,
          bodyBytes: Buffer.from(resource.bodyBase64, 'base64'),
        })),
      });
      result.created += 1;
      result.packages.push({
        roleKey: entry.roleKey,
        packageId: entry.packageId,
        version: entry.version,
        manifestDigest,
      });
    }

    return result;
  });
}

/**
 * 启动时播种。默认开启；显式设置 `WORKMESH_SEED_BUILTIN_ROLE_PACKAGES=false` 可关闭
 * （例如只想跑迁移与健康检查的环境）。
 */
@Injectable()
export class V1BuiltinRolePackageSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(V1BuiltinRolePackageSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.WORKMESH_SEED_BUILTIN_ROLE_PACKAGES === 'false') return;
    // 与 PrismaService 的显式连接条件一致：没有配置数据库时不触碰连接，
    // 否则"只跑健康检查/单元测试"的环境会因为播种失败而起不来。
    if (!process.env.WORKMESH_V1_DATABASE_URL) return;
    const result = await seedBuiltinRolePackages(this.prisma);
    this.logger.log(
      `内置角色包已就绪：新增 ${result.created}，已存在 ${result.existing}（${result.packages.length} 个角色）`,
    );
  }
}
