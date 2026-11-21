import { describe, expect, it } from 'vitest';
import { documentHistoryApi } from './documentHistory';
import { envelope, mockFetch } from '../test-utils';

describe('documentHistoryApi', () => {
  it('encodes the exact document and cursor, defaults to 50 and forwards cancellation', async () => {
    const controller = new AbortController();
    const page = { items: [], nextCursor: null, total: 123, documentVersion: 9 };
    const fetch = mockFetch((url, init) => {
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/documents/doc%2F%20%3F/history');
      expect(parsed.searchParams.get('limit')).toBe('50');
      expect(parsed.searchParams.get('cursor')).toBe('next+/=');
      expect(init.signal).toBe(controller.signal);
      return { status: 200, body: envelope(page) };
    });

    await expect(
      documentHistoryApi.list('doc/ ?', { cursor: 'next+/=' }, controller.signal),
    ).resolves.toEqual(page);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads only exact revision metadata with encoded IDs and the supplied signal', async () => {
    const controller = new AbortController();
    const fetch = mockFetch((url, init) => {
      expect(url).toBe('/api/v1/documents/doc%2F1/revisions/rev%2F%20%3F/metadata');
      expect(init.signal).toBe(controller.signal);
      return { status: 200, body: envelope({ id: 'rev/ ?', documentId: 'doc/1' }) };
    });

    await expect(
      documentHistoryApi.metadata('doc/1', 'rev/ ?', controller.signal),
    ).resolves.toMatchObject({ id: 'rev/ ?' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the history conflict rather than falling back to a full document read', async () => {
    const fetch = mockFetch(() => ({
      status: 409,
      body: {
        error: {
          code: 'RESOURCE_CONFLICT',
          message: 'HISTORY_REFRESH_REQUIRED',
          requestId: 'req-h',
        },
      },
    }));
    await expect(documentHistoryApi.list('doc')).rejects.toMatchObject({
      status: 409,
      code: 'RESOURCE_CONFLICT',
      message: 'HISTORY_REFRESH_REQUIRED',
      requestId: 'req-h',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
