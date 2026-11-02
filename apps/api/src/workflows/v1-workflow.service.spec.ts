import { beforeEach, describe, expect, it } from 'vitest';
import {
  compileWorkflowDefinition,
  V1_ERROR_CODES,
  WorkmeshError,
  type ActionBinding,
  type Principal,
  type WorkflowCompiledRules,
  type WorkflowPackageLock,
} from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { V1Principal } from '../auth/v1-policy';
import { actionDigestOf, hashTicketSecret, type V1ConfirmationRepository, type V1TicketRecord } from '../auth/v1-confirmation';
import type { V1IdempotencyRepository, V1OperationRecord } from '../common/v1-idempotency';
import {
  WORKFLOW_CONFIG_PUBLISH,
  WORKFLOW_DEFINITION_TARGET,
  V1WorkflowService,
  type V1CreateInstanceRequest,
  type V1PublishInput,
  type V1WorkflowContext,
} from './v1-workflow.service';
import type {
  V1CreateInstanceInput,
  V1CreateInstanceResult,
  V1PublishDefinitionInput,
  V1PublishDefinitionResult,
  V1WorkflowDefinitionView,
  V1WorkflowInstanceView,
  V1WorkflowRepository,
  V1WorkflowRevisionView,
  V1WorkflowRole,
} from './v1-workflow.repository';

const now = new Date('2026-11-01T00:00:00.000Z');
const projectId = 'p-a';
const workflowKey = 'demo';
const ticketSecret = 'ticket-secret-value';
const idempotencyKey = '11111111-1111-4111-8111-111111111111';

const roles: V1WorkflowRole[] = [
  { id: 'r-product', key: 'product', title: 'Product', isActive: true, version: 1 },
  { id: 'r-eng', key: 'engineering', title: 'Engineering', isActive: true, version: 1 },
  { id: 'r-ops', key: 'ops', title: 'Ops', isActive: true, version: 1 },
];

const locks: WorkflowPackageLock[] = [
  { roleKey: 'product', packageId: 'pkg-product', version: '1.0.0', packageDigest: 'a'.repeat(64) },
  { roleKey: 'engineering', packageId: 'pkg-eng', version: '1.0.0', packageDigest: 'b'.repeat(64) },
  { roleKey: 'ops', packageId: 'pkg-ops', version: '1.0.0', packageDigest: 'c'.repeat(64) },
];

const roleIdsByKey: Record<string, string> = { product: 'r-product', engineering: 'r-eng', ops: 'r-ops' };

function demoDefinition(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: '1.0',
    protocolVersion: '1.0',
    workflowKey,
    title: 'Demo workflow',
    baseRevisionId: null,
    roleExclusions: [],
    stepRemovals: [],
    roleSlots: [{ key: 'release-approval', roleKey: 'ops', kind: 'RELEASE_ACCEPTANCE' }],
    steps: [
      { key: 'define', roleKey: 'product', kind: 'PRODUCT', deps: [], outputKinds: ['PRD'], baselinePolicy: 'NONE' },
      { key: 'implement', roleKey: 'engineering', kind: 'DELIVERY', deps: ['define'], outputKinds: ['IMPL'] },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['implement'],
        outputKinds: [],
        gates: [{ mode: 'ALL', reviewerSlots: ['release-approval'] }],
      },
    ],
    ...overrides,
  };
}

/** 带 verify 步骤的基线，用于“删除步骤必须给出理由”的回归。 */
function definitionWithVerify(baseRevisionId: string | null): Record<string, unknown> {
  return demoDefinition({
    baseRevisionId,
    steps: [
      { key: 'define', roleKey: 'product', kind: 'PRODUCT', deps: [], outputKinds: ['PRD'], baselinePolicy: 'NONE' },
      { key: 'implement', roleKey: 'engineering', kind: 'DELIVERY', deps: ['define'], outputKinds: ['IMPL'] },
      { key: 'verify', roleKey: 'product', kind: 'VERIFY', deps: ['implement'], outputKinds: [] },
      {
        key: 'release',
        roleKey: 'ops',
        kind: 'RELEASE',
        deps: ['verify'],
        outputKinds: [],
        gates: [{ mode: 'ALL', reviewerSlots: ['release-approval'] }],
      },
    ],
  });
}

type StoredOperation = V1OperationRecord & { resultRefs: Record<string, unknown> };
type Requirement = {
  id: string;
  projectId: string;
  version: number;
  currentPrdRevisionId: string | null;
  deliveryScope: unknown;
};

type State = {
  projectVersion: number;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  members: string[];
  repositories: string[];
  definition: (V1WorkflowDefinitionView & { id: string }) | null;
  revisions: V1WorkflowRevisionView[];
  requirements: Requirement[];
  instances: V1WorkflowInstanceView[];
  operations: StoredOperation[];
  tickets: V1TicketRecord[];
  /** 已登记的包版本；默认与 locks 一致，可用于构造“未登记包”。 */
  packages: Array<{ packageId: string; version: string; roleKey: string; manifestDigest: string }>;
};

function store(): State {
  return {
    projectVersion: 1,
    memberRole: 'OWNER',
    members: ['alice', 'bob'],
    repositories: ['repo-1'],
    definition: null,
    revisions: [],
    requirements: [{ id: 'req-1', projectId, version: 1, currentPrdRevisionId: null, deliveryScope: null }],
    instances: [],
    operations: [],
    tickets: [],
    packages: locks.map((lock) => ({
      packageId: lock.packageId,
      version: lock.version,
      roleKey: lock.roleKey,
      manifestDigest: lock.packageDigest,
    })),
  };
}

function workflowRepository(state: State): V1WorkflowRepository {
  return {
    async listDefinitions() {
      return { items: state.definition ? [state.definition] : [], nextCursor: null };
    },
    async findDefinition(project, key) {
      return state.definition && state.definition.workflowKey === key ? { ...state.definition } : null;
    },
    async findRevision(revisionId) {
      return state.revisions.find((revision) => revision.id === revisionId) ?? null;
    },
    async projectRoles() {
      return roles;
    },
    async findPackageVersion(project, packageId, version) {
      const found = state.packages.find((item) => item.packageId === packageId && item.version === version);
      return found ? { ...found, projectId: null } : null;
    },
    async findRequirement(requirementId) {
      return state.requirements.find((requirement) => requirement.id === requirementId) ?? null;
    },
    async isActiveMember(project, userId) {
      return state.members.includes(userId);
    },
    async isProjectRepository(project, repositoryId) {
      return state.repositories.includes(repositoryId);
    },
    async publishDefinition(input: V1PublishDefinitionInput): Promise<V1PublishDefinitionResult> {
      if (state.projectVersion !== input.expectedProjectVersion)
        throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'PROJECT_VERSION_CONFLICT', undefined, 409);
      const currentRevision = state.definition?.currentRevision ?? 0;
      if (currentRevision !== input.expectedCurrentRevision)
        throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'WORKFLOW_REVISION_CONFLICT', undefined, 409);
      const ticket = state.tickets.find((item) => item.id === input.ticket.id);
      if (!ticket || ticket.secretHash !== input.ticket.secretHash || ticket.consumedAt || ticket.invalidatedAt)
        throw new WorkmeshError(V1_ERROR_CODES.CONFIRMATION_USED, 'CONFIRMATION_CONSUME_CONFLICT', undefined, 409);
      ticket.consumedAt = now;
      ticket.consumedOperationId = input.operation.id;

      const nextRevision = currentRevision + 1;
      const revision: V1WorkflowRevisionView = {
        id: `rev-${nextRevision}`,
        projectId,
        definitionId: 'def-1',
        workflowKey: input.workflowKey,
        revision: nextRevision,
        digest: input.definitionDigest,
        definition: input.definition,
        compiledRules: input.compiledRules,
        createdAt: now,
      };
      state.revisions.push(revision);
      state.definition = {
        id: 'def-1',
        workflowKey: input.workflowKey,
        title: input.title,
        version: (state.definition?.version ?? 1) + 1,
        currentPublishedRevisionId: revision.id,
        currentRevision: nextRevision,
      };
      state.projectVersion += 1;
      state.operations.push({
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: {
          definitionRevisionId: revision.id,
          revision: nextRevision,
          digest: input.definitionDigest,
          projectVersion: state.projectVersion,
        },
        committedAt: now,
      });
      return {
        definitionRevisionId: revision.id,
        revision: nextRevision,
        digest: input.definitionDigest,
        projectVersion: state.projectVersion,
      };
    },
    async findPublishOperation(input) {
      return (
        state.operations.find(
          (item) =>
            item.projectScopeKey === input.projectScopeKey &&
            item.principalScopeKey === input.principalScopeKey &&
            item.key === input.key,
        ) ?? null
      );
    },
    async createInstance(input: V1CreateInstanceInput): Promise<V1CreateInstanceResult> {
      const requirement = state.requirements.find((item) => item.id === input.requirementId)!;
      if (requirement.version !== input.expectedRequirementVersion)
        throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'REQUIREMENT_VERSION_CONFLICT', undefined, 409);
      for (const existing of state.instances) {
        if (!existing.retiredAt) {
          existing.retiredAt = now;
          existing.workStatus = 'CANCELLED';
          existing.version += 1;
        }
      }
      const instance: V1WorkflowInstanceView = {
        id: `inst-${state.instances.length + 1}`,
        projectId,
        requirementId: input.requirementId,
        definitionRevisionId: input.definitionRevisionId,
        definitionDigest: input.definitionDigest,
        version: 1,
        workStatus: 'ACTIVE',
        retiredAt: null,
        steps: input.steps.map((step) => ({
          stepKey: step.stepKey,
          roleId: step.roleId,
          responsibleUserId: step.responsibleUserId,
          executionStatus: 'TODO',
          workStatus: 'READY',
          generation: 1,
          version: 1,
          repositoryIds: step.repositoryIds,
        })),
      };
      state.instances.push(instance);
      requirement.version += 1;
      state.operations.push({
        id: input.operation.id,
        projectScopeKey: input.operation.projectScopeKey,
        principalScopeKey: input.operation.principalScopeKey,
        key: input.operation.key,
        method: input.operation.method,
        route: input.operation.route,
        requestDigest: input.operation.requestDigest,
        resultRefs: { instanceId: instance.id, requirementVersion: requirement.version },
        committedAt: now,
      });
      return { instance, requirementVersion: requirement.version };
    },
    async findInstance(instanceId) {
      return state.instances.find((instance) => instance.id === instanceId) ?? null;
    },
  };
}

function authRepository(state: State): V1AuthorizationRepository {
  return {
    async findProject(id) {
      return { id, version: state.projectVersion, archivedAt: null };
    },
    async findMember(project, userId) {
      return { projectId: project, userId, role: state.memberRole, version: 1, revokedAt: null };
    },
    async findActiveRoleAssignments(project, userId) {
      return userId === 'alice'
        ? [{ id: 'as-product', projectId: project, userId, roleId: 'r-product', version: 1, revokedAt: null }]
        : [];
    },
    async findRoleAssignment() {
      return null;
    },
    async findKnowledgeBase() {
      return null;
    },
    async findGrants() {
      return [];
    },
  };
}

function makeTicket(binding: ActionBinding, overrides: Partial<V1TicketRecord> = {}): V1TicketRecord {
  return {
    id: 'tk-1',
    secretHash: hashTicketSecret(ticketSecret),
    userId: 'alice',
    webSessionId: 'sess-1',
    projectId,
    userAuthVersion: 1,
    action: binding.action,
    targetType: binding.targetType,
    targetId: binding.targetId,
    expectedVersion: binding.expectedVersion,
    actionDigest: actionDigestOf(binding),
    roleId: null,
    approvalSlotId: null,
    createdAt: now,
    expiresAt: new Date('2026-11-01T00:05:00.000Z'),
    consumedAt: null,
    consumedOperationId: null,
    invalidatedAt: null,
    ...overrides,
  };
}

async function publishBinding(
  expectedVersion: number,
  expectedCurrentRevision: number,
  definition: Record<string, unknown>,
  packageLocks: WorkflowPackageLock[] = locks,
): Promise<ActionBinding> {
  const compiled = await compileWorkflowDefinition(definition, { roleIdsByKey, packageLocks });
  return {
    action: WORKFLOW_CONFIG_PUBLISH,
    projectId,
    targetType: WORKFLOW_DEFINITION_TARGET,
    targetId: workflowKey,
    expectedVersion,
    roleSlot: null,
    payload: {
      expectedCurrentRevision,
      compiledDigest: compiled.digest!,
      packageLocks: [...packageLocks]
        .map((lock) => ({ roleKey: lock.roleKey, packageId: lock.packageId, version: lock.version, packageDigest: lock.packageDigest }))
        .sort((left, right) => left.roleKey.localeCompare(right.roleKey)),
    },
  };
}

const alice: V1Principal = { kind: 'HUMAN', userId: 'alice', scopes: [], sessionId: 'sess-1', authVersion: 1 };
const bob: V1Principal = { kind: 'HUMAN', userId: 'bob', scopes: [], sessionId: 'sess-1', authVersion: 1 };
const agentAlice: Principal = {
  kind: 'AGENT',
  userId: 'alice',
  agentCredentialId: 'cred-1',
  projectId,
  roleIds: ['r-product'],
  scopes: [],
};

const publishRoute = `/api/v1/projects/${projectId}/workflow-definitions/${workflowKey}/publish`;
const instanceRoute = `/api/v1/requirements/req-1/workflow-instances`;

describe('V1WorkflowService', () => {
  let state: State;
  let service: V1WorkflowService;

  function publishInput(overrides: Partial<V1PublishInput> = {}): V1PublishInput {
    return {
      expectedVersion: state.projectVersion,
      expectedCurrentRevision: state.definition?.currentRevision ?? 0,
      definition: demoDefinition(state.definition ? { baseRevisionId: state.definition.currentPublishedRevisionId } : {}),
      packageLocks: locks,
      confirmation: { ticketId: 'tk-1', ticketSecret },
      ...overrides,
    };
  }

  function publishContext(body: Record<string, unknown>, overrides: Partial<V1WorkflowContext> = {}): V1WorkflowContext {
    return {
      idempotencyKey,
      method: 'POST',
      route: publishRoute,
      body,
      operationId: 'op-1',
      now,
      webSessionId: 'sess-1',
      userAuthVersion: 1,
      ...overrides,
    };
  }

  function instanceInput(overrides: Partial<V1CreateInstanceRequest> = {}): V1CreateInstanceRequest {
    return {
      definitionRevisionId: 'rev-1',
      expectedRequirementVersion: 1,
      stepBindings: [
        { stepKey: 'define', roleId: 'r-product', responsibleUserId: 'alice', repositoryIds: [] },
        { stepKey: 'implement', roleId: 'r-eng', responsibleUserId: 'alice', repositoryIds: ['repo-1'] },
        { stepKey: 'release', roleId: 'r-ops', responsibleUserId: 'alice', repositoryIds: [] },
      ],
      roleSlotBindings: [{ slotKey: 'release-approval', roleId: 'r-ops', userId: 'alice' }],
      ...overrides,
    };
  }

  function instanceContext(body: Record<string, unknown>): V1WorkflowContext {
    return {
      idempotencyKey,
      method: 'POST',
      route: instanceRoute,
      body,
      operationId: 'op-inst-1',
      now,
      webSessionId: 'sess-1',
      userAuthVersion: 1,
    };
  }

  async function seedPublishedDefinition(definition: Record<string, unknown> = definitionWithVerify(null)): Promise<void> {
    const compiled = await compileWorkflowDefinition(definition, { roleIdsByKey, packageLocks: locks });
    if (!compiled.valid) throw new Error(`fixture definition invalid: ${JSON.stringify(compiled.issues)}`);
    state.revisions = [
      {
        id: 'rev-1',
        projectId,
        definitionId: 'def-1',
        workflowKey,
        revision: 1,
        digest: compiled.digest!,
        definition,
        compiledRules: compiled.compiledRules as WorkflowCompiledRules,
        createdAt: now,
      },
    ];
    state.definition = {
      id: 'def-1',
      workflowKey,
      title: 'Demo workflow',
      version: 2,
      currentPublishedRevisionId: 'rev-1',
      currentRevision: 1,
    };
    state.projectVersion = 2;
  }

  beforeEach(() => {
    state = store();
    const authorization = new V1AuthorizationService(authRepository(state));
    const confirmation: V1ConfirmationRepository = {
      async createTicket() {
        throw new Error('not used');
      },
      async findTicket(ticketId) {
        return state.tickets.find((item) => item.id === ticketId) ?? null;
      },
      async consumeTicket() {
        return { consumed: false, ticket: null };
      },
    };
    const idempotency: V1IdempotencyRepository = {
      async findOperation(input) {
        return (
          state.operations.find(
            (item) =>
              item.projectScopeKey === input.projectScopeKey &&
              item.principalScopeKey === input.principalScopeKey &&
              item.key === input.key,
          ) ?? null
        );
      },
    };
    service = new V1WorkflowService(workflowRepository(state), authorization, confirmation, idempotency);
  });

  describe('validate', () => {
    it('compiles a definition without persisting any revision', async () => {
      const result = await service.validate(alice, projectId, { definition: demoDefinition(), packageLocks: locks });
      expect(result.valid).toBe(true);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(state.revisions).toHaveLength(0);
      expect(state.operations).toHaveLength(0);
    });

    it('rejects an agent without workflow:propose', async () => {
      await expect(
        service.validate(agentAlice, projectId, { definition: demoDefinition(), packageLocks: locks }),
      ).rejects.toMatchObject({ code: 'SCOPE_DENIED', status: 403 });
    });

    it('reports scope mismatch when an excluded role is still used', async () => {
      const definition = demoDefinition({ roleExclusions: [{ roleKey: 'ops', reason: 'not needed' }] });
      const result = await service.validate(alice, projectId, { definition, packageLocks: locks });
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain('WORKFLOW_SCOPE_MISMATCH');
    });

    it('rejects a package lock that is not registered for the project', async () => {
      state.packages = state.packages.filter((item) => item.packageId !== 'pkg-ops');
      const result = await service.validate(alice, projectId, { definition: demoDefinition(), packageLocks: locks });
      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain('WORKFLOW_PACKAGE_INCOMPATIBLE');
    });
  });

  describe('publish', () => {
    it('requires a project manager human session', async () => {
      state.memberRole = 'MEMBER';
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await expect(service.publish(bob, projectId, workflowKey, publishInput({ definition }), publishContext({}))).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });

    it('rejects an agent principal', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await expect(
        service.publish(agentAlice, projectId, workflowKey, publishInput({ definition }), publishContext({})),
      ).rejects.toMatchObject({ code: 'HUMAN_SESSION_REQUIRED', status: 403 });
    });

    it('rejects a stale project version', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await expect(
        service.publish(alice, projectId, workflowKey, publishInput({ definition, expectedVersion: 2 }), publishContext({})),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    });

    it('rejects a stale workflow revision pointer', async () => {
      await seedPublishedDefinition();
      const definition = definitionWithVerify('rev-1');
      state.tickets.push(makeTicket(await publishBinding(2, 0, definition)));
      await expect(
        service.publish(
          alice,
          projectId,
          workflowKey,
          publishInput({ definition, expectedCurrentRevision: 0 }),
          publishContext({}),
        ),
      ).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
      expect(state.revisions).toHaveLength(1);
    });

    it('rejects a ticket issued for a different definition digest', async () => {
      const definition = demoDefinition();
      const changed = demoDefinition({ title: 'Changed after preview' });
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await expect(
        service.publish(alice, projectId, workflowKey, publishInput({ definition: changed }), publishContext({})),
      ).rejects.toMatchObject({ code: 'ACTION_CHANGED', status: 409 });
      expect(state.revisions).toHaveLength(0);
    });

    it('rejects a wrong ticket secret', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await expect(
        service.publish(
          alice,
          projectId,
          workflowKey,
          publishInput({ definition, confirmation: { ticketId: 'tk-1', ticketSecret: 'wrong' } }),
          publishContext({}),
        ),
      ).rejects.toMatchObject({ code: 'CONFIRMATION_INVALID', status: 403 });
    });

    it('requires a removal reason for every deleted step', async () => {
      await seedPublishedDefinition();
      const definition = demoDefinition({ baseRevisionId: 'rev-1', stepRemovals: [] });
      state.tickets.push(makeTicket(await publishBinding(2, 1, definition)));
      await expect(
        service.publish(
          alice,
          projectId,
          workflowKey,
          publishInput({ definition, expectedCurrentRevision: 1 }),
          publishContext({}),
        ),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID', status: 409 });
      expect(state.revisions).toHaveLength(1);
    });

    it('accepts a removal with an explicit reason', async () => {
      await seedPublishedDefinition();
      const definition = demoDefinition({
        baseRevisionId: 'rev-1',
        stepRemovals: [{ stepKey: 'verify', reason: 'verification folded into release' }],
      });
      state.tickets.push(makeTicket(await publishBinding(2, 1, definition)));
      const result = await service.publish(
        alice,
        projectId,
        workflowKey,
        publishInput({ definition, expectedCurrentRevision: 1 }),
        publishContext(currentBody(definition, 2, 1)),
      );
      expect(result.revision).toBe(2);
      expect(state.revisions).toHaveLength(2);
    });

    it('publishes revision 1 and bumps the project version', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      const result = await service.publish(
        alice,
        projectId,
        workflowKey,
        publishInput({ definition }),
        publishContext(currentBody(definition, 1, 0)),
      );
      expect(result.revision).toBe(1);
      expect(result.projectVersion).toBe(2);
      expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
      expect(state.revisions).toHaveLength(1);
      expect(state.definition?.currentPublishedRevisionId).toBe('rev-1');
      expect(state.tickets[0].consumedAt).toEqual(now);
    });

    it('replays the same idempotent publish without a second revision', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      const body = currentBody(definition, 1, 0);
      const first = await service.publish(alice, projectId, workflowKey, publishInput({ definition }), publishContext(body));
      const replay = await service.publish(
        alice,
        projectId,
        workflowKey,
        publishInput({ definition }),
        publishContext(body, { operationId: 'op-2' }),
      );
      expect(replay.replayed).toBe(true);
      expect(replay.revision).toBe(first.revision);
      expect(replay.definitionRevisionId).toBe(first.definitionRevisionId);
      expect(state.revisions).toHaveLength(1);
      expect(state.operations).toHaveLength(1);
    });

    it('rejects reusing an idempotency key for a different request', async () => {
      const definition = demoDefinition();
      state.tickets.push(makeTicket(await publishBinding(1, 0, definition)));
      await service.publish(alice, projectId, workflowKey, publishInput({ definition }), publishContext(currentBody(definition, 1, 0)));
      await expect(
        service.publish(
          alice,
          projectId,
          workflowKey,
          publishInput({ definition }),
          publishContext({ ...currentBody(definition, 1, 0), expectedVersion: 9 }),
        ),
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });
    });
  });

  describe('createInstance', () => {
    it('materialises one task per step and bumps the requirement version', async () => {
      await seedPublishedDefinition(demoDefinition());
      const result = await service.createInstance(alice, 'req-1', instanceInput(), instanceContext(instanceBody(instanceInput())));
      expect(result.instance.steps.map((step) => step.stepKey)).toEqual(['define', 'implement', 'release']);
      expect(result.requirementVersion).toBe(2);
      expect(state.requirements[0].version).toBe(2);
      expect(state.operations).toHaveLength(1);
    });

    it('rejects a revision that is no longer the published pointer', async () => {
      await seedPublishedDefinition(demoDefinition());
      state.revisions.push({ ...state.revisions[0], id: 'rev-2', revision: 2 });
      state.definition!.currentPublishedRevisionId = 'rev-2';
      state.definition!.currentRevision = 2;
      const stale = instanceInput({ definitionRevisionId: 'rev-1' });
      await expect(
        service.createInstance(alice, 'req-1', stale, instanceContext(instanceBody(stale))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID', status: 409, message: 'WORKFLOW_REVISION_NOT_CURRENT' });
    });

    it('rejects step bindings that do not exactly cover the definition', async () => {
      await seedPublishedDefinition(demoDefinition());
      const input = instanceInput();
      input.stepBindings = input.stepBindings.slice(0, 2);
      await expect(
        service.createInstance(alice, 'req-1', input, instanceContext(instanceBody(input))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' });
      expect(state.instances).toHaveLength(0);
    });

    it('rejects an IMPL step without a code repository scope', async () => {
      await seedPublishedDefinition(demoDefinition());
      const input = instanceInput();
      input.stepBindings[1].repositoryIds = [];
      await expect(
        service.createInstance(alice, 'req-1', input, instanceContext(instanceBody(input))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' });
    });

    it('rejects role slot bindings that do not cover every slot', async () => {
      await seedPublishedDefinition(demoDefinition());
      const input = instanceInput({ roleSlotBindings: [] });
      await expect(
        service.createInstance(alice, 'req-1', input, instanceContext(instanceBody(input))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' });
    });

    it('rejects an instance that does not cover the confirmed delivery scope', async () => {
      await seedPublishedDefinition(demoDefinition());
      state.requirements[0].deliveryScope = {
        participatingRoleIds: ['r-product', 'r-eng', 'r-ops', 'r-extra'],
        requiredOutputKinds: ['IMPL'],
      };
      await expect(
        service.createInstance(alice, 'req-1', instanceInput(), instanceContext(instanceBody(instanceInput()))),
      ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID', status: 409 });
    });

    it('retires the previous active instance', async () => {
      await seedPublishedDefinition(demoDefinition());
      const first = await service.createInstance(alice, 'req-1', instanceInput(), instanceContext(instanceBody(instanceInput())));
      state.requirements[0].version = 2;
      state.operations = [];
      const second = await service.createInstance(
        alice,
        'req-1',
        instanceInput({ expectedRequirementVersion: 2 }),
        instanceContext(instanceBody(instanceInput({ expectedRequirementVersion: 2 }))),
      );
      const retired = state.instances.find((instance) => instance.id === first.instance.id)!;
      expect(retired.retiredAt).toEqual(now);
      expect(retired.workStatus).toBe('CANCELLED');
      expect(second.instance.workStatus).toBe('ACTIVE');
    });

    it('replays the same idempotent instance creation', async () => {
      await seedPublishedDefinition(demoDefinition());
      const input = instanceInput();
      const body = instanceBody(input);
      const first = await service.createInstance(alice, 'req-1', input, instanceContext(body));
      const replay = await service.createInstance(alice, 'req-1', input, instanceContext(body));
      expect(replay.replayed).toBe(true);
      expect(replay.instance.id).toBe(first.instance.id);
      expect(state.instances).toHaveLength(1);
    });
  });
});

function currentBody(definition: Record<string, unknown>, expectedVersion: number, expectedCurrentRevision: number) {
  return { expectedVersion, expectedCurrentRevision, definition, packageLocks: locks };
}

function instanceBody(input: V1CreateInstanceRequest) {
  return {
    definitionRevisionId: input.definitionRevisionId,
    expectedRequirementVersion: input.expectedRequirementVersion,
    stepBindings: input.stepBindings,
    roleSlotBindings: input.roleSlotBindings,
  };
}
