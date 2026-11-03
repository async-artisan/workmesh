import { useLayoutEffect, useMemo, useRef, useState } from 'react';

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
  updatedAt?: string;
}
export interface RequirementPipelineProps {
  phases?: RequirementPipelinePhase[];
  tasks?: RequirementPipelineTask[];
  onPhaseClick?: (phase: RequirementPipelinePhase) => void;
  onTaskClick?: (task: RequirementPipelineTask) => void;
  className?: string;
  nextAction?: string;
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
const ROBOT_STYLE =
  ', standing pose, plain white background, soft studio lighting, full body, 3d render, toy style, high detail';
const ROBOT_PROMPTS: Record<string, string> = {
  lead: 'cute retro toy robot team leader wearing an orange jacket and holding a smartphone',
  product: 'cute retro toy robot product manager holding a clipboard and wearing a blue tie',
  ui: 'cute retro toy robot designer holding a paint palette and wearing a purple beret',
  frontend: 'cute retro toy robot engineer holding a laptop and wearing a gray hoodie',
  backend: 'cute retro toy robot engineer holding a wrench and wearing a gray hoodie',
  engineering: 'cute retro toy robot engineer holding a laptop and wearing a gray hoodie',
  qa: 'cute retro toy robot detective tester holding a magnifying glass and wearing a green vest',
  ops: 'cute retro toy robot operator with a small rocket backpack holding a checklist',
};
function robotAvatar(role?: string): string {
  const prompt = `${ROBOT_PROMPTS[role ?? ''] ?? 'cute retro toy robot assistant'}${ROBOT_STYLE}`;
  return `https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=square`;
}
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
function taskBucket(task: RequirementPipelineTask): 'ready' | 'active' | 'blocked' | 'done' {
  const status = normalizeStatus(task);
  if (status === 'blocked') return 'blocked';
  if (status === 'done' || status === 'skipped') return 'done';
  if (status === 'active') return 'active';
  return 'ready';
}

export function RequirementPipeline({
  phases = DEFAULT_PHASES,
  tasks = [],
  onPhaseClick,
  onTaskClick,
  className = '',
  nextAction,
}: RequirementPipelineProps) {
  const phaseModels = useMemo(
    () =>
      phases.map((phase) => {
        const phaseTasks =
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
        return { phase, tasks: phaseTasks, status: phaseStatus(phase, phaseTasks) };
      }),
    [phases, tasks],
  );
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
      ready: allTasks.filter((task) => taskBucket(task) === 'ready'),
      active: allTasks.filter((task) => taskBucket(task) === 'active'),
      blocked: allTasks.filter((task) => taskBucket(task) === 'blocked'),
      done: allTasks.filter((task) => taskBucket(task) === 'done'),
    }),
    [allTasks],
  );
  const doneCount = buckets.done.length;
  const activeCount = buckets.active.length;
  const blockedCount = buckets.blocked.length;
  const readyCount = buckets.ready.length;
  const derivedNextAction =
    nextAction ??
    phaseModels.find((item) => item.status === 'active' || item.status === 'blocked')?.phase
      .nextAction ??
    '等待流程推进';
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
  }, [members, allTasks]);
  const renderTask = (task: RequirementPipelineTask) => {
    const status = normalizeStatus(task);
    const deps = task.deps ?? task.blockedBy ?? [];
    const progress =
      status === 'done' || status === 'skipped'
        ? 100
        : status === 'active'
          ? 60
          : status === 'blocked'
            ? 30
            : 8;
    return (
      <button
        className={`pipeline-task-card is-${status}${selectedTaskIds && !selectedTaskIds.has(task.id) ? ' is-dim' : ''}`}
        type="button"
        key={task.id}
        data-task-id={task.id}
        onClick={() => onTaskClick?.(task)}
        disabled={!onTaskClick}
      >
        <span className="pipeline-task-card-top">
          <b>#{task.stepKey ?? task.id.slice(0, 6)}</b>
          <em>{STATUS_LABELS[status]}</em>
        </span>
        <strong>{task.title ?? task.stepKey ?? task.id}</strong>
        <span className="pipeline-task-card-owner">
          <img src={robotAvatar(task.role)} alt="" loading="lazy" />
          <span>
            {roleLabel(task.role, task.roleLabel)}
            {task.artifactCount !== undefined ? ` · ${task.artifactCount} 件证据` : ''}
          </span>
          <small>{deps.length ? `依赖 ${deps.map((dep) => `#${dep}`).join(' ')}` : '起点'}</small>
        </span>
        <span className="pipeline-task-card-progress" aria-hidden="true">
          <i style={{ width: `${progress}%` }} />
        </span>
      </button>
    );
  };
  return (
    <section
      ref={sectionRef}
      className={`requirement-pipeline ${className}`.trim()}
      aria-label="需求团队协作流程"
    >
      <div className="requirement-pipeline-head">
        <div>
          <span className="eyebrow">AGENT TEAM · READ ONLY</span>
          <h3>需求协作团队</h3>
        </div>
        <div className="pipeline-next-action">
          <span>下一步</span>
          <strong>{derivedNextAction}</strong>
        </div>
      </div>
      <div className="pipeline-team-stats">
        <span>
          <b>
            {doneCount}/{allTasks.length}
          </b>{' '}
          完成
        </span>
        <span>
          <b>{activeCount}</b> 进行中
        </span>
        <span>
          <b>{readyCount}</b> 待领
        </span>
        <span className={blockedCount ? 'is-alert' : ''}>
          <b>{blockedCount}</b> 阻塞
        </span>
      </div>
      <div className="pipeline-stage-rail" aria-label="阶段进度">
        {phaseModels.map(({ phase, status }, index) => (
          <button
            type="button"
            key={phase.id}
            className={`pipeline-stage-step is-${status}`}
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
            <img src={robotAvatar('lead')} alt={leader?.label ?? '需求负责人'} />
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
        <div className="pipeline-team-members">
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
                    <img src={robotAvatar(member.role)} alt={member.label} loading="lazy" />
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
      <div className="pipeline-task-lanes">
        <div className="pipeline-task-lane">
          <h4>
            无依赖 · 可立即领 <small>{readyCount}</small>
          </h4>
          {buckets.ready.length ? buckets.ready.map(renderTask) : <p>暂无可领取任务</p>}
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
            收尾 · 已完成 <small>{doneCount}</small>
          </h4>
          {buckets.done.length ? buckets.done.map(renderTask) : <p>暂无已完成任务</p>}
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
          等待
        </span>
      </div>
    </section>
  );
}
