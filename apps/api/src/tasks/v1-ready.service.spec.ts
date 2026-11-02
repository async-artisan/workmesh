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
import { V1ReadyService } from './v1-ready.service';
import {
  type V1ReadyCandidate,
  type V1ReadyInstanceStep,
  type V1ReadyOwnership,
  type V1ReadyRepository,
  type V1ReadyRevisionSteps,
} from './v1-ready.repository';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const R1 = '33333333-3333-4333-8333-333333333333';
const R2 = '44444444-4444-4444-8444-444444444444';

function human(userId: string): Principal {
  return { kind: 'HUMAN', userId, scopes: [] };
}

function agent(roleId = R1, scopes: Scope[] = ['task:read'], projectId = P1): Principal {
  return {
    kind: 'AGENT',
    userId: 'alice',
    agentCredentialId: 'cred-1',
    projectId,
    roleIds: [roleId],
    scopes,
  };
}

class InMemoryAuthorizationRepository implements V1AuthorizationRepository {
  private projects = new Map<string, V1ProjectRecord>([
    [P1, { id: P1, version: 1, archivedAt: null }],
    [P2, { id: P2, version: 1, archivedAt: null }],
  ]);
  private members = new Map<string, V1MemberRecord>();
  private assignments = new Map<string, V1RoleAssignmentRecord[]>();

  constructor() {
    this.members.set(`${P1}:alice`, { projectId: P1, userId: 'alice', role: 'MEMBER', version: 1, revokedAt: null });
    this.members.set(`${P1}:bob`, { projectId: P1, userId: 'bob', role: 'MEMBER', version: 1, revokedAt: null });
    this.members.set(`${P1}:owner`, { projectId: P1, userId: 'owner', role: 'OWNER', version: 1, revokedAt: null });
    this.assignments.set(`${P1}:alice`, [
      { id: 'ra-alice-1', projectId: P1, userId: 'alice', roleId: R1, version: 1, revokedAt: null },
    ]);
    this.assignments.set(`${P1}:bob`, [
      { id: 'ra-bob-1', projectId: P1, userId: 'bob', roleId: R1, version: 1, revokedAt: null },
    ]);
    this.assignments.set(`${P1}:owner`, [
      { id: 'ra-owner-1', projectId: P1, userId: 'owner', roleId: R1, version: 1, revokedAt: null },
      { id: 'ra-owner-2', projectId: P1, userId: 'owner', roleId: R2, version: 1, revokedAt: null },
    ]);
  }

  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    return this.projects.get(projectId) ?? null;
  }
  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }
  async findActiveRoleAssignments(projectId: string, userId: string): Promise<V1RoleAssignmentRecord[]> {
    return this.assignments.get(`${projectId}:${userId}`) ?? [];
  }
  async findRoleAssignment(projectId: string, userId: string, roleId: string): Promise<V1RoleAssignmentRecord | null> {
    return this.findActiveRoleAssignments(projectId, userId).then((items) => items.find((item) => item.roleId === roleId) ?? null);
  }
  async findKnowledgeBase(): Promise<V1KnowledgeBaseRecord | null> {
    return null;
  }
  async findGrants(): Promise<V1GrantRecord[]> {
    return [];
  }
}

function matchesOwnership(candidate: V1ReadyCandidate, ownership: V1ReadyOwnership): boolean {
  switch (ownership.kind) {
    case 'ALL':
      return true;
    case 'AGENT':
      return candidate.roleId === ownership.roleId;
    case 'HUMAN':
      return candidate.responsibleUserId === ownership.userId || ownership.roleIds.includes(candidate.roleId);
  }
}

class InMemoryReadyRepository implements V1ReadyRepository {
  failDependencyRead = false;

  constructor(
    private readonly candidates: V1ReadyCandidate[],
    private readonly revisions: V1ReadyRevisionSteps[],
    private readonly instanceTasks: V1ReadyInstanceStep[],
  ) {}

  async listCandidates(input: {
    projectId: string;
    roleId: string | null;
    ownership: V1ReadyOwnership;
    after: { stepKey: string; id: string } | null;
    take: number;
  }) {
    const filtered = this.candidates
      .filter((candidate) => candidate.projectId === input.projectId)
      .filter((candidate) => (input.roleId ? candidate.roleId === input.roleId : true))
      .filter((candidate) => matchesOwnership(candidate, input.ownership))
      .filter((candidate) =>
        input.after
          ? candidate.stepKey > input.after.stepKey ||
            (candidate.stepKey === input.after.stepKey && candidate.id > input.after.id)
          : true,
      )
      .sort((left, right) => (left.stepKey === right.stepKey ? (left.id < right.id ? -1 : 1) : left.stepKey < right.stepKey ? -1 : 1));
    return { items: filtered.slice(0, input.take), hasMore: filtered.length > input.take };
  }

  async findRevisionSteps(revisionIds: readonly string[]): Promise<V1ReadyRevisionSteps[]> {
    return this.revisions.filter((revision) => revisionIds.includes(revision.revisionId));
  }

  async listInstanceTasks(instanceIds: readonly string[]): Promise<V1ReadyInstanceStep[]> {
    if (this.failDependencyRead) throw new Error('DEPENDENCY_READ_FAILED');
    return this.instanceTasks.filter((task) => instanceIds.includes(task.workflowInstanceId));
  }
}

function candidate(over: Partial<V1ReadyCandidate>): V1ReadyCandidate {
  return {
    id: randomUUID(),
    projectId: P1,
    workflowInstanceId: 'instance-1',
    stepKey: 'design',
    roleId: R1,
    responsibleUserId: 'alice',
    version: 1,
    generation: 1,
    executionStatus: 'OPEN',
    workStatus: 'ACTIVE',
    currentClaimId: null,
    definitionRevisionId: 'revision-1',
    ...over,
  };
}

function build(candidates: V1ReadyCandidate[], revisions: V1ReadyRevisionSteps[], tasks: V1ReadyInstanceStep[]) {
  const repository = new InMemoryReadyRepository(candidates, revisions, tasks);
  const authorization = new V1AuthorizationService(new InMemoryAuthorizationRepository());
  return { service: new V1ReadyService(repository, authorization), repository };
}

const REVISION: V1ReadyRevisionSteps = {
  revisionId: 'revision-1',
  projectId: P1,
  steps: [
    { key: 'design', deps: [] },
    { key: 'impl', deps: ['design'] },
  ],
};

describe('V1ReadyService.ready', () => {
  it('AGENT 试图通过 query.roleId 改角色返回 403 SCOPE_DENIED', async () => {
    const { service } = build([candidate({ stepKey: 'design' })], [REVISION], []);
    await expect(service.ready(agent(R1), P1, { roleId: R2 })).rejects.toMatchObject({
      status: 403,
      code: 'SCOPE_DENIED',
    });
  });

  it('AGENT 缺 task:read 返回 403 SCOPE_DENIED', async () => {
    const { service } = build([candidate({ stepKey: 'design' })], [REVISION], []);
    await expect(service.ready(agent(R1, []), P1, {})).rejects.toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
  });

  it('AGENT 只返回本凭据角色的任务，不能看到其他角色任务', async () => {
    const { service } = build(
      [candidate({ stepKey: 'design', roleId: R1 }), candidate({ stepKey: 'impl', roleId: R2, responsibleUserId: 'bob' })],
      [REVISION],
      [],
    );
    const page = await service.ready(agent(R1), P1, {});
    expect(page.items.map((item) => item.stepKey)).toEqual(['design']);
  });

  it('HUMAN MEMBER 只看到自己负责或自己当前角色持有的任务', async () => {
    const { service } = build(
      [
        candidate({ stepKey: 'design', responsibleUserId: 'alice', roleId: R2 }),
        candidate({ stepKey: 'impl', responsibleUserId: 'bob', roleId: R1 }),
        candidate({ stepKey: 'review', responsibleUserId: 'bob', roleId: R2 }),
      ],
      [
        {
          revisionId: 'revision-1',
          projectId: P1,
          steps: [
            { key: 'design', deps: [] },
            { key: 'impl', deps: [] },
            { key: 'review', deps: [] },
          ],
        },
      ],
      [],
    );
    const page = await service.ready(human('alice'), P1, {});
    expect(page.items.map((item) => item.stepKey)).toEqual(['design', 'impl']);
  });

  it('HUMAN OWNER 可见本项目全部就绪任务', async () => {
    const { service } = build(
      [
        candidate({ stepKey: 'design', responsibleUserId: 'alice', roleId: R2 }),
        candidate({ stepKey: 'impl', responsibleUserId: 'bob', roleId: R1 }),
      ],
      [{ revisionId: 'revision-1', projectId: P1, steps: [{ key: 'design', deps: [] }, { key: 'impl', deps: [] }] }],
      [],
    );
    const page = await service.ready(human('owner'), P1, {});
    expect(page.items.map((item) => item.stepKey)).toEqual(['design', 'impl']);
  });

  it('前序依赖任务未 DONE 时该任务不就绪；全部 DONE 后就绪', async () => {
    const impl = candidate({ stepKey: 'impl', id: '55555555-5555-4555-8555-555555555555' });
    const { service: notReady } = build([impl], [REVISION], [
      { workflowInstanceId: 'instance-1', stepKey: 'design', executionStatus: 'OPEN' },
    ]);
    expect((await notReady.ready(human('alice'), P1, {})).items).toEqual([]);

    const { service: ready } = build([impl], [REVISION], [
      { workflowInstanceId: 'instance-1', stepKey: 'design', executionStatus: 'DONE' },
    ]);
    expect((await ready.ready(human('alice'), P1, {})).items.map((item) => item.id)).toEqual([impl.id]);
  });

  it('缺少前序步骤任务或修订缺少该步骤时按不就绪处理', async () => {
    const impl = candidate({ stepKey: 'impl' });
    const { service } = build([impl], [REVISION], []);
    expect((await service.ready(human('alice'), P1, {})).items).toEqual([]);

    const unknownStep = candidate({ stepKey: 'unknown' });
    const { service: missingStep } = build([unknownStep], [REVISION], []);
    expect((await missingStep.ready(human('alice'), P1, {})).items).toEqual([]);
  });

  it('已有活动认领或非 OPEN/ACTIVE 的任务不就绪', async () => {
    const claimed = candidate({ stepKey: 'design', currentClaimId: 'claim-1' });
    const blocked = candidate({ stepKey: 'impl', workStatus: 'BLOCKED' });
    const inProgress = candidate({ stepKey: 'review', executionStatus: 'IN_PROGRESS' });
    const { service } = build(
      [claimed, blocked, inProgress],
      [{ revisionId: 'revision-1', projectId: P1, steps: [{ key: 'design', deps: [] }, { key: 'impl', deps: [] }, { key: 'review', deps: [] }] }],
      [],
    );
    expect((await service.ready(human('alice'), P1, {})).items).toEqual([]);
  });

  it('实例没有 definitionRevisionId 时一律不就绪，不猜测基线', async () => {
    const { service } = build([candidate({ stepKey: 'design', definitionRevisionId: null })], [REVISION], []);
    expect((await service.ready(human('alice'), P1, {})).items).toEqual([]);
  });

  it('依赖读取失败时按不就绪处理，不抛 500', async () => {
    const { service, repository } = build([candidate({ stepKey: 'design' })], [REVISION], []);
    repository.failDependencyRead = true;
    await expect(service.ready(human('alice'), P1, {})).resolves.toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('分页游标按 stepKey asc + id asc 稳定推进', async () => {
    const first = candidate({ stepKey: 'alpha', id: '66666666-6666-4666-8666-666666666661' });
    const second = candidate({ stepKey: 'alpha', id: '66666666-6666-4666-8666-666666666662' });
    const third = candidate({ stepKey: 'beta', id: '66666666-6666-4666-8666-666666666663' });
    const { service } = build(
      [third, second, first],
      [{ revisionId: 'revision-1', projectId: P1, steps: [{ key: 'alpha', deps: [] }, { key: 'beta', deps: [] }] }],
      [],
    );

    const page1 = await service.ready(human('alice'), P1, { limit: 2 });
    expect(page1.items.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await service.ready(human('alice'), P1, { limit: 2, cursor: page1.nextCursor });
    expect(page2.items.map((item) => item.id)).toEqual([third.id]);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextCursor).toBeNull();
  });

  it('非法 cursor 返回 400 INVALID_REQUEST', async () => {
    const { service } = build([], [], []);
    await expect(service.ready(human('alice'), P1, { cursor: 'not-a-cursor' })).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_REQUEST',
    });
  });

  it('项目不可见时返回 404', async () => {
    const { service } = build([candidate({ projectId: P2 })], [], []);
    await expect(service.ready(human('alice'), P2, {})).rejects.toMatchObject({ status: 404, code: 'RESOURCE_NOT_FOUND' });
  });
});
