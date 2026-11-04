import { formatApiError } from '../api/client';
import { documentApi, type DocumentDetail, type DocumentKind } from '../api/resources';

/** 文档列表同样按游标分页；搜索不能只停留在第一页。 */
export const MAX_DOCUMENT_PAGES = 40;

export type DocumentPaginationReason = 'page-limit' | 'repeated-cursor';

export interface DocumentIndexResult {
  items: DocumentDetail[];
  /** false 表示失败、页上限或游标重复；页面不得声称已加载完整文档库。 */
  complete: boolean;
  error: string;
  pages: number;
  reason: DocumentPaginationReason | null;
}

/**
 * 聚合所有文档分页，按 document.id 去重。
 * 失败时保留已读取文档并返回可读错误；达到页上限/游标重复时返回不完整原因。
 */
export async function loadDocumentIndex(
  projectId: string,
  kind?: DocumentKind,
): Promise<DocumentIndexResult> {
  const byId = new Map<string, DocumentDetail>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= MAX_DOCUMENT_PAGES; page += 1) {
    try {
      const result = await documentApi.list(projectId, kind, cursor);
      for (const item of result.items) byId.set(item.document.id, item);
      const next = result.nextCursor ?? undefined;
      if (!next) {
        return { items: [...byId.values()], complete: true, error: '', pages: page, reason: null };
      }
      if (requestedCursors.has(next)) {
        return {
          items: [...byId.values()],
          complete: false,
          error: `文档列表可能未完整加载：服务端游标重复（已读取 ${page} 页），当前已保留 ${byId.size} 个文档。`,
          pages: page,
          reason: 'repeated-cursor',
        };
      }
      requestedCursors.add(next);

      if (page === MAX_DOCUMENT_PAGES) {
        return {
          items: [...byId.values()],
          complete: false,
          error: `文档列表可能未完整加载：已读取前 ${page} 页，服务端没有返回总数；当前已保留 ${byId.size} 个文档。`,
          pages: page,
          reason: 'page-limit',
        };
      }
      cursor = next;
    } catch (caught: unknown) {
      return {
        items: [...byId.values()],
        complete: false,
        error: `文档列表读取失败：${formatApiError(caught)}；本次读取到 ${byId.size} 个文档。`,
        pages: page,
        reason: null,
      };
    }
  }

  return {
    items: [...byId.values()],
    complete: false,
    error: `文档列表可能未完整加载：超过 ${MAX_DOCUMENT_PAGES} 页安全上限，当前已保留 ${byId.size} 个文档。`,
    pages: MAX_DOCUMENT_PAGES,
    reason: 'page-limit',
  };
}
