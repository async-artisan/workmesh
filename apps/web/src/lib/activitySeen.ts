/** Activity read state is local to this browser and account; no server read-state API exists. */
const MAX_SEEN = 1000;

export function activitySeenStorageKey(userId: string): string {
  return `workmesh.activity.seen.v2.${encodeURIComponent(userId)}`;
}

export function readActivitySeenIds(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(activitySeenStorageKey(userId)) ?? '[]',
    );
    return new Set(
      Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === 'string').slice(-MAX_SEEN)
        : [],
    );
  } catch {
    return new Set();
  }
}

/** Mark exactly the loaded events, including same-timestamp events; never use the client clock. */
export function markActivitySeen(
  items: Array<{ id: string }>,
  userId: string,
  previous: ReadonlySet<string> = readActivitySeenIds(userId),
): Set<string> {
  const ids = [
    ...new Set([...readActivitySeenIds(userId), ...previous, ...items.map((item) => item.id)]),
  ].slice(-MAX_SEEN);
  try {
    localStorage.setItem(activitySeenStorageKey(userId), JSON.stringify(ids));
  } catch {
    /* Read state remains valid in memory when browser storage is unavailable. */
  }
  return new Set(ids);
}

export function countUnreadActivity(
  items: Array<{ id: string }>,
  seenIds: ReadonlySet<string>,
): number {
  return items.filter((item) => !seenIds.has(item.id)).length;
}
