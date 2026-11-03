import { createHash, randomBytes } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

export const INVITATION_DEFAULT_TTL_HOURS = 72;
export const INVITATION_MAX_TTL_HOURS = 24 * 14;

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export type InvitationRecord = {
  id: string;
  projectId: string;
  email: string | null;
  roleIds: string[] | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
};

/** 状态优先级：撤销 > 已接受 > 过期 > 待接受；撤销与已接受都不可逆。 */
export function invitationStatus(record: InvitationRecord, now = new Date()): InvitationStatus {
  if (record.revokedAt) return 'REVOKED';
  if (record.acceptedAt) return 'ACCEPTED';
  if (record.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 明文 token 只在创建响应当次返回；库里只留 sha256。 */
export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = `wmi_${randomBytes(32).toString('base64url')}`;
  return { token, tokenHash: hashInvitationToken(token) };
}

export function normalizeInvitationEmail(email?: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

export function assertInvitationTtl(hours: number): number {
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > INVITATION_MAX_TTL_HOURS)
    throw new WorkmeshError(
      V1_ERROR_CODES.VALIDATION_FAILED,
      '邀请有效期必须是 1–336 小时的整数',
      { hours },
      422,
    );
  return hours;
}

export function invitationExpiryFrom(now: Date, hours: number): Date {
  return new Date(now.getTime() + assertInvitationTtl(hours) * 60 * 60 * 1000);
}

/**
 * 票据绑定用的规范 payload：角色集合排序，邮箱归一化为小写。
 * 同一份输入必须产生同一个摘要，否则预览与提交会对不上。
 */
export function invitationBindingPayload(input: {
  roleIds: string[];
  email: string | null;
  expiresInHours: number;
}): { roleIds: string[]; email: string | null; expiresInHours: number } {
  return {
    roleIds: [...new Set(input.roleIds)].sort(),
    email: input.email,
    expiresInHours: input.expiresInHours,
  };
}

/** 接受时按邀请绑定的邮箱核对身份；邀请未绑定邮箱则任何人可接受。 */
export function assertInvitationEmailMatches(
  invitationEmail: string | null,
  userEmail: string | null | undefined,
): void {
  if (!invitationEmail) return;
  if (normalizeInvitationEmail(userEmail) !== invitationEmail)
    throw new WorkmeshError(
      V1_ERROR_CODES.FORBIDDEN,
      'INVITATION_EMAIL_MISMATCH',
      { expected: invitationEmail },
      403,
    );
}
