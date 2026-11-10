import { apiRequest } from './client';

export interface DiscussionReviewSource {
  reviewId: string;
  artifactSetId: string | null;
  documentRevisionId: string | null;
  subjectDigest: string;
  createdAt: string;
}
export interface DiscussionEntry {
  id: string;
  kind: 'REPLY' | 'RESOLVED' | 'REOPENED';
  body: string;
  createdAt: string;
  author: { id: string; email: string; kind: string };
  addressedInReview: DiscussionReviewSource | null;
}
export interface ReviewDiscussion {
  id: string;
  title: string;
  body: string;
  resolved: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  author: DiscussionEntry['author'];
  source: DiscussionReviewSource;
  canReply: boolean;
  canManage: boolean;
  entries: DiscussionEntry[];
  nextEntriesCursor: string | null;
}
export interface DiscussionPage {
  items: ReviewDiscussion[];
  nextCursor: string | null;
  unresolvedCount: number;
  canCreate: boolean;
}
export interface DiscussionReply {
  kind: 'REPLY' | 'RESOLVED' | 'REOPENED';
  expectedVersion: number;
  body: string;
  addressedInReviewId?: string;
}
function path(reviewId: string) {
  return `/review-requests/${encodeURIComponent(reviewId)}/discussions`;
}
function query(cursor?: string) {
  return cursor ? `?${new URLSearchParams({ cursor })}` : '';
}
export const reviewDiscussionApi = {
  list: (reviewId: string, cursor?: string) =>
    apiRequest<DiscussionPage>(`${path(reviewId)}${query(cursor)}`),
  entries: (reviewId: string, discussionId: string, cursor?: string) =>
    apiRequest<{ items: DiscussionEntry[]; nextCursor: string | null }>(
      `${path(reviewId)}/${encodeURIComponent(discussionId)}/entries${query(cursor)}`,
    ),
  create: (reviewId: string, input: { title: string; body: string }, key: string) =>
    apiRequest(`${path(reviewId)}`, { method: 'POST', body: input, idempotencyKey: key }),
  reply: (reviewId: string, discussionId: string, input: DiscussionReply, key: string) =>
    apiRequest(`${path(reviewId)}/${encodeURIComponent(discussionId)}/entries`, {
      method: 'POST',
      body: input,
      idempotencyKey: key,
    }),
};
