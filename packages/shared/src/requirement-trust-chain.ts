/** Read-only explanation of registered facts; it is not another approval or test gate. */
export type RequirementTrustActor = {
  kind: 'HUMAN' | 'AGENT' | 'UNKNOWN';
  userId: string | null;
  label: string | null;
};

export type RequirementTrustGapCode =
  | 'BASELINE_MISSING'
  | 'BASELINE_UNAVAILABLE'
  | 'BASELINE_INCONSISTENT'
  | 'WORKFLOW_MISSING'
  | 'ACCEPTANCE_UNASSIGNED'
  | 'TASK_NOT_ACCEPTED'
  | 'DELIVERY_MISSING'
  | 'DELIVERY_STALE'
  | 'SNAPSHOT_MISSING'
  | 'SNAPSHOT_STALE'
  | 'SNAPSHOT_UNVERIFIABLE'
  | 'APPROVAL_MISSING'
  | 'SIGNATURE_UNRECORDED'
  | 'CODE_EVIDENCE_MISSING'
  | 'CODE_EVIDENCE_INVALID'
  | 'VISIBILITY_LIMITED';

export type RequirementTrustGap = {
  code: RequirementTrustGapCode;
  taskId?: string;
  acceptanceKey?: string;
  baselineKind?: 'UNDERSTANDING' | 'PRD';
};

export type RequirementTrustEvent = {
  id: string;
  kind:
    | 'PUBLICATION'
    | 'WITHDRAWAL'
    | 'DELIVERY'
    | 'REVIEW_REQUEST'
    | 'DECISION'
    | 'REVOCATION'
    | 'CHANGE';
  at: string;
  source:
    'PLATFORM_FACT' | 'HUMAN_SIGNED' | 'AGENT_SUBMITTED' | 'HUMAN_SUBMITTED' | 'UNRECORDED_ACTOR';
  applicability: 'CURRENT' | 'HISTORICAL' | 'WITHDRAWN' | 'REVOKED' | 'UNKNOWN';
  label: string;
  actors: RequirementTrustActor[];
  taskId?: string;
  taskGeneration?: number;
  requirementGeneration?: number;
  artifactSetId?: string;
  reviewId?: string;
  documentId?: string;
  revisionId?: string;
  decision?: string;
};

export interface RequirementTrustChain {
  scope: 'FORMAL_FACT_CHAIN';
  checkedAt: string;
  requirementGeneration: number;
  status: 'LINKED' | 'GAPS' | 'UNAVAILABLE';
  visibility: 'FULL' | 'PARTIAL';
  baselines: Array<{
    kind: 'UNDERSTANDING' | 'PRD';
    state: 'CURRENT' | 'MISSING' | 'UNAVAILABLE' | 'INCONSISTENT';
    documentId?: string;
    revisionId?: string;
    seq?: number;
    title?: string;
  }>;
  tasks: Array<{
    taskId: string;
    taskGeneration: number;
    stepLabel: string;
    state: 'ACCEPTED' | 'PENDING' | 'STALE' | 'RETIRED';
    baselineRelation: 'CURRENT' | 'PRESERVED_ACCEPTANCE' | 'STALE' | 'UNKNOWN';
    artifactSetId: string | null;
    snapshotId: string | null;
    reviewId: string | null;
    gapCodes: RequirementTrustGapCode[];
  }>;
  acceptance: Array<{ key: string; taskIds: string[]; acceptedTaskIds: string[] }>;
  gaps: RequirementTrustGap[];
  timeline: RequirementTrustEvent[];
}

export const REQUIREMENT_TRUST_GAP_LABELS: Record<RequirementTrustGapCode, string> = {
  BASELINE_MISSING: '缺少当前发布基线',
  BASELINE_UNAVAILABLE: '当前基线不可读取或无法确认归属',
  BASELINE_INCONSISTENT: '需求基线与文档当前发布事实不一致',
  WORKFLOW_MISSING: '尚无有效流程任务承接需求',
  ACCEPTANCE_UNASSIGNED: '验收条件尚未分配给有效任务',
  TASK_NOT_ACCEPTED: '任务尚未完成当前交付的正式验收',
  DELIVERY_MISSING: '缺少当前代次的交付',
  DELIVERY_STALE: '当前交付与任务代次或流程修订不一致',
  SNAPSHOT_MISSING: '交付引用的上下文快照缺失',
  SNAPSHOT_STALE: '交付快照与任务或需求当前基线不一致',
  SNAPSHOT_UNVERIFIABLE: '当前可读取资料不足以核对交付快照的发布基线',
  APPROVAL_MISSING: '当前交付缺少所有审批槽的有效批准',
  SIGNATURE_UNRECORDED: '正式决定未记录可确认的人类签字来源',
  CODE_EVIDENCE_MISSING: '代码交付尚未绑定已消费票据对应的真实评审证据',
  CODE_EVIDENCE_INVALID: '已绑定代码证据的批准、来源或提交关联仍有缺口',
  VISIBILITY_LIMITED: '部分资料无读取权限或不可用，无法展示完整证据链',
};
