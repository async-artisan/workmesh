import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { reviewApi, type ReviewDecision, type ReviewSlot, type ReviewView } from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { useProjectContext } from '../hooks/useProjectContext';

type DecisionValue = 'APPROVE' | 'CHANGES_REQUESTED' | 'REJECT';

const DECISION_LABELS: Record<DecisionValue, string> = {
  APPROVE: '批准',
  CHANGES_REQUESTED: '要求修改',
  REJECT: '驳回',
};

interface DecideTarget {
  slot: ReviewSlot;
  decision: DecisionValue;
  comment: string;
}

interface RevokeTarget {
  decision: ReviewDecision;
  reason: string;
}

/**
 * 评审页只按服务端返回的评审 ID 读取，槽位、摘要与版本全部来自服务端。
 * 决定与撤销都先经过动作预览 + 密码二验签发一次性票据；权限拒绝、旧版本与
 * 槽位不符一律原样展示服务端错误，不根据按钮状态推断权限。
 */
export function Reviews() {
  const { projectId } = useProjectContext();
  const [params, setParams] = useSearchParams();
  const reviewId = params.get('id') ?? '';
  const [review, setReview] = useState<ReviewView | null>(null);
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decideTarget, setDecideTarget] = useState<DecideTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [pendingDecision, setPendingDecision] = useState<DecideTarget | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<RevokeTarget | null>(null);

  useEffect(() => {
    let alive = true;
    setError('');
    if (!reviewId) {
      setReview(null);
      if (!projectId) {
        setReviews([]);
        setListLoading(false);
        return () => {
          alive = false;
        };
      }
      setListLoading(true);
      reviewApi
        .list(projectId, { assignedToMe: true, status: 'OPEN' })
        .then((page) => {
          if (!alive) return;
          setReviews(page.items);
          setNotice('');
        })
        .catch((caught: unknown) => {
          if (!alive) return;
          setReviews([]);
          setError(formatApiError(caught));
        })
        .finally(() => {
          if (alive) setListLoading(false);
        });
      return () => {
        alive = false;
      };
    }
    setListLoading(false);
    reviewApi
      .get(reviewId)
      .then((value) => {
        if (alive) {
          setReview(value);
          setNotice('');
        }
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setReview(null);
        setError(formatApiError(caught));
      });
    return () => {
      alive = false;
    };
  }, [reviewId, projectId]);

  async function reload() {
    if (!reviewId) return;
    try {
      setReview(await reviewApi.get(reviewId));
      setError('');
    } catch (caught) {
      setError(formatApiError(caught));
    }
  }

  function openReview(next: ReviewView) {
    setParams({ id: next.id });
  }

  function backToInbox() {
    setParams({}, { replace: true });
  }

  function decideSlot(slot: ReviewSlot) {
    setDecideTarget({ slot, decision: 'APPROVE', comment: '' });
  }

  function commentRequired(decision: DecisionValue): boolean {
    return decision === 'CHANGES_REQUESTED' || decision === 'REJECT';
  }

  async function submitDecision(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!review || !pendingDecision) throw new Error('缺少评审目标');
    const target = pendingDecision;
    if (commentRequired(target.decision) && !target.comment.trim()) throw new Error('要求修改或驳回时必须填写说明');
    const result = await reviewApi.decide(review.id, {
      slotId: target.slot.id,
      decision: target.decision,
      expectedVersion: review.version,
      comment: target.comment.trim() || undefined,
      confirmation,
    });
    setReview(result.review);
    setNotice(
      result.published
        ? `全部槽位批准，服务端已发布文档 v${result.documentVersion ?? ''}。`
        : '决定已记录；仍有槽位未批准。',
    );
    setError('');
    setPendingDecision(null);
    setDecideTarget(null);
  }

  async function submitRevoke(confirmation: { ticketId: string; ticketSecret: string }) {
    if (!review || !pendingRevoke) throw new Error('缺少撤销目标');
    if (!pendingRevoke.reason.trim()) throw new Error('撤销原因不能为空');
    await reviewApi.revoke(pendingRevoke.decision.id, {
      expectedVersion: review.version,
      reason: pendingRevoke.reason.trim(),
      confirmation,
    });
    await reload();
    setNotice('批准已撤销；发布指针与受影响任务由服务端同步失效。');
    setPendingRevoke(null);
  }

  const revokeSlot = pendingRevoke
    ? (review?.slots.find((slot) => slot.id === pendingRevoke.decision.approvalSlotId) ?? null)
    : null;

  return (
    <section>
      <header className="page-head">
        <div>
          <h2>评审</h2>
          <p className="page-sub">
            槽位、摘要与版本均来自服务端。每个决定都要求准确槽位、最新版本与一次性票据。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect onChange={() => setReviews([])} />
          {reviewId ? (
            <button className="ghost" onClick={backToInbox}>
              返回待评审
            </button>
          ) : (
            <button
              className="ghost"
              disabled={!projectId || listLoading}
              onClick={() => {
                if (!projectId) return;
                setListLoading(true);
                reviewApi
                  .list(projectId, { assignedToMe: true, status: 'OPEN' })
                  .then((page) => {
                    setReviews(page.items);
                    setError('');
                  })
                  .catch((caught: unknown) => setError(formatApiError(caught)))
                  .finally(() => setListLoading(false));
              }}
            >
              {listLoading ? '加载中…' : '刷新'}
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="kb-notice">{notice}</p>}

      {!reviewId && !projectId && <p className="page-card muted">先选择项目。</p>}

      {!reviewId && projectId && (
        <div className="table-card">
          <div className="card-head">
            <h3>
              待评审收件箱<small>{reviews.length}</small>
            </h3>
            <span className="card-head-actions">
              <small>当前用户 · OPEN</small>
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>评审请求</th>
                  <th>候选版本</th>
                  <th>状态</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((item) => (
                  <tr key={item.id}>
                    <td>{item.kind}</td>
                    <td>
                      <span className="cell-mono cell-truncate" title={item.id}>
                        {item.id}
                      </span>
                    </td>
                    <td>
                      <span className="cell-mono cell-truncate">
                        {item.documentRevisionId ?? item.artifactSetId ?? '—'}
                      </span>
                    </td>
                    <td>
                      <span className="status-tag">{item.status}</span>
                    </td>
                    <td className="col-actions">
                      <button className="ghost" onClick={() => openReview(item)}>
                        打开评审
                      </button>
                    </td>
                  </tr>
                ))}
                {reviews.length === 0 && (
                  <tr className="table-empty">
                    <td colSpan={5}>{listLoading ? '加载中…' : '当前没有待评审请求。'}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {review && (
        <>
          <div className="table-card">
            <div className="card-head">
              <h3>
                {review.kind}
                <small>{review.status}</small>
              </h3>
              <span className="card-head-actions">
                <small>版本 v{review.version}</small>
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>评审请求</th>
                    <th>对象版本</th>
                    <th>对象摘要</th>
                    <th>文档修订</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>
                      <span className="cell-mono">{review.id}</span>
                    </td>
                    <td className="cell-num">v{review.version}</td>
                    <td>
                      <span className="cell-mono cell-truncate" data-testid="review-subject-digest" title={review.subjectDigest}>
                        {review.subjectDigest}
                      </span>
                    </td>
                    <td>
                      <span className="cell-mono cell-truncate">
                        {review.documentRevisionId ?? review.artifactSetId ?? '—'}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <div className="card-head">
              <h3>
                槽位<small>{review.slots.length}</small>
              </h3>
              <span className="card-head-actions">
                <small>已决 {review.decisions.length}</small>
              </span>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>槽位</th>
                    <th>必需角色</th>
                    <th>指定审批人</th>
                    <th>决定</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {review.slots.map((slot) => {
                    const decision = review.decisions.find((item) => item.approvalSlotId === slot.id);
                    const closed = review.status !== 'OPEN' || Boolean(decision);
                    return (
                      <tr key={slot.id}>
                        <td>
                          <strong>{slot.slotKey}</strong>
                          <div className="cell-mono cell-truncate">{slot.id}</div>
                        </td>
                        <td>{slot.requiredRoleId ?? '—'}</td>
                        <td>
                          <span className="cell-mono">{slot.requiredUserId}</span>
                        </td>
                        <td>
                          {decision ? (
                            <span className="status-tag">{DECISION_LABELS[decision.decision]}</span>
                          ) : (
                            <span className="muted">未决定</span>
                          )}
                        </td>
                        <td className="col-actions">
                          <div className="cell-actions row-actions">
                            <button className="ghost" disabled={closed} onClick={() => decideSlot(slot)}>
                              作出决定
                            </button>
                            {decision?.decision === 'APPROVE' && (
                              <button
                                className="danger"
                                onClick={() => setRevokeTarget({ decision, reason: '' })}
                              >
                                撤销批准
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {review.slots.length === 0 && (
                    <tr className="table-empty">
                      <td colSpan={5}>该评审没有槽位。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="table-card">
            <div className="card-head">
              <h3>
                决定记录<small>{review.decisions.length}</small>
              </h3>
            </div>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>决定</th>
                    <th>槽位</th>
                    <th>决定时摘要</th>
                    <th>说明</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {review.decisions.map((decision) => (
                    <tr key={decision.id}>
                      <td>
                        <span className="status-tag">{DECISION_LABELS[decision.decision]}</span>
                      </td>
                      <td>
                        <span className="cell-mono cell-truncate">{decision.approvalSlotId}</span>
                      </td>
                      <td>
                        <span className="cell-mono cell-truncate">{decision.subjectDigest}</span>
                      </td>
                      <td>{decision.comment || '—'}</td>
                      <td>{new Date(decision.createdAt).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                  {review.decisions.length === 0 && (
                    <tr className="table-empty">
                      <td colSpan={5}>还没有决定。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <Modal
        open={Boolean(decideTarget)}
        title="作出评审决定"
        description={
          decideTarget
            ? `槽位 ${decideTarget.slot.slotKey} · 评审 v${review?.version ?? '?'}`
            : ''
        }
        size="md"
        onClose={() => setDecideTarget(null)}
        footer={
          <>
            <button className="ghost" onClick={() => setDecideTarget(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!decideTarget || (commentRequired(decideTarget.decision) && !decideTarget.comment.trim())}
              onClick={() => {
                if (!decideTarget) return;
                const target = decideTarget;
                setDecideTarget(null);
                setRevokeTarget(null);
                // 预览与票据由 ConfirmationPrompt 负责；此处只确定服务端派生绑定的输入。
                setPendingDecision(target);
              }}
            >
              下一步：预览并验证密码
            </button>
          </>
        }
      >
        {decideTarget && (
          <div className="form-grid">
            <div className="field">
              <span>决定</span>
              <select
                value={decideTarget.decision}
                aria-label="评审决定"
                onChange={(event) =>
                  setDecideTarget({ ...decideTarget, decision: event.target.value as DecisionValue })
                }
              >
                <option value="APPROVE">批准</option>
                <option value="CHANGES_REQUESTED">要求修改</option>
                <option value="REJECT">驳回</option>
              </select>
            </div>
            <div className="field">
              <span>说明{commentRequired(decideTarget.decision) ? '（必填）' : ''}</span>
              <textarea
                value={decideTarget.comment}
                aria-label="评审说明"
                rows={3}
                onChange={(event) => setDecideTarget({ ...decideTarget, comment: event.target.value })}
              />
              {commentRequired(decideTarget.decision) && <small>要求修改或驳回时必须填写说明。</small>}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmationPrompt
        open={Boolean(pendingDecision)}
        title="确认评审决定"
        description={pendingDecision ? `槽位 ${pendingDecision.slot.slotKey}` : ''}
        binding={
          review && pendingDecision
            ? {
                action: 'REVIEW_DECIDE',
                projectId: review.projectId,
                targetType: 'REVIEW_REQUEST',
                targetId: review.id,
                expectedVersion: review.version,
                roleSlot: pendingDecision.slot.requiredRoleId
                  ? { roleId: pendingDecision.slot.requiredRoleId, approvalSlotId: pendingDecision.slot.id }
                  : null,
                payload: {
                  slotId: pendingDecision.slot.id,
                  decision: pendingDecision.decision,
                  subjectDigest: review.subjectDigest,
                  comment: pendingDecision.comment.trim() || null,
                },
              }
            : null
        }
        submitLabel="提交决定"
        onClose={() => setPendingDecision(null)}
        onConfirmed={async (confirmation) => {
          await submitDecision(confirmation);
        }}
      />

      <Modal
        open={Boolean(revokeTarget)}
        title="撤销批准（需二次验证）"
        description={review ? `评审 v${review.version}` : ''}
        size="md"
        onClose={() => setRevokeTarget(null)}
        footer={
          <>
            <button className="ghost" onClick={() => setRevokeTarget(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={!revokeTarget?.reason.trim()}
              onClick={() => {
                if (!revokeTarget) return;
                setPendingRevoke(revokeTarget);
                setRevokeTarget(null);
              }}
            >
              下一步：预览并验证密码
            </button>
          </>
        }
      >
        {revokeTarget && (
          <div className="form-grid">
            <div className="field">
              <span>撤销原因（必填）</span>
              <textarea
                value={revokeTarget.reason}
                aria-label="撤销原因"
                rows={3}
                onChange={(event) => setRevokeTarget({ ...revokeTarget, reason: event.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmationPrompt
        open={Boolean(pendingRevoke)}
        title="确认撤销批准"
        description={review ? `评审 v${review.version} · 决定 ${pendingRevoke?.decision.id ?? ''}` : ''}
        binding={
          review && pendingRevoke
            ? {
                action: 'REVIEW_REVOKE',
                projectId: review.projectId,
                targetType: 'REVIEW_DECISION',
                targetId: pendingRevoke.decision.id,
                expectedVersion: review.version,
                roleSlot: revokeSlot?.requiredRoleId
                  ? { roleId: revokeSlot.requiredRoleId, approvalSlotId: revokeSlot.id }
                  : null,
                payload: {
                  decisionId: pendingRevoke.decision.id,
                  subjectDigest: review.subjectDigest,
                  reason: pendingRevoke.reason.trim(),
                },
              }
            : null
        }
        submitLabel="撤销批准"
        onClose={() => setPendingRevoke(null)}
        onConfirmed={async (confirmation) => {
          await submitRevoke(confirmation);
        }}
      />
    </section>
  );
}
