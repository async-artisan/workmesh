import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { type Principal, type Scope } from '@workmesh/shared';
import {
  V1AuthorizationService,
  type V1AuthorizationRepository,
  type V1GrantRecord,
  type V1KnowledgeBaseRecord,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from '../auth/v1-authorization';
import { V1OperationReceiptService } from './v1-operation-receipt.service';
import {
  type V1OperationReceiptRecord,
  type V1OperationReceiptRepository,
} from './v1-operation-receipt.repository';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

function human(userId: string): Principal {
  return { kind: 'HUMAN', userId, scopes: [] };
}

function agentPrincipal(userId: string, credentialId: string): Principal {
  return {
    kind: 'AGENT',
    userId,
    agentCredentialId: credentialId,
    projectId: P1,
    roleIds: ['role-1'],
    scopes: ['task:read'] as Scope[],
  };
}

class InMemoryAuthorizationRepository implements V1AuthorizationRepository {
  private projects = new Map<string, V1ProjectRecord>([
    [P1, { id: P1, version: 1, archivedAt: null }],
    [P2, { id: P2, version: 1, archivedAt: null }],
  ]);
  private members = new Map<string, V1MemberRecord>([
    [`${P1}:alice`, { projectId: P1, userId: 'alice', role: 'MEMBER', version: 1, revokedAt: null }],
  ]);
  private assignments = new Map<string, V1RoleAssignmentRecord[]>([
    [
      `${P1}:alice`,
      [{ id: 'ra-1', projectId: P1, userId: 'alice', roleId: 'role-1', version: 1, revokedAt: null }],
    ],
  ]);

  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    return this.projects.get(projectId) ?? null;
  }
  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }
  async findActiveRoleAssignments(projectId: string, userId: string): Promise<V1RoleAssignmentRecord[]> {
    return this.assignments.get(`${projectId}:${userId}`) ?? [];
  }
  async findRoleAssignment(): Promise<V1RoleAssignmentRecord | null> {
    return null;
  }
  async findKnowledgeBase(): Promise<V1KnowledgeBaseRecord | null> {
    return null;
  }
  async findGrants(): Promise<V1GrantRecord[]> {
    return [];
  }
}

class InMemoryReceiptRepository implements V1OperationReceiptRepository {
  constructor(
    private readonly operations: V1OperationReceiptRecord[],
    private readonly credentialOwners: Map<string, string>,
  ) {}

  async findOperations(input: { projectScopeKey: string; key: string }): Promise<V1OperationReceiptRecord[]> {
    return this.operations.filter(
      (operation) => operation.projectScopeKey === input.projectScopeKey && operation.key === input.key,
    );
  }

  async findAgentCredentialOwner(credentialId: string): Promise<string | null> {
    return this.credentialOwners.get(credentialId) ?? null;
  }
}

function operation(over: Partial<V1OperationReceiptRecord> = {}): V1OperationReceiptRecord {
  return {
    id: randomUUID(),
    projectId: P1,
    projectScopeKey: `project:${P1}`,
    principalScopeKey: 'user:alice',
    key: randomUUID(),
    method: 'POST',
    route: '/api/v1/tasks/t1/claims',
    requestDigest: 'a'.repeat(64),
    resultRefs: { claimId: 'claim-1' },
    committedAt: new Date('2026-11-01T00:00:00.000Z'),
    ...over,
  };
}

function build(operations: V1OperationReceiptRecord[], credentialOwners = new Map<string, string>()) {
  const authorization = new V1AuthorizationService(new InMemoryAuthorizationRepository());
  return new V1OperationReceiptService(
    new InMemoryReceiptRepository(operations, credentialOwners),
    authorization,
  );
}

describe('V1OperationReceiptService.getReceipt', () => {
  it('原主体精确匹配时返回已提交收据，不泄露响应正文或秘密', async () => {
    const stored = operation();
    const service = build([stored]);
    const view = await service.getReceipt(human('alice'), stored.key, P1);
    expect(view).toEqual({
      operationKey: stored.key,
      requestDigest: stored.requestDigest,
      status: 'COMMITTED',
      resultRefs: { claimId: 'claim-1' },
      committedAt: new Date('2026-11-01T00:00:00.000Z'),
      method: 'POST',
      route: '/api/v1/tasks/t1/claims',
      projectId: P1,
    });
  });

  it('他人主体的同 key 操作返回 404 OPERATION_NOT_FOUND', async () => {
    const stored = operation({ principalScopeKey: 'user:bob' });
    const service = build([stored]);
    await expect(service.getReceipt(human('alice'), stored.key, P1)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('原 Agent 的授权用户以当前 HUMAN 身份可读取该收据', async () => {
    const stored = operation({ principalScopeKey: 'agent:cred-1' });
    const service = build([stored], new Map([['cred-1', 'alice']]));
    const view = await service.getReceipt(human('alice'), stored.key, P1);
    expect(view.operationKey).toBe(stored.key);
  });

  it('Agent 凭据属于其他用户时仍返回 404', async () => {
    const stored = operation({ principalScopeKey: 'agent:cred-2' });
    const service = build([stored], new Map([['cred-2', 'bob']]));
    await expect(service.getReceipt(human('alice'), stored.key, P1)).rejects.toMatchObject({ status: 404 });
  });

  it('项目当前不可见时返回 404，不泄露 key 是否存在', async () => {
    const stored = operation();
    const service = build([stored]);
    await expect(service.getReceipt(human('alice'), stored.key, P2)).rejects.toMatchObject({
      status: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('省略 projectId 时按账号 scope 查找；项目 scope 的操作不可见', async () => {
    const stored = operation();
    const service = build([stored]);
    await expect(service.getReceipt(human('alice'), stored.key, null)).rejects.toMatchObject({ status: 404 });

    const accountOperation = operation({
      projectId: null,
      projectScopeKey: 'account:alice',
    });
    const accountService = build([accountOperation]);
    const view = await accountService.getReceipt(human('alice'), accountOperation.key, null);
    expect(view.projectId).toBeNull();
  });

  it('未提交收据按 404 处理', async () => {
    const stored = operation({ committedAt: null });
    const service = build([stored]);
    await expect(service.getReceipt(human('alice'), stored.key, P1)).rejects.toMatchObject({ status: 404 });
  });

  it('AGENT 可读取自身凭据主体收据，但读取其他凭据主体仍 404', async () => {
    const own = operation({ principalScopeKey: 'agent:cred-1' });
    const other = operation({ principalScopeKey: 'agent:cred-3' });
    const service = build([own, other]);
    await expect(service.getReceipt(agentPrincipal('alice', 'cred-1'), own.key, P1)).resolves.toMatchObject({
      operationKey: own.key,
      status: 'COMMITTED',
    });
    await expect(service.getReceipt(agentPrincipal('alice', 'cred-1'), other.key, P1)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('空或超长 operationKey 返回 400 INVALID_REQUEST', async () => {
    const service = build([]);
    await expect(service.getReceipt(human('alice'), '', P1)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });
    await expect(service.getReceipt(human('alice'), 'k'.repeat(201), P1)).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });
  });
});
