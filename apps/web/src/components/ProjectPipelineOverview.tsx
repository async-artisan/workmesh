import { useMemo, useState } from 'react';

/** Project-level requirement shape. Extra fields are intentionally optional so the
 * component can consume list views as well as richer requirement detail payloads. */
export interface PipelineRequirement {
  id: string;
  code: string;
  title: string;
  phase: string;
  workStatus?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  tasks?: Array<{
    executionStatus?: string | null;
    workStatus?: string | null;
    artifactCount?: number;
  }>;
  artifacts?: Array<unknown>;
  reviews?: Array<{ status?: string | null }>;
  counts?: { tasks?: number; artifacts?: number; reviews?: number };
}

export type PipelineStageKey =
  | 'DISCOVERY'
  | 'DEFINITION'
  | 'DELIVERY'
  | 'ACCEPTANCE'
  | 'RELEASED'
  | 'ARCHIVED';

export interface PipelineStageDefinition {
  key: PipelineStageKey;
  label: string;
  shortLabel: string;
}

export interface ProjectPipelineOverviewProps {
  requirements: PipelineRequirement[];
  /** Called when a requirement card or timeline stage is activated. */
  onSelectRequirement?: (requirement: PipelineRequirement, stage?: PipelineStageKey) => void;
  /** Optional initial phase filter; defaults to all phases. */
  initialPhase?: PipelineStageKey | 'ALL';
  className?: string;
}

export const PIPELINE_STAGES: PipelineStageDefinition[] = [
  { key: 'DISCOVERY', label: '需求发现', shortLabel: '发现' },
  { key: 'DEFINITION', label: '定义', shortLabel: '定义' },
  { key: 'DELIVERY', label: '交付', shortLabel: '交付' },
  { key: 'ACCEPTANCE', label: '验收', shortLabel: '验收' },
  { key: 'RELEASED', label: '已发布', shortLabel: '发布' },
  { key: 'ARCHIVED', label: '已归档', shortLabel: '归档' },
];

const PHASE_INDEX = new Map(PIPELINE_STAGES.map((stage, index) => [stage.key, index]));
const normalizePhase = (phase: string): PipelineStageKey =>
  PHASE_INDEX.has(phase as PipelineStageKey) ? (phase as PipelineStageKey) : 'DISCOVERY';

function stageStatus(requirement: PipelineRequirement, stage: PipelineStageKey) {
  const current = PHASE_INDEX.get(normalizePhase(requirement.phase)) ?? 0;
  const target = PHASE_INDEX.get(stage) ?? 0;
  if (requirement.workStatus === 'BLOCKED' && target === current) return 'blocked';
  if (requirement.workStatus === 'PAUSED' && target === current) return 'paused';
  if (target < current) return 'done';
  if (target === current) return 'current';
  return 'pending';
}

function countOf(requirement: PipelineRequirement, key: 'tasks' | 'artifacts' | 'reviews') {
  const explicit = requirement.counts?.[key];
  if (typeof explicit === 'number') return explicit;
  return requirement[key]?.length ?? 0;
}

function formatUpdated(value?: string | null) {
  if (!value) return '暂无更新时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

const css = `
.pipeline-overview { color: var(--text-primary, #0f172a); }
.pipeline-overview__toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:12px 0 18px; }
.pipeline-overview__search { flex:1 1 220px; min-width:180px; }
.pipeline-overview__filter { min-width:130px; }
.pipeline-overview__stats { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:18px; }
.pipeline-overview__stat { border:1px solid var(--border, #e2e8f0); border-radius:9px; background:var(--surface, #fff); padding:9px 13px; min-width:94px; }
.pipeline-overview__stat strong { display:block; font-size:18px; }
.pipeline-overview__stat span { color:var(--text-secondary, #64748b); font-size:12px; }
.pipeline-overview__timeline { display:flex; align-items:flex-start; overflow-x:auto; padding:4px 2px 14px; margin-bottom:18px; }
.pipeline-overview__stage { display:flex; align-items:flex-start; min-width:112px; flex:1; }
.pipeline-overview__stage-button { border:0; background:none; color:inherit; cursor:pointer; padding:0; text-align:center; min-width:70px; }
.pipeline-overview__stage-dot { display:grid; place-items:center; width:28px; height:28px; margin:0 auto 6px; border:2px solid var(--border-strong,#cbd5e1); border-radius:50%; background:var(--surface,#fff); font-size:12px; }
.pipeline-overview__stage-button[data-active='true'] .pipeline-overview__stage-dot { border-color:var(--accent,#0891b2); color:var(--accent,#0891b2); box-shadow:0 0 0 4px var(--accent-soft,rgba(8,145,178,.08)); }
.pipeline-overview__stage-label { font-size:12px; white-space:nowrap; }
.pipeline-overview__stage-count { display:block; color:var(--text-muted,#7b8aa0); font-size:11px; margin-top:3px; }
.pipeline-overview__connector { height:2px; flex:1; min-width:22px; margin:14px 5px 0; background:var(--border,#e2e8f0); }
.pipeline-overview__connector[data-complete='true'] { background:var(--success,#059669); }
.pipeline-overview__list { display:grid; gap:10px; }
.pipeline-overview__row { border:1px solid var(--border,#e2e8f0); border-radius:10px; background:var(--surface,#fff); padding:13px 15px; cursor:pointer; text-align:left; width:100%; }
.pipeline-overview__row:hover, .pipeline-overview__row:focus-visible { border-color:var(--accent-border,#0891b2); box-shadow:0 0 0 3px var(--accent-soft,rgba(8,145,178,.08)); outline:none; }
.pipeline-overview__row-head { display:flex; align-items:center; gap:9px; justify-content:space-between; }
.pipeline-overview__title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pipeline-overview__code, .pipeline-overview__badge { font-size:11px; border-radius:999px; padding:3px 8px; white-space:nowrap; }
.pipeline-overview__code { color:var(--accent-hover,#0e7490); background:var(--accent-soft,rgba(8,145,178,.08)); }
.pipeline-overview__badge { background:var(--surface-hover,#f1f5f9); color:var(--text-secondary,#475569); }
.pipeline-overview__badge[data-status='blocked'] { color:var(--danger,#e11d48); background:var(--danger-soft,rgba(225,29,72,.07)); }
.pipeline-overview__badge[data-status='paused'] { color:var(--warning,#d97706); background:var(--warning-soft,rgba(217,119,6,.08)); }
.pipeline-overview__meta { display:flex; gap:14px; flex-wrap:wrap; color:var(--text-secondary,#64748b); font-size:12px; margin-top:9px; }
.pipeline-overview__progress { display:flex; gap:4px; margin-top:12px; }
.pipeline-overview__progress i { height:5px; flex:1; border-radius:5px; background:var(--border,#e2e8f0); }
.pipeline-overview__progress i[data-state='done'] { background:var(--success,#059669); }
.pipeline-overview__progress i[data-state='current'] { background:var(--accent,#0891b2); }
.pipeline-overview__progress i[data-state='blocked'] { background:var(--danger,#e11d48); }
.pipeline-overview__empty { padding:28px; text-align:center; color:var(--text-muted,#7b8aa0); border:1px dashed var(--border-strong,#cbd5e1); border-radius:10px; }
@media (max-width:620px) { .pipeline-overview__stage { min-width:92px; } .pipeline-overview__row-head { align-items:flex-start; flex-direction:column; gap:6px; } }
`;

export function ProjectPipelineOverview({
  requirements,
  onSelectRequirement,
  initialPhase = 'ALL',
  className = '',
}: ProjectPipelineOverviewProps) {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<PipelineStageKey | 'ALL'>(initialPhase);
  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      requirements.filter((requirement) => {
        if (phase !== 'ALL' && normalizePhase(requirement.phase) !== phase) return false;
        if (!normalizedQuery) return true;
        return `${requirement.code} ${requirement.title}`.toLowerCase().includes(normalizedQuery);
      }),
    [normalizedQuery, phase, requirements],
  );

  const stageCounts = useMemo(
    () =>
      PIPELINE_STAGES.map((stage) => ({
        ...stage,
        count: requirements.filter((requirement) => normalizePhase(requirement.phase) === stage.key)
          .length,
      })),
    [requirements],
  );
  const blockedCount = requirements.filter((item) => item.workStatus === 'BLOCKED').length;
  const activeCount = requirements.filter((item) => !['RELEASED', 'ARCHIVED'].includes(item.phase)).length;

  return (
    <section className={`pipeline-overview ${className}`.trim()} aria-label="项目需求流水线">
      <style>{css}</style>
      <div className="pipeline-overview__stats" aria-label="项目流水线统计">
        <div className="pipeline-overview__stat"><strong>{requirements.length}</strong><span>全部需求</span></div>
        <div className="pipeline-overview__stat"><strong>{activeCount}</strong><span>进行中</span></div>
        <div className="pipeline-overview__stat"><strong>{blockedCount}</strong><span>阻塞</span></div>
        <div className="pipeline-overview__stat"><strong>{filtered.length}</strong><span>当前显示</span></div>
      </div>

      <div className="pipeline-overview__toolbar">
        <input
          className="pipeline-overview__search"
          aria-label="搜索需求"
          placeholder="搜索编号或标题"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="pipeline-overview__filter"
          aria-label="按阶段筛选"
          value={phase}
          onChange={(event) => setPhase(event.target.value as PipelineStageKey | 'ALL')}
        >
          <option value="ALL">全部阶段</option>
          {PIPELINE_STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}
        </select>
      </div>

      <div className="pipeline-overview__timeline" aria-label="需求阶段时间线">
        {stageCounts.map((stage, index) => (
          <div className="pipeline-overview__stage" key={stage.key}>
            <button
              className="pipeline-overview__stage-button"
              data-active={phase === stage.key}
              aria-pressed={phase === stage.key}
              onClick={() => setPhase(phase === stage.key ? 'ALL' : stage.key)}
            >
              <span className="pipeline-overview__stage-dot">{stage.count}</span>
              <span className="pipeline-overview__stage-label">{stage.shortLabel}</span>
              <span className="pipeline-overview__stage-count">{stage.label}</span>
            </button>
            {index < PIPELINE_STAGES.length - 1 && <span className="pipeline-overview__connector" data-complete={stage.count > 0} />}
          </div>
        ))}
      </div>

      <div className="pipeline-overview__list">
        {filtered.length === 0 ? (
          <div className="pipeline-overview__empty">没有符合筛选条件的需求。</div>
        ) : filtered.map((requirement) => {
          const current = normalizePhase(requirement.phase);
          const status = requirement.workStatus === 'BLOCKED' ? 'blocked' : requirement.workStatus === 'PAUSED' ? 'paused' : current;
          return (
            <button
              className="pipeline-overview__row"
              key={requirement.id}
              onClick={() => onSelectRequirement?.(requirement)}
              type="button"
            >
              <span className="pipeline-overview__row-head">
                <span className="pipeline-overview__title"><span className="pipeline-overview__code">{requirement.code}</span> {requirement.title}</span>
                <span className="pipeline-overview__badge" data-status={status}>{requirement.workStatus === 'BLOCKED' ? '阻塞' : requirement.workStatus === 'PAUSED' ? '暂停' : PIPELINE_STAGES.find((item) => item.key === current)?.label}</span>
              </span>
              <span className="pipeline-overview__meta">
                <span>任务 {countOf(requirement, 'tasks')}</span>
                <span>产物 {countOf(requirement, 'artifacts')}</span>
                <span>评审 {countOf(requirement, 'reviews')}</span>
                <span>更新于 {formatUpdated(requirement.updatedAt)}</span>
              </span>
              <span className="pipeline-overview__progress" aria-label={`${requirement.title} 阶段进度`}>
                {PIPELINE_STAGES.map((stage) => <i key={stage.key} data-state={stageStatus(requirement, stage.key as PipelineStageKey)} />)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
