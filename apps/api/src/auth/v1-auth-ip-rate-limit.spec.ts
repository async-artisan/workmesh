import { beforeEach, describe, expect, it, vi } from 'vitest';
import { V1AccountService, RATE_WINDOW_10M, RATE_WINDOW_15M } from './v1-account.service';
import { hashSecret } from './v1-policy';
import type {
  V1AuthRepository,
  V1RateWindowInput,
  V1SessionRecord,
  V1UserRecord,
} from './v1-auth.repository';

const { compare, hash } = vi.hoisted(() => ({
  compare: vi.fn<(password: string, digest: string) => Promise<boolean>>(),
  hash: vi.fn<(password: string, rounds: number) => Promise<string>>(),
}));
vi.mock('bcryptjs', () => ({ default: { compare, hash } }));

const NOW = new Date('2026-11-01T00:00:00.000Z');
const IP = '192.0.2.10';
const SESSION = { id: 'anonymous-session' } as V1SessionRecord;
const USER: V1UserRecord = {
  id: 'user-1',
  email: 'login@example.test',
  passwordHash: 'stored-hash',
  authVersion: 1,
  isActive: true,
};

function rateKey(kind: string, keyHash: string, now: Date, windowMs: number) {
  return [kind, keyHash, Math.floor(now.getTime() / windowMs) * windowMs].join('/');
}

/** Models the repository contract; real SQL atomicity is covered by database tests. */
function harness() {
  const counts = new Map<string, number>();
  const repo = {
    bumpRateWindow: vi.fn(async (input: V1RateWindowInput) => {
      const key = rateKey(input.kind, input.keyHash, input.now, input.windowMs);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      const legacy =
        input.kind === 'login-ip'
          ? (counts.get(rateKey('register-ip', input.keyHash, input.now, input.windowMs)) ?? 0)
          : 0;
      return count + legacy;
    }),
    findUserByEmail: vi.fn(async (email: string) => (email === USER.email ? USER : null)),
    createUser: vi.fn(async (input: { email: string; passwordHash: string }) => ({
      ...USER,
      ...input,
    })),
    createSession: vi.fn(async () => {}),
    revokeSession: vi.fn(async () => {}),
    reservePasswordRateWindow: vi.fn(async (input: V1RateWindowInput) => ({
      kind: input.kind,
      keyHash: input.keyHash,
      windowStart: new Date(Math.floor(input.now.getTime() / input.windowMs) * input.windowMs),
    })),
    releasePasswordRateWindow: vi.fn(async () => {}),
  };
  return {
    repo,
    service: new V1AccountService(repo as unknown as V1AuthRepository),
    seed(kind: string, attempts: number, now = NOW, ip = IP) {
      counts.set(rateKey(kind, hashSecret(ip), now, RATE_WINDOW_15M), attempts);
    },
    count(kind = 'login-ip', now = NOW, ip = IP) {
      return counts.get(rateKey(kind, hashSecret(ip), now, RATE_WINDOW_15M)) ?? 0;
    },
  };
}

function login(service: V1AccountService, now = NOW, ip = IP) {
  return service.login({
    email: USER.email,
    password: 'correct-password',
    session: SESSION,
    ip,
    now,
  });
}

function register(service: V1AccountService, now = NOW, ip = IP) {
  return service.register({
    email: 'new@example.test',
    password: 'correct-password',
    session: SESSION,
    ip,
    now,
  });
}

beforeEach(() => {
  compare.mockReset().mockResolvedValue(true);
  hash.mockReset().mockResolvedValue('new-hash');
});

describe('shared registration and login IP attempt budget', () => {
  it('permits thirty combined successes and denies both routes before account work', async () => {
    const h = harness();
    for (let i = 0; i < 15; i++) {
      await register(h.service);
      await login(h.service);
    }
    for (const attempt of [register, login])
      await expect(attempt(h.service)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        status: 429,
        details: { window: 'login-ip', retryAfterSeconds: 900 },
      });
    expect(h.repo.bumpRateWindow.mock.calls.every(([input]) => input.kind === 'login-ip')).toBe(
      true,
    );
    expect(h.count()).toBe(32);
    expect(h.count('register-ip')).toBe(0);
    expect(hash).toHaveBeenCalledTimes(15);
    expect(compare).toHaveBeenCalledTimes(15);
    expect(h.repo.findUserByEmail).toHaveBeenCalledTimes(30);
    expect(h.repo.createSession).toHaveBeenCalledTimes(30);
  });

  it('allows only thirty mixed concurrent requests through the shared admission boundary', async () => {
    const h = harness();
    const results = await Promise.allSettled(
      Array.from({ length: 60 }, (_, index) => (index % 2 === 0 ? register : login)(h.service)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(30);
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(30);
    rejected.forEach((result) => expect(result.reason).toMatchObject({ code: 'RATE_LIMITED' }));
    expect(h.repo.findUserByEmail).toHaveBeenCalledTimes(30);
    expect(h.repo.createSession).toHaveBeenCalledTimes(30);
    expect(h.count()).toBe(60);
  });

  it('keeps both pre-upgrade budgets without migrating or repeatedly adding legacy counts', async () => {
    const h = harness();
    h.seed('register-ip', 19);
    h.seed('login-ip', 9);
    await register(h.service);
    await login(h.service);
    await expect(login(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(h.count()).toBe(12);
    expect(h.count('register-ip')).toBe(19);
    expect(h.repo.createSession).toHaveBeenCalledTimes(2);
  });

  it('does not grant a fresh budget when only the old registration row exists', async () => {
    const h = harness();
    h.seed('register-ip', 30);
    await expect(login(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(register(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(h.count('register-ip')).toBe(30);
    expect(h.repo.findUserByEmail).not.toHaveBeenCalled();
    expect(h.repo.reservePasswordRateWindow).not.toHaveBeenCalled();
    expect(hash).not.toHaveBeenCalled();
    expect(compare).not.toHaveBeenCalled();
  });

  it('observes later committed legacy attempts on the next new-version request', async () => {
    const h = harness();
    h.seed('register-ip', 28);
    await login(h.service);
    h.seed('register-ip', 29);
    await expect(register(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(h.count()).toBe(2);
    expect(h.count('register-ip')).toBe(29);
  });

  it('isolates IPs and fixed windows and recovers at the exact next-window boundary', async () => {
    const h = harness();
    h.seed('register-ip', 20);
    h.seed('login-ip', 10);
    const lastMillisecond = new Date(NOW.getTime() + RATE_WINDOW_15M - 1);
    await expect(register(h.service, lastMillisecond)).rejects.toMatchObject({
      details: { window: 'login-ip', retryAfterSeconds: 1 },
    });
    await login(h.service, lastMillisecond, '192.0.2.11');
    const nextWindow = new Date(NOW.getTime() + RATE_WINDOW_15M);
    await login(h.service, nextWindow);
    await register(h.service, nextWindow);
    expect(h.count('login-ip', nextWindow)).toBe(2);
    expect(h.count('register-ip', nextWindow)).toBe(0);
    expect(h.count('register-ip')).toBe(20);
  });

  it('charges rejected registrations to the same IP budget before validation', async () => {
    const h = harness();
    for (let i = 0; i < 30; i++)
      await expect(
        h.service.register({
          email: 'invalid-email',
          password: 'short',
          session: SESSION,
          ip: IP,
          now: NOW,
        }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(login(h.service)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(h.repo.findUserByEmail).not.toHaveBeenCalled();
    expect(h.repo.createSession).not.toHaveBeenCalled();
  });

  it.each([register, login])(
    'fails closed before account work if the IP counter fails (%#)',
    async (attempt) => {
      const h = harness();
      h.repo.bumpRateWindow.mockRejectedValueOnce(new Error('counter storage failed'));
      await expect(attempt(h.service)).rejects.toThrow('counter storage failed');
      expect(h.repo.findUserByEmail).not.toHaveBeenCalled();
      expect(h.repo.createUser).not.toHaveBeenCalled();
      expect(h.repo.createSession).not.toHaveBeenCalled();
      expect(h.repo.revokeSession).not.toHaveBeenCalled();
      expect(hash).not.toHaveBeenCalled();
      expect(compare).not.toHaveBeenCalled();
    },
  );
});

describe('account fixed-window Retry-After', () => {
  it.each([
    [RATE_WINDOW_15M, 120_100, 780],
    [RATE_WINDOW_15M, RATE_WINDOW_15M - 1, 1],
    [RATE_WINDOW_15M, RATE_WINDOW_15M, 900],
    [RATE_WINDOW_10M, 120_100, 480],
    [RATE_WINDOW_10M, RATE_WINDOW_10M - 1, 1],
    [RATE_WINDOW_10M, RATE_WINDOW_10M, 600],
  ])('uses the supplied %i ms window at offset %i', async (windowMs, offset, expected) => {
    const h = harness();
    h.repo.bumpRateWindow.mockResolvedValueOnce(11);
    await expect(
      h.service.consumeRate('other-window', IP, 10, windowMs, new Date(NOW.getTime() + offset)),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
      details: { window: 'other-window', retryAfterSeconds: expected },
    });
  });
});
