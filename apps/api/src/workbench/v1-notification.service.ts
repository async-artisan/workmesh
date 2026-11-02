import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';
import { V1EmailService } from './v1-email.service';
import { V1WorkbenchService } from './v1-workbench.service';

/** 邮件摘要：把当前用户的工作台待办整理成一封纯文本邮件。 */
@Injectable()
export class V1NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workbench: V1WorkbenchService,
    private readonly email: V1EmailService,
  ) {}

  async sendEmailDigest(principal: Principal) {
    if (principal.kind !== 'HUMAN')
      throw new WorkmeshError(
        V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
        'HUMAN_SESSION_REQUIRED',
        undefined,
        403,
      );

    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { email: true },
    });
    if (!user)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'USER_NOT_FOUND',
        { userId: principal.userId },
        404,
      );

    const snapshot = await this.workbench.get(principal, null);
    const signOffs = snapshot.reviews.filter(
      (review) => review.kind === 'TASK_ACCEPTANCE' || review.kind === 'RELEASE_ACCEPTANCE',
    );
    const approvals = snapshot.reviews.filter(
      (review) => review.kind !== 'TASK_ACCEPTANCE' && review.kind !== 'RELEASE_ACCEPTANCE',
    );

    const lines: string[] = [
      `待签字：${signOffs.length} 件`,
      `待审批：${approvals.length} 件`,
      `待确认变更：${snapshot.counts.changes} 件`,
      `可开工：${snapshot.counts.readyTasks} 件`,
      '',
    ];

    if (snapshot.reviews.length > 0) {
      lines.push('评审：');
      for (const review of snapshot.reviews.slice(0, 8)) {
        const label = review.requirement
          ? `${review.requirement.code} ${review.requirement.title}`
          : review.subjectLabel;
        lines.push(`- ${label} · ${review.kind} · v${review.version}`);
      }
      lines.push('');
    }
    if (snapshot.changes.length > 0) {
      lines.push('变更：');
      for (const change of snapshot.changes.slice(0, 8)) {
        const label = change.requirement
          ? `${change.requirement.code} ${change.requirement.title}`
          : change.eventId;
        lines.push(
          `- ${label} · ${change.changedFields.join(' / ') || '未标注字段'} · v${change.version}`,
        );
      }
      lines.push('');
    }
    lines.push('请到 WorkMesh 工作台处理。');

    await this.email.send(
      user.email,
      `[WorkMesh] 待办 ${snapshot.counts.total} 件`,
      lines.join('\n'),
    );
    return {
      sent: true,
      to: user.email,
      counts: snapshot.counts,
    };
  }
}
