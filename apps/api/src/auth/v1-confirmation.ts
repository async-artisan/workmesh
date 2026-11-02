import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  canonicalJson,
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Confirmation as ConfirmationRef,
} from '@workmesh/shared';

export const CONFIRMATION_SCHEMA_VERSION = 1;
export const CONFIRMATION_TTL_MS = 5 * 60 * 1000;

export type V1TicketRecord = {
  id: string;
  secretHash: string;
  userId: string;
  webSessionId: string;
  projectId: string | null;
  userAuthVersion: number;
  action: string;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  actionDigest: string;
  roleId: string | null;
  approvalSlotId: string | null;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  consumedOperationId: string | null;
  invalidatedAt: Date | null;
};

export type V1TicketCreateInput = {
  id: string;
  secretHash: string;
  userId: string;
  webSessionId: string;
  projectId: string | null;
  userAuthVersion: number;
  action: string;
  targetType: string;
  targetId: string;
  expectedVersion: number;
  actionDigest: string;
  roleId: string | null;
  approvalSlotId: string | null;
  expiresAt: Date;
  now: Date;
};

export interface V1ConfirmationRepository {
  /** 创建新票据并对同一 session+action+target 的未消费旧票据置失效。 */
  createTicket(input: V1TicketCreateInput): Promise<V1TicketRecord>;
  findTicket(ticketId: string): Promise<V1TicketRecord | null>;
  /** 条件更新消费：只有仍未被消费、未失效、未过期且属于该 session 的行才返回 count=1。 */
  consumeTicket(input: {
    ticketId: string;
    secretHash: string;
    webSessionId: string;
    operationId: string;
    now: Date;
  }): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }>;
}

export const V1_CONFIRMATION_REPOSITORY = Symbol('V1_CONFIRMATION_REPOSITORY');

export function hashTicketSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function newTicketSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function equalTicketSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashTicketSecret(secret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * actionDigest = hex(SHA256(UTF8(canonicalJson({schemaVersion:1, ...ActionBinding}))))。
 * password、confirmation、CSRF、requestId、Idempotency-Key 和 UI 文案不进入 payload。
 */
export function actionDigestOf(binding: ActionBinding): string {
  const canonical = canonicalJson({ schemaVersion: CONFIRMATION_SCHEMA_VERSION, ...binding });
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex');
}

export type TicketVerificationInput = {
  ticket: V1TicketRecord;
  confirmation: ConfirmationRef;
  userId: string;
  webSessionId: string;
  userAuthVersion: number;
  binding: ActionBinding;
  now: Date;
};

/**
 * 票据核验是纯策略：绑定不匹配/secret 无效 → CONFIRMATION_INVALID；过期 → CONFIRMATION_EXPIRED；
 * 已消费 → CONFIRMATION_USED。跨 session、跨用户、跨目标、跨版本、跨摘要一律拒绝。
 */
export function verifyTicketBinding(input: TicketVerificationInput): void {
  const { ticket, confirmation, binding } = input;
  if (!equalTicketSecret(confirmation.ticketSecret, ticket.secretHash))
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_SECRET_MISMATCH',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.userId !== input.userId)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_CROSS_USER',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.webSessionId !== input.webSessionId)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_CROSS_SESSION',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.userAuthVersion !== input.userAuthVersion)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_AUTH_VERSION_CHANGED',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.invalidatedAt)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_INVALIDATED',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.consumedAt || ticket.consumedOperationId)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_USED,
      'CONFIRMATION_ALREADY_CONSUMED',
      { ticketId: ticket.id },
      409,
    );
  if (ticket.expiresAt <= input.now)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_EXPIRED,
      'CONFIRMATION_EXPIRED',
      { ticketId: ticket.id },
      410,
    );

  if (ticket.action !== binding.action)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_ACTION_MISMATCH',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.targetType !== binding.targetType || ticket.targetId !== binding.targetId)
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_TARGET_MISMATCH',
      { ticketId: ticket.id },
      403,
    );
  if (ticket.expectedVersion !== binding.expectedVersion)
    throw new WorkmeshError(
      V1_ERROR_CODES.ACTION_CHANGED,
      'CONFIRMATION_VERSION_MISMATCH',
      { ticketId: ticket.id },
      409,
    );
  if (ticket.actionDigest !== actionDigestOf(binding))
    throw new WorkmeshError(
      V1_ERROR_CODES.ACTION_CHANGED,
      'CONFIRMATION_DIGEST_MISMATCH',
      { ticketId: ticket.id },
      409,
    );
  if ((ticket.projectId ?? null) !== (binding.projectId ?? null))
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_PROJECT_MISMATCH',
      { ticketId: ticket.id },
      403,
    );
  const ticketRoleId = ticket.roleId ?? null;
  const ticketSlotId = ticket.approvalSlotId ?? null;
  if (
    ticketRoleId !== (binding.roleSlot?.roleId ?? null) ||
    ticketSlotId !== (binding.roleSlot?.approvalSlotId ?? null)
  )
    throw new WorkmeshError(
      V1_ERROR_CODES.CONFIRMATION_INVALID,
      'CONFIRMATION_ROLE_SLOT_MISMATCH',
      { ticketId: ticket.id },
      403,
    );
}

@Injectable()
export class V1ConfirmationService {
  constructor() {}

  /**
   * 预览：返回规范化 binding 与摘要，供 Web 展示“批准并发布”的准确版本与内容摘要。
   */
  preview(binding: ActionBinding): { binding: ActionBinding; actionDigest: string } {
    return {
      binding: this.normalize(binding),
      actionDigest: actionDigestOf(this.normalize(binding)),
    };
  }

  normalize(binding: ActionBinding): ActionBinding {
    return {
      action: binding.action,
      projectId: binding.projectId ?? null,
      targetType: binding.targetType,
      targetId: binding.targetId,
      expectedVersion: binding.expectedVersion,
      roleSlot: binding.roleSlot
        ? {
            roleId: binding.roleSlot.roleId,
            approvalSlotId: binding.roleSlot.approvalSlotId ?? null,
          }
        : null,
      payload: binding.payload,
    };
  }
}
