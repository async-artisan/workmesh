import type { KnowledgePermission, KnowledgeVisibility, ProjectManagementRole } from '../auth/v1-authorization';

/** v1 知识 ACL 只接受这四个权限；大小写与顺序严格按字面值。 */
export const KNOWLEDGE_GRANT_PERMISSIONS: readonly KnowledgePermission[] = ['READ', 'PROPOSE', 'PUBLISH', 'REVOKE'];

export const KNOWLEDGE_VISIBILITIES: readonly KnowledgeVisibility[] = ['PROJECT', 'RESTRICTED'];

export function isProjectManager(role: ProjectManagementRole): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

/** 用 fatal 解码判断正文是否真的是 UTF-8；非法字节返回 null，按“正文不匹配”处理。 */
export function decodeUtf8Text(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 80);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * 搜索命中：标题与 UTF-8 正文都做不区分大小写的字面包含匹配。
 * 正文非法 UTF-8 时不参与匹配；标题命中仍返回结果，并以标题作为摘要。
 */
export function searchExcerptOf(title: string, bodyBytes: Uint8Array, q: string): string | null {
  const needle = q.toLowerCase();
  const titleMatches = title.toLowerCase().includes(needle);
  const body = decodeUtf8Text(bodyBytes);
  const bodyIndex = body === null ? -1 : body.toLowerCase().indexOf(needle);

  if (bodyIndex >= 0 && body !== null) return excerptAround(body, bodyIndex, q.length);
  if (!titleMatches) return null;
  if (body === null || body.length === 0) return title;
  return excerptAround(body, 0, 0);
}
