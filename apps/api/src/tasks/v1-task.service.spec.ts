import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError, type Principal, type Scope } from '@workmesh/shared';
import { V1TaskService, type V1TaskActionContext } from './v1-task.service';
import {
  type V1TaskRepository,
  type V1TaskSnapshot,
  type V1ClaimSnapshot,
} from './v1-task.repository';
import { type V1IdempotencyRepository, type V1OperationRecord } from '../common/v1-idempotency';
import type { V1AuthorizationService } from '../auth/v1-authorization';

type Store = {
  tasks: Map<string, V1TaskSnapshot>;
  operations: Map<string, V1OperationRecord>;
};

function opKey(projectScopeKey: string, principalScopeKey: string, key: string): string {
  return `${projectScopeKey}|${principalScopeKey}|${key}`;
}

class InMemoryTaskRepository implements V1TaskRepository {
  constructor(private readonly store: Store) {}

  async findTask(taskId: string): Promise<V1TaskSnapshot | null> {
    const t = this.store.tasks.get(taskId);
    return t ? structuredClone(t) : null;
  }

  async claim(input: Parameters<V1TaskRepository['claim']>[0]): Promise<V1TaskSnapshot> {
    const task = this.store.tasks.get(input.taskId);
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );
    if (task.currentClaim && task.currentClaim.releasedAt === null)
      throw new WorkmeshError(
        V1_ERROR_CODES.CLAIM_CONFLICT,
        'CLAIM_CONFLICT',
        { taskId: task.id },
        409,
      );
    const nextGeneration = task.generation + 1;
    const claimId = randomUUID();
    const claim: V1ClaimSnapshot = {
      id: claimId,
      taskGeneration: nextGeneration,
      principalScopeKey: input.principalScopeKey,
      releasedAt: null,
      userId: input.userId,
    };
    task.currentClaim = claim;
    task.generation = nextGeneration;
    task.version += 1;
    this.store.operations.set(
      opKey(
        input.operation.projectScopeKey,
        input.operation.principalScopeKey,
        input.operation.key,
      ),
      {
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { claimId },
        committedAt: input.now,
      },
    );
    return structuredClone(task);
  }

  async release(input: Parameters<V1TaskRepository['release']>[0]): Promise<V1TaskSnapshot> {
    const task = this.store.tasks.get(input.taskId);
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );
    const claim = task.currentClaim;
    if (!claim || claim.releasedAt !== null || claim.id !== input.claimId)
      throw new WorkmeshError(
        V1_ERROR_CODES.CLAIM_INVALID,
        'CLAIM_INVALID',
        { taskId: task.id, claimId: input.claimId },
        409,
      );
    claim.releasedAt = input.now.toISOString();
    task.version += 1;
    this.store.operations.set(
      opKey(
        input.operation.projectScopeKey,
        input.operation.principalScopeKey,
        input.operation.key,
      ),
      {
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { claimId: claim.id, released: true },
        committedAt: input.now,
      },
    );
    return structuredClone(task);
  }

  async setWorkStatus(
    input: Parameters<V1TaskRepository['setWorkStatus']>[0],
  ): Promise<V1TaskSnapshot> {
    const task = this.store.tasks.get(input.taskId);
    if (!task)
      throw new WorkmeshError(
        V1_ERROR_CODES.RESOURCE_NOT_FOUND,
        'TASK_NOT_FOUND',
        { taskId: input.taskId },
        404,
      );
    const claim = task.currentClaim;
    if (!claim || claim.releasedAt !== null || claim.id !== input.claimId)
      throw new WorkmeshError(
        V1_ERROR_CODES.CLAIM_INVALID,
        'CLAIM_INVALID',
        { taskId: task.id, claimId: input.claimId },
        409,
      );
    task.workStatus = input.workStatus;
    task.version += 1;
    this.store.operations.set(
      opKey(
        input.operation.projectScopeKey,
        input.operation.principalScopeKey,
        input.operation.key,
      ),
      {
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { claimId: claim.id, workStatus: input.workStatus },
        committedAt: input.now,
      },
    );
    return structuredClone(task);
  }
}

class InMemoryIdempotencyRepository implements V1IdempotencyRepository {
  constructor(private readonly store: Store) {}
  async findOperation(input: {
    projectScopeKey: string;
    principalScopeKey: string;
    key: string;
  }): Promise<V1OperationRecord | null> {
    const op = this.store.operations.get(
      opKey(input.projectScopeKey, input.principalScopeKey, input.key),
    );
    return op ? structuredClone(op) : null;
  }
}

function makeAuthStub(opts: { denyProjectAccess?: boolean } = {}): V1AuthorizationService {
  return {
    async resolveProjectContext(_principal: Principal, projectId: string) {
      if (opts.denyProjectAccess)
        throw new WorkmeshError(
          V1_ERROR_CODES.RESOURCE_NOT_FOUND,
          'PROJECT_NOT_FOUND',
          { projectId },
          404,
        );
      return {
        project: { id: projectId },
        membership: {} as never,
        activeRoleIds: [],
        selectableRoleIds: [],
      } as never;
    },
    async requireScope(principal: Principal, _projectId: string, scope: Scope): Promise<void> {
      if (principal.kind !== 'AGENT') return;
      if (!principal.scopes.includes(scope))
        throw new WorkmeshError(V1_ERROR_CODES.SCOPE_DENIED, 'SCOPE_DENIED', { scope }, 403);
    },
  } as unknown as V1AuthorizationService;
}

function baseTask(projectId = 'p1'): V1TaskSnapshot {
  return {
    id: 't1',
    projectId,
    workflowInstanceId: 'w1',
    stepKey: 'step1',
    roleId: 'r1',
    responsibleUserId: 'u1',
    version: 1,
    generation: 1,
    executionStatus: 'ACTIVE',
    workStatus: 'ACTIVE',
    currentClaim: null,
  };
}

function human(userId = 'u1'): Principal {
  return { kind: 'HUMAN', userId, scopes: [] };
}

function agent(userId = 'u2', credentialId = 'c1', scopes: Scope[] = ['task:claim']): Principal {
  return {
    kind: 'AGENT',
    userId,
    agentCredentialId: credentialId,
    projectId: 'p1',
    roleIds: ['r1'],
    scopes,
  };
}

function ctx(over: Partial<V1TaskActionContext> = {}): V1TaskActionContext {
  return {
    idempotencyKey: 'k1',
    method: 'POST',
    route: '/api/v1/tasks/t1/claim',
    body: {},
    requestId: 'req-1',
    now: new Date('2026-11-01T00:00:00.000Z'),
    operationId: randomUUID(),
    ...over,
  };
}

describe('V1TaskService (T04 task-claim domain)', () => {
  let store: Store;
  let service: V1TaskService;

  beforeEach(() => {
    store = { tasks: new Map(), operations: new Map() };
    store.tasks.set('t1', baseTask());
    service = new V1TaskService(
      new InMemoryTaskRepository(store) as never,
      makeAuthStub(),
      new InMemoryIdempotencyRepository(store) as never,
    );
  });

  it('claim: HUMAN 无活跃认领时可认领，返回新认领且 replayed=false', async () => {
    const result = await service.claim(human(), 't1', ctx());
    expect(result.replayed).toBe(false);
    expect(result.task.currentClaim).not.toBeNull();
    expect(result.claimId).toBe(result.task.currentClaim!.id);
    const stored = await service.getTask(human(), 't1');
    expect(stored.currentClaim!.releasedAt).toBeNull();
  });

  it('claim: 已有活跃认领再次认领（不同键）返回 CLAIM_CONFLICT 409', async () => {
    await service.claim(human(), 't1', ctx({ idempotencyKey: 'k1', operationId: randomUUID() }));
    await expect(
      service.claim(human(), 't1', ctx({ idempotencyKey: 'k2', operationId: randomUUID() })),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.CLAIM_CONFLICT,
      status: 409,
    });
  });

  it('claim: 同 Idempotency-Key 重放返回 replayed=true 且认领不变', async () => {
    const first = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    const second = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    expect(second.replayed).toBe(true);
    expect(second.claimId).toBe(first.claimId);
    expect(second.task.generation).toBe(first.task.generation);
  });

  it('claim: 同键异 body（异摘要）重放返回 IDEMPOTENCY_CONFLICT 409', async () => {
    await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', body: { a: 1 }, operationId: randomUUID() }),
    );
    await expect(
      service.claim(
        human(),
        't1',
        ctx({ idempotencyKey: 'k1', body: { a: 2 }, operationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.IDEMPOTENCY_CONFLICT, status: 409 });
  });

  it('getTask: 任务不存在返回 404', async () => {
    await expect(service.getTask(human(), 'missing')).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
  });

  it('getTask: 无项目访问权（resolveProjectContext 抛 404）按 404 返回', async () => {
    const denied = new V1TaskService(
      new InMemoryTaskRepository(store) as never,
      makeAuthStub({ denyProjectAccess: true }),
      new InMemoryIdempotencyRepository(store) as never,
    );
    await expect(denied.getTask(human(), 't1')).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
  });

  it('release: 释放非本人/错误认领返回 CLAIM_INVALID 409', async () => {
    const claimed = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    await expect(
      service.release(
        human(),
        't1',
        'wrong-claim',
        ctx({ idempotencyKey: 'k2', operationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.CLAIM_INVALID, status: 409 });
    expect(claimed.task.currentClaim!.releasedAt).toBeNull();
  });

  it('release: 释放当前活跃认领成功，released=true', async () => {
    const claimed = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    const released = await service.release(
      human(),
      't1',
      claimed.claimId,
      ctx({ idempotencyKey: 'k2', operationId: randomUUID() }),
    );
    expect(released.released).toBe(true);
    expect(released.task.currentClaim!.releasedAt).not.toBeNull();
  });

  it('release: 释放后同键重放仍 replayed=true', async () => {
    const claimed = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    await service.release(
      human(),
      't1',
      claimed.claimId,
      ctx({ idempotencyKey: 'k2', operationId: randomUUID() }),
    );
    const replay = await service.release(
      human(),
      't1',
      claimed.claimId,
      ctx({ idempotencyKey: 'k2', operationId: randomUUID() }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.released).toBe(true);
  });

  it('setWorkStatus: 非活跃认领返回 CLAIM_INVALID 409', async () => {
    await service.claim(human(), 't1', ctx({ idempotencyKey: 'k1', operationId: randomUUID() }));
    await expect(
      service.setWorkStatus(
        human(),
        't1',
        'wrong-claim',
        'BLOCKED',
        ctx({ idempotencyKey: 'k3', operationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.CLAIM_INVALID, status: 409 });
  });

  it('setWorkStatus: 活跃认领可推进工作态', async () => {
    const claimed = await service.claim(
      human(),
      't1',
      ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
    );
    const updated = await service.setWorkStatus(
      human(),
      't1',
      claimed.claimId,
      'BLOCKED',
      ctx({ idempotencyKey: 'k3', operationId: randomUUID() }),
    );
    expect(updated.task.workStatus).toBe('BLOCKED');
    expect(updated.replayed).toBe(false);
  });

  it('claim: AGENT 缺 task:claim scope 返回 SCOPE_DENIED 403', async () => {
    await expect(
      service.claim(
        agent('u2', 'c1', ['task:read']),
        't1',
        ctx({ idempotencyKey: 'k1', operationId: randomUUID() }),
      ),
    ).rejects.toMatchObject({ code: V1_ERROR_CODES.SCOPE_DENIED, status: 403 });
  });
});
