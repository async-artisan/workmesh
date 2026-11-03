/**
 * 变更传播的收件人规则。
 *
 * 这里只回答“谁受影响”，不负责写库，便于单独测试：
 * - 受影响的是该需求下所有**未取消**流程实例的任务责任人；
 * - 同一人可能身兼多个角色，按 (userId, roleId) 去重；
 * - 发起变更的人自己不需要收通知；
 * - 结果按 userId → roleId 排序，保证同一输入产生确定的事件内容。
 */
export type TaskOwner = { taskId: string; userId: string; roleId: string };
export type ChangeRecipientInput = { userId: string; roleId: string };

export function affectedRecipients(
  tasks: readonly TaskOwner[],
  actorUserId: string,
): ChangeRecipientInput[] {
  const seen = new Set<string>();
  const recipients: ChangeRecipientInput[] = [];
  for (const task of tasks) {
    if (!task.userId || task.userId === actorUserId) continue;
    const key = `${task.userId}:${task.roleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ userId: task.userId, roleId: task.roleId });
  }
  return recipients.sort(
    (left, right) =>
      left.userId.localeCompare(right.userId) || left.roleId.localeCompare(right.roleId),
  );
}

/** 需求字段变化 → 变更事件里的 changedFields；忽略空变更，保持固定顺序。 */
export function changedFieldsOf(dto: { title?: string; description?: string }): string[] {
  const fields: string[] = [];
  if (dto.title !== undefined) fields.push('title');
  if (dto.description !== undefined) fields.push('description');
  return fields;
}
