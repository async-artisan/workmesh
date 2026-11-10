import { createHash } from 'node:crypto';
import { V1_ERROR_CODES, WorkmeshError } from '@workmesh/shared';
import type { V1BoardQuery, V1BoardReadQuery } from './v1-board.repository';

export type BoardPosition =
  { generation: number; id: string } | { score: number; code: string } | { value: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(message = 'BOARD_CURSOR_INVALID'): never {
  throw new WorkmeshError(V1_ERROR_CODES.INVALID_REQUEST, message, undefined, 400);
}
function text(value: unknown, max: number): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) invalid('BOARD_QUERY_INVALID');
  return value;
}
export function normalizeBoardQuery(query: V1BoardQuery, defaultLimit = 20): V1BoardReadQuery {
  const limit = query.limit ?? defaultLimit;
  if (!Number.isSafeInteger(limit) || limit < 1) invalid('BOARD_QUERY_INVALID');
  const cursor = text(query.cursor, 2048);
  return {
    q: text(query.q, 500).trim().toLowerCase(),
    roleTitle: text(query.roleTitle, 80),
    requirementCode: text(query.requirementCode, 32),
    search: text(query.search, 200).trim().toLowerCase(),
    limit: Math.min(limit, 100),
    cursor: cursor || null,
  };
}
export function boardQueryKey(projectId: string, query: V1BoardReadQuery, view = ''): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        projectId,
        query.q,
        query.roleTitle,
        query.requirementCode,
        view,
        view.startsWith('filters:') ? query.search : '',
      ]),
    )
    .digest('hex');
}
export function encodeBoardCursor(
  projectId: string,
  query: V1BoardReadQuery,
  view: string,
  after: BoardPosition,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, key: boardQueryKey(projectId, query, view), after }),
  ).toString('base64url');
}
export function decodeBoardCursor(
  projectId: string,
  query: V1BoardReadQuery,
  view: string,
): BoardPosition | null {
  const raw = query.cursor;
  if (!raw) return null;
  if (raw.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(raw)) invalid();
  let parsed: unknown;
  try {
    const bytes = Buffer.from(raw, 'base64url');
    if (bytes.toString('base64url') !== raw) invalid();
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    invalid();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalid();
  const envelope = parsed as { v?: unknown; key?: unknown; after?: unknown };
  if (envelope.v !== 1 || envelope.key !== boardQueryKey(projectId, query, view)) invalid();
  if (!envelope.after || typeof envelope.after !== 'object' || Array.isArray(envelope.after))
    invalid();
  const after = envelope.after as Record<string, unknown>;
  if (view.startsWith('column:')) {
    if (
      !Number.isSafeInteger(after.generation) ||
      (after.generation as number) < 0 ||
      typeof after.id !== 'string' ||
      !UUID.test(after.id)
    )
      invalid();
    return { generation: after.generation as number, id: after.id };
  }
  if (view === 'requirements') {
    if (
      !Number.isSafeInteger(after.score) ||
      (after.score as number) < 0 ||
      typeof after.code !== 'string' ||
      !after.code ||
      after.code.length > 32
    )
      invalid();
    return { score: after.score as number, code: after.code };
  }
  if (
    !view.startsWith('filters:') ||
    typeof after.value !== 'string' ||
    !after.value ||
    after.value.length > 200
  )
    invalid();
  return { value: after.value };
}

/** SQL LIKE must treat user percent, underscore and backslash as literal text. */
export function boardSearchPattern(value: string): string {
  return '%' + value.replace(/[\\%_]/g, (character) => '\\' + character) + '%';
}
