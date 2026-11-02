import { describe, expect, it } from 'vitest';
import type { ActionBinding, Confirmation } from '@workmesh/shared';
import {
  actionDigestOf,
  equalTicketSecret,
  hashTicketSecret,
  newTicketSecret,
  verifyTicketBinding,
  type V1TicketRecord,
} from './v1-confirmation';

const now = new Date('2026-11-01T00:00:00.000Z');
const later = new Date('2026-11-01T00:01:00.000Z');

const binding: ActionBinding = {
  action: 'REVIEW_DECIDE',
  projectId: 'p-a',
  targetType: 'REVIEW_REQUEST',
  targetId: 'rr-1',
  expectedVersion: 3,
  roleSlot: { roleId: 'r-product', approvalSlotId: 'slot-1' },
  payload: { decision: 'APPROVE', digest: 'a'.repeat(64) },
};

function ticket(overrides: Partial<V1TicketRecord> = {}): V1TicketRecord {
  const secret = 'ticket-secret-value';
  return {
    id: 'tk-1',
    secretHash: hashTicketSecret(secret),
    userId: 'alice',
    webSessionId: 'sess-1',
    projectId: 'p-a',
    userAuthVersion: 1,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: 'r-product',
    approvalSlotId: 'slot-1',
    createdAt: now,
    expiresAt: new Date('2026-11-01T00:05:00.000Z'),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  };
}

const confirmation: Confirmation = { ticketId: 'tk-1', ticketSecret: 'ticket-secret-value' };

function verify(input: Partial<Parameters<typeof verifyTicketBinding>[0]> = {}) {
  return verifyTicketBinding({
    ticket: ticket(),
    confirmation,
    userId: 'alice',
    webSessionId: 'sess-1',
    userAuthVersion: 1,
    binding,
    now: later,
    ...input,
  });
}

describe('confirmation ticket policy', () => {
  it('accepts an exactly matching unused ticket', () => {
    expect(() => verify()).not.toThrow();
  });

  it('rejects a wrong secret', () => {
    expect(() =>
      verify({ confirmation: { ticketId: 'tk-1', ticketSecret: 'wrong' } }),
    ).toThrowError(expect.objectContaining({ code: 'CONFIRMATION_INVALID', status: 403 }));
  });

  it('rejects a ticket moved to another session', () => {
    expect(() => verify({ webSessionId: 'sess-2' })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_INVALID' }),
    );
  });

  it('rejects a ticket used by another user', () => {
    expect(() => verify({ userId: 'bob' })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_INVALID' }),
    );
  });

  it('rejects an expired ticket', () => {
    expect(() => verify({ now: new Date('2026-11-01T00:06:00.000Z') })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_EXPIRED', status: 410 }),
    );
  });

  it('rejects an already consumed ticket', () => {
    expect(() =>
      verify({ ticket: ticket({ consumedAt: later, consumedOperationId: 'op-1' }) }),
    ).toThrowError(expect.objectContaining({ code: 'CONFIRMATION_USED', status: 409 }));
  });

  it('rejects a ticket whose bound version changed', () => {
    expect(() => verify({ binding: { ...binding, expectedVersion: 4 } })).toThrowError(
      expect.objectContaining({ code: 'ACTION_CHANGED' }),
    );
  });

  it('rejects a ticket whose bound digest changed', () => {
    expect(() =>
      verify({ binding: { ...binding, payload: { decision: 'APPROVE', digest: 'b'.repeat(64) } } }),
    ).toThrowError(expect.objectContaining({ code: 'ACTION_CHANGED' }));
  });

  it('rejects a ticket reused for another approval slot', () => {
    // 同一人兼任多个 slot 时必须分别预览与二验：approvalSlotId 进入 digest，
    // 因此 slot-1 的票据无法在 slot-2 上通过（此处由 digest 校验先行拦截）。
    expect(() =>
      verify({
        binding: { ...binding, roleSlot: { roleId: 'r-product', approvalSlotId: 'slot-2' } },
      }),
    ).toThrowError(expect.objectContaining({ code: 'ACTION_CHANGED' }));
    expect(() => verify({ ticket: ticket({ roleId: null, approvalSlotId: null }) })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_INVALID' }),
    );
  });

  it('requires one independent ticket per slot held by the same user', () => {
    const slotTwo: ActionBinding = {
      ...binding,
      roleSlot: { roleId: 'r-product', approvalSlotId: 'slot-2' },
    };
    const ticketTwo = ticket({
      id: 'tk-2',
      approvalSlotId: 'slot-2',
      actionDigest: actionDigestOf(slotTwo),
    });
    // slot-2 的票据只在 slot-2 上成立
    expect(() =>
      verify({
        ticket: ticketTwo,
        binding: slotTwo,
        confirmation: { ticketId: 'tk-2', ticketSecret: 'ticket-secret-value' },
      }),
    ).not.toThrow();
    // slot-1 的票据不能用于 slot-2
    expect(() => verify({ binding: slotTwo })).toThrow();
    // slot-2 的票据也不能用于 slot-1
    expect(() =>
      verify({
        ticket: ticketTwo,
        binding,
        confirmation: { ticketId: 'tk-2', ticketSecret: 'ticket-secret-value' },
      }),
    ).toThrow();
  });

  it('rejects a ticket reused for another target', () => {
    expect(() => verify({ binding: { ...binding, targetId: 'rr-2' } })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_INVALID' }),
    );
  });

  it('rejects a ticket after the authorizer authVersion moved', () => {
    expect(() => verify({ userAuthVersion: 2 })).toThrowError(
      expect.objectContaining({ code: 'CONFIRMATION_INVALID' }),
    );
  });

  it('compares secrets in constant time and hashes rather than storing raw values', () => {
    const secret = newTicketSecret();
    expect(secret).toHaveLength(43);
    const hash = hashTicketSecret(secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(secret);
    expect(equalTicketSecret(secret, hash)).toBe(true);
    expect(equalTicketSecret(`${secret}x`, hash)).toBe(false);
  });

  it('produces a stable digest insensitive to key order', () => {
    const reordered: ActionBinding = {
      payload: binding.payload,
      roleSlot: binding.roleSlot,
      expectedVersion: binding.expectedVersion,
      targetId: binding.targetId,
      targetType: binding.targetType,
      projectId: binding.projectId,
      action: binding.action,
    };
    expect(actionDigestOf(reordered)).toBe(actionDigestOf(binding));
  });
});
