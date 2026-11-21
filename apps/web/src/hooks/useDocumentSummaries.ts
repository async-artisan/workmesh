import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import {
  documentCatalogApi,
  documentCatalogQueryError,
  type DocumentCatalogQuery,
} from '../api/documentCatalog';
import type { DocumentSummary } from '../api/documentSummaries';

interface CatalogState {
  scope: string;
  items: DocumentSummary[];
  total: number | null;
  pageIndex: number;
  hasNext: boolean;
  loading: boolean;
  error: string | null;
  stale: boolean;
  accessDenied: boolean;
}

function emptyState(scope: string): CatalogState {
  return {
    scope,
    items: [],
    total: null,
    pageIndex: 0,
    hasNext: false,
    loading: false,
    error: null,
    stale: false,
    accessDenied: false,
  };
}

/** 只保留当前页和游标栈，返回旧页时仍重新请求以检查当前权限。 */
export function useDocumentSummaries(
  projectId: string | null | undefined,
  query: DocumentCatalogQuery = {},
) {
  const serializedQuery = JSON.stringify({
    kind: query.kind,
    knowledgeBaseKind: query.knowledgeBaseKind,
    requirementId: query.requirementId,
    status: query.status ?? 'all',
    q: query.q,
    searchProfile: query.searchProfile,
    limit: query.limit ?? 50,
  });
  const input = useMemo(
    () => JSON.parse(serializedQuery) as DocumentCatalogQuery,
    [serializedQuery],
  );
  const scope = JSON.stringify([projectId ?? null, serializedQuery]);
  const queryError = documentCatalogQueryError(input);
  const [state, setState] = useState<CatalogState>(() => emptyState(scope));
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const cursors = useRef<Array<string | null>>([null]);

  const requestPage = useCallback(
    async (pageIndex: number, reset = false): Promise<void> => {
      if (!projectId || queryError || activeScope.current !== scope) return;
      if (!reset && pending.current) return;
      const cursor = reset ? null : cursors.current[pageIndex];
      if (cursor === undefined) return;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = ++requestId.current;
      pending.current = true;
      if (reset) {
        cursors.current = [null];
      }
      const current = () => activeScope.current === scope && id === requestId.current;
      setState((previous) => ({
        ...(previous.scope !== scope ? emptyState(scope) : previous),
        loading: true,
        stale: previous.scope === scope && previous.items.length > 0,
        error: null,
        accessDenied: false,
        ...(reset ? { hasNext: false } : {}),
      }));
      try {
        const page = await documentCatalogApi.list(projectId, input, cursor, abort.signal);
        if (!current()) return;
        if (
          page.nextCursor !== null &&
          (page.nextCursor === cursor ||
            cursors.current.slice(0, pageIndex + 1).includes(page.nextCursor))
        ) {
          throw new ApiError(409, 'RESOURCE_CONFLICT', '概要分页返回重复游标，请刷新列表后重试。');
        }
        // A newly checked page may have a different continuation; never keep its old descendants.
        cursors.current = cursors.current.slice(0, pageIndex + 1);
        if (page.nextCursor !== null) cursors.current[pageIndex + 1] = page.nextCursor;
        setState({
          scope,
          items: page.items,
          total: page.total,
          pageIndex,
          hasNext: page.nextCursor !== null,
          loading: false,
          error: null,
          stale: false,
          accessDenied: false,
        });
      } catch (error) {
        if (!current()) return;
        const denied = error instanceof ApiError && [401, 403, 404].includes(error.status);
        const invalidated =
          denied || (error instanceof ApiError && [409, 422].includes(error.status));
        if (invalidated) {
          cursors.current = [null];
        }
        setState((previous) => ({
          ...(invalidated ? emptyState(scope) : previous),
          loading: false,
          error: formatApiError(error),
          stale: !invalidated && previous.items.length > 0,
          accessDenied: denied,
        }));
      } finally {
        if (current()) pending.current = false;
      }
    },
    [input, projectId, queryError, scope],
  );

  useEffect(() => {
    cursors.current = [null];
    setState(emptyState(scope));
    if (projectId && !queryError) void requestPage(0, true);
    return () => {
      ++requestId.current;
      pending.current = false;
      controller.current?.abort();
    };
  }, [projectId, queryError, requestPage, scope]);

  const visible = state.scope === scope ? state : emptyState(scope);
  const nextPage = useCallback(async () => {
    if (visible.loading || !visible.hasNext) return;
    await requestPage(visible.pageIndex + 1);
  }, [requestPage, visible.hasNext, visible.loading, visible.pageIndex]);
  const previousPage = useCallback(async () => {
    if (visible.loading || visible.pageIndex === 0) return;
    await requestPage(visible.pageIndex - 1);
  }, [requestPage, visible.loading, visible.pageIndex]);
  const reload = useCallback(() => requestPage(0, true), [requestPage]);

  return {
    items: visible.items,
    total: visible.total,
    pageIndex: visible.pageIndex,
    hasNext: visible.hasNext,
    hasPrevious: visible.pageIndex > 0 && cursors.current[visible.pageIndex - 1] !== undefined,
    loading: visible.loading,
    error: visible.error,
    stale: visible.stale,
    accessDenied: visible.accessDenied,
    queryError,
    nextPage,
    previousPage,
    reload,
  };
}
