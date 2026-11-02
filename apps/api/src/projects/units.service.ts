import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateUnitDependencyDto, CreateUnitDto, UpdateUnitDto } from './dto';

/**
 * 工作单元与依赖图。
 *
 * 规则：
 * - `key` 创建后不可变，依赖与任务绑定都以它为准。
 * - 依赖边只接受 `DECLARED` / `INFERRED` / `RUNTIME` 三种来源；`DECLARED` 优先。
 * - 删除依赖是硬删除；删除单元不做（先标记 `DEPRECATED`）。
 */
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  private async membership(projectId: string, userId: string, write: boolean): Promise<void> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member || member.revokedAt)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'PROJECT_NOT_FOUND',
        undefined,
        404,
      );
    if (write && member.role === 'MEMBER')
      throw new WorkmeshError(V1_ERROR_CODES.FORBIDDEN, 'FORBIDDEN', undefined, 403);
  }

  private async unit(projectId: string, unitId: string) {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, projectId } });
    if (!unit)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'UNIT_NOT_FOUND', { unitId }, 404);
    return unit;
  }

  async list(projectId: string, userId: string) {
    await this.membership(projectId, userId, false);
    return this.prisma.unit.findMany({ where: { projectId }, orderBy: { key: 'asc' } });
  }

  async create(projectId: string, userId: string, input: CreateUnitDto) {
    await this.membership(projectId, userId, true);
    if (input.repositoryId) {
      const repository = await this.prisma.projectRepository.findFirst({
        where: { id: input.repositoryId, projectId, archivedAt: null },
        select: { id: true },
      });
      if (!repository)
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'REPOSITORY_NOT_FOUND',
          { repositoryId: input.repositoryId },
          422,
        );
    }
    try {
      return await this.prisma.unit.create({
        data: {
          projectId,
          key: input.key,
          name: input.name,
          kind: input.kind ?? 'SERVICE',
          repositoryId: input.repositoryId ?? null,
          repoPath: input.repoPath ?? null,
          ownerUserId: input.ownerUserId ?? null,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'UNIT_EXISTS',
          { key: input.key },
          409,
        );
      throw error;
    }
  }

  async update(projectId: string, userId: string, unitId: string, input: UpdateUnitDto) {
    await this.membership(projectId, userId, true);
    await this.unit(projectId, unitId);
    return this.prisma.unit.update({
      where: { id: unitId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.repoPath !== undefined ? { repoPath: input.repoPath } : {}),
        ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      },
    });
  }

  async listDependencies(projectId: string, userId: string) {
    await this.membership(projectId, userId, false);
    return this.prisma.unitDependency.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUnit: { select: { key: true, name: true } },
        toUnit: { select: { key: true, name: true } },
      },
    });
  }

  async createDependency(projectId: string, userId: string, input: CreateUnitDependencyDto) {
    await this.membership(projectId, userId, true);
    if (input.fromUnitId === input.toUnitId)
      throw new WorkmeshError(V1_ERROR_CODES.VALIDATION_FAILED, 'SELF_DEPENDENCY', undefined, 422);
    await this.unit(projectId, input.fromUnitId);
    await this.unit(projectId, input.toUnitId);
    try {
      return await this.prisma.unitDependency.create({
        data: {
          projectId,
          fromUnitId: input.fromUnitId,
          toUnitId: input.toUnitId,
          edgeKind: input.edgeKind,
          protocol: input.protocol ?? null,
          contractDocumentId: input.contractDocumentId ?? null,
          source: input.source ?? 'DECLARED',
          confidence: input.confidence ?? 'MEDIUM',
          evidence: input.evidence ?? null,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'DEPENDENCY_EXISTS',
          { fromUnitId: input.fromUnitId, toUnitId: input.toUnitId },
          409,
        );
      throw error;
    }
  }

  async deleteDependency(projectId: string, userId: string, dependencyId: string) {
    await this.membership(projectId, userId, true);
    const deleted = await this.prisma.unitDependency.deleteMany({
      where: { id: dependencyId, projectId },
    });
    if (deleted.count === 0)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'DEPENDENCY_NOT_FOUND',
        { dependencyId },
        404,
      );
    return { deleted: true };
  }
}
