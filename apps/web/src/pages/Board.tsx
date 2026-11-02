import { useEffect, useMemo, useState } from 'react';
import { formatApiError } from '../api/client';
import { boardApi, taskApi, type BoardCard, type BoardSnapshot } from '../api/resources';
import { ConfirmDialog } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

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
 * 看板主要用于查看服务端任务状态；正常认领由本地 Agent 完成，页面上的认领是人工接管动作，
 * 必须经过二次确认。失败时原样展示服务端 envelope，不根据卡片上的认领状态推断权限。
 */
export function Board() {
  const { projectId } = useProjectContext();
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [claimTarget, setClaimTarget] = useState<BoardCard | null>(null);
  const [claimBusy, setClaimBusy] = useState(false);

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

  async function claim(card: BoardCard) {
    setClaimBusy(true);
    try {
      await taskApi.claim(card.taskId);
      setNotice(`任务 ${card.taskId} 已认领。`);
      setError('');
      setClaimTarget(null);
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setClaimBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>任务看板</h2>
          <p className="page-sub">按认领与工作态派生；交付状态来自服务端工件集指针。</p>
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
      {notice && <p className="kb-notice">{notice}</p>}
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
                column.cards.map((card) => (
                  <article className="board-card" key={card.taskId}>
                    <div className="board-card-top">
                      <span className="board-code">{card.stepKey}</span>
                      {card.claimedUserId && <span className="status-tag">{WORK_STATUS_LABELS[card.workStatus ?? ''] ?? card.workStatus}</span>}
                    </div>
                    <h4 className="board-title cell-mono">{card.taskId.slice(0, 8)}</h4>
                    <div className="board-foot">
                      <span className="board-meta">角色 {card.roleId}</span>
                      {!card.currentClaimId && card.executionStatus === 'OPEN' && (
                        <button className="ghost" onClick={() => setClaimTarget(card)}>
                          认领
                        </button>
                      )}
                    </div>
                  </article>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {snapshot && total === 0 && <p className="table-empty">该项目还没有任务。</p>}

      <ConfirmDialog
        open={Boolean(claimTarget)}
        title="人工接管任务"
        description={claimTarget ? `任务 ${claimTarget.taskId} 当前没有活动认领。确认由当前用户接管？` : ''}
        confirmLabel="确认认领"
        busy={claimBusy}
        onCancel={() => {
          if (!claimBusy) setClaimTarget(null);
        }}
        onConfirm={() => {
          if (claimTarget) void claim(claimTarget);
        }}
      />
    </section>
  );
}
