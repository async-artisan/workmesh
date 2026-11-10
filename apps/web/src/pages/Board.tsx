import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import {
  boardApi,
  type BoardCard,
  type BoardColumnKey,
  type BoardFilterPage,
  type BoardQuery,
  type BoardRequirementPage,
  type BoardSnapshot,
} from '../api/resources';
import { ProjectSelect } from '../components/ProjectSelect';
import { InlineLoading, SkeletonLines } from '../components/Skeleton';
import { useProjectContext } from '../hooks/useProjectContext';
import { STEP_LABELS, WORK_STATUS_LABELS, labelFor } from '../lib/labels';
import { resolveTaskDisplayState } from '../lib/taskDisplayState';

const COLUMN_LABELS: Record<BoardColumnKey, string> = {
  BACKLOG: '未开始',
  ACTIVE: '进行中',
  BLOCKED: '阻塞',
  PAUSED: '暂停',
  CANCELLED: '已取消',
  DELIVERED: '已交付',
};
const COLUMN_KEYS = Object.keys(COLUMN_LABELS) as BoardColumnKey[];
const PAGE_SIZE = 20;
type ViewMode = 'columns' | 'requirements';
type MoreState = { loading: boolean; error: string };
type BoardData =
  | { scope: string; mode: 'columns'; value: BoardSnapshot }
  | { scope: string; mode: 'requirements'; value: BoardRequirementPage };
function appendUnique<T>(previous: T[], next: T[], key: (item: T) => string): T[] {
  const items = new Map(previous.map((item) => [key(item), item]));
  for (const item of next) items.set(key(item), item);
  return [...items.values()];
}

/** Project-wide choices have independent search/cursors, never the current board filters. */
function BoardFacetSelect({
  projectId,
  kind,
  refreshKey,
  value,
  onChange,
}: {
  projectId: string;
  kind: 'roles' | 'requirements';
  refreshKey: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = kind === 'roles' ? '角色' : '需求';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<{ scope: string; value: BoardFilterPage } | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const scope = JSON.stringify([projectId, kind, search.trim(), refreshKey]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requestRef = useRef(0);
  const current = page?.scope === scope ? page.value : null;
  const currentError = error?.scope === scope ? error.message : '';
  const loading = loadingScope === scope;
  const load = useCallback(
    async (cursor?: string, queryKey?: string) => {
      const request = ++requestRef.current;
      const requestedScope = scope;
      setLoadingScope(requestedScope);
      setError(null);
      try {
        const next = await boardApi.filters(projectId, kind, {
          search: search.trim() || undefined,
          limit: 50,
          cursor,
        });
        if (request !== requestRef.current || requestedScope !== scopeRef.current) return;
        if (next.projectId !== projectId || (queryKey && next.queryKey !== queryKey))
          throw new Error('筛选选项范围不一致，请重试。');
        setPage((previous) => ({
          scope: requestedScope,
          value: {
            ...next,
            items:
              cursor && previous?.scope === requestedScope
                ? appendUnique(previous.value.items, next.items, (item) => item.value)
                : next.items,
          },
        }));
      } catch (caught) {
        if (request === requestRef.current && requestedScope === scopeRef.current)
          setError({ scope: requestedScope, message: formatApiError(caught) });
      } finally {
        if (request === requestRef.current && requestedScope === scopeRef.current)
          setLoadingScope(null);
      }
    },
    [projectId, kind, search, scope],
  );
  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);
  return (
    <div className="board-filter">
      <input
        aria-label={'搜索' + label + '选项'}
        placeholder={'搜索全部' + label + '选项'}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <select
        aria-label={'看板' + label + '筛选'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">全部{label}</option>
        {value && !current?.items.some((item) => item.value === value) && (
          <option value={value}>{value}</option>
        )}
        {(current?.items ?? []).map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {loading && <span role="status">正在加载{label}选项…</span>}
      {current && (
        <small>
          已加载 {current.items.length} / {current.total} 个{label}选项
        </small>
      )}
      {currentError && (
        <p className="error" role="alert">
          {label}选项加载失败：{currentError}
        </p>
      )}
      {(current?.nextCursor || currentError) && (
        <button
          className="ghost"
          disabled={loading}
          onClick={() => void load(current?.nextCursor ?? undefined, current?.queryKey)}
        >
          {currentError ? '重试加载' + label + '选项' : '加载更多' + label + '选项'}
        </button>
      )}
    </div>
  );
}

/** Board data has no dependency/review facts: OPEN is not a claimability promise. */
function BoardCardView({ card }: { card: BoardCard }) {
  const navigate = useNavigate();
  const display = resolveTaskDisplayState({
    executionStatus: card.executionStatus,
    workStatus: card.workStatus,
    currentClaimId: card.currentClaimId,
    reviewStatus: null,
    dependsOnStepKeys: null,
    doneStepKeys: null,
  });
  const workStatusLabel = card.workStatus
    ? (WORK_STATUS_LABELS[card.workStatus] ?? card.workStatus)
    : '';
  const showWorkStatus =
    Boolean(card.claimedUserId) && Boolean(workStatusLabel) && workStatusLabel !== display.label;
  const open = () => {
    if (card.requirementCode) navigate('/requirements/' + encodeURIComponent(card.requirementCode));
  };
  return (
    <article
      className="board-card"
      title={card.taskId}
      tabIndex={card.requirementCode ? 0 : undefined}
      data-task-state={display.kind}
      aria-label={
        (card.stepDisplayName?.trim() || labelFor(STEP_LABELS, card.stepKey)) +
        '，状态：' +
        display.label
      }
      onClick={open}
      onKeyDown={(event) => {
        if (card.requirementCode && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="board-card-top">
        <span className="board-code">
          {card.stepDisplayName?.trim() || labelFor(STEP_LABELS, card.stepKey)}
        </span>
        <span className={'status-tag is-' + display.tone}>{display.label}</span>
        {showWorkStatus && <span className="status-tag">{workStatusLabel}</span>}
      </div>
      <h4 className="board-title">
        {card.requirementCode
          ? card.requirementCode + ' · ' + (card.requirementTitle ?? '')
          : card.taskId.slice(0, 8)}
      </h4>
      <div className="board-foot">
        <span className="board-meta">
          角色 {card.roleTitle ?? '—'}
          {card.claimedUserEmail ? ' · ' + card.claimedUserEmail : ''}
        </span>
      </div>
    </article>
  );
}

export function Board() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [requirementFilter, setRequirementFilter] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('columns');
  const [facetRefreshKey, setFacetRefreshKey] = useState(0);
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState<{ scope: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState<Record<string, MoreState>>({});
  const [mobileColumn, setMobileColumn] = useState('');
  const q = query.trim().toLowerCase();
  const scope = JSON.stringify([projectId, q, roleFilter, requirementFilter, viewMode]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const generationRef = useRef(0);
  const moreRequestsRef = useRef(new Set<string>());
  const current = data?.scope === scope ? data : null;
  const currentError = error?.scope === scope ? error.message : '';
  const filters: BoardQuery = {
    q: q || undefined,
    roleTitle: roleFilter || undefined,
    requirementCode: requirementFilter || undefined,
  };
  const load = useCallback(async () => {
    const generation = ++generationRef.current;
    const requestedScope = scope;
    moreRequestsRef.current.clear();
    setMore({});
    setError(null);
    if (!projectId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const input = {
      q: q || undefined,
      roleTitle: roleFilter || undefined,
      requirementCode: requirementFilter || undefined,
      limit: PAGE_SIZE,
    };
    try {
      const next: BoardData =
        viewMode === 'columns'
          ? { scope: requestedScope, mode: 'columns', value: await boardApi.get(projectId, input) }
          : {
              scope: requestedScope,
              mode: 'requirements',
              value: await boardApi.requirements(projectId, input),
            };
      if (generation !== generationRef.current || requestedScope !== scopeRef.current) return;
      if (next.value.projectId !== projectId) throw new Error('看板范围不一致，请刷新看板。');
      setData(next);
    } catch (caught) {
      if (generation === generationRef.current && requestedScope === scopeRef.current)
        setError({ scope: requestedScope, message: formatApiError(caught) });
    } finally {
      if (generation === generationRef.current && requestedScope === scopeRef.current)
        setLoading(false);
    }
  }, [projectId, q, roleFilter, requirementFilter, viewMode, scope]);
  useEffect(() => {
    void load();
    return () => {
      generationRef.current += 1;
      moreRequestsRef.current.clear();
    };
  }, [load]);

  async function loadMore(key: string, action: () => Promise<void>) {
    if (moreRequestsRef.current.has(key)) return;
    const requestedScope = scope;
    const generation = generationRef.current;
    moreRequestsRef.current.add(key);
    setMore((previous) => ({ ...previous, [key]: { loading: true, error: '' } }));
    try {
      await action();
    } catch (caught) {
      if (generation === generationRef.current && requestedScope === scopeRef.current)
        setMore((previous) => ({
          ...previous,
          [key]: { loading: false, error: formatApiError(caught) },
        }));
    } finally {
      if (generation === generationRef.current && requestedScope === scopeRef.current) {
        moreRequestsRef.current.delete(key);
        setMore((previous) => ({
          ...previous,
          [key]: { loading: false, error: previous[key]?.error ?? '' },
        }));
      }
    }
  }
  function moreColumn(key: BoardColumnKey) {
    if (current?.mode !== 'columns') return;
    const column = current.value.columns.find((item) => item.key === key);
    if (!column?.nextCursor) return;
    const generation = generationRef.current;
    const queryKey = current.value.queryKey;
    void loadMore('column:' + key, async () => {
      const next = await boardApi.column(projectId, key, {
        ...filters,
        limit: PAGE_SIZE,
        cursor: column.nextCursor!,
      });
      if (generation !== generationRef.current || scope !== scopeRef.current) return;
      if (next.projectId !== projectId || next.queryKey !== queryKey || next.key !== key)
        throw new Error('看板续页范围不一致，请刷新看板。');
      setData((previous) =>
        previous?.scope !== scope || previous.mode !== 'columns'
          ? previous
          : {
              ...previous,
              value: {
                ...previous.value,
                columns: previous.value.columns.map((item) =>
                  item.key !== key
                    ? item
                    : {
                        ...next,
                        cards: appendUnique(item.cards, next.cards, (card) => card.taskId),
                      },
                ),
              },
            },
      );
    });
  }
  function moreRequirements() {
    if (current?.mode !== 'requirements' || !current.value.nextCursor) return;
    const page = current.value;
    const generation = generationRef.current;
    void loadMore('requirements', async () => {
      const next = await boardApi.requirements(projectId, {
        ...filters,
        limit: PAGE_SIZE,
        cursor: page.nextCursor!,
      });
      if (generation !== generationRef.current || scope !== scopeRef.current) return;
      if (next.projectId !== projectId || next.queryKey !== page.queryKey)
        throw new Error('需求续页范围不一致，请刷新看板。');
      setData((previous) =>
        previous?.scope !== scope || previous.mode !== 'requirements'
          ? previous
          : {
              ...previous,
              value: {
                ...next,
                items: appendUnique(previous.value.items, next.items, (item) => item.code),
              },
            },
      );
    });
  }
  function moreRoles(code: string) {
    if (current?.mode !== 'requirements') return;
    const group = current.value.items.find((item) => item.code === code);
    if (!group?.rolesNextCursor) return;
    const generation = generationRef.current;
    void loadMore('roles:' + code, async () => {
      const next = await boardApi.filters(projectId, 'roles', {
        q: filters.q,
        roleTitle: filters.roleTitle,
        requirementCode: code,
        limit: 10,
        cursor: group.rolesNextCursor!,
      });
      if (generation !== generationRef.current || scope !== scopeRef.current) return;
      if (next.projectId !== projectId) throw new Error('角色续页范围不一致，请刷新看板。');
      setData((previous) =>
        previous?.scope !== scope || previous.mode !== 'requirements'
          ? previous
          : {
              ...previous,
              value: {
                ...previous.value,
                items: previous.value.items.map((item) =>
                  item.code !== code
                    ? item
                    : {
                        ...item,
                        roles: [
                          ...new Set([...item.roles, ...next.items.map((role) => role.value)]),
                        ],
                        roleTotal: next.total,
                        rolesNextCursor: next.nextCursor,
                      },
                ),
              },
            },
      );
    });
  }
  const columns = current?.mode === 'columns' ? current.value.columns : [];
  const activeMobileColumn = columns.some((column) => column.key === mobileColumn)
    ? mobileColumn
    : (columns.find((column) => column.total > 0)?.key ?? columns[0]?.key ?? '');
  const summary = current?.value.summary;
  const firstLoad = Boolean(projectId) && !current && !currentError;
  const moreButton = (key: string, label: string, onClick: () => void) => (
    <div>
      {more[key]?.error && (
        <p className="error" role="alert">
          {more[key].error}
        </p>
      )}
      <button className="ghost" disabled={loading || more[key]?.loading} onClick={onClick}>
        {more[key]?.loading ? '加载中…' : more[key]?.error ? '重试' + label : label}
      </button>
    </div>
  );
  return (
    <section>
      <header className="page-head">
        <div>
          <h2>任务看板</h2>
          <p className="page-sub">
            只读视图：认领与交付由本地 Agent 通过 CLI 完成；状态来自服务端。
          </p>
        </div>
        <div className="page-actions">
          <div className="segmented" aria-label="看板视图">
            <button
              className={viewMode === 'columns' ? 'is-active' : ''}
              onClick={() => setViewMode('columns')}
            >
              按列
            </button>
            <button
              className={viewMode === 'requirements' ? 'is-active' : ''}
              onClick={() => setViewMode('requirements')}
            >
              按需求
            </button>
          </div>
          <ProjectSelect onCreateProject={() => navigate('/projects')} />
          <button
            className="ghost"
            disabled={!projectId || loading}
            onClick={() => {
              setFacetRefreshKey((previous) => previous + 1);
              void load();
            }}
          >
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </header>
      {currentError && (
        <p className="error" role="alert">
          {currentError}
        </p>
      )}
      {!projectId && <p className="page-card muted">先选择项目。</p>}
      {projectId && (
        <div className="board-toolbar">
          <input
            aria-label="搜索看板"
            placeholder="搜索需求编号 / 标题 / 角色"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <BoardFacetSelect
            key={projectId + ':roles'}
            projectId={projectId}
            kind="roles"
            refreshKey={facetRefreshKey}
            value={roleFilter}
            onChange={setRoleFilter}
          />
          <BoardFacetSelect
            key={projectId + ':requirements'}
            projectId={projectId}
            kind="requirements"
            refreshKey={facetRefreshKey}
            value={requirementFilter}
            onChange={setRequirementFilter}
          />
          {summary && (
            <span className="board-toolbar-count">
              显示 {summary.matchedTotal} / {summary.total}（匹配任务，已加载页面可继续读取）
            </span>
          )}
        </div>
      )}
      {firstLoad && (
        <div data-testid="board-loading" aria-busy="true">
          <InlineLoading label="正在加载看板…" />
          <div className="board-grid" aria-hidden="true">
            {COLUMN_KEYS.map((key) => (
              <div className="board-col" key={key}>
                <div className="board-col-head">
                  <div className="skeleton-line short" />
                </div>
                <SkeletonLines lines={3} />
              </div>
            ))}
          </div>
        </div>
      )}
      {current && (
        <p className="page-sub wm-board-note">
          看板不包含流程依赖与评审状态：未开始任务显示「状态待确认」，具体能否领取以需求详情为准（按已发布流程的步骤依赖判定）。分页为实时视图；刷新会重置分页并重新读取首屏。
        </p>
      )}
      {loading && current && <InlineLoading label="正在刷新看板…" />}
      {current?.mode === 'columns' && (
        <>
          <div className="board-mobile-tabs" role="tablist" aria-label="看板列">
            {columns.map((column) => (
              <button
                key={column.key}
                type="button"
                role="tab"
                aria-selected={column.key === activeMobileColumn}
                className={
                  'board-mobile-tab' + (column.key === activeMobileColumn ? ' is-active' : '')
                }
                onClick={() => setMobileColumn(column.key)}
              >
                {COLUMN_LABELS[column.key]}
                <span>{column.total}</span>
              </button>
            ))}
          </div>
          <div className="board-grid">
            {columns.map((column) => (
              <div
                className={
                  'board-col' + (column.key === activeMobileColumn ? ' is-mobile-active' : '')
                }
                key={column.key}
                aria-label={COLUMN_LABELS[column.key] + '列'}
              >
                <div className="board-col-head">
                  <span className="board-col-title">{COLUMN_LABELS[column.key]}</span>
                  <span className="board-count">{column.total}</span>
                </div>
                {column.cards.length === 0 ? (
                  <p className="board-empty">暂无任务</p>
                ) : (
                  column.cards.map((card) => <BoardCardView key={card.taskId} card={card} />)
                )}
                {column.nextCursor &&
                  moreButton(
                    'column:' + column.key,
                    '加载更多' + COLUMN_LABELS[column.key] + '任务',
                    () => moreColumn(column.key),
                  )}
              </div>
            ))}
          </div>
        </>
      )}
      {current?.mode === 'requirements' && (
        <div className="table-card board-requirement-card">
          <p>
            已加载 {current.value.items.length} / {current.value.summary.requirementTotal}{' '}
            个匹配需求
          </p>
          <div className="table-scroll">
            <table className="data-table board-requirement-table">
              <thead>
                <tr>
                  <th>需求</th>
                  <th className="cell-num">任务</th>
                  {COLUMN_KEYS.map((key) => (
                    <th className="cell-num" key={key}>
                      {COLUMN_LABELS[key]}
                    </th>
                  ))}
                  <th>角色</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {current.value.items.map((group) => (
                  <tr
                    key={group.code}
                    className={group.counts.BLOCKED > 0 ? 'is-blocked-row' : undefined}
                  >
                    <td>
                      <strong>
                        {group.code === 'UNBOUND' ? '未关联需求' : group.code + ' · ' + group.title}
                      </strong>
                    </td>
                    <td className="cell-num">{group.total}</td>
                    {COLUMN_KEYS.map((key) => (
                      <td className="cell-num" key={key}>
                        {key === 'BLOCKED' && group.counts[key] > 0 ? (
                          <span className="status-tag is-danger">{group.counts[key]}</span>
                        ) : (
                          group.counts[key]
                        )}
                      </td>
                    ))}
                    <td className="board-meta">
                      {group.roles.join(' / ') || '—'}
                      <small>
                        （已加载 {group.roles.length} / {group.roleTotal} 个角色）
                      </small>
                      {group.rolesNextCursor &&
                        moreButton('roles:' + group.code, '加载更多' + group.code + '角色', () =>
                          moreRoles(group.code),
                        )}
                    </td>
                    <td className="col-actions">
                      <button
                        className="ghost"
                        disabled={group.code === 'UNBOUND'}
                        onClick={() => navigate('/requirements/' + encodeURIComponent(group.code))}
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                ))}
                {current.value.items.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={10}>没有匹配的任务。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {current.value.nextCursor && moreButton('requirements', '加载更多需求', moreRequirements)}
        </div>
      )}
      {summary?.total === 0 && <p className="table-empty">该项目还没有任务。</p>}
    </section>
  );
}
