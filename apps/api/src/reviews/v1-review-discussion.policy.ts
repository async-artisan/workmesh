import { V1_ERROR_CODES, WorkmeshError, type Principal } from '@workmesh/shared';

export type DiscussionReview = {
  id: string;
  projectId: string;
  taskId: string | null;
  documentRevisionId: string | null;
  artifactSetId: string | null;
  subjectDigest: string;
  createdAt: Date;
  documentRevision: { document: { id: string; knowledgeBaseId: string } } | null;
  approvalSlots: Array<{ requiredUserId: string | null; requiredRoleId: string | null }>;
};

export function sameDiscussionSubject(left: DiscussionReview, right: DiscussionReview): boolean {
  if (left.projectId !== right.projectId) return false;
  if (left.documentRevisionId || right.documentRevisionId) {
    const documentId = left.documentRevision?.document.id;
    return Boolean(documentId && documentId === right.documentRevision?.document.id);
  }
  return Boolean(
    left.taskId && left.artifactSetId && right.artifactSetId && left.taskId === right.taskId,
  );
}

export function canManageDiscussion(
  principal: Principal,
  authorUserId: string,
  review: DiscussionReview,
  activeRoleIds: readonly string[],
): boolean {
  return (
    principal.kind === 'HUMAN' &&
    (principal.userId === authorUserId ||
      review.approvalSlots.some(
        (slot) =>
          slot.requiredUserId === principal.userId ||
          Boolean(slot.requiredRoleId && activeRoleIds.includes(slot.requiredRoleId)),
      ))
  );
}

export function discussionText(value: unknown, max: number, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new WorkmeshError(
      V1_ERROR_CODES.INVALID_REQUEST,
      'DISCUSSION_TEXT_INVALID',
      { field, max },
      400,
    );
  }
  return value.trim();
}

export type DiscussionPosition = { createdAt: Date; id: string };
export function encodeDiscussionCursor(scope: string, value: DiscussionPosition): string {
  return Buffer.from(JSON.stringify([scope, value.createdAt.toISOString(), value.id])).toString(
    'base64url',
  );
}
export function decodeDiscussionCursor(scope: string, cursor?: string): DiscussionPosition | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error();
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 3 ||
      parsed[0] !== scope ||
      typeof parsed[1] !== 'string' ||
      typeof parsed[2] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed[2])
    )
      throw new Error();
    const createdAt = new Date(parsed[1]);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== parsed[1])
      throw new Error();
    return { createdAt, id: parsed[2] };
  } catch {
    throw new WorkmeshError(
      V1_ERROR_CODES.INVALID_REQUEST,
      'DISCUSSION_CURSOR_INVALID',
      undefined,
      400,
    );
  }
}
