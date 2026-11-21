import { apiRequest } from './client';
import type { DocumentView } from './resources';

export interface DocumentSummaryRevision {
  id: string;
  documentId: string;
  seq: number;
  title: string;
  digest: string;
  state: 'CANDIDATE' | 'PUBLISHED';
}

export interface DocumentSummary {
  document: DocumentView;
  updatedAt: string;
  knowledgeBase: { id: string; name: string; kind: string };
  requirement: { id: string; code: string; title: string } | null;
  latestVisibleRevision: DocumentSummaryRevision | null;
  publishedRevision: DocumentSummaryRevision | null;
  visibleRevisionCount: number;
  candidateRevisionCount: number;
}

export const documentSummaryApi = {
  summary: (documentId: string) =>
    apiRequest<DocumentSummary>(`/documents/${encodeURIComponent(documentId)}/summary`),
};
