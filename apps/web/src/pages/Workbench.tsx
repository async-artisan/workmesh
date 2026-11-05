import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { ApiError, formatApiError } from '../api/client';
import {
  activityApi,
  changeApi,
  type ActivityItem,
  type WorkbenchChangeItem,
  type WorkbenchReadyTaskItem,
  type WorkbenchReviewItem,
  type WorkbenchSnapshot,
} from '../api/resources';
import { ChangeDrawer } from '../components/ChangeDrawer';
import { BatchReviewApprove, type BatchReviewTarget } from '../components/BatchReviewApprove';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Modal } from '../components/Modal';
import { ReviewDecisionDrawer } from '../components/ReviewDecisionDrawer';
import { StaleDataBanner, formatUpdatedAtClock } from '../components/StaleDataBanner';
import { useProjectContext } from '../hooks/useProjectContext';
import { ACTION_LABELS, STEP_LABELS, labelFor } from '../lib/labels';
import { getWorkbenchSnapshot } from '../lib/workbenchSnapshot';

type Tab = 'all' | 'signOffs' | 'approvals' | 'changes' | 'ready';
type SortKey = 'oldest' | 'newest' | 'project' | 'type';

/**
 * 工作台数据状态机：
 * - loading：请求进行中（首次加载时没有可展示数据，只显示骨架屏）；
 * - ready：本次请求成功，updatedAt 是真实同步时间；
 * - stale：本次请求失败但保留上次成功快照，页面仍可用，数据可能过期；
 * - error：请求失败且没有任何可展示快照（首次加载失败）。
 */
type WorkbenchDataState = 'loading' | 'ready' | 'stale' | 'error';

/** 批量确认的提交目标：只包含当前快照中仍存在且被选中的变更。 */
interface BatchTarget {
  recipientId: string;
  label: string;
  version: number;
}

type BatchItemStatus = 'success' | 'failed' | 'unprocessed';

interface BatchResult extends BatchTarget {
  status: BatchItemStatus;
  error?: string;
  conflict?: boolean;
}

const ROLE_PREF_KEY = 'workmesh.workbench.role';
const FILTER_CHANGED_NOTICE = '筛选已变化，已清除之前的选择。';
const SNAPSHOT_CHANGED_NOTICE = '列表已更新，已移除不再存在的选中项。';
const BATCH_CONFLICT_HINT = '数据已变化，请重新加载';
const BATCH_REFRESH_FAILED = '批量确认已完成，但刷新工作台失败；当前显示的是上次成功的数据。';

const TAB_KEYS: Tab[] = ['all', 'signOffs', 'approvals', 'changes', 'ready'];

function isTab(value: string | null): value is Tab {
  return value !== null && (TAB_KEYS as string[]).includes(value);
}

type WorkbenchItem =
  | { type: 'review'; data: WorkbenchReviewItem }
  | { type: 'change'; data: WorkbenchChangeItem }
  | { type: 'ready'; data: WorkbenchReadyTaskItem };

const TAB_LABELS: Record<Tab, string> = {
  all: '全部',
  signOffs: '待签字',
  approvals: '待审批',
  changes: '待确认变更',
  ready: '可开工',
};

function isSignOffKind(kind: string): boolean {
  return kind === 'TASK_ACCEPTANCE' || kind === 'RELEASE_ACCEPTANCE';
}

function itemRoleKeys(item: WorkbenchItem): string[] {
  if (item.type === 'review') return item.data.role ? [item.data.role.key] : [];
  if (item.type === 'ready') return item.data.role ? [item.data.role.key] : [];
  return item.data.pendingRoles.map((role) => role.key);
}

function itemSearchText(item: WorkbenchItem): string {
  const requirement = item.data.requirement;
  const parts = [requirement?.code ?? '', requirement?.title ?? '', item.data.projectName];
  if (item.type === 'review') parts.push(item.data.subjectLabel, item.data.role?.title ?? '');
  if (item.type === 'ready') parts.push(item.data.stepKey, item.data.role?.title ?? '');
  if (item.type === 'change') parts.push(item.data.changedFields.join(' '));
  return parts.join(' ').toLowerCase();
}

function itemRequirementPath(item: WorkbenchItem): string | null {
  const code = item.data.requirement?.code;
  if (!code) return null;
  const tab = item.type === 'review' ? 'tasks' : item.type === 'change' ? 'changes' : 'overview';
  return `/requirements/${encodeURIComponent(code)}?tab=${tab}`;
}

function itemRank(item: WorkbenchItem): number {
  if (item.type === 'review') return isSignOffKind(item.data.kind) ? 0 : 2;
  if (item.type === 'change') return 1;
  return 3;
}

function ageLabel(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return '刚刚';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

function requirementLabel(item: {
  requirement: { code: string; title: string } | null;
  subjectLabel?: string;
  stepKey?: string;
}): string {
  if (item.requirement) return `${item.requirement.code} · ${item.requirement.title}`;
  return item.subjectLabel ?? item.stepKey ?? '未关联需求';
}

function batchStatusLabel(status: BatchItemStatus): string {
  if (status === 'success') return '已确认';
  if (status === 'failed') return '失败';
  return '未处理';
}

/**
 * 工作台：跨项目聚合“待签字 / 待审批 / 待确认变更 / 可开工任务”。
 * 只做只读聚合与导航；签字、确认变更仍进入各自页面并走服务端票据。
 */
export function Workbench() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { projects } = useProjectContext();
  const [scope, setScope] = useState(params.get('project') ?? '');
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(null);
  const [dataState, setDataState] = useState<WorkbenchDataState>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>(
    isTab(params.get('type')) ? (params.get('type') as Tab) : 'all',
  );
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState(() => {
    try {
      return localStorage.getItem(ROLE_PREF_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [sort, setSort] = useState<SortKey>('oldest');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [changeTarget, setChangeTarget] = useState<WorkbenchChangeItem | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  // 单条确认自己的错误：刷新失败等页面级错误不应冒充“这次确认失败”。
  const [changeError, setChangeError] = useState('');
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [selectedReviews, setSelectedReviews] = useState<Set<string>>(new Set());
  const [reviewBatchOpen, setReviewBatchOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [batchRefreshError, setBatchRefreshError] = useState('');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  // 快照 / 选择项的同步镜像：异步回调里读到的必须是最新值，而不是渲染时的闭包。
  const snapshotRef = useRef<WorkbenchSnapshot | null>(null);
  const selectionRef = useRef<Set<string>>(new Set());
  const filterKeyRef = useRef({ tab, query, roleFilter, scope });

  function updateSelection(next: Set<string>) {
    selectionRef.current = next;
    setSelectedChanges(next);
  }

  /**
   * 拉取工作台快照。返回是否成功，便于批量流程区分“刷新失败但保留结果”。
   * 失败时不清空旧数据：已有快照进入 stale，只有首次失败才是页面级 error。
   */
  async function load(options: { force?: boolean } = { force: true }): Promise<boolean> {
    setLoading(true);
    try {
      const value = await getWorkbenchSnapshot(scope || null, {
        force: options.force ?? true,
      });
      snapshotRef.current = value;
      setSnapshot(value);
      setUpdatedAt(new Date());
      setDataState('ready');
      setError('');
      // 刷新后旧的选中项可能已被删除或被他人处理：与当前快照求交，避免批量提交到已失效的收件人。
      const alive = new Set(value.changes.map((change) => change.recipientId));
      const disappeared = [...selectionRef.current].filter((id) => !alive.has(id));
      if (disappeared.length > 0) {
        updateSelection(new Set([...selectionRef.current].filter((id) => alive.has(id))));
        setNotice(SNAPSHOT_CHANGED_NOTICE);
      }
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      setDataState(snapshotRef.current ? 'stale' : 'error');
      return false;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // 项目范围变化后，旧快照属于别的范围，不能再冒充“上次成功数据”继续展示。
    snapshotRef.current = null;
    setSnapshot(null);
    setUpdatedAt(null);
    setDataState('loading');
    // 首次进入允许复用顶部铃铛刚拉取的快照；用户后续刷新/操作会 force 拉新数据。
    void load({ force: false });
    // load 依赖当前 scope；scope 变化本身就是触发条件。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // tab / 搜索词 / 角色筛选 / 项目范围变化都会让旧选择不再对应同一批可见数据。
  useEffect(() => {
    const previous = filterKeyRef.current;
    if (
      previous.tab === tab &&
      previous.query === query &&
      previous.roleFilter === roleFilter &&
      previous.scope === scope
    ) {
      return;
    }
    filterKeyRef.current = { tab, query, roleFilter, scope };
    if (selectionRef.current.size > 0) {
      updateSelection(new Set());
      setNotice(FILTER_CHANGED_NOTICE);
    }
    setSelectedReviews(new Set());
    // updateSelection / setNotice 是稳定语义的状态写入，不需要作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, query, roleFilter, scope]);

  useEffect(() => {
    try {
      if (roleFilter) localStorage.setItem(ROLE_PREF_KEY, roleFilter);
      else localStorage.removeItem(ROLE_PREF_KEY);
    } catch {
      // 隐私模式下 localStorage 可能不可写，忽略即可。
    }
  }, [roleFilter]);

  useEffect(() => {
    activityApi
      .list(20)
      .then((page) => setActivity(page.items))
      .catch(() => setActivity([]));
  }, []);

  function toggleSelected(recipientId: string) {
    const next = new Set(selectionRef.current);
    if (next.has(recipientId)) next.delete(recipientId);
    else next.add(recipientId);
    updateSelection(next);
  }

  /** 打开批量确认：每次重新开始都清空上一次的结果与进度。 */
  function openBatch() {
    setBatchResults([]);
    setBatchProgress(null);
    setBatchRefreshError('');
    setBatchOpen(true);
  }

  /**
   * 逐条确认：失败即停止（后续标记 unprocessed），成功的条目立即从重试集合移除，
   * 最后刷新工作台；刷新失败时保留结果弹窗并进入 stale 状态。
   * retry 模式在既有结果上累加，已成功的条目不会被重新提交。
   */
  async function runBatch(targets: BatchTarget[], mode: 'new' | 'retry' = 'new') {
    if (targets.length === 0) return;
    setBatchBusy(true);
    setBatchRefreshError('');
    setBatchProgress({ current: 1, total: targets.length });
    const carried =
      mode === 'retry' ? batchResults.filter((result) => result.status === 'success') : [];
    const results: BatchResult[] = targets.map((target) => ({
      ...target,
      status: 'unprocessed',
    }));
    const publish = () => setBatchResults([...carried, ...results]);
    publish();
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      setBatchProgress({ current: index + 1, total: targets.length });
      try {
        await changeApi.ack(target.recipientId, target.version);
        results[index] = { ...target, status: 'success' };
        publish();
        // 成功项立即移出选择：重试集合只由 failed / unprocessed 构成，绝不重复提交。
        if (selectionRef.current.has(target.recipientId)) {
          const next = new Set(selectionRef.current);
          next.delete(target.recipientId);
          updateSelection(next);
        }
      } catch (caught) {
        results[index] = {
          ...target,
          status: 'failed',
          error: formatApiError(caught),
          conflict: caught instanceof ApiError && caught.status === 409,
        };
        publish();
        // 失败即停止：剩余条目保持 unprocessed，由用户显式重试。
        break;
      }
    }
    const refreshed = await load();
    if (!refreshed) {
      setBatchRefreshError(BATCH_REFRESH_FAILED);
    } else {
      const successCount = results.filter((result) => result.status === 'success').length;
      if (successCount > 0) setNotice(`已确认 ${successCount} 条变更。`);
    }
    setBatchProgress(null);
    setBatchBusy(false);
  }

  /** 重试只提交失败 / 未处理、且当前快照中仍存在的条目。 */
  function retryFailedBatch() {
    const alive = new Map(
      (snapshotRef.current?.changes ?? []).map((change) => [change.recipientId, change]),
    );
    const targets: BatchTarget[] = batchResults.flatMap((result) => {
      if (result.status === 'success') return [];
      const change = alive.get(result.recipientId);
      if (!change) return [];
      return [
        {
          recipientId: change.recipientId,
          label: requirementLabel(change),
          version: change.version,
        },
      ];
    });
    void runBatch(targets, 'retry');
  }

  /** 页签键盘操作：左右方向键切换、Home/End 跳首尾（roving tabindex）。 */
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const TAB_KEYS: Tab[] = ['all', 'signOffs', 'approvals', 'changes', 'ready'];

  function onTabKeyDown(event: { key: string; preventDefault: () => void }) {
    const index = TAB_KEYS.indexOf(tab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TAB_KEYS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_KEYS.length) % TAB_KEYS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TAB_KEYS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setTab(TAB_KEYS[nextIndex]);
    window.requestAnimationFrame(() => tabRefs.current[nextIndex!]?.focus());
  }

  /** 复制可执行命令：claim 只接受 taskId，不能用需求编号替代。 */
  async function copyCli(taskId: string) {
    const command = `workmesh claim --task ${taskId}`;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(command);
      setNotice(`已复制：${command}（在业务项目仓库根目录执行）`);
      setError('');
    } catch {
      setNotice(`无法写入剪贴板，请手动复制：${command}`);
    }
  }

  /** 打开单条确认抽屉时清掉上一次的确认错误，避免把旧错误带进新抽屉。 */
  function openChange(change: WorkbenchChangeItem) {
    setChangeError('');
    setChangeTarget(change);
  }

  async function ackChange() {
    if (!changeTarget) return;
    setChangeBusy(true);
    try {
      await changeApi.ack(changeTarget.recipientId, changeTarget.version);
      setChangeTarget(null);
      setChangeError('');
      setNotice('变更已确认。');
      setError('');
      await load();
    } catch (caught) {
      setChangeError(formatApiError(caught));
    } finally {
      setChangeBusy(false);
    }
  }

  const signOffReviews = useMemo(
    () => (snapshot?.reviews ?? []).filter((review) => isSignOffKind(review.kind)),
    [snapshot],
  );
  const approvalReviews = useMemo(
    () => (snapshot?.reviews ?? []).filter((review) => !isSignOffKind(review.kind)),
    [snapshot],
  );
  const counts = {
    signOffs: signOffReviews.length,
    approvals: approvalReviews.length,
    changes: snapshot?.counts.changes ?? 0,
    readyTasks: snapshot?.counts.readyTasks ?? 0,
    total:
      signOffReviews.length +
      approvalReviews.length +
      (snapshot?.counts.changes ?? 0) +
      (snapshot?.counts.readyTasks ?? 0),
  };

  const roleOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const review of snapshot?.reviews ?? [])
      if (review.role) map.set(review.role.key, review.role.title);
    for (const task of snapshot?.readyTasks ?? [])
      if (task.role) map.set(task.role.key, task.role.title);
    for (const change of snapshot?.changes ?? [])
      for (const role of change.pendingRoles) map.set(role.key, role.title);
    return [...map.entries()]
      .map(([key, title]) => ({ key, title }))
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  }, [snapshot]);

  const items = useMemo<WorkbenchItem[]>(() => {
    if (!snapshot) return [];
    const reviewItems = snapshot.reviews.map((data) => ({ type: 'review' as const, data }));
    const changeItems = snapshot.changes.map((data) => ({ type: 'change' as const, data }));
    const readyItems = snapshot.readyTasks.map((data) => ({ type: 'ready' as const, data }));
    let base: WorkbenchItem[];
    if (tab === 'signOffs') base = reviewItems.filter((item) => isSignOffKind(item.data.kind));
    else if (tab === 'approvals')
      base = reviewItems.filter((item) => !isSignOffKind(item.data.kind));
    else if (tab === 'changes') base = changeItems;
    else if (tab === 'ready') base = readyItems;
    else base = [...reviewItems, ...changeItems, ...readyItems];

    const text = query.trim().toLowerCase();
    const filtered = base.filter((item) => {
      if (text && !itemSearchText(item).includes(text)) return false;
      if (roleFilter && !itemRoleKeys(item).includes(roleFilter)) return false;
      return true;
    });

    const ageOf = (item: WorkbenchItem) => item.data.ageSeconds ?? -1;
    return [...filtered].sort((a, b) => {
      if (sort === 'newest') return ageOf(a) - ageOf(b);
      if (sort === 'type') return itemRank(a) - itemRank(b) || ageOf(b) - ageOf(a);
      // "按项目"的组顺序在 groups 里排；组内仍按最久未处理。
      return ageOf(b) - ageOf(a);
    });
  }, [snapshot, tab, query, roleFilter, sort]);

  const visibleActivity = scope ? activity.filter((item) => item.projectId === scope) : activity;

  const groups = useMemo(() => {
    const map = new Map<string, { projectName: string; items: WorkbenchItem[] }>();
    for (const item of items) {
      const group = map.get(item.data.projectId) ?? {
        projectName: item.data.projectName,
        items: [],
      };
      group.items.push(item);
      map.set(item.data.projectId, group);
    }
    const result = [...map.values()];
    if (sort === 'project') {
      result.sort((a, b) => a.projectName.localeCompare(b.projectName, 'zh-CN'));
    }
    return result;
  }, [items, sort]);

  /** 有任一筛选条件（搜索 / 角色 / 项目范围 / 非“全部”标签）时，空列表是“没有匹配项”。 */
  const hasActiveFilter = query.trim() !== '' || roleFilter !== '' || scope !== '' || tab !== 'all';

  /** 批量按钮与提交只认“当前快照中仍存在且被选中”的变更。 */
  const batchTargets = useMemo<BatchTarget[]>(() => {
    if (!snapshot) return [];
    return snapshot.changes
      .filter((change) => selectedChanges.has(change.recipientId))
      .map((change) => ({
        recipientId: change.recipientId,
        label: requirementLabel(change),
        version: change.version,
      }));
  }, [snapshot, selectedChanges]);

  const batchSuccessCount = batchResults.filter((result) => result.status === 'success').length;
  const batchFailedCount = batchResults.filter((result) => result.status === 'failed').length;
  const batchUnprocessedCount = batchResults.filter(
    (result) => result.status === 'unprocessed',
  ).length;
  const batchRetryCount = useMemo(() => {
    if (!snapshot) return 0;
    const alive = new Set(snapshot.changes.map((change) => change.recipientId));
    return batchResults.filter(
      (result) => result.status !== 'success' && alive.has(result.recipientId),
    ).length;
  }, [batchResults, snapshot]);

  /** 批量批准只包含“我可决定且未决定”的评审；每条仍按自己的版本与票据提交。 */
  const reviewBatchTargets = useMemo<BatchReviewTarget[]>(() => {
    if (!snapshot) return [];
    return snapshot.reviews.flatMap((review) => {
      if (!selectedReviews.has(review.reviewId)) return [];
      const slot = review.slots.find(
        (candidate) => candidate.viewerCanDecide && !candidate.decided,
      );
      if (!slot) return [];
      return [
        {
          reviewId: review.reviewId,
          projectId: review.projectId,
          slotId: slot.id,
          requiredRoleId: slot.requiredRoleId,
          expectedVersion: review.version,
          label: `${requirementLabel(review)} · ${review.role?.title ?? '未指定角色'} · v${review.version}`,
        },
      ];
    });
  }, [snapshot, selectedReviews]);

  /** 批量批准完成后的收尾：清空选择、提示结果、强制刷新工作台。 */
  function handleReviewBatchCompleted(summary: { approved: number; failed: number }) {
    setSelectedReviews(new Set());
    setReviewBatchOpen(false);
    setNotice(`批量批准完成：已批准 ${summary.approved} 条 · 失败 ${summary.failed} 条。`);
    void load();
  }

  function renderReview(review: WorkbenchReviewItem) {
    const item: WorkbenchItem = { type: 'review', data: review };
    const path = itemRequirementPath(item);
    // 兼容旧服务端响应：多实例滚动发布期间字段可能缺失。
    const kinds = review.evidence.artifactKinds ?? [];
    const checks = review.evidence.checks ?? { total: 0, failed: 0 };
    const codeRefs = review.evidence.codeRefs ?? 0;
    const decidableSlot = review.slots.find((slot) => slot.viewerCanDecide && !slot.decided);
    return (
      <article
        className="wb-row is-signOff"
        key={review.reviewId}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
      >
        {decidableSlot && (
          <input
            type="checkbox"
            aria-label={`选择批量批准 ${requirementLabel(review)}`}
            checked={selectedReviews.has(review.reviewId)}
            onChange={() =>
              setSelectedReviews((current) => {
                const next = new Set(current);
                if (next.has(review.reviewId)) next.delete(review.reviewId);
                else next.add(review.reviewId);
                return next;
              })
            }
            onClick={(event) => event.stopPropagation()}
          />
        )}
        <div className="wb-row-main">
          <div className="wb-row-top">
            <span className="wb-type">{isSignOffKind(review.kind) ? '签字' : '审批'}</span>
            <span className="wb-row-context">{requirementLabel(review)}</span>
          </div>
          <div className="wb-row-detail">
            {labelFor(STEP_LABELS, review.subjectLabel)} · {review.role?.title ?? '未指定角色'} ·
            等待 {ageLabel(review.ageSeconds)}
          </div>
          <div className="wb-row-context">
            证据 {review.evidence.artifactCount} 件{kinds.length ? `（${kinds.join(' / ')}）` : ''}
            {review.evidence.hasPr ? ' · 含 PR' : ''}
            {codeRefs ? ` · 代码引用 ${codeRefs}` : ''}
            {checks.total ? ` · 检查 ${checks.total - checks.failed}/${checks.total}` : ''}
            {checks.failed ? `（${checks.failed} 失败）` : ''} · v{review.version}
          </div>
        </div>
        <div className="wb-row-actions">
          <button
            className="primary"
            onClick={(event) => {
              event.stopPropagation();
              setReviewTarget(review.reviewId);
            }}
          >
            打开决定
            <ArrowRight size={14} />
          </button>
        </div>
      </article>
    );
  }

  function renderChange(change: WorkbenchChangeItem) {
    const fields = change.changedFields.length ? change.changedFields.join(' / ') : '未标注字段';
    const roles = change.pendingRoles.length
      ? change.pendingRoles.map((role) => role.title).join(' / ')
      : '—';
    const item: WorkbenchItem = { type: 'change', data: change };
    const path = itemRequirementPath(item);
    return (
      <article
        className="wb-row is-change"
        key={change.recipientId}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
      >
        <input
          type="checkbox"
          aria-label={`选择变更 ${requirementLabel(change)}`}
          checked={selectedChanges.has(change.recipientId)}
          onChange={() => toggleSelected(change.recipientId)}
          onClick={(event) => event.stopPropagation()}
        />
        <div className="wb-row-main">
          <div className="wb-row-top">
            <span className="wb-type">变更</span>
            <span className="wb-row-context">{requirementLabel(change)}</span>
          </div>
          <div className="wb-row-detail">
            变更字段：{fields} · 待确认：{roles} · 等待 {ageLabel(change.ageSeconds)}
          </div>
          <div className="wb-row-context">变更版本 v{change.version}</div>
        </div>
        <div className="wb-row-actions">
          <button
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              openChange(change);
            }}
          >
            去确认
          </button>
        </div>
      </article>
    );
  }

  function renderReady(task: WorkbenchReadyTaskItem) {
    const item: WorkbenchItem = { type: 'ready', data: task };
    const path = itemRequirementPath(item);
    return (
      <article
        className="wb-row is-ready"
        key={task.taskId}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
      >
        <div className="wb-row-main">
          <div className="wb-row-top">
            <span className="wb-type">任务</span>
            <span className="wb-row-context">{requirementLabel(task)}</span>
          </div>
          <div className="wb-row-detail">
            {task.role?.title ?? '未指定角色'} · {task.stepKey} · 可开工 · 任务{' '}
            {task.taskId.slice(0, 8)}
          </div>
        </div>
        <div className="wb-row-actions">
          <button
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              if (path) navigate(path);
              else navigate('/board');
            }}
          >
            查看上下文
          </button>
          <button
            className="ghost"
            onClick={(event) => {
              event.stopPropagation();
              void copyCli(task.taskId);
            }}
          >
            复制命令
          </button>
        </div>
      </article>
    );
  }

  function renderItem(item: WorkbenchItem) {
    return item.type === 'review'
      ? renderReview(item.data)
      : item.type === 'change'
        ? renderChange(item.data)
        : renderReady(item.data);
  }

  const share = (value: number) => Math.round((value / Math.max(1, counts.total)) * 100);
  const scopeProjectName = projects.find((project) => project.id === scope)?.name;
  const systemDate = new Date()
    .toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .replaceAll('/', '.');
  // 数据新鲜度统一用 HH:mm；状态码用业务文案，过期/失败绝不显示成已同步。
  const dataClock = formatUpdatedAtClock(updatedAt ?? undefined);
  const dataStateCode =
    dataState === 'ready'
      ? '已更新'
      : dataState === 'stale'
        ? '数据可能已过期'
        : dataState === 'error'
          ? '加载失败'
          : '加载中';
  const dataStateText =
    dataState === 'error'
      ? '数据加载失败'
      : dataState === 'stale'
        ? `显示上次成功数据${dataClock ? ` · ${dataClock}` : ''}`
        : dataState === 'loading'
          ? snapshot
            ? '正在刷新数据…'
            : '正在加载数据…'
          : `已同步${dataClock ? ` · ${dataClock}` : ''}`;
  const scopeLabel = scope ? (scopeProjectName ?? '所选项目') : '全部项目';
  const refreshLabel = loading ? (snapshot ? '刷新中…' : '加载中…') : '刷新';

  const spectrum = [
    { key: 'signOffs', label: '签字', value: counts.signOffs, className: 'is-sign' },
    { key: 'approvals', label: '审批', value: counts.approvals, className: 'is-approval' },
    { key: 'changes', label: '变更', value: counts.changes, className: 'is-change' },
    { key: 'ready', label: '可开工', value: counts.readyTasks, className: 'is-ready' },
  ];

  return (
    <section className="wb-page">
      <header className="command-head">
        <div className="command-topline">
          <span className="command-kicker">
            <i className="pulse-dot" />
            WORKMESH / 工作台
          </span>
          <span className="command-date">数据日期 {systemDate}</span>
        </div>
        <div className="command-row">
          <div>
            <h2>工作台</h2>
            <p className="page-sub">
              只回答一件事：现在有什么在等我。签字与确认仍由服务端校验版本与权限。
            </p>
          </div>
          <div className="page-actions">
            <select
              className="select"
              aria-label="项目范围"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}（{project.key}）
                </option>
              ))}
            </select>
            <button className="ghost" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} />
              {refreshLabel}
            </button>
          </div>
        </div>
        <div className="command-hero">
          <div className="hero-total">
            <span className="hero-label">待处理事项</span>
            <strong>{String(counts.total).padStart(2, '0')}</strong>
            <span className="hero-unit">件待办 · 当前范围</span>
          </div>
          <div className="hero-spectrum">
            <div className="spectrum-bar" aria-label="待办类型构成">
              {spectrum.map((item) => (
                <span
                  key={item.key}
                  className={`spectrum-seg ${item.className}`}
                  style={{ flexGrow: item.value }}
                  title={`${item.label} ${item.value}`}
                />
              ))}
            </div>
            <div className="spectrum-legend">
              {spectrum.map((item) => (
                <span key={item.key} className={`legend-item ${item.className}`}>
                  <i />
                  {item.label}
                  <strong>{item.value}</strong>
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {dataState === 'error' && !snapshot && (
        <ErrorState
          title="工作台加载失败"
          message="暂时无法读取工作台数据。"
          detail={error}
          onRetry={() => void load()}
          retryAriaLabel="重试加载工作台数据"
        />
      )}
      {dataState === 'stale' && snapshot && (
        <StaleDataBanner
          updatedAt={updatedAt ?? undefined}
          message="本次刷新失败，数据可能已经过期。"
          onRetry={() => void load()}
          retryAriaLabel="重试更新工作台数据"
        />
      )}
      {notice && (
        <p className="kb-notice" role="status">
          {notice}
        </p>
      )}
      {snapshot && snapshot.warnings.length > 0 && (
        <p className="page-sub" role="status">
          部分数据加载失败：{snapshot.warnings.join('；')}
        </p>
      )}

      {!(dataState === 'error' && !snapshot) && (
        <>
          <div className="wb-commandbar">
            <span className="cmd-prompt">QUERY</span>
            <div className="wb-field wb-field-grow">
              <input
                aria-label="搜索待办"
                placeholder="搜索需求编号 / 标题 / 角色"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="wb-field">
              <select
                aria-label="角色筛选"
                value={roleFilter}
                onChange={(event) => {
                  const value = event.target.value;
                  setRoleFilter(value);
                  try {
                    if (value) localStorage.setItem(ROLE_PREF_KEY, value);
                    else localStorage.removeItem(ROLE_PREF_KEY);
                  } catch {
                    // localStorage 不可写时只影响记忆，不影响筛选。
                  }
                }}
              >
                <option value="">全部角色</option>
                {roleOptions.map((role) => (
                  <option key={role.key} value={role.key}>
                    {role.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="wb-field">
              <select
                aria-label="待办排序"
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
              >
                <option value="oldest">最久未处理</option>
                <option value="newest">最近更新</option>
                <option value="project">按项目</option>
                <option value="type">按类型</option>
              </select>
            </div>
          </div>

          {tab === 'changes' && batchTargets.length > 0 && (
            <div className="toolbar">
              <button className="primary" onClick={openBatch}>
                批量确认 {batchTargets.length} 条
              </button>
              <button className="ghost" onClick={() => updateSelection(new Set())}>
                清空选择
              </button>
            </div>
          )}

          {reviewBatchTargets.length > 0 && (
            <div className="toolbar">
              <button className="primary" onClick={() => setReviewBatchOpen(true)}>
                批量批准 {reviewBatchTargets.length} 条
              </button>
              <button className="ghost" onClick={() => setSelectedReviews(new Set())}>
                清空选择
              </button>
            </div>
          )}

          <div className="wb-workspace">
            <div
              className="wb-stream"
              role="tabpanel"
              id="wb-tabpanel"
              aria-labelledby={`wb-tab-${tab}`}
            >
              <div className="wb-stats">
                <button
                  className={`wb-stat${tab === 'signOffs' ? ' is-active' : ''}`}
                  onClick={() => setTab('signOffs')}
                >
                  <span className="wb-stat-index">01</span>
                  <span
                    className="wb-stat-orbit"
                    style={{
                      background: `conic-gradient(#22d3ee ${share(counts.signOffs)}%, #e2e8f0 0)`,
                    }}
                  />
                  <span className="wb-stat-value">{counts.signOffs}</span>
                  <span className="wb-stat-label">待签字</span>
                  <span className="wb-stat-hint">任务验收等你落锤</span>
                </button>
                <button
                  className={`wb-stat${tab === 'approvals' ? ' is-active' : ''}`}
                  onClick={() => setTab('approvals')}
                >
                  <span className="wb-stat-index">02</span>
                  <span
                    className="wb-stat-orbit"
                    style={{
                      background: `conic-gradient(#3b82f6 ${share(counts.approvals)}%, #e2e8f0 0)`,
                    }}
                  />
                  <span className="wb-stat-value">{counts.approvals}</span>
                  <span className="wb-stat-label">待审批</span>
                  <span className="wb-stat-hint">PRD / 知识发布</span>
                </button>
                <button
                  className={`wb-stat${tab === 'changes' ? ' is-active' : ''}`}
                  onClick={() => setTab('changes')}
                >
                  <span className="wb-stat-index">03</span>
                  <span
                    className="wb-stat-orbit"
                    style={{
                      background: `conic-gradient(#fbbf24 ${share(counts.changes)}%, #e2e8f0 0)`,
                    }}
                  />
                  <span className="wb-stat-value">{counts.changes}</span>
                  <span className="wb-stat-label">待确认变更</span>
                  <span className="wb-stat-hint">角色确认已处理</span>
                </button>
                <button
                  className={`wb-stat${tab === 'ready' ? ' is-active' : ''}`}
                  onClick={() => setTab('ready')}
                >
                  <span className="wb-stat-index">04</span>
                  <span
                    className="wb-stat-orbit"
                    style={{
                      background: `conic-gradient(#34d399 ${share(counts.readyTasks)}%, #e2e8f0 0)`,
                    }}
                  />
                  <span className="wb-stat-value">{counts.readyTasks}</span>
                  <span className="wb-stat-label">可开工</span>
                  <span className="wb-stat-hint">依赖已满足</span>
                </button>
              </div>

              <div className="wb-toolbar">
                <div
                  className="wb-tabs"
                  role="tablist"
                  aria-label="待办类型"
                  onKeyDown={onTabKeyDown}
                >
                  {(['all', 'signOffs', 'approvals', 'changes', 'ready'] as Tab[]).map(
                    (key, index) => (
                      <button
                        key={key}
                        role="tab"
                        id={`wb-tab-${key}`}
                        aria-selected={tab === key}
                        aria-controls="wb-tabpanel"
                        tabIndex={tab === key ? 0 : -1}
                        ref={(node) => {
                          tabRefs.current[index] = node;
                        }}
                        className={`wb-tab${tab === key ? ' is-active' : ''}`}
                        onClick={() => setTab(key)}
                      >
                        {TAB_LABELS[key]}
                        <span>
                          {key === 'all'
                            ? counts.total
                            : key === 'signOffs'
                              ? counts.signOffs
                              : key === 'approvals'
                                ? counts.approvals
                                : key === 'changes'
                                  ? counts.changes
                                  : counts.readyTasks}
                        </span>
                      </button>
                    ),
                  )}
                </div>
                {updatedAt && (
                  <span className="wb-updated">
                    更新于 {formatUpdatedAtClock(updatedAt) ?? '—'}
                  </span>
                )}
              </div>

              {loading && !snapshot && (
                <div className="wb-list">
                  {[0, 1, 2].map((index) => (
                    <div className="wb-row skeleton-row" key={index}>
                      <div className="skeleton-line" />
                      <div className="skeleton-line short" />
                    </div>
                  ))}
                </div>
              )}

              {!loading && dataState !== 'error' && projects.length === 0 && (
                <EmptyState
                  title="你还不是任何项目的成员"
                  description="让项目管理员把你加入项目后，待办才会出现在这里。"
                  hint="加入项目后重新加载工作台即可看到待办。"
                />
              )}

              {snapshot && dataState !== 'error' && projects.length > 0 && items.length === 0 && (
                <>
                  {hasActiveFilter ? (
                    <EmptyState
                      title="当前筛选没有匹配项"
                      description="当前搜索词或筛选条件下没有匹配的待办；可以清除筛选后再看。"
                      variant="no-match"
                    >
                      <div className="wb-empty-actions">
                        {query.trim() !== '' && (
                          <button className="ghost" onClick={() => setQuery('')}>
                            清除搜索
                          </button>
                        )}
                        {roleFilter !== '' && (
                          <button className="ghost" onClick={() => setRoleFilter('')}>
                            清除角色筛选
                          </button>
                        )}
                        {tab !== 'all' && (
                          <button className="ghost" onClick={() => setTab('all')}>
                            查看全部
                          </button>
                        )}
                        {scope !== '' && (
                          <button className="ghost" onClick={() => setScope('')}>
                            查看全部项目
                          </button>
                        )}
                      </div>
                    </EmptyState>
                  ) : (
                    <EmptyState
                      title="现在没有待办"
                      description={`当前范围：${scopeLabel}。没有等待你处理的事项；有新的交付或确认时，这里会自动出现。`}
                      variant="waiting"
                      actionLabel="打开看板"
                      onAction={() => navigate('/board')}
                    />
                  )}
                </>
              )}

              {items.length > 0 && scope && (
                <div className="wb-list">{items.map((item) => renderItem(item))}</div>
              )}

              {items.length > 0 && !scope && (
                <div className="wb-list">
                  {groups.map((group) => (
                    <section className="wb-group" key={group.projectName}>
                      <div className="wb-group-head">
                        <h3>{group.projectName}</h3>
                        <span>{group.items.length} 件</span>
                      </div>
                      {group.items.map((item) => renderItem(item))}
                    </section>
                  ))}
                </div>
              )}
            </div>

            <aside className="wb-rail">
              <div className="rail-card">
                <div className="rail-head">
                  <span className="rail-label">数据状态</span>
                  <span className="rail-code">{dataStateCode}</span>
                </div>
                <div className="rail-status">
                  {dataState === 'ready' && <i className="pulse-dot" aria-hidden="true" />}
                  {dataStateText}
                </div>
                <dl className="rail-meta">
                  <div>
                    <dt>范围</dt>
                    <dd>{scope ? (scopeProjectName ?? '单个项目') : '全部项目'}</dd>
                  </div>
                  <div>
                    <dt>项目数</dt>
                    <dd>{projects.length}</dd>
                  </div>
                  <div>
                    <dt>更新时间</dt>
                    <dd>{dataClock ?? '—'}</dd>
                  </div>
                </dl>
              </div>

              <div className="rail-card">
                <div className="rail-head">
                  <span className="rail-label">最近活动</span>
                  <span className="rail-code">{visibleActivity.length}</span>
                </div>
                {visibleActivity.length === 0 ? (
                  <p className="detail-empty">还没有审计事件。</p>
                ) : (
                  <div className="rail-feed">
                    {visibleActivity.slice(0, 6).map((item) => (
                      <div className="rail-feed-item" key={item.id}>
                        <span className="rail-feed-time">
                          {formatUpdatedAtClock(item.createdAt) ?? '—'}
                        </span>
                        <span className="rail-feed-body">
                          <strong>{labelFor(ACTION_LABELS, item.action)}</strong>
                          <small>
                            {item.projectName ?? '—'} · {item.actor?.email ?? '系统'}
                          </small>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rail-card rail-command">
                <span className="rail-label">Agent 操作提示</span>
                <code>workmesh claim --task &lt;taskId&gt;</code>
              </div>
            </aside>
          </div>
        </>
      )}

      <Modal
        open={batchOpen}
        title={batchResults.length > 0 || batchBusy ? '批量确认结果' : '批量确认变更'}
        description={
          batchResults.length > 0 || batchBusy
            ? `共 ${batchResults.length} 条；每条仍按自己的版本提交。`
            : `将逐一确认 ${batchTargets.length} 条变更；每条仍按自己的版本提交。`
        }
        size="md"
        onClose={() => {
          if (!batchBusy) setBatchOpen(false);
        }}
        footer={
          batchBusy ? (
            <button className="ghost" disabled>
              处理中…
            </button>
          ) : batchResults.length === 0 ? (
            <>
              <button className="ghost" onClick={() => setBatchOpen(false)}>
                取消
              </button>
              <button
                className="primary"
                onClick={() => void runBatch(batchTargets)}
                disabled={batchTargets.length === 0}
              >
                确认开始
              </button>
            </>
          ) : (
            <>
              <button className="ghost" onClick={() => setBatchOpen(false)}>
                关闭
              </button>
              {batchRetryCount > 0 && (
                <button className="primary" onClick={() => retryFailedBatch()}>
                  重试失败项（{batchRetryCount}）
                </button>
              )}
            </>
          )
        }
      >
        {batchResults.length === 0 && !batchBusy ? (
          <>
            <p className="modal-note">
              任一失败会立即停止，剩余条目标记为“未处理”；已确认的条目不会再次提交。
            </p>
            <ul className="detail-list" aria-label="待提交变更列表">
              {batchTargets.map((target) => (
                <li key={target.recipientId}>
                  {target.label} · v{target.version}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {batchBusy && batchProgress && (
              <p className="modal-note" role="status">
                正在处理 {batchProgress.current} / {batchProgress.total}
              </p>
            )}
            <p className="modal-note" role="status">
              已确认 {batchSuccessCount} 条 · 失败 {batchFailedCount} 条 · 未处理{' '}
              {batchUnprocessedCount} 条
            </p>
            {batchRefreshError && (
              <p className="modal-error" role="alert">
                {batchRefreshError}
              </p>
            )}
            <ul className="detail-list" aria-label="批量确认结果">
              {batchResults.map((result, index) => {
                const missing = !(snapshot?.changes ?? []).some(
                  (change) => change.recipientId === result.recipientId,
                );
                const processing =
                  batchBusy &&
                  result.status === 'unprocessed' &&
                  batchProgress?.current === index + 1;
                return (
                  <li key={result.recipientId}>
                    <strong>{result.label}</strong> · v{result.version} ·{' '}
                    {processing ? '处理中…' : batchStatusLabel(result.status)}
                    {result.status === 'failed' && result.conflict
                      ? ` · ${BATCH_CONFLICT_HINT}`
                      : ''}
                    {result.status === 'failed' && result.error ? `（${result.error}）` : ''}
                    {result.status === 'unprocessed' && missing ? ' · 已不在当前列表中' : ''}
                  </li>
                );
              })}
            </ul>
            {batchRefreshError && (
              <p className="modal-note">
                工作台仍显示上次成功数据；可以关闭弹窗后重试刷新，已确认的条目不会重复提交。
              </p>
            )}
          </>
        )}
      </Modal>

      <BatchReviewApprove
        open={reviewBatchOpen}
        targets={reviewBatchTargets}
        onClose={() => setReviewBatchOpen(false)}
        onCompleted={handleReviewBatchCompleted}
      />

      <ReviewDecisionDrawer
        reviewId={reviewTarget}
        onClose={() => setReviewTarget(null)}
        onDecisionCommitted={() => {
          setReviewTarget(null);
          void load();
        }}
      />

      <ChangeDrawer
        change={changeTarget}
        busy={changeBusy}
        error={changeError}
        onClose={() => {
          if (changeBusy) return;
          setChangeTarget(null);
          setChangeError('');
        }}
        onAck={() => void ackChange()}
      />
    </section>
  );
}
