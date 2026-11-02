import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Inbox, RefreshCw } from 'lucide-react';
import { formatApiError } from '../api/client';
import {
  activityApi,
  changeApi,
  workbenchApi,
  type ActivityItem,
  type WorkbenchChangeItem,
  type WorkbenchReadyTaskItem,
  type WorkbenchReviewItem,
  type WorkbenchSnapshot,
} from '../api/resources';
import { ChangeDrawer } from '../components/ChangeDrawer';
import { ConfirmDialog } from '../components/Modal';
import { ReviewDecisionDrawer } from '../components/ReviewDecisionDrawer';
import { useProjectContext } from '../hooks/useProjectContext';
import { ACTION_LABELS, labelFor } from '../lib/labels';

type Tab = 'all' | 'signOffs' | 'approvals' | 'changes' | 'ready';
type SortKey = 'oldest' | 'newest' | 'project' | 'type';

const ROLE_PREF_KEY = 'workmesh.workbench.role';

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
  const [selectedChanges, setSelectedChanges] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);

  async function load() {
    setLoading(true);
    try {
      const value = await workbenchApi.get(scope || null);
      setSnapshot(value);
      setUpdatedAt(new Date());
      setError('');
    } catch (caught) {
      // 保留上次成功结果；只有首次失败才显示整页错误。
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [scope]);

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
    setSelectedChanges((current) => {
      const next = new Set(current);
      if (next.has(recipientId)) next.delete(recipientId);
      else next.add(recipientId);
      return next;
    });
  }

  async function batchAck() {
    const targets = (snapshot?.changes ?? []).filter((change) =>
      selectedChanges.has(change.recipientId),
    );
    if (targets.length === 0) return;
    setBatchBusy(true);
    try {
      for (const change of targets) {
        await changeApi.ack(change.recipientId, change.version);
      }
      setSelectedChanges(new Set());
      setBatchOpen(false);
      setNotice(`已确认 ${targets.length} 条变更。`);
      setError('');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setBatchBusy(false);
    }
  }

  async function copyCli(code: string) {
    const command = `workmesh context ${code}`;
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(command);
      setNotice(`已复制：${command}`);
      setError('');
    } catch {
      setError(`无法写入剪贴板，请手动复制：${command}`);
    }
  }

  async function ackChange() {
    if (!changeTarget) return;
    setChangeBusy(true);
    try {
      await changeApi.ack(changeTarget.recipientId, changeTarget.version);
      setChangeTarget(null);
      setNotice('变更已确认。');
      setError('');
      await load();
    } catch (caught) {
      setError(formatApiError(caught));
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

  function renderReview(review: WorkbenchReviewItem) {
    const item: WorkbenchItem = { type: 'review', data: review };
    const path = itemRequirementPath(item);
    // 兼容旧服务端响应：多实例滚动发布期间字段可能缺失。
    const kinds = review.evidence.artifactKinds ?? [];
    const checks = review.evidence.checks ?? { total: 0, failed: 0 };
    const codeRefs = review.evidence.codeRefs ?? 0;
    return (
      <article
        className="wb-row is-signOff"
        key={review.reviewId}
        tabIndex={0}
        aria-label={`打开需求：${requirementLabel(review)}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (path) navigate(path);
            else setReviewTarget(review.reviewId);
          }
        }}
      >
        <div className="wb-row-main">
          <div className="wb-row-top">
            <span className="wb-type">{isSignOffKind(review.kind) ? '签字' : '审批'}</span>
            <span className="wb-row-context">{requirementLabel(review)}</span>
          </div>
          <div className="wb-row-detail">
            {review.subjectLabel} · {review.role?.title ?? '未指定角色'} · 等待{' '}
            {ageLabel(review.ageSeconds)}
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
        tabIndex={0}
        aria-label={`打开需求：${requirementLabel(change)}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (path) navigate(path);
            else setChangeTarget(change);
          }
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
              setChangeTarget(change);
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
    const code = task.requirement?.code;
    return (
      <article
        className="wb-row is-ready"
        key={task.taskId}
        tabIndex={0}
        aria-label={`打开需求：${requirementLabel(task)}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button, input, a')) return;
          if (path) navigate(path);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (path) navigate(path);
            else navigate('/board');
          }
        }}
      >
        <div className="wb-row-main">
          <div className="wb-row-top">
            <span className="wb-type">任务</span>
            <span className="wb-row-context">{requirementLabel(task)}</span>
          </div>
          <div className="wb-row-detail">
            {task.role?.title ?? '未指定角色'} · {task.stepKey} · 可开工
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
          {code && (
            <button
              className="ghost"
              onClick={(event) => {
                event.stopPropagation();
                void copyCli(code);
              }}
            >
              复制命令
            </button>
          )}
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
            WORKMESH / AUTHORITY CONSOLE
          </span>
          <span className="command-date">
            SYS {new Date().toISOString().slice(0, 10).replaceAll('-', '.')}
          </span>
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
              {loading ? '加载中…' : '刷新'}
            </button>
          </div>
        </div>
        <div className="command-hero">
          <div className="hero-total">
            <span className="hero-label">OPEN SIGNALS</span>
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

      {error && !changeTarget && (
        <div className="wb-error" role="alert">
          <span>{error}</span>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            重试
          </button>
        </div>
      )}
      {notice && <p className="kb-notice">{notice}</p>}
      {snapshot && snapshot.warnings.length > 0 && (
        <p className="page-sub" role="status">
          部分数据加载失败：{snapshot.warnings.join('；')}
        </p>
      )}

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

      {tab === 'changes' && selectedChanges.size > 0 && (
        <div className="toolbar">
          <button className="primary" onClick={() => setBatchOpen(true)}>
            批量确认 {selectedChanges.size} 条
          </button>
          <button className="ghost" onClick={() => setSelectedChanges(new Set())}>
            清空选择
          </button>
        </div>
      )}

      <div className="wb-workspace">
        <div className="wb-stream">
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
            <div className="wb-tabs" role="tablist" aria-label="待办类型">
              {(['all', 'signOffs', 'approvals', 'changes', 'ready'] as Tab[]).map((key) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
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
              ))}
            </div>
            {updatedAt && (
              <span className="wb-updated">更新于 {updatedAt.toLocaleTimeString('zh-CN')}</span>
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

          {!loading && projects.length === 0 && (
            <div className="wb-empty">
              <span className="wb-empty-icon">
                <Inbox size={20} />
              </span>
              <h3>你还不是任何项目的成员</h3>
              <p>让项目管理员把你加入项目后，待办才会出现在这里。</p>
            </div>
          )}

          {!loading && projects.length > 0 && items.length === 0 && (
            <div className="wb-empty">
              <span className="wb-empty-icon">
                <Inbox size={20} />
              </span>
              <h3>{tab === 'all' ? '现在没有待办' : `没有${TAB_LABELS[tab]}`}</h3>
              <p>可以去看板了解整体进度，或等下一次交付触发。</p>
              <div className="wb-empty-actions">
                <button className="ghost" onClick={() => navigate('/board')}>
                  打开看板
                </button>
              </div>
            </div>
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
              <span className="rail-label">SYSTEM STATUS</span>
              <span className="rail-code">SYS.OK</span>
            </div>
            <div className="rail-status">
              <i className="pulse-dot" />
              WORKBENCH ONLINE
            </div>
            <dl className="rail-meta">
              <div>
                <dt>SCOPE</dt>
                <dd>{scope ? (scopeProjectName ?? 'SINGLE PROJECT') : 'ALL PROJECTS'}</dd>
              </div>
              <div>
                <dt>PROJECTS</dt>
                <dd>{projects.length}</dd>
              </div>
              <div>
                <dt>UPDATED</dt>
                <dd>{updatedAt ? updatedAt.toLocaleTimeString('zh-CN') : '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="rail-card">
            <div className="rail-head">
              <span className="rail-label">ACTIVITY FEED</span>
              <span className="rail-code">{visibleActivity.length}</span>
            </div>
            {visibleActivity.length === 0 ? (
              <p className="detail-empty">还没有审计事件。</p>
            ) : (
              <div className="rail-feed">
                {visibleActivity.slice(0, 6).map((item) => (
                  <div className="rail-feed-item" key={item.id}>
                    <span className="rail-feed-time">
                      {new Date(item.createdAt).toLocaleTimeString('zh-CN', {
                        hour12: false,
                      })}
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
            <span className="rail-label">CLI</span>
            <code>workmesh context &lt;code&gt;</code>
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={batchOpen}
        title="批量确认变更"
        description={`将逐一确认 ${selectedChanges.size} 条变更；每条仍按自己的版本提交。`}
        note="任一失败会停止并保留未确认项，不会跳过失败继续提交。"
        tone="primary"
        confirmLabel="批量确认"
        busy={batchBusy}
        onCancel={() => {
          if (!batchBusy) setBatchOpen(false);
        }}
        onConfirm={() => void batchAck()}
      />

      <ReviewDecisionDrawer reviewId={reviewTarget} onClose={() => setReviewTarget(null)} />

      <ChangeDrawer
        change={changeTarget}
        busy={changeBusy}
        error={error}
        onClose={() => {
          if (!changeBusy) setChangeTarget(null);
        }}
        onAck={() => void ackChange()}
      />
    </section>
  );
}
