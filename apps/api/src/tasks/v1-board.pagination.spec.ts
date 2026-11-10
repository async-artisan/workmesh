import { describe, expect, it } from 'vitest';
import {
  boardQueryKey,
  boardSearchPattern,
  decodeBoardCursor,
  encodeBoardCursor,
  normalizeBoardQuery,
} from './v1-board.pagination';

const query = normalizeBoardQuery({ q: ' TEST ', roleTitle: '研发', requirementCode: 'AA-001' });
const id = '00000000-0000-0000-0000-000000000001';
describe('Board value cursors and literal search', () => {
  it('round trips each view and allows a different page size', () => {
    for (const [view, after] of [
      ['column:BACKLOG', { generation: 3, id }],
      ['requirements', { score: 40, code: 'AA-001' }],
      ['filters:roles', { value: '研发' }],
    ] as const) {
      const cursor = encodeBoardCursor('p1', query, view, after);
      expect(decodeBoardCursor('p1', { ...query, limit: 99, cursor }, view)).toEqual(after);
    }
  });
  it('normalizes the same query to the same key without binding the page limit', () => {
    expect(boardQueryKey('p1', query)).toBe(boardQueryKey('p1', { ...query, limit: 99 }));
    expect(boardQueryKey('p1', query)).not.toBe(boardQueryKey('p2', query));
  });
  it.each([
    'garbage',
    '***',
    'a'.repeat(2049),
    Buffer.from('[]').toString('base64url'),
    Buffer.from('{}').toString('base64url'),
  ])('rejects malformed cursor %s', (cursor) => {
    expect(() => decodeBoardCursor('p1', { ...query, cursor }, 'column:BACKLOG')).toThrow();
  });
  it('validates cursor tuple shapes and binds facet search and kind', () => {
    for (const after of [
      { generation: -1, id },
      { generation: 1, id: 'not-uuid' },
      { generation: 0.5, id },
      { generation: 1 },
    ]) {
      const cursor = Buffer.from(
        JSON.stringify({ v: 1, key: boardQueryKey('p1', query, 'column:BACKLOG'), after }),
      ).toString('base64url');
      expect(() => decodeBoardCursor('p1', { ...query, cursor }, 'column:BACKLOG')).toThrow();
    }
    const cursor = encodeBoardCursor('p1', query, 'filters:roles', { value: '研发' });
    expect(() =>
      decodeBoardCursor('p1', { ...query, search: 'other', cursor }, 'filters:roles'),
    ).toThrow();
    expect(() => decodeBoardCursor('p1', { ...query, cursor }, 'filters:requirements')).toThrow();
  });
  it('keeps SQL wildcards and backslash literal', () => {
    expect(boardSearchPattern('50%_\\')).toBe('%50\\%\\_\\\\%');
    expect(boardSearchPattern('plain')).toBe('%plain%');
  });
  it.each([
    { limit: 0 },
    { limit: NaN },
    { q: 'x'.repeat(501) },
    { roleTitle: 'x'.repeat(81) },
    { requirementCode: 'x'.repeat(33) },
    { search: 'x'.repeat(201) },
    { cursor: 'x'.repeat(2049) },
  ])('validates query bounds %j', (input) => {
    expect(() => normalizeBoardQuery(input)).toThrow();
  });
});
