import {
  CODE_EVIDENCE_NEXT_ACTIONS,
  CODE_EVIDENCE_STATUS_LABELS,
  type CodeEvidenceDiagnostics,
} from '@workmesh/shared';

export function renderCodeEvidence(value: CodeEvidenceDiagnostics | undefined): string[] {
  if (!value) return ['服务端未提供代码证据诊断，请核对证据与投递日志。'];
  const lines = [
    `代码证据诊断 ${value.checkedAt}；工件代次 ${value.taskGeneration} / 当前代次 ${value.currentTaskGeneration}；绑定 ${value.currentBinding}`,
  ];
  lines.push(
    '诊断不代替平台门禁或人工决定。签名失败在收据创建前拒绝；无关联记录不能区分未投递、验签失败或无评审载荷。',
  );
  if (!value.complete) lines.push('诊断记录不完整，不能判定无证据或已就绪。');
  for (const reference of value.references) {
    lines.push(
      `${reference.artifactId} SHA ${reference.commitSha ?? '未声明'}：${CODE_EVIDENCE_STATUS_LABELS[reference.status]}`,
      CODE_EVIDENCE_NEXT_ACTIONS[reference.status],
    );
    for (const row of reference.deliveries)
      lines.push(
        `投递 ${row.id} ${row.status} signatureValid=${row.signatureValid} ${row.receivedAt}`,
      );
    for (const row of reference.reviews)
      lines.push(
        `PR ${row.changeRequestId} head=${row.headSha} ${row.state} reviewer=${row.reviewerExternalId} reasons=${row.reasons.join(',') || 'NONE'}`,
      );
    for (const row of reference.tickets)
      lines.push(
        `票据 ${row.id} ${row.state} repository=${row.repositoryId} PR=${row.changeRequestId} matchesReference=${row.matchesReference} matchesGeneration=${row.matchesGeneration}`,
      );
  }
  return lines;
}
