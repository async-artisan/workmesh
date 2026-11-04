import { describe, expect, it } from 'vitest';
import { RetentionService } from './retention.service';
import type { PrismaService } from '../prisma/prisma.service';

type Recorded = { model: string; op: string; where?: Record<string, unknown> };

function fakePrisma(input: {
  authRateWindows?: string[];
  confirmationTickets?: string[];
  webSessions?: string[];
}) {
  const recorded: Recorded[] = [];
  const build = (model: string, ids: string[]) => {
    let remaining = [...ids];
    return {
      findMany: async (args: { where?: Record<string, unknown>; take: number }) => {
        recorded.push({ model, op: 'findMany', where: args.where });
        const page = remaining.slice(0, args.take);
        remaining = remaining.slice(page.length);
        return page.map((id) => ({ id }));
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        recorded.push({ model, op: 'deleteMany' });
        return { count: args.where.id.in.length };
      },
    };
  };
  return {
    prisma: {
      authRateWindow: build('authRateWindow', input.authRateWindows ?? []),
      confirmationTicket: build('confirmationTicket', input.confirmationTickets ?? []),
      webSession: build('webSession', input.webSessions ?? []),
    } as unknown as PrismaService,
    recorded,
  };
}

describe('RetentionService', () => {
  it('removes expired transient rows and reports how many', async () => {
    const { prisma } = fakePrisma({
      authRateWindows: ['w1', 'w2'],
      confirmationTickets: ['t1'],
      webSessions: ['s1', 's2', 's3'],
    });
    const report = await new RetentionService(prisma).sweep(new Date('2026-11-04T00:00:00Z'));
    expect(report).toEqual({ authRateWindows: 2, confirmationTickets: 1, webSessions: 3 });
  });

  it('never touches tickets that a decision points at', async () => {
    const { prisma, recorded } = fakePrisma({ confirmationTickets: ['t1'] });
    await new RetentionService(prisma).sweep();
    const where = recorded.find(
      (item) => item.model === 'confirmationTicket' && item.op === 'findMany',
    )?.where;
    // 有 ReviewDecision 引用的票据是那条决定的凭据来源，删掉等于毁掉审计链。
    expect(where).toMatchObject({ decisions: { none: {} } });
  });

  it('never touches sessions still referenced by audit rows', async () => {
    const { prisma, recorded } = fakePrisma({ webSessions: ['s1'] });
    await new RetentionService(prisma).sweep();
    const where = recorded.find(
      (item) => item.model === 'webSession' && item.op === 'findMany',
    )?.where;
    expect(where).toMatchObject({
      stamps: { none: {} },
      tickets: { none: {} },
      cliViews: { none: {} },
    });
  });

  it('applies the retention windows relative to the given time', async () => {
    const { prisma, recorded } = fakePrisma({ authRateWindows: ['w1'] });
    const now = new Date('2026-11-04T00:00:00Z');
    await new RetentionService(prisma).sweep(now);
    const where = recorded.find((item) => item.model === 'authRateWindow' && item.op === 'findMany')
      ?.where as { expiresAt: { lt: Date } };
    // 限流窗口只保留一小时余量。
    expect(where.expiresAt.lt.toISOString()).toBe('2026-11-03T23:00:00.000Z');
  });

  it('keeps draining in batches until the table is clear', async () => {
    const ids = Array.from({ length: 1200 }, (_, index) => `w${index}`);
    const { prisma, recorded } = fakePrisma({ authRateWindows: ids });
    const report = await new RetentionService(prisma).sweep();
    expect(report.authRateWindows).toBe(1200);
    // 500 + 500 + 200 三批。
    expect(recorded.filter((item) => item.op === 'deleteMany')).toHaveLength(3);
  });

  it('does nothing and reports zeros when there is nothing to remove', async () => {
    const { prisma, recorded } = fakePrisma({});
    const report = await new RetentionService(prisma).sweep();
    expect(report).toEqual({ authRateWindows: 0, confirmationTickets: 0, webSessions: 0 });
    expect(recorded.filter((item) => item.op === 'deleteMany')).toHaveLength(0);
  });
});
