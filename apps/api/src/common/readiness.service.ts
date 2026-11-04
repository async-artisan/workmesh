import { Injectable } from '@nestjs/common';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 就绪失败原因。故意只暴露枚举值，不回传底层错误文本——
 * 该端点未认证，Prisma 的连接错误会带主机名/端口/库名。
 */
export type ReadinessFailureReason = 'CONNECT_FAILED' | 'SCHEMA_NOT_MIGRATED' | 'TIMEOUT';

export type ReadinessReport = {
  ok: true;
  database: { reachable: true; appliedMigrations: number };
  checkedAt: string;
};

const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 10_000;

/** 探针内部错误：只承载可安全外泄的原因码。 */
class ReadinessProbeError extends Error {
  constructor(readonly reason: ReadinessFailureReason) {
    super(reason);
    this.name = 'ReadinessProbeError';
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadinessProbeError('TIMEOUT')), timeoutMs);
    // 超时后底层查询仍会继续；这里挂上处理器，避免它稍后失败时变成未处理的拒绝。
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 就绪探针：只回答「现在能不能干活」，不回答「进程是否活着」。
   *
   * 与 `/api/health`（liveness）分工，参照 Kubernetes 的 liveness/readiness 语义：
   * liveness 失败要重启进程，所以绝不能查数据库——否则数据库抖动会让整个实例被连环重启；
   * 依赖是否可用属于 readiness，失败时摘流量即可，不重启。
   */
  async check(input: { timeoutMs?: number } = {}): Promise<ReadinessReport> {
    const requested = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timeoutMs = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;
    const checkedAt = new Date().toISOString();
    try {
      const appliedMigrations = await withTimeout(this.probe(), timeoutMs);
      return { ok: true, database: { reachable: true, appliedMigrations }, checkedAt };
    } catch (caught) {
      const reason: ReadinessFailureReason =
        caught instanceof ReadinessProbeError ? caught.reason : 'CONNECT_FAILED';
      throw new WorkmeshError(
        V1_ERROR_CODES.DEPENDENCY_UNAVAILABLE,
        '数据库尚未就绪',
        { dependency: 'postgresql', reason, checkedAt },
        503,
      );
    }
  }

  /**
   * 两步探针：先确认连接，再确认 schema 真的迁移过。
   * 只做 SELECT 1 会把「库是空的、迁移没 apply」误判为健康——这正是原先的假绿来源。
   */
  private async probe(): Promise<number> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ReadinessProbeError('CONNECT_FAILED');
    }

    let rows: { applied: number }[];
    try {
      rows = await this.prisma.$queryRaw<{ applied: number }[]>`
        SELECT COUNT(*)::int AS applied
        FROM "workmesh_v1"."_prisma_migrations"
        WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
      `;
    } catch {
      // 迁移表本身不存在（空库 / 只建了库没跑 migrate）也归到这里。
      throw new ReadinessProbeError('SCHEMA_NOT_MIGRATED');
    }

    const applied = rows[0]?.applied ?? 0;
    if (applied <= 0) throw new ReadinessProbeError('SCHEMA_NOT_MIGRATED');
    return applied;
  }
}
