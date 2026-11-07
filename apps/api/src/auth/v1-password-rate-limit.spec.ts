import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V1AccountService, RATE_WINDOW_15M } from './v1-account.service';
import { hashSecret } from './v1-policy';
import type {
  V1AuthRepository,
  V1PasswordRateReservation,
  V1RateWindowInput,
  V1UserRecord,
} from './v1-auth.repository';

const { compare } = vi.hoisted(() => ({
  compare: vi.fn<(password: string, hash: string) => Promise<boolean>>(),
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));

const now = new Date('2026-11-01T00:00:00.000Z');
const user: V1UserRecord = {
  id: 'user-1',
  email: 'human@example.test',
  passwordHash: 'stored-bcrypt-hash',
  authVersion: 1,
  isActive: true,
};

function windowKey(reservation: V1PasswordRateReservation) {
  return [reservation.kind, reservation.keyHash, reservation.windowStart.getTime()].join('/');
}

/** Atomic in-memory boundary for testing service orchestration; SQL races are tested separately. */
function harness() {
  const counts = new Map<string, number>();
  const releases: V1PasswordRateReservation[] = [];
  const findUser = vi.fn(async (): Promise<V1UserRecord | null> => user);
  const repo = {
    findUser,
    async reservePasswordRateWindow(input: V1RateWindowInput & { limit: number }) {
      const reservation = {
        kind: input.kind,
        keyHash: input.keyHash,
        windowStart: new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs),
      };
      const key = windowKey(reservation);
      const count = counts.get(key) ?? 0;
      if (count >= input.limit) return null;
      counts.set(key, count + 1);
      return reservation;
    },
    async releasePasswordRateWindow(reservation: V1PasswordRateReservation) {
      releases.push(reservation);
      const key = windowKey(reservation);
      counts.set(key, Math.max(0, (counts.get(key) ?? 0) - 1));
    },
  };
  return {
    service: new V1AccountService(repo as unknown as V1AuthRepository),
    findUser,
    releases,
    count(at = now, sessionId = 'session-1') {
      return (
        counts.get(
          windowKey({
            kind: 'password-verify-session',
            keyHash: hashSecret(sessionId),
            windowStart: new Date(Math.floor(at.getTime() / RATE_WINDOW_15M) * RATE_WINDOW_15M),
          }),
        ) ?? 0
      );
    },
  };
}

function attempt(
  service: V1AccountService,
  password = 'correct',
  at = now,
  sessionId = 'session-1',
) {
  return service.reauthenticate({ userId: user.id, sessionId, password, now: at });
}

beforeEach(() => {
  compare.mockReset();
  compare.mockImplementation(async (password) => password === 'correct');
});

describe('password second-factor failure budget', () => {
  it('permits repeated correct confirmations without consuming the failure allowance', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++) await expect(attempt(h.service)).resolves.toEqual(user);
    expect(compare).toHaveBeenCalledTimes(8);
    expect(h.releases).toHaveLength(8);
    expect(h.count()).toBe(0);
  });

  it('retains five wrong guesses and refuses even correct input before bcrypt at the limit', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(compare).toHaveBeenCalledTimes(5);
    expect(h.count()).toBe(5);
    expect(h.releases).toHaveLength(0);
  });

  it('a correct password releases only its slot and preserves earlier failed guesses', async () => {
    const h = harness();
    for (let i = 0; i < 4; i++)
      await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service)).resolves.toEqual(user);
    expect(h.count()).toBe(4);
    await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(h.count()).toBe(5);
  });

  it('admits at most five concurrent bcrypt checks and does not count rejected reservations', async () => {
    const h = harness();
    const finish: Array<(value: boolean) => void> = [];
    compare.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const pending = Promise.allSettled(Array.from({ length: 12 }, () => attempt(h.service)));
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(5));
    expect(h.count()).toBe(5);
    finish.forEach((resolve) => resolve(true));
    const results = await pending;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const denied = results.filter((result) => result.status === 'rejected');
    expect(denied).toHaveLength(7);
    denied.forEach((result) => expect(result.reason).toMatchObject({ code: 'RATE_LIMITED' }));
    expect(h.count()).toBe(0);
  });

  it('preserves concurrent wrong guesses when successful checks refund their own slots', async () => {
    const h = harness();
    const finish = new Map<string, (value: boolean) => void>();
    compare.mockImplementation(
      (password) => new Promise((resolve) => finish.set(password, resolve)),
    );
    const pending = Promise.allSettled(
      ['wrong-1', 'correct-1', 'wrong-2', 'correct-2', 'correct-3'].map((password) =>
        attempt(h.service, password),
      ),
    );
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(5));
    for (const [password, resolve] of finish) resolve(password.startsWith('correct'));
    const results = await pending;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(h.count()).toBe(2);
    expect(h.releases).toHaveLength(3);
  });

  it('a delayed success refunds its original window without changing failures in the next window', async () => {
    const h = harness();
    let finish!: (value: boolean) => void;
    compare.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const earlier = new Date(now.getTime() + RATE_WINDOW_15M - 1);
    const later = new Date(earlier.getTime() + 2);
    const pending = attempt(h.service, 'correct', earlier);
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(1));
    await expect(attempt(h.service, 'wrong', later)).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    finish(true);
    await pending;
    expect(h.count(earlier)).toBe(0);
    expect(h.count(later)).toBe(1);
    expect(h.releases[0].windowStart).toEqual(now);
  });

  it('recovers in a new fixed window without clearing the exhausted old window', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    const later = new Date(now.getTime() + RATE_WINDOW_15M);
    await expect(attempt(h.service, 'correct', later)).resolves.toEqual(user);
    expect(h.count(now)).toBe(5);
    expect(h.count(later)).toBe(0);
  });

  it('reports the remaining fixed-window duration and keeps session budgets separate', async () => {
    const h = harness();
    const at = new Date(now.getTime() + 2 * 60 * 1000);
    for (let i = 0; i < 5; i++)
      await expect(attempt(h.service, 'wrong', at)).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service, 'correct', at)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { retryAfterSeconds: 13 * 60, window: 'password-verify-session' },
    });
    await expect(attempt(h.service, 'correct', at, 'session-2')).resolves.toEqual(user);
    expect(h.count(at, 'session-1')).toBe(5);
  });

  it('keeps invalid accounts and verification exceptions charged instead of opening a bypass', async () => {
    const h = harness();
    h.findUser.mockResolvedValueOnce(null);
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    h.findUser.mockResolvedValueOnce({ ...user, isActive: false });
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    compare.mockRejectedValueOnce(new Error('bcrypt failure'));
    await expect(attempt(h.service)).rejects.toThrow('bcrypt failure');
    expect(h.count()).toBe(3);
    expect(h.releases).toHaveLength(0);
  });
});
