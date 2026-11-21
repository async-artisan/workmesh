import { describe, expect, it } from 'vitest';
import { documentCatalogApi } from './documentCatalog';
import { envelope, mockFetch } from '../test-utils';

describe('documentCatalogApi', () => {
  it('sends all server filters and cursor without trimming or replacing the search term', async () => {
    const controller = new AbortController();
    const fetch = mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/projects/project%2F1/document-summaries');
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        limit: '50',
        status: 'candidate',
        kind: 'PRD',
        knowledgeBaseKind: 'BUSINESS',
        requirementId: 'requirement/1',
        q: ' older %_ title ',
        searchProfile: 'prd',
        cursor: 'next+/=',
      });
      expect(init.signal).toBe(controller.signal);
      return { status: 200, body: envelope({ items: [], nextCursor: null, total: 107 }) };
    });

    await expect(
      documentCatalogApi.list(
        'project/1',
        {
          kind: 'PRD',
          knowledgeBaseKind: 'BUSINESS',
          requirementId: 'requirement/1',
          status: 'candidate',
          q: ' older %_ title ',
          searchProfile: 'prd',
        },
        'next+/=',
        controller.signal,
      ),
    ).resolves.toMatchObject({ total: 107 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('explicitly rejects more than 100 search characters without issuing a truncated query', async () => {
    const fetch = mockFetch(() => undefined);
    await expect(documentCatalogApi.list('project', { q: 'a'.repeat(101) })).rejects.toMatchObject({
      status: 422,
      code: 'INVALID_REQUEST',
      message: expect.stringContaining('100'),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses separate exact summary and overview endpoints and forwards both signals', async () => {
    const controller = new AbortController();
    const fetch = mockFetch((url, init) => {
      expect(init.signal).toBe(controller.signal);
      if (url === '/api/v1/documents/document%2F1/summary') {
        return { status: 200, body: envelope({ document: { id: 'document/1' } }) };
      }
      if (url === '/api/v1/projects/project%2F1/document-summary-overview') {
        return { status: 200, body: envelope({ total: 107, collections: [] }) };
      }
      return undefined;
    });

    await expect(
      documentCatalogApi.summary('document/1', controller.signal),
    ).resolves.toMatchObject({
      document: { id: 'document/1' },
    });
    await expect(
      documentCatalogApi.overview('project/1', controller.signal),
    ).resolves.toMatchObject({
      total: 107,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps exact summary permission failures visible and performs no fallback request', async () => {
    const fetch = mockFetch(() => ({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'NO_ACCESS', requestId: 'req-denied' } },
    }));
    await expect(documentCatalogApi.summary('document')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      requestId: 'req-denied',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
