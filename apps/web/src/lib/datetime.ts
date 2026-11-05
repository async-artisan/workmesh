/**
 * 全站时间格式统一为 `YYYY-MM-DD HH:mm`（本地时区）。
 * 只用于人类可读展示；接口/日志仍传 ISO 字符串。
 */
function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatClock(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
