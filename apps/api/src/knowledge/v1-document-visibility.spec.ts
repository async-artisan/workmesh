import { describe, expect, it } from 'vitest';
import type { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { V1KnowledgeAccess } from '../auth/v1-authorization';
import { visibleRevisionState } from './v1-publication-policy';
import {
  documentRevisionVisibilityPolicy,
  visibleDocumentRevisionWhere,
} from './v1-document-visibility';

const principal = { userId: 'reader' };
const document = {
  id: 'document-1',
  projectId: 'project-1',
  currentPublishedRevisionId: 'published-1' as string | null,
};

function access(canPropose = false, canPublish = false): V1KnowledgeAccess {
  return {
    knowledgeBase: {
      id: 'kb-1',
      projectId: 'project-1',
      visibility: 'PROJECT',
      authzVersion: 1,
      publicationApproverUserId: 'approver',
      publicationApproverRoleId: null,
      archivedAt: null,
      version: 1,
    },
    projectId: 'project-1',
    permissions: [
      'READ',
      ...(canPropose ? ['PROPOSE' as const] : []),
      ...(canPublish ? ['PUBLISH' as const] : []),
    ],
    isActiveMember: true,
    canRead: true,
    canPropose,
    canPublish,
    canRevoke: false,
  };
}

function row(id: string, author = 'another') {
  return {
    id,
    documentId: document.id,
    projectId: document.projectId,
    createdById: author,
    reviewRequests: [] as Array<{
      status: string;
      approvalSlots: Array<{
        requiredUserId: string | null;
        requiredRoleId: string | null;
        delegations: Array<{ delegateUserId: string }>;
      }>;
    }>,
  };
}

function reviewed(
  id: string,
  status: string,
  requiredUserId: string | null = principal.userId,
): ReturnType<typeof row> {
  return {
    ...row(id),
    reviewRequests: [
      {
        status,
        approvalSlots: [{ requiredUserId, requiredRoleId: null, delegations: [] }],
      },
    ],
  };
}

// Interpret the Prisma equality / AND / OR / relation-some subset independently of policy choices.
function matches(value: unknown, condition: unknown): boolean {
  if (condition === null || typeof condition !== 'object') return value === condition;
  return Object.entries(condition).every(([key, expected]) => {
    if (key === 'AND') return (expected as unknown[]).every((part) => matches(value, part));
    if (key === 'OR') return (expected as unknown[]).some((part) => matches(value, part));
    if (key === 'some')
      return Array.isArray(value) && value.some((item) => matches(item, expected));
    return matches((value as Record<string, unknown>)[key], expected);
  });
}

function selected(rows: ReturnType<typeof row>[], where: Prisma.DocumentRevisionWhereInput) {
  return rows.filter((item) => matches(item, where)).map((item) => item.id);
}

describe('document revision visibility after current KB READ authorization', () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    'matches the existing publication visibility policy for PROPOSE=%s PUBLISH=%s',
    (canPropose, canPublish) => {
      const resolvedAccess = access(canPropose, canPublish);
      const rows = [
        row('published-1'),
        row('author', 'reader'),
        reviewed('reviewer', 'APPROVED'),
        row('hidden'),
      ];
      for (const publishedId of ['published-1', null]) {
        const scopedDocument = { ...document, currentPublishedRevisionId: publishedId };
        const where = visibleDocumentRevisionWhere(
          scopedDocument,
          documentRevisionVisibilityPolicy(principal, resolvedAccess),
        );
        const expected = rows.filter((item) =>
          visibleRevisionState(item.id === publishedId ? 'PUBLISHED' : 'CANDIDATE', {
            access: resolvedAccess,
            isAuthor: item.createdById === principal.userId,
            isAssignedReviewer: item.reviewRequests.some((review) =>
              review.approvalSlots.some((slot) => slot.requiredUserId === principal.userId),
            ),
          }),
        );
        expect(selected(rows, where)).toEqual(expected.map((item) => item.id));
      }
    },
  );

  it('keeps explicit user review slots visible in every status without granting role or delegated slots', () => {
    const statuses = ['OPEN', 'APPROVED', 'CHANGES_REQUESTED', 'REJECTED', 'INVALIDATED'];
    const explicit = statuses.map((status) => reviewed(`explicit-${status}`, status));
    const roleOnly = reviewed('role-only', 'OPEN', null);
    roleOnly.reviewRequests[0]!.approvalSlots[0]!.requiredRoleId = 'reader-role';
    const delegated = reviewed('delegated-only', 'OPEN', 'another');
    delegated.reviewRequests[0]!.approvalSlots[0]!.delegations = [{ delegateUserId: 'reader' }];
    const rows = [...explicit, roleOnly, delegated, reviewed('another-user', 'OPEN', 'another')];
    const where = visibleDocumentRevisionWhere(
      { ...document, currentPublishedRevisionId: null },
      documentRevisionVisibilityPolicy(principal, access()),
    );
    expect(selected(rows, where)).toEqual(statuses.map((status) => `explicit-${status}`));
  });

  it.each([false, true])(
    'enforces document and project boundaries even when all revisions are visible: %s',
    (all) => {
      const rows = [
        row('published-1'),
        row('author', 'reader'),
        reviewed('reviewer', 'OPEN'),
        { ...row('published-1'), documentId: 'other-document' },
        { ...row('foreign-author', 'reader'), projectId: 'other-project' },
        { ...reviewed('foreign-reviewer', 'OPEN'), projectId: 'other-project' },
      ];
      const where = visibleDocumentRevisionWhere(
        document,
        documentRevisionVisibilityPolicy(principal, access(all)),
      );
      expect(selected(rows, where)).toEqual(['published-1', 'author', 'reviewer']);
    },
  );

  it('does not carry one KB capability into a later READ-only policy', () => {
    const rows = [row('published-1'), row('private-candidate')];
    const proposer = documentRevisionVisibilityPolicy(principal, access(true));
    const reader = documentRevisionVisibilityPolicy(principal, access());
    expect(selected(rows, visibleDocumentRevisionWhere(document, proposer))).toEqual([
      'published-1',
      'private-candidate',
    ]);
    expect(selected(rows, visibleDocumentRevisionWhere(document, reader))).toEqual(['published-1']);
  });
});
