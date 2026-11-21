import { apiRequest, formatApiError } from '../api/client';
import type { DocumentSummary } from '../api/documentSummaries';

export const MAX_DOCUMENT_SUMMARY_PAGES = 40;

interface DocumentSummaryPage {
  items: DocumentSummary[];
  nextCursor: string | null;
  total: number;
}

export interface DocumentSummaryIndexResult {
  items: DocumentSummary[];
  complete: boolean;
  error: string;
  pages: number;
  reason: 'page-limit' | 'repeated-cursor' | null;
  /** 最后成功页的服务端 total；不是跨页快照，也不是筛选后的可选知识数量。 */
  total: number | null;
}

/** 已发布资料选择器的有界概要聚合；失败保留部分结果，调用方必须展示不完整状态。 */
export async function loadPublishedDocumentSummaryIndex(
  projectId: string,
  isCurrent: () => boolean = () => true,
): Promise<DocumentSummaryIndexResult> {
  const byId = new Map<string, DocumentSummary>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let total: number | null = null;

  for (let page = 1; page <= MAX_DOCUMENT_SUMMARY_PAGES; page += 1) {
    try {
      if (!isCurrent()) throw new Error('资料读取范围已变化，已停止旧列表读取。');
      const query = new URLSearchParams({ status: 'published', limit: '50' });
      if (cursor) query.set('cursor', cursor);
      const result = await apiRequest<DocumentSummaryPage>(
        `/projects/${encodeURIComponent(projectId)}/document-summaries?${query.toString()}`,
      );
      if (!isCurrent()) throw new Error('资料读取范围已变化，已停止旧列表读取。');
      for (const item of result.items) byId.set(item.document.id, item);
      total = result.total;
      const next = result.nextCursor;
      if (!next)
        return {
          items: [...byId.values()],
          complete: true,
          error: '',
          pages: page,
          reason: null,
          total,
        };
      if (seenCursors.has(next))
        return {
          items: [...byId.values()],
          complete: false,
          error: `资料列表未完整加载：服务端游标重复（已读取 ${page} 页），当前已保留 ${byId.size} 个文档。`,
          pages: page,
          reason: 'repeated-cursor',
          total,
        };
      seenCursors.add(next);
      if (page === MAX_DOCUMENT_SUMMARY_PAGES)
        return {
          items: [...byId.values()],
          complete: false,
          error: `资料列表未完整加载：已达到 ${page} 页安全上限，当前已保留 ${byId.size} 个文档；可重试资料列表或手动填写文档标识。`,
          pages: page,
          reason: 'page-limit',
          total,
        };
      cursor = next;
    } catch (caught: unknown) {
      return {
        items: [...byId.values()],
        complete: false,
        error: `资料列表读取失败：${formatApiError(caught)}；本次读取到 ${byId.size} 个文档，列表未完整加载。`,
        pages: page,
        reason: null,
        total,
      };
    }
  }

  return {
    items: [...byId.values()],
    complete: false,
    error: `资料列表未完整加载：达到 ${MAX_DOCUMENT_SUMMARY_PAGES} 页安全上限，当前已保留 ${byId.size} 个文档。`,
    pages: MAX_DOCUMENT_SUMMARY_PAGES,
    reason: 'page-limit',
    total,
  };
}
