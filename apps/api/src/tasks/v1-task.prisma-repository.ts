import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import { PrismaClient as V1PrismaClient } from '../../../node_modules/.prisma/workmesh-v1-client';
type V1TransactionClient = Omit<
  V1PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

import { assertWorkflowInstanceActive, taskReleasePatch } from './v1-task-consistency-policy';
import {
  type V1ClaimInput,
  type V1ReleaseInput,
  type V1SetWorkStatusInput,
  type V1TaskRepository,
  type V1TaskSnapshot,
} from './v1-task.repository';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [25, 100, 100];
const WORK_STATUSES = new Set(['ACTIVE', 'BLOCKED', 'PAUSED', 'CANCELLED']);

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  if (code === 'P2034') return true;
  const message = String((error as Error)?.message ?? '');
  return (
    message.includes('40001') ||
    message.includes('40P01') ||
    message.includes('could not serialize')
  );
}

function claimScopeKeyOf(userId: string, credentialId: string | null): string {
  return credentialId ? `agent:${credentialId}` : `user:${userId}`;
}

@Injectable()
export class V1TaskPrismaRepository implements V1TaskRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTask(taskId: string): Promise<V1TaskSnapshot | null> {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return null;
    let currentClaim: V1TaskSnapshot['currentClaim'] = null;
    if (task.currentClaimId) {
      const claim = await this.prisma.taskClaim.findUnique({ where: { id: task.currentClaimId } });
      if (claim) {
        currentClaim = {
          id: claim.id,
          taskGeneration: claim.taskGeneration,
          principalScopeKey: claimScopeKeyOf(claim.userId, claim.credentialId),
          releasedAt: claim.releasedAt ? claim.releasedAt.toISOString() : null,
          userId: claim.userId,
        };
      }
    }
    return this.toSnapshot(task, currentClaim);
  }

  async claim(input: V1ClaimInput): Promise<V1TaskSnapshot> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runClaim(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  async release(input: V1ReleaseInput): Promise<V1TaskSnapshot> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runRelease(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  async setWorkStatus(input: V1SetWorkStatusInput): Promise<V1TaskSnapshot> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.runSetWorkStatus(input);
      } catch (error) {
        if (!isRetryable(error) || attempt >= MAX_RETRIES) throw error;
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? 100));
        attempt += 1;
      }
    }
  }

  private async runClaim(input: V1ClaimInput): Promise<V1TaskSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({ where: { id: input.taskId } });
        if (!task)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'TASK_NOT_FOUND',
            { taskId: input.taskId },
            404,
          );

        // 项目级串行写边界。
        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${task.projectId}::uuid FOR UPDATE`,
        );

        const instance = await tx.workflowInstance.findFirst({
          where: { id: task.workflowInstanceId, projectId: task.projectId },
          select: { retiredAt: true },
        });
        assertWorkflowInstanceActive(instance?.retiredAt, {
          taskId: task.id,
          workflowInstanceId: task.workflowInstanceId,
        });

        // 事务内复核代次；使用事务外旧值只用于预期，不以旧值判通过。
        if (task.generation !== input.expectedGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            {
              taskId: task.id,
              expectedGeneration: input.expectedGeneration,
              currentGeneration: task.generation,
            },
            409,
          );

        // 双认领单胜：已有未释放认领则拒绝，另一并发事务在锁释放后会看到该认领。
        const activeClaim = await tx.taskClaim.findFirst({
          where: { taskId: task.id, releasedAt: null },
        });
        if (activeClaim)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_CONFLICT,
            'CLAIM_CONFLICT',
            { taskId: task.id, activeClaimId: activeClaim.id },
            409,
          );

        const claim = await tx.taskClaim.create({
          data: {
            projectId: task.projectId,
            taskId: task.id,
            // 认领开启新代次：taskGeneration 必须等于自增后的 task.generation，
            // 否则后续释放/工作态与协作策略的代次等值校验会恒为 BASELINE_STALE。
            taskGeneration: task.generation + 1,
            userId: input.userId,
            credentialId: input.credentialId,
            claimedAt: input.now,
            releasedAt: null,
          },
        });
        await tx.task.update({
          where: { id: task.id },
          data: {
            generation: { increment: 1 },
            currentClaimId: claim.id,
            version: { increment: 1 },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: task.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: { claimId: claim.id },
            responseMetadata: {},
            committedAt: input.now,
          },
        });

        return this.snapshotInTransaction(tx, task.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async runRelease(input: V1ReleaseInput): Promise<V1TaskSnapshot> {
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({ where: { id: input.taskId } });
        if (!task)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'TASK_NOT_FOUND',
            { taskId: input.taskId },
            404,
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${task.projectId}::uuid FOR UPDATE`,
        );

        if (task.generation !== input.expectedGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            {
              taskId: task.id,
              expectedGeneration: input.expectedGeneration,
              currentGeneration: task.generation,
            },
            409,
          );

        const activeClaim = await tx.taskClaim.findFirst({
          where: { taskId: task.id, releasedAt: null },
        });
        if (!activeClaim || activeClaim.id !== input.claimId || activeClaim.releasedAt !== null)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (
          claimScopeKeyOf(activeClaim.userId, activeClaim.credentialId) !== input.principalScopeKey
        )
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (activeClaim.taskGeneration !== input.expectedGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            { taskId: task.id, claimId: input.claimId },
            409,
          );

        await tx.taskClaim.update({
          where: { id: activeClaim.id },
          data: { releasedAt: input.now, releaseReason: input.releaseReason ?? null },
        });
        const releasePatch = taskReleasePatch(task.currentClaimId, activeClaim.id);
        if (releasePatch) {
          await tx.task.update({ where: { id: task.id }, data: releasePatch });
        }

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: task.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: { claimId: activeClaim.id, released: true },
            responseMetadata: {},
            committedAt: input.now,
          },
        });

        return this.snapshotInTransaction(tx, task.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async runSetWorkStatus(input: V1SetWorkStatusInput): Promise<V1TaskSnapshot> {
    if (!WORK_STATUSES.has(input.workStatus))
      throw new WorkmeshError(
        V1_ERROR_CODES.VALIDATION_FAILED,
        'WORK_STATUS_INVALID',
        { workStatus: input.workStatus },
        422,
      );
    return this.prisma.$transaction(
      async (tx) => {
        const task = await tx.task.findUnique({ where: { id: input.taskId } });
        if (!task)
          throw new WorkmeshError(
            V1_ERROR_CODES.RESOURCE_NOT_FOUND,
            'TASK_NOT_FOUND',
            { taskId: input.taskId },
            404,
          );

        await tx.$queryRaw(
          Prisma.sql`SELECT "id" FROM "workmesh_v1"."Project" WHERE "id" = ${task.projectId}::uuid FOR UPDATE`,
        );

        if (task.generation !== input.expectedGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            {
              taskId: task.id,
              expectedGeneration: input.expectedGeneration,
              currentGeneration: task.generation,
            },
            409,
          );

        const activeClaim = await tx.taskClaim.findFirst({
          where: { taskId: task.id, releasedAt: null },
        });
        if (!activeClaim || activeClaim.id !== input.claimId || activeClaim.releasedAt !== null)
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (
          claimScopeKeyOf(activeClaim.userId, activeClaim.credentialId) !== input.principalScopeKey
        )
          throw new WorkmeshError(
            V1_ERROR_CODES.CLAIM_INVALID,
            'CLAIM_INVALID',
            { taskId: task.id, claimId: input.claimId },
            409,
          );
        if (activeClaim.taskGeneration !== input.expectedGeneration)
          throw new WorkmeshError(
            V1_ERROR_CODES.BASELINE_STALE,
            'BASELINE_STALE',
            { taskId: task.id, claimId: input.claimId },
            409,
          );

        await tx.task.update({
          where: { id: task.id },
          data: {
            workStatus: input.workStatus as Prisma.TaskUpdateInput['workStatus'],
            version: { increment: 1 },
          },
        });

        await tx.idempotentOperation.create({
          data: {
            id: input.operation.id,
            projectId: task.projectId,
            projectScopeKey: input.operation.projectScopeKey,
            principalScopeKey: input.operation.principalScopeKey,
            key: input.operation.key,
            method: input.operation.method,
            route: input.operation.route,
            requestDigest: input.operation.requestDigest,
            resultRefs: { claimId: activeClaim.id, workStatus: input.workStatus },
            responseMetadata: {},
            committedAt: input.now,
          },
        });

        return this.snapshotInTransaction(tx, task.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private toSnapshot(
    task: {
      id: string;
      projectId: string;
      workflowInstanceId: string;
      stepKey: string;
      roleId: string;
      responsibleUserId: string;
      version: number;
      generation: number;
      executionStatus: string;
      workStatus: string;
      currentClaimId: string | null;
    },
    currentClaim: V1TaskSnapshot['currentClaim'],
  ): V1TaskSnapshot {
    return {
      id: task.id,
      projectId: task.projectId,
      workflowInstanceId: task.workflowInstanceId,
      stepKey: task.stepKey,
      roleId: task.roleId,
      responsibleUserId: task.responsibleUserId,
      version: task.version,
      generation: task.generation,
      executionStatus: task.executionStatus,
      workStatus: task.workStatus,
      currentClaim,
    };
  }

  private async snapshotInTransaction(
    tx: V1TransactionClient,
    taskId: string,
  ): Promise<V1TaskSnapshot> {
    const task = await tx.task.findUnique({ where: { id: taskId } });
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    let currentClaim: V1TaskSnapshot['currentClaim'] = null;
    if (task.currentClaimId) {
      const claim = await tx.taskClaim.findUnique({ where: { id: task.currentClaimId } });
      if (claim) {
        currentClaim = {
          id: claim.id,
          taskGeneration: claim.taskGeneration,
          principalScopeKey: claimScopeKeyOf(claim.userId, claim.credentialId),
          releasedAt: claim.releasedAt ? claim.releasedAt.toISOString() : null,
          userId: claim.userId,
        };
      }
    }
    return this.toSnapshot(task, currentClaim);
  }
}
