/**
 * 最近活动"已读时间"：只记住用户最后一次点「全部标为已读」的时间点。
 * 通知的已读状态属于个人偏好的本地记忆，不写服务端、不进 localStorage 之外的存储。
 */
const KEY = 'workmesh.activity.lastSeenAt';

export function readActivityLastSeenAt(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return 0;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

export function markActivitySeen(now = Date.now()): number {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // 隐私模式等场景不可写：已读状态只在本次会话内生效。
  }
  return now;
}

/** 统计 createdAt 晚于最后已读时间的活动条数。 */
export function countUnreadActivity(
  items: Array<{ createdAt: string }>,
  lastSeenAt: number,
): number {
  if (items.length === 0) return 0;
  return items.filter((item) => {
    const at = new Date(item.createdAt).getTime();
    return Number.isFinite(at) && at > lastSeenAt;
  }).length;
}
