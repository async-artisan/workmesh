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

/** 需求列表是游标分页（limit 固定 50）；统计“全部需求”必须聚合所有页，不能只看第一页。 */
const MAX_REQUIREMENT_PAGES = 40;

async function fetchAllRequirements(pid: string): Promise<RequirementView[]> {
  const byId = new Map<string, RequirementView>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_REQUIREMENT_PAGES; page += 1) {
    const result = await requirementApi.list(pid, cursor);
    for (const item of result.items) byId.set(item.id, item);
    const next = result.nextCursor ?? undefined;
    if (!next || next === cursor) break;
    cursor = next;
  }
  return [...byId.values()];
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
  /** 最近一次成功快照；存在快照时刷新失败进入 stale，而不是清空列表。 */
  const snapshotRef = useRef<RequirementView[] | null>(null);
  const requestRef = useRef(0);

  const load = useCallback(async (pid: string) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setBusy(true);
    setError('');
    try {
      const items = await fetchAllRequirements(pid);
      if (requestRef.current !== requestId) return;
      snapshotRef.current = items;
      setRequirements(items);
      setUpdatedAt(new Date());
      setLoadState('ready');
    } catch (caught: unknown) {
      if (requestRef.current !== requestId) return;
      setError(formatApiError(caught));
      if (snapshotRef.current) {
        // 刷新失败：保留上一次成功数据，只更新错误与 stale 状态。
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
          <ProjectSelect />
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
          {requirements.length === 0 ? (
            <EmptyState
              title="当前项目还没有需求"
              description="项目已成功加载，但还没有任何需求。可以到需求列表创建第一条需求，或确认当前项目是否选择正确。"
              actionLabel="打开需求列表"
              onAction={() => navigate('/requirements')}
              hint="如果刚创建需求仍看不到，请稍后刷新。"
            />
          ) : (
            <ProjectPipelineOverview
              key={projectId}
              requirements={requirements}
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
