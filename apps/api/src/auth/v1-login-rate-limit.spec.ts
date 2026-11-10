import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V1AccountService, RATE_WINDOW_15M } from './v1-account.service';
import { hashSecret } from './v1-policy';
import type {
  V1AuthRepository,
  V1PasswordRateReservation,
  V1RateWindowInput,
  V1SessionRecord,
  V1UserRecord,
} from './v1-auth.repository';

const { compare } = vi.hoisted(() => ({
  compare: vi.fn<(password: string, hash: string) => Promise<boolean>>(),
}));
vi.mock('bcryptjs', () => ({ default: { compare } }));

const now = new Date('2026-11-01T00:00:00.000Z');
const email = 'human@example.test';
const user: V1UserRecord = {
  id: 'user-1',
  email,
  passwordHash: 'stored-bcrypt-hash',
  authVersion: 1,
  isActive: true,
};
const session = { id: 'anonymous-session' } as V1SessionRecord;

function key(kind: string, keyHash: string, at: Date) {
  return [kind, keyHash, Math.floor(at.getTime() / RATE_WINDOW_15M) * RATE_WINDOW_15M].join('/');
}

/** Service orchestration boundary; production SQL concurrency has its own database suite. */
function harness() {
  const counts = new Map<string, number>();
  const reservations: V1PasswordRateReservation[] = [];
  const releases: V1PasswordRateReservation[] = [];
  const findUserByEmail = vi.fn(async (value: string): Promise<V1UserRecord | null> =>
    value === email ? user : null,
  );
  const createSession = vi.fn(async () => {});
  const revokeSession = vi.fn(async () => {});
  const repo = {
    findUserByEmail,
    createSession,
    revokeSession,
    async bumpRateWindow(input: V1RateWindowInput) {
      const windowKey = key(input.kind, input.keyHash, input.now);
      const count = (counts.get(windowKey) ?? 0) + 1;
      counts.set(windowKey, count);
      return count;
    },
    async reservePasswordRateWindow(input: V1RateWindowInput & { limit: number }) {
      const windowKey = key(input.kind, input.keyHash, input.now);
      const count = counts.get(windowKey) ?? 0;
      if (count >= input.limit) return null;
      counts.set(windowKey, count + 1);
      const reservation = {
        kind: input.kind,
        keyHash: input.keyHash,
        windowStart: new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs),
      };
      reservations.push(reservation);
      return reservation;
    },
    async releasePasswordRateWindow(reservation: V1PasswordRateReservation) {
      releases.push(reservation);
      const windowKey = key(reservation.kind, reservation.keyHash, reservation.windowStart);
      counts.set(windowKey, Math.max(0, (counts.get(windowKey) ?? 0) - 1));
    },
  };
  return {
    service: new V1AccountService(repo as unknown as V1AuthRepository),
    repo,
    findUserByEmail,
    createSession,
    revokeSession,
    reservations,
    releases,
    emailCount(at = now, address = email) {
      return counts.get(key('login-email', hashSecret(hashSecret(address)), at)) ?? 0;
    },
    ipCount(ip = '127.0.0.1', at = now) {
      return counts.get(key('login-ip', hashSecret(ip), at)) ?? 0;
    },
    seedEmailFailures(count: number, at = now) {
      counts.set(key('login-email', hashSecret(hashSecret(email)), at), count);
    },
  };
}

function attempt(
  service: V1AccountService,
  password = 'correct',
  at = now,
  address = email,
  ip = '127.0.0.1',
) {
  return service.login({ email: address, password, now: at, session, ip });
}

beforeEach(() => {
  compare.mockReset();
  compare.mockImplementation(async (password) => password === 'correct');
});

describe('login email failure budget', () => {
  it('permits more than five valid logins while every login still consumes its IP attempt', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++) {
      const result = await attempt(h.service);
      expect(result.user).toEqual(user);
      expect(result.cookies.sessionId).not.toBe(session.id);
    }
    expect(h.emailCount()).toBe(0);
    expect(h.ipCount()).toBe(8);
    expect(h.releases).toHaveLength(8);
    expect(h.createSession).toHaveBeenCalledTimes(8);
    expect(h.revokeSession).toHaveBeenCalledTimes(8);
  });

  it('charges five wrong guesses and blocks further lookup, bcrypt and session creation', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(h.emailCount()).toBe(5);
    expect(h.ipCount()).toBe(6);
    expect(h.findUserByEmail).toHaveBeenCalledTimes(5);
    expect(compare).toHaveBeenCalledTimes(5);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.releases).toHaveLength(0);
  });

  it('refunds only a valid login and preserves failures from earlier attempts and other IPs', async () => {
    const h = harness();
    for (let i = 0; i < 4; i++)
      await expect(attempt(h.service, 'wrong')).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service)).resolves.toMatchObject({ user });
    expect(h.emailCount()).toBe(4);
    await expect(attempt(h.service, 'wrong', now, email, '127.0.0.2')).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    await expect(attempt(h.service, 'correct', now, email, '127.0.0.3')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(h.emailCount()).toBe(5);
    expect(h.releases).toHaveLength(1);
  });

  it('uses the existing normalized email key so pre-upgrade failures still block', async () => {
    const h = harness();
    h.seedEmailFailures(4);
    await expect(attempt(h.service, 'wrong', now, '  HUMAN@EXAMPLE.TEST  ')).rejects.toMatchObject({
      code: 'AUTH_INVALID',
    });
    await expect(attempt(h.service, 'correct', now, email)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(h.findUserByEmail).toHaveBeenCalledWith(email);
    expect(h.reservations[0].keyHash).toBe(hashSecret(hashSecret(email)));
    expect(h.emailCount()).toBe(5);
  });

  it('admits only five concurrent bcrypt checks for a shared email before any success is known', async () => {
    const h = harness();
    const finish: Array<(value: boolean) => void> = [];
    compare.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    const pending = Promise.allSettled(
      Array.from({ length: 12 }, (_, index) =>
        attempt(h.service, 'correct', now, email, '192.0.2.' + (index + 1)),
      ),
    );
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(5));
    expect(h.emailCount()).toBe(5);
    finish.forEach((resolve) => resolve(true));
    const results = await pending;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    const denied = results.filter((result) => result.status === 'rejected');
    expect(denied).toHaveLength(7);
    denied.forEach((result) => expect(result.reason).toMatchObject({ code: 'RATE_LIMITED' }));
    expect(h.emailCount()).toBe(0);
    expect(h.createSession).toHaveBeenCalledTimes(5);
  });

  it('preserves concurrent wrong guesses when other checks succeed', async () => {
    const h = harness();
    const finish = new Map<string, (value: boolean) => void>();
    compare.mockImplementation(
      (password) => new Promise((resolve) => finish.set(password, resolve)),
    );
    const pending = Promise.allSettled(
      ['bad-1', 'ok-1', 'bad-2', 'ok-2', 'ok-3'].map((password) => attempt(h.service, password)),
    );
    await vi.waitFor(() => expect(compare).toHaveBeenCalledTimes(5));
    for (const [password, resolve] of finish) resolve(password.startsWith('ok'));
    const results = await pending;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    expect(h.emailCount()).toBe(2);
    expect(h.ipCount()).toBe(5);
    expect(h.releases).toHaveLength(3);
  });

  it('refunds a delayed valid login only in the original window', async () => {
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
    expect(h.emailCount(earlier)).toBe(0);
    expect(h.emailCount(later)).toBe(1);
    expect(h.releases[0]).toMatchObject({ kind: 'login-email', windowStart: now });
  });

  it('recovers at the next window and returns the actual remaining email cooldown', async () => {
    const h = harness();
    const at = new Date(now.getTime() + 2 * 60 * 1000 + 100);
    for (let i = 0; i < 5; i++)
      await expect(attempt(h.service, 'wrong', at)).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    await expect(attempt(h.service, 'correct', at)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { window: 'login-email', retryAfterSeconds: 780 },
    });
    const later = new Date(now.getTime() + RATE_WINDOW_15M);
    await expect(attempt(h.service, 'correct', later)).resolves.toMatchObject({ user });
    expect(h.emailCount(at)).toBe(5);
    expect(h.emailCount(later)).toBe(0);
  });

  it('charges missing users while running the same comparison path with a dummy hash', async () => {
    const h = harness();
    for (let i = 0; i < 5; i++)
      await expect(
        attempt(h.service, 'correct', now, 'unknown@example.test'),
      ).rejects.toMatchObject({ code: 'AUTH_INVALID', status: 401 });
    expect(compare).toHaveBeenCalledTimes(5);
    const hashes = compare.mock.calls.map((call) => call[1]);
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toMatch(/^\$2a\$12\$.{53}$/);
    expect(hashes[0]).not.toBe(user.passwordHash);
    await expect(attempt(h.service, 'correct', now, 'unknown@example.test')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(h.emailCount(now, 'unknown@example.test')).toBe(5);
    expect(h.emailCount()).toBe(0);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('retains inactive-user and comparison-error reservations without creating a session', async () => {
    const h = harness();
    h.findUserByEmail.mockResolvedValueOnce({ ...user, isActive: false });
    await expect(attempt(h.service)).rejects.toMatchObject({ code: 'AUTH_INVALID' });
    compare.mockRejectedValueOnce(new Error('bcrypt failed'));
    await expect(attempt(h.service)).rejects.toThrow('bcrypt failed');
    expect(h.emailCount()).toBe(2);
    expect(h.releases).toHaveLength(0);
    expect(h.createSession).not.toHaveBeenCalled();
  });

  it('keeps the existing thirty-attempt IP limit even when every password is correct', async () => {
    const h = harness();
    for (let i = 0; i < 30; i++) await attempt(h.service);
    await expect(attempt(h.service)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      details: { window: 'login-ip', retryAfterSeconds: 900 },
    });
    expect(compare).toHaveBeenCalledTimes(30);
    expect(h.reservations).toHaveLength(30);
    expect(h.emailCount()).toBe(0);
    expect(h.ipCount()).toBe(31);
  });

  it('does not compare passwords or create a session when reservation storage fails', async () => {
    const h = harness();
    vi.spyOn(h.repo, 'reservePasswordRateWindow').mockRejectedValueOnce(
      new Error('reservation failed'),
    );
    await expect(attempt(h.service)).rejects.toThrow('reservation failed');
    expect(compare).not.toHaveBeenCalled();
    expect(h.findUserByEmail).not.toHaveBeenCalled();
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.ipCount()).toBe(1);
  });

  it('does not issue a session when the successful password reservation cannot be released', async () => {
    const h = harness();
    vi.spyOn(h.repo, 'releasePasswordRateWindow').mockRejectedValueOnce(
      new Error('release failed'),
    );
    await expect(attempt(h.service)).rejects.toThrow('release failed');
    expect(compare).toHaveBeenCalledTimes(1);
    expect(h.revokeSession).not.toHaveBeenCalled();
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.emailCount()).toBe(1);
    expect(h.ipCount()).toBe(1);
  });
});
