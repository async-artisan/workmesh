import { describe, expect, it, vi } from 'vitest';
import { WorkmeshError } from '@workmesh/shared';
import { ReadinessService } from './readiness.service';
import type { PrismaService } from '../prisma/prisma.service';

type Probe = () => Promise<unknown>;

/**
 * `$queryRaw` 在服务里是 tagged template 调用：第一次是连通性探针，第二次是迁移计数。
 * 这里按调用序返回对应行为，能精确构造「连得上但没迁移」这类关键分支。
 */
function prismaWith(input: { connectivity?: Probe; migrations?: Probe }): PrismaService {
  let call = 0;
  const $queryRaw = vi.fn(async () => {
    call += 1;
    if (call === 1) return input.connectivity ? await input.connectivity() : [{ '?column?': 1 }];
    return input.migrations ? await input.migrations() : [{ applied: 12 }];
  });
  return { $queryRaw } as unknown as PrismaService;
}

async function reasonOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (caught) {
    expect(caught).toBeInstanceOf(WorkmeshError);
    const error = caught as WorkmeshError;
    expect(error.status).toBe(503);
    return error.details?.reason;
  }
  throw new Error('expected readiness check to reject');
}

describe('readiness probe', () => {
  it('reports applied migrations when the database and schema are usable', async () => {
    const service = new ReadinessService(prismaWith({}));
    const report = await service.check();
    expect(report.ok).toBe(true);
    expect(report.database).toEqual({ reachable: true, appliedMigrations: 12 });
    expect(typeof report.checkedAt).toBe('string');
  });

  it('returns 503 CONNECT_FAILED when the database is unreachable', async () => {
    const service = new ReadinessService(
      prismaWith({
        connectivity: () => Promise.reject(new Error('P1001: can not reach database server')),
      }),
    );
    await expect(reasonOf(service.check())).resolves.toBe('CONNECT_FAILED');
  });

  it('returns 503 SCHEMA_NOT_MIGRATED when the migrations table is missing', async () => {
    const service = new ReadinessService(
      prismaWith({
        migrations: () =>
          Promise.reject(new Error('relation "workmesh_v1._prisma_migrations" does not exist')),
      }),
    );
    await expect(reasonOf(service.check())).resolves.toBe('SCHEMA_NOT_MIGRATED');
  });

  it('returns 503 SCHEMA_NOT_MIGRATED when no migration has been applied', async () => {
    const service = new ReadinessService(
      prismaWith({ migrations: () => Promise.resolve([{ applied: 0 }]) }),
    );
    await expect(reasonOf(service.check())).resolves.toBe('SCHEMA_NOT_MIGRATED');
  });

  it('returns 503 TIMEOUT when the probe exceeds the deadline', async () => {
    const service = new ReadinessService(
      prismaWith({ connectivity: () => new Promise<never>(() => undefined) }),
    );
    await expect(reasonOf(service.check({ timeoutMs: 20 }))).resolves.toBe('TIMEOUT');
  });

  it('never leaks the underlying driver message in the error payload', async () => {
    const service = new ReadinessService(
      prismaWith({
        connectivity: () =>
          Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432 workmesh secret')),
      }),
    );
    const caught = await service.check().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(WorkmeshError);
    const error = caught as WorkmeshError;
    expect(error.status).toBe(503);
    expect(error.details).toEqual({
      dependency: 'postgresql',
      reason: 'CONNECT_FAILED',
      checkedAt: expect.any(String),
    });
    expect(JSON.stringify({ message: error.message, details: error.details })).not.toContain(
      'ECONNREFUSED',
    );
  });

  it.each([0, -1, 1.5, 60_000])(
    'clamps an out-of-range timeout instead of failing: %s',
    async (timeoutMs) => {
      const service = new ReadinessService(prismaWith({}));
      await expect(service.check({ timeoutMs })).resolves.toMatchObject({ ok: true });
    },
  );
});
