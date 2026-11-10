import { createHash } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';

export type RequirementListQuery = {
  limit?: number;
  cursor?: string | null;
  q?: string;
  phase?: string;
};

export type RequirementReadQuery = {
  limit: number;
  cursor: string | null;
  q: string;
  phase: string;
};

function invalid(message = 'REQUIREMENT_CURSOR_INVALID'): never {
  throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, message, undefined, 400);
}

function text(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) invalid('REQUIREMENT_QUERY_INVALID');
  return value;
}

export function normalizeRequirementQuery(query: RequirementListQuery): RequirementReadQuery {
  const limit = query.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid('REQUIREMENT_QUERY_INVALID');
  return {
    limit: Math.min(limit, 100),
    cursor: text(query.cursor, 2048) || null,
    q: text(query.q, 500).trim().toLowerCase(),
    phase: text(query.phase, 32).trim().toUpperCase(),
  };
}

function queryKey(projectId: string, query: RequirementReadQuery): string {
  return createHash('sha256')
    .update(JSON.stringify([projectId, query.q, query.phase]))
    .digest('hex');
}

export function encodeRequirementCursor(
  projectId: string,
  query: RequirementReadQuery,
  seq: number,
): string {
  return Buffer.from(JSON.stringify({ v: 1, key: queryKey(projectId, query), seq })).toString(
    'base64url',
  );
}

export function decodeRequirementCursor(
  projectId: string,
  query: RequirementReadQuery,
): number | null {
  const raw = query.cursor;
  if (!raw) return null;
  // 旧客户端的无筛选列表曾返回纯数字游标；仅在原来的查询范围内继续兼容。
  if (!query.q && !query.phase && /^[1-9]\d*$/.test(raw)) {
    const seq = Number(raw);
    if (Number.isSafeInteger(seq)) return seq;
    invalid();
  }
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) invalid();
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    invalid();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid();
  const envelope = parsed as { v?: unknown; key?: unknown; seq?: unknown };
  if (
    envelope.v !== 1 ||
    envelope.key !== queryKey(projectId, query) ||
    !Number.isSafeInteger(envelope.seq) ||
    (envelope.seq as number) < 1
  )
    invalid();
  return envelope.seq as number;
}

/** Prisma contains 使用 LIKE；搜索词中的通配符必须作为字面文字。 */
export function literalRequirementSearch(value: string): string {
  return value.replace(/[\\%_]/g, (character) => '\\' + character);
}
