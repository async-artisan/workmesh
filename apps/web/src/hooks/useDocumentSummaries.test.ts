import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DocumentCatalogQuery } from '../api/documentCatalog';
import type { DocumentSummary } from '../api/documentSummaries';
import { envelope, mockFetch, type StubReply } from '../test-utils';
import { useDocumentSummaries } from './useDocumentSummaries';

function summary(id: string): DocumentSummary {
  return {
    document: {
      id,
      projectId: 'p1',
      knowledgeBaseId: 'kb1',
      requirementId: null,
      kind: 'PRD',
      version: 123,
      currentPublishedRevisionId: 'r2',
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00Z',
    knowledgeBase: { id: 'kb1', name: '知识', kind: 'BUSINESS' },
    requirement: null,
    latestVisibleRevision: {
      id: 'r123',
      documentId: id,
      seq: 123,
      title: id,
      digest: 'digest',
      state: 'CANDIDATE',
    },
    publishedRevision: {
      id: 'r2',
      documentId: id,
      seq: 2,
      title: 'published',
      digest: 'digest',
      state: 'PUBLISHED',
    },
    visibleRevisionCount: 123,
    candidateRevisionCount: 122,
  };
}

function page(ids: string[], nextCursor: string | null, total = 107): StubReply {
  return { status: 200, body: envelope({ items: ids.map(summary), nextCursor, total }) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useDocumentSummaries', () => {
  it.each<DocumentCatalogQuery>([
    { kind: 'KNOWLEDGE' },
    { knowledgeBaseKind: 'PRACTICE' },
    { requirementId: 'req2' },
    { status: 'published' },
    { searchProfile: 'prd' },
    { limit: 25 },
  ])('resets pagination when a query binding changes: %j', async (changed) => {
    const cursors: Array<string | null> = [];
    mockFetch((url) => {
      const cursor = new URL(url, 'http://localhost').searchParams.get('cursor');
      cursors.push(cursor);
      return cursor === null ? page(['first'], 'next') : page(['second'], null);
    });
    const { result, rerender } = renderHook(
      ({ query }: { query: DocumentCatalogQuery }) => useDocumentSummaries('p1', query),
      { initialProps: { query: {} } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.nextPage());
    expect(result.current.pageIndex).toBe(1);
    rerender({ query: changed });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pageIndex).toBe(0);
    expect(cursors).toEqual([null, 'next', null]);
  });

  it('loads only the first 50 summaries and keeps the server total and candidate count', async () => {
    const fetch = mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/projects/p1/document-summaries');
      expect(parsed.searchParams.get('limit')).toBe('50');
      expect(parsed.searchParams.get('kind')).toBe('PRD');
      expect(parsed.searchParams.get('searchProfile')).toBe('prd');
      return page(
        Array.from({ length: 50 }, (_, i) => `d${i + 1}`),
        'page2',
      );
    });
    const { result } = renderHook(() =>
      useDocumentSummaries('p1', { kind: 'PRD', searchProfile: 'prd' }),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(50);
    expect(result.current.total).toBe(107);
    expect(result.current.items[0]?.candidateRevisionCount).toBe(122);
    expect(result.current.hasNext).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('replaces the current page and revalidates previous pages instead of trusting a cached permission snapshot', async () => {
    let firstReads = 0;
    const fetch = mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.searchParams.has('cursor')) return page(['d51'], null);
      return page([++firstReads === 1 ? 'd1' : 'fresh-d1'], 'page2');
    });
    const { result } = renderHook(() => useDocumentSummaries('p1'));
    await waitFor(() => expect(result.current.items[0]?.document.id).toBe('d1'));
    await act(() => result.current.nextPage());
    expect(result.current.items.map((item) => item.document.id)).toEqual(['d51']);
    expect(result.current.pageIndex).toBe(1);
    expect(result.current.hasPrevious).toBe(true);
    await act(() => result.current.previousPage());
    expect(result.current.items[0]?.document.id).toBe('fresh-d1');
    expect(result.current.pageIndex).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('clears the cursor stack on a query change and ignores a delayed old response', async () => {
    const late = deferred<StubReply>();
    let oldSignal: AbortSignal | null | undefined;
    const fetch = mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.searchParams.get('q') === 'old') {
        oldSignal = init.signal;
        return late.promise;
      }
      expect(parsed.searchParams.has('cursor')).toBe(false);
      return page(['new-result'], null, 1);
    });
    const { result, rerender } = renderHook(({ q }) => useDocumentSummaries('p1', { q }), {
      initialProps: { q: 'old' },
    });
    rerender({ q: 'new' });
    await waitFor(() => expect(result.current.items[0]?.document.id).toBe('new-result'));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      late.resolve(page(['obsolete'], 'old-next'));
    });
    expect(result.current.items[0]?.document.id).toBe('new-result');
    expect(result.current.total).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('isolates projects and aborts an older project response without making a follow-up request', async () => {
    const late = deferred<StubReply>();
    const fetch = mockFetch((url) =>
      url.includes('/p1/') ? late.promise : page(['p2-result'], null, 1),
    );
    const { result, rerender } = renderHook(({ project }) => useDocumentSummaries(project), {
      initialProps: { project: 'p1' },
    });
    rerender({ project: 'p2' });
    await waitFor(() => expect(result.current.items[0]?.document.id).toBe('p2-result'));
    await act(async () => {
      late.resolve(page(['p1-result'], 'old-next'));
    });
    expect(result.current.items[0]?.document.id).toBe('p2-result');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects a 101-character query visibly and clears the previously readable results', async () => {
    const fetch = mockFetch(() => page(['d1'], 'next'));
    const { result, rerender } = renderHook(({ q }) => useDocumentSummaries('p1', { q }), {
      initialProps: { q: 'valid' },
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    rerender({ q: 'x'.repeat(101) });
    expect(result.current.queryError).toContain('100');
    expect(result.current.items).toEqual([]);
    expect(result.current.hasNext).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retains an explicitly stale page after an ordinary next-page failure and retries its cursor', async () => {
    let attempts = 0;
    mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      if (!parsed.searchParams.has('cursor')) return page(['d1'], 'next');
      expect(parsed.searchParams.get('cursor')).toBe('next');
      if (++attempts === 1)
        return {
          status: 503,
          body: { error: { code: 'UNAVAILABLE', message: 'TRY_AGAIN', requestId: 'req-c' } },
        };
      return page(['d51'], null);
    });
    const { result } = renderHook(() => useDocumentSummaries('p1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.nextPage());
    expect(result.current.items[0]?.document.id).toBe('d1');
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toContain('req-c');
    await act(() => result.current.nextPage());
    expect(result.current.items[0]?.document.id).toBe('d51');
    expect(result.current.stale).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it.each([401, 403, 404, 409, 422])(
    'invalidates cached pages after HTTP %s and can reload from the beginning',
    async (status) => {
      let denied = true;
      const fetch = mockFetch((url) => {
        const parsed = new URL(url, 'http://localhost');
        if (!parsed.searchParams.has('cursor')) return page(['d1'], 'next');
        return denied
          ? {
              status,
              body: { error: { code: 'REJECTED', message: 'NO_CURRENT_SNAPSHOT' } },
            }
          : page(['d51'], null);
      });
      const { result } = renderHook(() => useDocumentSummaries('p1'));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      await act(() => result.current.nextPage());
      expect(result.current.items).toEqual([]);
      expect(result.current.total).toBeNull();
      expect(result.current.hasNext).toBe(false);
      expect(result.current.error).toContain('NO_CURRENT_SNAPSHOT');
      expect(result.current.accessDenied).toBe([401, 403, 404].includes(status));
      denied = false;
      await act(() => result.current.reload());
      expect(result.current.items[0]?.document.id).toBe('d1');
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  it('stops a repeated continuation cursor without reading a third page', async () => {
    const fetch = mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.has('cursor') ? page(['d51'], 'same') : page(['d1'], 'same');
    });
    const { result } = renderHook(() => useDocumentSummaries('p1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.nextPage());
    expect(result.current.error).toContain('重复游标');
    expect(result.current.items).toEqual([]);
    expect(result.current.hasNext).toBe(false);
    await act(() => result.current.nextPage());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains a stale snapshot when a same-query reload fails and disables obsolete page navigation', async () => {
    let attempts = 0;
    mockFetch(() =>
      ++attempts === 1
        ? page(['d1'], 'next')
        : {
            status: 503,
            body: { error: { code: 'UNAVAILABLE', message: 'RELOAD_FAILED' } },
          },
    );
    const { result } = renderHook(() => useDocumentSummaries('p1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.reload());
    expect(result.current.items[0]?.document.id).toBe('d1');
    expect(result.current.total).toBe(107);
    expect(result.current.stale).toBe(true);
    expect(result.current.hasNext).toBe(false);
    expect(result.current.error).toContain('RELOAD_FAILED');
  });
});
