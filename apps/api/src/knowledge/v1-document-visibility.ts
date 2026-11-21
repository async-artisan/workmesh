import type { Principal } from '@workmesh/shared';
import type { Prisma } from '../../../node_modules/.prisma/workmesh-v1-client';
import type { V1KnowledgeAccess } from '../auth/v1-authorization';

export type V1DocumentRevisionVisibilityPolicy =
  { mode: 'ALL' } | { mode: 'LIMITED'; userId: string };

type RevisionDocument = {
  id: string;
  projectId: string;
  currentPublishedRevisionId: string | null;
};

/**
 * The caller must first authorize current project membership and KB READ.
 * These capabilities already include the current role, grant and Agent scope intersection.
 */
export function documentRevisionVisibilityPolicy(
  principal: Pick<Principal, 'userId'>,
  access: Pick<V1KnowledgeAccess, 'canPropose' | 'canPublish'>,
): V1DocumentRevisionVisibilityPolicy {
  return access.canPropose || access.canPublish
    ? { mode: 'ALL' }
    : { mode: 'LIMITED', userId: principal.userId };
}

/** Current publication, authorship and explicit user review slots form a union. */
export function visibleDocumentRevisionWhere(
  document: RevisionDocument,
  policy: V1DocumentRevisionVisibilityPolicy,
): Prisma.DocumentRevisionWhereInput {
  const scope = { documentId: document.id, projectId: document.projectId };
  if (policy.mode === 'ALL') return scope;
  return {
    ...scope,
    OR: [
      ...(document.currentPublishedRevisionId ? [{ id: document.currentPublishedRevisionId }] : []),
      { createdById: policy.userId },
      {
        reviewRequests: { some: { approvalSlots: { some: { requiredUserId: policy.userId } } } },
      },
    ],
  };
}
