import { useEffect, useMemo, useState } from 'react';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import {
  PIPELINE_PHASE_DEFINITIONS,
  PIPELINE_STAT_DEFINITIONS,
  computePipelineStats,
  describeRequirementState,
  normalizePhase,
  phaseLabelOf,
  requirementStageProgress,
  stageConnectorCompletion,
  stageCounts,
  stageProgressDescription,
  stageProgressLabel,
  type PipelinePhase,
  type PipelineRequirementSignals,
  type PipelineStatKey,
  type StageProgressState,
} from '../lib/pipelineStatus';

/** Project-level requirement shape. Extra fields are optional so richer payloads can be consumed. */
export interface PipelineRequirement extends PipelineRequirementSignals {
  id: string;
  code: string;
  title: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  /** 仅当调用方拿到更丰富载荷时展示；列表接口当前不返回任务/工件/评审计数。 */
  tasks?: Array<{ executionStatus?: string | null; workStatus?: string | null }>;
  artifacts?: unknown[];
  reviews?: Array<{ status?: string | null }>;
  counts?: { tasks?: number; artifacts?: number; reviews?: number };
}

export type PipelineStageKey = PipelinePhase;

export interface PipelineStageDefinition {
  key: PipelineStageKey;
  label: string;
  shortLabel: string;
}

export interface ProjectPipelineOverviewProps {
  requirements: PipelineRequirement[];
  /** Called when a requirement card is activated. */
  onSelectRequirement?: (requirement: PipelineRequirement) => void;
  /** Optional initial phase filter; defaults to all phases. */
  initialPhase?: PipelinePhase | 'ALL' | 'UNKNOWN';
  /**
   * 分页读取是否完整。false 时总需求统计改称“已读取需求（不完整）”，
   * 不能把已读取数量当成项目总需求数。
   */
  requirementsComplete?: boolean;
  className?: string;
  /** 项目 ID：用于按项目记住筛选条件，从详情返回后不丢 triage 上下文。 */
  projectId?: string;
}

/** 兼容旧引用；阶段定义现由 lib/pipelineStatus 统一提供。 */
export const PIPELINE_STAGES: PipelineStageDefinition[] = PIPELINE_PHASE_DEFINITIONS;

type PhaseFilter = PipelinePhase | 'ALL' | 'UNKNOWN';
type StatusFilter = Exclude<PipelineStatKey, 'ALL'> | 'ALL';

const FILTER_STORAGE_PREFIX = 'workmesh.pipelineFilters.';

interface PersistedFilters {
  query: string;
  phase: PhaseFilter;
  status: StatusFilter;
}

/** 只恢复合法值：本地存储可能被旧版本/手改污染，不能拿它直接决定渲染。 */
function readPersistedFilters(key: string): Partial<PersistedFilters> {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedFilters>;
    const phaseKeys = new Set<string>([
      ...PIPELINE_PHASE_DEFINITIONS.map((stage) => stage.key),
      'ALL',
      'UNKNOWN',
    ]);
    const statusKeys = new Set<string>(PIPELINE_STAT_DEFINITIONS.map((item) => item.key));
    statusKeys.add('ALL');
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      phase:
        typeof parsed.phase === 'string' && phaseKeys.has(parsed.phase)
          ? (parsed.phase as PhaseFilter)
          : undefined,
      status:
        typeof parsed.status === 'string' && statusKeys.has(parsed.status)
          ? (parsed.status as StatusFilter)
          : undefined,
    };
  } catch {
    return {};
  }
}

function formatUpdated(value?: string | null) {
  if (!value) return '更新时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '更新时间未知';
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(date);
}

function explicitCount(
  requirement: PipelineRequirement,
  key: 'tasks' | 'artifacts' | 'reviews',
): number | null {
  const explicit = requirement.counts?.[key];
  if (typeof explicit === 'number') return explicit;
  const list = requirement[key];
  return Array.isArray(list) ? list.length : null;
}

const PROGRESS_LEGEND = '已完成 / 已越过 / 当前 / 待进入';

const css = `
.pipeline-overview { color: var(--text-primary, #0f172a); }
.pipeline-overview__stats { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 8px; }
.pipeline-overview__stat { border:1px solid var(--border, #e2e8f0); border-radius:9px; background:var(--surface, #fff); padding:9px 13px; min-width:88px; text-align:left; cursor:pointer; font:inherit; color:inherit; }
.pipeline-overview__stat[aria-pressed='true'] { border-color:var(--accent,#0891b2); box-shadow:0 0 0 3px var(--accent-soft,rgba(8,145,178,.08)); }
.pipeline-overview__stat strong { display:block; font-size:18px; }
.pipeline-overview__stat span { color:var(--text-secondary, #64748b); font-size:12px; }
.pipeline-overview__stat-note { color:var(--text-muted,#7b8aa0); font-size:12px; margin:0 0 14px; }
.pipeline-overview__toolbar { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin:12px 0 18px; }
.pipeline-overview__search { flex:1 1 220px; min-width:180px; }
.pipeline-overview__filter { min-width:130px; }
.pipeline-overview__timeline { display:flex; align-items:flex-start; overflow-x:auto; padding:4px 2px 14px; margin-bottom:8px; }
.pipeline-overview__stage { display:flex; align-items:flex-start; min-width:132px; flex:1; }
.pipeline-overview__stage-button { border:0; background:none; color:inherit; cursor:pointer; padding:0; text-align:center; min-width:96px; }
.pipeline-overview__stage-button:focus-visible { outline:2px solid var(--accent,#0891b2); outline-offset:3px; border-radius:6px; }
.pipeline-overview__stage-dot { display:grid; place-items:center; width:28px; height:28px; margin:0 auto 6px; border:2px solid var(--border-strong,#cbd5e1); border-radius:50%; background:var(--surface,#fff); font-size:12px; }
.pipeline-overview__stage-button[data-active='true'] .pipeline-overview__stage-dot { border-color:var(--accent,#0891b2); color:var(--accent,#0891b2); box-shadow:0 0 0 4px var(--accent-soft,rgba(8,145,178,.08)); }
.pipeline-overview__stage-label { font-size:12px; white-space:nowrap; }
.pipeline-overview__stage-count { display:block; color:var(--text-muted,#7b8aa0); font-size:11px; margin-top:3px; white-space:nowrap; }
.pipeline-overview__connector { align-self:flex-start; height:2px; flex:1; min-width:22px; margin:14px 5px 0; background:var(--border,#e2e8f0); }
.pipeline-overview__connector[data-complete='true'] { background:var(--success,#059669); }
.pipeline-overview__timeline-note { color:var(--text-muted,#7b8aa0); font-size:12px; margin:0 0 18px; }
.pipeline-overview__list { display:grid; gap:10px; }
.pipeline-overview__row { border:1px solid var(--border,#e2e8f0); border-radius:10px; background:var(--surface,#fff); padding:13px 15px; cursor:pointer; text-align:left; width:100%; }
.pipeline-overview__row:hover, .pipeline-overview__row:focus-visible { border-color:var(--accent-border,#0891b2); box-shadow:0 0 0 3px var(--accent-soft,rgba(8,145,178,.08)); outline:none; }
.pipeline-overview__row-head { display:flex; align-items:center; gap:9px; justify-content:space-between; }
.pipeline-overview__title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pipeline-overview__code, .pipeline-overview__badge { font-size:11px; border-radius:999px; padding:3px 8px; white-space:nowrap; }
.pipeline-overview__code { color:var(--accent-hover,#0e7490); background:var(--accent-soft,rgba(8,145,178,.08)); }
.pipeline-overview__badge { background:var(--surface-hover,#f1f5f9); color:var(--text-secondary,#475569); }
.pipeline-overview__badge[data-kind='phase'] { background:var(--surface-hover,#f1f5f9); color:var(--text-primary,#0f172a); }
.pipeline-overview__badge[data-status='active'] { background:var(--accent-soft,rgba(8,145,178,.08)); color:var(--accent-hover,#0e7490); }
.pipeline-overview__badge[data-status='blocked'] { color:var(--danger,#e11d48); background:var(--danger-soft,rgba(225,29,72,.07)); }
.pipeline-overview__badge[data-status='paused'] { color:var(--warning,#d97706); background:var(--warning-soft,rgba(217,119,6,.08)); }
.pipeline-overview__badge[data-status='cancelled'] { color:var(--text-muted,#7b8aa0); background:var(--surface-hover,#f1f5f9); }
.pipeline-overview__badge[data-status='unknown'] { color:var(--text-secondary,#475569); background:var(--surface-hover,#f1f5f9); }
.pipeline-overview__meta { display:flex; gap:14px; flex-wrap:wrap; align-items:center; color:var(--text-secondary,#64748b); font-size:12px; margin-top:9px; }
.pipeline-overview__hint { color:var(--text-muted,#7b8aa0); font-size:12px; margin-top:7px; }
.pipeline-overview__progress { display:flex; gap:4px; margin-top:12px; }
.pipeline-overview__progress i { height:5px; flex:1; border-radius:5px; background:var(--border,#e2e8f0); }
.pipeline-overview__progress i[data-state='complete'] { background:var(--success,#059669); }
.pipeline-overview__progress i[data-state='passed'] { background:var(--border-strong,#cbd5e1); }
.pipeline-overview__progress i[data-state='current'] { background:var(--accent,#0891b2); }
.pipeline-overview__progress i[data-state='unknown'] { background:repeating-linear-gradient(90deg,var(--border,#e2e8f0),var(--border,#e2e8f0) 4px,transparent 4px,transparent 8px); }
.pipeline-overview__empty { padding:28px; text-align:center; color:var(--text-muted,#7b8aa0); border:1px dashed var(--border-strong,#cbd5e1); border-radius:10px; }
.pipeline-overview__sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
@media (max-width:620px) {
  /* 窄屏时间线改为两列网格：阶段按钮不再横向滚出视口，连接线隐藏。 */
  .pipeline-overview__timeline { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px 10px; overflow:visible; }
  .pipeline-overview__stage { min-width:0; }
  .pipeline-overview__connector { display:none; }
  .pipeline-overview__stage-button { min-width:0; width:100%; }
  .pipeline-overview__stage-label, .pipeline-overview__stage-count { white-space:normal; }
  .pipeline-overview__row-head { align-items:flex-start; flex-direction:column; gap:6px; }
}
`;

function progressSummary(requirement: PipelineRequirement): string {
  return PIPELINE_PHASE_DEFINITIONS.map((stage) => {
    const state = requirementStageProgress(requirement, stage.key);
    return `${stage.label}：${stageProgressLabel(state)}（${stageProgressDescription(state)}）`;
  }).join('；');
}

export function ProjectPipelineOverview({
  requirements,
  onSelectRequirement,
  initialPhase = 'ALL',
  requirementsComplete = true,
  className = '',
  projectId,
}: ProjectPipelineOverviewProps) {
  const storageKey = projectId ? `${FILTER_STORAGE_PREFIX}${projectId}` : '';
  const [restored] = useState<Partial<PersistedFilters> | null>(() =>
    storageKey ? readPersistedFilters(storageKey) : null,
  );
  const [query, setQuery] = useState(restored?.query ?? '');
  const [phase, setPhase] = useState<PhaseFilter>(restored?.phase ?? initialPhase);
  const [status, setStatus] = useState<StatusFilter>(restored?.status ?? 'ALL');
  const narrow = useNarrowViewport();
  const normalizedQuery = query.trim().toLowerCase();

  // 筛选条件写入 sessionStorage：列表→需求详情→返回、刷新页面都不丢；关掉标签页即清理。
  useEffect(() => {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ query, phase, status }));
    } catch {
      // 存储不可用时只失去记忆能力，不影响筛选本身。
    }
  }, [storageKey, query, phase, status]);

  const stats = useMemo(() => computePipelineStats(requirements), [requirements]);
  const timeline = useMemo(() => stageCounts(requirements), [requirements]);
  const unknownPhaseCount = useMemo(
    () => requirements.filter((requirement) => normalizePhase(requirement.phase) === null).length,
    [requirements],
  );
  const hasCompletionEvidence = useMemo(
    () =>
      requirements.some(
        (requirement) => (requirement.stageCompletion?.completedPhases?.length ?? 0) > 0,
      ),
    [requirements],
  );

  const filtered = useMemo(
    () =>
      requirements.filter((requirement) => {
        const normalized = normalizePhase(requirement.phase);
        if (phase === 'ALL') {
          // all phases
        } else if (phase === 'UNKNOWN') {
          if (normalized !== null) return false;
        } else if (normalized !== phase) {
          return false;
        }
        if (status !== 'ALL') {
          const state = describeRequirementState(requirement);
          if (state.statKey !== status) return false;
        }
        if (!normalizedQuery) return true;
        return `${requirement.code} ${requirement.title}`.toLowerCase().includes(normalizedQuery);
      }),
    [normalizedQuery, phase, requirements, status],
  );

  function chooseStatus(next: StatusFilter) {
    setStatus((current) => (current === next ? 'ALL' : next));
    // 统计卡与列表联动：切换执行状态筛选时清除阶段/搜索，保证数字与列表一致。
    if (next !== 'ALL') {
      setPhase('ALL');
      setQuery('');
    }
  }

  // 窄屏把搜索/筛选提到统计与时间线之前，triage 时不必先滚过概览。
  const toolbar = (
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
        onChange={(event) => setPhase(event.target.value as PhaseFilter)}
      >
        <option value="ALL">全部阶段</option>
        {PIPELINE_PHASE_DEFINITIONS.map((stage) => (
          <option key={stage.key} value={stage.key}>
            {stage.label}
          </option>
        ))}
        <option value="UNKNOWN">阶段待确认</option>
      </select>
    </div>
  );

  return (
    <section className={`pipeline-overview ${className}`.trim()} aria-label="项目需求流水线">
      <style>{css}</style>

      {narrow && toolbar}

      <div className="pipeline-overview__stats" aria-label="需求执行状态统计">
        <button
          type="button"
          className="pipeline-overview__stat"
          aria-pressed={status === 'ALL'}
          aria-label={`${
            requirementsComplete ? '全部需求' : '已读取需求'
          }：${stats.total} 条${status === 'ALL' ? '，当前筛选' : ''}${
            requirementsComplete ? '' : '，列表可能不完整，不代表项目总需求数'
          }`}
          onClick={() => chooseStatus('ALL')}
        >
          <strong>{stats.total}</strong>
          <span>{requirementsComplete ? '全部需求' : '已读取需求（不完整）'}</span>
        </button>
        {PIPELINE_STAT_DEFINITIONS.map((definition) => {
          const count = stats.counts[definition.key];
          // 窄屏只保留有数字的状态，避免 10 个统计块把首条需求推到 3 屏之后。
          if (narrow && count === 0) return null;
          const active = status === definition.key;
          return (
            <button
              type="button"
              key={definition.key}
              className="pipeline-overview__stat"
              aria-pressed={active}
              aria-label={`${definition.label}：${count} 条${active ? '，当前筛选' : ''}。口径：${definition.description}`}
              onClick={() => chooseStatus(definition.key)}
            >
              <strong>{count}</strong>
              <span>{definition.label}</span>
            </button>
          );
        })}
        {!narrow && (
          <div className="pipeline-overview__stat" aria-label={`当前显示 ${filtered.length} 条`}>
            <strong>{filtered.length}</strong>
            <span>当前显示</span>
          </div>
        )}
      </div>
      {narrow ? (
        <details className="pipeline-overview__explain">
          <summary>统计口径说明</summary>
          <p className="pipeline-overview__stat-note">
            执行状态按服务端 workStatus 分类；「已发布/已归档」按业务阶段 phase
            统计；缺少/未知状态计入「状态待确认」。
            {requirementsComplete
              ? ''
              : ' 分页读取未完成：当前统计仅覆盖已读取需求，不代表项目总需求数。'}
          </p>
        </details>
      ) : (
        <p className="pipeline-overview__stat-note">
          统计口径：执行状态按服务端 workStatus 分类；「已发布/已归档」按业务阶段 phase
          统计；缺少/未知状态计入「状态待确认」。未开始仅在服务端显式返回 executionStatus=OPEN
          时计入；显式 null/未知执行状态会进入「状态待确认」。
          {requirementsComplete
            ? ''
            : ' 分页读取未完成：当前统计仅覆盖已读取需求，不代表项目总需求数。'}
        </p>
      )}

      {!narrow && toolbar}

      <div className="pipeline-overview__timeline" aria-label="需求阶段时间线">
        {timeline.map((stage, index) => {
          const connector = stageConnectorCompletion(requirements, stage.key);
          const nextStage = timeline[index + 1];
          const active = phase === stage.key;
          return (
            <div className="pipeline-overview__stage" key={stage.key}>
              <button
                type="button"
                className="pipeline-overview__stage-button"
                data-active={active}
                aria-pressed={active}
                aria-label={`${stage.label}：当前阶段需求数 ${stage.count}；${active ? '当前筛选' : '未筛选'}；阶段完成证据：${
                  connector.complete ? '服务端已记录该阶段完成' : '阶段完成状态待确认'
                }`}
                onClick={() => setPhase(phase === stage.key ? 'ALL' : stage.key)}
              >
                <span className="pipeline-overview__stage-dot" aria-hidden="true">
                  {stage.count}
                </span>
                <span className="pipeline-overview__stage-label">{stage.shortLabel}</span>
                <span className="pipeline-overview__stage-count">当前阶段需求数 {stage.count}</span>
              </button>
              {nextStage && (
                <span
                  className="pipeline-overview__connector"
                  data-complete={connector.complete}
                  role="img"
                  aria-label={`${stage.label} 至 ${nextStage.label} 的连接线：${
                    connector.complete
                      ? '存在服务端阶段完成记录'
                      : '阶段完成状态待确认，连接线不代表阶段已完成'
                  }`}
                  title={
                    connector.complete
                      ? '服务端已记录该阶段完成'
                      : '当前接口没有阶段完成记录，连接线保持中性'
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {narrow ? (
        <details className="pipeline-overview__explain">
          <summary>时间线口径说明</summary>
          <p className="pipeline-overview__timeline-note">
            阶段节点数字是「当前阶段需求数」，不是完成数。
            {unknownPhaseCount > 0
              ? ` 另有 ${unknownPhaseCount} 条需求阶段未知，未计入时间线。`
              : ''}
          </p>
        </details>
      ) : (
        <p className="pipeline-overview__timeline-note">
          阶段节点数字是「当前阶段需求数」，不是完成数。连接线只表示阶段顺序；
          {hasCompletionEvidence
            ? '当前数据提供了阶段完成记录，只有全部相关需求都有该阶段完成记录时连接线才显示完成。'
            : '当前接口没有阶段完成记录，完成状态待确认，连接线保持中性。'}
          {unknownPhaseCount > 0
            ? ` 另有 ${unknownPhaseCount} 条需求阶段未知，未计入时间线，统计计入状态待确认。`
            : ''}
        </p>
      )}

      <div className="pipeline-overview__list">
        {requirements.length === 0 ? (
          <div className="pipeline-overview__empty">当前项目还没有需求。</div>
        ) : filtered.length === 0 ? (
          <div className="pipeline-overview__empty">没有符合筛选条件的需求。</div>
        ) : (
          filtered.map((requirement) => {
            const state = describeRequirementState(requirement);
            const phaseLabel = state.phase.known
              ? state.phase.label
              : phaseLabelOf(requirement.phase);
            const taskCount = explicitCount(requirement, 'tasks');
            const artifactCount = explicitCount(requirement, 'artifacts');
            const reviewCount = explicitCount(requirement, 'reviews');
            const progressLabel = progressSummary(requirement);
            return (
              <button
                className="pipeline-overview__row"
                key={requirement.id}
                onClick={() => onSelectRequirement?.(requirement)}
                type="button"
                aria-label={`打开需求 ${requirement.code} ${requirement.title}；当前阶段：${phaseLabel}；执行状态：${state.execution.label}`}
              >
                <span className="pipeline-overview__row-head">
                  <span className="pipeline-overview__title">
                    <span className="pipeline-overview__code">{requirement.code}</span>{' '}
                    {requirement.title}
                  </span>
                </span>
                <span className="pipeline-overview__meta">
                  <span className="pipeline-overview__badge" data-kind="phase">
                    当前阶段：{phaseLabel}
                  </span>
                  <span className="pipeline-overview__badge" data-status={state.execution.tone}>
                    执行状态：{state.execution.label}
                  </span>
                  <span>更新于 {formatUpdated(requirement.updatedAt)}</span>
                  {taskCount !== null && <span>任务 {taskCount}</span>}
                  {artifactCount !== null && <span>产物 {artifactCount}</span>}
                  {reviewCount !== null && <span>评审 {reviewCount}</span>}
                </span>
                {state.execution.reasonMissing && (
                  <span className="pipeline-overview__hint">
                    阻塞/暂停原因由服务端记录提供，当前需求列表接口未返回原因。
                  </span>
                )}
                {!state.phase.known && (
                  <span className="pipeline-overview__hint">
                    阶段信息缺失：当前阶段与阶段进度均为“阶段待确认”，统计计入“状态待确认”。
                  </span>
                )}
                {state.isReleased && (
                  <span className="pipeline-overview__hint">
                    「已发布」是业务阶段；执行状态来自服务端 workStatus，两者不是同一维度。
                  </span>
                )}
                {state.isArchived && (
                  <span className="pipeline-overview__hint">
                    「已归档」是业务阶段，不代表已发布；执行状态来自 workStatus。
                  </span>
                )}
                <span
                  className="pipeline-overview__progress"
                  role="img"
                  aria-label={`${requirement.title} 阶段进度：${progressLabel}`}
                >
                  {PIPELINE_PHASE_DEFINITIONS.map((stage) => {
                    const progress = requirementStageProgress(requirement, stage.key);
                    return (
                      <i
                        key={stage.key}
                        data-state={progress}
                        title={`${stage.label}：${stageProgressLabel(progress)}`}
                      />
                    );
                  })}
                </span>
                <span className="pipeline-overview__sr-only">
                  阶段进度：{progressLabel}。{PROGRESS_LEGEND}。
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
