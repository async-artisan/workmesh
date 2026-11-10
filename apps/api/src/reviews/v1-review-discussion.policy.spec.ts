import { describe, expect, it } from 'vitest';
import type { Principal } from '@workmesh/shared';
import {
  canManageDiscussion,
  decodeDiscussionCursor,
  discussionText,
  encodeDiscussionCursor,
  sameDiscussionSubject,
  type DiscussionReview,
} from './v1-review-discussion.policy';

const human = { kind: 'HUMAN', userId: 'author', scopes: [] } as Principal;
const review: DiscussionReview = {
  id: 'review-1',
  projectId: 'p1',
  taskId: 'task-1',
  artifactSetId: 'set-1',
  documentRevisionId: null,
  subjectDigest: 'a'.repeat(64),
  createdAt: new Date(),
  documentRevision: null,
  approvalSlots: [{ requiredUserId: 'reviewer', requiredRoleId: 'qa' }],
};

describe('review discussion policy', () => {
  it('only allows a human author or exact current reviewer to resolve and reopen', () => {
    expect(canManageDiscussion(human, 'author', review, [])).toBe(true);
    expect(canManageDiscussion({ ...human, userId: 'reviewer' }, 'author', review, [])).toBe(true);
    expect(
      canManageDiscussion({ ...human, userId: 'qa-colleague' }, 'author', review, ['qa']),
    ).toBe(true);
    expect(canManageDiscussion({ ...human, userId: 'project-admin' }, 'author', review, [])).toBe(
      false,
    );
    expect(canManageDiscussion({ ...human, kind: 'AGENT' }, 'author', review, ['qa'])).toBe(false);
  });
  it('keeps actual delivery rounds within the same task or the same document', () => {
    expect(
      sameDiscussionSubject(review, { ...review, id: 'review-2', artifactSetId: 'set-2' }),
    ).toBe(true);
    expect(sameDiscussionSubject(review, { ...review, projectId: 'other' })).toBe(false);
    expect(sameDiscussionSubject(review, { ...review, taskId: 'other' })).toBe(false);
    const doc = {
      ...review,
      documentRevisionId: 'revision-1',
      documentRevision: { document: { id: 'doc-1', knowledgeBaseId: 'kb1' } },
    };
    expect(sameDiscussionSubject(doc, { ...doc, documentRevisionId: 'revision-2' })).toBe(true);
    expect(sameDiscussionSubject(doc, review)).toBe(false);
  });
  it('rejects blank or oversized content and cursors reused for another scope', () => {
    expect(discussionText('  需要补充证据  ', 100, 'body')).toBe('需要补充证据');
    expect(() => discussionText('  ', 100, 'body')).toThrow('DISCUSSION_TEXT_INVALID');
    expect(() => discussionText('x'.repeat(101), 100, 'body')).toThrow('DISCUSSION_TEXT_INVALID');
    const position = {
      createdAt: new Date('2026-11-09T00:00:00.000Z'),
      id: '11111111-1111-4111-8111-111111111111',
    };
    const cursor = encodeDiscussionCursor('review-1', position);
    expect(decodeDiscussionCursor('review-1', cursor)).toEqual(position);
    expect(() => decodeDiscussionCursor('review-2', cursor)).toThrow('DISCUSSION_CURSOR_INVALID');
    expect(() => decodeDiscussionCursor('review-1', 'not-json')).toThrow(
      'DISCUSSION_CURSOR_INVALID',
    );
  });
});
