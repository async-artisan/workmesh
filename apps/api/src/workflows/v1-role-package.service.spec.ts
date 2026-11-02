import { beforeEach, describe, expect, it } from 'vitest';
import { canonicalJson, sha256Bytes, V1_ERROR_CODES, WorkmeshError, type ActionBinding, type Principal } from '@workmesh/shared';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { V1Principal } from '../auth/v1-policy';
import { actionDigestOf, hashTicketSecret, type V1ConfirmationRepository, type V1TicketRecord } from '../auth/v1-confirmation';
import type { V1OperationRecord } from '../common/v1-idempotency';
import { ROLE_PACKAGE_PUBLISH, ROLE_PACKAGE_TARGET, V1RolePackageService, type V1RolePackageContext, type V1RegisterRolePackageRequest } from './v1-role-package.service';
import type {
  V1RegisterRolePackageInput,
  V1RegisterRolePackageResult,
  V1RolePackageDetail,
  V1RolePackageRepository,
  V1RolePackageResourceView,
} from './v1-role-package.repository';

const now = new Date('2026-11-01T00:00:00.000Z');
const projectId = 'p-a';
const ticketSecret = 'ticket-secret-value';
const idempotencyKey = '11111111-1111-4111-8111-111111111111';
const packageId = 'workmesh.product';
const version = '1.2.3';
const encoder = new TextEncoder();
const sopBody = encoder.encode('# SOP\n');

async function manifest(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    packageSchemaVersion: '1.0',
    id: packageId,
    version,
    protocolVersion: '1.0',
    title: 'Product',
    roleKey: 'product',
    compatibility: { minCliVersion: '1.0.0', maxCliVersionExclusive: '2.0.0', contractVersion: '1.0' },
    inputs: [],
    outputs: [{ key: 'prd', channel: 'CANDIDATE', kind: 'PRD', contractVersion: '1.0' }],
    resources: [
      {
        id: 'sop',
        kind: 'AGENT_ENTRY',
        path: 'docs/sop.md',
        sha256: await sha256Bytes(sopBody),
        byteLength: sopBody.byteLength,
        mediaType: 'text/markdown',
      },
    ],
    agentEntries: [{ host: 'codex', type: 'AGENTS_MD_POINTER', resourceId: 'sop', adapterVersion: '1.0.0' }],
    ...overrides,
  };
}

type StoredPackage = V1RolePackageDetail & { resources: V1RolePackageResourceView[] };
type StoredOperation = V1OperationRecord & { resultRefs: Record<string, unknown> };

type State = {
  projectVersion: number;
  memberRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  roleKeys: string[];
  builtinIds: string[];
  packages: StoredPackage[];
  operations: StoredOperation[];
  tickets: V1TicketRecord[];
};

function store(): State {
  return {
    projectVersion: 3,
    memberRole: 'OWNER',
    roleKeys: ['product', 'engineering', 'ops'],
    builtinIds: [],
    packages: [],
    operations: [],
    tickets: [],
  };
}

function packageRepository(state: State): V1RolePackageRepository {
  return {
    async list(project, query) {
      const visible = state.packages.filter((item) => item.scope === 'BUILTIN' || item.projectId === project);
      return { items: visible.slice(0, query.limit).map(({ resources: _resources, ...item }) => item), nextCursor: null };
    },
    async findVersion(project, id, value) {
      return (
        state.packages.find(
          (item) => item.packageId === id && item.version === value && (item.scope === 'BUILTIN' || item.projectId === project),
        ) ?? null
      );
    },
    async findResource(packageVersionId, resourceId) {
      const found = state.packages.find((item) => item.id === packageVersionId);
      return found?.resources.find((resource) => resource.resourceId === resourceId) ?? null;
    },
    async hasBuiltin(id) {
      return state.builtinIds.includes(id);
    },
    async projectRoleKeys() {
      return state.roleKeys;
    },
    async findProject(project) {
      return { id: project, version: state.projectVersion };
    },
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
    async register(input: V1RegisterRolePackageInput): Promise<V1RegisterRolePackageResult> {
      if (state.projectVersion !== input.expectedProjectVersion)
        throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'PROJECT_VERSION_CONFLICT', undefined, 409);
      const ticket = state.tickets.find((item) => item.id === input.ticket.id);
      if (!ticket || ticket.secretHash !== input.ticket.secretHash || ticket.consumedAt || ticket.invalidatedAt)
        throw new WorkmeshError(V1_ERROR_CODES.CONFIRMATION_USED, 'CONFIRMATION_CONSUME_CONFLICT', undefined, 409);
      ticket.consumedAt = now;
      ticket.consumedOperationId = input.operation.id;
      if (
        state.packages.some(
          (item) => item.scope === 'PROJECT' && item.projectId === input.projectId && item.packageId === input.packageId && item.version === input.version,
        )
      )
        throw new WorkmeshError(V1_ERROR_CODES.VERSION_CONFLICT, 'ROLE_PACKAGE_VERSION_CONFLICT', undefined, 409);
      const stored: StoredPackage = {
        id: 'pv-1',
        packageId: input.packageId,
        version: input.version,
        roleKey: input.roleKey,
        manifestDigest: input.manifestDigest,
        scope: 'PROJECT',
        projectId: input.projectId,
        manifest: input.manifest,
        resources: input.resources.map((resource) => ({
          resourceId: resource.resourceId,
          path: resource.path,
          mediaType: resource.mediaType,
          byteLength: resource.byteLength,
          sha256: resource.sha256,
          bodyBytes: resource.bodyBytes,
        })),
      };
      state.packages.push(stored);
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
          packageVersionId: stored.id,
          packageId: stored.packageId,
          version: stored.version,
          manifestDigest: stored.manifestDigest,
          projectVersion: state.projectVersion,
        },
        committedAt: now,
      });
      return {
        packageVersionId: stored.id,
        packageId: stored.packageId,
        version: stored.version,
        manifestDigest: stored.manifestDigest,
        projectVersion: state.projectVersion,
      };
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

const registerRoute = `/api/v1/projects/${projectId}/role-packages`;

describe('V1RolePackageService', () => {
  let state: State;
  let service: V1RolePackageService;

  beforeEach(() => {
    state = store();
    const repository = packageRepository(state);
    const authorization = new V1AuthorizationService(authRepository(state));
    const tickets: V1ConfirmationRepository = {
      async createTicket() {
        throw new Error('not used');
      },
      async findTicket(ticketId) {
        return state.tickets.find((item) => item.id === ticketId) ?? null;
      },
      async consumeTicket() {
        throw new Error('not used');
      },
    };
    service = new V1RolePackageService(repository, authorization, tickets, { async findOperation() { return null; } });
  });

  async function bindingFor(expectedVersion: number, manifestDigest: string, resourceIds: string[] = ['sop']): Promise<ActionBinding> {
    return {
      action: ROLE_PACKAGE_PUBLISH,
      projectId,
      targetType: ROLE_PACKAGE_TARGET,
      targetId: packageId,
      expectedVersion,
      roleSlot: null,
      payload: { version, manifestDigest, resourceIds: [...resourceIds].sort() },
    };
  }

  async function manifestDigestOf(value: Record<string, unknown>): Promise<string> {
    return sha256Bytes(encoder.encode(canonicalJson(value)));
  }

  function request(overrides: Partial<V1RegisterRolePackageRequest> = {}): V1RegisterRolePackageRequest {
    return {
      expectedVersion: state.projectVersion,
      manifest: {} as Record<string, unknown>,
      resources: [{ resourceId: 'sop', bodyBytes: sopBody }],
      confirmation: { ticketId: 'tk-1', ticketSecret },
      ...overrides,
    };
  }

  function context(body: Record<string, unknown>, overrides: Partial<V1RolePackageContext> = {}): V1RolePackageContext {
    return {
      idempotencyKey,
      method: 'POST',
      route: registerRoute,
      body,
      operationId: 'op-1',
      now,
      webSessionId: 'sess-1',
      userAuthVersion: 1,
      ...overrides,
    };
  }

  async function registered(): Promise<{ manifest: Record<string, unknown>; digest: string }> {
    const value = await manifest();
    return { manifest: value, digest: await manifestDigestOf(value) };
  }

  it('lists visible packages for a human member', async () => {
    const { manifest: value, digest } = await registered();
    state.packages.push({
      id: 'pv-builtin',
      packageId,
      version,
      roleKey: 'product',
      manifestDigest: digest,
      scope: 'BUILTIN',
      projectId: null,
      manifest: value as never,
      resources: [],
    });
    const listed = await service.list(alice, projectId, {});
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({ packageId, version, scope: 'BUILTIN' });
  });

  it('rejects an agent without workflow:read', async () => {
    await expect(service.list(agentAlice, projectId, {})).rejects.toMatchObject({
      code: V1_ERROR_CODES.SCOPE_DENIED,
      status: 403,
    });
  });

  it('returns 404 for a package the project cannot see', async () => {
    await expect(service.getVersion(alice, projectId, 'ghost', version)).rejects.toMatchObject({
      code: V1_ERROR_CODES.RESOURCE_NOT_FOUND,
      status: 404,
    });
  });

  it('serves resource bytes through the registered version', async () => {
    const { manifest: value, digest } = await registered();
    state.tickets.push(makeTicket(await bindingFor(state.projectVersion, digest)));
    const result = await service.register(alice, projectId, request({ manifest: value }), context({ expectedVersion: state.projectVersion, manifest: value }));
    const resource = await service.getResource(alice, projectId, packageId, version, 'sop');
    expect(resource).toMatchObject({
      resourceId: 'sop',
      path: 'docs/sop.md',
      byteLength: sopBody.byteLength,
      sha256: await sha256Bytes(sopBody),
    });
    expect(Buffer.from(resource.bodyBytes)).toEqual(Buffer.from(sopBody));
    expect(result.packageVersionId).toBe('pv-1');
  });

  it('rejects an agent on register', async () => {
    const { manifest: value } = await registered();
    await expect(service.register(agentAlice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.HUMAN_SESSION_REQUIRED,
      status: 403,
    });
  });

  it('rejects a plain member on register', async () => {
    state.memberRole = 'MEMBER';
    const { manifest: value } = await registered();
    await expect(service.register(bob, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.FORBIDDEN,
      status: 403,
      message: 'PROJECT_MANAGER_REQUIRED',
    });
  });

  it('rejects a package whose roleKey is not an active project role', async () => {
    state.roleKeys = ['engineering'];
    const { manifest: value } = await registered();
    await expect(service.register(alice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.VALIDATION_FAILED,
      status: 422,
      message: 'ROLE_PACKAGE_ROLE_UNKNOWN',
    });
  });

  it('rejects an invalid manifest before touching project state', async () => {
    const { manifest: value } = await registered();
    value.resources = [{ ...(value.resources as Array<Record<string, unknown>>)[0], path: '../escape.md' }];
    await expect(service.register(alice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.VALIDATION_FAILED,
      status: 422,
      message: 'ROLE_PACKAGE_INVALID',
    });
  });

  it('rejects a project package that shadows a builtin id', async () => {
    state.builtinIds = [packageId];
    const { manifest: value } = await registered();
    await expect(service.register(alice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.VERSION_CONFLICT,
      status: 409,
      message: 'ROLE_PACKAGE_ID_SHADOWED',
    });
  });

  it('returns the existing version when the digest matches exactly', async () => {
    const { manifest: value, digest } = await registered();
    state.packages.push({
      id: 'pv-existing',
      packageId,
      version,
      roleKey: 'product',
      manifestDigest: digest,
      scope: 'PROJECT',
      projectId,
      manifest: value as never,
      resources: [],
    });
    const result = await service.register(alice, projectId, request({ manifest: value }), context({}));
    expect(result).toMatchObject({ packageVersionId: 'pv-existing', manifestDigest: digest, replayed: false });
    expect(state.projectVersion).toBe(3);
  });

  it('rejects the same version with a different digest', async () => {
    const { manifest: value, digest } = await registered();
    state.packages.push({
      id: 'pv-existing',
      packageId,
      version,
      roleKey: 'product',
      manifestDigest: 'f'.repeat(64),
      scope: 'PROJECT',
      projectId,
      manifest: value as never,
      resources: [],
    });
    await expect(service.register(alice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.VERSION_CONFLICT,
      status: 409,
      message: 'ROLE_PACKAGE_VERSION_CONFLICT',
    });
    expect(digest).not.toBe('f'.repeat(64));
  });

  it('rejects a stale expected project version', async () => {
    const { manifest: value } = await registered();
    const result = service.register(
      alice,
      projectId,
      request({ manifest: value, expectedVersion: state.projectVersion + 1 }),
      context({}),
    );
    await expect(result).rejects.toMatchObject({
      code: V1_ERROR_CODES.VERSION_CONFLICT,
      status: 409,
      message: 'PROJECT_VERSION_CONFLICT',
    });
  });

  it('rejects a ticket bound to a different digest', async () => {
    const { manifest: value, digest } = await registered();
    state.tickets.push(makeTicket(await bindingFor(state.projectVersion, digest, ['sop']), { actionDigest: '0'.repeat(64) }));
    await expect(service.register(alice, projectId, request({ manifest: value }), context({}))).rejects.toMatchObject({
      code: V1_ERROR_CODES.ACTION_CHANGED,
      status: 409,
      message: 'CONFIRMATION_DIGEST_MISMATCH',
    });
  });

  it('registers package, consumes the ticket and advances the project version', async () => {
    const { manifest: value, digest } = await registered();
    state.tickets.push(makeTicket(await bindingFor(state.projectVersion, digest)));
    const body = { expectedVersion: state.projectVersion, manifest: value };
    const result = await service.register(alice, projectId, request({ manifest: value }), context(body));
    expect(result).toMatchObject({ packageId, version, manifestDigest: digest, replayed: false });
    expect(state.projectVersion).toBe(4);
    expect(state.tickets[0].consumedAt).toEqual(now);
    expect(state.operations).toHaveLength(1);
  });

  it('replays a committed operation before version and ticket checks', async () => {
    const { manifest: value, digest } = await registered();
    state.tickets.push(makeTicket(await bindingFor(state.projectVersion, digest)));
    const body = { expectedVersion: state.projectVersion, manifest: value };
    await service.register(alice, projectId, request({ manifest: value }), context(body));
    // 票据已消费、项目版本已前进，合法重放仍返回原结果。
    const replay = await service.register(alice, projectId, request({ manifest: value }), context(body));
    expect(replay).toMatchObject({ packageVersionId: 'pv-1', manifestDigest: digest, replayed: true });
    expect(state.packages).toHaveLength(1);
  });

  it('conflicts when the same key carries different semantics', async () => {
    const { manifest: value, digest } = await registered();
    state.tickets.push(makeTicket(await bindingFor(state.projectVersion, digest)));
    await service.register(alice, projectId, request({ manifest: value }), context({ expectedVersion: 3, manifest: value }));
    await expect(
      service.register(alice, projectId, request({ manifest: value }), context({ expectedVersion: 4, manifest: value })),
    ).rejects.toMatchObject({
      code: V1_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      status: 409,
    });
  });
});
