import { formatApiError } from '../api/client';
import { requirementApi, type RequirementView } from '../api/resources';

/** 与流水线一致的服务端分页安全上限（列表接口每页固定 50）。 */
export const MAX_REQUIREMENT_INDEX_PAGES = 40;

export interface RequirementIndexResult {
  byId: Map<string, RequirementView>;
  /** false 时页面必须说明“关联需求索引可能不完整”，不能把缺失标签当成未绑定。 */
  complete: boolean;
  error: string;
  pages: number;
}

/**
 * 搜索用的需求索引必须覆盖所有游标分页，而不是只读第一页。
 * 失败时返回已加载的部分结果与可读错误，页面保留已有文档/搜索并明确提示索引不可信。
 */
export async function loadRequirementIndex(projectId: string): Promise<RequirementIndexResult> {
  const byId = new Map<string, RequirementView>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= MAX_REQUIREMENT_INDEX_PAGES; page += 1) {
    try {
      const result = await requirementApi.list(projectId, cursor);
      for (const item of result.items) byId.set(item.id, item);
      const next = result.nextCursor ?? undefined;
      if (!next) return { byId, complete: true, error: '', pages: page };
      if (requestedCursors.has(next)) {
        return {
          byId,
          complete: false,
          error: `关联需求索引读取中断：服务端游标重复（已读取 ${page} 页），需求编号/标题可能不完整。`,
          pages: page,
        };
      }
      requestedCursors.add(next);
      cursor = next;
    } catch (caught: unknown) {
      return {
        byId,
        complete: false,
        error: `关联需求索引读取失败：${formatApiError(caught)}；已加载 ${byId.size} 条，需求编号/标题搜索可能不完整。`,
        pages: page,
      };
    }
  }

  return {
    byId,
    complete: false,
    error: `关联需求索引超过 ${MAX_REQUIREMENT_INDEX_PAGES} 页安全上限，可能未完整加载；已加载 ${byId.size} 条。`,
    pages: MAX_REQUIREMENT_INDEX_PAGES,
  };
}
