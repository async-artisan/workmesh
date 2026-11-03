import { describe, expect, it } from 'vitest';
import {
  assertInvitationEmailMatches,
  assertInvitationTtl,
  hashInvitationToken,
  invitationBindingPayload,
  invitationExpiryFrom,
  invitationStatus,
  newInvitationToken,
  normalizeInvitationEmail,
  type InvitationRecord,
} from './invitations.policy';

function record(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: 'inv-1',
    projectId: 'p1',
    email: null,
    roleIds: ['r1'],
    expiresAt: new Date('2026-11-05T00:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('invitationStatus', () => {
  const now = new Date('2026-11-03T00:00:00.000Z');

  it('待接受 / 已接受 / 已撤销 / 已过期', () => {
    expect(invitationStatus(record(), now)).toBe('PENDING');
    expect(invitationStatus(record({ acceptedAt: now }), now)).toBe('ACCEPTED');
    expect(invitationStatus(record({ revokedAt: now }), now)).toBe('REVOKED');
    expect(invitationStatus(record({ expiresAt: now }), now)).toBe('EXPIRED');
  });

  it('撤销优先于已接受，已接受优先于过期', () => {
    expect(invitationStatus(record({ revokedAt: now, acceptedAt: now }), now)).toBe('REVOKED');
    expect(
      invitationStatus(
        record({ acceptedAt: now, expiresAt: new Date('2020-01-01T00:00:00.000Z') }),
        now,
      ),
    ).toBe('ACCEPTED');
  });
});

describe('invitation token', () => {
  it('生成 wmi_ 前缀 token，哈希稳定且不同 token 不同哈希', () => {
    const first = newInvitationToken();
    const second = newInvitationToken();
    expect(first.token.startsWith('wmi_')).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(hashInvitationToken(first.token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInvitationToken(first.token)).toBe(first.tokenHash);
    expect(hashInvitationToken(second.token)).not.toBe(first.tokenHash);
  });
});

describe('有效期与邮箱', () => {
  it('只接受 1–336 小时', () => {
    expect(assertInvitationTtl(1)).toBe(1);
    expect(assertInvitationTtl(336)).toBe(336);
    expect(() => assertInvitationTtl(0)).toThrow(/1–336/);
    expect(() => assertInvitationTtl(337)).toThrow(/1–336/);
    expect(() => assertInvitationTtl(1.5)).toThrow(/1–336/);
  });

  it('过期时间按小时计算', () => {
    const now = new Date('2026-11-03T00:00:00.000Z');
    expect(invitationExpiryFrom(now, 2).toISOString()).toBe('2026-11-03T02:00:00.000Z');
  });

  it('邮箱归一化为小写并去空白', () => {
    expect(normalizeInvitationEmail('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(normalizeInvitationEmail('')).toBeNull();
    expect(normalizeInvitationEmail(undefined)).toBeNull();
  });

  it('绑定邮箱的邀请只允许同一邮箱接受', () => {
    expect(() => assertInvitationEmailMatches('a@b.com', 'A@B.com')).not.toThrow();
    expect(() => assertInvitationEmailMatches('a@b.com', 'c@b.com')).toThrow(
      /INVITATION_EMAIL_MISMATCH|a@b.com/,
    );
    expect(() => assertInvitationEmailMatches(null, 'c@b.com')).not.toThrow();
  });
});

describe('invitationBindingPayload', () => {
  it('角色去重并排序，保证同一输入摘要稳定', () => {
    expect(
      invitationBindingPayload({ roleIds: ['r2', 'r1', 'r2'], email: null, expiresInHours: 72 }),
    ).toEqual({ roleIds: ['r1', 'r2'], email: null, expiresInHours: 72 });
  });
});
