import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ChangeAffected,
  CreateChangeRequestDto,
  DecideChangeRequestDto,
  FreezeMode,
  UpdateChangePolicyDto,
} from './change-requests.dto';

const LEVEL_BY_AFFECTED: Record<ChangeAffected, string> = {
  COPY: 'L0',
  SCOPE: 'L1',
  ACCEPTANCE: 'L1',
  CONTRACT: 'L2',
  GOAL: 'L3',
};

const LEVEL_RANK: Record<string, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };

/** 分级到处理时限（小时）：越靠近需求目标，越急。 */
const SLA_HOURS: Record<string, number> = { L0: 168, L1: 72, L2: 48, L3: 24 };

const DEFAULT_LEVELS: Record<string, string[]> = {
  L0: ['product'],
  L1: ['product', 'qa'],
  L2: ['product', 'engineering-lead'],
  L3: ['owner'],
};

export type ChangePolicyView = { freezeMode: FreezeMode; levels: Record<string, string[]> };

export type ChangeRequestView = {
  id: string;
  projectId: string;
  requirementId: string;
  level: string;
  diff: unknown;
  reason: string;
  decision: string;
  impactPreview: unknown;
  proposedById: string;
  decidedById: string | null;
  decidedAt: Date | null;
  appliedAt: Date | null;
  createdAt: Date;
};

/**
 * 变更请求：需求变更的唯一入口。
 *
 * - 等级由受影响面取最大值：COPY→L0，SCOPE/ACCEPTANCE→L1，CONTRACT→L2，GOAL→L3。
 * - 需求处于冻结期（`Requirement.frozenAt`）时，非 L3 变更落为 `DEFERRED`。
 * - 通过后生成 `ChangeEvent` 与收件人；只失效受影响范围，不做全量失效。
 */
@Injectable()
export class ChangeRequestsService {
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

  private async requirement(projectId: string, requirementId: string) {
    const requirement = await this.prisma.requirement.findFirst({
      where: { id: requirementId, projectId },
      select: { id: true, frozenAt: true },
    });
    if (!requirement)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'REQUIREMENT_NOT_FOUND',
        { requirementId },
        404,
      );
    return requirement;
  }

  static levelOf(affected: ChangeAffected[]): string {
    return affected.reduce((level, item) => {
      const next = LEVEL_BY_AFFECTED[item];
      return LEVEL_RANK[next] > LEVEL_RANK[level] ? next : level;
    }, 'L0');
  }

  private async freezeModeOf(projectId: string): Promise<FreezeMode> {
    const row = await this.prisma.projectChangePolicy.findFirst({
      where: { projectId, level: 'FREEZE' },
    });
    const mode = (row?.slots as { mode?: unknown } | null)?.mode;
    return mode === 'WARN' || mode === 'ALLOW' ? mode : 'BLOCK';
  }

  private async readPolicy(projectId: string): Promise<ChangePolicyView> {
    const rows = await this.prisma.projectChangePolicy.findMany({ where: { projectId } });
    if (rows.length === 0) return { freezeMode: 'BLOCK', levels: DEFAULT_LEVELS };
    const freeze = rows.find((row) => row.level === 'FREEZE');
    const levels: Record<string, string[]> = {};
    for (const row of rows) {
      if (row.level === 'FREEZE') continue;
      levels[row.level] = Array.isArray(row.slots) ? (row.slots as string[]) : [];
    }
    const mode = (freeze?.slots as { mode?: unknown } | null)?.mode;
    return {
      freezeMode: mode === 'WARN' || mode === 'ALLOW' ? mode : 'BLOCK',
      levels: Object.keys(levels).length > 0 ? levels : DEFAULT_LEVELS,
    };
  }

  async getPolicy(projectId: string, userId: string): Promise<ChangePolicyView> {
    await this.membership(projectId, userId, false);
    return this.readPolicy(projectId);
  }

  async updatePolicy(
    projectId: string,
    userId: string,
    input: UpdateChangePolicyDto,
  ): Promise<ChangePolicyView> {
    await this.membership(projectId, userId, true);
    const levels = input.levels ?? {};
    for (const [level, reviewers] of Object.entries(levels)) {
      if (!['L0', 'L1', 'L2', 'L3'].includes(level))
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'INVALID_CHANGE_LEVEL',
          { level },
          422,
        );
      if (!Array.isArray(reviewers) || reviewers.some((item) => typeof item !== 'string'))
        throw new WorkmeshError(
          V1_ERROR_CODES.VALIDATION_FAILED,
          'INVALID_CHANGE_POLICY',
          { level },
          422,
        );
    }
    await this.prisma.$transaction([
      this.prisma.projectChangePolicy.deleteMany({ where: { projectId } }),
      this.prisma.projectChangePolicy.createMany({
        data: [
          ...Object.entries(levels).map(([level, reviewers]) => ({
            projectId,
            level,
            slots: reviewers,
            version: 1,
          })),
          { projectId, level: 'FREEZE', slots: { mode: input.freezeMode }, version: 1 },
        ],
      }),
    ]);
    return this.readPolicy(projectId);
  }

  async create(projectId: string, userId: string, input: CreateChangeRequestDto) {
    await this.membership(projectId, userId, false);
    const requirement = await this.requirement(projectId, input.requirementId);
    const level = ChangeRequestsService.levelOf(input.affected);
    const acceptanceKeys = input.acceptanceKeys ?? [];
    const taskCount = acceptanceKeys.length
      ? await this.prisma.task.count({
          where: { projectId, acceptanceKeys: { hasSome: acceptanceKeys } },
        })
      : 0;
    const frozen = Boolean(requirement.frozenAt);
    const freezeMode = await this.freezeModeOf(projectId);
    const deferred = frozen && level !== 'L3' && freezeMode === 'BLOCK';

    return this.prisma.changeRequest.create({
      data: {
        projectId,
        requirementId: input.requirementId,
        level,
        diff: { affected: input.affected, acceptanceKeys },
        reason: input.reason,
        proposedById: userId,
        impactPreview: {
          level,
          acceptanceKeys,
          taskCount,
          frozen,
          freezeMode,
          warning: frozen && freezeMode === 'WARN',
        },
        decision: deferred ? 'DEFERRED' : 'PENDING',
      },
    });
  }

  async list(projectId: string, userId: string, requirementId?: string) {
    await this.membership(projectId, userId, false);
    return this.prisma.changeRequest.findMany({
      where: { projectId, ...(requirementId ? { requirementId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async get(projectId: string, userId: string, changeId: string) {
    await this.membership(projectId, userId, false);
    const change = await this.prisma.changeRequest.findFirst({
      where: { id: changeId, projectId },
    });
    if (!change)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'CHANGE_REQUEST_NOT_FOUND',
        { changeId },
        404,
      );
    return change;
  }

  async decide(projectId: string, userId: string, changeId: string, input: DecideChangeRequestDto) {
    await this.membership(projectId, userId, true);
    const change = await this.get(projectId, userId, changeId);
    if (change.decision === 'ACCEPTED' || change.decision === 'REJECTED')
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_CONFLICT,
        'CHANGE_ALREADY_DECIDED',
        { decision: change.decision },
        409,
      );

    const now = new Date();
    const decided = await this.prisma.changeRequest.update({
      where: { id: changeId },
      data: {
        decision: input.decision,
        decidedById: userId,
        decidedAt: now,
        ...(input.decision === 'ACCEPTED' ? { appliedAt: now } : {}),
      },
    });

    if (input.decision === 'ACCEPTED') {
      const acceptanceKeys = Array.isArray(
        (change.diff as { acceptanceKeys?: string[] }).acceptanceKeys,
      )
        ? (change.diff as { acceptanceKeys: string[] }).acceptanceKeys
        : [];
      const event = await this.prisma.changeEvent.create({
        data: {
          projectId,
          requirementId: change.requirementId,
          sourceKind: 'CHANGE_REQUEST',
          sourceId: changeId,
          changedFields: [
            `level:${change.level}`,
            ...acceptanceKeys.map((key) => `acceptance:${key}`),
          ],
          targets: {
            requirementId: change.requirementId,
            acceptanceKeys,
            changeRequestId: changeId,
          },
        },
      });
      const members = await this.prisma.projectMember.findMany({
        where: { projectId, revokedAt: null },
        select: { userId: true },
      });
      const dueAt = new Date(now.getTime() + (SLA_HOURS[change.level] ?? 72) * 3600 * 1000);
      if (members.length > 0)
        await this.prisma.changeRecipient.createMany({
          data: members.map((member) => ({
            projectId,
            eventId: event.id,
            userId: member.userId,
            action: 'ACK_ONLY',
            dueAt,
          })),
        });
    }

    return decided;
  }
}
