import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service';
import { V1PublicationPrismaRepository } from './v1-publication.prisma-repository';

function revisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'revision-2',
    documentId: 'document-1',
    projectId: 'project-1',
    seq: 2,
    title: 'Revision title',
    mimeType: 'text/markdown',
    byteLength: 12,
    sha256: 'a'.repeat(64),
    createdById: 'author-1',
    basisUnderstandingRevisionId: 'understanding-1',
    deliveryScope: { participatingRoleIds: ['role-1'], requiredOutputKinds: ['IMPL'] },
    acceptance: [{ key: 'test', text: 'Acceptance', verification: 'TEST' }],
    reviewRequests: [{ id: 'review-2' }],
    ...overrides,
  };
}

describe('V1PublicationPrismaRepository revision reads', () => {
  it('matches explicit user assignments across any review and slot without changing their scope', async () => {
    const rows = [
      { id: 'old-review-assignment', reviews: [['bob'], ['alice', null]] },
      { id: 'multiple-slots', reviews: [['alice', 'bob', 'bob']] },
      { id: 'other-user-only', reviews: [['alice']] },
      { id: 'role-only', reviews: [[null]] },
      { id: 'no-reviews', reviews: [] },
    ];
    const findMany = vi.fn().mockImplementation(async (query) => {
      const userId = query.where.reviewRequests.some.approvalSlots.some.requiredUserId;
      return rows
        .filter(
          (row) =>
            query.where.id.in.includes(row.id) &&
            row.reviews.some((slots) => slots.includes(userId)),
        )
        .map(({ id }) => ({ id }));
    });
    const findFirst = vi.fn().mockImplementation(async (query) => {
      const row = rows.find((item) => item.id === query.where.reviewRequest.documentRevisionId);
      return row?.reviews.some((slots) => slots.includes(query.where.requiredUserId))
        ? { id: 'matching-slot' }
        : null;
    });
    const repository = new V1PublicationPrismaRepository({
      documentRevision: { findMany },
      approvalSlot: { findFirst },
    } as unknown as PrismaService);
    const ids = rows.map((row) => row.id);

    for (const userId of ['bob', 'alice', 'unassigned-user']) {
      const bulk = await repository.listAssignedReviewerRevisionIds(ids, userId);
      const individual = [];
      for (const id of ids) {
        if (await repository.isAssignedReviewer(id, userId)) individual.push(id);
      }
      expect(bulk).toEqual(individual);
      expect(findMany).toHaveBeenLastCalledWith({
        where: {
          id: { in: ids },
          reviewRequests: { some: { approvalSlots: { some: { requiredUserId: userId } } } },
        },
        select: { id: true },
      });
    }
    await expect(findMany.mock.results[0]?.value).resolves.toEqual([
      { id: 'old-review-assignment' },
      { id: 'multiple-slots' },
    ]);
  });

  it('bounds lookup batches, deduplicates input, and retains assignments beyond the first batch', async () => {
    const ids = Array.from({ length: 1005 }, (_, index) => `revision-${index}`);
    const assigned = new Set(['revision-0', 'revision-499', 'revision-500', 'revision-1004']);
    const findMany = vi
      .fn()
      .mockImplementation(async (query) =>
        query.where.id.in.filter((id: string) => assigned.has(id)).map((id: string) => ({ id })),
      );
    const repository = new V1PublicationPrismaRepository({
      documentRevision: { findMany },
    } as unknown as PrismaService);

    await expect(
      repository.listAssignedReviewerRevisionIds([...ids, ...ids], 'bob'),
    ).resolves.toEqual([...assigned]);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls.map(([query]) => query.where.id.in.length)).toEqual([500, 500, 5]);
    expect(findMany.mock.calls.flatMap(([query]) => query.where.id.in)).toEqual(ids);
    for (const [query] of findMany.mock.calls) {
      expect(query.select).toEqual({ id: true });
      expect(query).not.toHaveProperty('take');
    }
  });

  it('skips empty reviewer lookups and propagates a failed later batch', async () => {
    const failure = new Error('Reviewer lookup unavailable');
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'revision-0' }])
      .mockRejectedValueOnce(failure);
    const repository = new V1PublicationPrismaRepository({
      documentRevision: { findMany },
    } as unknown as PrismaService);

    await expect(repository.listAssignedReviewerRevisionIds([], 'bob')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
    const ids = Array.from({ length: 501 }, (_, index) => `revision-${index}`);
    await expect(repository.listAssignedReviewerRevisionIds(ids, 'bob')).rejects.toBe(failure);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('selects all history metadata without reading bodyBytes or truncating revisions', async () => {
    const document = { knowledgeBaseId: 'kb-1', currentPublishedRevisionId: 'revision-1' };
    const rows = [revisionRow(), revisionRow({ id: 'revision-1', seq: 1 })];
    for (const row of rows) {
      Object.defineProperty(row, 'bodyBytes', {
        get() {
          throw new Error('History mapping must not read revision bytes');
        },
      });
    }
    const findMany = vi.fn().mockResolvedValue(rows);
    const prisma = {
      knowledgeDocument: { findUnique: vi.fn().mockResolvedValue(document) },
      documentRevision: { findMany },
    };
    const repository = new V1PublicationPrismaRepository(prisma as unknown as PrismaService);

    const summaries = await repository.listRevisions('document-1');

    const query = findMany.mock.calls[0]![0];
    expect(query).toMatchObject({
      where: { documentId: 'document-1' },
      orderBy: { seq: 'desc' },
      select: {
        id: true,
        documentId: true,
        projectId: true,
        seq: true,
        title: true,
        mimeType: true,
        byteLength: true,
        sha256: true,
        createdById: true,
        basisUnderstandingRevisionId: true,
        deliveryScope: true,
        acceptance: true,
        reviewRequests: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
      },
    });
    expect(query.select).not.toHaveProperty('bodyBytes');
    expect(query).not.toHaveProperty('include');
    expect(query).not.toHaveProperty('take');
    expect(summaries.map((summary) => summary.id)).toEqual(['revision-2', 'revision-1']);
    expect(summaries[0]).toEqual({
      id: 'revision-2',
      documentId: 'document-1',
      knowledgeBaseId: 'kb-1',
      projectId: 'project-1',
      seq: 2,
      title: 'Revision title',
      mimeType: 'text/markdown',
      byteLength: 12,
      digest: 'a'.repeat(64),
      state: 'CANDIDATE',
      createdBy: 'author-1',
      basisUnderstandingRevisionId: 'understanding-1',
      deliveryScope: rows[0]!.deliveryScope,
      acceptance: rows[0]!.acceptance,
      reviewRequestId: 'review-2',
    });
    expect(summaries[1]).toMatchObject({ state: 'PUBLISHED' });
    for (const summary of summaries) expect(summary).not.toHaveProperty('bodyBytes');
  });

  it('does not query revision history for a missing document', async () => {
    const findMany = vi.fn();
    const repository = new V1PublicationPrismaRepository({
      knowledgeDocument: { findUnique: vi.fn().mockResolvedValue(null) },
      documentRevision: { findMany },
    } as unknown as PrismaService);

    await expect(repository.listRevisions('missing-document')).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('keeps the exact revision body available through findRevision', async () => {
    const bodyBytes = new Uint8Array(Buffer.from('正文\ncontent'));
    const row = {
      ...revisionRow({ byteLength: bodyBytes.length }),
      bodyBytes,
      document: { knowledgeBaseId: 'kb-1', currentPublishedRevisionId: 'revision-2' },
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const repository = new V1PublicationPrismaRepository({
      documentRevision: { findUnique },
    } as unknown as PrismaService);

    const revision = await repository.findRevision('revision-2');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'revision-2' } }),
    );
    expect(revision).toMatchObject({ id: 'revision-2', state: 'PUBLISHED' });
    expect(revision?.bodyBytes).toEqual(bodyBytes);
    expect(revision?.byteLength).toBe(bodyBytes.length);
  });
});
