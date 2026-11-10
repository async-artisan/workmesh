import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { V1AuthorizationService } from '../auth/v1-authorization';
import { V1AuthorizationPrismaRepository } from '../auth/v1-authorization.prisma-repository';
import type { V1Principal } from '../auth/v1-policy';
import type { PrismaService } from '../prisma/prisma.service';
import {
  V1KnowledgeBindingService,
  type KnowledgeBindingInput,
} from './v1-knowledge-binding.service';

const principal: V1Principal = {
  kind: 'HUMAN',
  userId: 'u1',
  sessionId: 's1',
  authVersion: 1,
  scopes: [],
};
const input: KnowledgeBindingInput = {
  expectedVersion: 1,
  documentId: 'd1',
  roleId: 'r1',
  required: true,
};

function setup() {
  const state = {
    version: 1,
    role: 'OWNER',
    revokedAt: null as Date | null,
    archivedAt: null as Date | null,
    documentProject: 'p1',
    published: true,
    documentArchived: false,
    roleActive: true,
    visibility: 'PROJECT',
    bindings: [] as Array<{
      id: string;
      documentId: string;
      roleId: string | null;
      required: boolean;
    }>,
    operations: new Map<string, Record<string, unknown>>(),
    audits: 0,
    stamps: 0,
  };
  const db = {
    project: {
      findUnique: async () => ({
        id: 'p1',
        version: 1,
        archivedAt: state.archivedAt,
        knowledgeBindingsVersion: state.version,
      }),
      findUniqueOrThrow: async () => ({ knowledgeBindingsVersion: state.version }),
      updateMany: async ({ where }: { where: { knowledgeBindingsVersion: number } }) => {
        if (where.knowledgeBindingsVersion !== state.version || state.archivedAt)
          return { count: 0 };
        state.version += 1;
        return { count: 1 };
      },
    },
    projectMember: {
      findUnique: async () => ({
        projectId: 'p1',
        userId: 'u1',
        role: state.role,
        version: 1,
        revokedAt: state.revokedAt,
      }),
    },
    projectRoleAssignment: {
      findMany: async () => [
        { id: 'a1', roleId: 'r1', projectId: 'p1', userId: 'u1', version: 1, revokedAt: null },
      ],
    },
    knowledgeBase: {
      findUnique: async () => ({
        id: 'kb1',
        projectId: 'p1',
        visibility: state.visibility,
        archivedAt: null,
        version: 1,
        authzVersion: 1,
      }),
    },
    knowledgeBaseGrant: { findMany: async () => [] },
    knowledgeDocument: {
      findFirst: async () =>
        state.documentProject === 'p1' && state.published && !state.documentArchived
          ? { id: 'd1', knowledgeBaseId: 'kb1' }
          : null,
    },
    projectRole: { findFirst: async () => (state.roleActive ? { id: 'r1' } : null) },
    projectKnowledgeBinding: {
      findFirst: async ({ where }: { where: { roleId: string | null } }) =>
        state.bindings.find((item) => item.roleId === where.roleId) ?? null,
      findMany: async () =>
        state.bindings.map((binding) => ({ ...binding, document: { knowledgeBaseId: 'kb1' } })),
      create: async ({ data }: { data: Omit<(typeof state.bindings)[number], 'id'> }) => {
        const row = { id: randomUUID(), ...data };
        state.bindings.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<(typeof state.bindings)[number]>;
      }) => {
        const row = state.bindings.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    principalStamp: {
      create: async () => {
        state.stamps += 1;
        return { id: 'stamp1' };
      },
    },
    auditEvent: {
      create: async () => {
        state.audits += 1;
        return {};
      },
    },
    idempotentOperation: {
      findUnique: async ({
        where,
      }: {
        where: { projectScopeKey_principalScopeKey_key: { key: string } };
      }) => state.operations.get(where.projectScopeKey_principalScopeKey_key.key) ?? null,
      create: async ({ data }: { data: Record<string, unknown> & { key: string } }) => {
        state.operations.set(data.key, data);
        return data;
      },
    },
    $transaction: async <T>(run: (transaction: unknown) => Promise<T>): Promise<T> => run(db),
  };
  const prisma = db as unknown as PrismaService;
  const authorization = new V1AuthorizationService(new V1AuthorizationPrismaRepository(prisma));
  const service = new V1KnowledgeBindingService(prisma, authorization);
  const context = (body = input, key = randomUUID()) => ({
    idempotencyKey: key,
    operationId: randomUUID(),
    method: 'PUT',
    route: '/api/v1/projects/p1/knowledge-bindings',
    body: { ...body },
    requestId: '',
    now: new Date(),
  });
  return { state, service, context };
}

describe('project knowledge bindings', () => {
  it('binds published readable knowledge with a version, principal stamp and audit; same-key replay is stable', async () => {
    const { state, service, context } = setup();
    const request = context();
    const result = await service.bind(principal, 'p1', input, request);
    expect(result).toMatchObject({
      version: 2,
      binding: { documentId: 'd1', roleId: 'r1', required: true },
    });
    expect(await service.bind(principal, 'p1', input, request)).toEqual(result);
    expect(state.version).toBe(2);
    expect(state.bindings).toHaveLength(1);
    expect(state.audits).toBe(1);
    expect(state.stamps).toBe(1);
    const changed = { ...input, required: false };
    await expect(
      service.bind(principal, 'p1', changed, context(changed, request.idempotencyKey)),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('supports all-role bindings without duplicating PostgreSQL nullable unique keys', async () => {
    const { state, service, context } = setup();
    const first = { ...input, roleId: null };
    await service.bind(principal, 'p1', first, context(first));
    const second = { ...first, expectedVersion: 2, required: false };
    await service.bind(principal, 'p1', second, context(second));
    expect(state.bindings).toHaveLength(1);
    expect(state.bindings[0]).toMatchObject({ roleId: null, required: false });
    expect(state.version).toBe(3);
  });

  it('rejects Agent, sessionless and ordinary-member mutations', async () => {
    const { state, service, context } = setup();
    await expect(
      service.bind({ ...principal, kind: 'AGENT' }, 'p1', input, context()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.bind({ ...principal, sessionId: undefined }, 'p1', input, context()),
    ).rejects.toMatchObject({ status: 403 });
    state.role = 'MEMBER';
    await expect(service.bind(principal, 'p1', input, context())).rejects.toMatchObject({
      status: 403,
    });
    expect(state.bindings).toHaveLength(0);
  });

  it.each(['cross-project', 'unpublished', 'archived', 'unreadable', 'inactive-role'])(
    'rejects %s data without changing the binding version',
    async (scenario) => {
      const { state, service, context } = setup();
      if (scenario === 'cross-project') state.documentProject = 'p2';
      if (scenario === 'unpublished') state.published = false;
      if (scenario === 'archived') state.documentArchived = true;
      if (scenario === 'unreadable') state.visibility = 'RESTRICTED';
      if (scenario === 'inactive-role') state.roleActive = false;
      await expect(service.bind(principal, 'p1', input, context())).rejects.toMatchObject({
        status: 404,
      });
      expect(state.version).toBe(1);
      expect(state.bindings).toHaveLength(0);
    },
  );

  it('rejects a stale expectedVersion, revoked membership and archived projects', async () => {
    const { state, service, context } = setup();
    const stale = { ...input, expectedVersion: 2 };
    await expect(service.bind(principal, 'p1', stale, context(stale))).rejects.toMatchObject({
      status: 409,
    });
    state.revokedAt = new Date();
    await expect(service.bind(principal, 'p1', input, context())).rejects.toMatchObject({
      status: 404,
    });
    state.revokedAt = null;
    state.archivedAt = new Date();
    await expect(service.bind(principal, 'p1', input, context())).rejects.toMatchObject({
      status: 409,
    });
    expect(state.bindings).toHaveLength(0);
  });

  it('returns server-derived management ability and hides bindings for unreadable knowledge', async () => {
    const { state, service } = setup();
    state.bindings.push({ id: 'b1', documentId: 'd1', roleId: null, required: true });
    expect(await service.list(principal, 'p1')).toMatchObject({
      canManage: true,
      version: 1,
      items: [{ documentId: 'd1' }],
    });
    state.role = 'MEMBER';
    state.visibility = 'RESTRICTED';
    expect(await service.list(principal, 'p1')).toEqual({
      canManage: false,
      version: 1,
      items: [],
    });
  });
});
