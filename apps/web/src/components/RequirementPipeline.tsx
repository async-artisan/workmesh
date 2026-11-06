import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { resolveTaskDisplayState, type TaskDisplayState } from '../lib/taskDisplayState';
import { RoleAvatar } from './RoleAvatar';

export type PipelineStatus = 'done' | 'active' | 'blocked' | 'pending' | 'skipped';
export interface RequirementPipelineTask {
  id: string;
  stepKey?: string;
  title?: string;
  role?: string;
  roleLabel?: string;
  status?: string;
  workStatus?: string | null;
  executionStatus?: string;
  artifactCount?: number;
  blockedBy?: string[];
  deps?: string[];
  updatedAt?: string;
  /** 被认领的 claim；有 claim 时按执行中展示。 */
  currentClaimId?: string | null;
  /** 任务当前评审状态；OPEN 表示等待人工审批。 */
  reviewStatus?: string | null;
  /** 定义里的直接前置步骤 key；null/undefined 表示依赖信息不可用（不能推出可领取）。 */
  dependsOnStepKeys?: string[] | null;
  /** 已完成（DONE）的步骤 key；与 dependsOnStepKeys 一起使用。 */
  doneStepKeys?: string[] | null;
  /** 父级已用统一映射算好的展示状态；缺省时组件自行用同一函数计算。 */
  displayState?: TaskDisplayState;
  /** 服务端返回的真实负责人；缺失时首屏必须明确标注未知。 */
  ownerLabel?: string | null;
}
export interface RequirementPipelinePhase {
  id: string;
  label: string;
  shortLabel?: string;
  role?: string;
  roleLabel?: string;
  status?: PipelineStatus;
  tasks?: RequirementPipelineTask[];
  blockedBy?: string[];
  nextAction?: string;
  /** 服务端返回的当前负责人；缺失时首屏必须明确标注未知，不得推测。 */
  ownerLabel?: string | null;
  /** 服务端返回的阻塞原因；缺失时首屏展示数据不可用提示。 */
  blockedReason?: string | null;
  /** 真实可执行入口的文案；只在调用方提供入口时渲染按钮。 */
  actionLabel?: string | null;
  onAction?: () => void;
  /** 没有真实可执行入口时的解释；缺失时使用组件默认说明。 */
  actionUnavailableReason?: string | null;
  updatedAt?: string;
}
export interface RequirementPipelineProps {
  phases?: RequirementPipelinePhase[];
  tasks?: RequirementPipelineTask[];
  onPhaseClick?: (phase: RequirementPipelinePhase) => void;
  onTaskClick?: (task: RequirementPipelineTask) => void;
  className?: string;
  nextAction?: string;
  /** 首屏摘要中的真实业务动作；缺失时不渲染按钮。 */
  actionLabel?: string | null;
  onAction?: (() => void) | null;
  /** 首屏没有真实业务动作时展示的原因；缺失时使用可展开团队视图的默认说明。 */
  actionUnavailableReason?: string | null;
  /**
   * 首屏折叠：默认只渲染一行「阶段进度 + 下一步」摘要，展开后才渲染完整团队视图。
   * 独立使用（如流程总览页）时可保持默认展开，避免隐藏已有内容。
   */
  collapsible?: boolean;
}

const DEFAULT_PHASES: Array<
  Pick<RequirementPipelinePhase, 'id' | 'label' | 'shortLabel' | 'role'>
> = [
  { id: 'discovery', label: '需求发现', shortLabel: '发现', role: 'product' },
  { id: 'definition', label: '方案定义', shortLabel: '定义', role: 'product' },
  { id: 'design', label: '体验设计', shortLabel: '设计', role: 'ui' },
  { id: 'build', label: '开发实现', shortLabel: '开发', role: 'engineering' },
  { id: 'verify', label: '测试验证', shortLabel: '验证', role: 'qa' },
  { id: 'release', label: '发布上线', shortLabel: '发布', role: 'ops' },
];
const ROLE_LABELS: Record<string, string> = {
  product: '产品',
  ui: '设计',
  frontend: '前端',
  backend: '后端',
  engineering: '研发',
  qa: '测试',
  ops: '运维',
};
const STATUS_LABELS: Record<PipelineStatus, string> = {
  done: '完成',
  active: '工作中',
  blocked: '阻塞',
  pending: '等待',
  skipped: '跳过',
};
const WIRE_COLORS: Record<PipelineStatus, string> = {
  done: '#10b981',
  active: '#3b82f6',
  blocked: '#e11d48',
  pending: '#b6c2d2',
  skipped: '#10b981',
};
/** 稳定的空数组：默认参数不能每次渲染都新建，否则 memo/布局效应会反复重算。 */
const NO_TASKS: RequirementPipelineTask[] = [];

function normalizeStatus(task: RequirementPipelineTask): PipelineStatus {
  // ACTIVE describes availability, not execution progress. It must not hide DONE or OPEN.
  if (task.workStatus === 'CANCELLED') return 'skipped';
  if (task.workStatus === 'BLOCKED' || task.workStatus === 'PAUSED') return 'blocked';
  const status = task.executionStatus ?? task.status ?? task.workStatus;
  if (status === 'BLOCKED') return 'blocked';
  if (status === 'DONE' || status === 'DELIVERED' || status === 'APPROVED') return 'done';
  if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'REVIEW_PENDING')
    return 'active';
  if (status === 'CANCELLED') return 'skipped';
  return 'pending';
}
function phaseStatus(
  phase: RequirementPipelinePhase,
  tasks: RequirementPipelineTask[],
): PipelineStatus {
  if (phase.status) return phase.status;
  if (tasks.some((task) => normalizeStatus(task) === 'blocked')) return 'blocked';
  if (tasks.length > 0 && tasks.every((task) => normalizeStatus(task) === 'done')) return 'done';
  if (tasks.some((task) => ['active', 'done'].includes(normalizeStatus(task)))) return 'active';
  return 'pending';
}
function roleLabel(role?: string, explicit?: string): string {
  return explicit ?? (role ? (ROLE_LABELS[role] ?? role) : '未分配');
}

/**
 * 任务展示状态的唯一入口：优先用父级算好的状态，否则用共享映射按任务字段计算。
 * 组件内绝不再把「未完成」推断成「可领取」。
 */
function displayStateOf(task: RequirementPipelineTask): TaskDisplayState {
  if (task.displayState) return task.displayState;
  return resolveTaskDisplayState({
    executionStatus: task.executionStatus ?? task.status ?? null,
    workStatus: task.workStatus ?? null,
    currentClaimId: task.currentClaimId ?? null,
    reviewStatus: task.reviewStatus ?? null,
    dependsOnStepKeys: task.dependsOnStepKeys === undefined ? null : task.dependsOnStepKeys,
    doneStepKeys: task.doneStepKeys ? new Set(task.doneStepKeys) : null,
  });
}

function laneOf(state: TaskDisplayState): 'claimable' | 'waiting' | 'active' | 'blocked' | 'done' {
  switch (state.kind) {
    case 'CLAIMABLE':
      return 'claimable';
    case 'WAITING_PREDECESSOR':
    case 'WAITING_APPROVAL':
    case 'UNKNOWN':
      return 'waiting';
    case 'IN_PROGRESS':
      return 'active';
    case 'BLOCKED_OR_FROZEN':
      return 'blocked';
    default:
      return 'done';
  }
}

function taskHint(task: RequirementPipelineTask, state: TaskDisplayState): string {
  if (state.kind === 'CLAIMABLE') return '前置已完成 · 等待责任人认领';
  if (state.kind === 'WAITING_PREDECESSOR')
    return `等待前置：${state.missingPredecessors.map((step) => `#${step}`).join(' ')}`;
  if (state.kind === 'WAITING_APPROVAL') return '等待人工审批';
  if (state.kind === 'UNKNOWN') return '依赖信息不可用';
  if (state.kind === 'BLOCKED_OR_FROZEN') return '解除阻塞或冻结后才能继续';
  if (state.kind === 'DONE') return '已完成';
  if (state.kind === 'CANCELLED') return '已取消';
  return task.currentClaimId ? '已被认领' : '执行中';
}

export function RequirementPipeline({
  phases = DEFAULT_PHASES,
  tasks = NO_TASKS,
  onPhaseClick,
  onTaskClick,
  className = '',
  nextAction,
  actionLabel,
  onAction,
  actionUnavailableReason,
  collapsible = false,
}: RequirementPipelineProps) {
  const detailId = useId();
  const [expanded, setExpanded] = useState(false);
  const showDetail = !collapsible || expanded;
  /**
   * 同一任务只归属一个阶段：调用方按角色/步骤重复分配（例如 discovery 与 definition
   * 都取 product 任务）时先到先得，保证任务卡、统计与 React key 都只有一份。
   */
  const phaseModels = useMemo(() => {
    const claimed = new Set<string>();
    return phases.map((phase) => {
      const candidates =
        phase.tasks ??
        tasks.filter((task) => {
          const key = `${task.stepKey ?? ''} ${task.title ?? ''}`.toLowerCase();
          return phase.id === 'build'
            ? /impl|front|back|develop|build/.test(key)
            : phase.id === 'verify'
              ? /test|verify|qa|case/.test(key)
              : phase.id === 'release'
                ? /release|deploy|ops/.test(key)
                : phase.id === task.stepKey;
        });
      const phaseTasks = candidates.filter((task) => {
        if (claimed.has(task.id)) return false;
        claimed.add(task.id);
        return true;
      });
      return { phase, tasks: phaseTasks, status: phaseStatus(phase, phaseTasks) };
    });
  }, [phases, tasks]);
  const allTasks = useMemo(() => phaseModels.flatMap((model) => model.tasks), [phaseModels]);
  const members = useMemo(() => {
    const map = new Map<
      string,
      { role: string; label: string; tasks: RequirementPipelineTask[]; status: PipelineStatus }
    >();
    phaseModels.forEach(({ phase, tasks: phaseTasks, status }) => {
      const role = phase.role ?? phaseTasks[0]?.role ?? 'engineering';
      const existing = map.get(role);
      if (existing) {
        existing.tasks.push(...phaseTasks);
        if (status === 'blocked' || (status === 'active' && existing.status === 'pending'))
          existing.status = status;
      } else
        map.set(role, {
          role,
          label: roleLabel(role, phase.roleLabel),
          tasks: [...phaseTasks],
          status,
        });
    });
    return [...map.values()];
  }, [phaseModels]);
  const leader =
    members.find((member) => member.status === 'active' || member.status === 'blocked') ??
    members[0];
  const buckets = useMemo(
    () => ({
      claimable: allTasks.filter((task) => laneOf(displayStateOf(task)) === 'claimable'),
      waiting: allTasks.filter((task) => laneOf(displayStateOf(task)) === 'waiting'),
      active: allTasks.filter((task) => laneOf(displayStateOf(task)) === 'active'),
      blocked: allTasks.filter((task) => laneOf(displayStateOf(task)) === 'blocked'),
      completed: allTasks.filter((task) => laneOf(displayStateOf(task)) === 'done'),
    }),
    [allTasks],
  );
  const doneCount = buckets.completed.length;
  const activeCount = buckets.active.length;
  const blockedCount = buckets.blocked.length;
  const claimableCount = buckets.claimable.length;
  const waitingCount = buckets.waiting.length;
  // 空的 pending 阶段不能抢占真实任务阶段：首屏必须围绕当前任务显示阶段和负责人。
  const currentPhase =
    phaseModels.find(
      (item) => item.tasks.length > 0 && (item.status === 'blocked' || item.status === 'active'),
    ) ??
    phaseModels.find(
      (item) => item.tasks.length > 0 && !['done', 'skipped'].includes(item.status),
    ) ??
    phaseModels.find((item) => item.tasks.length > 0) ??
    phaseModels.find((item) => item.status === 'pending') ??
    phaseModels[phaseModels.length - 1];
  // 组件调用方提供的 nextAction 是服务端/页面层事实；缺失时与当前阶段保持一致，
  // 避免摘要同时展示两个不同的阶段动作。
  const derivedNextAction =
    nextAction ??
    currentPhase?.phase.nextAction ??
    phaseModels.find((item) => item.status === 'active' || item.status === 'blocked')?.phase
      .nextAction ??
    '等待流程推进';
  const currentPhaseLabel = currentPhase?.phase.label ?? '状态待确认';
  const currentOwner =
    currentPhase?.phase.ownerLabel?.trim() ||
    currentPhase?.tasks.find((task) => task.ownerLabel?.trim())?.ownerLabel?.trim() ||
    '暂未分配责任人';
  const currentRole = currentPhase?.phase.roleLabel?.trim() || roleLabel(currentPhase?.phase.role);
  const currentBlocker =
    currentPhase?.phase.blockedReason?.trim() ||
    (currentPhase?.status === 'blocked'
      ? '服务端未提供阻塞原因'
      : currentPhase?.status === 'active'
        ? '当前阶段未标记阻塞'
        : '状态待确认');
  // undefined 表示调用方未覆盖阶段动作；显式 null 表示当前没有可执行入口。
  const summaryActionLabel =
    actionLabel !== undefined ? actionLabel : currentPhase?.phase.actionLabel;
  const summaryOnAction = onAction !== undefined ? onAction : currentPhase?.phase.onAction;
  const summaryActionUnavailableReason =
    actionUnavailableReason !== undefined
      ? actionUnavailableReason
      : currentPhase?.phase.actionUnavailableReason;
  const actionUnavailableText =
    summaryActionUnavailableReason?.trim() || '当前没有可用操作入口；可展开团队视图查看任务。';
  const sectionRef = useRef<HTMLElement | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const selectedTaskIds = useMemo(() => {
    if (!selectedRole) return null;
    const member = members.find((item) => item.role === selectedRole);
    return member ? new Set(member.tasks.map((task) => task.id)) : null;
  }, [members, selectedRole]);
  const [wires, setWires] = useState<
    Array<{ id: string; role: string; d: string; color: string; x: number; y: number }>
  >([]);
  useLayoutEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const compute = () => {
      const rect = section.getBoundingClientRect();
      const next: Array<{
        id: string;
        role: string;
        d: string;
        color: string;
        x: number;
        y: number;
      }> = [];
      for (const member of members) {
        const badge = section.querySelector(`[data-member-no="${member.role}"]`);
        if (!badge) continue;
        const badgeRect = badge.getBoundingClientRect();
        const x1 = badgeRect.left + badgeRect.width / 2 - rect.left;
        const y1 = badgeRect.bottom - rect.top;
        for (const task of member.tasks) {
          const card = section.querySelector(`[data-task-id="${task.id}"]`);
          if (!card) continue;
          const cardRect = card.getBoundingClientRect();
          const x2 = cardRect.left + cardRect.width / 2 - rect.left;
          const y2 = cardRect.top - rect.top;
          const bend = Math.max(24, (y2 - y1) / 2);
          next.push({
            id: `${member.role}-${task.id}`,
            role: member.role,
            d: `M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`,
            color: WIRE_COLORS[normalizeStatus(task)],
            x: x2,
            y: y2,
          });
        }
      }
      setWires(next);
    };
    compute();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', compute);
      return () => window.removeEventListener('resize', compute);
    }
    const observer = new ResizeObserver(compute);
    observer.observe(section);
    window.addEventListener('resize', compute);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', compute);
    };
  }, [members, allTasks, expanded, collapsible]);
  const renderTask = (task: RequirementPipelineTask) => {
    const state = displayStateOf(task);
    const status = normalizeStatus(task);
    const progress =
      state.kind === 'DONE' || state.kind === 'CANCELLED'
        ? 100
        : state.kind === 'IN_PROGRESS'
          ? 60
          : state.kind === 'BLOCKED_OR_FROZEN'
            ? 30
            : 8;
    const stepLabel = task.title ?? task.stepKey ?? task.id;
    const accessibleName = `${stepLabel}，状态：${state.label}；${taskHint(task, state)}`;
    return (
      <button
        className={`pipeline-task-card is-${status} is-state-${state.kind.toLowerCase()}${selectedTaskIds && !selectedTaskIds.has(task.id) ? ' is-dim' : ''}`}
        type="button"
        key={task.id}
        data-task-id={task.id}
        data-task-state={state.kind}
        aria-label={accessibleName}
        onClick={() => onTaskClick?.(task)}
        disabled={!onTaskClick}
      >
        <span className="pipeline-task-card-top">
          <b>#{task.stepKey ?? task.id.slice(0, 6)}</b>
          <em>{state.label}</em>
        </span>
        <strong>{stepLabel}</strong>
        <span className="pipeline-task-card-owner">
          <RoleAvatar role={task.role} label={roleLabel(task.role, task.roleLabel)} decorative />
          <span>
            {task.ownerLabel?.trim() || '责任人暂未分配'} · {roleLabel(task.role, task.roleLabel)}
            {task.artifactCount !== undefined ? ` · ${task.artifactCount} 件证据` : ''}
          </span>
          <small>{taskHint(task, state)}</small>
        </span>
        <span className="pipeline-task-card-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
      </button>
    );
  };
  const donePhases = phaseModels.filter((model) => model.status === 'done').length;
  return (
    <section
      ref={sectionRef}
      className={`requirement-pipeline${collapsible ? ' is-collapsible' : ''}${collapsible && !expanded ? ' is-collapsed' : ''} ${className}`.trim()}
      aria-label="需求团队协作流程"
    >
      {collapsible && (
        <div className="pipeline-summary">
          <div className="pipeline-summary-main">
            <span className="pipeline-summary-label">阶段进度</span>
            <span
              className="pipeline-segments"
              role="img"
              aria-label={`阶段进度：${donePhases}/${phaseModels.length} 个阶段已完成`}
            >
              {phaseModels.map(({ phase, status }) => (
                <i
                  key={phase.id}
                  className={`is-${status}`}
                  title={`${phase.label} · ${STATUS_LABELS[status]}`}
                />
              ))}
            </span>
            <strong className="pipeline-summary-count">
              {donePhases}/{phaseModels.length}
            </strong>
            <span className="pipeline-summary-next">
              <span>下一步</span>
              <strong>{derivedNextAction || '状态待确认'}</strong>
            </span>
            <div className="pipeline-summary-facts" aria-label="当前阶段执行信息">
              <span>
                <b>当前阶段</b>
                <strong>{currentPhaseLabel}</strong>
              </span>
              <span>
                <b>责任人</b>
                <strong>{currentOwner}</strong>
              </span>
              <span>
                <b>责任角色</b>
                <strong>{currentRole}</strong>
              </span>
              <span>
                <b>阻塞原因</b>
                <strong>{currentBlocker}</strong>
              </span>
              {summaryActionLabel && summaryOnAction ? (
                <button
                  type="button"
                  className="ghost pipeline-summary-action"
                  onClick={summaryOnAction}
                >
                  {summaryActionLabel}
                </button>
              ) : (
                <span className="pipeline-summary-action-unavailable" role="status">
                  {actionUnavailableText}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="pipeline-toggle"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>{expanded ? '收起团队视图' : '展开团队视图'}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="pipeline-detail" id={detailId} hidden={!showDetail}>
        {showDetail && (
          <>
            <div className="requirement-pipeline-head">
              <div>
                <span className="eyebrow">协作团队 · 只读</span>
                <h3>需求协作团队</h3>
              </div>
              {/* 折叠模式下「下一步」已在摘要行展示，展开后不再重复。 */}
              {!collapsible && (
                <div className="pipeline-next-action">
                  <span>下一步</span>
                  <strong>{derivedNextAction}</strong>
                </div>
              )}
            </div>
            <div className="pipeline-team-stats" aria-label="任务状态统计">
              <span>
                <b>
                  {doneCount}/{allTasks.length}
                </b>{' '}
                完成
              </span>
              <span>
                <b>{claimableCount}</b> 可领取
              </span>
              <span>
                <b>{waitingCount}</b> 等待中
              </span>
              <span className={blockedCount ? 'is-alert' : ''}>
                <b>{blockedCount}</b> 阻塞
              </span>
            </div>
            <div
              className="pipeline-stage-rail"
              role="region"
              aria-label="阶段进度，可横向滚动"
              tabIndex={0}
            >
              {phaseModels.map(({ phase, status }, index) => (
                <button
                  type="button"
                  key={phase.id}
                  className={`pipeline-stage-step is-${status}`}
                  aria-current={phase.id === currentPhase?.phase.id ? 'step' : undefined}
                  aria-label={`${phase.label}，${STATUS_LABELS[status]}${phase.id === currentPhase?.phase.id ? '，当前阶段' : ''}`}
                  onClick={() => onPhaseClick?.(phase)}
                  disabled={!onPhaseClick}
                >
                  <i>{index + 1}</i>
                  <span>{phase.shortLabel ?? phase.label}</span>
                </button>
              ))}
            </div>
            <div className="pipeline-stage-scene">
              <div className="pipeline-leader">
                <span className="pipeline-robot is-leader">
                  <RoleAvatar role="lead" label={leader?.label ?? '需求负责人'} />
                </span>
                <span className="pipeline-chips">
                  <span className="pipeline-chip is-name">{leader?.label ?? '需求负责人'}</span>
                  <span className="pipeline-chip">{leader?.role ?? 'lead'}</span>
                  <span className="pipeline-chip is-lead">长</span>
                </span>
                <span className="pipeline-leader-status">
                  {leader
                    ? `协调 · ${STATUS_LABELS[leader.status]} · 任务 ${leader.tasks.length}`
                    : '等待团队'}
                </span>
              </div>
              <div
                className="pipeline-team-members"
                role="region"
                aria-label="团队成员，可横向滚动"
                tabIndex={0}
              >
                {members.map((member, index) => {
                  const currentTask =
                    member.tasks.find((task) => normalizeStatus(task) === 'active') ??
                    member.tasks.find((task) => normalizeStatus(task) === 'blocked');
                  const statusText =
                    member.status === 'active'
                      ? `执行 #${currentTask?.stepKey ?? currentTask?.id.slice(0, 6) ?? ''}`
                      : member.status === 'blocked'
                        ? '阻塞 · 等待处理'
                        : member.status === 'done'
                          ? '已完成'
                          : '空闲 · 等待';
                  return (
                    <div
                      className={`pipeline-member is-${member.status}${selectedRole && selectedRole !== member.role ? ' is-dim' : ''}`}
                      key={member.role}
                    >
                      <button
                        type="button"
                        className="pipeline-person-card"
                        aria-pressed={selectedRole === member.role}
                        onClick={() =>
                          setSelectedRole((role) => (role === member.role ? null : member.role))
                        }
                      >
                        <span className="pipeline-robot">
                          {member.status === 'pending' && (
                            <i className="pipeline-robot-zzz" aria-hidden="true">
                              zZ
                            </i>
                          )}
                          <RoleAvatar role={member.role} label={member.label} />
                        </span>
                        <span className="pipeline-robot-base" aria-hidden="true" />
                        <span className="pipeline-chips">
                          <span className="pipeline-chip is-name">{member.label}</span>
                          <span className="pipeline-chip">{member.role}</span>
                        </span>
                        <span className="pipeline-member-status">
                          <i aria-hidden="true" />
                          {statusText}
                        </span>
                      </button>
                      <span className="pipeline-member-no" data-member-no={member.role}>
                        #{index + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="pipeline-task-lanes" aria-label="任务分栏">
              <div className="pipeline-task-lane">
                <h4>
                  可立即领取 <small>{claimableCount}</small>
                </h4>
                {buckets.claimable.length ? (
                  buckets.claimable.map(renderTask)
                ) : (
                  <p>当前没有可立即领取的任务；只有直接前置步骤全部完成的任务才会计入这里。</p>
                )}
              </div>
              <div className="pipeline-task-lane">
                <h4>
                  等待中（前置 / 审批 / 待确认） <small>{waitingCount}</small>
                </h4>
                {buckets.waiting.length ? (
                  buckets.waiting.map(renderTask)
                ) : (
                  <p>没有等待中的任务。</p>
                )}
              </div>
              <div className="pipeline-task-lane">
                <h4>
                  执行中 / 阻塞 <small>{activeCount + blockedCount}</small>
                </h4>
                {[...buckets.active, ...buckets.blocked].length ? (
                  [...buckets.active, ...buckets.blocked].map(renderTask)
                ) : (
                  <p>暂无进行中的任务</p>
                )}
              </div>
              <div className="pipeline-task-lane">
                <h4>
                  已完成 <small>{doneCount}</small>
                </h4>
                {buckets.completed.length ? (
                  buckets.completed.map(renderTask)
                ) : (
                  <p>暂无已完成任务</p>
                )}
              </div>
            </div>
            <svg className="pipeline-wires" aria-hidden="true">
              {wires.map((wire) => (
                <path
                  key={wire.id}
                  className={selectedRole && selectedRole !== wire.role ? 'is-dim' : undefined}
                  d={wire.d}
                  stroke={wire.color}
                />
              ))}
              {wires.map((wire) => (
                <circle
                  key={`${wire.id}-dot`}
                  className={selectedRole && selectedRole !== wire.role ? 'is-dim' : undefined}
                  cx={wire.x}
                  cy={wire.y}
                  r={2.5}
                  fill={wire.color}
                />
              ))}
            </svg>
            <div className="pipeline-legend" aria-label="流程图例">
              <span>
                <i className="is-done" />
                完成
              </span>
              <span>
                <i className="is-active" />
                工作中
              </span>
              <span>
                <i className="is-blocked" />
                阻塞
              </span>
              <span>
                <i className="is-pending" />
                等待（含待确认）
              </span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
