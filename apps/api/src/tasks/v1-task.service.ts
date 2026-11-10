import { Inject, Injectable } from '@nestjs/common';
import { principalScopeKey, V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { assertCanClaim, assertClaimForAction, type Claim } from './v1-collaboration-policy';
import { taskClaimEligibilityOf } from './v1-task-eligibility';
import {
  assertReplayable,
  requestDigestOf,
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
} from '../common/v1-idempotency';
import {
  V1_TASK_REPOSITORY,
  type V1ClaimInput,
  type V1ReleaseInput,
  type V1SetWorkStatusInput,
  type V1TaskRepository,
  type V1TaskSnapshot,
} from './v1-task.repository';

export type V1TaskActionContext = {
  idempotencyKey: string;
  method: string;
  route: string;
  body: Record<string, unknown>;
  requestId: string;
  now: Date;
  operationId: string;
};

export type V1ClaimResult = {
  task: V1TaskSnapshot;
  claimId: string;
  /** Exact committed state; old operation records may not contain it. */
  committedState: { taskVersion: number; taskGeneration: number } | null;
  replayed: boolean;
};
export type V1ReleaseResult = { task: V1TaskSnapshot; released: boolean; replayed: boolean };
export type V1SetWorkStatusResult = { task: V1TaskSnapshot; replayed: boolean };

/**
 * v1 任务认领／释放／工作态服务（T04）。
 *
 * 认领是显式释放的：下游研发必须认领后才可推进，避免共享任务被多人同时改写；
 * 释放后旧认领不得再用于动作；丢失首次响应可用同 Idempotency-Key 重放得到同一结果。
 */
@Injectable()
export class V1TaskService {
  constructor(
    @Inject(V1_TASK_REPOSITORY) private readonly tasks: V1TaskRepository,
    @Inject(V1AuthorizationService) private readonly authorization: V1AuthorizationService,
    @Inject(V1_IDEMPOTENCY_REPOSITORY) private readonly operations: V1IdempotencyRepository,
  ) {}

  async getTask(principal: Principal, taskId: string): Promise<V1TaskSnapshot> {
    const task = await this.tasks.findTask(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    // 无项目访问权按 404 返回，不泄露任务存在性。
    await this.authorization.resolveProjectContext(principal, task.projectId, 'read');
    return task;
  }

  async claim(
    principal: Principal,
    taskId: string,
    context: V1TaskActionContext,
  ): Promise<V1ClaimResult> {
    const task = await this.tasks.findTask(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    const resolved = await this.authorization.resolveProjectContext(
      principal,
      task.projectId,
      'write',
    );
    await this.authorization.requireScope(principal, resolved.project.id, 'task:claim');

    const ownerScopeKey = principalScopeKey(principal);
    const projectScopeKey = `project:${task.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    // 幂等：已提交重放先核路由与摘要一致，再返回当前任务（认领已生效）。
    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey: ownerScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const current = await this.tasks.findTask(taskId);
      if (!current)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'TASK_NOT_FOUND',
          { taskId },
          404,
        );
      const { taskVersion, taskGeneration } = existing.resultRefs;
      return {
        task: current,
        claimId: String(existing.resultRefs.claimId ?? ''),
        committedState:
          Number.isSafeInteger(taskVersion) &&
          Number(taskVersion) > 0 &&
          Number.isSafeInteger(taskGeneration) &&
          Number(taskGeneration) > 0
            ? { taskVersion: Number(taskVersion), taskGeneration: Number(taskGeneration) }
            : null,
        replayed: true,
      };
    }

    // ready 列表不是授权边界：直接提供任务 ID 仍必须属于当前责任人及凭据角色。
    if (!taskClaimEligibilityOf(principal, task, resolved).canClaim)
      throw new WorkmeshError(
        V1_ERROR_CODES.FORBIDDEN,
        'TASK_NOT_IN_RESPONSIBILITY',
        { taskId: task.id },
        403,
      );

    // 快速前置复核；并发真实拒绝仍由仓储事务内复核保证（双认领单胜）。
    this.applyClaimPolicy({
      currentClaim: task.currentClaim,
      taskGeneration: task.generation,
      principalScopeKey: ownerScopeKey,
    });

    const input: V1ClaimInput = {
      taskId,
      expectedGeneration: task.generation,
      principalScopeKey: ownerScopeKey,
      userId: principal.userId,
      credentialId: principal.kind === 'AGENT' ? (principal.agentCredentialId ?? null) : null,
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey: ownerScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    };
    const updated = await this.tasks.claim(input);
    return {
      task: updated,
      claimId: updated.currentClaim?.id ?? '',
      replayed: false,
      committedState: { taskVersion: updated.version, taskGeneration: updated.generation },
    };
  }

  async release(
    principal: Principal,
    taskId: string,
    claimId: string,
    context: V1TaskActionContext,
    releaseReason?: string | null,
  ): Promise<V1ReleaseResult> {
    const task = await this.tasks.findTask(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    const resolved = await this.authorization.resolveProjectContext(
      principal,
      task.projectId,
      'write',
    );
    await this.authorization.requireScope(principal, resolved.project.id, 'task:release');

    const ownerScopeKey = principalScopeKey(principal);
    const projectScopeKey = `project:${task.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey: ownerScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const current = await this.tasks.findTask(taskId);
      if (!current)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'TASK_NOT_FOUND',
          { taskId },
          404,
        );
      return { task: current, released: true, replayed: true };
    }

    this.applyClaimForAction(task, claimId, ownerScopeKey);

    const input: V1ReleaseInput = {
      taskId,
      expectedGeneration: task.generation,
      claimId,
      principalScopeKey: ownerScopeKey,
      now: context.now,
      releaseReason: releaseReason ?? null,
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey: ownerScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    };
    const updated = await this.tasks.release(input);
    return { task: updated, released: true, replayed: false };
  }

  async setWorkStatus(
    principal: Principal,
    taskId: string,
    claimId: string,
    workStatus: string,
    context: V1TaskActionContext,
  ): Promise<V1SetWorkStatusResult> {
    const task = await this.tasks.findTask(taskId);
    if (!task)
      throw new WorkmeshError(V1_ERROR_CODES.RESOURCE_NOT_FOUND, 'TASK_NOT_FOUND', { taskId }, 404);
    const resolved = await this.authorization.resolveProjectContext(
      principal,
      task.projectId,
      'write',
    );
    await this.authorization.requireScope(principal, resolved.project.id, 'task:deliver');

    const ownerScopeKey = principalScopeKey(principal);
    const projectScopeKey = `project:${task.projectId}`;
    const requestDigest = requestDigestOf({
      method: context.method,
      route: context.route,
      body: context.body,
    });

    const existing = await this.operations.findOperation({
      projectScopeKey,
      principalScopeKey: ownerScopeKey,
      key: context.idempotencyKey,
    });
    if (existing) {
      assertReplayable(existing, {
        method: context.method,
        route: context.route,
        digest: requestDigest,
      });
      const current = await this.tasks.findTask(taskId);
      if (!current)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'TASK_NOT_FOUND',
          { taskId },
          404,
        );
      return { task: current, replayed: true };
    }

    this.applyClaimForAction(task, claimId, ownerScopeKey);

    const input: V1SetWorkStatusInput = {
      taskId,
      expectedGeneration: task.generation,
      claimId,
      principalScopeKey: ownerScopeKey,
      workStatus,
      now: context.now,
      operation: {
        id: context.operationId,
        projectScopeKey,
        principalScopeKey: ownerScopeKey,
        key: context.idempotencyKey,
        method: context.method,
        route: context.route,
        requestDigest,
      },
    };
    const updated = await this.tasks.setWorkStatus(input);
    return { task: updated, replayed: false };
  }

  private applyClaimPolicy(input: {
    currentClaim: V1TaskSnapshot['currentClaim'];
    taskGeneration: number;
    principalScopeKey: string;
  }): void {
    try {
      assertCanClaim({
        currentClaim: this.toPolicyClaim(input.currentClaim),
        taskGeneration: input.taskGeneration,
        principalScopeKey: input.principalScopeKey,
      });
    } catch (error) {
      throw this.translateClaimError(error);
    }
  }

  private applyClaimForAction(task: V1TaskSnapshot, claimId: string, ownerScopeKey: string): void {
    try {
      assertClaimForAction({
        currentGeneration: task.generation,
        currentClaim: this.toPolicyClaim(task.currentClaim),
        claimId,
        principalScopeKey: ownerScopeKey,
      });
    } catch (error) {
      throw this.translateClaimError(error);
    }
  }

  private toPolicyClaim(claim: V1TaskSnapshot['currentClaim']): Claim | null {
    if (!claim) return null;
    return {
      id: claim.id,
      taskGeneration: claim.taskGeneration,
      principalScopeKey: claim.principalScopeKey,
      releasedAt: claim.releasedAt,
    };
  }

  private translateClaimError(error: unknown): never {
    if (error instanceof WorkmeshError) throw error;
    if (error instanceof Error) {
      switch (error.message) {
        case 'CLAIM_CONFLICT':
          throw new WorkmeshError(V1_ERROR_CODES.CLAIM_CONFLICT, 'CLAIM_CONFLICT', undefined, 409);
        case 'CLAIM_INVALID':
          throw new WorkmeshError(V1_ERROR_CODES.CLAIM_INVALID, 'CLAIM_INVALID', undefined, 409);
        case 'BASELINE_STALE':
          throw new WorkmeshError(V1_ERROR_CODES.BASELINE_STALE, 'BASELINE_STALE', undefined, 409);
        default:
          throw error;
      }
    }
    throw error;
  }
}
