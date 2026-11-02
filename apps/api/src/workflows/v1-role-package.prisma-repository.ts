import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError, type RolePackageManifest } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  V1RegisterRolePackageInput,
  V1RegisterRolePackageResult,
  V1RolePackageDetail,
  V1RolePackageListItem,
  V1RolePackageRepository,
  V1RolePackageResourceView,
} from './v1-role-package.repository';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

function encodeCursor(packageId: string, version: string): string {
  return Buffer.from(JSON.stringify({ p: packageId, v: version }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | null): { packageId: string; version: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      p?: unknown;
      v?: unknown;
    };
    return typeof parsed.p === 'string' && typeof parsed.v === 'string'
      ? { packageId: parsed.p, version: parsed.v }
      : null;
  } catch {
    return null;
  }
}

@Injectable()
export class V1RolePackagePrismaRepository implements V1RolePackageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    projectId: string,
    query: { limit: number; cursor: string | null },
  ): Promise<{ items: V1RolePackageListItem[]; nextCursor: string | null }> {
    const key = decodeCursor(query.cursor);
    const rows = await this.prisma.rolePackageVersion.findMany({
      where: {
        OR: [{ projectId: null }, { projectId }],
        ...(key
          ? {
              AND: [
                {
                  OR: [
                    { packageId: { gt: key.packageId } },
                    { packageId: key.packageId, version: { gt: key.version } },
                  ],
                },
              ],
            }
          : {}),
      },
      orderBy: [{ packageId: 'asc' }, { version: 'asc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => this.toItem(row)),
      nextCursor:
        rows.length > query.limit && last ? encodeCursor(last.packageId, last.version) : null,
    };
  }

  async findVersion(
    projectId: string,
    packageId: string,
    version: string,
  ): Promise<V1RolePackageDetail | null> {
    // 项目私有包优先，其次内置包；同名内置包不会被项目包遮蔽。
    const own = await this.prisma.rolePackageVersion.findFirst({
      where: { projectId, packageId, version },
    });
    const row =
      own ??
      (await this.prisma.rolePackageVersion.findFirst({
        where: { projectId: null, packageId, version },
      }));
    if (!row) return null;
    return {
      ...this.toItem(row),
      projectId: row.projectId,
      manifest: row.manifest as unknown as RolePackageManifest,
    };
  }

  async findResource(
    packageVersionId: string,
    resourceId: string,
  ): Promise<V1RolePackageResourceView | null> {
    const row = await this.prisma.rolePackageResource.findUnique({
      where: {
        rolePackageVersionId_resourceKey: {
          rolePackageVersionId: packageVersionId,
          resourceKey: resourceId,
        },
      },
    });
    if (!row) return null;
    return {
      resourceId: row.resourceKey,
      path: row.path,
      mediaType: row.mediaType,
      byteLength: row.byteLength,
      sha256: row.sha256,
      bodyBytes: new Uint8Array(row.bodyBytes),
    };
  }

  async hasBuiltin(packageId: string): Promise<boolean> {
    const count = await this.prisma.rolePackageVersion.count({
      where: { projectId: null, packageId },
    });
    return count > 0;
  }

  async projectRoleKeys(projectId: string): Promise<string[]> {
    const rows = await this.prisma.projectRole.findMany({
      where: { projectId, isActive: true },
      select: { key: true },
    });
    return rows.map((row) => row.key);
  }

  async findProject(projectId: string): Promise<{ id: string; version: number } | null> {
    return this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, version: true },
    });
  }

  async findOperation(input: { projectScopeKey: string; principalScopeKey: string; key: string }) {
    const record = await this.prisma.idempotentOperation.findUnique({
      where: {
        projectScopeKey_principalScopeKey_key: {
          projectScopeKey: input.projectScopeKey,
          principalScopeKey: input.principalScopeKey,
          key: input.key,
        },
      },
    });
    if (!record) return null;
    return {
      id: record.id,
      projectScopeKey: record.projectScopeKey,
      principalScopeKey: record.principalScopeKey,
      key: record.key,
      method: record.method,
      route: record.route,
      requestDigest: record.requestDigest,
      resultRefs: record.resultRefs as unknown as Record<string, unknown>,
      committedAt: record.createdAt,
    };
  }

  async register(input: V1RegisterRolePackageInput): Promise<V1RegisterRolePackageResult> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runRegister(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runRegister(
    input: V1RegisterRolePackageInput,
  ): Promise<V1RegisterRolePackageResult> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`,
        );

        const project = await tx.project.findUnique({
          where: { id: input.projectId },
          select: { version: true },
        });
        if (!project)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'PROJECT_NOT_FOUND',
            { projectId: input.projectId },
            404,
          );
        if (project.version !== input.expectedProjectVersion)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'PROJECT_VERSION_CONFLICT',
            { expectedVersion: input.expectedProjectVersion, currentVersion: project.version },
            409,
          );

        // 同版本已登记：同 digest 合法重试不重复，不同 digest 拒绝覆盖。
        const existing = await tx.rolePackageVersion.findFirst({
          where: { projectId: input.projectId, packageId: input.packageId, version: input.version },
        });
        if (existing) {
          if (
            existing.manifestDigest === input.manifestDigest &&
            project.version === input.expectedProjectVersion
          )
            return {
              packageVersionId: existing.id,
              packageId: existing.packageId,
              version: existing.version,
              manifestDigest: existing.manifestDigest,
              projectVersion: project.version,
            };
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'ROLE_PACKAGE_VERSION_CONFLICT',
            { packageId: input.packageId, version: input.version },
            409,
          );
        }

        const stamp = await tx.principalStamp.create({
          data: {
            kind: 'HUMAN',
            userId: input.actorUserId,
            webSessionId: input.ticket.webSessionId,
            projectId: input.projectId,
            roleKeySnapshot: input.roleKey,
            scopeSnapshot: [],
            userAuthVersion: input.userAuthVersion,
          },
        });

        const created = await tx.rolePackageVersion.create({
          data: {
            projectId: input.projectId,
            packageId: input.packageId,
            version: input.version,
            roleKey: input.roleKey,
            manifest: input.manifest as unknown as Prisma.InputJsonValue,
            manifestDigest: input.manifestDigest,
            createdByStampId: stamp.id,
          },
        });

        await tx.rolePackageResource.createMany({
          data: input.resources.map((resource) => ({
            rolePackageVersionId: created.id,
            resourceKey: resource.resourceId,
            path: resource.path,
            mediaType: resource.mediaType,
            byteLength: resource.byteLength,
            sha256: resource.sha256,
            bodyBytes: Buffer.from(resource.bodyBytes),
          })),
        });

        const bumped = await tx.project.updateMany({
          where: { id: input.projectId, version: input.expectedProjectVersion },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.VERSION_CONFLICT,
            'PROJECT_VERSION_CONFLICT',
            { projectId: input.projectId },
            409,
          );

        const consumed = await tx.$executeRaw(
          Prisma.sql`UPDATE "workmesh_v1"."ConfirmationTicket"
            SET "consumedAt" = ${input.now}, "consumedRequestId" = ${randomUUID()}::uuid, "consumedOperationId" = ${input.operation.id}::uuid
            WHERE "id" = ${input.ticket.id}::uuid
              AND "secretHash" = ${input.ticket.secretHash}
              AND "webSessionId" = ${input.ticket.webSessionId}::uuid
              AND "consumedAt" IS NULL
              AND "invalidatedAt" IS NULL
              AND "expiresAt" > ${input.now}`,
        );
        if (consumed !== 1)
          throw new WorkmeshError(
            V1_ERROR_CODES.CONFIRMATION_USED,
            'CONFIRMATION_CONSUME_CONFLICT',
            { ticketId: input.ticket.id },
            409,
          );

        await tx.auditEvent.create({
          data: {
            projectId: input.projectId,
            action: 'ROLE_PACKAGE_PUBLISH',
            targetType: 'ROLE_PACKAGE',
            targetId: created.id,
            targetVersion: 1,
            outcome: 'SUCCESS',
            details: {
              packageId: input.packageId,
              version: input.version,
              digest: input.manifestDigest,
            },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: input.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: {
              packageVersionId: created.id,
              packageId: input.packageId,
              version: input.version,
              manifestDigest: input.manifestDigest,
              projectVersion: input.expectedProjectVersion + 1,
            },
            responseMetadata: { roleKey: input.roleKey },
          },
        });

        return {
          packageVersionId: created.id,
          packageId: input.packageId,
          version: input.version,
          manifestDigest: input.manifestDigest,
          projectVersion: input.expectedProjectVersion + 1,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private toItem(row: {
    id: string;
    projectId: string | null;
    packageId: string;
    version: string;
    roleKey: string;
    manifestDigest: string;
  }): V1RolePackageListItem {
    return {
      id: row.id,
      packageId: row.packageId,
      version: row.version,
      roleKey: row.roleKey,
      manifestDigest: row.manifestDigest,
      scope: row.projectId === null ? 'BUILTIN' : 'PROJECT',
    };
  }
}
