import { describe, expect, it, vi } from 'vitest';
import { type Principal, WorkmeshError } from '@workmesh/shared';
import { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import { V1AuthorizationService, type V1AuthorizationRepository } from '../auth/v1-authorization';
import type { PrismaService } from '../prisma/prisma.service';
import { V1DocumentHistoryService } from './v1-document-history.service';

const human: Principal = { kind: 'HUMAN', userId: 'reader', scopes: [] };
const agent: Principal = {
  kind: 'AGENT',
  userId: 'reader',
  agentCredentialId: 'credential-1',
  projectId: 'project-1',
  roleIds: ['role-1'],
  scopes: ['knowledge:read'],
};

function row(seq: number, author = 'another', reviewers: Array<string | null> = []) {
  const value = {
    id: `revision-${seq}`,
    documentId: 'document-1',
    projectId: 'project-1',
    seq,
    title: `Title ${seq}`,
    mimeType: 'text/markdown',
    byteLength: 123,
    sha256: 'a'.repeat(64),
    createdById: author,
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
    reviewRequests: [{ id: `review-${seq}` }],
    reviewers,
  };
  Object.defineProperty(value, 'bodyBytes', {
    get() {
      throw new Error('metadata read body');
    },
  });
  return value;
}
type Row = ReturnType<typeof row>;
type Where = Record<string, any>;
function matches(revision: Row, where: Where): boolean {
  if (where.AND && !where.AND.every((part: Where) => matches(revision, part))) return false;
  if (where.OR && !where.OR.some((part: Where) => matches(revision, part))) return false;
  if (where.documentId && revision.documentId !== where.documentId) return false;
  if (where.projectId && revision.projectId !== where.projectId) return false;
  if (where.id && revision.id !== where.id) return false;
  if (where.createdById && revision.createdById !== where.createdById) return false;
  if (where.seq && !(revision.seq < where.seq.lt)) return false;
  if (
    where.reviewRequests &&
    !revision.reviewers.includes(where.reviewRequests.some.approvalSlots.some.requiredUserId)
  )
    return false;
  return true;
}

function harness(rows: Row[] = [row(4), row(3, 'reader'), row(2, 'another', ['reader']), row(1)]) {
  const document = {
    id: 'document-1',
    projectId: 'project-1',
    knowledgeBaseId: 'kb-1',
    currentPublishedRevisionId: 'revision-1' as string | null,
    version: 7,
  };
  const kb = {
    id: 'kb-1',
    projectId: 'project-1',
    visibility: 'PROJECT',
    authzVersion: 3,
    publicationApproverUserId: 'another',
    publicationApproverRoleId: null,
    archivedAt: null,
    version: 1,
  };
  const state = {
    document,
    kb,
    rows,
    revoked: false,
    roleActive: true,
    permissions: [] as string[],
  };
  let reading = false;
  let readOnly = false;
  const read = <T extends (...args: any[]) => any>(fn: T) =>
    vi.fn((...args: Parameters<T>) => {
      expect(reading).toBe(true);
      expect(readOnly).toBe(true);
      return fn(...args);
    });
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      expect(reading).toBe(true);
      expect(strings.join('')).toBe('SET TRANSACTION READ ONLY');
      readOnly = true;
      return 0;
    }),
    knowledgeDocument: {
      findUnique: read(async (query: Where) =>
        query.where.id === state.document.id ? state.document : null,
      ),
    },
    knowledgeBase: { findUnique: read(async () => state.kb) },
    project: { findUnique: read(async () => ({ id: 'project-1', version: 1, archivedAt: null })) },
    projectMember: {
      findUnique: read(async () => ({
        projectId: 'project-1',
        userId: 'reader',
        role: 'MEMBER',
        version: 1,
        revokedAt: state.revoked ? new Date() : null,
      })),
    },
    projectRoleAssignment: {
      findMany: read(async () =>
        state.roleActive
          ? [
              {
                id: 'assignment-1',
                projectId: 'project-1',
                userId: 'reader',
                roleId: 'role-1',
                version: 1,
                revokedAt: null,
              },
            ]
          : [],
      ),
    },
    knowledgeBaseGrant: {
      findMany: read(async () => [
        {
          id: 'grant-1',
          knowledgeBaseId: 'kb-1',
          subjectKind: 'USER',
          subjectUserId: 'reader',
          subjectRoleId: null,
          permissions: state.permissions,
          revokedAt: null,
        },
      ]),
    },
    documentRevision: {
      count: read(
        async ({ where }: Where) =>
          state.rows.filter((revision) => matches(revision, where)).length,
      ),
      findMany: read(async ({ where, take }: Where) =>
        state.rows
          .filter((revision) => matches(revision, where))
          .sort((a, b) => b.seq - a.seq)
          .slice(0, take),
      ),
      findFirst: read(
        async ({ where }: Where) => state.rows.find((revision) => matches(revision, where)) ?? null,
      ),
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
  // The real authorization service must use the supplied transaction repository, not its default.
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
  const service = new V1DocumentHistoryService(
    { $transaction } as unknown as PrismaService,
    authorization,
  );
  return { state, tx, service, $transaction };
}

describe('V1DocumentHistoryService bounded metadata', () => {
  it('filters the visible relation before paging, counts all visible rows and includes an old publication', async () => {
    const { service, tx } = harness();
    const page = await service.list(human, 'document-1', { limit: 2 });
    expect(page.items.map((revision) => revision.id)).toEqual(['revision-3', 'revision-2']);
    expect(page).toMatchObject({ total: 3, documentVersion: 7 });
    // Keep accepting the cursor emitted before visibility was extracted from this service.
    expect(page.nextCursor).toBe(
      'eyJ2IjoxLCJrZXkiOiI2Njg0NTRjZWYzMTgzYWE1MjFhNzA0YjY5ZWRkNWYyY2E0Mjk1NTA2ZDgyNWZiN2MxOGEwOGE0YjM3ZGMxZTA0IiwiZG9jdW1lbnRWZXJzaW9uIjo3LCJiZWZvcmVTZXEiOjJ9',
    );
    const where = tx.documentRevision.count.mock.calls[0]![0].where;
    expect(where).toEqual({
      documentId: 'document-1',
      projectId: 'project-1',
      OR: [
        { id: 'revision-1' },
        { createdById: 'reader' },
        { reviewRequests: { some: { approvalSlots: { some: { requiredUserId: 'reader' } } } } },
      ],
    });
    const firstRead = tx.documentRevision.findMany.mock.calls[0]![0];
    expect(firstRead).toMatchObject({ where, orderBy: { seq: 'desc' }, take: 3 });
    expect(firstRead.select).not.toHaveProperty('bodyBytes');
    expect(firstRead).not.toHaveProperty('include');
    const last = await service.list(human, 'document-1', { limit: 2, cursor: page.nextCursor });
    expect(last).toMatchObject({ total: 3, documentVersion: 7, nextCursor: null });
    expect(last.items.map((revision) => [revision.id, revision.state])).toEqual([
      ['revision-1', 'PUBLISHED'],
    ]);
    expect(tx.documentRevision.count.mock.calls[1]![0].where).toEqual(where);
    expect(tx.documentRevision.findMany.mock.calls[1]![0].where).toEqual({
      ...where,
      seq: { lt: 2 },
    });
    for (const revision of [...page.items, ...last.items])
      expect(revision).not.toHaveProperty('bodyBytes');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('defaults to 50, caps at 100 and traverses more than 100 revisions without losing rows', async () => {
    const { service, state, tx } = harness(
      Array.from({ length: 205 }, (_, index) => row(index + 1)),
    );
    state.permissions = ['READ', 'PROPOSE'];
    const first = await service.list(human, 'document-1');
    expect(first.items).toHaveLength(50);
    expect(tx.documentRevision.findMany.mock.calls[0]![0].take).toBe(51);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await service.list(human, 'document-1', { limit: 999, cursor });
      ids.push(...page.items.map((revision) => revision.id));
      expect(page.total).toBe(205);
      expect(page.items.length).toBeLessThanOrEqual(100);
      cursor = page.nextCursor;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 205 }, (_, index) => `revision-${205 - index}`));
    expect(new Set(ids).size).toBe(205);
    expect(tx.documentRevision.findMany.mock.calls.slice(1).map(([query]) => query.take)).toEqual([
      101, 101, 101,
    ]);
    expect(tx.documentRevision.count.mock.calls[0]![0].where).toEqual({
      documentId: 'document-1',
      projectId: 'project-1',
    });
  });

  it('omits a null publication branch and gives empty visible histories accurate totals', async () => {
    const { service, state, tx } = harness([row(2), row(1)]);
    state.document.currentPublishedRevisionId = null;
    await expect(service.list(human, 'document-1')).resolves.toEqual({
      items: [],
      nextCursor: null,
      total: 0,
      documentVersion: 7,
    });
    expect(tx.documentRevision.count.mock.calls[0]![0].where.OR).toHaveLength(2);
    expect(tx.documentRevision.count.mock.calls[0]![0].where.OR).not.toContainEqual({ id: null });
  });

  it('reads exact old revision metadata without a history scan, body read or different-document fallback', async () => {
    const { service, tx } = harness();
    await expect(service.metadata(human, 'document-1', 'revision-1')).resolves.toEqual({
      id: 'revision-1',
      documentId: 'document-1',
      knowledgeBaseId: 'kb-1',
      projectId: 'project-1',
      seq: 1,
      title: 'Title 1',
      mimeType: 'text/markdown',
      byteLength: 123,
      digest: 'a'.repeat(64),
      state: 'PUBLISHED',
      createdBy: 'another',
      basisUnderstandingRevisionId: null,
      deliveryScope: null,
      acceptance: null,
      reviewRequestId: 'review-1',
    });
    const query = tx.documentRevision.findFirst.mock.calls[0]![0];
    expect(query.where.AND[0]).toMatchObject({ documentId: 'document-1', projectId: 'project-1' });
    expect(query.where.AND[1]).toEqual({ id: 'revision-1' });
    expect(query.select).not.toHaveProperty('bodyBytes');
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
    expect(tx.documentRevision.count).not.toHaveBeenCalled();
    for (const revisionId of ['revision-4', 'missing', 'other-document-revision'])
      await expect(service.metadata(human, 'document-1', revisionId)).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        message: 'REVISION_NOT_FOUND',
        status: 404,
      });
  });

  it('reauthorizes inside every transaction and refuses revoked READ before metadata/count/page reads', async () => {
    const { service, state, tx } = harness();
    const first = await service.list(human, 'document-1', { limit: 1 });
    tx.documentRevision.count.mockClear();
    tx.documentRevision.findMany.mockClear();
    state.kb.visibility = 'RESTRICTED';
    for (const run of [
      () => service.list(human, 'document-1', { limit: 1, cursor: first.nextCursor }),
      () => service.metadata(human, 'document-1', 'revision-3'),
    ])
      await expect(run()).rejects.toMatchObject({ status: 404 });
    expect(tx.documentRevision.count).not.toHaveBeenCalled();
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
    expect(tx.documentRevision.findFirst).not.toHaveBeenCalled();
  });

  it('keeps Agent scope, project and active role restrictions before applying author/reviewer visibility', async () => {
    const { service, state, tx } = harness();
    state.permissions = ['READ', 'PUBLISH'];
    const page = await service.list(agent, 'document-1');
    expect(page.items.map((revision) => revision.id)).toEqual([
      'revision-3',
      'revision-2',
      'revision-1',
    ]);
    for (const principal of [
      { ...agent, scopes: [] },
      { ...agent, projectId: 'another-project' },
      { ...agent, roleIds: ['another-role'] },
    ])
      await expect(service.list(principal, 'document-1')).rejects.toBeInstanceOf(WorkmeshError);
    state.roleActive = false;
    await expect(service.list(agent, 'document-1')).rejects.toMatchObject({
      message: 'AGENT_ROLE_ASSIGNMENT_INACTIVE',
    });
    expect(tx.documentRevision.findMany).toHaveBeenCalledTimes(1);
  });

  it('refuses missing documents and revoked members without querying their revision relation', async () => {
    const { service, state, tx } = harness();
    await expect(service.list(human, 'missing-document')).rejects.toMatchObject({
      message: 'DOCUMENT_NOT_FOUND',
      status: 404,
    });
    state.revoked = true;
    await expect(service.list(human, 'document-1')).rejects.toMatchObject({
      message: 'MEMBER_NOT_ACTIVE',
      status: 404,
    });
    await expect(service.metadata(human, 'document-1', 'revision-3')).rejects.toMatchObject({
      message: 'MEMBER_NOT_ACTIVE',
      status: 404,
    });
    expect(tx.documentRevision.count).not.toHaveBeenCalled();
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
    expect(tx.documentRevision.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed limits and cursors without running an unbounded query', async () => {
    const { service, $transaction, tx } = harness();
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(service.list(human, 'document-1', { limit })).rejects.toMatchObject({
        message: 'HISTORY_QUERY_INVALID',
        status: 422,
      });
    expect($transaction).not.toHaveBeenCalled();
    for (const cursor of [
      '',
      'a'.repeat(2049),
      'not+url',
      'e30=',
      'e30',
      Buffer.from('[]').toString('base64url'),
    ])
      await expect(service.list(human, 'document-1', { cursor })).rejects.toMatchObject({
        status: 422,
      });
    expect(tx.documentRevision.count).not.toHaveBeenCalled();
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
  });

  it('binds cursors to document, principal, credential, page size and current permission context', async () => {
    const { service, state } = harness();
    const first = await service.list(human, 'document-1', { limit: 1 });
    const cursor = first.nextCursor!;
    await expect(
      service.list({ ...human, userId: 'other' }, 'document-1', { limit: 1, cursor }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(service.list(human, 'document-1', { limit: 2, cursor })).rejects.toMatchObject({
      status: 422,
    });
    state.document.id = 'document-2';
    await expect(service.list(human, 'document-2', { limit: 1, cursor })).rejects.toMatchObject({
      status: 422,
    });
    state.document.id = 'document-1';
    state.kb.authzVersion += 1;
    await expect(service.list(human, 'document-1', { limit: 1, cursor })).rejects.toMatchObject({
      status: 422,
    });
    state.kb.authzVersion -= 1;
    state.permissions = ['READ', 'PROPOSE'];
    await expect(service.list(human, 'document-1', { limit: 1, cursor })).rejects.toMatchObject({
      status: 422,
    });
    const agentPage = await service.list(agent, 'document-1', { limit: 1 });
    await expect(
      service.list({ ...agent, agentCredentialId: 'credential-2' }, 'document-1', {
        limit: 1,
        cursor: agentPage.nextCursor,
      }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('requires refresh after a document version change and rejects extra/duplicate cursor fields', async () => {
    const { service, state, tx } = harness();
    const first = await service.list(human, 'document-1', { limit: 1 });
    const cursor = first.nextCursor!;
    state.document.version += 1;
    await expect(service.list(human, 'document-1', { limit: 1, cursor })).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      message: 'HISTORY_REFRESH_REQUIRED',
      status: 409,
    });
    state.document.version -= 1;
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    for (const raw of [
      JSON.stringify({ ...decoded, extra: true }),
      JSON.stringify({ ...decoded, beforeSeq: 0 }),
      JSON.stringify({ ...decoded, documentVersion: 1.5 }),
      JSON.stringify({ ...decoded, beforeSeq: 2_147_483_648 }),
      JSON.stringify({ ...decoded, beforeSeq: Number.MAX_SAFE_INTEGER }),
      JSON.stringify({ ...decoded, documentVersion: 2_147_483_648 }),
      JSON.stringify({ ...decoded, documentVersion: Number.MAX_SAFE_INTEGER }),
      JSON.stringify(decoded).replace('"v":1', '"v":2,"v":1'),
    ])
      await expect(
        service.list(human, 'document-1', {
          limit: 1,
          cursor: Buffer.from(raw).toString('base64url'),
        }),
      ).rejects.toMatchObject({ status: 422 });
    expect(tx.documentRevision.count).toHaveBeenCalledTimes(1);
    expect(tx.documentRevision.findMany).toHaveBeenCalledTimes(1);
  });

  it('does not convert read failures into successful empty metadata', async () => {
    const { service, tx } = harness();
    const failure = new Error('database failed');
    tx.documentRevision.count.mockRejectedValueOnce(failure);
    await expect(service.list(human, 'document-1')).rejects.toBe(failure);
    expect(tx.documentRevision.findMany).not.toHaveBeenCalled();
    tx.documentRevision.findFirst.mockRejectedValueOnce(failure);
    await expect(service.metadata(human, 'document-1', 'revision-1')).rejects.toBe(failure);
  });
});
