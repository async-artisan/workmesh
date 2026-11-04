export const PHASE_LABELS: Record<string, string> = {
  DISCOVERY: '需求发现',
  DEFINITION: '定义',
  DELIVERY: '交付',
  ACCEPTANCE: '验收',
  RELEASED: '已发布',
  ARCHIVED: '已归档',
};

export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  // OPEN 只表示任务还没开始，不代表现在可以领取；可领取由依赖/readiness 状态决定。
  OPEN: '未开始',
  IN_PROGRESS: '进行中',
  REVIEW_PENDING: '待签字',
  DONE: '已完成',
};

export const WORK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '正常',
  BLOCKED: '阻塞',
  PAUSED: '暂停',
  CANCELLED: '已取消',
};

export const REVIEW_KIND_LABELS: Record<string, string> = {
  UNDERSTANDING_CONFIRM: '理解确认',
  PRD_PUBLICATION: 'PRD 发布',
  KNOWLEDGE_PUBLICATION: '知识发布',
  TASK_ACCEPTANCE: '任务验收',
  RELEASE_ACCEPTANCE: '发布验收',
};

export const REVIEW_STATUS_LABELS: Record<string, string> = {
  OPEN: '待评审',
  APPROVED: '已通过',
  CHANGES_REQUESTED: '要求修改',
  REJECTED: '已驳回',
  INVALIDATED: '已失效',
};

export const DECISION_LABELS: Record<string, string> = {
  APPROVE: '批准',
  CHANGES_REQUESTED: '要求修改',
  REJECT: '驳回',
};

export const ARTIFACT_KIND_LABELS: Record<string, string> = {
  PRD: '产品需求',
  DESIGN: '设计',
  IMPL: '实现',
  CASES: '测试用例',
  RELEASE: '发布',
};

export const ARTIFACT_STORAGE_LABELS: Record<string, string> = {
  HOSTED: '平台托管',
  GIT_REF: '代码引用',
};

export const STEP_LABELS: Record<string, string> = {
  prd: '产品 PRD',
  design: 'UI 设计',
  'impl-fe': '前端实现',
  'impl-be': '后端实现',
  'frontend-impl': '前端实现',
  'backend-impl': '后端实现',
  verify: '测试验证',
  release: '发布上线',
};

export const ACTION_LABELS: Record<string, string> = {
  REVIEW_DECIDE: '评审决定',
  REVIEW_DECISION_REVOKE: '撤销评审决定',
  REVIEW_REVOKE: '撤销批准',
  ARTIFACT_SET_DELIVER: '交付工件',
  CONTEXT_SNAPSHOT_CREATE: '生成上下文快照',
  WORKFLOW_INSTANCE_CREATE: '初始化流程',
  KNOWLEDGE_WITHDRAW: '撤销发布',
  PROJECT_ROLE_ASSIGN: '授予角色',
  PROJECT_ROLE_UNASSIGN: '撤销角色',
  KB_ACCESS_REPLACE: '替换知识库 ACL',
  CHANGE_ACK: '确认变更',
  CLI_AUTHORIZE: '设备授权',
  CLI_AUTHORIZE_DENY: '拒绝设备授权',
  CREDENTIAL_REVOKE: '撤销 Agent 凭据',
  WORKFLOW_PUBLISH: '发布流程定义',
};

export const REVISION_STATE_LABELS: Record<string, string> = {
  CANDIDATE: '候选',
  PUBLISHED: '已发布',
  WITHDRAWN: '已撤回',
};

/** 评审决定类型；业务文案与影响说明共用同一份枚举，避免页面各写一套。 */
export type ReviewDecisionValue = 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

/**
 * “提交后影响”说明：审批人必须能在确认前看到自己的决定会造成什么。
 * 文案按评审类型细化，未知类型给通用说明，不编造服务端未承诺的行为。
 */
export function decisionImpact(decision: ReviewDecisionValue, reviewKind?: string | null): string {
  if (decision === 'APPROVE') {
    if (reviewKind === 'TASK_ACCEPTANCE')
      return '该槽位记为验收通过；若全部槽位通过，任务进入已完成状态。';
    if (reviewKind === 'RELEASE_ACCEPTANCE')
      return '该槽位记为发布验收通过；若全部槽位通过，发布流程继续执行。';
    if (reviewKind === 'PRD_PUBLICATION' || reviewKind === 'KNOWLEDGE_PUBLICATION')
      return '该槽位记为批准；若全部槽位已批准，服务端会发布对应文档版本。';
    if (reviewKind === 'UNDERSTANDING_CONFIRM')
      return '该槽位记为理解确认通过；若全部槽位通过，需求进入下一阶段。';
    return '该槽位记为批准；若全部槽位通过，服务端按评审类型推进后续流程。';
  }
  if (decision === 'CHANGES_REQUESTED')
    return '评审退回交付方修改，需要按说明调整后重新提交评审；当前版本不会发布。';
  return '评审被驳回，按服务端规则结束本次评审；如需继续需要重新发起。';
}

/**
 * 哪些评审类型要求证据完整：任务/发布验收直接决定交付是否被接受，
 * 证据正文被截断或上下文读取失败时必须让审批人明确知晓。
 */
export function reviewRequiresCompleteEvidence(reviewKind: string | null | undefined): boolean {
  return reviewKind === 'TASK_ACCEPTANCE' || reviewKind === 'RELEASE_ACCEPTANCE';
}

export function labelFor(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}
