/** Read-only guidance derived from a change event and current task facts. ACK is only receipt. */
export interface ChangeTaskGuidance {
  taskId: string;
  requirementId: string;
  taskCode: string;
  stepKey: string;
  stepDisplayName: string | null;
  role: { id: string; key: string; title: string };
  responsibleUserId: string;
  relation: 'RESPONSIBLE' | 'ROLE';
  version: number;
  generation: number;
  executionStatus: string;
  workStatus: string;
  reason:
    | 'PROJECT_ARCHIVED'
    | 'ROLE_INACTIVE'
    | 'RETIRED'
    | 'CANCELLED'
    | 'PAUSED'
    | 'BLOCKED'
    | 'STALE_CONTEXT'
    | 'NO_CONTEXT'
    | 'REVIEW_PENDING'
    | 'DELIVERED'
    | 'RECHECK_CHANGE';
  action:
    | 'CONTACT_OWNER'
    | 'RESOLVE_BLOCK'
    | 'RESUME_TASK'
    | 'INSPECT_AND_REFRESH'
    | 'INSPECT_AND_CLAIM'
    | 'FOLLOW_REVIEW'
    | 'CHECK_DELIVERY'
    | 'COMPARE_CHANGE';
  href: string;
  inspectCommand: string;
}

export interface ChangeGuidance {
  checkedAt: string;
  /** Explicit taskIds are authoritative; accepted change requests without IDs use current scope. */
  scope: 'EVENT_TASKS' | 'CURRENT_ACCEPTANCE_SCOPE' | 'UNKNOWN';
  eventBaseline: 'CURRENT' | 'SUPERSEDED' | 'NOT_SPECIFIED' | 'UNKNOWN';
  tasks: ChangeTaskGuidance[];
}

export const CHANGE_TASK_REASON_LABELS: Record<ChangeTaskGuidance['reason'], string> = {
  PROJECT_ARCHIVED: '项目已归档，只能核对历史记录',
  ROLE_INACTIVE: '当前主体未持有任务角色的活动指派',
  RETIRED: '原流程实例已退役',
  CANCELLED: '任务或流程已取消',
  PAUSED: '任务或流程已暂停',
  BLOCKED: '任务或流程当前受阻',
  STALE_CONTEXT: '当前快照不属于任务的当前代次或需求基线',
  NO_CONTEXT: '当前代次尚无上下文快照',
  REVIEW_PENDING: '当前交付正在评审',
  DELIVERED: '任务当前已完成，需核对交付是否覆盖变更',
  RECHECK_CHANGE: '需要核对变更与当前工作的差异',
};

export const CHANGE_TASK_ACTION_LABELS: Record<ChangeTaskGuidance['action'], string> = {
  CONTACT_OWNER: '联系任务负责人核对影响；此通知不转移任务责任',
  RESOLVE_BLOCK: '先处理阻塞原因，再检查输入和上下文',
  RESUME_TASK: '由有权限的负责人恢复任务后检查输入',
  INSPECT_AND_REFRESH: '先检查输入，再用当前认领重新获取上下文并核对差异',
  INSPECT_AND_CLAIM: '先检查输入，前置条件满足后重新认领并获取上下文',
  FOLLOW_REVIEW: '核对本次变更与待评审交付，跟进评审结果',
  CHECK_DELIVERY: '核对已完成交付与当前基线，必要时通过正式返修流程调整',
  COMPARE_CHANGE: '核对变更与当前工作，按确认的差异继续交付',
};
