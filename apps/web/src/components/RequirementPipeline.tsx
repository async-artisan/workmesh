import { useMemo } from 'react';

export type PipelineStatus = 'done' | 'active' | 'blocked' | 'pending' | 'skipped';
export interface RequirementPipelineTask {
  id: string; stepKey?: string; title?: string; role?: string; roleLabel?: string;
  status?: string; workStatus?: string | null; executionStatus?: string;
  artifactCount?: number; blockedBy?: string[]; deps?: string[]; updatedAt?: string;
}
export interface RequirementPipelinePhase {
  id: string; label: string; shortLabel?: string; role?: string; roleLabel?: string;
  status?: PipelineStatus; tasks?: RequirementPipelineTask[]; blockedBy?: string[];
  nextAction?: string; updatedAt?: string;
}
export interface RequirementPipelineProps {
  phases?: RequirementPipelinePhase[]; tasks?: RequirementPipelineTask[];
  onPhaseClick?: (phase: RequirementPipelinePhase) => void;
  onTaskClick?: (task: RequirementPipelineTask) => void;
  className?: string; nextAction?: string;
}

const DEFAULT_PHASES: Array<Pick<RequirementPipelinePhase, 'id' | 'label' | 'shortLabel' | 'role'>> = [
  { id: 'discovery', label: '需求发现', shortLabel: '发现', role: 'product' },
  { id: 'definition', label: '方案定义', shortLabel: '定义', role: 'product' },
  { id: 'design', label: '体验设计', shortLabel: '设计', role: 'ui' },
  { id: 'build', label: '开发实现', shortLabel: '开发', role: 'engineering' },
  { id: 'verify', label: '测试验证', shortLabel: '验证', role: 'qa' },
  { id: 'release', label: '发布上线', shortLabel: '发布', role: 'ops' },
];
const ROLE_AVATARS: Record<string, string> = { product: '🧑‍💼', ui: '🎨', frontend: '🧑‍💻', backend: '🛠️', engineering: '🧑‍💻', qa: '🕵️', ops: '🚀' };
const ROLE_LABELS: Record<string, string> = { product: '产品', ui: '设计', frontend: '前端', backend: '后端', engineering: '研发', qa: '测试', ops: '运维' };
const STATUS_LABELS: Record<PipelineStatus, string> = { done: '完成', active: '工作中', blocked: '阻塞', pending: '等待', skipped: '跳过' };

function normalizeStatus(task: RequirementPipelineTask): PipelineStatus {
  const status = task.workStatus ?? task.executionStatus ?? task.status;
  if (status === 'BLOCKED') return 'blocked';
  if (status === 'DONE' || status === 'DELIVERED' || status === 'APPROVED') return 'done';
  if (status === 'ACTIVE' || status === 'IN_PROGRESS' || status === 'REVIEW_PENDING') return 'active';
  if (status === 'CANCELLED') return 'skipped';
  return 'pending';
}
function phaseStatus(phase: RequirementPipelinePhase, tasks: RequirementPipelineTask[]): PipelineStatus {
  if (phase.status) return phase.status;
  if (tasks.some((task) => normalizeStatus(task) === 'blocked')) return 'blocked';
  if (tasks.length > 0 && tasks.every((task) => normalizeStatus(task) === 'done')) return 'done';
  if (tasks.some((task) => ['active', 'done'].includes(normalizeStatus(task)))) return 'active';
  return 'pending';
}
function roleLabel(role?: string, explicit?: string): string { return explicit ?? (role ? ROLE_LABELS[role] ?? role : '未分配'); }
function taskBucket(task: RequirementPipelineTask): 'ready' | 'active' | 'blocked' | 'done' {
  const status = normalizeStatus(task);
  if (status === 'blocked') return 'blocked';
  if (status === 'done' || status === 'skipped') return 'done';
  if (status === 'active') return 'active';
  return 'ready';
}

export function RequirementPipeline({ phases = DEFAULT_PHASES, tasks = [], onPhaseClick, onTaskClick, className = '', nextAction }: RequirementPipelineProps) {
  const phaseModels = useMemo(() => phases.map((phase) => {
    const phaseTasks = phase.tasks ?? tasks.filter((task) => {
      const key = `${task.stepKey ?? ''} ${task.title ?? ''}`.toLowerCase();
      return phase.id === 'build' ? /impl|front|back|develop|build/.test(key) : phase.id === 'verify' ? /test|verify|qa|case/.test(key) : phase.id === 'release' ? /release|deploy|ops/.test(key) : phase.id === task.stepKey;
    });
    return { phase, tasks: phaseTasks, status: phaseStatus(phase, phaseTasks) };
  }), [phases, tasks]);
  const allTasks = useMemo(() => phaseModels.flatMap((model) => model.tasks), [phaseModels]);
  const members = useMemo(() => {
    const map = new Map<string, { role: string; label: string; avatar: string; tasks: RequirementPipelineTask[]; status: PipelineStatus }>();
    phaseModels.forEach(({ phase, tasks: phaseTasks, status }) => {
      const role = phase.role ?? phaseTasks[0]?.role ?? 'engineering';
      const existing = map.get(role);
      if (existing) { existing.tasks.push(...phaseTasks); if (status === 'blocked' || (status === 'active' && existing.status === 'pending')) existing.status = status; }
      else map.set(role, { role, label: roleLabel(role, phase.roleLabel), avatar: ROLE_AVATARS[role] ?? '👤', tasks: [...phaseTasks], status });
    });
    return [...map.values()];
  }, [phaseModels]);
  const leader = members.find((member) => member.status === 'active' || member.status === 'blocked') ?? members[0];
  const buckets = useMemo(() => ({
    ready: allTasks.filter((task) => taskBucket(task) === 'ready'),
    active: allTasks.filter((task) => taskBucket(task) === 'active'),
    blocked: allTasks.filter((task) => taskBucket(task) === 'blocked'),
    done: allTasks.filter((task) => taskBucket(task) === 'done'),
  }), [allTasks]);
  const doneCount = buckets.done.length;
  const activeCount = buckets.active.length;
  const blockedCount = buckets.blocked.length;
  const readyCount = buckets.ready.length;
  const derivedNextAction = nextAction ?? phaseModels.find((item) => item.status === 'active' || item.status === 'blocked')?.phase.nextAction ?? '等待流程推进';
  const renderTask = (task: RequirementPipelineTask) => {
    const status = normalizeStatus(task);
    const deps = task.deps ?? task.blockedBy ?? [];
    return <button className={`pipeline-task-card is-${status}`} type="button" key={task.id} onClick={() => onTaskClick?.(task)} disabled={!onTaskClick}>
      <span className="pipeline-task-card-top"><b>#{task.stepKey ?? task.id.slice(0, 6)}</b><em>{STATUS_LABELS[status]}</em></span>
      <strong>{task.title ?? task.stepKey ?? task.id}</strong>
      <small>{roleLabel(task.role, task.roleLabel)}{task.artifactCount !== undefined ? ` · ${task.artifactCount} 件证据` : ''}</small>
      <span className="pipeline-task-card-deps">{deps.length ? `依赖 ${deps.map((dep) => `#${dep}`).join(' ')}` : '无依赖 · 可立即领'}</span>
    </button>;
  };
  return <section className={`requirement-pipeline ${className}`.trim()} aria-label="需求团队协作流程">
    <div className="requirement-pipeline-head"><div><span className="eyebrow">AGENT TEAM · READ ONLY</span><h3>需求协作团队</h3></div><div className="pipeline-next-action"><span>下一步</span><strong>{derivedNextAction}</strong></div></div>
    <div className="pipeline-team-stats"><span><b>{doneCount}/{allTasks.length}</b> 完成</span><span><b>{activeCount}</b> 进行中</span><span><b>{readyCount}</b> 待领</span><span className={blockedCount ? 'is-alert' : ''}><b>{blockedCount}</b> 阻塞</span></div>
    <div className="pipeline-stage-rail" aria-label="阶段进度">{phaseModels.map(({ phase, status }, index) => <button type="button" key={phase.id} className={`pipeline-stage-step is-${status}`} onClick={() => onPhaseClick?.(phase)} disabled={!onPhaseClick}><i>{index + 1}</i><span>{phase.shortLabel ?? phase.label}</span></button>)}</div>
    <div className="pipeline-stage-scene">
      <div className="pipeline-leader"><div className="pipeline-person-avatar is-leader">{leader?.avatar ?? '🧭'}</div><strong>{leader?.label ?? '需求负责人'}</strong><small>{leader ? `协调 ${leader.tasks.length} 项任务` : '等待团队'}</small><span className="pipeline-person-status">{leader ? STATUS_LABELS[leader.status] : '待开始'}</span></div>
      <div className="pipeline-team-members">{members.map((member, index) => <div className={`pipeline-member is-${member.status}`} key={member.role}>
        <span className="pipeline-member-line" aria-hidden="true" />
        <button type="button" className="pipeline-person-card" onClick={() => { const phase = phaseModels.find((item) => item.phase.role === member.role); if (phase) onPhaseClick?.(phase.phase); }} disabled={!onPhaseClick}><span className="pipeline-person-avatar">{member.avatar}</span><strong>{member.label}</strong><small>{member.status === 'active' ? '执行中' : member.status === 'blocked' ? '等待处理' : member.status === 'done' ? '已完成' : '空闲 · 等待'}</small><span className="pipeline-person-progress"><i style={{ width: `${member.status === 'done' ? 100 : member.status === 'active' ? 58 : member.status === 'blocked' ? 32 : 8}%` }} /></span><b>#{index + 1}</b></button>
      </div>)}</div>
    </div>
    <div className="pipeline-task-lanes">
      <div className="pipeline-task-lane"><h4>无依赖 · 可立即领 <small>{readyCount}</small></h4>{buckets.ready.length ? buckets.ready.map(renderTask) : <p>暂无可领取任务</p>}</div>
      <div className="pipeline-task-lane"><h4>执行中 / 阻塞 <small>{activeCount + blockedCount}</small></h4>{[...buckets.active, ...buckets.blocked].length ? [...buckets.active, ...buckets.blocked].map(renderTask) : <p>暂无进行中的任务</p>}</div>
      <div className="pipeline-task-lane"><h4>收尾 · 已完成 <small>{doneCount}</small></h4>{buckets.done.length ? buckets.done.map(renderTask) : <p>暂无已完成任务</p>}</div>
    </div>
    <div className="pipeline-legend" aria-label="流程图例"><span><i className="is-done" />完成</span><span><i className="is-active" />工作中</span><span><i className="is-blocked" />阻塞</span><span><i className="is-pending" />等待</span></div>
  </section>;
}
