import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { boardApi, type BoardCard, type BoardSnapshot } from '../api/resources';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { STEP_LABELS, WORK_STATUS_LABELS, labelFor } from '../lib/labels';
import { resolveTaskDisplayState } from '../lib/taskDisplayState';

const COLUMN_LABELS: Record<string, string> = {
  BACKLOG: '未开始',
  ACTIVE: '进行中',
  BLOCKED: '阻塞',
  PAUSED: '暂停',
  CANCELLED: '已取消',
  DELIVERED: '已交付',
};

/**
 * 看板只读：按服务端派生列展示任务与工作态。
 * 认领与交付属于执行动作，由本地 Agent 通过 CLI 完成；Web 不提供认领入口。
 *
 * 看板响应不包含流程依赖与评审状态，所以「未开始」不能写成「可认领」：
 * 卡片统一用共享映射展示，依赖信息不可用时明确显示「状态待确认」，
 * 具体可领取判定以需求详情（按已发布流程的步骤依赖）为准。
 */
function cardDisplayState(card: BoardCard) {
  return resolveTaskDisplayState({
    executionStatus: card.executionStatus,
    workStatus: card.workStatus,
    currentClaimId: card.currentClaimId,
    reviewStatus: null,
    dependsOnStepKeys: null,
    doneStepKeys: null,
  });
}
export function Board() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [requirementFilter, setRequirementFilter] = useState('');
  const [viewMode, setViewMode] = useState<'columns' | 'requirements'>('columns');

  async function load() {
    if (!projectId) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      setSnapshot(await boardApi.get(projectId));
      setError('');
    } catch (caught) {
      setSnapshot(null);
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  const allCards = useMemo(
    () => (snapshot?.columns ?? []).flatMap((column) => column.cards),
    [snapshot],
  );

  const total = allCards.length;

  const roleOptions = useMemo(
    () =>
      [
        ...new Set(
          allCards.map((card) => card.roleTitle).filter((value): value is string => Boolean(value)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [allCards],
  );

  const requirementOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const card of allCards) {
      if (card.requirementCode)
        map.set(card.requirementCode, card.requirementTitle ?? card.requirementCode);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
  }, [allCards]);

  const filteredColumns = useMemo(() => {
    const text = query.trim().toLowerCase();
    return (snapshot?.columns ?? []).map((column) => ({
      ...column,
      cards: column.cards.filter((card) => {
        if (roleFilter && card.roleTitle !== roleFilter) return false;
        if (requirementFilter && card.requirementCode !== requirementFilter) return false;
        if (!text) return true;
        return [
          card.requirementCode ?? '',
          card.requirementTitle ?? '',
          card.stepKey,
          card.roleTitle ?? '',
          card.claimedUserEmail ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(text);
      }),
    }));
  }, [snapshot, query, roleFilter, requirementFilter]);

  const visibleTotal = filteredColumns.reduce((sum, column) => sum + column.cards.length, 0);

  /**
   * 窄屏看板只显示一列：用列切换页签代替横向滚动。
   * 默认选中第一个有卡片的列；筛选后当前列消失时自动回退。
   */
  const [mobileColumn, setMobileColumn] = useState('');
  const activeMobileColumn = filteredColumns.some((column) => column.key === mobileColumn)
    ? mobileColumn
    : (filteredColumns.find((column) => column.cards.length > 0)?.key ??
      filteredColumns[0]?.key ??
      '');

  const requirementGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        code: string;
        title: string;
        cards: Array<{ card: BoardCard; columnKey: string }>;
      }
    >();
    for (const column of filteredColumns) {
      for (const card of column.cards) {
        const code = card.requirementCode ?? 'UNBOUND';
        const group = groups.get(code) ?? {
          code,
          title: card.requirementTitle ?? '未关联需求',
          cards: [],
        };
        group.cards.push({ card, columnKey: column.key });
        groups.set(code, group);
      }
    }
    return [...groups.values()].sort((a, b) => {
      const weight = (value: typeof a) =>
        value.cards.filter((item) => item.columnKey === 'BLOCKED').length * 10 +
        value.cards.filter((item) => item.columnKey === 'ACTIVE').length;
      return weight(b) - weight(a) || a.code.localeCompare(b.code, 'zh-CN');
    });
  }, [filteredColumns]);

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
          <ProjectSelect
            onChange={() => setSnapshot(null)}
            onCreateProject={() => navigate('/projects')}
          />
          <button className="ghost" disabled={!projectId || loading} onClick={() => void load()}>
            {loading ? '加载中…' : '刷新'}
          </button>
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!projectId && <p className="page-card muted">先选择项目。</p>}

      {snapshot && (
        <div className="board-toolbar">
          <input
            aria-label="搜索看板"
            placeholder="搜索需求编号 / 标题 / 角色"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select
            aria-label="看板角色筛选"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
          >
            <option value="">全部角色</option>
            {roleOptions.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            aria-label="看板需求筛选"
            value={requirementFilter}
            onChange={(event) => setRequirementFilter(event.target.value)}
          >
            <option value="">全部需求</option>
            {requirementOptions.map(([code, title]) => (
              <option key={code} value={code}>
                {code} · {title}
              </option>
            ))}
          </select>
          <span className="board-toolbar-count">
            显示 {visibleTotal} / {total}
          </span>
        </div>
      )}

      {snapshot && (
        <p className="page-sub wm-board-note">
          看板不包含流程依赖与评审状态：未开始任务显示「状态待确认」，具体能否领取以需求详情为准（按已发布流程的步骤依赖判定）。
        </p>
      )}

      {snapshot && viewMode === 'columns' && (
        <>
          <div className="board-mobile-tabs" role="tablist" aria-label="看板列">
            {filteredColumns.map((column) => (
              <button
                key={column.key}
                type="button"
                role="tab"
                aria-selected={column.key === activeMobileColumn}
                className={`board-mobile-tab${column.key === activeMobileColumn ? ' is-active' : ''}`}
                onClick={() => setMobileColumn(column.key)}
              >
                {COLUMN_LABELS[column.key] ?? column.key}
                <span>{column.cards.length}</span>
              </button>
            ))}
          </div>
          <div className="board-grid">
            {filteredColumns.map((column) => (
              <div
                className={`board-col${column.key === activeMobileColumn ? ' is-mobile-active' : ''}`}
                key={column.key}
              >
                <div className="board-col-head">
                  <span className="board-col-title">{COLUMN_LABELS[column.key] ?? column.key}</span>
                  <span className="board-count">{column.cards.length}</span>
                </div>
                {column.cards.length === 0 ? (
                  <p className="board-empty">暂无任务</p>
                ) : (
                  column.cards.map((card) => {
                    const requirementLabel = card.requirementCode
                      ? `${card.requirementCode} · ${card.requirementTitle ?? ''}`
                      : card.taskId.slice(0, 8);
                    const display = cardDisplayState(card);
                    const workStatusLabel = card.workStatus
                      ? (WORK_STATUS_LABELS[card.workStatus] ?? card.workStatus)
                      : '';
                    // 第三个标签只在“工作态”与主状态不同的时候显示，避免「已取消 / 已取消」重复两遍。
                    const showWorkStatus =
                      Boolean(card.claimedUserId) &&
                      Boolean(workStatusLabel) &&
                      workStatusLabel !== display.label;
                    return (
                      <article
                        className="board-card"
                        key={card.taskId}
                        title={card.taskId}
                        tabIndex={card.requirementCode ? 0 : undefined}
                        data-task-state={display.kind}
                        aria-label={`${labelFor(STEP_LABELS, card.stepKey)}，状态：${display.label}`}
                        onClick={() => {
                          if (card.requirementCode)
                            navigate(`/requirements/${encodeURIComponent(card.requirementCode)}`);
                        }}
                        onKeyDown={(event) => {
                          if (!card.requirementCode) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(`/requirements/${encodeURIComponent(card.requirementCode)}`);
                          }
                        }}
                      >
                        <div className="board-card-top">
                          <span className="board-code">{labelFor(STEP_LABELS, card.stepKey)}</span>
                          <span className={`status-tag is-${display.tone}`}>{display.label}</span>
                          {showWorkStatus && <span className="status-tag">{workStatusLabel}</span>}
                        </div>
                        <h4 className="board-title">{requirementLabel}</h4>
                        <div className="board-foot">
                          <span className="board-meta">
                            角色 {card.roleTitle ?? '—'}
                            {card.claimedUserEmail ? ` · ${card.claimedUserEmail}` : ''}
                          </span>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {snapshot && viewMode === 'requirements' && (
        <div className="table-card board-requirement-card">
          <div className="table-scroll">
            <table className="data-table board-requirement-table">
              <thead>
                <tr>
                  <th>需求</th>
                  <th className="cell-num">任务</th>
                  <th className="cell-num">未开始</th>
                  <th className="cell-num">进行中</th>
                  <th className="cell-num">阻塞</th>
                  <th className="cell-num">暂停</th>
                  <th className="cell-num">已交付</th>
                  <th>角色</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {requirementGroups.map((group) => {
                  const count = (key: string) =>
                    group.cards.filter((item) => item.columnKey === key).length;
                  const roles = [
                    ...new Set(
                      group.cards
                        .map((item) => item.card.roleTitle)
                        .filter((value): value is string => Boolean(value)),
                    ),
                  ];
                  return (
                    <tr
                      key={group.code}
                      className={count('BLOCKED') > 0 ? 'is-blocked-row' : undefined}
                    >
                      <td>
                        <strong>
                          {group.code === 'UNBOUND' ? '未关联需求' : group.code}
                          {group.code !== 'UNBOUND' ? ` · ${group.title}` : ''}
                        </strong>
                      </td>
                      <td className="cell-num">{group.cards.length}</td>
                      <td className="cell-num">{count('BACKLOG')}</td>
                      <td className="cell-num">{count('ACTIVE')}</td>
                      <td className="cell-num">
                        {count('BLOCKED') > 0 ? (
                          <span className="status-tag is-danger">{count('BLOCKED')}</span>
                        ) : (
                          0
                        )}
                      </td>
                      <td className="cell-num">{count('PAUSED')}</td>
                      <td className="cell-num">{count('DELIVERED')}</td>
                      <td className="board-meta">{roles.join(' / ') || '—'}</td>
                      <td className="col-actions">
                        <button
                          className="ghost"
                          disabled={group.code === 'UNBOUND'}
                          onClick={() =>
                            navigate(`/requirements/${encodeURIComponent(group.code)}`)
                          }
                        >
                          详情
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {requirementGroups.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={9}>没有匹配的任务。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {snapshot && total === 0 && <p className="table-empty">该项目还没有任务。</p>}
    </section>
  );
}
