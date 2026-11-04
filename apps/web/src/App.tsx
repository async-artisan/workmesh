import { Fragment, Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Bell, ChevronDown, Menu, User, X } from 'lucide-react';
import { Navigate, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { SESSION_EXPIRED_EVENT, formatApiError } from './api/client';
import { authApi, bootstrapSession } from './api/auth';
import { activityApi, notificationApi, workbenchApi, type ActivityItem } from './api/resources';
import { ACTION_LABELS, labelFor } from './lib/labels';
import { useAuthStore } from './store/auth';
import { NAV_GROUP_LABELS, findNav, navItems } from './nav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PageState } from './components/PageState';
import { ToastHost } from './components/ToastHost';
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

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const current = findNav(location.pathname);
  const legacyReviewId = new URLSearchParams(location.search).get('id');
  const requirementMatch = matchPath('/requirements/:requirementId', location.pathname);
  const reviewMatch = matchPath('/reviews/:reviewId', location.pathname);
  const inviteMatch = matchPath('/invite/:token', location.pathname);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ready' | 'offline'>('checking');
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
  const [clock, setClock] = useState(() => new Date());
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNotice, setMailNotice] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const user = useAuthStore((state) => state.user);
  const status = useAuthStore((state) => state.status);
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';
  const isInvitePage = Boolean(inviteMatch);
  const isPublicPage = isAuthPage || isInvitePage;

  // 启动时只读取同源 cookie 会话与内存 CSRF；不读任何本地 token。
  useEffect(() => {
    if (isPublicPage) return;
    bootstrapSession().catch((caught: unknown) => {
      toast.error(formatApiError(caught));
    });
  }, [isPublicPage]);

  useEffect(() => {
    if (!user) {
      setTodoCounts({ signOffs: 0, approvals: 0, changes: 0, readyTasks: 0, total: 0 });
      return;
    }
    let alive = true;
    const load = () => {
      workbenchApi
        .get()
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

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setApiStatus(response.ok ? 'ready' : 'offline'))
      .catch(() => setApiStatus('offline'));
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onExpired = () => toast.info('登录已过期，请重新登录。');
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  useEffect(() => {
    if (!drawerOpen && !menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, menuOpen]);

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

  if (status === 'loading') {
    return (
      <section className="page-card muted">
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
      <nav className="navbar">
        <div className="navbar-left">
          <button
            className="nav-toggle"
            aria-label={drawerOpen ? '关闭导航菜单' : '打开导航菜单'}
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen((value) => !value)}
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
            {apiStatus === 'ready' ? 'AUTHORITY LINK' : 'LINK OFFLINE'}
          </span>
          <span className="console-clock">
            {clock.toLocaleTimeString('zh-CN', { hour12: false })}
          </span>
        </div>
        <div className="navbar-right">
          <div className="nav-notifications">
            <button
              className="nav-bell"
              aria-label={`通知：${todoCounts.total} 件待办`}
              aria-expanded={notificationsOpen}
              title={`待办 ${todoCounts.total} 件`}
              onClick={() => setNotificationsOpen((value) => !value)}
            >
              <Bell size={16} />
              {todoCounts.total > 0 && (
                <span className="nav-bell-count">
                  {todoCounts.total > 99 ? '99+' : todoCounts.total}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="notification-panel" role="dialog" aria-label="通知中心">
                <div className="notification-head">
                  <strong>通知</strong>
                  <button
                    className="ghost"
                    onClick={() => setNotificationsOpen(false)}
                    aria-label="关闭通知"
                  >
                    <X size={14} />
                  </button>
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
                    recentActivity.map((item) => (
                      <div className="notification-item" key={item.id}>
                        <span className="status-tag">{labelFor(ACTION_LABELS, item.action)}</span>
                        <span>{item.projectName ?? '—'}</span>
                        <small>
                          {item.actor?.email ?? '系统'} ·{' '}
                          {new Date(item.createdAt).toLocaleString('zh-CN')}
                        </small>
                      </div>
                    ))
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
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          <aside className="drawer" aria-label="主导航">
            <div className="menu">{menuItems(() => setDrawerOpen(false))}</div>
            {apiState}
          </aside>
        </>
      )}

      <div className="main-container">
        <aside className="sidebar" aria-label="主导航">
          <div className="menu">{menuItems()}</div>
          {apiState}
        </aside>

        <main className="content-area">
          <ErrorBoundary key={location.pathname}>
            <Suspense fallback={pageLoading}>
              {location.pathname === '/' ? (
                <Workbench />
              ) : location.pathname === '/projects' ? (
                <Projects />
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
              ) : location.pathname === '/authorization' ? (
                <Authorization />
              ) : location.pathname === '/profile' ? (
                <Profile />
              ) : (
                <section className="page-card">页面不存在。</section>
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <ToastHost />
    </>
  );
}
