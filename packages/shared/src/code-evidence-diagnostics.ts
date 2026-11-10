/** Read-only explanation of the same provenance checks used by the code acceptance gate. */
export interface CodeEvidenceDiagnostics {
  checkedAt: string;
  complete: boolean;
  currentBinding: 'CURRENT' | 'HISTORICAL' | 'INACTIVE';
  taskGeneration: number;
  currentTaskGeneration: number;
  signaturePolicy: 'REJECTED_BEFORE_RECEIPT';
  references: Array<{
    artifactId: string;
    projectRepositoryId: string | null;
    commitSha: string | null;
    repository: {
      owner: string;
      name: string;
      externalId: string | null;
      identityMode: string;
      adapter: string | null;
      archived: boolean;
    } | null;
    status:
      | 'BOUND'
      | 'HISTORICAL'
      | 'REPOSITORY_UNRESOLVED'
      | 'NO_ASSOCIATED_DELIVERY'
      | 'REVIEW_NOT_QUALIFYING'
      | 'SHA_MISMATCH'
      | 'TICKET_MISSING'
      | 'TICKET_LIVE'
      | 'TICKET_EXPIRED'
      | 'TICKET_STALE'
      | 'INCOMPLETE';
    deliveries: Array<{
      id: string;
      eventType: string;
      status: string;
      signatureValid: boolean;
      receivedAt: string;
      processedAt: string | null;
    }>;
    reviews: Array<{
      id: string;
      changeRequestId: string;
      headSha: string;
      commitSha: string | null;
      reviewerExternalId: string;
      authorExternalId: string;
      reviewerKind: string;
      state: string;
      submittedAt: string | null;
      reasons: string[];
    }>;
    tickets: Array<{
      id: string;
      evidenceId: string | null;
      repositoryId: string;
      changeRequestId: string;
      headSha: string;
      generation: number | null;
      state: 'LIVE' | 'EXPIRED' | 'CONSUMED' | 'INVALID';
      matchesReference: boolean;
      matchesGeneration: boolean;
    }>;
  }>;
}

export const CODE_EVIDENCE_STATUS_LABELS: Record<
  CodeEvidenceDiagnostics['references'][number]['status'],
  string
> = {
  BOUND: '已找到当前工件对应的可信评审与已消费票据',
  HISTORICAL: '该工件属于历史交付，不能代表当前代次证据',
  REPOSITORY_UNRESOLVED: '仓库尚无可用的 GitHub 提供方身份',
  NO_ASSOCIATED_DELIVERY: '尚未找到与此提交关联的可信投递记录',
  REVIEW_NOT_QUALIFYING: '已收到关联投递，但评审尚不满足诊断条件',
  SHA_MISMATCH: '仓库已有评审，提交 SHA 与当前工件不匹配',
  TICKET_MISSING: '已找到合格评审，尚未准备工件绑定票据',
  TICKET_LIVE: '绑定票据尚未消费',
  TICKET_EXPIRED: '绑定票据已过期，需要重新准备',
  TICKET_STALE: '绑定票据的提交或任务代次不匹配',
  INCOMPLETE: '诊断记录未完整取得，暂不能判定缺少哪一环',
};

export const CODE_EVIDENCE_NEXT_ACTIONS: Record<
  CodeEvidenceDiagnostics['references'][number]['status'],
  string
> = {
  BOUND: '核对证据后继续正式评审；此诊断不代替人工决定。',
  HISTORICAL: '打开任务的当前交付，核对当前代次的代码证据。',
  REPOSITORY_UNRESOLVED: '请项目管理员核对仓库登记、提供方身份与归档状态。',
  NO_ASSOCIATED_DELIVERY:
    '核对 GitHub 投递与服务日志；签名失败或没有评审内容的投递无法按工件归因。',
  REVIEW_NOT_QUALIFYING: '核对投递处理状态、他人人类批准、最新评审意见和批准对应的提交。',
  SHA_MISMATCH: '核对交付的完整 commit SHA 与 PR head，并为准确提交提供评审。',
  TICKET_MISSING: '为准确仓库、PR、head、工件集和代次准备代码证据票据。',
  TICKET_LIVE: '用原票据按既有流程绑定代码证据，注意有效期。',
  TICKET_EXPIRED: '重新核对提交与评审后准备新票据；旧票据不能重放。',
  TICKET_STALE: '按当前工件与任务代次重新准备票据。',
  INCOMPLETE: '缩小关联记录范围或联系管理员检查诊断查询，不能把部分记录当作无证据。',
};

export const CODE_EVIDENCE_REASON_LABELS: Record<string, string> = {
  TRUSTED_RECEIPT_MISSING: '没有可关联的已验签收据',
  DELIVERY_NOT_PROCESSED: '投递未完成有效处理',
  HUMAN_APPROVAL_REQUIRED: '评审意见不是批准',
  BOT_REVIEW: '评审者不是人类用户',
  OTHER_USER_APPROVAL_REQUIRED: '需要作者之外的用户批准',
  SHA_MISMATCH: '评审提交或 PR head 与工件 SHA 不同',
  CHANGES_REQUESTED_ACTIVE: 'PR 仍有最新的修改请求',
  SUPERSEDED_REVIEW: '该用户已有较新的评审意见',
};
