import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson, sha256Bytes, type ActionBinding } from '@workmesh/shared';

import { HttpExceptionFilter } from '../src/common/http-exception.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import { StrictJsonInterceptor } from '../src/common/strict-json.interceptor';

import { V1AuthService, V1_AUTH_REPOSITORY } from '../src/auth/v1-auth.service';
import type { V1AuthRepository } from '../src/auth/v1-auth.repository';
import { hashSecret, randomSecret } from '../src/auth/v1-policy';
import {
  V1AuthorizationService,
  V1_AUTHORIZATION_REPOSITORY,
  type V1AuthorizationRepository,
  type V1MemberRecord,
  type V1ProjectRecord,
  type V1RoleAssignmentRecord,
} from '../src/auth/v1-authorization';
import {
  actionDigestOf,
  hashTicketSecret,
  V1_CONFIRMATION_REPOSITORY,
  type V1ConfirmationRepository,
  type V1TicketRecord,
} from '../src/auth/v1-confirmation';
import {
  V1_IDEMPOTENCY_REPOSITORY,
  type V1IdempotencyRepository,
  type V1OperationRecord,
} from '../src/common/v1-idempotency';

import { ProjectsController } from '../src/projects/projects.controller';
import { ProjectsService } from '../src/projects/projects.service';
import {
  PROJECT_ROLE_REPOSITORY,
  type ProjectRoleRepository,
} from '../src/projects/project-role.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { RequirementsController } from '../src/projects/requirements.controller';
import { RequirementsService } from '../src/projects/requirements.service';

import { V1WorkflowController } from '../src/workflows/v1-workflow.controller';
import { V1WorkflowService } from '../src/workflows/v1-workflow.service';
import {
  V1_WORKFLOW_REPOSITORY,
  type V1CreateInstanceInput,
  type V1CreateInstanceResult,
  type V1WorkflowInstanceView,
  type V1WorkflowRepository,
  type V1WorkflowRevisionView,
} from '../src/workflows/v1-workflow.repository';

import { V1ArtifactSetController, V1TaskController } from '../src/tasks/v1-task.controller';
import { V1TaskService } from '../src/tasks/v1-task.service';
import {
  V1_TASK_REPOSITORY,
  type V1ClaimInput,
  type V1ReleaseInput,
  type V1SetWorkStatusInput,
  type V1TaskRepository,
  type V1TaskSnapshot,
} from '../src/tasks/v1-task.repository';
import { V1ArtifactService } from '../src/tasks/v1-artifact.service';
import {
  V1_ARTIFACT_REPOSITORY,
  type V1ArtifactRepository,
  type V1ArtifactSetSnapshot,
  type V1DeliverInput,
  type V1DeliverResultRow,
} from '../src/tasks/v1-artifact.repository';

import { V1ReviewController } from '../src/reviews/v1-review.controller';
import { V1ReviewService } from '../src/reviews/v1-review.service';
import {
  V1_REVIEW_REPOSITORY,
  type V1CommitDecisionResult,
  type V1ReviewRepository,
  type V1ReviewSnapshot,
} from '../src/reviews/v1-review.repository';

// ---------------------------------------------------------------------------
// 固定标识：会话/凭据/角色/对象 ID 全部为稳定 UUID，便于复跑。
// ---------------------------------------------------------------------------
const PROJECT_ID = 'p1';
// DTO 要求 responsibleUserId 为 UUID，故主体 ID 统一采用 UUID 形态。
const OWNER = 'aa000000-0000-4000-8000-000000000001';
const MEMBER = 'aa000000-0000-4000-8000-000000000002';
const PUBLIC_ORIGIN = 'http://127.0.0.1:5173';

const ROLE_BACKEND = '11111111-1111-4111-8111-111111111111';
const REPO_ID = '22222222-2222-4222-8222-222222222222';
const DEFINITION_ID = '33333333-3333-4333-8333-333333333331';
const DEFINITION_REVISION_ID = '33333333-3333-4333-8333-333333333332';
const OWNER_SESSION_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_CREDENTIAL_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const SLOT_ID = '77777777-7777-4777-8777-777777777777';
const TICKET_ID = '88888888-8888-4888-8888-888888888888';
const SNAPSHOT_ID = '99999999-9999-4999-8999-999999999999';
const INSTANCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const KEY_INSTANCE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY_CLAIM = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const KEY_DELIVER = 'f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0';
const KEY_DECIDE = '0a0a0a0a-0a0a-40a0-80a0-0a0a0a0a0a0a';

const OWNER_SECRET = randomSecret();
const OWNER_CSRF = randomSecret();
const AGENT_SECRET = randomSecret();
const TICKET_SECRET = 'ticket-secret-chain';

const OWNER_COOKIE = `__Host-wm_session=wm_s1.${OWNER_SESSION_ID}.${OWNER_SECRET}; __Host-wm_csrf=${OWNER_CSRF}`;
const AGENT_TOKEN = `wm_a1.${AGENT_CREDENTIAL_ID}.${AGENT_SECRET}`;

const DEFINITION = {
  key: 'wf-chain',
  title: '试点交付流程',
  steps: [{ key: 'impl', roleKey: 'backend', deps: [], outputKinds: ['IMPL'] }],
};

const COMPILED_RULES = {
  resolvedRoles: [{ stepKey: 'impl', roleKey: 'backend', roleId: ROLE_BACKEND }],
  packageLocks: [],
  systemGates: [],
};

function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// 共享内存存储：Prisma 替身与授权仓储读写同一份成员/项目数据，保证 HTTP 链路状态连贯。
// ---------------------------------------------------------------------------
class ChainStore {
  projects = new Map<
    string,
    { id: string; key: string; version: number; archivedAt: Date | null }
  >();
  members = new Map<
    string,
    { projectId: string; userId: string; role: string; version: number; revokedAt: Date | null }
  >();
  users = new Map<string, { id: string; email: string }>();
  requirements = new Map<string, Record<string, unknown>>();
  tasks = new Map<string, V1TaskSnapshot>();
  artifactSets = new Map<string, V1ArtifactSetSnapshot>();
  reviews = new Map<string, V1ReviewSnapshot>();

  reset(): void {
    this.projects.clear();
    this.members.clear();
    this.users.clear();
    this.requirements.clear();
    this.tasks.clear();
    this.artifactSets.clear();
    this.reviews.clear();
    this.projects.set(PROJECT_ID, { id: PROJECT_ID, key: 'WM', version: 1, archivedAt: null });
    // 与真实库默认一致：新账号 isActive=true、authVersion=1（缺了它会被成员准入当成停用账号）。
    this.users.set(OWNER, {
      id: OWNER,
      email: 'alice@workmesh.test',
      isActive: true,
      authVersion: 1,
    });
    this.users.set(MEMBER, {
      id: MEMBER,
      email: 'bob@workmesh.test',
      isActive: true,
      authVersion: 1,
    });
    this.members.set(`${PROJECT_ID}:${OWNER}`, {
      projectId: PROJECT_ID,
      userId: OWNER,
      role: 'OWNER',
      version: 1,
      revokedAt: null,
    });
  }

  memberOf(projectId: string, userId: string) {
    return this.members.get(`${projectId}:${userId}`) ?? null;
  }
}

const store = new ChainStore();

// ---------------------------------------------------------------------------
// PrismaService 替身：仅实现本链路实际调用的投影（project / requirement / user / projectMember）。
// ---------------------------------------------------------------------------
const prismaFake = {
  user: {
    async findUnique({ where }: { where: { email: string } }) {
      for (const user of store.users.values()) if (user.email === where.email) return user;
      return null;
    },
  },
  project: {
    async findUnique({ where }: { where: { id: string } }) {
      const project = store.projects.get(where.id);
      return project ? { key: project.key } : null;
    },
  },
  projectMember: {
    async findUnique({
      where,
    }: {
      where: { projectId_userId: { projectId: string; userId: string } };
    }) {
      return store.memberOf(where.projectId_userId.projectId, where.projectId_userId.userId);
    },
    async create({ data }: { data: { projectId: string; userId: string; role: string } }) {
      const saved = { ...data, version: 1, revokedAt: null };
      store.members.set(`${data.projectId}:${data.userId}`, saved);
      return saved;
    },
    async update({
      where,
      data,
    }: {
      where: { projectId_userId: { projectId: string; userId: string } };
      data: { role: string; revokedAt: null; version: { increment: number } };
    }) {
      const current = store.memberOf(
        where.projectId_userId.projectId,
        where.projectId_userId.userId,
      )!;
      const saved = {
        ...current,
        role: data.role,
        revokedAt: data.revokedAt,
        version: current.version + 1,
      };
      store.members.set(
        `${where.projectId_userId.projectId}:${where.projectId_userId.userId}`,
        saved,
      );
      return saved;
    },
  },
  requirement: {
    async aggregate({ where }: { where: { projectId: string } }) {
      let max: number | null = null;
      for (const row of store.requirements.values()) {
        if (row.projectId !== where.projectId) continue;
        const seq = row.seq as number;
        if (max === null || seq > max) max = seq;
      }
      return { _max: { seq: max } };
    },
    async create({ data }: { data: Record<string, unknown> }) {
      const row = {
        id: randomUUID(),
        seq: data.seq as number,
        code: data.code as string,
        title: data.title as string,
        description: (data.description as string | null) ?? null,
        projectId: data.projectId as string,
        version: 1,
        generation: 1,
        phase: 'DRAFT',
        workStatus: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.requirements.set(row.id, row);
      return row;
    },
  },
  // 加成员现在会写审计记录：替身要提供 stamp 与审计两张表，否则链路会以 500 断在这里。
  principalStamp: {
    async create({ data }: { data: Record<string, unknown> }) {
      return { id: randomUUID(), ...data };
    },
  },
  auditEvent: {
    async create({ data }: { data: Record<string, unknown> }) {
      return { id: randomUUID(), ...data };
    },
  },
  async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
    return fn(prismaFake);
  },
};

// ---------------------------------------------------------------------------
// 真实 V1AuthGuard 依赖的认证仓储：只实现本链路使用的会话/凭据查询。
// ---------------------------------------------------------------------------
const ownerSession = {
  id: OWNER_SESSION_ID,
  userId: OWNER,
  tokenHash: hashSecret(OWNER_SECRET),
  csrfTokenHash: hashSecret(OWNER_CSRF),
  userAuthVersion: 1,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  user: { id: OWNER, isActive: true, authVersion: 1 },
};

const agentCredential = {
  id: AGENT_CREDENTIAL_ID,
  userId: MEMBER,
  projectId: PROJECT_ID,
  roleId: ROLE_BACKEND,
  name: 'chain-agent',
  tokenHash: hashSecret(AGENT_SECRET),
  scopes: ['task:claim', 'task:deliver', 'knowledge:read'],
  userAuthVersion: 1,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  revokedAt: null,
  user: { id: MEMBER, isActive: true, authVersion: 1 },
};

const authRepo = {
  async findSession(sessionId: string) {
    return sessionId === OWNER_SESSION_ID ? ownerSession : null;
  },
  async findCredential(credentialId: string) {
    return credentialId === AGENT_CREDENTIAL_ID ? agentCredential : null;
  },
  async touchSession() {},
} as unknown as V1AuthRepository;

// ---------------------------------------------------------------------------
// 授权仓储：直接读共享存储，使"加入成员"对后续所有动作立即生效。
// ---------------------------------------------------------------------------
class ChainAuthzRepo implements V1AuthorizationRepository {
  async findProject(projectId: string): Promise<V1ProjectRecord | null> {
    const project = store.projects.get(projectId);
    return project
      ? { id: project.id, version: project.version, archivedAt: project.archivedAt }
      : null;
  }
  async findMember(projectId: string, userId: string): Promise<V1MemberRecord | null> {
    const member = store.memberOf(projectId, userId);
    return member ? { ...member, role: member.role as V1MemberRecord['role'] } : null;
  }
  async findActiveRoleAssignments(
    projectId: string,
    userId: string,
  ): Promise<V1RoleAssignmentRecord[]> {
    if (userId !== MEMBER) return [];
    return [
      { id: 'ra-chain', projectId, userId, roleId: ROLE_BACKEND, version: 1, revokedAt: null },
    ];
  }
  async findRoleAssignment(
    projectId: string,
    userId: string,
    roleId: string,
  ): Promise<V1RoleAssignmentRecord | null> {
    if (userId !== MEMBER || roleId !== ROLE_BACKEND) return null;
    return { id: 'ra-chain', projectId, userId, roleId, version: 1, revokedAt: null };
  }
  async findKnowledgeBase() {
    return null;
  }
  async findGrants() {
    return [];
  }
}

class ChainWorkflowRepo implements V1WorkflowRepository {
  async listDefinitions() {
    return { items: [], nextCursor: null };
  }
  async findDefinition(projectId: string, workflowKey: string) {
    if (projectId !== PROJECT_ID) return null;
    return {
      id: DEFINITION_ID,
      workflowKey,
      title: '试点交付流程',
      version: 1,
      currentPublishedRevisionId: DEFINITION_REVISION_ID,
      currentRevision: 1,
    };
  }
  async findRevision(revisionId: string): Promise<V1WorkflowRevisionView | null> {
    if (revisionId !== DEFINITION_REVISION_ID) return null;
    return {
      id: DEFINITION_REVISION_ID,
      projectId: PROJECT_ID,
      definitionId: DEFINITION_ID,
      workflowKey: 'wf-chain',
      revision: 1,
      digest: sha256Hex(canonicalJson(DEFINITION)),
      definition: DEFINITION,
      compiledRules: COMPILED_RULES,
      createdAt: new Date(),
    };
  }
  async projectRoles() {
    return [{ id: ROLE_BACKEND, key: 'backend', title: '后端', isActive: true, version: 1 }];
  }
  async findPackageVersion() {
    return null;
  }
  async findRequirement(requirementId: string) {
    const row = store.requirements.get(requirementId);
    if (!row) return null;
    return {
      id: row.id as string,
      projectId: row.projectId as string,
      version: row.version as number,
      currentPrdRevisionId: null,
      deliveryScope: null,
    };
  }
  async isActiveMember(projectId: string, userId: string) {
    const member = store.memberOf(projectId, userId);
    return Boolean(member && !member.revokedAt);
  }
  async isProjectRepository(projectId: string, repositoryId: string) {
    return projectId === PROJECT_ID && repositoryId === REPO_ID;
  }
  async publishDefinition(): Promise<never> {
    throw new Error('publishDefinition 不在本链路范围内');
  }
  async findPublishOperation() {
    return null;
  }
  async createInstance(input: V1CreateInstanceInput): Promise<V1CreateInstanceResult> {
    const instance: V1WorkflowInstanceView = {
      id: INSTANCE_ID,
      projectId: input.projectId,
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
        executionStatus: 'PENDING',
        workStatus: 'ACTIVE',
        generation: 1,
        version: 1,
        repositoryIds: step.repositoryIds,
      })),
    };
    // 真实仓储在创建实例时同时生成首版任务；内存替身保持同一语义。
    store.tasks.set(TASK_ID, {
      id: TASK_ID,
      projectId: input.projectId,
      workflowInstanceId: instance.id,
      stepKey: input.steps[0].stepKey,
      roleId: input.steps[0].roleId,
      responsibleUserId: input.steps[0].responsibleUserId,
      version: 1,
      generation: 1,
      executionStatus: 'PENDING',
      workStatus: 'ACTIVE',
      currentClaim: null,
    });
    return { instance, requirementVersion: input.expectedRequirementVersion };
  }
  async findInstance(instanceId: string): Promise<V1WorkflowInstanceView | null> {
    return instanceId === INSTANCE_ID
      ? {
          id: INSTANCE_ID,
          projectId: PROJECT_ID,
          requirementId: '',
          definitionRevisionId: DEFINITION_REVISION_ID,
          definitionDigest: '',
          version: 1,
          workStatus: 'ACTIVE',
          retiredAt: null,
          steps: [],
        }
      : null;
  }
}

class ChainTaskRepo implements V1TaskRepository {
  async findTask(taskId: string): Promise<V1TaskSnapshot | null> {
    return store.tasks.get(taskId) ?? null;
  }
  async claim(input: V1ClaimInput): Promise<V1TaskSnapshot> {
    const task = store.tasks.get(input.taskId)!;
    const next: V1TaskSnapshot = {
      ...task,
      version: task.version + 1,
      currentClaim: {
        id: randomUUID(),
        taskGeneration: input.expectedGeneration,
        principalScopeKey: input.principalScopeKey,
        releasedAt: null,
        userId: input.userId,
      },
    };
    store.tasks.set(task.id, next);
    return next;
  }
  async release(input: V1ReleaseInput): Promise<V1TaskSnapshot> {
    const task = store.tasks.get(input.taskId)!;
    const next: V1TaskSnapshot = {
      ...task,
      version: task.version + 1,
      currentClaim: task.currentClaim
        ? { ...task.currentClaim, releasedAt: input.now.toISOString() }
        : null,
    };
    store.tasks.set(task.id, next);
    return next;
  }
  async setWorkStatus(input: V1SetWorkStatusInput): Promise<V1TaskSnapshot> {
    const task = store.tasks.get(input.taskId)!;
    const next: V1TaskSnapshot = {
      ...task,
      version: task.version + 1,
      workStatus: input.workStatus,
    };
    store.tasks.set(task.id, next);
    return next;
  }
}

class ChainArtifactRepo implements V1ArtifactRepository {
  async deliver(input: V1DeliverInput): Promise<V1DeliverResultRow> {
    const set: V1ArtifactSetSnapshot = {
      id: randomUUID(),
      taskId: input.taskId,
      taskGeneration: input.expectedVersion,
      snapshotId: input.snapshotId,
      manifestDigest: await sha256Bytes(
        new TextEncoder().encode(canonicalJson({ items: input.items.length })),
      ),
      workflowDefinitionRevisionId: input.workflowDefinitionRevisionId,
      localRunId: input.localRunId,
      candidateRevisionIds: input.candidateRevisionIds,
      artifacts: input.items.map((item) => ({
        id: randomUUID(),
        kind: item.kind,
        schemaVersion: item.schemaVersion,
        storage: item.storage,
        mediaType: item.mediaType,
        byteLength: item.byteLength,
        sha256: item.sha256,
        projectRepositoryId: item.projectRepositoryId,
        commitSha: item.commitSha,
        repoPath: item.repoPath,
        summary: item.summary,
        checks: item.checks,
      })),
      createdAt: input.now,
    };
    store.artifactSets.set(set.id, set);

    // 真实交付在同一事务内派生 TASK_ACCEPTANCE 评审；内存替身保持同一语义。
    const reviewId = randomUUID();
    store.reviews.set(reviewId, {
      id: reviewId,
      projectId: PROJECT_ID,
      kind: 'TASK_ACCEPTANCE',
      status: 'OPEN',
      version: 1,
      subjectDigest: input.subjectDigest,
      documentRevisionId: null,
      artifactSetId: set.id,
      taskId: input.taskId,
      slots: [
        {
          id: SLOT_ID,
          slotKey: 'acceptance',
          kind: 'TASK_ACCEPTANCE',
          requiredRoleId: null,
          requiredUserId: OWNER,
          sourceSlotBindingId: null,
        },
      ],
      decisions: [],
      subject: null,
    });

    return { artifactSet: set, task: store.tasks.get(input.taskId)!, reviewRequestId: reviewId };
  }
  async findArtifactSet(id: string): Promise<V1ArtifactSetSnapshot | null> {
    return store.artifactSets.get(id) ?? null;
  }
}

class ChainReviewRepo implements V1ReviewRepository {
  async findReview(reviewId: string): Promise<V1ReviewSnapshot | null> {
    return store.reviews.get(reviewId) ?? null;
  }
  async commitDecision(input: {
    reviewId: string;
    slotId: string;
    decision: string;
  }): Promise<V1CommitDecisionResult> {
    const review = store.reviews.get(input.reviewId)!;
    const decided: V1ReviewSnapshot = {
      ...review,
      status: input.decision === 'APPROVE' ? 'APPROVED' : 'CHANGES_REQUESTED',
      version: review.version + 1,
      decisions: [
        {
          id: randomUUID(),
          reviewRequestId: review.id,
          approvalSlotId: input.slotId,
          decision: input.decision,
          decidedByUserId: OWNER,
          comment: null,
          decidedAt: new Date(),
          revokedAt: null,
        },
      ],
    };
    store.reviews.set(review.id, decided);
    return {
      decisionId: randomUUID(),
      review: decided,
      published: false,
      publicationId: null,
      documentVersion: null,
      approvedSlotIds: [input.slotId],
      subjectResult: { kind: 'TASK_ACCEPTED' },
      task: { id: review.taskId, status: 'ACCEPTED' },
      requirement: null,
    };
  }
}

class ChainConfirmationRepo implements V1ConfirmationRepository {
  private tickets = new Map<string, V1TicketRecord>();

  reset(): void {
    this.tickets.clear();
  }

  seed(ticket: V1TicketRecord): void {
    this.tickets.set(ticket.id, ticket);
  }

  async findTicket(id: string): Promise<V1TicketRecord | null> {
    return this.tickets.get(id) ?? null;
  }

  async consumeTicket(): Promise<{ consumed: boolean; ticket: V1TicketRecord | null }> {
    return { consumed: true, ticket: null };
  }
}

class ChainIdempotencyRepo implements V1IdempotencyRepository {
  async findOperation(): Promise<V1OperationRecord | null> {
    // 本链路每次动作使用不同幂等键，首次均不命中；重放路径由独立回归用例覆盖。
    return null;
  }
}

// ---------------------------------------------------------------------------
// 引导真实 Nest 应用：真实控制器、真实 V1AuthGuard（不做 overrideGuard）、真实服务。
// ---------------------------------------------------------------------------
describe('v1 HTTP business chain (real Nest routes + real V1AuthGuard)', () => {
  let server: unknown;
  let appRef: { close: () => Promise<void> };
  let confirmationRepo: ChainConfirmationRepo;

  beforeAll(async () => {
    vi.stubEnv('WORKMESH_COOKIE_MODE', 'SECURE');
    vi.stubEnv('WORKMESH_PUBLIC_ORIGIN', PUBLIC_ORIGIN);
    const authzRepo = new ChainAuthzRepo();
    const workflowRepo = new ChainWorkflowRepo();
    const taskRepo = new ChainTaskRepo();
    const artifactRepo = new ChainArtifactRepo();
    const reviewRepo = new ChainReviewRepo();
    confirmationRepo = new ChainConfirmationRepo();
    const idempotencyRepo = new ChainIdempotencyRepo();

    const authzService = new V1AuthorizationService(authzRepo);
    const authService = new V1AuthService(authRepo);

    const projectsService = new ProjectsService(
      prismaFake as unknown as PrismaService,
      {} as unknown as ProjectRoleRepository,
      confirmationRepo,
      idempotencyRepo,
    );
    const requirementsService = new RequirementsService(
      prismaFake as unknown as PrismaService,
      authzService,
    );
    const workflowService = new V1WorkflowService(
      workflowRepo,
      authzService,
      confirmationRepo,
      idempotencyRepo,
    );
    const taskService = new V1TaskService(taskRepo, authzService, idempotencyRepo);
    const artifactService = new V1ArtifactService(
      artifactRepo,
      taskRepo,
      authzService,
      idempotencyRepo,
    );
    const reviewService = new V1ReviewService(
      reviewRepo as unknown as V1ReviewRepository,
      authzService,
      confirmationRepo,
      idempotencyRepo,
    );

    const moduleRef = await Test.createTestingModule({
      controllers: [
        ProjectsController,
        RequirementsController,
        V1WorkflowController,
        V1TaskController,
        V1ArtifactSetController,
        V1ReviewController,
      ],
      providers: [
        { provide: V1AuthService, useValue: authService },
        { provide: V1_AUTH_REPOSITORY, useValue: authRepo },
        { provide: PrismaService, useValue: prismaFake },
        { provide: PROJECT_ROLE_REPOSITORY, useValue: {} },
        { provide: ProjectsService, useValue: projectsService },
        { provide: RequirementsService, useValue: requirementsService },
        { provide: V1WorkflowService, useValue: workflowService },
        { provide: V1TaskService, useValue: taskService },
        { provide: V1ArtifactService, useValue: artifactService },
        { provide: V1ReviewService, useValue: reviewService },
        { provide: V1AuthorizationService, useValue: authzService },
        { provide: V1_AUTHORIZATION_REPOSITORY, useValue: authzRepo },
        { provide: V1_WORKFLOW_REPOSITORY, useValue: workflowRepo },
        { provide: V1_TASK_REPOSITORY, useValue: taskRepo },
        { provide: V1_ARTIFACT_REPOSITORY, useValue: artifactRepo },
        { provide: V1_REVIEW_REPOSITORY, useValue: reviewRepo },
        { provide: V1_CONFIRMATION_REPOSITORY, useValue: confirmationRepo },
        { provide: V1_IDEMPOTENCY_REPOSITORY, useValue: idempotencyRepo },
      ],
    }).compile();

    const app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseInterceptor(), new StrictJsonInterceptor());
    app.use(
      (
        req: { requestId?: string },
        res: { setHeader: (n: string, v: string) => void },
        next: () => void,
      ) => {
        const id = randomUUID();
        req.requestId = id;
        res.setHeader('X-Request-Id', id);
        res.setHeader('Cache-Control', 'no-store');
        next();
      },
    );
    await app.init();
    server = app.getHttpServer();
    appRef = app as unknown as { close: () => Promise<void> };
  });

  afterAll(async () => {
    await appRef?.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    store.reset();
    confirmationRepo.reset();
  });

  it('单一 HTTP 链路：Owner 加入已注册成员 → 创建需求 → 创建工作流 → Agent 认领并交付 → HUMAN 评审', async () => {
    // --- 1) Owner 以真实 Web 会话加入已注册成员（邮箱大小写/空格需服务端归一化）---
    const addMember = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/members`)
      .set('Cookie', OWNER_COOKIE)
      .set('Origin', PUBLIC_ORIGIN)
      .set('x-csrf-token', OWNER_CSRF)
      .send({ email: '  Bob@WorkMesh.test  ' });
    expect(addMember.status).toBe(201);
    expect(addMember.body.data.id).toBe(MEMBER);
    expect(addMember.body.data.role).toBe('MEMBER');
    // 加入结果必须立即进入授权仓储：内存共享存储可观测。
    expect(store.memberOf(PROJECT_ID, MEMBER)).toMatchObject({ role: 'MEMBER', revokedAt: null });

    // --- 2) Owner 创建需求 ---
    const requirement = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/requirements`)
      .set('Cookie', OWNER_COOKIE)
      .set('Origin', PUBLIC_ORIGIN)
      .set('x-csrf-token', OWNER_CSRF)
      .send({ title: '试点链路需求', description: '由 Agent 交付并由人类评审' });
    expect(requirement.status).toBe(201);
    const requirementId = requirement.body.data.id as string;
    expect(requirement.body.data.code).toBe('WM-001');
    expect(requirement.body.data.version).toBe(1);

    // --- 3) 创建工作流实例（绑定 IMPL 步骤与代码仓库）---
    const instance = await request(server)
      .post(`/api/v1/requirements/${requirementId}/workflow-instances`)
      .set('Cookie', OWNER_COOKIE)
      .set('Origin', PUBLIC_ORIGIN)
      .set('x-csrf-token', OWNER_CSRF)
      .set('Idempotency-Key', KEY_INSTANCE)
      .send({
        definitionRevisionId: DEFINITION_REVISION_ID,
        expectedRequirementVersion: 1,
        stepBindings: [
          {
            stepKey: 'impl',
            roleId: ROLE_BACKEND,
            responsibleUserId: MEMBER,
            repositoryIds: [REPO_ID],
          },
        ],
        roleSlotBindings: [],
      });
    expect(instance.status).toBe(201);
    expect(instance.body.data.instance.steps).toHaveLength(1);
    expect(instance.body.data.instance.steps[0].roleId).toBe(ROLE_BACKEND);
    expect(store.tasks.has(TASK_ID)).toBe(true);

    // --- 4) Agent 以真实 Bearer 凭据认领任务 ---
    const claim = await request(server)
      .post(`/api/v1/tasks/${TASK_ID}/claims`)
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Idempotency-Key', KEY_CLAIM)
      .send({});
    expect(claim.status).toBe(201);
    const claimId = claim.body.data.claimId as string;
    expect(claimId).toBeTruthy();
    expect(claim.body.data.replayed).toBe(false);
    expect(store.tasks.get(TASK_ID)!.currentClaim).not.toBeNull();

    // --- 5) Agent 在有效认领下交付工件集（HOSTED 摘要由服务端重算）---
    const bodyBytes = Buffer.from('# 试点交付物', 'utf8');
    const deliver = await request(server)
      .post(`/api/v1/tasks/${TASK_ID}/artifact-sets`)
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Idempotency-Key', KEY_DELIVER)
      .send({
        expectedVersion: store.tasks.get(TASK_ID)!.version,
        claimId,
        snapshotId: SNAPSHOT_ID,
        workflowDefinitionRevisionId: DEFINITION_REVISION_ID,
        localRunId: 'chain-run-1',
        candidateRevisionIds: [],
        items: [
          {
            kind: 'IMPL',
            schemaVersion: '1.0',
            storage: 'HOSTED',
            mediaType: 'text/markdown; charset=utf-8',
            sha256: sha256Hex(bodyBytes),
            byteLength: bodyBytes.byteLength,
            bodyBase64: bodyBytes.toString('base64'),
            checks: [{ code: 'build', passed: true, message: 'ok' }],
          },
        ],
      });
    expect(deliver.status).toBe(201);
    const artifactSetId = deliver.body.data.artifactSet.id as string;
    const reviewRequestId = deliver.body.data.reviewRequestId as string;
    expect(deliver.body.data.replayed).toBe(false);
    expect(deliver.body.data.artifactSet.artifacts[0].sha256).toBe(sha256Hex(bodyBytes));
    expect(reviewRequestId).toBeTruthy();

    // --- 6) HUMAN 以真实会话 + 一次性票据完成评审批准 ---
    const review = store.reviews.get(reviewRequestId)!;
    expect(review.kind).toBe('TASK_ACCEPTANCE');
    const binding: ActionBinding = {
      action: 'REVIEW_DECIDE',
      projectId: PROJECT_ID,
      targetType: 'REVIEW_REQUEST',
      targetId: reviewRequestId,
      expectedVersion: review.version,
      roleSlot: null,
      payload: {
        slotId: SLOT_ID,
        decision: 'APPROVE',
        subjectDigest: review.subjectDigest,
        comment: null,
      },
    };
    confirmationRepo.seed({
      id: TICKET_ID,
      secretHash: hashTicketSecret(TICKET_SECRET),
      userId: OWNER,
      webSessionId: OWNER_SESSION_ID,
      projectId: PROJECT_ID,
      userAuthVersion: 1,
      action: 'REVIEW_DECIDE',
      targetType: 'REVIEW_REQUEST',
      targetId: reviewRequestId,
      expectedVersion: review.version,
      actionDigest: actionDigestOf(binding),
      roleId: null,
      approvalSlotId: null,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      consumedAt: null,
      consumedOperationId: null,
      invalidatedAt: null,
    });

    const decide = await request(server)
      .post(`/api/v1/review-requests/${reviewRequestId}/decisions`)
      .set('Cookie', OWNER_COOKIE)
      .set('Origin', PUBLIC_ORIGIN)
      .set('x-csrf-token', OWNER_CSRF)
      .set('Idempotency-Key', KEY_DECIDE)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: review.version,
        comment: null,
        confirmation: { ticketId: TICKET_ID, ticketSecret: TICKET_SECRET },
      });
    expect(decide.status).toBe(201);
    expect(decide.body.data.decisionId).toBeTruthy();
    expect(decide.body.data.review.status).toBe('APPROVED');
    expect(store.reviews.get(reviewRequestId)!.status).toBe('APPROVED');

    // 端到端闭环：交付物可由 HTTP 读回，且摘要一致。
    const readBack = await request(server)
      .get(`/api/v1/artifact-sets/${artifactSetId}`)
      .set('Cookie', OWNER_COOKIE)
      .set('Origin', PUBLIC_ORIGIN);
    expect(readBack.status).toBe(200);
    expect(readBack.body.data.id).toBe(artifactSetId);
  });

  it('真实守卫证据：伪造会话密钥 → 401 AUTH_REQUIRED（不落到业务层）', async () => {
    const forged = `__Host-wm_session=wm_s1.${OWNER_SESSION_ID}.${randomBytes(32).toString('base64url')}; __Host-wm_csrf=${OWNER_CSRF}`;
    const res = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/members`)
      .set('Cookie', forged)
      .set('Origin', PUBLIC_ORIGIN)
      .set('x-csrf-token', OWNER_CSRF)
      .send({ email: 'bob@workmesh.test' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('真实守卫证据：HUMAN 写请求缺失 Origin → 403 UNSAFE_ORIGIN', async () => {
    const res = await request(server)
      .post(`/api/v1/projects/${PROJECT_ID}/members`)
      .set('Cookie', OWNER_COOKIE)
      .set('x-csrf-token', OWNER_CSRF)
      .send({ email: 'bob@workmesh.test' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UNSAFE_ORIGIN');
  });

  it('真实守卫证据：Agent 凭据不得完成 HUMAN 评审决定 → 403 HUMAN_SESSION_REQUIRED', async () => {
    store.reviews.set('rr-agent', {
      id: 'rr-agent',
      projectId: PROJECT_ID,
      kind: 'TASK_ACCEPTANCE',
      status: 'OPEN',
      version: 1,
      subjectDigest: sha256Hex('x'),
      documentRevisionId: null,
      artifactSetId: null,
      taskId: TASK_ID,
      slots: [
        {
          id: SLOT_ID,
          slotKey: 'acceptance',
          kind: 'TASK_ACCEPTANCE',
          requiredRoleId: null,
          requiredUserId: OWNER,
          sourceSlotBindingId: null,
        },
      ],
      decisions: [],
      subject: null,
    });
    const res = await request(server)
      .post('/api/v1/review-requests/rr-agent/decisions')
      .set('Authorization', `Bearer ${AGENT_TOKEN}`)
      .set('Idempotency-Key', KEY_DECIDE)
      .send({
        slotId: SLOT_ID,
        decision: 'APPROVE',
        expectedVersion: 1,
        comment: null,
        confirmation: { ticketId: TICKET_ID, ticketSecret: TICKET_SECRET },
      });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('HUMAN_SESSION_REQUIRED');
  });
});
