import {
  CODE_EVIDENCE_NEXT_ACTIONS,
  type CodeEvidenceDiagnostics,
  type RequirementTrustGapCode,
} from '@workmesh/shared';

type RecoveryGuidance = { responsible: string; nextStep: string };
type CodeEvidenceStatus = CodeEvidenceDiagnostics['references'][number]['status'];

const CODE_RESPONSIBLE: Record<CodeEvidenceStatus, string> = {
  BOUND: '本轮审批人',
  HISTORICAL: '交付责任角色',
  REPOSITORY_UNRESOLVED: '项目管理员',
  NO_ASSOCIATED_DELIVERY: '仓库集成维护者',
  REVIEW_NOT_QUALIFYING: '代码评审人 / 交付责任角色',
  SHA_MISMATCH: '交付责任角色 / 代码评审人',
  TICKET_MISSING: '交付责任角色',
  TICKET_LIVE: '交付责任角色',
  TICKET_EXPIRED: '交付责任角色',
  TICKET_STALE: '交付责任角色',
  INCOMPLETE: '项目管理员 / 仓库集成维护者',
};

/** Suggested responsibility only; the current assignment and permissions remain authoritative. */
export function codeEvidenceRecovery(status: CodeEvidenceStatus): RecoveryGuidance {
  return { responsible: CODE_RESPONSIBLE[status], nextStep: CODE_EVIDENCE_NEXT_ACTIONS[status] };
}

const GAP_RECOVERY: Record<RequirementTrustGapCode, RecoveryGuidance> = {
  BASELINE_MISSING: {
    responsible: '产品责任角色 / 项目管理员',
    nextStep: '核对需求当前发布基线，按现有知识或 PRD 发布流程补齐后重新读取诊断。',
  },
  BASELINE_UNAVAILABLE: {
    responsible: '项目管理员',
    nextStep: '核对资料权限、归属与服务可用性；恢复读取前不能判断基线缺失。',
  },
  BASELINE_INCONSISTENT: {
    responsible: '产品责任角色 / 项目管理员',
    nextStep: '核对需求基线与文档正式发布记录，不以本地副本替代当前发布版本。',
  },
  WORKFLOW_MISSING: {
    responsible: '项目管理员',
    nextStep: '检查现有流程实例与任务状态，按既有流程承接需求。',
  },
  ACCEPTANCE_UNASSIGNED: {
    responsible: '产品责任角色 / 项目管理员',
    nextStep: '核对该验收条件与有效流程任务的覆盖关系，按既有变更流程调整。',
  },
  TASK_NOT_ACCEPTED: {
    responsible: '任务责任角色 / 本轮审批人',
    nextStep: '定位任务的当前交付与评审，核对剩余审批槽及返修要求。',
  },
  DELIVERY_MISSING: {
    responsible: '任务责任角色',
    nextStep: '按当前任务代次和实际读取的上下文完成交付，保留原操作回执。',
  },
  DELIVERY_STALE: {
    responsible: '任务责任角色 / QA',
    nextStep: '定位当前任务，核对交付代次与流程修订；由 QA 判断需复验的范围，再按现有流程交付。',
  },
  SNAPSHOT_MISSING: {
    responsible: '任务责任角色 / 项目管理员',
    nextStep: '核对交付引用的快照记录与读取权限，按现有输入检查和快照流程恢复。',
  },
  SNAPSHOT_STALE: {
    responsible: '任务责任角色 / QA',
    nextStep: '查看当前任务输入与基线变化，由 QA 判断复验范围；不能用最新版本覆盖原交付依据。',
  },
  SNAPSHOT_UNVERIFIABLE: {
    responsible: '项目管理员 / QA',
    nextStep: '先恢复必要资料的读取与归属核对；未知依据不能当作快照匹配或功能失败。',
  },
  APPROVAL_MISSING: {
    responsible: '本轮审批人',
    nextStep: '打开当前交付的评审，核对准确审批槽和证据后作出正式决定。',
  },
  SIGNATURE_UNRECORDED: {
    responsible: '项目管理员 / 原审批人',
    nextStep: '核对原正式决定的主体与审计来源，不能从 Agent 报告或讨论状态推断人类签字。',
  },
  CODE_EVIDENCE_MISSING: {
    responsible: '交付责任角色 / 代码评审人',
    nextStep: '定位当前交付的代码证据诊断，按准确仓库、提交和任务代次补齐评审及绑定。',
  },
  CODE_EVIDENCE_INVALID: {
    responsible: '交付责任角色 / 代码评审人',
    nextStep: '逐段核对可信投递、最新评审记录、提交和绑定票据，不以历史批准代表当前证据。',
  },
  VISIBILITY_LIMITED: {
    responsible: '项目管理员',
    nextStep: '检查当前成员的资料读取权限或服务状态；不可见记录不能计作已完成或缺失。',
  },
};

export function requirementGapRecovery(code: RequirementTrustGapCode): RecoveryGuidance {
  return GAP_RECOVERY[code];
}
