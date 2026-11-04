import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 单次 sweep 里每张表最多处理多少批，避免一次跑太久占着连接。 */
const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

/** 保留窗口。票据本身 5–15 分钟就过期，留一周足够排查；会话留 30 天。 */
const RATE_WINDOW_GRACE_MS = 60 * 60 * 1000;
const TICKET_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type RetentionReport = {
  authRateWindows: number;
  confirmationTickets: number;
  webSessions: number;
};

/**
 * 过期数据清理。
 *
 * `AuthRateWindow` 每次登录/失败尝试都会 upsert 一行（匿名请求也会写 login-ip / login-email），
 * `WebSession`、`ConfirmationTicket` 同样只增不减；再叠加 HOSTED 正文入库与审计只增不减，
 * 库和备份会持续膨胀。这里清掉三类**纯瞬态**数据。
 *
 * 明确不清理：
 * - `AuditEvent`、`ChangeEvent`：产品的立命之本，永不自动删除。
 * - `IdempotentOperation`：操作收据是"有据可查"的凭据，留多少天是产品策略，
 *   不该由这个定时任务单方面决定。
 * - 仍被审计记录引用的行：有 `ReviewDecision` 指向的票据、有 `PrincipalStamp`（或
 *   票据/CLI 视图）指向的会话都保留——删掉会直接破坏审计链，或触发外键拒绝。
 */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // 测试与显式关闭时不挂定时器；sweep 仍可被直接调用（测试也正是这么用的）。
    if (!this.enabled()) return;
    const interval = Number(process.env.WORKMESH_RETENTION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
    const intervalMs =
      Number.isSafeInteger(interval) && interval >= 60_000 ? interval : DEFAULT_INTERVAL_MS;
    this.timer = setInterval(() => {
      void this.sweep().catch((error: unknown) => {
        this.logger.warn(
          `过期数据清理失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, intervalMs);
    // 不让清理定时器把进程钉住。
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private enabled(): boolean {
    if (process.env.WORKMESH_RETENTION_DISABLED === '1') return false;
    return process.env.NODE_ENV !== 'test';
  }

  /** 分批删除：先取一批 id 再按 id 删，避免单条语句长时间持锁。 */
  private async drain(
    findIds: (take: number) => Promise<string[]>,
    deleteIds: (ids: string[]) => Promise<{ count: number }>,
  ): Promise<number> {
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const ids = await findIds(BATCH_SIZE);
      if (ids.length === 0) break;
      const deleted = await deleteIds(ids);
      total += deleted.count;
      if (ids.length < BATCH_SIZE) break;
    }
    return total;
  }

  async sweep(now: Date = new Date()): Promise<RetentionReport> {
    const rateCutoff = new Date(now.getTime() - RATE_WINDOW_GRACE_MS);
    const ticketCutoff = new Date(now.getTime() - TICKET_GRACE_MS);
    const sessionCutoff = new Date(now.getTime() - SESSION_GRACE_MS);

    const authRateWindows = await this.drain(
      async (take) =>
        (
          await this.prisma.authRateWindow.findMany({
            where: { expiresAt: { lt: rateCutoff } },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      (ids) => this.prisma.authRateWindow.deleteMany({ where: { id: { in: ids } } }),
    );

    // 有 ReviewDecision 指向的票据保留：它是那条决定的凭据来源。
    const confirmationTickets = await this.drain(
      async (take) =>
        (
          await this.prisma.confirmationTicket.findMany({
            where: { expiresAt: { lt: ticketCutoff }, decisions: { none: {} } },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      (ids) => this.prisma.confirmationTicket.deleteMany({ where: { id: { in: ids } } }),
    );

    // 会话被审计记录引用（stamp/票据/CLI 视图）就必须保留，否则外键会拒绝、审计链也会断。
    const webSessions = await this.drain(
      async (take) =>
        (
          await this.prisma.webSession.findMany({
            where: {
              expiresAt: { lt: sessionCutoff },
              stamps: { none: {} },
              tickets: { none: {} },
              cliViews: { none: {} },
            },
            select: { id: true },
            take,
          })
        ).map((row) => row.id),
      (ids) => this.prisma.webSession.deleteMany({ where: { id: { in: ids } } }),
    );

    const report = { authRateWindows, confirmationTickets, webSessions };
    if (authRateWindows + confirmationTickets + webSessions > 0)
      this.logger.log(
        `过期数据清理：限流窗口 ${authRateWindows}、票据 ${confirmationTickets}、会话 ${webSessions}`,
      );
    return report;
  }
}
