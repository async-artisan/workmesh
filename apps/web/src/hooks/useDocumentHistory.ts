import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, formatApiError } from '../api/client';
import { documentHistoryApi } from '../api/documentHistory';
import type { RevisionView } from '../api/resources';

interface HistoryState {
  scope: string;
  items: RevisionView[];
  total: number | null;
  documentVersion: number | null;
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  stale: boolean;
  requiresReload: boolean;
  accessDenied: boolean;
  metadataById: ReadonlyMap<string, RevisionView>;
  metadataError: string | null;
}

function emptyState(scope: string): HistoryState {
  return {
    scope,
    items: [],
    total: null,
    documentVersion: null,
    hasMore: false,
    loading: false,
    loadingMore: false,
    error: null,
    stale: false,
    requiresReload: false,
    accessDenied: false,
    metadataById: new Map(),
    metadataError: null,
  };
}

/** 历史已读集合和指定修订缓存分开；跨项目/文档/刷新/比较代次的响应均失效。 */
export function useDocumentHistory(
  documentId: string | null | undefined,
  options: { scopeKey?: string | null } = {},
) {
  const scope = JSON.stringify([options.scopeKey ?? null, documentId ?? null]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const [state, setState] = useState<HistoryState>(() => emptyState(scope));
  const stateRef = useRef(state);
  stateRef.current = state;
  const generation = useRef(0);
  const resolutionGeneration = useRef(0);
  const requestId = useRef(0);
  const historyController = useRef<AbortController | null>(null);
  const pendingHistory = useRef(false);
  const metadataControllers = useRef(new Map<string, AbortController>());
  const pendingMetadata = useRef(new Map<string, Promise<RevisionView | null>>());
  const metadataCache = useRef(new Map<string, RevisionView>());
  const nextCursor = useRef<string | null>(null);
  const consumedCursors = useRef(new Set<string>());
  const snapshot = useRef<{ total: number; documentVersion: number } | null>(null);

  const cancelResolutions = useCallback(() => {
    ++resolutionGeneration.current;
    for (const controller of metadataControllers.current.values()) controller.abort();
    metadataControllers.current.clear();
    pendingMetadata.current.clear();
    metadataCache.current.clear();
  }, []);

  const invalidateResolutions = useCallback(() => {
    cancelResolutions();
    setState((previous) => ({ ...previous, metadataById: new Map(), metadataError: null }));
  }, [cancelResolutions]);

  const denyAccess = useCallback(
    (error: unknown) => {
      ++generation.current;
      ++requestId.current;
      historyController.current?.abort();
      pendingHistory.current = false;
      cancelResolutions();
      consumedCursors.current.clear();
      nextCursor.current = null;
      snapshot.current = null;
      setState({
        ...emptyState(scope),
        error: formatApiError(error),
        metadataError: formatApiError(error),
        accessDenied: true,
      });
    },
    [cancelResolutions, scope],
  );

  const requestHistory = useCallback(
    async (reset: boolean): Promise<void> => {
      if (!documentId || activeScope.current !== scope) return;
      if (!reset && (pendingHistory.current || nextCursor.current === null)) return;
      historyController.current?.abort();
      if (reset) {
        ++generation.current;
        cancelResolutions();
        consumedCursors.current.clear();
        nextCursor.current = null;
        snapshot.current = null;
      }
      const currentGeneration = generation.current;
      const id = ++requestId.current;
      const abort = new AbortController();
      historyController.current = abort;
      pendingHistory.current = true;
      const cursor = reset ? null : nextCursor.current;
      const current = () =>
        activeScope.current === scope &&
        generation.current === currentGeneration &&
        requestId.current === id;
      setState((previous) => ({
        ...(previous.scope !== scope ? emptyState(scope) : previous),
        loading: reset,
        loadingMore: !reset,
        error: null,
        stale: reset ? previous.scope === scope && previous.items.length > 0 : previous.stale,
        ...(reset
          ? {
              hasMore: false,
              requiresReload: false,
              accessDenied: false,
              metadataById: new Map(),
              metadataError: null,
            }
          : {}),
      }));
      try {
        const page = await documentHistoryApi.list(documentId, { limit: 50, cursor }, abort.signal);
        if (!current()) return;
        if (
          !reset &&
          (page.total !== snapshot.current?.total ||
            page.documentVersion !== snapshot.current?.documentVersion)
        ) {
          throw new ApiError(
            409,
            'RESOURCE_CONFLICT',
            'HISTORY_REFRESH_REQUIRED：历史数量或文档版本已变化，请刷新历史。',
          );
        }
        if (
          page.nextCursor !== null &&
          (page.nextCursor === cursor || consumedCursors.current.has(page.nextCursor))
        ) {
          throw new ApiError(
            409,
            'RESOURCE_CONFLICT',
            'HISTORY_REFRESH_REQUIRED：历史分页返回重复游标，请刷新历史。',
          );
        }
        if (cursor !== null) consumedCursors.current.add(cursor);
        nextCursor.current = page.nextCursor;
        snapshot.current = { total: page.total, documentVersion: page.documentVersion };
        setState((previousState) => {
          const items = reset ? [] : [...previousState.items];
          const ids = new Set(items.map((item) => item.id));
          for (const item of page.items) {
            if (!ids.has(item.id)) {
              ids.add(item.id);
              items.push(item);
            }
          }
          return {
            ...previousState,
            items,
            total: page.total,
            documentVersion: page.documentVersion,
            hasMore: page.nextCursor !== null,
            loading: false,
            loadingMore: false,
            error: null,
            stale: false,
            requiresReload: false,
            accessDenied: false,
          };
        });
      } catch (error) {
        if (!current()) return;
        if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
          denyAccess(error);
          return;
        }
        const requiresReload = error instanceof ApiError && [409, 422].includes(error.status);
        if (requiresReload) {
          nextCursor.current = null;
          consumedCursors.current.clear();
          cancelResolutions();
        }
        setState((previous) => ({
          ...previous,
          loading: false,
          loadingMore: false,
          hasMore: requiresReload ? false : previous.hasMore,
          error: formatApiError(error),
          stale: previous.items.length > 0,
          requiresReload,
          ...(requiresReload ? { metadataById: new Map(), metadataError: null } : {}),
        }));
      } finally {
        if (current()) pendingHistory.current = false;
      }
    },
    [cancelResolutions, denyAccess, documentId, scope],
  );

  useEffect(() => {
    setState(emptyState(scope));
    nextCursor.current = null;
    consumedCursors.current.clear();
    snapshot.current = null;
    cancelResolutions();
    if (documentId) void requestHistory(true);
    return () => {
      ++generation.current;
      ++requestId.current;
      historyController.current?.abort();
      pendingHistory.current = false;
      cancelResolutions();
    };
  }, [cancelResolutions, documentId, requestHistory, scope]);

  const resolveRevision = useCallback(
    async (revisionId: string): Promise<RevisionView | null> => {
      if (!documentId || activeScope.current !== scope) return null;
      if (stateRef.current.scope === scope && stateRef.current.accessDenied) return null;
      if (!revisionId) {
        setState((previous) => ({ ...previous, metadataError: '请输入准确修订 ID。' }));
        return null;
      }
      const cached = metadataCache.current.get(revisionId);
      if (cached) {
        setState((previous) => ({ ...previous, metadataError: null }));
        return cached;
      }
      const pending = pendingMetadata.current.get(revisionId);
      if (pending) return pending;
      const currentGeneration = generation.current;
      const currentResolution = resolutionGeneration.current;
      const abort = new AbortController();
      metadataControllers.current.set(revisionId, abort);
      const current = () =>
        activeScope.current === scope &&
        generation.current === currentGeneration &&
        resolutionGeneration.current === currentResolution;
      setState((previous) => ({ ...previous, metadataError: null }));
      const request = (async () => {
        try {
          const revision = await documentHistoryApi.metadata(documentId, revisionId, abort.signal);
          if (!current()) return null;
          metadataCache.current.set(revisionId, revision);
          setState((previous) => ({
            ...previous,
            metadataById: new Map(metadataCache.current),
          }));
          return revision;
        } catch (error) {
          if (!current()) return null;
          if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
            denyAccess(error);
          } else {
            setState((previous) => ({ ...previous, metadataError: formatApiError(error) }));
          }
          return null;
        } finally {
          if (current()) {
            metadataControllers.current.delete(revisionId);
            pendingMetadata.current.delete(revisionId);
          }
        }
      })();
      pendingMetadata.current.set(revisionId, request);
      return request;
    },
    [denyAccess, documentId, scope],
  );
  const loadMore = useCallback(() => requestHistory(false), [requestHistory]);
  const reload = useCallback(() => requestHistory(true), [requestHistory]);
  const visible = state.scope === scope ? state : emptyState(scope);

  return {
    items: visible.items,
    total: visible.total,
    documentVersion: visible.documentVersion,
    hasMore: visible.hasMore,
    loading: visible.loading,
    loadingMore: visible.loadingMore,
    error: visible.error,
    stale: visible.stale,
    requiresReload: visible.requiresReload,
    accessDenied: visible.accessDenied,
    metadataById: visible.metadataById,
    metadataError: visible.metadataError,
    resolveRevision,
    loadMore,
    reload,
    invalidateResolutions,
  };
}
