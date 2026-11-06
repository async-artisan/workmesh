import { Fragment, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Menu, User, X } from 'lucide-react';
import { Navigate, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, SESSION_EXPIRED_EVENT, formatApiError } from './api/client';
import { authApi, bootstrapSession } from './api/auth';
import { activityApi, notificationApi, type ActivityItem } from './api/resources';
import { getWorkbenchSnapshot, invalidateWorkbenchSnapshot } from './lib/workbenchSnapshot';
import { countUnreadActivity, markActivitySeen, readActivityLastSeenAt } from './lib/activitySeen';
import { ACTION_LABELS, labelFor } from './lib/labels';
import { formatDateTime } from './lib/datetime';
import { useAuthStore } from './store/auth';
import { NAV_GROUP_LABELS, findNav, navItems } from './nav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ErrorState } from './components/ErrorState';
import { PageState } from './components/PageState';
import { ToastHost } from './components/ToastHost';
import { ProjectContextBoundary } from './components/ProjectContextBoundary';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { toast } from './store/toast';

const Authorization = lazy(() =>
  import('./pages/Authorization').then((m) => ({ default: m.Authorization })),
);
const Board = lazy(() => import('./pages/Board').then((m) => ({ default: m.Board })));
const Knowledge = lazy(() => import('./pages/Knowledge').then((m) => ({ default: m.Knowledge })));
const Invite = lazy(() => import('./pages/Invite').then((m) => ({ default: m.Invite })));
const Prds = lazy(() => import('./pages/Prds').then((m) => ({ default: m.Prds })));
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })));
const Pipeline = lazy(() => import('./pages/Pipeline').then((m) => ({ default: m.Pipeline })));
const Projects = lazy(() => import('./pages/Projects').then((m) => ({ default: m.Projects })));
const ProjectDetail = lazy(() =>
  import('./pages/ProjectDetail').then((m) => ({ default: m.ProjectDetail })),
);
const ProjectWorkspace = lazy(() =>
  import('./pages/ProjectWorkspace').then((m) => ({ default: m.ProjectWorkspace })),
);
const Requirements = lazy(() =>
  import('./pages/Requirements').then((m) => ({ default: m.Requirements })),
);
const RequirementDetail = lazy(() =>
  import('./pages/RequirementDetail').then((m) => ({ default: m.RequirementDetail })),
);
const Reviews = lazy(() => import('./pages/Reviews').then((m) => ({ default: m.Reviews })));
const ReviewDecision = lazy(() =>
  import('./pages/ReviewDecision').then((m) => ({ default: m.ReviewDecision })),
);
const Roles = lazy(() => import('./pages/Roles').then((m) => ({ default: m.Roles })));
const Workbench = lazy(() => import('./pages/Workbench').then((m) => ({ default: m.Workbench })));
const Workflows = lazy(() => import('./pages/Workflows').then((m) => ({ default: m.Workflows })));

const pageLoading = <PageState state={{ kind: 'loading' }} title="正在加载页面…" />;

interface BootstrapFailure {
  message: string;
  detail?: string;
  requestId?: string;
  retryAfterSeconds: number | null;
}

function describeBootstrapFailure(caught: unknown): BootstrapFailure {
  if (caught instanceof ApiError) {
    if (caught.status === 429) {
      const retryAfterSeconds = caught.retryAfterSeconds;
      const hasWait = retryAfterSeconds !== null && retryAfterSeconds > 0;
      return {
        message: hasWait
          ? '请求过于频繁，暂时无法建立会话。请等待冷却结束后重试。'
          : retryAfterSeconds === 0
            ? '请求过于频繁，服务端未要求等待，可手动重试。'
            : '请求过于频繁，暂时无法建立会话；服务端没有提供可解析的等待时间，可稍后手动重试。',
        detail: formatApiError(caught),
        requestId: caught.requestId,
        retryAfterSeconds,
      };
    }
    return {
      message:
        caught.status >= 500
          ? '会话服务暂时不可用，无法验证登录状态。请稍后重试或返回登录。'
          : '无法建立会话。请重试，或返回登录页重新登录。',
      detail: formatApiError(caught),
      requestId: caught.requestId,
      retryAfterSeconds: null,
    };
  }
  return {
    message: '网络连接失败，无法建立会话。请检查网络后重试，或返回登录页重新登录。',
    detail: caught instanceof Error ? caught.message : formatApiError(caught),
    retryAfterSeconds: null,
  };
}

/** 通知中心焦点陷阱使用的可聚焦元素选择器（与 Modal 保持一致）。 */
const FOCUSABLE_SELECTOR =
  'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = findNav(location.pathname);
  const legacyReviewId = new URLSearchParams(location.search).get('id');
  const requirementMatch = matchPath('/requirements/:requirementId', location.pathname);
  const reviewMatch = matchPath('/reviews/:reviewId', location.pathname);
  const projectMatch = matchPath('/projects/:projectId', location.pathname);
  const inviteMatch = matchPath('/invite/:token', location.pathname);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ready' | 'offline'>('checking');
  const [bootstrapPhase, setBootstrapPhase] = useState<'idle' | 'loading' | 'error' | 'ready'>(
    'idle',
  );
  const [bootstrapError, setBootstrapError] = useState<BootstrapFailure | null>(null);
  /** Retry-After 推导出的冷却截止时间；使用真实响应头，不写死等待秒数。 */
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const bootstrapRequestRef = useRef(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [todoCounts, setTodoCounts] = useState({
    signOffs: 0,
    approvals: 0,
    changes: 0,
    readyTasks: 0,
    total: 0,
  });
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [activityLastSeenAt, setActivityLastSeenAt] = useState(() => readActivityLastSeenAt());
  /** 只在需要冷却倒计时时按秒更新；不再让整棵 App 每秒重渲染。 */
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNotice, setMailNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const isInvitePage = Boolean(inviteMatch);
  const isPublicPage = isAuthPage || isInvitePage;
  const cooldownRemaining = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - cooldownNow) / 1000))
    : 0;
  const bootstrapCoolingDown = bootstrapPhase === 'error' && cooldownRemaining > 0;

  const runBootstrap = useCallback(async () => {
    const requestId = bootstrapRequestRef.current + 1;
    bootstrapRequestRef.current = requestId;
    setBootstrapPhase('loading');
    setBootstrapError(null);
    setCooldownUntil(null);
    try {
      await bootstrapSession();
      if (bootstrapRequestRef.current !== requestId) return;
      setBootstrapPhase('ready');
    } catch (caught: unknown) {
      if (bootstrapRequestRef.current !== requestId) return;
      const failure = describeBootstrapFailure(caught);
      setBootstrapError(failure);
      setBootstrapPhase('error');
      setCooldownUntil(
        failure.retryAfterSeconds !== null && failure.retryAfterSeconds > 0
          ? Date.now() + failure.retryAfterSeconds * 1000
          : null,
      );
    }
  }, []);

  // 启动时只读取同源 cookie 会话与内存 CSRF；失败进入可重试错误态，不做自动循环请求。
  useEffect(() => {
    if (isPublicPage) {
      // 进入登录/注册/邀请页时清理上一次引导错误，避免登录成功返回目标页时闪现旧错误。
      bootstrapRequestRef.current += 1;
      setBootstrapPhase('idle');
      setBootstrapError(null);
      setCooldownUntil(null);
      return;
    }
    void runBootstrap();
    return () => {
      // 组件卸载或进入公开页面时，让在途 bootstrap 结果失效。
      bootstrapRequestRef.current += 1;
    };
  }, [isPublicPage, runBootstrap]);

  useEffect(() => {
    if (!user) {
      setTodoCounts({ signOffs: 0, approvals: 0, changes: 0, readyTasks: 0, total: 0 });
      return;
    }
    let alive = true;
    const load = () => {
      getWorkbenchSnapshot()
        .then((value) => {
          if (!alive) return;
          const signOffs = value.reviews.filter(
            (review) => review.kind === 'TASK_ACCEPTANCE' || review.kind === 'RELEASE_ACCEPTANCE',
          ).length;
          setTodoCounts({
            signOffs,
            approvals: value.reviews.length - signOffs,
            changes: value.counts.changes,
            readyTasks: value.counts.readyTasks,
            total: value.counts.total,
          });
        })
        .catch(() => {
          // 通知徽标失败不阻塞页面。
        });
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  useEffect(() => {
    if (!notificationsOpen) return;
    let alive = true;
    activityApi
      .list(8)
      .then((page) => {
        if (alive) setRecentActivity(page.items);
      })
      .catch(() => {
        if (alive) setRecentActivity([]);
      });
    return () => {
      alive = false;
    };
  }, [notificationsOpen]);

  // 后台刷新最近活动，用于铃铛的未读点；1 分钟一次，失败静默保留旧列表。
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const load = () => {
      activityApi
        .list(8)
        .then((page) => {
          if (alive) setRecentActivity(page.items);
        })
        .catch(() => {
          // 通知中心是辅助信息，失败不打扰用户。
        });
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user]);

  const unreadActivity = countUnreadActivity(recentActivity, activityLastSeenAt);

  function markAllActivitySeen() {
    setActivityLastSeenAt(markActivitySeen());
  }

  // 冷却倒计时按秒刷新；无冷却时不跑定时器，避免整页每秒重渲染。
  useEffect(() => {
    if (!cooldownUntil) return;
    setCooldownNow(Date.now());
    const timer = window.setInterval(() => setCooldownNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  useEffect(() => {
    // 健康检查周期化并在网络恢复时立即复检；失败后不能永远显示"未连接"。
    let alive = true;
    const check = () => {
      fetch('/api/health')
        .then((response) => {
          if (alive) setApiStatus(response.ok ? 'ready' : 'offline');
        })
        .catch(() => {
          if (alive) setApiStatus('offline');
        });
    };
    void check();
    const timer = window.setInterval(check, 30_000);
    const onOnline = () => void check();
    window.addEventListener('online', onOnline);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  // 路由变化：更新浏览器标题、复位滚动、把焦点交给正文，避免键盘/读屏用户停留在旧位置。
  useEffect(() => {
    const pageTitle = findNav(location.pathname).key;
    document.title = `${pageTitle} · WorkMesh`;
    // 只在确实发生滚动时调用，避免无意义的滚动调用（jsdom 也未实现 scrollTo）。
    if (window.scrollY !== 0 || document.documentElement.scrollTop !== 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  function closeDrawer() {
    setDrawerOpen(false);
    window.requestAnimationFrame(() => navToggleRef.current?.focus());
  }

  // 移动抽屉打开后把焦点移入抽屉，避免 Tab 落到背景内容。
  useEffect(() => {
    if (!drawerOpen) return;
    const first = drawerRef.current?.querySelector<HTMLElement>('button');
    first?.focus({ preventScroll: true });
  }, [drawerOpen]);

  // 通知中心打开后焦点进入面板；外部点击关闭。
  useEffect(() => {
    if (!notificationsOpen) return;
    const panel = notificationsRef.current?.querySelector<HTMLElement>('#notifications-panel');
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? panel;
    first?.focus({ preventScroll: true });
    const onPointerDown = (event: MouseEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [notificationsOpen]);

  useEffect(() => {
    const onExpired = () => {
      invalidateWorkbenchSnapshot();
      toast.info('登录已过期，请重新登录。');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // 切换账号后工作台快照属于上一个用户，必须让缓存失效。
  useEffect(() => {
    invalidateWorkbenchSnapshot();
  }, [user?.id]);

  useEffect(() => {
    if (!drawerOpen && !menuOpen && !notificationsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 通知中心是模态对话框：Tab 在面板内循环，不允许焦点跑回背景内容。
      if (event.key === 'Tab' && notificationsOpen) {
        const wrapper = notificationsRef.current;
        const panel = wrapper?.querySelector<HTMLElement>('#notifications-panel') ?? wrapper;
        if (!panel) return;
        const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (!event.shiftKey && document.activeElement === lastNode) {
          event.preventDefault();
          firstNode.focus();
        } else if (event.shiftKey && document.activeElement === firstNode) {
          event.preventDefault();
          lastNode.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      if (notificationsOpen) {
        setNotificationsOpen(false);
        bellRef.current?.focus();
      }
      if (drawerOpen) {
        setDrawerOpen(false);
        navToggleRef.current?.focus();
      }
      setMenuOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, menuOpen, notificationsOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  async function sendEmailDigest() {
    setMailBusy(true);
    setMailNotice('');
    try {
      const result = await notificationApi.sendEmailDigest();
      setMailNotice(`邮件摘要已发送到 ${result.to}`);
    } catch (caught) {
      setMailNotice(formatApiError(caught));
    } finally {
      setMailBusy(false);
    }
  }

  async function logout() {
    try {
      // 登出是 cookie + CSRF 写操作；失败时仍以服务端错误提示，不臆造已登出。
      await authApi.logout();
    } catch (caught) {
      toast.error(formatApiError(caught));
    }
    navigate('/login', { replace: true });
  }

  if (isPublicPage) {
    return (
      <>
        <ErrorBoundary key={location.pathname}>
          <Suspense fallback={pageLoading}>
            {isInvitePage ? (
              <Invite token={inviteMatch?.params.token ?? ''} />
            ) : location.pathname === '/login' ? (
              <Login />
            ) : (
              <Register />
            )}
          </Suspense>
        </ErrorBoundary>
        <ToastHost />
      </>
    );
  }

  if (bootstrapPhase === 'error' && bootstrapError) {
    return (
      <>
        <section style={{ padding: '48px 16px' }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <ErrorState
              title="无法建立会话"
              message={bootstrapError.message}
              detail={bootstrapError.detail}
              requestId={bootstrapError.requestId}
              onRetry={bootstrapCoolingDown ? undefined : () => void runBootstrap()}
              retryLabel="重试建立会话"
              secondaryAction={{
                label: '返回登录',
                onClick: () =>
                  navigate('/login', {
                    state: { from: `${location.pathname}${location.search}` },
                  }),
              }}
            />
            {bootstrapCoolingDown && (
              <div
                className="kb-notice"
                role="status"
                aria-live="polite"
                style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center' }}
              >
                <span>
                  会话重试将在 {cooldownRemaining} 秒后恢复；等待时间来自服务端 Retry-After。
                </span>
                <button type="button" className="ghost" disabled>
                  请等待 {cooldownRemaining} 秒
                </button>
              </div>
            )}
          </div>
        </section>
        <ToastHost />
      </>
    );
  }

  if (status === 'loading') {
    return (
      <section className="page-card muted" role="status">
        正在建立会话…
        <ToastHost />
      </section>
    );
  }

  if (!user)
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    );

  const menuItems = (onNavigate?: () => void) => {
    let lastGroup: string | null = null;
    let groupIndex = 0;
    return navItems.map((item) => {
      const Icon = item.icon;
      const isActive = current.key === item.key;
      const showGroup = item.group !== lastGroup;
      lastGroup = item.group;
      if (showGroup) groupIndex += 1;
      return (
        <Fragment key={item.key}>
          {showGroup && (
            <div className="menu-group-label">
              <span>{String(groupIndex).padStart(2, '0')}</span>
              {NAV_GROUP_LABELS[item.group]}
            </div>
          )}
          <button
            className={`menu-item${isActive ? ' active' : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => {
              navigate(item.path);
              onNavigate?.();
            }}
          >
            <span className="menu-icon">
              <Icon size={16} />
            </span>
            <span className="menu-text">{item.key}</span>
          </button>
        </Fragment>
      );
    });
  };

  const apiState = (
    <div className="api-state" title="仅表示 API 连接可用，不代表页面服务可用或业务数据已同步">
      <i className={apiStatus} />
      API {apiStatus === 'ready' ? '已连接' : apiStatus === 'offline' ? '未连接' : '检测中'}
    </div>
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到正文
      </a>
      <nav className="navbar">
        <div className="navbar-left">
          <button
            ref={navToggleRef}
            className="nav-toggle"
            aria-label={drawerOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => (drawerOpen ? closeDrawer() : setDrawerOpen(true))}
          >
            {drawerOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <button className="logo" onClick={() => navigate('/')} aria-label="返回工作台">
            <span className="logo-mark">
              <svg viewBox="0 0 32 32" width="15" height="15" aria-hidden="true">
                <path
                  d="m7 10 4 12 5-9 5 9 4-12"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>WorkMesh</span>
          </button>
        </div>
        <div className="nav-console" aria-hidden="true">
          <span className={`console-dot ${apiStatus}`} />
          <span className="console-label">
            {apiStatus === 'ready' ? '服务连接正常' : '服务连接中断'}
          </span>
          <span className="console-clock">
            <NavClock />
          </span>
        </div>
        <div className="navbar-right">
          <div className="nav-notifications" ref={notificationsRef}>
            <button
              ref={bellRef}
              className="nav-bell"
              aria-label={`通知：${todoCounts.total} 件待办${unreadActivity > 0 ? `，${unreadActivity} 条未读活动` : ''}`}
              aria-expanded={notificationsOpen}
              aria-controls="notifications-panel"
              title={`待办 ${todoCounts.total} 件${unreadActivity > 0 ? ` · ${unreadActivity} 条未读` : ''}`}
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <Bell size={16} />
              {todoCounts.total > 0 && (
                <span className="nav-bell-count">
                  {todoCounts.total > 99 ? '99+' : todoCounts.total}
                </span>
              )}
              {unreadActivity > 0 && <span className="nav-bell-dot" aria-hidden="true" />}
            </button>
            {notificationsOpen && (
              <div
                id="notifications-panel"
                className="notification-panel"
                role="dialog"
                aria-modal="true"
                aria-label="通知中心"
                tabIndex={-1}
              >
                <div className="notification-head">
                  <strong>通知</strong>
                  <div className="notification-head-actions">
                    {unreadActivity > 0 && (
                      <span className="notification-unread">{unreadActivity} 条未读</span>
                    )}
                    <button
                      className="ghost"
                      disabled={unreadActivity === 0}
                      onClick={markAllActivitySeen}
                    >
                      全部标为已读
                    </button>
                    <button
                      className="ghost"
                      onClick={() => {
                        setNotificationsOpen(false);
                        bellRef.current?.focus();
                      }}
                      aria-label="关闭通知"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="notification-stats">
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate('/?type=signOffs');
                    }}
                  >
                    <span>待签字</span>
                    <strong>{todoCounts.signOffs}</strong>
                  </button>
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate('/?type=approvals');
                    }}
                  >
                    <span>待审批</span>
                    <strong>{todoCounts.approvals}</strong>
                  </button>
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate('/?type=changes');
                    }}
                  >
                    <span>待确认变更</span>
                    <strong>{todoCounts.changes}</strong>
                  </button>
                  <button
                    onClick={() => {
                      setNotificationsOpen(false);
                      navigate('/?type=ready');
                    }}
                  >
                    <span>可开工</span>
                    <strong>{todoCounts.readyTasks}</strong>
                  </button>
                </div>
                <button
                  className="ghost notification-mail"
                  disabled={mailBusy}
                  onClick={() => void sendEmailDigest()}
                >
                  {mailBusy ? '发送中…' : '发送邮件摘要'}
                </button>
                {mailNotice && <p className="page-sub">{mailNotice}</p>}
                <div className="notification-list">
                  <h4>最近活动</h4>
                  {recentActivity.length === 0 ? (
                    <p className="detail-empty">暂无审计事件。</p>
                  ) : (
                    recentActivity.map((item) => {
                      const path = activityPath(item);
                      const content = (
                        <>
                          <span className="status-tag">{labelFor(ACTION_LABELS, item.action)}</span>
                          <span>{item.projectName ?? '—'}</span>
                          <small>
                            {item.actor?.email ?? '系统'} · {formatDateTime(item.createdAt)}
                          </small>
                        </>
                      );
                      return path ? (
                        <button
                          type="button"
                          className="notification-item is-link"
                          key={item.id}
                          onClick={() => {
                            setNotificationsOpen(false);
                            navigate(path);
                          }}
                        >
                          {content}
                        </button>
                      ) : (
                        <div className="notification-item" key={item.id}>
                          {content}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="user-menu" ref={menuRef}>
            <button
              className="user-profile"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`账号菜单：${user.email}`}
              onClick={() => setMenuOpen((value) => !value)}
            >
              <span className="user-avatar">
                <User size={13} />
              </span>
              <span className="user-name">{user.email}</span>
              <ChevronDown size={12} />
            </button>
            {menuOpen && (
              <div className="user-menu-panel" role="menu">
                <div className="user-menu-meta">
                  <strong>{user.email}</strong>
                  <span>{user.id}</span>
                </div>
                <button
                  className="user-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    navigate('/profile');
                  }}
                >
                  用户中心
                </button>
                <button
                  className="user-menu-item is-danger"
                  role="menuitem"
                  onClick={() => void logout()}
                >
                  退出登录
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={closeDrawer} />
          <aside
            id="mobile-nav-drawer"
            className="drawer"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="主导航"
          >
            <div className="menu">{menuItems(closeDrawer)}</div>
            {apiState}
          </aside>
        </>
      )}

      <div className="main-container">
        <aside className="sidebar" aria-label="主导航">
          <div className="menu">{menuItems()}</div>
          {apiState}
        </aside>

        <main className="content-area" id="main-content" tabIndex={-1} ref={mainRef}>
          <h1 className="visually-hidden">当前页面：{findNav(location.pathname).key}</h1>
          <ProjectContextBoundary>
            <ErrorBoundary key={location.pathname}>
              <Suspense fallback={pageLoading}>
                {location.pathname === '/' ? (
                  <Workbench />
                ) : projectMatch ? (
                  <ProjectDetail projectId={projectMatch.params.projectId ?? ''} />
                ) : location.pathname === '/projects' ? (
                  <Projects />
                ) : location.pathname === '/workspace' ? (
                  <ProjectWorkspace />
                ) : location.pathname === '/pipeline' ? (
                  <Pipeline />
                ) : location.pathname === '/requirements' ? (
                  <Requirements />
                ) : requirementMatch ? (
                  <RequirementDetail requirementId={requirementMatch.params.requirementId ?? ''} />
                ) : location.pathname === '/workflows' ? (
                  <Workflows />
                ) : location.pathname === '/knowledge' ? (
                  <Knowledge />
                ) : location.pathname === '/prd' ? (
                  <Prds />
                ) : location.pathname === '/reviews' ? (
                  legacyReviewId ? (
                    <Navigate to={`/reviews/${encodeURIComponent(legacyReviewId)}`} replace />
                  ) : (
                    <Reviews />
                  )
                ) : reviewMatch ? (
                  <ReviewDecision reviewId={reviewMatch.params.reviewId ?? ''} />
                ) : location.pathname === '/board' ? (
                  <Board />
                ) : location.pathname === '/roles' ? (
                  <Roles />
                ) : location.pathname === '/authorization' ||
                  location.pathname === '/cli/authorize' ? (
                  <Authorization />
                ) : location.pathname === '/profile' ? (
                  <Profile />
                ) : (
                  <section className="page-card">页面不存在。</section>
                )}
              </Suspense>
            </ErrorBoundary>
          </ProjectContextBoundary>
        </main>
      </div>
      <ToastHost />
    </>
  );
}

/** 顶部时钟独立成组件：每秒只重渲染自己，不带动整棵 App。 */
function NavClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <>{now.toLocaleTimeString('zh-CN', { hour12: false })}</>;
}

/** 把最近活动映射到可到达的页面；没有可跳转目标时返回 null，保持纯展示。 */
function activityPath(item: ActivityItem): string | null {
  switch (item.targetType) {
    case 'REVIEW_REQUEST':
      return `/reviews/${encodeURIComponent(item.targetId)}`;
    case 'PROJECT':
      return '/projects';
    case 'KNOWLEDGE_DOCUMENT':
      return '/knowledge';
    case 'WORKFLOW_DEFINITION':
    case 'WORKFLOW_DEFINITION_REVISION':
      return '/workflows';
    case 'CREDENTIAL':
      return '/profile';
    case 'CLI_AUTHORIZATION':
      return '/authorization';
    case 'PROJECT_MEMBER':
    case 'PROJECT_INVITATION':
      return '/roles';
    default:
      return null;
  }
}
