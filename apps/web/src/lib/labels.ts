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

export function labelFor(map: Record<string, string>, key: string | null | undefined): string {
  if (!key) return '—';
  return map[key] ?? key;
}
