/**
 * 任务展示状态的唯一映射（需求详情 / 看板共用）。
 *
 * 背景：`executionStatus === 'OPEN'` 只表示任务还没有完成，**不等于可以立即领取**。
 * 可领取必须由流程依赖与服务端状态共同推出；任何一端缺失时只能显示「状态待确认」，
 * 不允许把「未完成」「没看到阻塞」推断成「可立即领取」。
 *
 * 依赖来源：`GET /workflow-instances/:id` 拿到 `definitionRevisionId`，再取
 * `GET /workflow-definition-revisions/:id` 的 `definition.steps[].deps`。前端不重算
 * 服务端 ready 判定（`GET /projects/:id/tasks/ready` 还带角色/责任人过滤，不等价于全局就绪）。
 */

export type TaskDisplayStateKind =
  | 'CLAIMABLE'
  | 'WAITING_PREDECESSOR'
  | 'WAITING_APPROVAL'
  | 'BLOCKED_OR_FROZEN'
  | 'UNKNOWN'
  | 'DONE'
  | 'IN_PROGRESS'
  | 'CANCELLED';

export type TaskDisplayTone = 'ready' | 'active' | 'waiting' | 'blocked' | 'done' | 'unknown';

export interface TaskStateSignals {
  executionStatus?: string | null;
  workStatus?: string | null;
  currentClaimId?: string | null;
  reviewStatus?: string | null;
  /**
   * 该任务步骤的直接前置步骤 key。
   * - `undefined` / `null`：依赖信息不可用，不能判断能否领取；
   * - `[]`：依赖信息可用且该步骤没有前置依赖。
   */
  dependsOnStepKeys?: string[] | null;
  /** 已完成（DONE）的步骤 key；依赖可用时必须提供，否则按不可用处理。 */
  doneStepKeys?: ReadonlySet<string> | null;
}

export interface TaskDisplayState {
  kind: TaskDisplayStateKind;
  label: string;
  description: string;
  tone: TaskDisplayTone;
  /** 只有真正可领取时为 true；其它状态一律 false。 */
  claimable: boolean;
  /** 仍在等待的前置步骤 key（仅 WAITING_PREDECESSOR 时非空）。 */
  missingPredecessors: string[];
}

const UNKNOWN: TaskDisplayState = {
  kind: 'UNKNOWN',
  label: '状态待确认',
  description: '服务端没有提供可用的依赖信息，无法确认这个任务现在能否领取；请稍后刷新或联系项目管理员。',
  tone: 'unknown',
  claimable: false,
  missingPredecessors: [],
};

function waitingPredecessor(missing: string[]): TaskDisplayState {
  return {
    kind: 'WAITING_PREDECESSOR',
    label: '等待前置任务',
    description: `前置步骤 ${missing.join('、')} 尚未完成；完成后才会进入可领取状态。`,
    tone: 'waiting',
    claimable: false,
    missingPredecessors: [...missing],
  };
}

/**
 * 把服务端字段映射为页面状态。判定顺序固定，避免同一任务在不同页面得出不同结论：
 * 取消 → 完成 → 冻结/阻塞 → 待审批 → 执行中 → 未开始（依赖可用才算可领取）。
 */
export function resolveTaskDisplayState(input: TaskStateSignals): TaskDisplayState {
  const executionStatus = input.executionStatus ?? null;
  const workStatus = input.workStatus ?? null;

  if (workStatus === 'CANCELLED')
    return {
      kind: 'CANCELLED',
      label: '已取消',
      description: '该任务已取消，不再参与领取或交付。',
      tone: 'done',
      claimable: false,
      missingPredecessors: [],
    };

  if (executionStatus === 'DONE')
    return {
      kind: 'DONE',
      label: '已完成',
      description: '任务已完成；交付与决定可通过交付物、评审记录追溯。',
      tone: 'done',
      claimable: false,
      missingPredecessors: [],
    };

  if (workStatus === 'BLOCKED' || workStatus === 'PAUSED')
    return {
      kind: 'BLOCKED_OR_FROZEN',
      label: workStatus === 'PAUSED' ? '暂停 / 冻结' : '阻塞 / 冻结',
      description:
        workStatus === 'PAUSED'
          ? '任务被暂停或冻结（可能由变更冻结触发）；解除前不能领取或交付，原因以服务端记录为准。'
          : '任务处于阻塞状态；解除前不能领取或交付，具体阻塞原因以服务端记录为准。',
      tone: 'blocked',
      claimable: false,
      missingPredecessors: [],
    };

  if (input.reviewStatus === 'OPEN' || executionStatus === 'REVIEW_PENDING')
    return {
      kind: 'WAITING_APPROVAL',
      label: '等待审批',
      description: '已提交交付，正在等待人工审批；审批完成前不需要也不能重复领取。',
      tone: 'waiting',
      claimable: false,
      missingPredecessors: [],
    };

  if (
    input.currentClaimId ||
    (executionStatus !== null &&
      ['ACTIVE', 'IN_PROGRESS', 'CLAIMED'].includes(executionStatus))
  )
    return {
      kind: 'IN_PROGRESS',
      label: '执行中',
      description: '任务已被认领，正在由责任人（及其本地 Agent）执行。',
      tone: 'active',
      claimable: false,
      missingPredecessors: [],
    };

  if (executionStatus === 'OPEN') {
    const dependsOn = input.dependsOnStepKeys;
    if (dependsOn === undefined || dependsOn === null) return UNKNOWN;
    if (!input.doneStepKeys) return UNKNOWN;
    const missing = dependsOn.filter((stepKey) => !input.doneStepKeys?.has(stepKey));
    if (missing.length > 0) return waitingPredecessor(missing);
    return {
      kind: 'CLAIMABLE',
      label: '可立即领取',
      description: '直接前置步骤均已完成，且没有被认领或阻塞；责任人可通过本地 Agent 认领。',
      tone: 'ready',
      claimable: true,
      missingPredecessors: [],
    };
  }

  return UNKNOWN;
}

/** 依赖信息是否足以判断一个任务的可领取状态。 */
export function hasUsableDependencies(input: {
  dependsOnStepKeys?: string[] | null;
  doneStepKeys?: ReadonlySet<string> | null;
}): boolean {
  return input.dependsOnStepKeys !== undefined && input.dependsOnStepKeys !== null && !!input.doneStepKeys;
}
