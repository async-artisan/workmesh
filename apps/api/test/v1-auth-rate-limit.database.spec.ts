import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthPrismaRepository } from '../src/auth/v1-auth.prisma-repository';
import type { V1PasswordRateReservation } from '../src/auth/v1-auth.repository';
import { evaluateSuiteTestDatabase, verifiedTestDatabase } from '../src/common/v1-test-database';
import { PrismaService } from '../src/prisma/prisma.service';

const suite = evaluateSuiteTestDatabase().ok ? describe : describe.skip;
const windowMs = 15 * 60 * 1000;
const kind = 'password-verify-session';
const now = new Date('2026-11-07T00:01:00.000Z');

suite('PostgreSQL password verification failure budget', () => {
  let db: PrismaClient;
  let repository: V1AuthPrismaRepository;
  const keys = new Set<string>();
  const key = () => {
    const value = createHash('sha256').update(randomUUID()).digest('hex');
    keys.add(value);
    return value;
  };
  const input = (keyHash: string, at = now) => ({
    kind,
    keyHash,
    now: at,
    windowMs,
    limit: 5,
  });
  const admitted = (items: Array<V1PasswordRateReservation | null>) =>
    items.filter((item): item is V1PasswordRateReservation => item !== null);

  beforeAll(async () => {
    const target = verifiedTestDatabase();
    db = new PrismaClient({ datasources: { db: { url: target.url } } });
    const rows = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(rows[0].name).toBe(target.database);
    repository = new V1AuthPrismaRepository(db as PrismaService);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (keys.size) await db.authRateWindow.deleteMany({ where: { keyHash: { in: [...keys] } } });
    } finally {
      await db.$disconnect();
    }
  });

  it('admits at most five concurrent checks and rejected requests do not inflate the counter', async () => {
    const keyHash = key();
    const reservations = admitted(
      await Promise.all(
        Array.from({ length: 24 }, () => repository.reservePasswordRateWindow(input(keyHash))),
      ),
    );
    expect(reservations).toHaveLength(5);
    const row = await db.authRateWindow.findFirstOrThrow({ where: { kind, keyHash } });
    expect(row.attempts).toBe(5);
    expect(row.windowStart).toEqual(new Date('2026-11-07T00:00:00.000Z'));
    expect(row.expiresAt).toEqual(new Date('2026-11-07T00:15:00.000Z'));
    expect(await repository.reservePasswordRateWindow(input(keyHash))).toBeNull();
    expect((await db.authRateWindow.findUniqueOrThrow({ where: { id: row.id } })).attempts).toBe(5);
  });

  it('concurrent successful refunds preserve the failed checks and never admit over the budget', async () => {
    const keyHash = key();
    const reservations = admitted(
      await Promise.all(
        Array.from({ length: 5 }, () => repository.reservePasswordRateWindow(input(keyHash))),
      ),
    );
    expect(reservations).toHaveLength(5);
    const [, , attempts] = await Promise.all([
      repository.releasePasswordRateWindow(reservations[0]),
      repository.releasePasswordRateWindow(reservations[1]),
      Promise.all(
        Array.from({ length: 20 }, () => repository.reservePasswordRateWindow(input(keyHash))),
      ),
    ]);
    const extra = admitted(attempts).length;
    expect(extra).toBeLessThanOrEqual(2);
    const afterRace = await db.authRateWindow.findFirstOrThrow({ where: { kind, keyHash } });
    expect(afterRace.attempts).toBe(3 + extra);
    const remainder = admitted(
      await Promise.all(
        Array.from({ length: 5 }, () => repository.reservePasswordRateWindow(input(keyHash))),
      ),
    );
    expect(remainder).toHaveLength(2 - extra);
    expect(
      (await db.authRateWindow.findUniqueOrThrow({ where: { id: afterRace.id } })).attempts,
    ).toBe(5);
  });

  it('refunds the original window when a password comparison crosses a window boundary', async () => {
    const keyHash = key();
    const old = await repository.reservePasswordRateWindow(
      input(keyHash, new Date('2026-11-07T00:14:59.999Z')),
    );
    expect(old).not.toBeNull();
    const newWindow = new Date('2026-11-07T00:15:00.000Z');
    const [, attempts] = await Promise.all([
      repository.releasePasswordRateWindow(old!),
      Promise.all(
        Array.from({ length: 12 }, () =>
          repository.reservePasswordRateWindow(input(keyHash, newWindow)),
        ),
      ),
    ]);
    expect(admitted(attempts)).toHaveLength(5);
    const rows = await db.authRateWindow.findMany({
      where: { kind, keyHash },
      orderBy: { windowStart: 'asc' },
    });
    expect(rows.map((row) => row.attempts)).toEqual([0, 5]);
    expect(rows[1].windowStart).toEqual(newWindow);
  });

  it('recovers in the next window without clearing failures belonging to other sessions or login', async () => {
    const keyHash = key();
    const otherKey = key();
    await Promise.all(
      Array.from({ length: 5 }, () => repository.reservePasswordRateWindow(input(keyHash))),
    );
    const other = await repository.reservePasswordRateWindow(input(otherKey));
    await repository.bumpRateWindow({ kind: 'login-email', keyHash, now, windowMs });
    const next = await repository.reservePasswordRateWindow(
      input(keyHash, new Date('2026-11-07T00:15:00.000Z')),
    );
    expect(next).not.toBeNull();
    await repository.releasePasswordRateWindow(next!);
    expect(
      (
        await db.authRateWindow.findFirstOrThrow({
          where: { kind, keyHash, windowStart: new Date('2026-11-07T00:00:00.000Z') },
        })
      ).attempts,
    ).toBe(5);
    expect(
      (await db.authRateWindow.findFirstOrThrow({ where: { kind, keyHash: otherKey } })).attempts,
    ).toBe(1);
    expect(
      (await db.authRateWindow.findFirstOrThrow({ where: { kind: 'login-email', keyHash } }))
        .attempts,
    ).toBe(1);
    expect(other).not.toBeNull();
  });
});
