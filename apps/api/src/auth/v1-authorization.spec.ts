import { beforeEach, describe, expect, it } from 'vitest';
import type { Principal, Scope } from '@workmesh/shared';
import {
  V1AuthorizationService,
  type V1AuthorizationRepository,
  type V1GrantRecord,
  type V1KnowledgeBaseRecord,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from './v1-authorization';

type Db = {
  projects: V1ProjectRecord[];
  members: V1MemberRecord[];
  assignments: V1RoleAssignmentRecord[];
  knowledgeBases: V1KnowledgeBaseRecord[];
  grants: V1GrantRecord[];
};

function repository(db: Db): V1AuthorizationRepository {
  return {
    async findProject(projectId) {
      return db.projects.find((item) => item.id === projectId) ?? null;
    },
    async findMember(projectId, userId) {
      return (
        db.members.find((item) => item.projectId === projectId && item.userId === userId) ?? null
      );
    },
    async findActiveRoleAssignments(projectId, userId) {
      return db.assignments.filter(
        (item) => item.projectId === projectId && item.userId === userId,
      );
    },
    async findRoleAssignment(projectId, userId, roleId) {
      return (
        db.assignments.find(
          (item) =>
            item.projectId === projectId && item.userId === userId && item.roleId === roleId,
        ) ?? null
      );
    },
    async findKnowledgeBase(knowledgeBaseId) {
      return db.knowledgeBases.find((item) => item.id === knowledgeBaseId) ?? null;
    },
    async findGrants(knowledgeBaseId) {
      return db.grants.filter((item) => item.knowledgeBaseId === knowledgeBaseId);
    },
  };
}

const past = new Date('2020-01-01T00:00:00.000Z');

function baseDb(): Db {
  return {
    projects: [
      { id: 'p-a', version: 1, archivedAt: null },
      { id: 'p-b', version: 1, archivedAt: null },
    ],
    members: [
      { projectId: 'p-a', userId: 'alice', role: 'OWNER', version: 1, revokedAt: null },
      { projectId: 'p-b', userId: 'alice', role: 'MEMBER', version: 1, revokedAt: null },
      { projectId: 'p-a', userId: 'carol', role: 'MEMBER', version: 1, revokedAt: null },
    ],
    assignments: [
      {
        id: 'as-1',
        projectId: 'p-a',
        userId: 'alice',
        roleId: 'r-product',
        version: 1,
        revokedAt: null,
      },
      {
        id: 'as-2',
        projectId: 'p-a',
        userId: 'alice',
        roleId: 'r-backend',
        version: 1,
        revokedAt: null,
      },
      {
        id: 'as-3',
        projectId: 'p-b',
        userId: 'alice',
        roleId: 'r-product',
        version: 1,
        revokedAt: null,
      },
    ],
    knowledgeBases: [
      {
        id: 'kb-restricted',
        projectId: 'p-a',
        visibility: 'RESTRICTED',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'alice',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
      {
        id: 'kb-public',
        projectId: 'p-a',
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 1,
        publicationApproverUserId: 'alice',
        publicationApproverRoleId: null,
        archivedAt: null,
      },
    ],
    grants: [
      {
        id: 'g-1',
        knowledgeBaseId: 'kb-restricted',
        subjectKind: 'ROLE',
        subjectUserId: null,
        subjectRoleId: 'r-backend',
        permissions: ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'],
        revokedAt: null,
      },
      {
        id: 'g-3',
        knowledgeBaseId: 'kb-public',
        subjectKind: 'ROLE',
        subjectUserId: null,
        subjectRoleId: 'r-product',
        permissions: ['READ', 'PROPOSE'],
        revokedAt: null,
      },
    ],
  };
}

const humanAlice: Principal = { kind: 'HUMAN', userId: 'alice', scopes: [] };
const agentProductInA: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-1',
  projectId: 'p-a',
  roleIds: ['r-product'],
  scopes: ['project:read', 'knowledge:read', 'knowledge:propose'],
};
const humanCarol: Principal = { kind: 'HUMAN', userId: 'carol', scopes: [] };
const agentReadonlyInA: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-2',
  projectId: 'p-a',
  roleIds: ['r-backend'],
  scopes: ['project:read', 'knowledge:read'],
};

describe('V1AuthorizationService', () => {
  let db: Db;
  let service: V1AuthorizationService;

  beforeEach(() => {
    db = baseDb();
    service = new V1AuthorizationService(repository(db));
  });

  it('denies a project-A agent acting on project B without leaking existence', async () => {
    await expect(
      service.resolveProjectContext(agentProductInA, 'p-b', 'read'),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('refuses writes on an archived project but still allows reads', async () => {
    db.projects[0].archivedAt = past;
    await expect(service.resolveProjectContext(humanAlice, 'p-a', 'write')).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'PROJECT_ARCHIVED',
      status: 409,
      details: { projectId: 'p-a' },
    });
    // 归档是「不再被改写」，不是「看不见」：读路径必须照常。
    await expect(service.resolveProjectContext(humanAlice, 'p-a', 'read')).resolves.toMatchObject({
      project: { id: 'p-a' },
    });
  });

  it('keeps archived projects hidden from non-members on write as well', async () => {
    db.projects[0].archivedAt = past;
    // 非成员不能因为「项目已归档」而推断出项目存在。
    const stranger: Principal = { kind: 'HUMAN', userId: 'stranger', scopes: [] };
    await expect(service.resolveProjectContext(stranger, 'p-a', 'write')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
      status: 404,
    });
  });

  it('denies a project-A agent proposing a candidate in project B', async () => {
    await expect(
      service.assertCanProposeKnowledge(agentProductInA, 'kb-public'),
    ).resolves.toBeTruthy();
    const projectB = { ...db.knowledgeBases[1], id: 'kb-b', projectId: 'p-b' };
    db.knowledgeBases.push(projectB);
    await expect(service.assertCanProposeKnowledge(agentProductInA, 'kb-b')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('rejects an agent whose credential role assignment was revoked', async () => {
    db.assignments = db.assignments.filter((item) => item.roleId !== 'r-product');
    await expect(
      service.resolveProjectContext(agentProductInA, 'p-a', 'read'),
    ).rejects.toMatchObject({
      code: 'ROLE_INACTIVE',
      status: 422,
    });
  });

  it('does not let an agent borrow another business role of its authorizer', async () => {
    // 凭据角色为 product，KB 只授 backend ROLE：该 Agent 不可读。
    await expect(
      service.assertCanReadKnowledge(agentProductInA, 'kb-restricted'),
    ).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
    // 授权人本人（HUMAN）持有 backend assignment，可读。
    await expect(
      service.assertCanReadKnowledge(humanAlice, 'kb-restricted'),
    ).resolves.toMatchObject({
      canRead: true,
    });
  });

  it('never grants PUBLISH or REVOKE to an agent even when its role grant has them', async () => {
    const access = await service.assertCanReadKnowledge(agentReadonlyInA, 'kb-restricted');
    expect(access.canPublish).toBe(false);
    expect(access.canRevoke).toBe(false);
    await expect(
      service.assertCanPublishKnowledge(agentReadonlyInA, 'kb-restricted'),
    ).rejects.toMatchObject({
      code: 'HUMAN_SESSION_REQUIRED',
    });
  });

  it('denies a read-only agent proposing content', async () => {
    await expect(
      service.assertCanProposeKnowledge(agentReadonlyInA, 'kb-restricted'),
    ).rejects.toMatchObject({
      code: 'SCOPE_DENIED',
      status: 403,
    });
  });

  it('rejects agent scopes containing protected capabilities with 422', async () => {
    // 负向用例：故意构造注册表外且含受保护能力的 scope，验证以 422 拒绝。
    const evil: Principal = {
      ...agentProductInA,
      scopes: ['knowledge:read', 'knowledge:publish'] as unknown as Scope[],
    };
    await expect(service.requireScope(evil, 'p-a', 'knowledge:propose')).rejects.toMatchObject({
      code: 'UNSUPPORTED_SCOPE',
      status: 422,
    });
  });

  it('gives PROJECT visibility default READ to members but not PUBLISH', async () => {
    // carol 是活动成员但没有任何业务角色 grant，因此只有可见性默认 READ。
    const access = await service.resolveKnowledgeAccess(humanCarol, 'kb-public');
    expect(access.canRead).toBe(true);
    expect(access.canPropose).toBe(false);
    expect(access.canPublish).toBe(false);
  });

  it('denies a member whose membership was revoked even for their own authored candidate', async () => {
    db.members = db.members.map((item) =>
      item.projectId === 'p-a' && item.userId === 'alice' ? { ...item, revokedAt: past } : item,
    );
    await expect(service.assertCanReadKnowledge(humanAlice, 'kb-public')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  it('drops REVOKE-only or non-READ grants so no content leaves without READ', async () => {
    db.grants = [
      {
        id: 'g-2',
        knowledgeBaseId: 'kb-restricted',
        subjectKind: 'USER',
        subjectUserId: 'alice',
        subjectRoleId: null,
        permissions: ['PUBLISH'],
        revokedAt: null,
      },
    ];
    await expect(service.assertCanReadKnowledge(humanAlice, 'kb-restricted')).rejects.toMatchObject(
      {
        code: 'RESOURCE_NOT_FOUND',
      },
    );
  });

  it('matches business role slots against current active assignments only', async () => {
    await expect(service.hasBusinessRole(humanAlice, 'p-a', 'r-backend')).resolves.toBe(true);
    await expect(service.hasBusinessRole(humanAlice, 'p-a', 'r-qa')).resolves.toBe(false);
    await expect(service.hasBusinessRole(agentProductInA, 'p-a', 'r-backend')).resolves.toBe(false);
    await expect(service.hasBusinessRole(agentProductInA, 'p-a', 'r-product')).resolves.toBe(true);
  });
});
