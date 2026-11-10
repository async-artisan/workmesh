import {
  TASK_INPUT_KIND_LABELS,
  TASK_INPUT_REASON_LABELS,
  TASK_INPUT_ACTION_LABELS,
  TASK_INPUT_OWNER_LABELS,
  type TaskInputStatusView,
} from '@workmesh/shared';

export function renderInputStatus(status: TaskInputStatusView): string {
  const lines = [`任务 ${status.taskId} · v${status.taskVersion} · ${status.availability}`];
  for (const issue of status.issues ?? []) {
    const refs = [
      issue.inputKey && `输入 ${issue.inputKey}`,
      issue.documentId && `文档 ${issue.documentId}`,
      issue.revisionId && `修订 ${issue.revisionId}`,
      issue.fromStepKey && `上游 ${issue.fromStepKey} / ${issue.artifactKind}`,
      issue.refId && `引用 ${issue.refId}`,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(
      `${TASK_INPUT_KIND_LABELS[issue.kind]}：${TASK_INPUT_REASON_LABELS[issue.reason]}${refs ? `（${refs}）` : ''}`,
      `${TASK_INPUT_OWNER_LABELS[issue.responsible]}：${TASK_INPUT_ACTION_LABELS[issue.action]}`,
    );
  }
  if (status.issuesComplete !== true)
    lines.push('平台未提供完整逐项诊断，不能认定没有其他输入问题。');
  lines.push('本次仅检查输入；未认领任务或创建快照。');
  return lines.join('\n');
}
