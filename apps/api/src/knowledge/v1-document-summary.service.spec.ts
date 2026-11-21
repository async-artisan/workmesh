import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { V1DocumentSummaryService } from './v1-document-summary.service';

const PROJECT = '10000000-0000-4000-8000-000000000001';
const DOCUMENT = '20000000-0000-4000-8000-000000000001';
const USER = '30000000-0000-4000-8000-000000000001';
const BASE = '40000000-0000-4000-8000-000000000001';
const OTHER_BASE = '40000000-0000-4000-8000-000000000002';
const REQUIREMENT = '50000000-0000-4000-8000-000000000001';
const human: Principal = { kind: 'HUMAN', userId: USER, scopes: [] };
const agent: Principal = {
  kind: 'AGENT',
  userId: USER,
  agentCredentialId: 'credential-1',
  projectId: PROJECT,
  roleIds: ['role-1'],
  scopes: ['knowledge:read'],
};

function revision(seq: number, state: 'PUBLISHED' | 'CANDIDATE') {
  return {
    id: `revision-${seq}`,
    documentId: DOCUMENT,
    seq,
    title: `Title ${seq}`,
    digest: 'a'.repeat(64),
    state,
  };
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  const value = {
    id: DOCUMENT,
    projectId: PROJECT,
    knowledgeBaseId: BASE,
    requirementId: REQUIREMENT,
    kind: 'PRD',
    version: 7,
    currentPublishedRevisionId: 'revision-1',
    archivedAt: null,
    updatedAt: new Date('2026-11-10T12:00:00.000Z'),
    knowledgeBaseName: 'Business',
    knowledgeBaseKind: 'BUSINESS',
    readableRequirementId: REQUIREMENT,
    requirementCode: 'REQ-1',
    requirementTitle: 'Requirement',
    latestVisibleRevision: revision(205, 'CANDIDATE'),
    publishedRevision: revision(1, 'PUBLISHED'),
    invalidPublication: false,
    visibleRevisionCount: 205n,
    candidateRevisionCount: 204n,
    ...overrides,
  };
  for (const name of ['bodyBytes', 'revisions', 'acceptance', 'deliveryScope'])
    Object.defineProperty(value, name, {
      get() {
        throw new Error(`Summary accessed ${name}`);
      },
    });
  return value;
}

function harness() {
  const state = {
    revoked: false,
    activeRole: true,
    privatePermissions: [] as string[],
    publicPermissions: [] as string[],
    bases: [
      {
        id: BASE,
        name: 'Business',
        kind: 'BUSINESS',
        projectId: PROJECT,
        visibility: 'PROJECT',
        version: 1,
        authzVersion: 3,
        publicationApproverUserId: USER,
        publicationApproverRoleId: null,
        archivedAt: null,
      },
      {
        id: OTHER_BASE,
        name: 'Private',
        kind: 'SYSTEM',
        projectId: PROJECT,
        visibility: 'RESTRICTED',
        version: 1,
        authzVersion: 4,
        publicationApproverUserId: USER,
        publicationApproverRoleId: null,
        archivedAt: null,
      },
    ],
    documentExists: true,
    rawResults: [] as unknown[],
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
      findUnique: read('project', async ({ where }: any) =>
        where.id === PROJECT ? { id: PROJECT, version: 1, archivedAt: null } : null,
      ),
    },
    projectMember: {
      findUnique: read('member', async () => ({
        projectId: PROJECT,
        userId: USER,
        role: 'MEMBER',
        version: 1,
        revokedAt: state.revoked ? new Date() : null,
      })),
    },
    projectRoleAssignment: {
      findMany: read('roles', async () =>
        state.activeRole
          ? [
              {
                id: 'assignment',
                projectId: PROJECT,
                userId: USER,
                roleId: 'role-1',
                version: 1,
                revokedAt: null,
              },
            ]
          : [],
      ),
    },
    knowledgeBase: {
      findMany: read('bases', async ({ where, select }: any) => {
        expect(select).toEqual({ id: true, name: true, kind: true });
        return state.bases
          .filter(
            (base) => base.projectId === where.projectId && (!where.id || base.id === where.id),
          )
          .map(({ id, name, kind }) => ({ id, name, kind }));
      }),
      findUnique: read(
        'base',
        async ({ where }: any) => state.bases.find((base) => base.id === where.id) ?? null,
      ),
    },
    knowledgeBaseGrant: {
      findMany: read('grants', async ({ where }: any) => [
        {
          id: 'grant',
          knowledgeBaseId: where.knowledgeBaseId,
          subjectKind: 'USER',
          subjectUserId: USER,
          subjectRoleId: null,
          permissions:
            where.knowledgeBaseId === BASE ? state.publicPermissions : state.privatePermissions,
          revokedAt: null,
        },
      ]),
    },
    knowledgeDocument: {
      findUnique: read('document', async ({ where, select }: any) => {
        expect(select).toEqual({ projectId: true, knowledgeBaseId: true });
        return state.documentExists && where.id === DOCUMENT
          ? { projectId: PROJECT, knowledgeBaseId: BASE }
          : null;
      }),
    },
    $queryRaw: read('raw', async (_sql: Prisma.Sql) => {
      if (!state.rawResults.length) throw new Error('Unexpected raw query');
      const result = state.rawResults.shift();
      if (result instanceof Error) throw result;
      return result;
    }),
  };
  const $transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    reading = true;
    readOnly = false;
    try {
      return await work(tx);
    } finally {
      reading = false;
    }
  });
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
  const service = new V1DocumentSummaryService(
    { $transaction } as unknown as PrismaService,
    authorization,
  );
  return { state, events, tx, $transaction, service };
}

describe('V1DocumentSummaryService authorized bounded reads', () => {
  it('returns exact compact metadata and independent old publication without loading history or body', async () => {
    const { state, service, tx, events } = harness();
    state.rawResults = [[{ total: 201n }], [summaryRow()]];
    const page = await service.list(human, PROJECT, { limit: 2 });
    expect(page.total).toBe(201);
    expect(page.nextCursor).toBeNull();
    expect(page.items).toEqual([
      {
        document: {
          id: DOCUMENT,
          projectId: PROJECT,
          knowledgeBaseId: BASE,
          requirementId: REQUIREMENT,
          kind: 'PRD',
          version: 7,
          currentPublishedRevisionId: 'revision-1',
          archivedAt: null,
        },
        updatedAt: new Date('2026-11-10T12:00:00.000Z'),
        knowledgeBase: { id: BASE, name: 'Business', kind: 'BUSINESS' },
        requirement: { id: REQUIREMENT, code: 'REQ-1', title: 'Requirement' },
        latestVisibleRevision: revision(205, 'CANDIDATE'),
        publishedRevision: revision(1, 'PUBLISHED'),
        visibleRevisionCount: 205,
        candidateRevisionCount: 204,
      },
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(events[0]).toBe('readOnly');
    expect(events.indexOf('raw')).toBeGreaterThan(events.lastIndexOf('grants'));
    const sql = tx.$queryRaw.mock.calls[1]![0];
    expect(sql.values).toContain(3);
    expect(sql.values).not.toContain(OTHER_BASE);
  });

  it('retains a document with zero visible revisions and preserves an unreadable requirement ID', async () => {
    const { state, service, tx } = harness();
    state.rawResults = [
      [
        summaryRow({
          currentPublishedRevisionId: null,
          readableRequirementId: null,
          requirementCode: null,
          requirementTitle: null,
          latestVisibleRevision: null,
          publishedRevision: null,
          visibleRevisionCount: 0n,
          candidateRevisionCount: 0n,
        }),
      ],
    ];
    const item = await service.summary(agent, DOCUMENT);
    expect(item).toMatchObject({
      document: { requirementId: REQUIREMENT },
      requirement: null,
      latestVisibleRevision: null,
      publishedRevision: null,
      visibleRevisionCount: 0,
      candidateRevisionCount: 0,
    });
    expect(tx.$queryRaw.mock.calls[0]![0].values).toContain(false);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns empty project collections but 404 for the object when current KB READ is absent', async () => {
    const { service, tx } = harness();
    const noScope = { ...agent, scopes: [] };
    await expect(service.list(noScope, PROJECT)).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
    });
    await expect(service.overview(noScope, PROJECT)).resolves.toEqual({
      total: 0,
      totalsByDocumentKind: { UNDERSTANDING: 0, DECISION: 0, PRD: 0, KNOWLEDGE: 0 },
      collections: ['BUSINESS', 'SYSTEM', 'PRACTICE'].map((knowledgeBaseKind) => ({
        knowledgeBaseKind,
        knowledgeBaseCount: 0,
        documentCount: 0,
        recentItems: [],
      })),
    });
    await expect(service.summary(noScope, DOCUMENT)).rejects.toMatchObject({
      status: 404,
      message: 'KNOWLEDGE_NOT_READABLE',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('checks active membership, current Agent role and project before querying content', async () => {
    const { state, service, tx } = harness();
    state.revoked = true;
    await expect(service.list(human, PROJECT)).rejects.toMatchObject({
      status: 404,
      message: 'MEMBER_NOT_ACTIVE',
    });
    state.revoked = false;
    state.activeRole = false;
    await expect(service.overview(agent, PROJECT)).rejects.toMatchObject({
      status: 422,
      message: 'AGENT_ROLE_ASSIGNMENT_INACTIVE',
    });
    state.activeRole = true;
    await expect(
      service.summary({ ...agent, projectId: DOCUMENT }, DOCUMENT),
    ).rejects.toMatchObject({ status: 404, message: 'CROSS_PROJECT_AGENT' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps overview counts independent of its at-most-two recent items and includes empty kinds', async () => {
    const { state, service, tx } = harness();
    state.privatePermissions = ['READ', 'PROPOSE'];
    state.rawResults = [
      [
        { documentKind: 'PRD', knowledgeBaseKind: 'BUSINESS', count: 201n },
        { documentKind: 'DECISION', knowledgeBaseKind: 'SYSTEM', count: 3n },
      ],
      [summaryRow(), summaryRow({ id: REQUIREMENT })],
      [
        summaryRow({
          id: REQUIREMENT,
          knowledgeBaseId: OTHER_BASE,
          knowledgeBaseName: 'Private',
          knowledgeBaseKind: 'SYSTEM',
          kind: 'DECISION',
        }),
      ],
    ];
    const result = await service.overview(human, PROJECT);
    expect(result.total).toBe(204);
    expect(result.totalsByDocumentKind).toEqual({
      UNDERSTANDING: 0,
      DECISION: 3,
      PRD: 201,
      KNOWLEDGE: 0,
    });
    expect(
      result.collections.map(
        ({ knowledgeBaseKind, knowledgeBaseCount, documentCount, recentItems }) => [
          knowledgeBaseKind,
          knowledgeBaseCount,
          documentCount,
          recentItems.length,
        ],
      ),
    ).toEqual([
      ['BUSINESS', 1, 201, 2],
      ['SYSTEM', 1, 3, 1],
      ['PRACTICE', 0, 0, 0],
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(3);
    for (const [sql] of tx.$queryRaw.mock.calls.slice(1)) {
      expect(sql.values).toContain(2);
      expect(sql.text).not.toContain('string_agg');
    }
  });

  it('emits a bounded cursor and reauthorizes before accepting it under changed permissions', async () => {
    const { state, service, tx } = harness();
    state.rawResults = [[{ total: 3n }], [summaryRow(), summaryRow({ id: REQUIREMENT })]];
    const first = await service.list(human, PROJECT, { limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    state.bases[0]!.authzVersion += 1;
    tx.$queryRaw.mockClear();
    await expect(
      service.list(human, PROJECT, { limit: 1, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ status: 422, message: 'DOCUMENT_SUMMARY_CURSOR_INVALID' });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects invalid IDs/input before opening a transaction and returns 404 for missing documents', async () => {
    const { state, service, tx, $transaction } = harness();
    await expect(service.list(human, 'not-uuid')).rejects.toMatchObject({ status: 422 });
    await expect(service.list(human, PROJECT, { q: 'x'.repeat(101) })).rejects.toMatchObject({
      status: 422,
    });
    await expect(service.summary(human, 'not-uuid')).rejects.toMatchObject({ status: 422 });
    await expect(service.overview(human, 'not-uuid')).rejects.toMatchObject({ status: 422 });
    expect($transaction).not.toHaveBeenCalled();
    state.documentExists = false;
    await expect(service.summary(human, DOCUMENT)).rejects.toMatchObject({
      status: 404,
      message: 'DOCUMENT_NOT_FOUND',
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('fails selected corrupt publication pointers explicitly and propagates database failures', async () => {
    const { state, service } = harness();
    state.rawResults = [[summaryRow({ invalidPublication: true, publishedRevision: null })]];
    await expect(service.summary(human, DOCUMENT)).rejects.toMatchObject({
      status: 409,
      message: 'DOCUMENT_SUMMARY_REFRESH_REQUIRED',
    });
    const failure = new Error('database failed');
    state.rawResults = [failure];
    await expect(service.list(human, PROJECT)).rejects.toBe(failure);
  });
});
