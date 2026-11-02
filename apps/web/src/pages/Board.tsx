import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { boardApi, type BoardSnapshot } from '../api/resources';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';
import { STEP_LABELS, labelFor } from '../lib/labels';

const COLUMN_LABELS: Record<string, string> = {
  BACKLOG: '待认领',
  ACTIVE: '进行中',
  BLOCKED: '阻塞',
  PAUSED: '暂停',
  DELIVERED: '已交付',
};

const WORK_STATUS_LABELS: Record<string, string> = {
  ACTIVE: '进行中',
  BLOCKED: '阻塞',
  PAUSED: '暂停',
  CANCELLED: '已取消',
};



/**
 * 看板只读：按服务端派生列展示任务与工作态。
 * 认领与交付属于执行动作，由本地 Agent 通过 CLI 完成；Web 不提供认领入口。
 */
export function Board() {
  const navigate = useNavigate();
  const { projectId } = useProjectContext();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const total = useMemo(
    () => (snapshot?.columns ?? []).reduce((sum, column) => sum + column.cards.length, 0),
    [snapshot],
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
          <ProjectSelect onChange={() => setSnapshot(null)} />
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
        <div className="board-grid">
          {snapshot.columns.map((column) => (
            <div className="board-col" key={column.key}>
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
                  return (
                    <article
                      className="board-card"
                      key={card.taskId}
                      title={card.taskId}
                      tabIndex={card.requirementCode ? 0 : undefined}
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
                        <span className="board-code">
                          {labelFor(STEP_LABELS, card.stepKey)}
                        </span>
                        {card.claimedUserId && (
                          <span className="status-tag">
                            {WORK_STATUS_LABELS[card.workStatus ?? ''] ?? card.workStatus}
                          </span>
                        )}
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
      )}

      {snapshot && total === 0 && <p className="table-empty">该项目还没有任务。</p>}
    </section>
  );
}
