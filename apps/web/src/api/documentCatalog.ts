import { ApiError, apiRequest } from './client';
import type { DocumentSummary } from './documentSummaries';
import type { DocumentKind } from './resources';

export type DocumentCatalogStatus = 'all' | 'candidate' | 'published';
export type DocumentCatalogKnowledgeBaseKind = 'BUSINESS' | 'SYSTEM' | 'PRACTICE';

export interface DocumentCatalogQuery {
  kind?: DocumentKind;
  knowledgeBaseKind?: DocumentCatalogKnowledgeBaseKind;
  requirementId?: string;
  status?: DocumentCatalogStatus;
  q?: string;
  searchProfile?: 'knowledge' | 'prd';
  limit?: number;
}

export interface DocumentCatalogPage {
  items: DocumentSummary[];
  nextCursor: string | null;
  total: number;
}

export interface DocumentCatalogOverview {
  total: number;
  totalsByDocumentKind: Record<DocumentKind, number>;
  collections: Array<{
    knowledgeBaseKind: DocumentCatalogKnowledgeBaseKind;
    knowledgeBaseCount: number;
    documentCount: number;
    recentItems: DocumentSummary[];
  }>;
}

export function documentCatalogQueryError(input: DocumentCatalogQuery): string | null {
  if ((input.q?.length ?? 0) > 100) return '搜索词最多 100 个字符，请缩短后重试。';
  return null;
}

export const documentCatalogApi = {
  list: async (
    projectId: string,
    input: DocumentCatalogQuery = {},
    cursor?: string | null,
    signal?: AbortSignal,
  ) => {
    const invalid = documentCatalogQueryError(input);
    if (invalid) throw new ApiError(422, 'INVALID_REQUEST', invalid);
    const query = new URLSearchParams({
      limit: String(input.limit ?? 50),
      status: input.status ?? 'all',
    });
    if (input.kind !== undefined) query.set('kind', input.kind);
    if (input.knowledgeBaseKind !== undefined)
      query.set('knowledgeBaseKind', input.knowledgeBaseKind);
    if (input.requirementId !== undefined) query.set('requirementId', input.requirementId);
    if (input.q !== undefined) query.set('q', input.q);
    if (input.searchProfile !== undefined) query.set('searchProfile', input.searchProfile);
    if (cursor != null) query.set('cursor', cursor);
    return apiRequest<DocumentCatalogPage>(
      `/projects/${encodeURIComponent(projectId)}/document-summaries?${query}`,
      { signal },
    );
  },
  summary: (documentId: string, signal?: AbortSignal) =>
    apiRequest<DocumentSummary>(`/documents/${encodeURIComponent(documentId)}/summary`, { signal }),
  overview: (projectId: string, signal?: AbortSignal) =>
    apiRequest<DocumentCatalogOverview>(
      `/projects/${encodeURIComponent(projectId)}/document-summary-overview`,
      { signal },
    ),
};
