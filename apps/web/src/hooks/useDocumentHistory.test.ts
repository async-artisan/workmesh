import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RevisionView } from '../api/resources';
import { envelope, mockFetch, type StubReply } from '../test-utils';
import { useDocumentHistory } from './useDocumentHistory';

function revision(seq: number, documentId = 'd1'): RevisionView {
  return {
    id: `${documentId}-r${seq}`,
    documentId,
    seq,
    title: `Revision ${seq}`,
    mimeType: 'text/markdown',
    byteLength: 10,
    digest: 'digest',
    state: seq === 2 ? 'PUBLISHED' : 'CANDIDATE',
    createdBy: 'agent',
    basisUnderstandingRevisionId: null,
    deliveryScope: null,
    acceptance: null,
  };
}

function page(
  seqs: number[],
  nextCursor: string | null,
  options: { total?: number; documentVersion?: number; documentId?: string } = {},
): StubReply {
  return {
    status: 200,
    body: envelope({
      items: seqs.map((seq) => revision(seq, options.documentId)),
      total: options.total ?? 123,
      documentVersion: options.documentVersion ?? 124,
      nextCursor,
    }),
  };
}

function rejected(status: number, message: string): StubReply {
  return { status, body: { error: { code: 'REJECTED', message, requestId: 'req-history' } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useDocumentHistory', () => {
  it('loads the first 50 descending revisions without fetching the remaining 73', async () => {
    const fetch = mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/documents/d1/history');
      expect(parsed.searchParams.get('limit')).toBe('50');
      expect(parsed.searchParams.has('cursor')).toBe(false);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return page(
        Array.from({ length: 50 }, (_, i) => 123 - i),
        'page2',
      );
    });
    const { result } = renderHook(() => useDocumentHistory('d1', { scopeKey: 'p1' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(50);
    expect(result.current.items[0]?.seq).toBe(123);
    expect(result.current.items[49]?.seq).toBe(74);
    expect(result.current.total).toBe(123);
    expect(result.current.documentVersion).toBe(124);
    expect(result.current.hasMore).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('appends only on demand, deduplicates revision IDs and retains server totals', async () => {
    const fetch = mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      return parsed.searchParams.has('cursor')
        ? page([74, 73, 72, 72], null)
        : page([75, 74], 'next');
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.seq)).toEqual([75, 74, 73, 72]);
    expect(result.current.total).toBe(123);
    expect(result.current.hasMore).toBe(false);
    await act(() => result.current.loadMore());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('resolves an old published revision directly and keeps its cache outside loaded history', async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith('/revisions/d1-r2/metadata'))
        return { status: 200, body: envelope(revision(2)) };
      return page([123, 122], 'next');
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    let exact: RevisionView | null = null;
    await act(async () => {
      exact = await result.current.resolveRevision('d1-r2');
    });
    expect(exact).toMatchObject({ id: 'd1-r2', seq: 2, state: 'PUBLISHED' });
    expect(result.current.metadataById.get('d1-r2')?.seq).toBe(2);
    expect(result.current.items.map((item) => item.seq)).toEqual([123, 122]);
    expect(result.current.total).toBe(123);
    await act(async () => {
      await result.current.resolveRevision('d1-r2');
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent exact requests without turning either into an extra history page', async () => {
    const exact = deferred<StubReply>();
    const fetch = mockFetch((url) =>
      url.endsWith('/metadata') ? exact.promise : page([123], 'next'),
    );
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let first!: Promise<RevisionView | null>;
    let second!: Promise<RevisionView | null>;
    act(() => {
      first = result.current.resolveRevision('d1-r7');
      second = result.current.resolveRevision('d1-r7');
    });
    await act(async () => {
      exact.resolve({ status: 200, body: envelope(revision(7)) });
      await expect(first).resolves.toMatchObject({ seq: 7 });
      await expect(second).resolves.toMatchObject({ seq: 7 });
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.metadataById.size).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains loaded rows after a transient continuation failure and retries that same cursor', async () => {
    let nextAttempts = 0;
    mockFetch((url) => {
      const parsed = new URL(url, 'http://localhost');
      if (!parsed.searchParams.has('cursor')) return page([123, 122], 'next');
      expect(parsed.searchParams.get('cursor')).toBe('next');
      return ++nextAttempts === 1 ? rejected(503, 'RETRY_THIS_PAGE') : page([121], null);
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.seq)).toEqual([123, 122]);
    expect(result.current.error).toContain('req-history');
    expect(result.current.stale).toBe(true);
    expect(result.current.requiresReload).toBe(false);
    expect(result.current.hasMore).toBe(true);
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.seq)).toEqual([123, 122, 121]);
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBe(false);
  });

  it.each([
    { total: 122, documentVersion: 124 },
    { total: 123, documentVersion: 125 },
  ])('requires a reload before mixing a changed total/version snapshot: %j', async (changed) => {
    const fetch = mockFetch((url) => {
      if (url.endsWith('/metadata')) return { status: 200, body: envelope(revision(2)) };
      return new URL(url, 'http://localhost').searchParams.has('cursor')
        ? page([121], null, changed)
        : page([123, 122], 'next');
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    await act(async () => {
      await result.current.resolveRevision('d1-r2');
    });
    await act(() => result.current.loadMore());
    expect(result.current.items.map((item) => item.seq)).toEqual([123, 122]);
    expect(result.current.stale).toBe(true);
    expect(result.current.requiresReload).toBe(true);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.metadataById.size).toBe(0);
    const calls = fetch.mock.calls.length;
    await act(() => result.current.loadMore());
    expect(fetch).toHaveBeenCalledTimes(calls);
  });

  it('surfaces a 409 continuation rejection and restarts explicitly with a fresh first page', async () => {
    let initialReads = 0;
    mockFetch((url) => {
      if (new URL(url, 'http://localhost').searchParams.has('cursor'))
        return rejected(409, 'HISTORY_REFRESH_REQUIRED');
      return ++initialReads === 1
        ? page([123], 'old-next')
        : page([124], 'fresh-next', { total: 124, documentVersion: 125 });
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.loadMore());
    expect(result.current.requiresReload).toBe(true);
    expect(result.current.error).toContain('HISTORY_REFRESH_REQUIRED');
    await act(() => result.current.reload());
    expect(result.current.items.map((item) => item.seq)).toEqual([124]);
    expect(result.current.documentVersion).toBe(125);
    expect(result.current.requiresReload).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it('guards a repeated cursor and exposes the retained rows as stale until reload', async () => {
    const fetch = mockFetch(() => page([123], 'same'));
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(() => result.current.loadMore());
    expect(result.current.error).toContain('重复游标');
    expect(result.current.requiresReload).toBe(true);
    expect(result.current.items).toHaveLength(1);
    await act(() => result.current.loadMore());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404])(
    'clears history and exact metadata caches on a continuation HTTP %s',
    async (status) => {
      const fetch = mockFetch((url) => {
        if (url.endsWith('/metadata')) return { status: 200, body: envelope(revision(2)) };
        return new URL(url, 'http://localhost').searchParams.has('cursor')
          ? rejected(status, 'HISTORY_ACCESS_LOST')
          : page([123], 'next');
      });
      const { result } = renderHook(() => useDocumentHistory('d1'));
      await waitFor(() => expect(result.current.items).toHaveLength(1));
      await act(async () => {
        await result.current.resolveRevision('d1-r2');
      });
      await act(() => result.current.loadMore());
      expect(result.current.accessDenied).toBe(true);
      expect(result.current.items).toEqual([]);
      expect(result.current.total).toBeNull();
      expect(result.current.metadataById.size).toBe(0);
      expect(result.current.error).toContain('HISTORY_ACCESS_LOST');
      await act(async () => {
        expect(await result.current.resolveRevision('d1-r2')).toBeNull();
      });
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );

  it('does not replace an unreadable exact target with a loaded revision or a full GET', async () => {
    const fetch = mockFetch((url) =>
      url.endsWith('/metadata') ? rejected(404, 'EXACT_NOT_VISIBLE') : page([123], 'next'),
    );
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      expect(await result.current.resolveRevision('d1-r2')).toBeNull();
    });
    expect(result.current.metadataError).toContain('EXACT_NOT_VISIBLE');
    expect(result.current.accessDenied).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps an ordinary exact-target failure visible without deleting readable history', async () => {
    mockFetch((url) =>
      url.endsWith('/metadata') ? rejected(503, 'METADATA_UNAVAILABLE') : page([123], 'next'),
    );
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      expect(await result.current.resolveRevision('d1-r7')).toBeNull();
    });
    expect(result.current.metadataError).toContain('METADATA_UNAVAILABLE');
    expect(result.current.metadataById.size).toBe(0);
    expect(result.current.items).toHaveLength(1);
    expect(result.current.accessDenied).toBe(false);
  });

  it('ignores delayed history from an older document and aborts it at the scope boundary', async () => {
    const late = deferred<StubReply>();
    let oldSignal: AbortSignal | null | undefined;
    const fetch = mockFetch((url, init) => {
      if (url.includes('/d1/')) {
        oldSignal = init.signal;
        return late.promise;
      }
      return page([7], null, { total: 1, documentId: 'd2' });
    });
    const { result, rerender } = renderHook(
      ({ document }) => useDocumentHistory(document, { scopeKey: 'p1' }),
      { initialProps: { document: 'd1' } },
    );
    rerender({ document: 'd2' });
    await waitFor(() => expect(result.current.items[0]?.documentId).toBe('d2'));
    expect(oldSignal?.aborted).toBe(true);
    await act(async () => {
      late.resolve(page([123], 'old-next'));
    });
    expect(result.current.items[0]?.documentId).toBe('d2');
    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('ignores a delayed old-project metadata denial after the new project is readable', async () => {
    const late = deferred<StubReply>();
    mockFetch((url) => (url.endsWith('/metadata') ? late.promise : page([123], 'next')));
    const { result, rerender } = renderHook(
      ({ project }) => useDocumentHistory('d1', { scopeKey: project }),
      { initialProps: { project: 'p1' } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let resolving!: Promise<RevisionView | null>;
    act(() => {
      resolving = result.current.resolveRevision('d1-r2');
    });
    rerender({ project: 'p2' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      late.resolve(rejected(403, 'OLD_PROJECT_DENIED'));
      await resolving;
    });
    expect(result.current.accessDenied).toBe(false);
    expect(result.current.items[0]?.seq).toBe(123);
    expect(result.current.metadataError).toBeNull();
    expect(result.current.metadataById.size).toBe(0);
  });

  it('invalidates a comparison generation and returns null for its late metadata result', async () => {
    const late = deferred<StubReply>();
    let exactReads = 0;
    mockFetch((url) => {
      if (!url.endsWith('/metadata')) return page([123], 'next');
      return ++exactReads === 1 ? late.promise : { status: 200, body: envelope(revision(7)) };
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let old!: Promise<RevisionView | null>;
    act(() => {
      old = result.current.resolveRevision('d1-r2');
    });
    act(() => {
      result.current.invalidateResolutions();
    });
    await act(async () => {
      await result.current.resolveRevision('d1-r7');
    });
    await act(async () => {
      late.resolve({ status: 200, body: envelope(revision(2)) });
      await expect(old).resolves.toBeNull();
    });
    expect([...result.current.metadataById.keys()]).toEqual(['d1-r7']);
    expect(result.current.items).toHaveLength(1);
  });

  it('retains readable rows as stale after a reload failure and invalidates old continuation/metadata', async () => {
    let initialReads = 0;
    mockFetch((url) => {
      if (url.endsWith('/metadata')) return { status: 200, body: envelope(revision(2)) };
      return ++initialReads === 1 ? page([123], 'next') : rejected(503, 'RELOAD_FAILED');
    });
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.resolveRevision('d1-r2');
    });
    await act(() => result.current.reload());
    expect(result.current.items[0]?.seq).toBe(123);
    expect(result.current.total).toBe(123);
    expect(result.current.stale).toBe(true);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.metadataById.size).toBe(0);
    expect(result.current.error).toContain('RELOAD_FAILED');
  });

  it('ignores a delayed pre-refresh history response and its continuation', async () => {
    const late = deferred<StubReply>();
    let reads = 0;
    const fetch = mockFetch(() =>
      ++reads === 1 ? late.promise : page([124], null, { total: 124, documentVersion: 125 }),
    );
    const { result } = renderHook(() => useDocumentHistory('d1'));
    await act(() => result.current.reload());
    expect(result.current.items[0]?.seq).toBe(124);
    await act(async () => {
      late.resolve(page([123], 'obsolete-next'));
    });
    expect(result.current.items[0]?.seq).toBe(124);
    expect(result.current.documentVersion).toBe(125);
    expect(result.current.hasMore).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
