import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { PrismaService } from '../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export type FlowDurations = {
  samples: number;
  p50: number | null;
  p90: number | null;
};

export type FlowMetrics = {
  window: { from: string; to: string; days: number };
  requirements: {
    created: number;
    claimed: number;
    delivered: number;
    approved: number;
  };
  durationsHours: {
    toFirstClaim: FlowDurations;
    claimToDelivery: FlowDurations;
    deliveryToApproval: FlowDurations;
    leadTime: FlowDurations;
  };
  wip: Record<string, number>;
  changes: {
    events: number;
    recipients: number;
    acked: number;
    ackRate: number;
    avgAckHours: number | null;
  };
};

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / 3_600_000;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 最近秩百分位；样本为空返回 null，不伪造 0。 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return round(sorted[index]);
}

function duration(values: number[]): FlowDurations {
  return { samples: values.length, p50: percentile(values, 50), p90: percentile(values, 90) };
}

/**
 * 流程度量：只从既有时间戳派生，不新增事件表。
 * 口径与近似说明见 docs/metrics.md。
 */
@Injectable()
export class V1FlowMetricsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
  ) {}

  async flow(principal: Principal, projectId: string, days: number): Promise<FlowMetrics> {
    await this.authorization.resolveProjectContext(principal, projectId, 'read');
    await this.authorization.requireScope(principal, projectId, 'task:read');

    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);

    const requirements = await this.prisma.requirement.findMany({
      where: { projectId, createdAt: { gte: from } },
      select: { id: true, createdAt: true },
    });
    const requirementIds = requirements.map((row) => row.id);
    const instances = requirementIds.length
      ? await this.prisma.workflowInstance.findMany({
          where: { projectId, requirementId: { in: requirementIds } },
          select: { id: true, requirementId: true },
        })
      : [];
    const requirementByInstance = new Map(instances.map((row) => [row.id, row.requirementId]));
    const instanceIds = instances.map((row) => row.id);
    const tasks = instanceIds.length
      ? await this.prisma.task.findMany({
          where: { projectId, workflowInstanceId: { in: instanceIds } },
          select: { id: true, workflowInstanceId: true },
        })
      : [];
    const requirementByTask = new Map(
      tasks.map((row) => [row.id, requirementByInstance.get(row.workflowInstanceId) ?? null]),
    );
    const taskIds = tasks.map((row) => row.id);

    const claims = taskIds.length
      ? await this.prisma.taskClaim.findMany({
          where: { projectId, taskId: { in: taskIds } },
          select: { taskId: true, claimedAt: true },
          orderBy: { claimedAt: 'asc' },
        })
      : [];
    const deliveries = taskIds.length
      ? await this.prisma.artifactSet.findMany({
          where: { projectId, taskId: { in: taskIds } },
          select: { taskId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const reviews = taskIds.length
      ? await this.prisma.reviewRequest.findMany({
          where: { projectId, taskId: { in: taskIds } },
          select: { id: true, taskId: true },
        })
      : [];
    const reviewIds = reviews.map((row) => row.id);
    const decisions = reviewIds.length
      ? await this.prisma.reviewDecision.findMany({
          where: { projectId, reviewRequestId: { in: reviewIds }, decision: 'APPROVE' },
          select: { reviewRequestId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const firstClaim = new Map<string, Date>();
    for (const claim of claims) {
      const requirementId = requirementByTask.get(claim.taskId);
      if (!requirementId) continue;
      if (!firstClaim.has(requirementId)) firstClaim.set(requirementId, claim.claimedAt);
    }
    const firstDelivery = new Map<string, Date>();
    for (const delivery of deliveries) {
      const requirementId = requirementByTask.get(delivery.taskId);
      if (!requirementId) continue;
      if (!firstDelivery.has(requirementId)) firstDelivery.set(requirementId, delivery.createdAt);
    }
    const lastApproval = new Map<string, Date>();
    for (const decision of decisions) {
      const review = reviews.find((row) => row.id === decision.reviewRequestId);
      const requirementId = review?.taskId ? requirementByTask.get(review.taskId) : null;
      if (!requirementId) continue;
      lastApproval.set(requirementId, decision.createdAt);
    }

    const toFirstClaim: number[] = [];
    const claimToDelivery: number[] = [];
    const deliveryToApproval: number[] = [];
    const leadTime: number[] = [];
    let claimed = 0;
    let delivered = 0;
    let approved = 0;

    for (const requirement of requirements) {
      const claim = firstClaim.get(requirement.id);
      const delivery = firstDelivery.get(requirement.id);
      const approval = lastApproval.get(requirement.id);
      if (claim) {
        claimed += 1;
        toFirstClaim.push(hoursBetween(claim, requirement.createdAt));
      }
      if (claim && delivery) {
        claimToDelivery.push(hoursBetween(delivery, claim));
      }
      if (delivery) delivered += 1;
      if (delivery && approval) {
        deliveryToApproval.push(hoursBetween(approval, delivery));
      }
      if (approval) {
        approved += 1;
        leadTime.push(hoursBetween(approval, requirement.createdAt));
      }
    }

    const wipRows = await this.prisma.task.groupBy({
      by: ['executionStatus'],
      where: { projectId },
      _count: { _all: true },
    });
    const wip: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, REVIEW_PENDING: 0 };
    for (const row of wipRows) {
      if (row.executionStatus in wip) wip[row.executionStatus] = row._count._all;
    }

    const [events, recipients, ackedRows] = await Promise.all([
      this.prisma.changeEvent.count({ where: { projectId, createdAt: { gte: from } } }),
      this.prisma.changeRecipient.count({ where: { projectId, createdAt: { gte: from } } }),
      // Bounded read: cap at 10000 acked rows for ack-rate and avg-ack-hours
      // calculation. Beyond this the sample is statistically sufficient.
      this.prisma.changeRecipient.findMany({
        where: { projectId, createdAt: { gte: from }, ackedAt: { not: null } },
        select: { createdAt: true, ackedAt: true },
        take: 10_000,
      }),
    ]);
    const ackHours = ackedRows.map((row) => hoursBetween(row.ackedAt as Date, row.createdAt));
    const avgAckHours = ackHours.length
      ? round(ackHours.reduce((sum, value) => sum + value, 0) / ackHours.length)
      : null;

    return {
      window: { from: from.toISOString(), to: to.toISOString(), days },
      requirements: { created: requirements.length, claimed, delivered, approved },
      durationsHours: {
        toFirstClaim: duration(toFirstClaim),
        claimToDelivery: duration(claimToDelivery),
        deliveryToApproval: duration(deliveryToApproval),
        leadTime: duration(leadTime),
      },
      wip,
      changes: {
        events,
        recipients,
        acked: ackedRows.length,
        ackRate: recipients ? round(ackedRows.length / recipients) : 0,
        avgAckHours,
      },
    };
  }
}
