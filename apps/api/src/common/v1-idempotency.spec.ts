import { describe, expect, it } from 'vitest';
import {
  assertReplayable,
  normalizeRoute,
  requestDigestOf,
  requireExpectedVersion,
  requireIdempotencyKey,
  type V1OperationRecord,
} from './v1-idempotency';

const operation = (overrides: Partial<V1OperationRecord> = {}): V1OperationRecord => ({
  id: 'op-1',
  projectScopeKey: 'project:p-a',
  principalScopeKey: 'user:alice',
  key: '11111111-1111-4111-8111-111111111111',
  method: 'POST',
  route: '/api/v1/review-requests/rr-1/decisions',
  requestDigest: requestDigestOf({
    method: 'POST',
    route: '/api/v1/review-requests/rr-1/decisions',
    body: { slotId: 'slot-1', decision: 'APPROVE', expectedVersion: 3 },
  }),
  resultRefs: { reviewRequestId: 'rr-1' },
  committedAt: new Date('2026-11-01T00:00:00.000Z'),
  ...overrides,
});

describe('idempotency policy', () => {
  it('accepts a replay with the same digest', () => {
    expect(() =>
      assertReplayable(operation(), {
        method: 'POST',
        route: '/api/v1/review-requests/rr-1/decisions',
        digest: requestDigestOf({
          method: 'POST',
          route: '/api/v1/review-requests/rr-1/decisions',
          body: { slotId: 'slot-1', decision: 'APPROVE', expectedVersion: 3 },
        }),
      }),
    ).not.toThrow();
  });

  it('conflicts when the same key is replayed with different business content', () => {
    expect(() =>
      assertReplayable(operation(), {
        method: 'POST',
        route: '/api/v1/review-requests/rr-1/decisions',
        digest: requestDigestOf({
          method: 'POST',
          route: '/api/v1/review-requests/rr-1/decisions',
          body: { slotId: 'slot-2', decision: 'APPROVE', expectedVersion: 3 },
        }),
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT', status: 409 }));
  });

  it('conflicts when the same key is used on another route', () => {
    expect(() =>
      assertReplayable(operation(), {
        method: 'POST',
        route: '/api/v1/tasks/t-1/claim',
        digest: operation().requestDigest,
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  });

  it('excludes password, confirmation, csrf and requestId from the digest', () => {
    const base = { slotId: 'slot-1', decision: 'APPROVE', expectedVersion: 3 };
    const withSecrets = {
      ...base,
      password: 'p1',
      confirmation: { ticketId: 't', ticketSecret: 's' },
      csrfToken: 'c',
      requestId: 'r',
    };
    expect(
      requestDigestOf({
        method: 'POST',
        route: '/api/v1/review-requests/rr-1/decisions',
        body: withSecrets,
      }),
    ).toBe(
      requestDigestOf({
        method: 'POST',
        route: '/api/v1/review-requests/rr-1/decisions',
        body: base,
      }),
    );
  });

  it('still binds business content that must not silently change', () => {
    const base = { slotId: 'slot-1', decision: 'APPROVE', expectedVersion: 3 };
    expect(requestDigestOf({ method: 'POST', route: '/r', body: base })).not.toBe(
      requestDigestOf({ method: 'POST', route: '/r', body: { ...base, expectedVersion: 4 } }),
    );
    expect(normalizeRoute('/api/v1/x/?a=1')).toBe('/api/v1/x');
  });

  it('requires a UUID idempotency key and a positive expectedVersion', () => {
    expect(() => requireIdempotencyKey('not-a-uuid')).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED' }),
    );
    expect(() => requireIdempotencyKey(undefined)).toThrow();
    expect(() => requireExpectedVersion(0)).toThrowError(
      expect.objectContaining({ code: 'EXPECTED_VERSION_REQUIRED' }),
    );
    expect(() => requireExpectedVersion(1.5)).toThrow();
    expect(requireExpectedVersion(3)).toBe(3);
  });

  it('rejects keys that are not UUID shaped instead of letting the database do it', () => {
    // 回归：旧实现只校验「36 个 [0-9a-f-] 字符」，36 个横线也能通过，
    // 随后写进 @db.Uuid 列触发 22P02，把一个 400 的输入错误变成 500。
    const uuid = '11111111-1111-4111-8111-111111111111';
    expect(requireIdempotencyKey(uuid)).toBe(uuid);
    for (const bad of [
      '-'.repeat(36),
      'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz',
      '11111111-1111-4111-8111-11111111111',
      '11111111_1111_4111_8111_111111111111',
      '',
    ])
      expect(() => requireIdempotencyKey(bad)).toThrowError(
        expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REQUIRED', status: 400 }),
      );
    // 版本位不限制：客户端用 v7 也应该通过。
    expect(requireIdempotencyKey('0190a5c4-1f3e-7a2b-8c4d-5e6f7a8b9c0d')).toBe(
      '0190a5c4-1f3e-7a2b-8c4d-5e6f7a8b9c0d',
    );
  });

  it('digests ValidationPipe-transformed DTO instances instead of failing (route 500 regression)', () => {
    // 回归：控制器把 transform 后的 DTO 实例交给摘要；原型非 Object.prototype 曾导致 canonicalJson 抛错并整条路由 500。
    class StepBindingDto {
      stepKey = 'impl';
      roleId = 'r-1';
      responsibleUserId = 'u-1';
      repositoryIds = ['repo-1'];
    }
    const plain = {
      stepKey: 'impl',
      roleId: 'r-1',
      responsibleUserId: 'u-1',
      repositoryIds: ['repo-1'],
    };
    const route = '/api/v1/requirements/r-1/workflow-instances';
    const viaInstance = requestDigestOf({
      method: 'POST',
      route,
      body: { stepBindings: [new StepBindingDto()] },
    });
    const viaPlain = requestDigestOf({ method: 'POST', route, body: { stepBindings: [plain] } });
    expect(viaInstance).toBe(viaPlain);
    // 归一化不得削弱绑定强度：嵌套内容变化仍然改变摘要。
    expect(viaInstance).not.toBe(
      requestDigestOf({
        method: 'POST',
        route,
        body: { stepBindings: [{ ...plain, roleId: 'r-2' }] },
      }),
    );
  });
});
