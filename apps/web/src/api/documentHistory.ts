import { apiRequest } from './client';
import type { RevisionView } from './resources';

export interface DocumentHistoryPage {
  items: RevisionView[];
  nextCursor: string | null;
  total: number;
  documentVersion: number;
}

export interface DocumentHistoryQuery {
  limit?: number;
  cursor?: string | null;
}

/** 分页历史和精确元数据均不读取正文，也不回退全量 document GET。 */
export const documentHistoryApi = {
  list: (documentId: string, input: DocumentHistoryQuery = {}, signal?: AbortSignal) => {
    const query = new URLSearchParams({ limit: String(input.limit ?? 50) });
    if (input.cursor != null) query.set('cursor', input.cursor);
    return apiRequest<DocumentHistoryPage>(
      `/documents/${encodeURIComponent(documentId)}/history?${query}`,
      { signal },
    );
  },
  metadata: (documentId: string, revisionId: string, signal?: AbortSignal) =>
    apiRequest<RevisionView>(
      `/documents/${encodeURIComponent(documentId)}/revisions/${encodeURIComponent(revisionId)}/metadata`,
      { signal },
    ),
};
