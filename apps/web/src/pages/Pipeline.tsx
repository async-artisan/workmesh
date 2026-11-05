import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { requirementApi, type RequirementView } from '../api/resources';
import { EmptyState } from '../components/EmptyState';
import { PageState } from '../components/PageState';
import { ProjectPipelineOverview } from '../components/ProjectPipelineOverview';
import { ProjectSelect } from '../components/ProjectSelect';
import { StaleDataBanner, formatUpdatedAtClock } from '../components/StaleDataBanner';
import { useProjectContext } from '../hooks/useProjectContext';

type PipelineLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'stale';

/** 游标聚合不完整的原因；只有完整读取过服务端返回的“没有下一页”才算完整。 */
type RequirementAggregationReason = 'page-limit' | 'repeated-cursor';

interface RequirementAggregation {
  items: RequirementView[];
  complete: boolean;
  pages: number;
  reason: RequirementAggregationReason | null;
}

/** 需求列表是游标分页（limit 固定 50）；统计“全部需求”必须聚合所有页，不能只看第一页。 */
const MAX_REQUIREMENT_PAGES = 40;

/**
 * 聚合所有分页。达到页上限或游标重复时返回 complete=false，页面必须明确告知
 * “可能未完整加载”，不能把已读取数量伪装成项目总需求数。
 */
async function fetchAllRequirements(pid: string): Promise<RequirementAggregation> {
  const byId = new Map<string, RequirementView>();
  const requestedCursors = new Set<string>();
  let cursor: string | undefined;

  for (let page = 1; page <= MAX_REQUIREMENT_PAGES; page += 1) {
    const result = await requirementApi.list(pid, cursor);
    for (const item of result.items) byId.set(item.id, item);
    const next = result.nextCursor ?? undefined;

    // 当前接口契约：nextCursor=null 表示没有下一页。
    if (!next) {
      return { items: [...byId.values()], complete: true, pages: page, reason: null };
    }
    if (requestedCursors.has(next)) {
      return {
        items: [...byId.values()],
        complete: false,
        pages: page,
        reason: 'repeated-cursor',
      };
    }
    requestedCursors.add(next);

    if (page === MAX_REQUIREMENT_PAGES) {
      return {
        items: [...byId.values()],
        complete: false,
        pages: page,
        reason: 'page-limit',
      };
    }
    cursor = next;
  }

  // 循环逻辑上不会到达这里；保守按不完整处理，绝不静默声称完整。
  return {
    items: [...byId.values()],
    complete: false,
    pages: MAX_REQUIREMENT_PAGES,
    reason: 'page-limit',
  };
}

/**
 * 需求流水线：加载状态与快照可信度由页面统一维护。
 * - 首次失败显示页面级错误，不伪装成空项目；
 * - 已有成功快照后刷新失败保留旧列表并显示 stale；
 * - 切换项目立即清理旧项目快照，避免串项目；
 * - 更新时间使用前端“上次成功读取时间”，不伪造服务端更新时间。
 */
export function Pipeline() {
  const navigate = useNavigate();
  const { projectId, projects } = useProjectContext();
  const [requirements, setRequirements] = useState<RequirementView[]>([]);
  const [loadState, setLoadState] = useState<PipelineLoadState>('idle');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  /** 分页聚合完整性：不完整时统计数字不能称为“全部需求”。 */
  const [aggregation, setAggregation] = useState<{
    complete: boolean;
    pages: number;
    reason: RequirementAggregationReason | null;
  }>({ complete: true, pages: 0, reason: null });
  /** 最近一次成功快照；存在快照时刷新失败进入 stale，而不是清空列表。 */
  const snapshotRef = useRef<RequirementView[] | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (pid: string) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(true);
    setError('');
    try {
      const result = await fetchAllRequirements(pid);
      if (requestRef.current !== requestId) return;
      snapshotRef.current = result.items;
      setRequirements(result.items);
      setAggregation({
        complete: result.complete,
        pages: result.pages,
        reason: result.reason,
      });
      setUpdatedAt(new Date());
      setLoadState('ready');
    } catch (caught: unknown) {
      if (requestRef.current !== requestId) return;
      setError(formatApiError(caught));
      if (snapshotRef.current) {
        // 刷新失败：保留上一次成功数据（含截断状态）与 stale 提示。
        setLoadState('stale');
      } else {
        setRequirements([]);
        setLoadState('error');
      }
    } finally {
      if (requestRef.current === requestId) setBusy(false);
    }
  }, []);

  useEffect(() => {
    // 切换项目：让在途请求失效并清空旧项目快照，不能在新项目下继续展示旧数据。
    requestRef.current += 1;
    snapshotRef.current = null;
    setRequirements([]);
    setAggregation({ complete: true, pages: 0, reason: null });
    setUpdatedAt(null);
    setError('');
    setBusy(false);
    if (!projectId) {
      setLoadState('idle');
      return;
    }
    setLoadState('loading');
    void load(projectId);
  }, [projectId, load]);

  const projectName = projects.find((project) => project.id === projectId)?.name;

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>需求流水线</h2>
          <p className="page-sub">
            {projectName
              ? `当前项目：${projectName}。阶段与执行状态分开显示；统计口径见下方说明。`
              : '按阶段查看项目中的需求；阶段分布不等于阶段完成。'}
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect onCreateProject={() => navigate('/projects')} />
          <button
            type="button"
            className="ghost"
            onClick={() => {
              if (projectId) void load(projectId);
            }}
            disabled={!projectId || busy}
          >
            {busy ? '刷新中…' : '刷新'}
          </button>
        </div>
      </header>

      {!projectId ? (
        <p className="page-card muted">先选择项目。</p>
      ) : loadState === 'loading' ? (
        <PageState state={{ kind: 'loading' }} title="正在加载需求流水线…" />
      ) : loadState === 'error' ? (
        <PageState
          state={{
            kind: 'error',
            message: '暂时无法读取项目需求。',
            detail: error || undefined,
          }}
          title="需求列表加载失败"
          onRetry={() => {
            if (projectId) void load(projectId);
          }}
          retryLabel="重试加载"
          retryAriaLabel="重试加载需求列表"
        />
      ) : (
        <>
          {loadState === 'stale' && (
            <StaleDataBanner
              updatedAt={updatedAt ?? undefined}
              message="本次刷新失败，数据可能已经过期。"
              onRetry={() => {
                if (projectId) void load(projectId);
              }}
              retryAriaLabel="重试刷新需求列表"
            />
          )}
          {loadState === 'stale' && updatedAt && (
            <p className="page-sub" role="status">
              上次成功读取于 {formatUpdatedAtClock(updatedAt) ?? '—'}；当前显示的是 stale
              快照，搜索、筛选与打开需求仍可使用。
            </p>
          )}
          {!aggregation.complete && (
            <div className="detail-card" role="status" aria-live="polite">
              <strong>需求列表可能未完整加载</strong>
              <p className="page-sub">
                {aggregation.reason === 'page-limit'
                  ? `已读取前 ${aggregation.pages} 页（每页最多 50 条），服务端没有返回总数；当前数字只代表已读取需求，不是项目总需求数。`
                  : `服务端游标重复（已读取 ${aggregation.pages} 页），已停止继续读取；当前数字只代表已读取需求，不是项目总需求数。`}
              </p>
              <div className="next-step-actions">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    if (projectId) void load(projectId);
                  }}
                  disabled={busy}
                >
                  {busy ? '重新加载中…' : '重新加载'}
                </button>
              </div>
            </div>
          )}
          {requirements.length === 0 ? (
            !aggregation.complete ? (
              <EmptyState
                title="未读取到需求，但列表可能不完整"
                description="服务端没有返回需求，但分页读取未完成，无法确认当前项目是否真的为空；请重新加载或稍后再试。"
                actionLabel="重新加载"
                onAction={() => {
                  if (projectId) void load(projectId);
                }}
              />
            ) : (
              <EmptyState
                title="当前项目还没有需求"
                description="项目已成功加载，但还没有任何需求。可以到需求列表创建第一条需求，或确认当前项目是否选择正确。"
                actionLabel="打开需求列表"
                onAction={() => navigate('/requirements')}
                hint="如果刚创建需求仍看不到，请稍后刷新。"
              />
            )
          ) : (
            <ProjectPipelineOverview
              key={projectId}
              projectId={projectId ?? undefined}
              requirements={requirements}
              requirementsComplete={aggregation.complete}
              onSelectRequirement={(item) =>
                navigate(`/requirements/${encodeURIComponent(item.code)}`)
              }
            />
          )}
        </>
      )}
    </section>
  );
}
