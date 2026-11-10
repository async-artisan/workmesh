import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { RATE_WINDOW_15M, V1AccountService } from '../src/auth/v1-account.service';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import type { V1SessionRecord } from '../src/auth/v1-auth.repository';
import { hashSecret } from '../src/auth/v1-policy';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;
const now = new Date('2026-11-07T00:01:00.000Z');
const windowStart = new Date('2026-11-07T00:00:00.000Z');
const nextWindow = new Date('2026-11-07T00:15:00.000Z');

suite('PostgreSQL shared registration and login IP budget', () => {
  let db: PrismaClient;
  let repository: V1AuthPrismaRepository;
  let service: V1AccountService;
  let passwordHash: string;
  const password = `shared-ip-password-${randomUUID()}`;
  const emails = new Set<string>();
  const userIds = new Set<string>();
  const sessionIds = new Set<string>();
  const rateWindows = new Map<string, { kind: string; keyHash: string; windowStart: Date }>();

  const emailKey = (email: string) => hashSecret(hashSecret(email));
  const uniqueEmail = () => {
    const email = `shared-ip-${randomUUID()}@example.invalid`;
    emails.add(email);
    return email;
  };
  const uniqueIp = () =>
    `2001:db8:${randomUUID().replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':')}`;
  const rememberWindow = (kind: string, keyHash: string, at = now) => {
    const start = new Date(Math.floor(at.getTime() / RATE_WINDOW_15M) * RATE_WINDOW_15M);
    const where = { kind, keyHash, windowStart: start };
    rateWindows.set(`${kind}:${keyHash}:${start.toISOString()}`, where);
    return where;
  };
  const row = (kind: string, keyHash: string, start = windowStart) =>
    db.authRateWindow.findFirstOrThrow({ where: { kind, keyHash, windowStart: start } });
  const seed = (kind: string, ip: string, attempts: number, at = now) => {
    const where = rememberWindow(kind, hashSecret(ip), at);
    return db.authRateWindow.create({
      data: {
        ...where,
        attempts,
        expiresAt: new Date(where.windowStart.getTime() + RATE_WINDOW_15M),
      },
    });
  };
  const createAccount = async () => {
    const id = randomUUID();
    userIds.add(id);
    return db.user.create({ data: { id, email: uniqueEmail(), passwordHash } });
  };
  const anonymous = async (at = now): Promise<V1SessionRecord> => {
    const id = randomUUID();
    sessionIds.add(id);
    await db.webSession.create({
      data: {
        id,
        userId: null,
        userAuthVersion: null,
        tokenHash: hashSecret(randomUUID()),
        csrfTokenHash: hashSecret(randomUUID()),
        idleExpiresAt: new Date(at.getTime() + 10 * 60 * 1000),
        expiresAt: new Date(at.getTime() + 10 * 60 * 1000),
      },
    });
    return (await repository.findSession(id))!;
  };
  const request = (
    action: 'register' | 'login',
    input: { email: string; password: string; session: V1SessionRecord; ip: string; now?: Date },
  ) => {
    const at = input.now ?? now;
    // Track both kinds even if a regression accidentally recreates the old registration row.
    rememberWindow('login-ip', hashSecret(input.ip), at);
    rememberWindow('register-ip', hashSecret(input.ip), at);
    if (action === 'login') rememberWindow('login-email', emailKey(input.email), at);
    return service[action]({ ...input, now: at });
  };

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(rows[0].name).toBe(target.database);
    repository = new V1AuthPrismaRepository(db as PrismaService);
    service = new V1AccountService(repository);
    passwordHash = await bcrypt.hash(password, 12);
  });

  afterAll(async () => {
    if (!db) return;
    try {
      if (emails.size || userIds.size || sessionIds.size) {
        await db.webSession.deleteMany({
          where: {
            OR: [
              { id: { in: [...sessionIds] } },
              { userId: { in: [...userIds] } },
              { user: { email: { in: [...emails] } } },
            ],
          },
        });
        await db.user.deleteMany({
          where: { OR: [{ id: { in: [...userIds] } }, { email: { in: [...emails] } }] },
        });
      }
      if (rateWindows.size)
        await db.authRateWindow.deleteMany({ where: { OR: [...rateWindows.values()] } });
    } finally {
      await db.$disconnect();
    }
  });

  it('shares 30 attempts across a successful registration, successful logins and duplicate registrations', async () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    const initial = await anonymous();
    const registered = await request('register', { email, password, session: initial, ip });
    userIds.add(registered.user.id);
    expect((await repository.findSession(initial.id))!.revokedAt).toEqual(now);
    let session = (await repository.findSession(registered.cookies.sessionId))!;
    for (let index = 0; index < 15; index++) {
      const result = await request('login', { email, password, session, ip });
      session = (await repository.findSession(result.cookies.sessionId))!;
      if (index < 14)
        await expect(request('register', { email, password, session, ip })).rejects.toMatchObject({
          code: V1_ERROR_CODES.EMAIL_IN_USE,
          status: 409,
        });
    }
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(30);
    expect((await row('login-email', emailKey(email))).attempts).toBe(0);
    const blockedEmail = uniqueEmail();
    const blockedSession = await anonymous();
    for (const action of ['register', 'login'] as const) {
      await expect(
        request(action, { email: blockedEmail, password, session: blockedSession, ip }),
      ).rejects.toMatchObject({
        code: V1_ERROR_CODES.RATE_LIMITED,
        status: 429,
        details: { window: 'login-ip', retryAfterSeconds: 840 },
      });
    }
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(32);
    expect(
      await db.authRateWindow.count({ where: { kind: 'register-ip', keyHash: hashSecret(ip) } }),
    ).toBe(0);
    expect(
      await db.authRateWindow.count({
        where: { kind: 'login-email', keyHash: emailKey(blockedEmail) },
      }),
    ).toBe(0);
    expect(await db.user.findUnique({ where: { email: blockedEmail } })).toBeNull();
    expect((await repository.findSession(blockedSession.id))!.revokedAt).toBeNull();
    expect(await db.webSession.count({ where: { userId: registered.user.id } })).toBe(16);
  });

  it('admits exactly 30 of 40 concurrent mixed requests before their account checks', async () => {
    const user = await createAccount();
    const session = await anonymous();
    const ip = uniqueIp();
    const outcomes = await Promise.allSettled(
      Array.from({ length: 40 }, (_, index) =>
        request(index < 5 ? 'login' : 'register', {
          email: user.email,
          password: index < 5 ? `${password}-wrong` : password,
          session,
          ip,
        }),
      ),
    );
    const errors = outcomes.map((outcome) => {
      expect(outcome.status).toBe('rejected');
      if (outcome.status !== 'rejected') throw new Error('An invalid request created a session');
      expect(outcome.reason).toBeInstanceOf(WorkmeshError);
      return outcome.reason as WorkmeshError;
    });
    const limited = errors.filter((error) => error.code === V1_ERROR_CODES.RATE_LIMITED);
    expect(limited).toHaveLength(10);
    for (const error of limited) {
      expect(error.status).toBe(429);
      expect(error.details).toMatchObject({ window: 'login-ip', retryAfterSeconds: 840 });
    }
    const wrongPasswords = errors.filter((error) => error.code === V1_ERROR_CODES.AUTH_INVALID);
    const duplicateRegistrations = errors.filter(
      (error) => error.code === V1_ERROR_CODES.EMAIL_IN_USE,
    );
    expect(wrongPasswords.length + duplicateRegistrations.length).toBe(30);
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(40);
    const emailWindow = await db.authRateWindow.findFirst({
      where: { kind: 'login-email', keyHash: emailKey(user.email), windowStart },
    });
    expect(emailWindow?.attempts ?? 0).toBe(wrongPasswords.length);
    expect(
      await db.authRateWindow.count({ where: { kind: 'register-ip', keyHash: hashSecret(ip) } }),
    ).toBe(0);
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(0);
    expect((await repository.findSession(session.id))!.revokedAt).toBeNull();
  });

  it('preserves both old counters and allows only their one remaining combined attempt', async () => {
    const user = await createAccount();
    const ip = uniqueIp();
    const session = await anonymous();
    await seed('login-ip', ip, 7);
    const legacy = await seed('register-ip', ip, 22);
    const result = await request('login', { email: user.email, password, session, ip });
    expect(result.user.id).toBe(user.id);
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(8);
    const blockedSession = await anonymous();
    for (const action of ['register', 'login'] as const) {
      await expect(
        request(action, { email: user.email, password, session: blockedSession, ip }),
      ).rejects.toMatchObject({
        code: V1_ERROR_CODES.RATE_LIMITED,
        status: 429,
        details: { window: 'login-ip', retryAfterSeconds: 840 },
      });
    }
    expect(await db.authRateWindow.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(10);
    expect((await row('login-email', emailKey(user.email))).attempts).toBe(0);
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it('reads later committed legacy usage on each new-node request', async () => {
    const user = await createAccount();
    const session = await anonymous();
    const ip = uniqueIp();
    const legacy = await seed('register-ip', ip, 10);
    await request('login', { email: user.email, password, session, ip });
    await db.authRateWindow.update({ where: { id: legacy.id }, data: { attempts: 29 } });
    const blockedSession = await anonymous();
    await expect(
      request('register', { email: user.email, password, session: blockedSession, ip }),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.RATE_LIMITED,
      status: 429,
      details: { window: 'login-ip', retryAfterSeconds: 840 },
    });
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(2);
    expect((await row('register-ip', hashSecret(ip))).attempts).toBe(29);
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it('returns one second at the old boundary and starts a separate budget in the next window', async () => {
    const user = await createAccount();
    const ip = uniqueIp();
    const boundary = new Date('2026-11-07T00:14:59.999Z');
    const oldSession = await anonymous(boundary);
    await seed('login-ip', ip, 29);
    const legacy = await seed('register-ip', ip, 1);
    await expect(
      request('register', { email: user.email, password, session: oldSession, ip, now: boundary }),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.RATE_LIMITED,
      status: 429,
      details: { window: 'login-ip', retryAfterSeconds: 1 },
    });
    const freshSession = await anonymous(nextWindow);
    const result = await request('login', {
      email: user.email,
      password,
      session: freshSession,
      ip,
      now: nextWindow,
    });
    expect(result.user.id).toBe(user.id);
    expect((await row('login-ip', hashSecret(ip))).attempts).toBe(30);
    expect((await row('login-ip', hashSecret(ip), nextWindow)).attempts).toBe(1);
    expect(await db.authRateWindow.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(legacy);
    expect((await row('login-email', emailKey(user.email), nextWindow)).attempts).toBe(0);
    expect((await repository.findSession(oldSession.id))!.revokedAt).toBeNull();
    expect((await repository.findSession(freshSession.id))!.revokedAt).toEqual(nextWindow);
  });
});
