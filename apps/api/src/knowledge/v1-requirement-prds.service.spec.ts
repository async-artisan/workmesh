import { describe, expect, it, vi } from 'vitest';
import { type Principal } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { V1RequirementPrdsService } from './v1-requirement-prds.service';

const PROJECT = '10000000-0000-4000-8000-000000000001';
const OTHER_PROJECT = '10000000-0000-4000-8000-000000000002';
const REQUIREMENT = '20000000-0000-4000-8000-000000000001';
const OTHER_REQUIREMENT = '20000000-0000-4000-8000-000000000002';
const human: Principal = { kind: 'HUMAN', userId: 'reader', scopes: [] };
const agent: Principal = {
  kind: 'AGENT',
  userId: 'reader',
  agentCredentialId: 'credential-1',
  projectId: PROJECT,
  roleIds: ['role-1'],
  scopes: ['knowledge:read'],
};

function document(id: string, knowledgeBaseId = 'kb-public') {
  const value = {
    id,
    projectId: PROJECT,
    knowledgeBaseId,
    requirementId: REQUIREMENT as string | null,
    kind: 'PRD',
    version: 9,
    currentPublishedRevisionId: `published-${id}` as string | null,
    archivedAt: null as Date | null,
  };
  Object.defineProperty(value, 'revisions', {
    get() {
      throw new Error('Summary read full revision history');
    },
  });
  return value;
}

function revision(item: ReturnType<typeof document>) {
  const value = {
    id: item.currentPublishedRevisionId!,
    documentId: item.id,
    projectId: item.projectId,
    seq: 1,
    title: `Published ${item.id}`,
    sha256: 'a'.repeat(64),
  };
  for (const field of ['bodyBytes', 'acceptance', 'deliveryScope', 'reviewRequests'])
    Object.defineProperty(value, field, {
      get() {
        throw new Error(`Summary read ${field}`);
      },
    });
  return value;
}

type Document = ReturnType<typeof document>;
type Query = Record<string, any>;
function matches(item: Document, where: Query): boolean {
  for (const field of ['projectId', 'requirementId', 'kind'] as const)
    if (where[field] !== undefined && item[field] !== where[field]) return false;
  if (where.archivedAt === null && item.archivedAt !== null) return false;
  if (where.currentPublishedRevisionId?.not === null && item.currentPublishedRevisionId === null)
    return false;
  if (where.knowledgeBaseId?.in && !where.knowledgeBaseId.in.includes(item.knowledgeBaseId))
    return false;
  return true;
}

function project<T extends object>(item: T, select: Query) {
  return Object.fromEntries(
    Object.entries(select).map(([key, enabled]) => {
      expect(enabled).toBe(true);
      return [key, item[key as keyof T]];
    }),
  );
}

function harness(documents: Document[] = [document('document-001')]) {
  const state = {
    documents,
    revisions: documents.map(revision),
    requirementProjectId: PROJECT,
    requirementExists: true,
    revoked: false,
    roleActive: true,
    grantsRevoked: false,
    privatePermissions: [] as string[],
    knowledgeBases: [
      {
        id: 'kb-public',
        projectId: PROJECT,
        visibility: 'PROJECT',
        authzVersion: 3,
        publicationApproverUserId: 'approver',
        publicationApproverRoleId: null,
        archivedAt: null as Date | null,
        version: 1,
      },
      {
        id: 'kb-private',
        projectId: PROJECT,
        visibility: 'RESTRICTED',
        authzVersion: 4,
        publicationApproverUserId: 'approver',
        publicationApproverRoleId: null,
        archivedAt: null as Date | null,
        version: 1,
      },
    ],
  };
  const events: string[] = [];
  let reading = false;
  let readOnly = false;
  const read = <T extends (...args: any[]) => any>(name: string, fn: T) =>
    vi.fn((...args: Parameters<T>) => {
      expect(reading).toBe(true);
      expect(readOnly).toBe(true);
      events.push(name);
      return fn(...args);
    });
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      expect(reading).toBe(true);
      expect(strings.join('')).toBe('SET TRANSACTION READ ONLY');
      readOnly = true;
      events.push('readOnly');
      return 0;
    }),
    project: {
      findUnique: read('project', async ({ where }: Query) =>
        where.id === PROJECT ? { id: PROJECT, version: 1, archivedAt: null } : null,
      ),
    },
    projectMember: {
      findUnique: read('member', async () => ({
        projectId: PROJECT,
        userId: 'reader',
        role: 'MEMBER',
        version: 1,
        revokedAt: state.revoked ? new Date() : null,
      })),
    },
    projectRoleAssignment: {
      findMany: read('roles', async () =>
        state.roleActive
          ? [
              {
                id: 'assignment-1',
                projectId: PROJECT,
                userId: 'reader',
                roleId: 'role-1',
                version: 1,
                revokedAt: null,
              },
            ]
          : [],
      ),
    },
    requirement: {
      findFirst: read('requirement', async ({ where }: Query) =>
        state.requirementExists &&
        where.id === REQUIREMENT &&
        where.projectId === state.requirementProjectId
          ? { id: REQUIREMENT }
          : null,
      ),
    },
    knowledgeBase: {
      findMany: read('relatedKnowledgeBases', async ({ where, select, take }: Query) => {
        expect(select).toEqual({ id: true });
        expect(take).toBeUndefined();
        return state.knowledgeBases
          .filter(
            (kb) =>
              kb.projectId === where.projectId &&
              state.documents.some(
                (item) => item.knowledgeBaseId === kb.id && matches(item, where.documents.some),
              ),
          )
          .map((kb) => ({ id: kb.id }));
      }),
      findUnique: read(
        'knowledgeBase',
        async ({ where }: Query) => state.knowledgeBases.find((kb) => kb.id === where.id) ?? null,
      ),
    },
    knowledgeBaseGrant: {
      findMany: read('grants', async ({ where }: Query) => [
        {
          id: 'grant-1',
          knowledgeBaseId: where.knowledgeBaseId,
          subjectKind: 'USER',
          subjectUserId: 'reader',
          subjectRoleId: null,
          permissions: where.knowledgeBaseId === 'kb-private' ? state.privatePermissions : [],
          revokedAt: state.grantsRevoked ? new Date() : null,
        },
      ]),
    },
    knowledgeDocument: {
      count: read(
        'documentCount',
        async ({ where }: Query) => state.documents.filter((item) => matches(item, where)).length,
      ),
      findMany: read('documents', async ({ where, select, orderBy, take }: Query) => {
        const rows = state.documents.filter((item) => matches(item, where));
        expect(orderBy).toEqual({ id: 'asc' });
        expect(take).toBe(2);
        return rows
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, take)
          .map((item) => project(item, select));
      }),
    },
    documentRevision: {
      findUnique: read('revision', async ({ where, select }: Query) => {
        const item = state.revisions.find((candidate) => candidate.id === where.id);
        return item ? project(item, select) : null;
      }),
      findMany: vi.fn(() => {
        throw new Error('Summary loaded revision history');
      }),
      count: vi.fn(() => {
        throw new Error('Summary counted revision history');
      }),
    },
  };
  const $transaction = vi.fn(
    async (work: (value: unknown) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
      reading = true;
      readOnly = false;
      try {
        return await work(tx);
      } finally {
        reading = false;
      }
    },
  );
  const authorization = new V1AuthorizationService(
    new Proxy(
      {},
      {
        get() {
          throw new Error('Authorization escaped the read transaction');
        },
      },
    ) as V1AuthorizationRepository,
  );
  const service = new V1RequirementPrdsService(
    { $transaction } as unknown as PrismaService,
    authorization,
  );
  return { state, tx, events, service, $transaction };
}

describe('V1RequirementPrdsService published PRD uniqueness projection', () => {
  it('reads exact publication metadata with no history or large revision fields in one read-only snapshot', async () => {
    const { service, tx, events } = harness();
    const result = await service.list(human, PROJECT, REQUIREMENT);
    expect(result).toEqual({
      items: [
        {
          document: document('document-001'),
          publishedRevision: {
            id: 'published-document-001',
            documentId: 'document-001',
            seq: 1,
            title: 'Published document-001',
            digest: 'a'.repeat(64),
          },
        },
      ],
      total: 1,
    });
    expect(events.slice(0, 5)).toEqual(['readOnly', 'project', 'member', 'roles', 'requirement']);
    const selected = tx.knowledgeDocument.findMany.mock.calls[0]![0];
    expect(Object.keys(selected.select).sort()).toEqual([
      'archivedAt',
      'currentPublishedRevisionId',
      'id',
      'kind',
      'knowledgeBaseId',
      'projectId',
      'requirementId',
      'version',
    ]);
    expect(tx.documentRevision.findUnique.mock.calls[0]![0]).toEqual({
      where: { id: 'published-document-001' },
      select: {
        id: true,
        documentId: true,
        projectId: true,
        seq: true,
        title: true,
        sha256: true,
      },
    });
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
    expect(tx.documentRevision.count).not.toHaveBeenCalled();
  });

  it('applies readable KBs before count and fixed two-row selection, even after sixty unrelated documents', async () => {
    const unrelated = Array.from({ length: 60 }, (_, index) => ({
      ...document(`unrelated-${index}`),
      requirementId: OTHER_REQUIREMENT,
    }));
    const hidden = Array.from({ length: 5 }, (_, index) =>
      document(`hidden-${index}`, 'kb-private'),
    );
    const target = [document('target-003'), document('target-001'), document('target-002')];
    const { service, tx } = harness([...unrelated, ...hidden, ...target]);
    const result = await service.list(human, PROJECT, REQUIREMENT);
    expect(result.total).toBe(3);
    expect(result.items.map((item) => item.document.id)).toEqual(['target-001', 'target-002']);
    const where = {
      projectId: PROJECT,
      requirementId: REQUIREMENT,
      kind: 'PRD',
      archivedAt: null,
      currentPublishedRevisionId: { not: null },
      knowledgeBaseId: { in: ['kb-public'] },
    };
    expect(tx.knowledgeDocument.count).toHaveBeenCalledWith({ where });
    expect(tx.knowledgeDocument.findMany.mock.calls[0]![0]).toMatchObject({
      where,
      take: 2,
      orderBy: { id: 'asc' },
    });
    expect(tx.documentRevision.findUnique).toHaveBeenCalledTimes(2);
  });

  it('excludes other projects, kinds, requirements, archived documents and absent publication pointers', async () => {
    const excluded = [
      { ...document('foreign'), projectId: OTHER_PROJECT },
      { ...document('kind'), kind: 'KNOWLEDGE' },
      { ...document('unrelated'), requirementId: OTHER_REQUIREMENT },
      { ...document('unlinked'), requirementId: null },
      { ...document('archived'), archivedAt: new Date() },
      { ...document('unpublished'), currentPublishedRevisionId: null },
    ];
    const { service, tx } = harness(excluded);
    expect(await service.list(human, PROJECT, REQUIREMENT)).toEqual({ items: [], total: 0 });
    expect(tx.knowledgeBase.findUnique).not.toHaveBeenCalled();
    expect(tx.documentRevision.findUnique).not.toHaveBeenCalled();
  });

  it('returns empty when every KB is unreadable instead of allowing authors or reviewers to bypass READ', async () => {
    const { service, tx } = harness([document('private', 'kb-private')]);
    expect(await service.list(human, PROJECT, REQUIREMENT)).toEqual({ items: [], total: 0 });
    expect(tx.knowledgeDocument.count).not.toHaveBeenCalled();
    expect(tx.documentRevision.findUnique).not.toHaveBeenCalled();
  });

  it('retains existing read access to an archived KB and removes a revoked explicit grant', async () => {
    const { service, state } = harness([document('private', 'kb-private')]);
    state.knowledgeBases[1]!.archivedAt = new Date();
    state.privatePermissions = ['READ'];
    expect((await service.list(human, PROJECT, REQUIREMENT)).total).toBe(1);
    state.grantsRevoked = true;
    expect(await service.list(human, PROJECT, REQUIREMENT)).toEqual({ items: [], total: 0 });
  });

  it('intersects Agent scope with READ without introducing a new scope rejection', async () => {
    const { service, tx } = harness();
    expect((await service.list(agent, PROJECT, REQUIREMENT)).total).toBe(1);
    tx.documentRevision.findUnique.mockClear();
    expect(await service.list({ ...agent, scopes: [] }, PROJECT, REQUIREMENT)).toEqual({
      items: [],
      total: 0,
    });
    expect(tx.documentRevision.findUnique).not.toHaveBeenCalled();
  });

  it('rejects cross-project Agents before reading the requirement or candidate documents', async () => {
    const { service, tx } = harness();
    await expect(service.list(agent, OTHER_PROJECT, REQUIREMENT)).rejects.toMatchObject({
      status: 404,
      message: 'CROSS_PROJECT_AGENT',
    });
    expect(tx.requirement.findFirst).not.toHaveBeenCalled();
    expect(tx.knowledgeDocument.findMany).not.toHaveBeenCalled();
  });

  it('rejects revoked members before reading the requirement', async () => {
    const { service, state, tx } = harness();
    state.revoked = true;
    await expect(service.list(human, PROJECT, REQUIREMENT)).rejects.toMatchObject({
      status: 404,
      message: 'MEMBER_NOT_ACTIVE',
    });
    expect(tx.requirement.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an inactive Agent role before reading the requirement', async () => {
    const { service, state, tx } = harness();
    state.roleActive = false;
    await expect(service.list(agent, PROJECT, REQUIREMENT)).rejects.toMatchObject({
      status: 422,
      code: 'ROLE_INACTIVE',
      message: 'AGENT_ROLE_ASSIGNMENT_INACTIVE',
    });
    expect(tx.requirement.findFirst).not.toHaveBeenCalled();
  });

  it.each(['missing', 'another project'] as const)(
    'hides a requirement that is %s before any knowledge lookup',
    async (scenario) => {
      const { service, state, tx } = harness();
      if (scenario === 'missing') state.requirementExists = false;
      else state.requirementProjectId = OTHER_PROJECT;
      await expect(service.list(human, PROJECT, REQUIREMENT)).rejects.toMatchObject({
        status: 404,
        message: 'REQUIREMENT_NOT_FOUND',
      });
      expect(tx.knowledgeDocument.findMany).not.toHaveBeenCalled();
      expect(tx.knowledgeBase.findUnique).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'another document', 'another project'] as const)(
    'requires refresh when the selected publication revision is %s',
    async (scenario) => {
      const { service, state } = harness();
      if (scenario === 'missing') state.revisions = [];
      else if (scenario === 'another document') state.revisions[0]!.documentId = 'another-document';
      else state.revisions[0]!.projectId = OTHER_PROJECT;
      await expect(service.list(human, PROJECT, REQUIREMENT)).rejects.toMatchObject({
        status: 409,
        code: 'RESOURCE_CONFLICT',
        message: 'PRD_PUBLICATION_REFRESH_REQUIRED',
      });
    },
  );

  it.each([
    ['bad-project', REQUIREMENT],
    [PROJECT, 'bad-requirement'],
    ['-'.repeat(36), REQUIREMENT],
    [PROJECT, '20000000-0000-4000-8000-00000000000z'],
  ])(
    'rejects malformed path IDs before opening a database transaction: %s / %s',
    async (projectId, requirementId) => {
      const { service, $transaction } = harness();
      await expect(service.list(human, projectId, requirementId)).rejects.toMatchObject({
        status: 422,
        code: 'INVALID_REQUEST',
        message: 'PRD_CONTEXT_ID_INVALID',
      });
      expect($transaction).not.toHaveBeenCalled();
    },
  );
});
