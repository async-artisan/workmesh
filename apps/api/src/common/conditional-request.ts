import { createHash } from 'node:crypto';

/**
 * 条件请求（RFC 7232）的最小实现，对应 GitHub REST API 的最佳实践：
 * 客户端带 `If-None-Match`，服务端命中就回 304 且不传正文。
 *
 * 这里只做「弱校验」：响应正文按语义相等即可命中，不要求逐字节一致。
 * 弱验证器写成 `W/"<opaque>"`，比较时两侧的 `W/` 都要剥掉（RFC 7232 §2.3.2）。
 */

const OPAQUE_LENGTH = 27;

/**
 * 由响应载荷派生弱 ETag。
 *
 * 必须只对**载荷**求值，不能对最终的 `{data, meta}` 信封求值——
 * 信封里的 `requestId` 每次请求都不同，拿它算 ETag 会永远命中不了。
 */
export function etagOf(payload: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(payload) ?? 'null', 'utf8')
    .digest('base64url');
  return `W/"${digest.slice(0, OPAQUE_LENGTH)}"`;
}

/** 剥掉弱前缀，得到可比较的 opaque-tag（含引号）。 */
function opaqueOf(tag: string): string {
  const trimmed = tag.trim();
  return trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
}

/**
 * `If-None-Match` 是否命中当前 ETag。
 *
 * - 缺失或空白 → 不命中（照常返回 200）。
 * - `*` → 命中（该资源存在即命中）。
 * - 支持逗号分隔的多个候选值。
 * - 按弱比较语义：函数拒绝任何别的比较方式。
 */
export function ifNoneMatchMatches(header: string | undefined, etag: string): boolean {
  if (typeof header !== 'string') return false;
  const raw = header.trim();
  if (raw.length === 0) return false;
  if (raw === '*') return true;
  const target = opaqueOf(etag);
  return raw
    .split(',')
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0)
    .some((candidate) => (candidate === '*' ? true : opaqueOf(candidate) === target));
}
