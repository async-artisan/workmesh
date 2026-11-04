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

  /**
   * 该等级要求哪些审批身份。`levels` 里的值是 `ProjectRole.key`；`owner` 指项目 OWNER 成员角色。
   * 返回 null 表示该等级没有配置审批人：此时不额外限制，避免把「未配置」当成「谁都禁止」。
   */
  private async requiredApproverKeys(projectId: string, level: string): Promise<string[] | null> {
    const policy = await this.readPolicy(projectId);
    const keys = policy.levels[level];
    return Array.isArray(keys) && keys.length > 0 ? keys : null;
  }

  /**
   * 分级审批人校验。
   *
   * 原先 `decide` 只校验「OWNER/ADMIN 可决定」，`ProjectChangePolicy.levels` 被读出来却从不参与判定，
   * 于是「L3 需 owner、L2 需 engineering-lead」只是文档承诺：任何 ADMIN 都能批 L3，
   * 配置了 reviewer 却没有强制力。这里按等级解析审批身份并实际校验。
   *
   * 项目 OWNER 是最高权威，任何等级都可决定（否则一旦配错 levels 项目就再也改不动需求）；
   * 其余人必须持有该等级配置的某个活动业务角色。
   */
  private async assertDeciderEligible(
    projectId: string,
    userId: string,
    level: string,
  ): Promise<void> {
    const required = await this.requiredApproverKeys(projectId, level);
    if (required === null) return;

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    if (member?.role === 'OWNER') return;

    const assignments = await this.prisma.projectRoleAssignment.findMany({
      where: { projectId, userId, revokedAt: null },
      select: { role: { select: { key: true, isActive: true } } },
    });
    const held = assignments.filter((item) => item.role?.isActive).map((item) => item.role.key);
    if (held.some((key) => required.includes(key))) return;

    throw new WorkmeshError(
      V1_ERROR_CODES.FORBIDDEN,
      'CHANGE_LEVEL_APPROVER_REQUIRED',
      { level, requiredRoleKeys: required, heldRoleKeys: held },
      403,
    );
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

    // 提案人不得决定自己的变更。自批会让分级审批退化成橡皮章，而「谁提出的、谁批准的」
    // 是本产品要留证据的核心事实。
    if (change.proposedById === userId)
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'CHANGE_SELF_DECISION_FORBIDDEN',
        { changeId, level: change.level },
        403,
      );
    // 等级审批人校验：读 Policy.levels，真正卡住「配置了却不生效」。
    await this.assertDeciderEligible(projectId, userId, change.level);

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.changeRequest.updateMany({
        where: { id: changeId, projectId, decision: { in: ['PENDING', 'DEFERRED'] } },
        data: {
          decision: input.decision,
          decidedById: userId,
          decidedAt: now,
          ...(input.decision === 'ACCEPTED' ? { appliedAt: now } : {}),
        },
      });
      if (claimed.count !== 1)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_CONFLICT,
          'CHANGE_ALREADY_DECIDED',
          { changeId },
          409,
        );

      if (input.decision === 'ACCEPTED') {
        const acceptanceKeys = Array.isArray(
          (change.diff as { acceptanceKeys?: string[] }).acceptanceKeys,
        )
          ? (change.diff as { acceptanceKeys: string[] }).acceptanceKeys
          : [];
        const event = await tx.changeEvent.create({
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
        const members = await tx.projectMember.findMany({
          where: { projectId, revokedAt: null },
          select: { userId: true },
        });
        const dueAt = new Date(now.getTime() + (SLA_HOURS[change.level] ?? 72) * 3600 * 1000);
        if (members.length > 0)
          await tx.changeRecipient.createMany({
            data: members.map((member) => ({
              projectId,
              eventId: event.id,
              userId: member.userId,
              action: 'ACK_ONLY',
              dueAt,
            })),
          });
      }

      return tx.changeRequest.findFirstOrThrow({ where: { id: changeId, projectId } });
    });
  }
}
