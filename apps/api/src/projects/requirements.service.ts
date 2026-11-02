import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateRequirementDto } from './dto';

const MAX_PAGE = 100;

@Injectable()
export class RequirementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: V1AuthorizationService,
  ) {}

  async list(principal: Principal, projectId: string, query: { limit?: number; cursor?: string | null }) {
    await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:read');

    const take = Number.isInteger(query.limit) ? Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE) : 20;
    const cursor = query.cursor ? Number(query.cursor) : null;
    if (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1))
      throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, 'REQUIREMENT_CURSOR_INVALID', { cursor: query.cursor }, 400);

    const rows = await this.prisma.requirement.findMany({
      where: { projectId, ...(cursor !== null ? { seq: { gt: cursor } } : {}) },
      orderBy: { seq: 'asc' },
      take: take + 1,
    });
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => this.viewOf(row)),
      nextCursor: hasMore ? String(page[page.length - 1].seq) : null,
    };
  }

  async create(principal: Principal, projectId: string, dto: CreateRequirementDto) {
    const context = await this.authorization.resolveProjectContext(principal, projectId);
    await this.authorization.requireScope(principal, projectId, 'requirement:propose');
    if (context.project.archivedAt)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_CONFLICT, 'PROJECT_ARCHIVED', { projectId }, 409);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUnique({ where: { id: projectId }, select: { key: true } });
      if (!project) throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'PROJECT_NOT_FOUND', { projectId }, 404);
      const max = await tx.requirement.aggregate({ where: { projectId }, _max: { seq: true } });
      const seq = (max._max.seq ?? 0) + 1;
      const row = await tx.requirement.create({
        data: {
          projectId,
          seq,
          code: `${project.key}-${String(seq).padStart(3, '0')}`,
          title: dto.title,
          description: dto.description ?? null,
        },
      });
      return this.viewOf(row);
    });
  }

  private viewOf(row: {
    id: string;
    projectId: string;
    seq: number;
    code: string;
    title: string;
    description: string | null;
    version: number;
    generation: number;
    phase: string;
    workStatus: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      projectId: row.projectId,
      seq: row.seq,
      code: row.code,
      title: row.title,
      description: row.description,
      version: row.version,
      generation: row.generation,
      phase: row.phase,
      workStatus: row.workStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
