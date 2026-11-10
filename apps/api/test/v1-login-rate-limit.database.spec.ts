import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { RATE_WINDOW_15M, V1AccountService } from '../src/auth/v1-account.service';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import type { V1SessionRecord } from '../src/auth/v1-auth.repository';
import { SESSION_ABSOLUTE_TIMEOUT_MS, SESSION_IDLE_TIMEOUT_MS } from '../src/auth/v1-cookie-policy';
import { hashSecret } from '../src/auth/v1-policy';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = evaluateSuiteTestDatabase().ok ? describe.sequential : describe.skip;
const now = new Date('2026-11-07T00:01:00.000Z');
const windowStart = new Date('2026-11-07T00:00:00.000Z');
const nextWindow = new Date('2026-11-07T00:15:00.000Z');

suite('PostgreSQL login failure budget with real password comparisons', () => {
  let db: PrismaClient;
  let repository: V1AuthPrismaRepository;
  let service: V1AccountService;
  let passwordHash: string;
  const password = `valid-password-${randomUUID()}`;
  const userIds = new Set<string>();
  const emails = new Set<string>();
  const anonymousSessionIds = new Set<string>();
  const rateWindows = new Map<string, { kind: string; keyHash: string; windowStart: Date }>();

  const uniqueEmail = () => {
    const email = `login-budget-${randomUUID()}@example.invalid`;
    emails.add(email);
    return email;
  };
  const uniqueIp = () =>
    `2001:db8:${randomUUID().replaceAll('-', '').slice(0, 24).match(/.{4}/g)!.join(':')}`;
  const emailKey = (email: string) => hashSecret(hashSecret(email.trim().toLowerCase()));
  const rememberRateWindow = (kind: string, keyHash: string, at: Date) => {
    const start = new Date(Math.floor(at.getTime() / RATE_WINDOW_15M) * RATE_WINDOW_15M);
    rateWindows.set(`${kind}:${keyHash}:${start.toISOString()}`, {
      kind,
      keyHash,
      windowStart: start,
    });
  };
  const rateRow = (kind: string, keyHash: string, start = windowStart) =>
    db.authRateWindow.findFirstOrThrow({ where: { kind, keyHash, windowStart: start } });

  const createAccount = async () => {
    const id = randomUUID();
    const email = uniqueEmail();
    userIds.add(id);
    return db.user.create({ data: { id, email, passwordHash } });
  };
  const createAnonymousSession = async (at = now): Promise<V1SessionRecord> => {
    const id = randomUUID();
    anonymousSessionIds.add(id);
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
    const session = await repository.findSession(id);
    expect(session).not.toBeNull();
    return session!;
  };
  const login = (input: {
    email: string;
    password: string;
    session: V1SessionRecord;
    ip: string;
    now?: Date;
  }) => {
    const at = input.now ?? now;
    rememberRateWindow('login-ip', hashSecret(input.ip), at);
    rememberRateWindow('login-email', emailKey(input.email), at);
    return service.login({ ...input, now: at });
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
      if (anonymousSessionIds.size || userIds.size || emails.size) {
        await db.webSession.deleteMany({
          where: {
            OR: [
              { id: { in: [...anonymousSessionIds] } },
              { userId: { in: [...userIds] } },
              { user: { email: { in: [...emails] } } },
            ],
          },
        });
        await db.user.deleteMany({
          where: { OR: [{ id: { in: [...userIds] } }, { email: { in: [...emails] } }] },
        });
      }
      if (rateWindows.size) {
        await db.authRateWindow.deleteMany({ where: { OR: [...rateWindows.values()] } });
      }
    } finally {
      await db.$disconnect();
    }
  });

  it('allows six correct logins, rotates persisted sessions and leaves no email failures', async () => {
    const user = await createAccount();
    const ip = uniqueIp();
    let session = await createAnonymousSession();
    for (let attempt = 0; attempt < 6; attempt++) {
      const previous = session;
      const result = await login({
        email: `  ${user.email.toUpperCase()}  `,
        password,
        session: previous,
        ip,
      });
      expect(result.user.id).toBe(user.id);
      expect(result.cookies.sessionId).not.toBe(previous.id);
      const persisted = await repository.findSession(result.cookies.sessionId);
      expect(persisted).toMatchObject({
        userId: user.id,
        userAuthVersion: user.authVersion,
        revokedAt: null,
        expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS),
        idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS),
      });
      const cookie = /^wm_s1.([0-9a-f-]{36}).([A-Za-z0-9_-]{43})$/.exec(
        result.cookies.sessionCookie,
      );
      expect(cookie).not.toBeNull();
      expect(cookie![1]).toBe(persisted!.id);
      expect(persisted!.tokenHash).toBe(hashSecret(cookie![2]));
      expect(persisted!.csrfTokenHash).toBe(hashSecret(result.cookies.csrfToken));
      expect(result.cookies.csrfCookie).toBe(result.cookies.csrfToken);
      expect((await repository.findSession(previous.id))!.revokedAt).toEqual(now);
      session = persisted!;
    }
    expect((await rateRow('login-email', emailKey(user.email))).attempts).toBe(0);
    expect((await rateRow('login-ip', hashSecret(ip))).attempts).toBe(6);
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(6);
    expect(await db.webSession.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });

  it('keeps failures across different IPs and a successful login refunds only itself', async () => {
    const user = await createAccount();
    let session = await createAnonymousSession();
    const fail = () =>
      expect(
        login({ email: user.email, password: `${password}-wrong`, session, ip: uniqueIp() }),
      ).rejects.toMatchObject({ code: V1_ERROR_CODES.AUTH_INVALID, status: 401 });
    await fail();
    await fail();
    const successful = await login({ email: user.email, password, session, ip: uniqueIp() });
    session = (await repository.findSession(successful.cookies.sessionId))!;
    expect((await rateRow('login-email', emailKey(user.email))).attempts).toBe(2);
    for (let attempt = 0; attempt < 3; attempt++) await fail();
    const blockedSession = await createAnonymousSession();
    await expect(
      login({ email: user.email, password, session: blockedSession, ip: uniqueIp() }),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.RATE_LIMITED,
      status: 429,
      details: { window: 'login-email', retryAfterSeconds: 840 },
    });
    expect((await rateRow('login-email', emailKey(user.email))).attempts).toBe(5);
    expect((await repository.findSession(blockedSession.id))!.revokedAt).toBeNull();
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it('atomically admits only five of 24 concurrent wrong logins and counts every IP attempt', async () => {
    const user = await createAccount();
    const session = await createAnonymousSession();
    const ip = uniqueIp();
    const results = await Promise.allSettled(
      Array.from({ length: 24 }, () =>
        login({ email: user.email, password: `${password}-wrong`, session, ip }),
      ),
    );
    const errors = results.map((result) => {
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('A wrong password created a session');
      expect(result.reason).toBeInstanceOf(WorkmeshError);
      return result.reason as WorkmeshError;
    });
    expect(errors.filter((error) => error.code === V1_ERROR_CODES.AUTH_INVALID)).toHaveLength(5);
    const limited = errors.filter((error) => error.code === V1_ERROR_CODES.RATE_LIMITED);
    expect(limited).toHaveLength(19);
    for (const error of limited) {
      expect(error.status).toBe(429);
      expect(error.details).toMatchObject({ window: 'login-email', retryAfterSeconds: 840 });
    }
    expect((await rateRow('login-email', emailKey(user.email))).attempts).toBe(5);
    expect((await rateRow('login-ip', hashSecret(ip))).attempts).toBe(24);
    expect(await db.webSession.count({ where: { userId: user.id } })).toBe(0);
    expect((await repository.findSession(session.id))!.revokedAt).toBeNull();
  });

  it('rejects unknown accounts with the same error and creates no account or authenticated session', async () => {
    const email = uniqueEmail();
    const session = await createAnonymousSession();
    const ip = uniqueIp();
    await expect(login({ email, password, session, ip })).rejects.toMatchObject({
      code: V1_ERROR_CODES.AUTH_INVALID,
      status: 401,
      message: '邮箱或密码不正确',
    });
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
    expect(await db.webSession.count({ where: { user: { email } } })).toBe(0);
    expect(await repository.findSession(session.id)).toMatchObject({
      userId: null,
      userAuthVersion: null,
      revokedAt: null,
    });
    expect((await rateRow('login-email', emailKey(email))).attempts).toBe(1);
    expect((await rateRow('login-ip', hashSecret(ip))).attempts).toBe(1);
  });

  it('honors pre-existing email keys and recovers next window without erasing their failures', async () => {
    const user = await createAccount();
    const session = await createAnonymousSession();
    const ip = uniqueIp();
    const keyHash = emailKey(user.email);
    rememberRateWindow('login-email', keyHash, now);
    await db.authRateWindow.create({
      data: {
        kind: 'login-email',
        keyHash,
        windowStart,
        attempts: 5,
        expiresAt: nextWindow,
      },
    });
    await expect(login({ email: user.email, password, session, ip })).rejects.toMatchObject({
      code: V1_ERROR_CODES.RATE_LIMITED,
      status: 429,
    });
    const freshSession = await createAnonymousSession(nextWindow);
    const result = await login({
      email: user.email,
      password,
      session: freshSession,
      ip,
      now: nextWindow,
    });
    expect(result.user.id).toBe(user.id);
    expect((await rateRow('login-email', keyHash)).attempts).toBe(5);
    expect((await rateRow('login-email', keyHash, nextWindow)).attempts).toBe(0);
    expect((await repository.findSession(session.id))!.revokedAt).toBeNull();
    expect((await repository.findSession(freshSession.id))!.revokedAt).toEqual(nextWindow);
    expect((await repository.findSession(result.cookies.sessionId))!.userId).toBe(user.id);
  });
});
