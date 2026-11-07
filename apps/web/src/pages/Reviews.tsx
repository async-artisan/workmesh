import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatApiError } from '../api/client';
import { formatDateTime } from '../lib/datetime';
import { reviewApi, type ReviewDecision, type ReviewSlot, type ReviewView } from '../api/resources';
import { ConfirmationPrompt } from '../components/ConfirmationPrompt';
import { DelegationsPanel } from '../components/DelegationsPanel';
import type { DecisionSummaryData } from '../components/DecisionSummary';
import { Modal } from '../components/Modal';
import { ProjectSelect } from '../components/ProjectSelect';
import { FullValueDisclosure } from '../components/FullValueDisclosure';
import { InlineLoading, SkeletonLines, TableSkeletonRows } from '../components/Skeleton';
import { useProjectContext } from '../hooks/useProjectContext';
import {
  DECISION_LABELS,
  REVIEW_KIND_LABELS,
  REVIEW_STATUS_LABELS,
  STEP_LABELS,
  decisionImpact,
  labelFor,
  type ReviewDecisionValue,
} from '../lib/labels';

type DecisionValue = ReviewDecisionValue;

/**
 * 窄屏（≤720px）收件箱用卡片替代表格：断点与 mobile-lists.css 保持一致。
 * jsdom 没有 matchMedia 时按桌面表格渲染，既有交互与读屏结构完全不变。
 */
const NARROW_LIST_QUERY = '(max-width: 720px)';

function subscribeNarrowList(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mediaQuery = window.matchMedia(NARROW_LIST_QUERY);
  mediaQuery.addEventListener?.('change', onChange);
  return () => mediaQuery.removeEventListener?.('change', onChange);
}

function getNarrowListSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_LIST_QUERY).matches;
}

function useNarrowList(): boolean {
  return useSyncExternalStore(subscribeNarrowList, getNarrowListSnapshot, () => false);
}

/** 收件箱分页请求的序号：切项目 / 刷新 / 返回收件箱时淘汰仍在途的旧响应。 */
function nextListRequestId(current: number): number {
  return current + 1;
}

/** 「已决定」历史需要覆盖三种终态；服务端按单一状态过滤，前端合并去重。 */
const DECIDED_STATUSES = ['APPROVED', 'CHANGES_REQUESTED', 'REJECTED'] as const;

function lastDecisionAt(review: ReviewView): number {
  const times = review.decisions
    .map((decision) => new Date(decision.createdAt).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length > 0 ? Math.max(...times) : 0;
}

/** 合并三种终态并按最近一次决定时间倒序，回看时先看到刚处理过的。 */
function mergeDecidedReviews(items: ReviewView[]): ReviewView[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return [...byId.values()].sort((a, b) => lastDecisionAt(b) - lastDecisionAt(a));
}

/**
 * 服务端按游标返回下一页；加载更多只追加新 ID，保持服务端顺序，不重复插入同一条评审。
 */
function appendUniqueReviews(current: ReviewView[], incoming: ReviewView[]): ReviewView[] {
  const seen = new Set(current.map((item) => item.id));
  const appended: ReviewView[] = [];
  incoming.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    appended.push(item);
  });
  return appended.length === 0 ? current : [...current, ...appended];
}

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
 * 把“用户实际要提交的决定”翻译成确认前的业务摘要：决定、对象、槽位与版本
 * 全部取自当前确认目标（而不是点开流程时的旧快照），说明与影响随最新输入实时变化。
 */
function buildDecisionSummary(sourceReview: ReviewView, target: DecideTarget): DecisionSummaryData {
  const subject = sourceReview.requirement
    ? `${sourceReview.requirement.code} · ${sourceReview.requirement.title}`
    : sourceReview.subjectLabel
      ? labelFor(STEP_LABELS, sourceReview.subjectLabel)
      : labelFor(REVIEW_KIND_LABELS, sourceReview.kind);
  const slotLabel = sourceReview.role?.title
    ? `${target.slot.slotKey} · ${sourceReview.role.title}`
    : target.slot.slotKey;

  return {
    decision: target.decision,
    subject,
    reviewKindLabel: labelFor(REVIEW_KIND_LABELS, sourceReview.kind),
    slotLabel,
    // 与 binding / 决定 payload 的 expectedVersion 保持一致，避免确认页与提交版本不一致。
    version: sourceReview.version,
    // 收件箱列表没有加载证据详情，这里只提示，不伪造具体证据。
    artifacts: [{ label: '证据详情', detail: '请在评审决定页核对完整证据' }],
    comment: target.comment.trim(),
    impact: decisionImpact(target.decision, sourceReview.kind),
  };
}

/**
 * 评审页只按服务端返回的评审 ID 读取，槽位、摘要与版本全部来自服务端。
 * 决定与撤销都先经过动作预览 + 密码二验签发一次性票据；权限拒绝、旧版本与
 * 槽位不符一律原样展示服务端错误，不根据按钮状态推断权限。
 */
export function Reviews() {
  const { projectId } = useProjectContext();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reviewId = params.get('id') ?? '';
  const [review, setReview] = useState<ReviewView | null>(null);
  const [reviews, setReviews] = useState<ReviewView[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [loadedListKey, setLoadedListKey] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [scope, setScope] = useState<'open' | 'decided' | 'delegations'>('open');
  const [loadMoreError, setLoadMoreError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [decideTarget, setDecideTarget] = useState<DecideTarget | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<RevokeTarget | null>(null);
  const [pendingDecision, setPendingDecision] = useState<DecideTarget | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<RevokeTarget | null>(null);
  // 所有收件箱列表请求共享的代号；只有代号最新的响应允许写回列表状态。
  const listRequestRef = useRef(0);
  const narrowList = useNarrowList();
  // 「项目 + 收件箱范围」决定列表内容是否还是同一份：变了就显示骨架，不变（刷新）就保留旧行。
  const listKey = `${projectId ?? ''}|${scope}`;
  const listKeyRef = useRef(listKey);
  const firstLoad =
    Boolean(projectId) &&
    !reviewId &&
    scope !== 'delegations' &&
    (loadedListKey !== listKey || (listLoading && reviews.length === 0));
  const showInboxLoading = firstLoad || listLoading;
  const inboxEmptyText = error
    ? '加载失败，请重试。'
    : scope === 'decided'
      ? '最近没有已决定的评审。'
      : '当前没有待评审请求。';

  useEffect(() => {
    let alive = true;
    // 项目切换 / 刷新 / 从详情返回时，旧请求的响应必须被丢弃，不能覆盖新一轮列表。
    const requestId = nextListRequestId(listRequestRef.current);
    listRequestRef.current = requestId;
    setError('');
    setLoadMoreError('');
    const currentKey = `${projectId ?? ''}|${scope}`;
    // 切项目 / 切换收件箱范围才清空旧行；刷新（reloadToken）保留已显示的数据。
    const scopeChanged = listKeyRef.current !== currentKey;
    listKeyRef.current = currentKey;
    if (!reviewId) {
      setReview(null);
      if (!projectId) {
        setReviews([]);
        setNextCursor(null);
        setHasMore(false);
        setListLoading(false);
        setLoadingMore(false);
        setLoadedListKey(null);
        return () => {
          alive = false;
        };
      }
      // 首屏（含切项目、刷新、返回收件箱）一律从第一页重新加载，游标重置但不清空已显示的行。
      if (scopeChanged) setReviews([]);
      setNextCursor(null);
      setHasMore(false);
      setListLoading(true);
      setLoadingMore(false);
      if (scope === 'delegations') {
        // 委托/超时面板自己加载数据；复用收件箱游标会误导“加载全部”。
        setReviews([]);
        setNextCursor(null);
        setHasMore(false);
        setListLoading(false);
        setLoadedListKey(null);
        return () => {
          alive = false;
        };
      }
      const request =
        scope === 'decided'
          ? Promise.all(
              DECIDED_STATUSES.map((status) =>
                reviewApi.list(projectId, { assignedToMe: true, status }),
              ),
            ).then((pages) => ({
              items: mergeDecidedReviews(pages.flatMap((page) => page.items)),
              nextCursor: null,
              hasMore: false,
            }))
          : reviewApi.list(projectId, { assignedToMe: true, status: 'OPEN' });
      request
        .then((page) => {
          if (!alive || requestId !== listRequestRef.current) return;
          setReviews(page.items);
          setNextCursor(page.nextCursor ?? null);
          // 服务端没有 total，只能用游标 / hasMore 判断是否还有下一页，绝不伪造总数。
          setHasMore(Boolean(page.nextCursor) || Boolean(page.hasMore));
          setNotice('');
          setLoadedListKey(currentKey);
        })
        .catch((caught: unknown) => {
          if (!alive || requestId !== listRequestRef.current) return;
          // 刷新失败保留已显示的列表，只在顶部提示错误；首屏失败时用错误空态替代一直转圈。
          setError(formatApiError(caught));
          setLoadedListKey(currentKey);
        })
        .finally(() => {
          if (alive && requestId === listRequestRef.current) setListLoading(false);
        });
      return () => {
        alive = false;
      };
    }
    setListLoading(false);
    setLoadingMore(false);
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
  }, [reviewId, projectId, reloadToken, scope]);

  /**
   * 刷新：保留已显示的列表，只在列表头部提示加载中；切项目时传 clearRows 清掉别的项目的行。
   * 请求与竞态统一由上面的 effect 负责。
   */
  function resetInbox(options?: { clearRows?: boolean }) {
    listRequestRef.current = nextListRequestId(listRequestRef.current);
    if (options?.clearRows) {
      setReviews([]);
      setNextCursor(null);
      setHasMore(false);
      setLoadedListKey(null);
    }
    setLoadingMore(false);
    setLoadMoreError('');
    setListLoading(true);
    setReloadToken((value) => value + 1);
  }

  /**
   * 加载更多：只追加下一页里此前没有出现过的 review；失败时保留已有列表与游标，可重试。
   */
  async function loadMore() {
    // 已决定历史按三种终态各取一页合并；委托视图不列表分页。
    if (scope !== 'open' || !projectId || !nextCursor || loadingMore) return;
    const requestId = listRequestRef.current;
    setLoadingMore(true);
    setLoadMoreError('');
    try {
      const page = await reviewApi.list(projectId, {
        assignedToMe: true,
        status: 'OPEN',
        cursor: nextCursor,
      });
      if (requestId !== listRequestRef.current) return;
      setReviews((current) => appendUniqueReviews(current, page.items));
      setNextCursor(page.nextCursor ?? null);
      setHasMore(Boolean(page.nextCursor) || Boolean(page.hasMore));
      setNotice('');
    } catch (caught) {
      if (requestId !== listRequestRef.current) return;
      // 加载更多失败不清空列表：保留已显示数据，只在底部给出可读错误与重试入口。
      setLoadMoreError(formatApiError(caught));
    } finally {
      if (requestId === listRequestRef.current) setLoadingMore(false);
    }
  }

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
    if (commentRequired(target.decision) && !target.comment.trim())
      throw new Error('要求修改或驳回时必须填写说明');
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

  // 摘要每次渲染都从“当前待确认目标 + 最新 review”派生：用户修改决定或说明后，确认页立即反映最新值。
  const decisionSummary =
    review && pendingDecision ? buildDecisionSummary(review, pendingDecision) : undefined;

  return (
    <section className="reviews-page">
      <header className="page-head">
        <div>
          <h2>评审</h2>
          <p className="page-sub">
            先看待我评审，再看已决定历史；提交决定需要确认密码并签发一次性票据，服务端会校验版本与槽位。
          </p>
        </div>
        <div className="page-actions">
          <ProjectSelect
            onChange={() => resetInbox({ clearRows: true })}
            onCreateProject={() => navigate('/projects')}
          />
          {reviewId ? (
            <button className="ghost" onClick={backToInbox}>
              返回待评审
            </button>
          ) : (
            <button
              className="ghost"
              disabled={!projectId || listLoading}
              onClick={() => resetInbox()}
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
              {scope === 'delegations'
                ? '审批委托与超时'
                : scope === 'decided'
                  ? '已决定历史'
                  : '待评审收件箱'}
              {!firstLoad && <small>{scope === 'delegations' ? '' : reviews.length}</small>}
            </h3>
            {showInboxLoading && (
              <InlineLoading label={firstLoad ? '正在加载收件箱…' : '正在刷新收件箱…'} />
            )}
            <span className="card-head-actions">
              <button
                type="button"
                className={scope === 'open' ? 'primary' : 'ghost'}
                aria-pressed={scope === 'open'}
                onClick={() => setScope('open')}
              >
                待我评审
              </button>
              <button
                type="button"
                className={scope === 'decided' ? 'primary' : 'ghost'}
                aria-pressed={scope === 'decided'}
                onClick={() => setScope('decided')}
              >
                已决定
              </button>
              <button
                type="button"
                className={scope === 'delegations' ? 'primary' : 'ghost'}
                aria-pressed={scope === 'delegations'}
                onClick={() => setScope('delegations')}
              >
                委托 / 超时
              </button>
            </span>
          </div>
          {scope === 'delegations' ? (
            <DelegationsPanel projectId={projectId} />
          ) : narrowList ? (
            <ul
              className="wm-mobile-card-list"
              data-testid="reviews-card-list"
              aria-busy={showInboxLoading || undefined}
            >
              {firstLoad ? (
                Array.from({ length: 4 }, (_, index) => (
                  <li className="wm-mobile-card" key={index} aria-hidden="true">
                    <SkeletonLines lines={2} />
                  </li>
                ))
              ) : (
                <>
                  {reviews.map((item) => (
                    <li key={item.id} className="wm-mobile-card" data-testid="review-card">
                      <div className="wm-mobile-card-head">
                        <span className="status-tag">
                          {labelFor(REVIEW_KIND_LABELS, item.kind)}
                        </span>
                        <span className="status-tag">
                          {labelFor(REVIEW_STATUS_LABELS, item.status)}
                        </span>
                      </div>
                      <p className="wm-mobile-card-title">
                        {item.requirement
                          ? `${item.requirement.code} · ${item.requirement.title}`
                          : item.id.slice(0, 8)}
                      </p>
                      <p className="wm-mobile-card-meta">
                        {item.subjectLabel
                          ? item.taskId && item.stepDisplayName?.trim()
                            ? item.stepDisplayName.trim()
                            : labelFor(STEP_LABELS, item.subjectLabel)
                          : `摘要 ${item.subjectDigest.slice(0, 10)}`}
                      </p>
                      <p className="wm-mobile-card-meta">
                        {item.role?.title ?? '—'} · v{item.version}
                      </p>
                      <p className="wm-mobile-card-meta">
                        负责人：服务端未提供负责人 · 责任角色：{item.role?.title ?? '状态待确认'}
                      </p>
                      <p className="wm-mobile-card-meta">下一步：打开评审</p>
                      <details className="wm-mobile-card-details">
                        <summary>查看评审元数据</summary>
                        <p className="wm-mobile-card-meta">评审对象标识：{item.subjectDigest}</p>
                        <p className="wm-mobile-card-meta">版本：v{item.version}</p>
                      </details>
                      <div className="wm-mobile-card-actions">
                        <button className="ghost" onClick={() => openReview(item)}>
                          打开评审
                        </button>
                      </div>
                    </li>
                  ))}
                  {reviews.length === 0 && <li className="wm-mobile-empty">{inboxEmptyText}</li>}
                </>
              )}
            </ul>
          ) : (
            <div
              className="table-scroll"
              data-testid="reviews-table"
              aria-busy={showInboxLoading || undefined}
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>评审对象</th>
                    <th>角色 / 版本</th>
                    <th>状态</th>
                    <th className="col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {firstLoad ? (
                    <TableSkeletonRows rows={5} columns={5} />
                  ) : (
                    <>
                      {reviews.map((item) => {
                        return (
                          <tr key={item.id}>
                            <td>{labelFor(REVIEW_KIND_LABELS, item.kind)}</td>
                            <td>
                              <strong>
                                {item.requirement
                                  ? `${item.requirement.code} · ${item.requirement.title}`
                                  : item.id.slice(0, 8)}
                              </strong>
                              <div className="task-row-meta">
                                {item.subjectLabel
                                  ? item.taskId && item.stepDisplayName?.trim()
                                    ? item.stepDisplayName.trim()
                                    : labelFor(STEP_LABELS, item.subjectLabel)
                                  : `摘要 ${item.subjectDigest.slice(0, 10)}`}
                              </div>
                            </td>
                            <td>
                              {item.role?.title ?? '—'}
                              <span className="cell-mono"> · v{item.version}</span>
                            </td>
                            <td>
                              <span className="status-tag">
                                {labelFor(REVIEW_STATUS_LABELS, item.status)}
                              </span>
                            </td>
                            <td className="col-actions">
                              <button className="ghost" onClick={() => openReview(item)}>
                                打开评审
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {reviews.length === 0 && (
                        <tr className="table-empty">
                          <td colSpan={5}>{inboxEmptyText}</td>
                        </tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
          {scope !== 'delegations' && (
            <div className="table-foot">
              {!firstLoad && <small>已显示 {reviews.length} 条</small>}
              {scope === 'decided' ? (
                <small>已通过 / 要求修改 / 已驳回各取最近一页，按决定时间倒序</small>
              ) : loadMoreError ? (
                <div className="pager">
                  <span className="error" role="alert">
                    {loadMoreError}
                  </span>
                  <button
                    className="ghost"
                    type="button"
                    disabled={loadingMore}
                    onClick={() => void loadMore()}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <div className="pager">
                  {hasMore && nextCursor ? (
                    <button
                      className="ghost"
                      type="button"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {loadingMore ? '加载中…' : '加载更多'}
                    </button>
                  ) : (
                    !listLoading && !error && <small>已加载全部</small>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {review && (
        <>
          <div className="table-card">
            <div className="card-head">
              <h3>
                {labelFor(REVIEW_KIND_LABELS, review.kind)}
                <small>{labelFor(REVIEW_STATUS_LABELS, review.status)}</small>
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
                      <span data-testid="review-subject-digest">
                        <FullValueDisclosure
                          label="对象摘要"
                          value={review.subjectDigest}
                          preview={
                            review.subjectDigest.length > 32
                              ? `${review.subjectDigest.slice(0, 12)}…`
                              : review.subjectDigest
                          }
                        />
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
                    const decision = review.decisions.find(
                      (item) => item.approvalSlotId === slot.id,
                    );
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
                            <span className="status-tag">
                              {labelFor(DECISION_LABELS, decision.decision)}
                            </span>
                          ) : (
                            <span className="muted">未决定</span>
                          )}
                        </td>
                        <td className="col-actions">
                          <div className="cell-actions row-actions">
                            <button
                              className="ghost"
                              disabled={closed}
                              onClick={() => decideSlot(slot)}
                            >
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
                        <span className="status-tag">
                          {labelFor(DECISION_LABELS, decision.decision)}
                        </span>
                      </td>
                      <td>
                        <span className="cell-mono cell-truncate">{decision.approvalSlotId}</span>
                      </td>
                      <td>
                        <FullValueDisclosure
                          label="对象摘要"
                          value={decision.subjectDigest}
                          preview={
                            decision.subjectDigest.length > 32
                              ? `${decision.subjectDigest.slice(0, 12)}…`
                              : decision.subjectDigest
                          }
                        />
                      </td>
                      <td>{decision.comment || '—'}</td>
                      <td>{formatDateTime(decision.createdAt)}</td>
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
          decideTarget ? `槽位 ${decideTarget.slot.slotKey} · 评审 v${review?.version ?? '?'}` : ''
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
              disabled={
                !decideTarget ||
                (commentRequired(decideTarget.decision) && !decideTarget.comment.trim())
              }
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
                  setDecideTarget({
                    ...decideTarget,
                    decision: event.target.value as DecisionValue,
                  })
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
                onChange={(event) =>
                  setDecideTarget({ ...decideTarget, comment: event.target.value })
                }
              />
              {commentRequired(decideTarget.decision) && (
                <small>要求修改或驳回时必须填写说明。</small>
              )}
            </div>
          </div>
        )}
      </Modal>

      <ConfirmationPrompt
        open={Boolean(pendingDecision)}
        title="确认评审决定"
        description={pendingDecision ? `槽位 ${pendingDecision.slot.slotKey}` : ''}
        summary={decisionSummary}
        binding={
          review && pendingDecision
            ? {
                action: 'REVIEW_DECIDE',
                projectId: review.projectId,
                targetType: 'REVIEW_REQUEST',
                targetId: review.id,
                expectedVersion: review.version,
                roleSlot: pendingDecision.slot.requiredRoleId
                  ? {
                      roleId: pendingDecision.slot.requiredRoleId,
                      approvalSlotId: pendingDecision.slot.id,
                    }
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
                onChange={(event) =>
                  setRevokeTarget({ ...revokeTarget, reason: event.target.value })
                }
              />
            </div>
          </div>
        )}
      </Modal>

      <ConfirmationPrompt
        open={Boolean(pendingRevoke)}
        title="确认撤销批准"
        description={
          review ? `评审 v${review.version} · 决定 ${pendingRevoke?.decision.id ?? ''}` : ''
        }
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
