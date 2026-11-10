const FIELD_LABELS: Record<string, string> = {
  title: '需求标题',
  description: '需求描述',
  acceptance: '验收条件',
  status: '状态',
  phase: '需求阶段',
  currentPrdRevisionId: '产品需求基线',
  currentUnderstandingRevisionId: '需求理解基线',
  deliveryScope: '交付范围',
  generation: '需求工作版本',
};

export function changeFieldLabel(field: string): string {
  if (Object.hasOwn(FIELD_LABELS, field)) return FIELD_LABELS[field];
  if (field.startsWith('acceptance:')) return `验收条件 ${field.slice('acceptance:'.length)}`;
  if (field.startsWith('level:')) return `变更级别 ${field.slice('level:'.length)}`;
  return /[㐀-鿿]/u.test(field) ? field : '其他字段（详见技术详情）';
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((item): item is string => typeof item === 'string' && !!item.trim()),
        ),
      ]
    : [];
}

export function changeImpactSummary(targets: unknown, changedFields: readonly string[]) {
  const target = recordOf(targets);
  const taskIds = textList(target.taskIds);
  const acceptanceKeys = textList(target.acceptanceKeys);
  const hasDocument = typeof target.documentId === 'string' && !!target.documentId;
  const hasCurrentRevision =
    typeof target.documentRevisionId === 'string' && !!target.documentRevisionId;
  const hasPreviousRevision =
    typeof target.previousDocumentRevisionId === 'string' && !!target.previousDocumentRevisionId;
  const baselineChanged = changedFields.some((field) =>
    ['currentPrdRevisionId', 'currentUnderstandingRevisionId', 'generation'].includes(field),
  );
  const rows: Array<{ label: string; value: string }> = [];

  if (hasCurrentRevision) {
    rows.push({
      label: '文档更新',
      value: hasPreviousRevision ? '新的发布修订已替换原修订' : '已有新的发布修订',
    });
  } else if (hasDocument) {
    rows.push({ label: '关联文档', value: '本次变更关联一份文档' });
  }
  if (taskIds.length) rows.push({ label: '受影响任务', value: `${taskIds.length} 项` });
  if (acceptanceKeys.length)
    rows.push({ label: '受影响验收条件', value: acceptanceKeys.join('、') });
  if (
    Number.isSafeInteger(target.requirementGeneration) &&
    Number(target.requirementGeneration) > 0
  )
    rows.push({ label: '需求工作版本', value: `第 ${target.requirementGeneration} 代` });
  if (typeof target.changeRequestId === 'string' && target.changeRequestId)
    rows.push({ label: '变更来源', value: '已接受的变更请求' });

  // 部署方记录的人类可读摘要可以直接展示；未识别的技术结构保留在详情中。
  for (const [label, value] of Object.entries(target)) {
    if (!/[㐀-鿿]/u.test(label)) continue;
    if (typeof value === 'string' || typeof value === 'number')
      rows.push({ label, value: String(value) });
    else {
      const values = textList(value);
      if (values.length) rows.push({ label, value: values.join('、') });
    }
  }

  return { rows, taskIds, hasDocument, baselineChanged };
}
