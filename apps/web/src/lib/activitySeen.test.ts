import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activitySeenStorageKey,
  countUnreadActivity,
  markActivitySeen,
  readActivitySeenIds,
} from './activitySeen';

describe('browser-local activity read state', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('marks exact events and leaves later events unread regardless of timestamp', () => {
    const seen = markActivitySeen([{ id: 'a' }], 'user-1');
    expect(countUnreadActivity([{ id: 'a' }, { id: 'b' }], seen)).toBe(1);
    expect([...readActivitySeenIds('user-1')]).toEqual(['a']);
  });

  it('isolates accounts and does not migrate an unattributable global timestamp', () => {
    localStorage.setItem('workmesh.activity.lastSeenAt', '9999999999999');
    markActivitySeen([{ id: 'a' }], 'user-1');
    expect(readActivitySeenIds('user-2').size).toBe(0);
    expect(readActivitySeenIds(null).size).toBe(0);
    expect(activitySeenStorageKey('user/1')).toContain('user%2F1');
  });

  it('merges read records from another tab and bounds browser storage', () => {
    const stale = markActivitySeen([{ id: 'a' }], 'user-1');
    markActivitySeen([{ id: 'b' }], 'user-1');
    expect([...markActivitySeen([{ id: 'c' }], 'user-1', stale)]).toEqual(['a', 'b', 'c']);
    const seen = markActivitySeen(
      Array.from({ length: 1005 }, (_, index) => ({ id: `event-${index}` })),
      'user-1',
    );
    expect(seen.size).toBe(1000);
    expect(seen.has('event-1004')).toBe(true);
  });

  it('ignores malformed storage and retains in-memory state when storage fails', () => {
    localStorage.setItem(activitySeenStorageKey('user-1'), '{broken');
    expect(readActivitySeenIds('user-1').size).toBe(0);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    expect(markActivitySeen([{ id: 'a' }], 'user-1').has('a')).toBe(true);
  });
});
