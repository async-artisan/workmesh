import { describe, expect, it } from 'vitest';
import {
  decodeRequirementCursor,
  encodeRequirementCursor,
  literalRequirementSearch,
  normalizeRequirementQuery,
} from './requirements.pagination';

describe('requirement list query and cursor', () => {
  it('normalizes global filters and bounds page size', () => {
    expect(
      normalizeRequirementQuery({ q: '  CHECKOUT  ', phase: ' delivery ', limit: 500 }),
    ).toEqual({
      q: 'checkout',
      phase: 'DELIVERY',
      limit: 100,
      cursor: null,
    });
    for (const query of [
      { limit: 0 },
      { limit: 1.5 },
      { q: 'x'.repeat(501) },
      { phase: 'x'.repeat(33) },
      { cursor: 'x'.repeat(2049) },
    ]) {
      expect(() => normalizeRequirementQuery(query)).toThrow('REQUIREMENT_QUERY_INVALID');
    }
  });

  it('binds generated cursors to project and normalized filters', () => {
    const query = normalizeRequirementQuery({ q: '需求', phase: 'DELIVERY' });
    const cursor = encodeRequirementCursor('p1', query, 80);
    expect(decodeRequirementCursor('p1', { ...query, cursor })).toBe(80);
    expect(() => decodeRequirementCursor('p2', { ...query, cursor })).toThrow(
      'REQUIREMENT_CURSOR_INVALID',
    );
    expect(() => decodeRequirementCursor('p1', { ...query, cursor, q: '别的需求' })).toThrow(
      'REQUIREMENT_CURSOR_INVALID',
    );
    expect(() => decodeRequirementCursor('p1', { ...query, cursor, phase: 'DISCOVERY' })).toThrow(
      'REQUIREMENT_CURSOR_INVALID',
    );
  });

  it('rejects malformed positions and only permits legacy numeric cursors on unfiltered lists', () => {
    for (const cursor of ['0', '-1', '1e2', '0x10', '%%%', '9007199254740992']) {
      expect(() => decodeRequirementCursor('p1', normalizeRequirementQuery({ cursor }))).toThrow(
        'REQUIREMENT_CURSOR_INVALID',
      );
    }
    expect(decodeRequirementCursor('p1', normalizeRequirementQuery({ cursor: '50' }))).toBe(50);
    expect(() =>
      decodeRequirementCursor('p1', normalizeRequirementQuery({ cursor: '50', q: 'hello' })),
    ).toThrow('REQUIREMENT_CURSOR_INVALID');
    expect(() =>
      decodeRequirementCursor(
        'p1',
        normalizeRequirementQuery({
          cursor: encodeRequirementCursor('p1', normalizeRequirementQuery({}), 0),
        }),
      ),
    ).toThrow('REQUIREMENT_CURSOR_INVALID');
  });

  it('treats percent, underscore and backslash as literal search text', () => {
    expect(literalRequirementSearch('50%_\\docs')).toBe('50\\%\\_\\\\docs');
  });
});
