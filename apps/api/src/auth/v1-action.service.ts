import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, type ActionBinding, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from './v1-authorization';
import { requireHuman, V1AccountService } from './v1-account.service';
import { sessionIdOf } from './v1-cli-authorization.service';
import {
  CONFIRMATION_TTL_MS,
  V1_CONFIRMATION_REPOSITORY,
  V1ConfirmationService,
  actionDigestOf,
  hashTicketSecret,
  newTicketSecret,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from './v1-confirmation';

export type V1PreviewResult = {
  binding: ActionBinding;
  actionDigest: string;
  display: {
    action: string;
    targetType: string;
    targetId: string;
    expectedVersion: number;
    projectId: string | null;
    roleSlot: ActionBinding['roleSlot'];
  };
};

@Injectable()
export class V1ActionService {
  constructor(
    @Inject(V1_CONFIRMATION_REPOSITORY) private readonly repository: V1ConfirmationRepository,
    @Inject(V1ConfirmationService) private readonly confirmation: V1ConfirmationService,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1AccountService) private readonly accounts: V1AccountService,
  ) {}

  async preview(principal: Principal, binding: ActionBinding): Promise<V1PreviewResult> {
    requireHuman(principal);
    if (binding.projectId) await this.authorization.resolveProjectContext(principal, binding.projectId);
    const normalized = this.confirmation.normalize(binding);
    return {
      binding: normalized,
      actionDigest: actionDigestOf(normalized),
      display: {
        action: normalized.action,
        targetType: normalized.targetType,
        targetId: normalized.targetId,
        expectedVersion: normalized.expectedVersion,
        projectId: normalized.projectId,
        roleSlot: normalized.roleSlot,
      },
    };
  }

  /**
   * 密码二验后签发 5 分钟单次票据。客户端提交的 actionDigest 必须与服务端重新计算的摘要一致。
   */
  async issueTicket(input: {
    principal: Principal;
    binding: ActionBinding;
    actionDigest: string;
    password: string;
    now?: Date;
  }): Promise<{ ticketId: string; ticketSecret: string; expiresAt: Date; actionDigest: string }> {
    const principal = requireHuman(input.principal);
    const sessionId = sessionIdOf(principal);
    const now = input.now ?? new Date();
    const user = await this.accounts.reauthenticate({
      sessionId,
      userId: principal.userId,
      password: input.password,
      now,
    });
    if (!user.isActive) throw new WorkmeshError(V1_ERROR_CODES.AUTH_INVALID, '账号已停用', undefined, 401);
    const normalized = this.confirmation.normalize(input.binding);
    const digest = actionDigestOf(normalized);
    if (digest !== input.actionDigest)
      throw new WorkmeshError(V1_ERROR_CODES.ACTION_CHANGED, '动作内容已变更，请重新预览', { actionDigest: digest }, 409);
    if (normalized.projectId) await this.authorization.resolveProjectContext(principal, normalized.projectId);
    if (principal.kind !== 'HUMAN' || !principal.authVersion)
      throw new WorkmeshError(V1_ERROR_CODES.HUMAN_SESSION_REQUIRED, '缺少人类会话版本', undefined, 403);

    const ticketSecret = newTicketSecret();
    const ticketId = randomUUID();
    const expiresAt = new Date(now.getTime() + CONFIRMATION_TTL_MS);
    const ticket = await this.repository.createTicket({
      id: ticketId,
      secretHash: hashTicketSecret(ticketSecret),
      userId: principal.userId,
      webSessionId: sessionId,
      projectId: normalized.projectId,
      userAuthVersion: principal.authVersion,
      action: normalized.action,
      targetType: normalized.targetType,
      targetId: normalized.targetId,
      expectedVersion: normalized.expectedVersion,
      actionDigest: digest,
      roleId: normalized.roleSlot?.roleId ?? null,
      approvalSlotId: normalized.roleSlot?.approvalSlotId ?? null,
      expiresAt,
      now,
    });
    return { ticketId: ticket.id, ticketSecret, expiresAt, actionDigest: digest };
  }

  /** 供领域 handler 复核票据；消费由各领域通过公共幂等操作原子完成。 */
  async findTicket(ticketId: string): Promise<V1TicketRecord | null> {
    return this.repository.findTicket(ticketId);
  }
}
