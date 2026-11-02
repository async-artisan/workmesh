import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { V1AuthorizationService } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { percentile, V1FlowMetricsService } from './v1-flow-metrics.service';

const NOW = new Date('2026-11-03T00:00:00.000Z');
const HOUR = 3_600_000;
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';

function at(hoursAgo: number): Date {
  return new Date(NOW.getTime() - hoursAgo * HOUR);
}

function build() {
  const prisma = {
    requirement: {
      findMany: async () => [
        { id: 'r1', createdAt: at(10) },
        { id: 'r2', createdAt: at(4) },
      ],
    },
    workflowInstance: {
      findMany: async () => [{ id: 'i1', requirementId: 'r1' }],
    },
    task: {
      findMany: async () => [
        { id: 't1', workflowInstanceId: 'i1' },
        { id: 't2', workflowInstanceId: 'i1' },
      ],
      groupBy: async () => [
        { executionStatus: 'OPEN', _count: { _all: 2 } },
        { executionStatus: 'IN_PROGRESS', _count: { _all: 1 } },
        { executionStatus: 'DONE', _count: { _all: 9 } },
      ],
    },
    taskClaim: {
      findMany: async () => [{ taskId: 't1', claimedAt: at(8) }],
    },
    artifactSet: {
      findMany: async () => [{ taskId: 't1', createdAt: at(5) }],
    },
    reviewRequest: {
      findMany: async () => [{ id: 'rv1', taskId: 't1' }],
    },
    reviewDecision: {
      findMany: async () => [{ reviewRequestId: 'rv1', createdAt: at(3) }],
    },
    changeEvent: { count: async () => 3 },
    changeRecipient: {
      count: async () => 4,
      findMany: async () => [
        { createdAt: at(10), ackedAt: at(8) },
        { createdAt: at(9), ackedAt: at(5) },
      ],
    },
  };
  const authorization = {
    resolveProjectContext: async () => undefined,
    requireScope: async () => undefined,
  } as unknown as V1AuthorizationService;
  const service = new V1FlowMetricsService(prisma as unknown as PrismaService, authorization);
  return { service };
}

describe('流程度量', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('按需求取首次认领/交付/批准的时间差', async () => {
    const { service } = build();
    const metrics = await service.flow({} as never, PROJECT_ID, 30);

    expect(metrics.requirements).toEqual({ created: 2, claimed: 1, delivered: 1, approved: 1 });
    expect(metrics.durationsHours.toFirstClaim).toEqual({ samples: 1, p50: 2, p90: 2 });
    expect(metrics.durationsHours.claimToDelivery).toEqual({ samples: 1, p50: 3, p90: 3 });
    expect(metrics.durationsHours.deliveryToApproval).toEqual({ samples: 1, p50: 2, p90: 2 });
    expect(metrics.durationsHours.leadTime).toEqual({ samples: 1, p50: 7, p90: 7 });
  });

  it('WIP 只统计未完成状态', async () => {
    const { service } = build();
    const metrics = await service.flow({} as never, PROJECT_ID, 30);
    expect(metrics.wip).toEqual({ OPEN: 2, IN_PROGRESS: 1, REVIEW_PENDING: 0 });
  });

  it('变更确认率与平均确认时长', async () => {
    const { service } = build();
    const metrics = await service.flow({} as never, PROJECT_ID, 30);
    expect(metrics.changes).toMatchObject({
      events: 3,
      recipients: 4,
      acked: 2,
      ackRate: 0.5,
      avgAckHours: 3,
    });
  });

  it('无样本时返回 null 而不是 0', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30], 90)).toBe(30);
  });
});
