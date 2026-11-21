import { describe, expect, it } from 'vitest';
import type { DocumentSummary } from '../api/documentSummaries';
import { envelope, methodOf, mockFetch } from '../test-utils';
import {
  loadPublishedDocumentSummaryIndex,
  MAX_DOCUMENT_SUMMARY_PAGES,
} from './documentSummaryIndex';

function summary(id: string, title = id): DocumentSummary {
  const published = {
    id: `published-${id}`,
    documentId: id,
    seq: 1,
    title,
    digest: 'a'.repeat(64),
    state: 'PUBLISHED' as const,
  };
  return {
    document: {
      id,
      projectId: 'p1',
      knowledgeBaseId: 'kb1',
      requirementId: null,
      kind: 'KNOWLEDGE',
      version: 201,
      currentPublishedRevisionId: published.id,
      archivedAt: null,
    },
    updatedAt: '2026-11-10T00:00:00Z',
    knowledgeBase: { id: 'kb1', name: '项目知识', kind: 'BUSINESS' },
    requirement: null,
    latestVisibleRevision: { ...published, id: `candidate-${id}`, seq: 201, state: 'CANDIDATE' },
    publishedRevision: published,
    visibleRevisionCount: 201,
    candidateRevisionCount: 200,
  };
}

describe('已发布资料概要索引', () => {
  it('固定 published/50 翻页，按文档 ID 去重且不读取修订历史', async () => {
    const mock = mockFetch((url, init) => {
      expect(methodOf(init)).toBe('GET');
      const parsed = new URL(url, 'http://localhost');
      expect(parsed.pathname).toBe('/api/v1/projects/p1/document-summaries');
      expect(parsed.searchParams.get('status')).toBe('published');
      expect(parsed.searchParams.get('limit')).toBe('50');
      return parsed.searchParams.has('cursor')
        ? {
            status: 200,
            body: envelope({
              items: [summary('d1', '更新后的概要'), summary('d2')],
              total: 2,
              nextCursor: null,
            }),
          }
        : {
            status: 200,
            body: envelope({ items: [summary('d1')], total: 2, nextCursor: 'next+/=' }),
          };
    });

    const result = await loadPublishedDocumentSummaryIndex('p1');

    expect(result).toMatchObject({ complete: true, error: '', pages: 2, reason: null, total: 2 });
    expect(result.items.map((item) => item.document.id)).toEqual(['d1', 'd2']);
    expect(result.items[0]!.publishedRevision!.title).toBe('更新后的概要');
    expect(mock.mock.calls.map(([url]) => String(url))).toEqual([
      '/api/v1/projects/p1/document-summaries?status=published&limit=50',
      '/api/v1/projects/p1/document-summaries?status=published&limit=50&cursor=next%2B%2F%3D',
    ]);
  });

  it('完整空列表与读取失败明确区分，项目 ID 不进入路径结构', async () => {
    const mock = mockFetch(() => ({
      status: 200,
      body: envelope({ items: [], total: 0, nextCursor: null }),
    }));

    expect(await loadPublishedDocumentSummaryIndex('p/1')).toEqual({
      items: [],
      complete: true,
      error: '',
      pages: 1,
      reason: null,
      total: 0,
    });
    expect(mock.mock.calls[0]![0]).toBe(
      '/api/v1/projects/p%2F1/document-summaries?status=published&limit=50',
    );
  });

  it('重复游标终止后保留已读数据，不能声称完整', async () => {
    let reads = 0;
    const mock = mockFetch(() => {
      reads += 1;
      return {
        status: 200,
        body: envelope({ items: [summary(`d${reads}`)], total: 10, nextCursor: 'loop' }),
      };
    });

    const result = await loadPublishedDocumentSummaryIndex('p1');

    expect(result).toMatchObject({
      complete: false,
      pages: 2,
      reason: 'repeated-cursor',
      total: 10,
    });
    expect(result.items).toHaveLength(2);
    expect(result.error).toContain('游标重复');
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('40 页仍有游标时停止且保留全部已读概要', async () => {
    let reads = 0;
    const mock = mockFetch(() => {
      reads += 1;
      return {
        status: 200,
        body: envelope({ items: [summary(`d${reads}`)], total: 2001, nextCursor: `next-${reads}` }),
      };
    });

    const result = await loadPublishedDocumentSummaryIndex('p1');

    expect(result).toMatchObject({ complete: false, pages: 40, reason: 'page-limit', total: 2001 });
    expect(result.error).toContain('40 页安全上限');
    expect(result.items).toHaveLength(40);
    expect(mock).toHaveBeenCalledTimes(MAX_DOCUMENT_SUMMARY_PAGES);
  });

  it.each([403, 409, 503])(
    '后续页 %s 失败保留部分数据及错误 code/message/requestId',
    async (status) => {
      let reads = 0;
      mockFetch(() => {
        reads += 1;
        return reads === 1
          ? {
              status: 200,
              body: envelope({ items: [summary('d1')], total: 3, nextCursor: 'next' }),
            }
          : {
              status,
              body: {
                error: {
                  code: 'READ_REJECTED',
                  message: '资料请求被拒绝',
                  requestId: 'request-evidence',
                },
              },
            };
      });

      const result = await loadPublishedDocumentSummaryIndex('p1');

      expect(result).toMatchObject({ complete: false, pages: 2, reason: null, total: 3 });
      expect(result.items.map((item) => item.document.id)).toEqual(['d1']);
      expect(result.error).toContain('[READ_REJECTED] 资料请求被拒绝 · requestId request-evidence');
      expect(result.error).toContain('列表未完整加载');
    },
  );

  it('首次请求失败不伪装成完整空列表', async () => {
    mockFetch(() => ({
      status: 503,
      body: { error: { code: 'UNAVAILABLE', message: '稍后重试' } },
    }));

    expect(await loadPublishedDocumentSummaryIndex('p1')).toMatchObject({
      items: [],
      complete: false,
      pages: 1,
      reason: null,
      total: null,
      error: expect.stringContaining('[UNAVAILABLE] 稍后重试'),
    });
  });

  it('旧范围的迟到首页带有游标时停止读取后续页', async () => {
    let resolvePage!: (value: { status: number; body: unknown }) => void;
    const page = new Promise<{ status: number; body: unknown }>((resolve) => {
      resolvePage = resolve;
    });
    const mock = mockFetch(() => page);
    let current = true;
    const reading = loadPublishedDocumentSummaryIndex('p1', () => current);
    current = false;
    resolvePage({
      status: 200,
      body: envelope({ items: [summary('old')], total: 2001, nextCursor: 'never-read' }),
    });

    const result = await reading;

    expect(mock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ items: [], complete: false, total: null });
    expect(result.error).toContain('已停止旧列表读取');
  });
});
