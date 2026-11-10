import {
  CHANGE_TASK_ACTION_LABELS,
  CHANGE_TASK_REASON_LABELS,
  type ChangeTaskGuidance,
} from '@workmesh/shared';

/** Render server-derived guidance only; never executes its recovery commands. */
export function renderChangeGuidance(value: unknown): string[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { tasks?: unknown }).tasks))
    return ['平台未提供任务级诊断，请在 Web 核对关联需求。'];
  const guidance = value as { eventBaseline?: string; scope?: string; tasks: unknown[] };
  const lines: string[] = [];
  if (guidance.eventBaseline === 'SUPERSEDED')
    lines.push('通知基线已有后续更新；按当前任务状态核对。');
  if (guidance.scope === 'CURRENT_ACCEPTANCE_SCOPE')
    lines.push('任务按当前验收范围匹配；不是原事件的失效任务记录。');
  for (const value of guidance.tasks) {
    if (!value || typeof value !== 'object') continue;
    const task = value as Partial<ChangeTaskGuidance>;
    lines.push(
      `  ${task.taskCode ?? task.taskId ?? '任务'} · ${task.role?.title ?? ''} · ${task.relation === 'RESPONSIBLE' ? '由你负责' : '当前角色相关'}`,
    );
    lines.push(
      `  ${task.reason && Object.hasOwn(CHANGE_TASK_REASON_LABELS, task.reason) ? CHANGE_TASK_REASON_LABELS[task.reason] : '需核对当前状态'}`,
    );
    lines.push(
      `  ${task.action && Object.hasOwn(CHANGE_TASK_ACTION_LABELS, task.action) ? CHANGE_TASK_ACTION_LABELS[task.action] : '打开任务核对下一步'}`,
    );
    if (task.inspectCommand) lines.push(`  ${task.inspectCommand}`);
    if (task.href) lines.push(`  Web 任务入口：${task.href}`);
  }
  if (!guidance.tasks.length) lines.push('未匹配到你当前负责或当前角色相关的任务，仍需核对通知。');
  return lines;
}
